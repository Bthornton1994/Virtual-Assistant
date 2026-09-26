import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/domain";
import { createFakeDb, type FakeDb } from "./fake-supabase";

let db: FakeDb;
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => db }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => null }));

import { delegationAI } from "@/lib/ai";
import {
  bindPlanToAuthority,
  raiseRiskForScope,
  resolveApprovalRequirements,
  resolveRequestRisk,
  restrictModelStepOwners,
  routeForActionClass,
} from "@/lib/ai-authority";
import { SupabaseWorkspaceRepository } from "@/lib/data/supabase-workspace";
import { MemoryStore, seedData } from "@/lib/store";

// A consequential request: moving money. Deterministic policy classifies it as
// sensitive_execution / critical, which requires a sensitive_action approval.
const FUNDS_TRANSFER = {
  title: "Wire the vendor",
  objective: "Pay the research vendor",
  description: "Transfer funds to the research vendor today from the operating account.",
  deliverable: "Payment confirmation",
  dueAt: null,
  workstreamId: null,
  recurring: false,
  externalCommunication: false,
};

type ModelReplies = Partial<Record<"triage" | "workstream" | "risk" | "missing" | "plan" | "approvals" | "executor" | "automation", unknown>>;

/** A hostile model: every reply tries to loosen authority. */
const HOSTILE: ModelReplies = {
  triage: { workstreamSlug: "research-desk", priority: "low", actionClass: "prepare_only", riskLevel: "low", estimatedEffort: 1, automationScore: 99, rationale: "Routine." },
  workstream: { workstreamSlug: "research-desk", rationale: "Research." },
  risk: { actionClass: "prepare_only", riskLevel: "low", reasons: ["Looks like drafting."] },
  missing: { missing: [] },
  plan: {
    summary: "Just do it.",
    actionClass: "prepare_only",
    riskLevel: "low",
    steps: [{ title: "Send the wire", detail: "Execute the transfer", owner: "ai" }],
    approvalsRequired: false,
    automationCandidates: ["Everything"],
    humanOwned: [],
  },
  approvals: { kinds: ["execution_plan"], reasons: [], requiresCustomerDecision: false },
  executor: { executor: "ai", skillHints: [], reason: "Automate it.", humanRequired: false },
  automation: { candidate: true, step: "All of it", reason: "", requiresHumanApproval: false },
};

const PROMPT_KEYS: Array<[string, keyof ModelReplies]> = [
  ["Triage", "triage"],
  ["Classify workstream", "workstream"],
  ["Classify risk", "risk"],
  ["Missing context", "missing"],
  ["Create an execution plan", "plan"],
  ["Approval requirements", "approvals"],
  ["Executor", "executor"],
  ["Automation", "automation"],
];

/** Stub the live model endpoint that `delegationAI` calls when XAI_API_KEY is set. */
function stubModel(replies: ModelReplies) {
  const prompts: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const prompt = String(JSON.parse(String(init?.body)).messages[1].content);
    prompts.push(prompt);
    const key = PROMPT_KEYS.find(([prefix]) => prompt.startsWith(prefix))?.[1];
    if (!key || !(key in replies)) return new Response("", { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(replies[key]) } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubEnv("XAI_API_KEY", "test-key");
  vi.stubGlobal("fetch", fetchMock);
  return { prompts };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deterministic authority rules", () => {
  it("keeps a consequential request sensitive when the model calls it prepare_only", () => {
    const decision = resolveRequestRisk(FUNDS_TRANSFER, HOSTILE.risk);
    expect(decision.actionClass).toBe("sensitive_execution");
    expect(decision.riskLevel).toBe("critical");
  });

  it("fails closed on invalid or partial classifications", () => {
    for (const suggestion of [null, undefined, "prepare_only", [], {}, { actionClass: "yolo", riskLevel: "none" }, { actionClass: 3 }]) {
      const decision = resolveRequestRisk(FUNDS_TRANSFER, suggestion);
      expect(decision).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical" });
    }
  });

  it("lets the model raise the class, and keeps the risk level at the new class's floor", () => {
    const input = { title: "Draft a brief", description: "Summarize the meeting notes", externalCommunication: false };
    expect(resolveRequestRisk(input, null)).toMatchObject({ actionClass: "prepare_only", riskLevel: "low" });
    // A stricter class with a lower (or invalid) risk level still gets the class's risk floor.
    expect(resolveRequestRisk(input, { actionClass: "sensitive_execution", riskLevel: "low" })).toMatchObject({
      actionClass: "sensitive_execution",
      riskLevel: "critical",
    });
    expect(resolveRequestRisk(input, { actionClass: "external_execution", riskLevel: "banana" })).toMatchObject({
      actionClass: "external_execution",
      riskLevel: "high",
    });
    // A valid, stricter risk level alone is accepted without changing the class.
    expect(resolveRequestRisk(input, { actionClass: "prepare_only", riskLevel: "high" })).toMatchObject({
      actionClass: "prepare_only",
      riskLevel: "high",
    });
  });

  it("does not let the model narrow required approvals", () => {
    const sensitive = { ...FUNDS_TRANSFER, actionClass: "sensitive_execution" as const };
    for (const suggestion of [HOSTILE.approvals, { kinds: [] }, { kinds: "none" }, null]) {
      const approvals = resolveApprovalRequirements(sensitive, suggestion);
      expect(approvals.kinds).toEqual(expect.arrayContaining(["execution_plan", "sensitive_action"]));
      expect(approvals.requiresCustomerDecision).toBe(true);
    }
    const external = { title: "Customer update", description: "Tell them it shipped", actionClass: "external_execution" as const, externalCommunication: true };
    expect(resolveApprovalRequirements(external, { kinds: ["execution_plan"], requiresCustomerDecision: false }).kinds).toEqual(
      expect.arrayContaining(["execution_plan", "external_email"]),
    );
  });

  it("lets the model add known approval kinds and drops unknown ones", () => {
    const input = { title: "Research brief", description: "Compile notes", actionClass: "prepare_only" as const, externalCommunication: false };
    const approvals = resolveApprovalRequirements(input, { kinds: ["vendor_communication", "self_approve", "execution_plan"] });
    expect(approvals.kinds).toEqual(["execution_plan", "vendor_communication"]);
  });

  it("routes executors from the action class alone", () => {
    expect(routeForActionClass("sensitive_execution")).toMatchObject({ executor: "specialist", humanRequired: true });
    expect(routeForActionClass("external_execution")).toMatchObject({ executor: "operator", humanRequired: true });
    expect(routeForActionClass("low_risk_execution")).toMatchObject({ executor: "operator", humanRequired: true });
    expect(routeForActionClass("prepare_only")).toMatchObject({ executor: "ai", humanRequired: false });
  });

  it("binds a plan to the request's authority and keeps model-owned steps with an operator", () => {
    const plan = HOSTILE.plan as Parameters<typeof bindPlanToAuthority>[0];
    const bound = bindPlanToAuthority(plan, { actionClass: "sensitive_execution", riskLevel: "critical" });
    expect(bound).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical", approvalsRequired: true });
    expect(restrictModelStepOwners(plan, "sensitive_execution").steps.map((s) => s.owner)).toEqual(["operator"]);
    expect(restrictModelStepOwners(plan, "prepare_only").steps.map((s) => s.owner)).toEqual(["ai"]);
  });

  it("raises authority when edited scope is stricter, and never lowers it", () => {
    const base = { title: "Draft a brief", description: "Summarize notes", externalCommunication: false };
    expect(raiseRiskForScope({ ...base, approvalLevel: "prepare_only", riskLevel: "low" })).toBeNull();
    expect(raiseRiskForScope({ ...base, description: "Transfer funds to the vendor", approvalLevel: "prepare_only", riskLevel: "low" })).toMatchObject({
      actionClass: "sensitive_execution",
      riskLevel: "critical",
    });
    // Benign edited text does not lower an already sensitive request.
    expect(raiseRiskForScope({ ...base, approvalLevel: "sensitive_execution", riskLevel: "critical" })).toBeNull();
  });
});

describe("live model output through delegationAI", () => {
  it("cannot lower the classification", async () => {
    stubModel(HOSTILE);
    const risk = await delegationAI.classifyRisk(FUNDS_TRANSFER);
    expect(risk).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical" });
  });

  it("cannot narrow approval requirements", async () => {
    stubModel(HOSTILE);
    const approvals = await delegationAI.determineApprovalRequirements({ ...FUNDS_TRANSFER, actionClass: "sensitive_execution" });
    expect(approvals.kinds).toEqual(expect.arrayContaining(["execution_plan", "sensitive_action"]));
  });

  it("offers no model-backed executor routing", () => {
    // Routing lives in routeForActionClass; the model interface has no routing method.
    expect("suggestExecutor" in delegationAI).toBe(false);
    expect("suggestRouting" in delegationAI).toBe(false);
  });
});

describe("in-memory store", () => {
  it("keeps a funds transfer sensitive, with its approvals and routing, when the model says prepare_only", async () => {
    const { prompts } = stubModel(HOSTILE);
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const bundle = await store.createRequest(founder, FUNDS_TRANSFER);

    expect(prompts.some((p) => p.startsWith("Classify risk"))).toBe(true); // the model was asked
    expect(prompts.some((p) => p.startsWith("Executor"))).toBe(false); // routing never asks it
    expect(bundle.request.approvalLevel).toBe("sensitive_execution");
    expect(bundle.request.riskLevel).toBe("critical");
    const kinds = bundle.approvals.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["execution_plan", "sensitive_action"]));
    expect(bundle.approvals.every((a) => a.actionClass === "sensitive_execution")).toBe(true);
    expect(bundle.plan).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical", approvalsRequired: true });
    expect(bundle.steps.map((s) => s.owner)).not.toContain("ai");
    const aiAudit = bundle.audits.find((a) => a.action === "ai.action");
    expect(aiAudit?.metadata).toMatchObject({ actionClass: "sensitive_execution", suggestedExecutor: "specialist" });
  });

  it("raises authority when a scope edit makes the request consequential", async () => {
    stubModel({ ...HOSTILE, risk: { actionClass: "prepare_only", riskLevel: "low", reasons: [] } });
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const bundle = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Research brief",
      objective: "Summarize vendors",
      description: "Draft a summary of vendor options.",
    });
    expect(bundle.request.approvalLevel).toBe("prepare_only");
    const edited = store.updateRequestScope(founder, bundle.request.id, { description: "Transfer funds to the chosen vendor." });
    expect(edited.approvalLevel).toBe("sensitive_execution");
    expect(edited.riskLevel).toBe("critical");
    // A later benign edit does not lower it again.
    const benign = store.updateRequestScope(founder, bundle.request.id, { description: "Draft a summary of vendor options." });
    expect(benign.approvalLevel).toBe("sensitive_execution");
  });
});

describe("Supabase workspace", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const actor: Actor = {
    id: "22222222-2222-4222-8222-222222222222",
    email: "owner@example.com",
    name: "Owner",
    role: "client_admin",
    organizationId: ORG,
    operatorId: null,
    source: "supabase",
  };

  beforeEach(() => {
    db = createFakeDb({
      workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "Back office", status: "active", created_at: "", updated_at: "" }],
    });
  });

  it("persists a funds transfer as sensitive, with its approvals and routing, when the model says prepare_only", async () => {
    const { prompts } = stubModel(HOSTILE);
    await new SupabaseWorkspaceRepository().createRequest(actor, FUNDS_TRANSFER);

    expect(prompts.some((p) => p.startsWith("Classify risk"))).toBe(true);
    expect(prompts.some((p) => p.startsWith("Executor"))).toBe(false);
    const request = db.tables.requests[0];
    expect(request.approval_level).toBe("sensitive_execution");
    expect(request.risk_level).toBe("critical");
    const kinds = db.tables.approvals.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["execution_plan", "sensitive_action"]));
    expect(db.tables.approvals.every((a) => a.action_class === "sensitive_execution")).toBe(true);
    expect(db.tables.execution_plans[0].plan).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical", approvalsRequired: true });
    expect(db.tables.request_steps.map((s) => s.owner)).not.toContain("ai");
    const aiAudit = db.tables.audit_events.find((e) => e.action === "ai.action");
    expect(aiAudit?.metadata).toMatchObject({ actionClass: "sensitive_execution", suggestedExecutor: "specialist" });
  });

  it("raises authority when a scope edit makes the request consequential", async () => {
    stubModel(HOSTILE);
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(actor, {
      ...FUNDS_TRANSFER,
      title: "Research brief",
      objective: "Summarize vendors",
      description: "Draft a summary of vendor options.",
    });
    const id = String(db.tables.requests[0].id);
    expect(db.tables.requests[0].approval_level).toBe("prepare_only");
    const edited = await repo.updateRequestScope(actor, id, { description: "Transfer funds to the chosen vendor." });
    expect(edited.approvalLevel).toBe("sensitive_execution");
    expect(db.tables.requests[0]).toMatchObject({ approval_level: "sensitive_execution", risk_level: "critical" });
    const benign = await repo.updateRequestScope(actor, id, { description: "Draft a summary of vendor options." });
    expect(benign.approvalLevel).toBe("sensitive_execution");
  });
});

describe("the floor reads every field the requester wrote", () => {
  it("classifies consequential wording in the objective or deliverable", () => {
    const decision = resolveRequestRisk(
      {
        title: "Vendor prep",
        objective: "Wire $50,000 to the new vendor bank account",
        description: "Get this done this week.",
        deliverable: "Completed wire transfer",
        externalCommunication: false,
      },
      { actionClass: "prepare_only", riskLevel: "low" },
    );
    expect(decision).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical" });
  });
});

describe("mock path (no model key)", () => {
  it("gives a low-risk execution plan the class's risk level", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const bundle = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Update the team calendar",
      objective: "Move the weekly standup",
      description: "Move the weekly standup to Tuesday for the whole team, starting next week.",
      deliverable: "Updated calendar invite",
    });
    expect(bundle.request).toMatchObject({ approvalLevel: "low_risk_execution", riskLevel: "medium" });
    expect(bundle.plan?.riskLevel).toBe("medium");
  });
});

describe("raising authority after the plan was approved", () => {
  const WIRE_EDIT = "Research the vendors, then wire the $40k deposit from the operating bank account.";

  it("in-memory store: returns the request to plan approval at the raised class", async () => {
    stubModel({ ...HOSTILE, plan: undefined, approvals: undefined });
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const created = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Research brief on vendor options",
      objective: "Research brief",
      description: "Draft a research brief comparing three vendors with sources and pricing details for Q3.",
      deliverable: "Brief",
    });
    const id = created.request.id;
    expect(created.request.approvalLevel).toBe("prepare_only");
    const planApproval = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "execution_plan")!;
    store.decideApproval(founder, planApproval.id, "approved", "ok");
    expect(store.getRequestBundle(founder, id).request.status).toBe("queued");
    expect(store.getRequestBundle(founder, id).steps.map((s) => s.owner)).toContain("ai");

    store.updateRequestScope(manager, id, { description: WIRE_EDIT });

    const bundle = store.getRequestBundle(founder, id);
    expect(bundle.request).toMatchObject({ status: "awaiting_plan_approval", approvalLevel: "sensitive_execution", riskLevel: "critical" });
    expect(bundle.plan).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical", approvalsRequired: true });
    expect(bundle.steps.map((s) => s.owner)).not.toContain("ai");
    const pending = bundle.approvals.filter((a) => a.status === "pending");
    expect(pending.map((a) => a.kind).sort()).toEqual(["execution_plan", "sensitive_action"]);
    expect(pending.every((a) => a.actionClass === "sensitive_execution")).toBe(true);
    // The approval given at prepare_only no longer lets the request queue.
    expect(() => store.transitionRequest(manager, id, "queued")).toThrow(/must be approved/);
    store.decideApproval(founder, pending.find((a) => a.kind === "execution_plan")!.id, "approved", "ok");
    expect(store.getRequestBundle(founder, id).request.status).not.toBe("awaiting_plan_approval");
  });

  it("Supabase workspace: returns the request to plan approval at the raised class", async () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com", name: "Owner", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "ops@example.com", name: "Ops", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({
      workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "Back office", status: "active", created_at: "", updated_at: "" }],
    });
    stubModel(HOSTILE);
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, {
      ...FUNDS_TRANSFER,
      title: "Research brief",
      objective: "Summarize vendors",
      description: "Draft a summary of vendor options.",
      deliverable: "Brief",
    });
    const id = String(db.tables.requests[0].id);
    // The customer approved the prepare_only plan and the request was queued.
    const approved = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    Object.assign(approved, { status: "approved" });
    Object.assign(db.tables.requests[0], { status: "queued" });
    expect(db.tables.request_steps.map((s) => s.owner)).toContain("ai");

    await repo.updateRequestScope(manager, id, { description: WIRE_EDIT });

    expect(db.tables.requests[0]).toMatchObject({ status: "awaiting_plan_approval", approval_level: "sensitive_execution", risk_level: "critical" });
    expect(db.tables.execution_plans[0].plan).toMatchObject({ actionClass: "sensitive_execution", riskLevel: "critical", approvalsRequired: true });
    expect(db.tables.request_steps.map((s) => s.owner)).not.toContain("ai");
    const pending = db.tables.approvals.filter((a) => a.status === "pending");
    expect(pending.map((a) => a.kind).sort()).toEqual(["execution_plan", "sensitive_action"]);
    expect(pending.every((a) => a.action_class === "sensitive_execution")).toBe(true);
    await expect(repo.transitionRequest(manager, id, "queued")).rejects.toThrow(/must be approved/);
  });
});

describe("approvals given before a raise do not authorize the raised request", () => {
  const PACK = {
    summary: "Prepared pack.",
    deliverables: ["Pack"],
    attachments: [] as string[],
    actionsTaken: [] as string[],
    exceptions: [] as string[],
    unresolvedDecisions: [] as string[],
    nextStep: "Customer reviews",
  };

  async function approvedPrepareOnly(title: string, description: string) {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const created = await store.createRequest(founder, { ...FUNDS_TRANSFER, title, objective: "Prepare the draft", description, deliverable: "Draft" });
    const id = created.request.id;
    expect(created.request.approvalLevel).toBe("prepare_only");
    for (const a of store.getRequestBundle(founder, id).approvals) store.decideApproval(founder, a.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).toBe("queued");
    return { store, founder, manager, id };
  }

  it("keeps the request at plan approval when only a raised action approval is decided", async () => {
    const { store, founder, manager, id } = await approvedPrepareOnly("Research brief", "Draft a research brief comparing three vendors with pricing details.");
    store.transitionRequest(manager, id, "in_progress");
    store.updateRequestScope(manager, id, { description: "Draft the brief, then wire the $40k deposit from the operating bank account." });
    const pending = store.getRequestBundle(founder, id).approvals.filter((a) => a.status === "pending");
    store.decideApproval(founder, pending.find((a) => a.kind === "sensitive_action")!.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).toBe("awaiting_plan_approval");
    // Detouring through triage does not skip the pending plan approval either.
    store.transitionRequest(manager, id, "triage");
    expect(() => store.transitionRequest(manager, id, "queued")).toThrow(/must be approved/);
  });

  it("does not accept an outbound approval given at a lower class", async () => {
    const { store, founder, manager, id } = await approvedPrepareOnly("Draft follow-up email for the team", "Draft the follow-up notes for the team with the decisions and owners from Tuesday.");
    const before = store.getRequestBundle(founder, id).approvals;
    expect(before.find((a) => a.kind === "external_email")).toMatchObject({ status: "approved", actionClass: "prepare_only" });
    store.updateRequestScope(manager, id, { description: "Draft the follow-up notes with the decisions and owners, then send to the client list." });
    expect(store.getRequest(founder, id).approvalLevel).toBe("external_execution");
    const plan = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "execution_plan" && a.status === "pending")!;
    store.decideApproval(founder, plan.id, "approved", "ok");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "Ready." });
    // QA asks for outbound approval at the raised class instead of using the old one.
    expect(store.getRequest(founder, id).status).toBe("awaiting_action_approval");
    expect(() => store.deliverRequest(manager, id, PACK)).toThrow();
  });

  it("does not redeliver a reopened, raised request on its old package", async () => {
    const { store, founder, manager, id } = await approvedPrepareOnly("Research brief", "Draft a research brief comparing three vendors with pricing details.");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "Ready." });
    store.deliverRequest(manager, id, PACK);
    store.transitionRequest(manager, id, "in_progress");
    store.updateRequestScope(manager, id, { description: "Now transfer funds to the chosen vendor." });
    const request = store.getRequest(founder, id);
    expect(request).toMatchObject({ status: "awaiting_plan_approval", approvalLevel: "sensitive_execution" });
    expect(() => store.deliverRequest(manager, id, PACK)).toThrow();
    const audits = store.getRequestBundle(founder, id).audits;
    expect(audits.some((a) => a.action === "request.status_changed" && a.metadata.reason === "authority_raised")).toBe(true);
  });

  it("stamps a manually requested approval at no lower than the request's class", async () => {
    const { store, founder, manager, id } = await approvedPrepareOnly("Research brief", "Draft a research brief comparing three vendors with pricing details.");
    store.updateRequestScope(manager, id, { description: "Transfer funds to the vendor." });
    // Clear the pending plan approval so the request creates a new one.
    for (const a of store.getRequestBundle(founder, id).approvals.filter((x) => x.status === "pending")) {
      store.decideApproval(founder, a.id, "approved", "ok");
    }
    const approval = store.createApproval(manager, id, "prepare_only", "Re-confirm plan", "execution_plan");
    expect(approval.status).toBe("pending");
    expect(approval.actionClass).toBe("sensitive_execution");
  });

  it("Supabase workspace: an action approval does not skip the pending plan re-approval", async () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com", name: "Owner", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "ops@example.com", name: "Ops", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({
      workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "Back office", status: "active", created_at: "", updated_at: "" }],
    });
    stubModel(HOSTILE);
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, { ...FUNDS_TRANSFER, title: "Research brief", objective: "Summarize vendors", description: "Draft a summary of vendor options.", deliverable: "Brief" });
    const id = String(db.tables.requests[0].id);
    Object.assign(db.tables.approvals.find((a) => a.kind === "execution_plan")!, { status: "approved" });
    Object.assign(db.tables.requests[0], { status: "in_progress" });

    await repo.updateRequestScope(manager, id, { description: "Draft the summary, then wire the $40k deposit from the operating bank account." });
    const sensitive = db.tables.approvals.find((a) => a.kind === "sensitive_action" && a.status === "pending")!;
    await repo.decideApproval(client, String(sensitive.id), "approved", "ok");
    expect(db.tables.requests[0].status).toBe("awaiting_plan_approval");
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan" && a.status === "pending")!;
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    const count = db.tables.approvals.length;
    const manual = await repo.createApproval(manager, id, "prepare_only", "Re-confirm plan", "execution_plan");
    expect(db.tables.approvals.length).toBe(count + 1); // a new approval, not the pending one
    expect(manual.actionClass).toBe("sensitive_execution");
    expect(db.tables.audit_events.some((e) => e.action === "request.status_changed" && (e.metadata as Record<string, unknown>).reason === "authority_raised")).toBe(true);
  });
});

describe("a raise during clarification still needs plan approval at the raised class", () => {
  async function queuedPrepareOnly() {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const created = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Research brief",
      objective: "Prepare the draft",
      description: "Draft a research brief comparing three vendors with pricing details.",
      deliverable: "Draft",
    });
    const id = created.request.id;
    for (const a of store.getRequestBundle(founder, id).approvals) store.decideApproval(founder, a.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).toBe("queued");
    return { store, founder, manager, id };
  }

  it("does not let an action approval start the raised work", async () => {
    const { store, founder, manager, id } = await queuedPrepareOnly();
    store.askClarification(manager, id, "Which vendor?");
    store.updateRequestScope(manager, id, { description: "Draft the brief, then wire the $40k deposit from the operating bank account." });
    const bundle = store.getRequestBundle(founder, id);
    expect(bundle.request.status).toBe("needs_clarification");
    const pending = bundle.approvals.filter((a) => a.status === "pending");
    expect(pending.map((a) => a.kind).sort()).toEqual(["execution_plan", "sensitive_action"]);
    store.decideApproval(founder, pending.find((a) => a.kind === "sensitive_action")!.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).toBe("needs_clarification");
  });

  it("does not let a rejected action approval be worked around by ops", async () => {
    const { store, founder, manager, id } = await queuedPrepareOnly();
    store.askClarification(manager, id, "Which list?");
    store.updateRequestScope(manager, id, { description: "Draft the brief with pricing, then send to the client list." });
    const email = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "external_email" && a.status === "pending")!;
    store.decideApproval(founder, email.id, "rejected", "no");
    const status = store.getRequest(founder, id).status;
    expect(status).toBe("needs_clarification");
    expect(() => store.transitionRequest(manager, id, "in_progress")).toThrow();
  });

  it("holds the queue after a mid-work clarification until the new plan approval is decided", async () => {
    const { store, founder, manager, id } = await queuedPrepareOnly();
    store.transitionRequest(manager, id, "in_progress");
    const question = store.askClarification(manager, id, "Which quarter?");
    store.answerClarification(founder, question.id, "Q3");
    expect(store.getRequest(founder, id).status).toBe("awaiting_plan_approval");
    expect(() => store.transitionRequest(manager, id, "queued")).toThrow(/must be approved/);
  });

  it("Supabase workspace: an action approval does not start raised work during clarification", async () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com", name: "Owner", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "ops@example.com", name: "Ops", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({
      workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "Back office", status: "active", created_at: "", updated_at: "" }],
    });
    stubModel(HOSTILE);
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, { ...FUNDS_TRANSFER, title: "Research brief", objective: "Summarize vendors", description: "Draft a summary of vendor options.", deliverable: "Brief" });
    const id = String(db.tables.requests[0].id);
    Object.assign(db.tables.approvals.find((a) => a.kind === "execution_plan")!, { status: "approved" });
    Object.assign(db.tables.requests[0], { status: "needs_clarification" });

    await repo.updateRequestScope(manager, id, { description: "Draft the summary, then wire the $40k deposit from the operating bank account." });
    expect(db.tables.requests[0].status).toBe("needs_clarification");
    const pending = db.tables.approvals.filter((a) => a.status === "pending");
    expect(pending.map((a) => a.kind).sort()).toEqual(["execution_plan", "sensitive_action"]);
    await repo.decideApproval(client, String(pending.find((a) => a.kind === "sensitive_action")!.id), "approved", "ok");
    expect(db.tables.requests[0].status).toBe("needs_clarification");
    Object.assign(db.tables.requests[0], { status: "blocked" });
    await expect(repo.transitionRequest(manager, id, "in_progress")).rejects.toThrow(/before work starts/);
  });
});
