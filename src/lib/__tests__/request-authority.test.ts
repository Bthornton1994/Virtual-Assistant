import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError, type Actor } from "@/lib/domain";
import { createFakeDb, type FakeDb } from "./fake-supabase";

let db: FakeDb;
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => db }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => null }));

import { delegationAI } from "@/lib/ai";
import {
  approvalCovers,
  bindPlanToAuthority,
  raiseRiskForScope,
  reapprovalAfterRaise,
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

  it("an approval with an unknown class covers nothing", () => {
    for (const actionClass of [null, undefined, "yolo"] as never[]) {
      for (const approvalLevel of ["prepare_only", "yolo"] as never[]) {
        expect(approvalCovers({ kind: "execution_plan", actionClass }, { approvalLevel })).toBe(false);
        expect(approvalCovers({ kind: "external_email", actionClass }, { approvalLevel })).toBe(false);
      }
    }
    expect(approvalCovers({ kind: "execution_plan", actionClass: "prepare_only" }, { approvalLevel: "prepare_only" })).toBe(true);
  });

  it("a raise on an accepted or cancelled request only realigns its records", () => {
    for (const status of ["accepted", "cancelled"] as const) {
      expect(reapprovalAfterRaise(status, true)).toEqual({ requestApprovals: false, newPlanApproval: false, returnToPlanApproval: false });
    }
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

describe("approval decisions pass the same gates as transitions", () => {
  const PACK = {
    summary: "Prepared pack.",
    deliverables: ["Pack"],
    attachments: [] as string[],
    actionsTaken: [] as string[],
    exceptions: [] as string[],
    unresolvedDecisions: [] as string[],
    nextStep: "Customer reviews",
  };

  function memory() {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    return { store, founder: store.actorFromUser("usr_founder")!, manager: store.actorFromUser("usr_manager")! };
  }

  function approveAllPending(store: MemoryStore, founder: Actor, id: string) {
    for (const a of store.getRequestBundle(founder, id).approvals.filter((x) => x.status === "pending")) {
      store.decideApproval(founder, a.id, "approved", "ok");
    }
  }

  it("does not start raised sensitive work when only an outbound approval is decided", async () => {
    const { store, founder, manager } = memory();
    const created = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Customer update",
      objective: "Tell the customer about the new release",
      description: "Prepare the customer update on the new release with the key changes and dates.",
      deliverable: "Customer update",
      externalCommunication: true,
    });
    const id = created.request.id;
    expect(created.request.approvalLevel).toBe("external_execution");
    approveAllPending(store, founder, id);
    const operatorId = store.data.operators[0].id;
    store.data.requests.find((r) => r.id === id)!.assignedOperatorId = operatorId;
    store.transitionRequest(manager, id, "in_progress");

    store.updateRequestScope(manager, id, { description: "Prepare the customer update, then wire the $40k deposit from the operating bank account." });
    const plan = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "execution_plan" && a.status === "pending")!;
    store.decideApproval(founder, plan.id, "approved", "ok");
    expect(() => store.transitionRequest(manager, id, "in_progress")).toThrow(/Sensitive execution/);
    const email = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "external_email" && a.status === "pending")!;
    store.decideApproval(founder, email.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).not.toBe("in_progress");
  });

  it("does not let a QA pass from before a raise stand for the raised work", async () => {
    const { store, founder, manager } = memory();
    const created = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Research brief",
      objective: "Prepare the draft",
      description: "Draft a research brief comparing three vendors with pricing details.",
      deliverable: "Draft",
    });
    const id = created.request.id;
    approveAllPending(store, founder, id);
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "Ready." });
    // Ensure the re-approval is decided strictly after the old QA review.
    const qa = store.data.qaReviews.find((q) => q.requestId === id)!;
    qa.createdAt = "2000-01-01T00:00:00.000Z";

    store.updateRequestScope(manager, id, { description: "Draft the research brief with pricing details, then send to the client list." });
    approveAllPending(store, founder, id);
    expect(store.getRequest(founder, id).status).not.toBe("ready_to_deliver");
    expect(() => store.deliverRequest(manager, id, PACK)).toThrow();
  });

  it("still delivers existing sensitive outbound work whose outbound approval was recorded at external_execution", async () => {
    const { store, founder, manager } = memory();
    const created = await store.createRequest(founder, {
      ...FUNDS_TRANSFER,
      title: "Vendor payment notice",
      objective: "Pay the vendor and tell them",
      description: "Transfer funds to the vendor and send them the remittance advice by email.",
      deliverable: "Remittance advice",
      externalCommunication: true,
    });
    const id = created.request.id;
    expect(created.request.approvalLevel).toBe("sensitive_execution");
    // An outbound approval recorded before this change was stamped external_execution.
    const outbound = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "external_email")!;
    outbound.actionClass = "external_execution";
    approveAllPending(store, founder, id);
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "Ready." });
    expect(store.getRequest(founder, id).status).toBe("ready_to_deliver");
    expect(() => store.deliverRequest(manager, id, PACK)).not.toThrow();
  });
});

describe("Supabase workspace: approval decisions pass the transition gates", () => {
  it("does not start sensitive work when only an outbound approval is decided", async () => {
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "owner@example.com", name: "Owner", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({
      workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "Back office", status: "active", created_at: "", updated_at: "" }],
    });
    vi.stubEnv("XAI_API_KEY", "");
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, { ...FUNDS_TRANSFER, externalCommunication: true, description: "Transfer funds to the vendor and send them the remittance advice by email." });
    const request = db.tables.requests[0];
    expect(request.approval_level).toBe("sensitive_execution");
    Object.assign(db.tables.approvals.find((a) => a.kind === "execution_plan")!, { status: "approved", decided_at: "2026-01-01T00:00:00.000Z" });
    Object.assign(request, { status: "awaiting_action_approval", assigned_operator_id: "44444444-4444-4444-8444-444444444444" });
    const email = db.tables.approvals.find((a) => a.kind === "external_email" && a.status === "pending")!;
    expect(db.tables.approvals.find((a) => a.kind === "sensitive_action")?.status).toBe("pending");

    await repo.decideApproval(client, String(email.id), "approved", "ok");
    expect(request.status).toBe("awaiting_action_approval");
  });
});

describe("every path to delivered passes the delivery checks", () => {
  const PACK = { summary: "p", deliverables: ["x"], attachments: [] as string[], actionsTaken: [] as string[], exceptions: [] as string[], unresolvedDecisions: [] as string[], nextStep: "" };
  const BRIEF = { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" };
  const RAISE = { description: "Draft the brief, then send to the client list and post on linkedin." };

  it("in-memory store: a reopened, raised request cannot be walked to delivered on its old package", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const id = (await store.createRequest(founder, BRIEF)).request.id;
    for (const a of store.getRequestBundle(founder, id).approvals) store.decideApproval(founder, a.id, "approved", "ok");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "" });
    store.deliverRequest(manager, id, PACK);
    store.transitionRequest(manager, id, "in_progress");
    store.updateRequestScope(manager, id, RAISE);
    const plan = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "execution_plan" && a.status === "pending")!;
    store.decideApproval(founder, plan.id, "approved", "ok");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.transitionRequest(manager, id, "ready_to_deliver");
    expect(() => store.transitionRequest(manager, id, "delivered")).toThrow(/QA must pass|Outbound action/);
    expect(store.getRequest(founder, id).status).toBe("ready_to_deliver");
  });

  it("Supabase workspace: a reopened, raised request cannot be walked to delivered on its old package", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, BRIEF);
    const id = String(db.tables.requests[0].id);
    for (const a of db.tables.approvals.filter((x) => x.status === "pending")) await repo.decideApproval(client, String(a.id), "approved", "ok");
    await repo.transitionRequest(manager, id, "in_progress");
    await repo.transitionRequest(manager, id, "qa");
    await repo.createQaReview(manager, id, { passed: true, score: 90, notes: "" });
    await repo.deliverRequest(manager, id, PACK);
    await repo.transitionRequest(manager, id, "in_progress");
    await repo.updateRequestScope(manager, id, RAISE);
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan" && a.status === "pending")!;
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    await repo.transitionRequest(manager, id, "in_progress");
    await repo.transitionRequest(manager, id, "qa");
    await repo.transitionRequest(manager, id, "ready_to_deliver");
    await expect(repo.transitionRequest(manager, id, "delivered")).rejects.toThrow(/QA must pass|Outbound action/);
    expect(db.tables.requests[0].status).toBe("ready_to_deliver");
  });
});

describe("a decision records the class the customer was shown", () => {
  it("in-memory store: approving a plan requested before a raise does not approve the raised work", async () => {
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
    const shown = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "execution_plan")!;
    expect(shown).toMatchObject({ status: "pending", actionClass: "prepare_only" });

    store.updateRequestScope(manager, id, { description: "Draft the brief, then wire the $40k deposit from the operating bank account." });
    // The customer submits the approval they opened before the raise.
    store.decideApproval(founder, shown.id, "approved", "ok");

    const bundle = store.getRequestBundle(founder, id);
    expect(bundle.approvals.find((a) => a.id === shown.id)).toMatchObject({ status: "approved", actionClass: "prepare_only" });
    expect(bundle.approvals.some((a) => a.kind === "execution_plan" && a.status === "pending" && a.actionClass === "sensitive_execution")).toBe(true);
    expect(bundle.request.status).toBe("awaiting_plan_approval");
    expect(() => store.transitionRequest(manager, id, "queued")).toThrow(/must be approved/);
  });

  it("Supabase workspace: a raise between reading and deciding an approval fails the decision", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" });
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    // Simulate a concurrent change to the row after decideApproval has read it.
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const builder = from(table);
      if (table === "approvals") {
        const update = builder.update.bind(builder);
        builder.update = (patch: Record<string, unknown>) => {
          if ("decided_at" in patch) {
            // Replace the row, as a real database would return a copy to the reader.
            const rows = db.tables.approvals;
            rows[rows.indexOf(plan)] = { ...plan, action_class: "sensitive_execution" };
          }
          return update(patch);
        };
      }
      return builder;
    };
    await expect(repo.decideApproval(client, String(plan.id), "approved", "ok")).rejects.toThrow(/changed before it was decided/);
    expect(db.tables.approvals.find((a) => a.id === plan.id)).toMatchObject({ status: "pending", action_class: "sensitive_execution" });
  });
});

describe("approvals requested before a raise do not hold or undo the raised request", () => {
  const RESEARCH = { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" };
  const WIRE = { description: "Draft the brief, then wire the $40k deposit from the operating bank account." };

  it("in-memory store: a stale plan approval neither holds nor cancels the re-approved request", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const id = (await store.createRequest(founder, RESEARCH)).request.id;
    const stale = store.getRequestBundle(founder, id).approvals.find((a) => a.kind === "execution_plan")!;
    store.updateRequestScope(manager, id, WIRE);
    for (const a of store.getRequestBundle(founder, id).approvals.filter((x) => x.status === "pending" && x.actionClass === "sensitive_execution")) {
      store.decideApproval(founder, a.id, "approved", "ok");
    }
    // Plan and sensitive action approved at the raised class: work may start.
    const approvedStatus = store.getRequest(founder, id).status;
    expect(["queued", "in_progress"]).toContain(approvedStatus);
    if (approvedStatus === "queued") store.transitionRequest(manager, id, "in_progress");
    expect(store.getRequest(founder, id).status).toBe("in_progress");
    // Rejecting the outdated plan approval is recorded and changes nothing else.
    store.decideApproval(founder, stale.id, "rejected", "outdated");
    expect(store.getRequest(founder, id).status).toBe("in_progress");
    expect(store.data.approvals.find((a) => a.id === stale.id)?.status).toBe("rejected");
  });

  it("Supabase workspace: a stale plan approval neither holds nor cancels the re-approved request", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const ORG = "11111111-1111-4111-8111-111111111111";
    const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
    const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, RESEARCH);
    const id = String(db.tables.requests[0].id);
    const stale = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    await repo.updateRequestScope(manager, id, WIRE);
    for (const a of db.tables.approvals.filter((x) => x.status === "pending" && x.action_class === "sensitive_execution")) {
      await repo.decideApproval(client, String(a.id), "approved", "ok");
    }
    expect(db.tables.requests[0].status).toBe("queued");
    await repo.decideApproval(client, String(stale.id), "rejected", "outdated");
    expect(db.tables.requests[0].status).toBe("queued");
    await expect(repo.transitionRequest(manager, id, "in_progress")).resolves.toBeTruthy();
  });

  it("reuses a pending outbound approval that already covers a legacy request", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const id = (await store.createRequest(founder, { ...RESEARCH, externalCommunication: true })).request.id;
    // A row written before this change: low_risk_execution with external communication.
    const req = store.data.requests.find((r) => r.id === id)!;
    req.approvalLevel = "low_risk_execution";
    for (const a of store.data.approvals.filter((x) => x.requestId === id)) a.actionClass = "low_risk_execution";
    const plan = store.data.approvals.find((a) => a.requestId === id && a.kind === "execution_plan")!;
    store.decideApproval(founder, plan.id, "approved", "ok");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "" });
    expect(store.data.approvals.filter((a) => a.requestId === id && a.kind === "external_email" && a.status === "pending")).toHaveLength(1);
  });

  it("keeps a QA pass when the plan is re-approved at the same class", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    const manager = store.actorFromUser("usr_manager")!;
    const id = (await store.createRequest(founder, RESEARCH)).request.id;
    for (const a of store.getRequestBundle(founder, id).approvals) store.decideApproval(founder, a.id, "approved", "ok");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.createQaReview(manager, id, { passed: true, score: 90, notes: "" });
    // Order the events explicitly: first plan decision, then QA, then the re-approval (now).
    store.data.approvals.find((a) => a.requestId === id && a.kind === "execution_plan")!.decidedAt = "2001-01-01T00:00:00.000Z";
    store.data.qaReviews.find((q) => q.requestId === id)!.createdAt = "2002-01-01T00:00:00.000Z";
    const again = store.createApproval(manager, id, "prepare_only", "Confirm the plan again", "execution_plan");
    store.decideApproval(founder, again.id, "approved", "ok");
    store.transitionRequest(manager, id, "in_progress");
    store.transitionRequest(manager, id, "qa");
    store.transitionRequest(manager, id, "ready_to_deliver");
    expect(() => store.deliverRequest(manager, id, { summary: "p", deliverables: ["x"], attachments: [], actionsTaken: [], exceptions: [], unresolvedDecisions: [], nextStep: "" })).not.toThrow();
  });
});

describe("Supabase workspace: a raise that lands mid-action is not overwritten", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
  const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
  const OUT = { ...FUNDS_TRANSFER, title: "Client update", objective: "Update the client", description: "Prepare the weekly status summary and send to the client contacts list.", deliverable: "Update" };
  const WIRE = { description: "Prepare the weekly status summary, send to the client contacts, and wire the deposit from the operating bank account." };

  async function setup(input = OUT) {
    vi.stubEnv("XAI_API_KEY", "");
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, input);
    const req = db.tables.requests[0];
    return { repo, req, id: String(req.id) };
  }

  /** Run `raise` to completion just before the next requests update that sets `status` executes. */
  function raiseBeforeStatusWrite(status: string, raise: () => Promise<unknown>) {
    const from = db.from.bind(db);
    let fired = false;
    db.from = (table: string) => {
      const builder = from(table);
      if (table !== "requests") return builder;
      const update = builder.update.bind(builder);
      builder.update = (patch: Record<string, unknown>) => {
        const query = update(patch);
        if (!fired && patch.status === status) {
          fired = true;
          const then = query.then.bind(query);
          query.then = ((ok, bad) => raise().then(() => then(ok, bad), bad)) as typeof query.then;
        }
        return query;
      };
      return builder;
    };
  }

  it("transitionRequest does not start work after a concurrent raise", async () => {
    const { repo, req, id } = await setup();
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    expect(req.status).toBe("queued");
    raiseBeforeStatusWrite("in_progress", () => repo.updateRequestScope(manager, id, WIRE));
    await expect(repo.transitionRequest(manager, id, "in_progress")).rejects.toThrow(/changed while this action ran/);
    expect(req).toMatchObject({ approval_level: "sensitive_execution", status: "awaiting_plan_approval" });
  });

  it("decideApproval does not resume work after a concurrent raise", async () => {
    const { repo, req, id } = await setup();
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    Object.assign(req, { status: "awaiting_action_approval", assigned_operator_id: "44444444-4444-4444-8444-444444444444" });
    const email = db.tables.approvals.find((a) => a.kind === "external_email" && a.status === "pending")!;
    raiseBeforeStatusWrite("in_progress", () => repo.updateRequestScope(manager, id, WIRE));
    await expect(repo.decideApproval(client, String(email.id), "approved", "ok")).rejects.toThrow(/changed while this action ran/);
    expect(req.status).not.toBe("in_progress");
  });

  it("assignOperator does not overwrite a concurrent raise", async () => {
    const { repo, req, id } = await setup();
    db.tables.operators = [{ id: "44444444-4444-4444-8444-444444444444", organization_id: ORG }];
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    expect(req.status).toBe("queued");
    raiseBeforeStatusWrite("assigned", () => repo.updateRequestScope(manager, id, WIRE));
    await expect(repo.assignOperator(manager, id, "44444444-4444-4444-8444-444444444444")).rejects.toThrow(/changed while this action ran/);
    expect(req).toMatchObject({ approval_level: "sensitive_execution", status: "awaiting_plan_approval" });
  });

  it("answerClarification does not overwrite a concurrent raise, and a retry asks at the raised class", async () => {
    const { repo, req, id } = await setup({ ...OUT, description: "Short.", deliverable: "" });
    expect(req.status).toBe("needs_clarification");
    const questions = [...db.tables.clarifications];
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions.slice(0, -1)) await repo.answerClarification(client, String(q.id), "Answered");
    raiseBeforeStatusWrite("awaiting_plan_approval", () => repo.updateRequestScope(manager, id, WIRE));
    // Answering the last question races the raise and fails instead of overwriting it.
    await expect(repo.answerClarification(client, String(questions.at(-1)!.id), "Answered")).rejects.toThrow(/changed while this action ran/);
    expect(req).toMatchObject({ approval_level: "sensitive_execution", status: "needs_clarification" });
    expect(db.tables.approvals.some((a) => a.kind === "execution_plan" && a.action_class !== "sensitive_execution")).toBe(false);
    // Retrying the answer puts the plan to the customer at the raised class.
    await repo.answerClarification(client, String(questions.at(-1)!.id), "Answered");
    expect(req.status).toBe("awaiting_plan_approval");
    expect(db.tables.approvals.find((a) => a.kind === "execution_plan")).toMatchObject({ status: "pending", action_class: "sensitive_execution" });
  });
});

describe("Supabase workspace: a raise passes the requests table triggers", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
  const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
  const BRIEF = { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" };

  /**
   * Emulate the BEFORE UPDATE triggers on public.requests
   * (enforce_sensitive_approval, enforce_external_delivery): an update whose
   * resulting row is in_progress at sensitive_execution, or delivered as
   * outbound work, is rejected without the matching approved approval.
   */
  function emulateRequestTriggers() {
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const builder = from(table);
      if (table !== "requests") return builder;
      const update = builder.update.bind(builder);
      builder.update = (patch: Record<string, unknown>) => {
        const query = update(patch);
        const then = query.then.bind(query);
        query.then = ((ok, bad) => {
          const row = { ...db.tables.requests[0], ...patch };
          const approved = (test: (a: Record<string, unknown>) => boolean) =>
            db.tables.approvals.some((a) => a.request_id === row.id && a.status === "approved" && test(a));
          const sensitive =
            row.status === "in_progress" && row.approval_level === "sensitive_execution" &&
            !approved((a) => a.kind === "sensitive_action" || a.action_class === "sensitive_execution");
          const outbound =
            row.status === "delivered" && (row.approval_level === "external_execution" || row.external_communication === true) &&
            !approved((a) => a.kind === "external_email");
          if (sensitive || outbound) {
            return Promise.resolve({ data: null, error: { message: sensitive ? "Sensitive execution cannot proceed" : "Outbound action requires approval" } }).then(ok, bad);
          }
          return then(ok, bad);
        }) as typeof query.then;
        return query;
      };
      return builder;
    };
  }

  async function started() {
    vi.stubEnv("XAI_API_KEY", "");
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, BRIEF);
    const id = String(db.tables.requests[0].id);
    for (const a of db.tables.approvals.filter((x) => x.status === "pending")) await repo.decideApproval(client, String(a.id), "approved", "ok");
    await repo.transitionRequest(manager, id, "in_progress");
    emulateRequestTriggers();
    return { repo, id, req: db.tables.requests[0] };
  }

  it("raises in-progress work to sensitive without tripping the sensitive trigger", async () => {
    const { repo, id, req } = await started();
    await repo.updateRequestScope(manager, id, { description: "Draft the brief, then wire the $40k deposit from the operating bank account." });
    expect(req).toMatchObject({ status: "awaiting_plan_approval", approval_level: "sensitive_execution" });
  });

  it("raises delivered work to external without tripping the delivery trigger", async () => {
    const { repo, id, req } = await started();
    await repo.transitionRequest(manager, id, "qa");
    await repo.createQaReview(manager, id, { passed: true, score: 90, notes: "" });
    await repo.deliverRequest(manager, id, { summary: "p", deliverables: ["x"], attachments: [], actionsTaken: [], exceptions: [], unresolvedDecisions: [], nextStep: "" });
    expect(req.status).toBe("delivered");
    await repo.updateRequestScope(manager, id, { description: "Draft the brief, then send to the client list." });
    expect(req).toMatchObject({ status: "awaiting_plan_approval", approval_level: "external_execution" });
  });
});

describe("only an explicit approve or reject decides an approval", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
  const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
  const BRIEF = { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" };
  // What a form or caller can send that is not an explicit decision.
  const NOT_DECISIONS: unknown[] = ["pending", "", "APPROVED", "approve", undefined, null];

  function memory() {
    vi.stubEnv("XAI_API_KEY", "");
    const store = new MemoryStore(seedData());
    return { store, founder: store.actorFromUser("usr_founder")!, manager: store.actorFromUser("usr_manager")! };
  }

  async function supabase(input: typeof FUNDS_TRANSFER) {
    vi.stubEnv("XAI_API_KEY", "");
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, input);
    return { repo, req: db.tables.requests[0], id: String(db.tables.requests[0].id) };
  }

  it("in-memory store: a plan decision that is not approved or rejected neither queues nor records", async () => {
    const { store, founder } = memory();
    const id = (await store.createRequest(founder, BRIEF)).request.id;
    const plan = store.data.approvals.find((a) => a.requestId === id && a.kind === "execution_plan")!;
    expect(store.getRequest(founder, id).status).toBe("awaiting_plan_approval");
    for (const decision of NOT_DECISIONS) {
      expect(() => store.decideApproval(founder, plan.id, decision as never, "x")).toThrow(DomainError);
      expect(plan).toMatchObject({ status: "pending", decidedBy: null, decidedAt: null });
      expect(store.getRequest(founder, id).status).toBe("awaiting_plan_approval");
    }
    expect(store.data.audits.some((e) => e.entityId === plan.id && e.action === "approval.decided")).toBe(false);
    store.decideApproval(founder, plan.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).toBe("queued");
  });

  it("in-memory store: a sensitive decision that is not approved does not start sensitive work", async () => {
    const { store, founder, manager } = memory();
    const id = (await store.createRequest(founder, FUNDS_TRANSFER)).request.id;
    const plan = store.data.approvals.find((a) => a.requestId === id && a.kind === "execution_plan")!;
    store.decideApproval(founder, plan.id, "approved", "ok");
    store.data.requests.find((r) => r.id === id)!.assignedOperatorId = store.data.operators[0].id;
    expect(() => store.transitionRequest(manager, id, "in_progress")).toThrow(/Sensitive execution/);
    expect(store.getRequest(founder, id).status).toBe("awaiting_action_approval");
    const sensitive = store.data.approvals.find((a) => a.requestId === id && a.kind === "sensitive_action" && a.status === "pending")!;
    for (const decision of NOT_DECISIONS) {
      expect(() => store.decideApproval(founder, sensitive.id, decision as never, "x")).toThrow(DomainError);
      expect(sensitive.status).toBe("pending");
      expect(store.getRequest(founder, id).status).toBe("awaiting_action_approval");
    }
    store.decideApproval(founder, sensitive.id, "approved", "ok");
    expect(store.getRequest(founder, id).status).toBe("in_progress");
  });

  it("Supabase workspace: a plan decision that is not approved or rejected neither queues nor records", async () => {
    const { repo, req } = await supabase(BRIEF);
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    expect(req.status).toBe("awaiting_plan_approval");
    for (const decision of NOT_DECISIONS) {
      await expect(repo.decideApproval(client, String(plan.id), decision as never, "x")).rejects.toThrow(DomainError);
      expect(plan.status).toBe("pending");
      expect(plan.decided_at ?? null).toBeNull();
      expect(req.status).toBe("awaiting_plan_approval");
    }
    expect((db.tables.audit_events ?? []).some((e) => e.entity_id === plan.id && e.action === "approval.decided")).toBe(false);
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    expect(req.status).toBe("queued");
  });

  it("Supabase workspace: a sensitive decision that is not approved does not start sensitive work", async () => {
    const { repo, req, id } = await supabase(FUNDS_TRANSFER);
    const plan = db.tables.approvals.find((a) => a.kind === "execution_plan")!;
    await repo.decideApproval(client, String(plan.id), "approved", "ok");
    req.assigned_operator_id = "44444444-4444-4444-8444-444444444444";
    await expect(repo.transitionRequest(manager, id, "in_progress")).rejects.toThrow(/Sensitive execution/);
    Object.assign(req, { status: "awaiting_action_approval" });
    const sensitive = db.tables.approvals.find((a) => a.kind === "sensitive_action" && a.status === "pending")!;
    for (const decision of NOT_DECISIONS) {
      await expect(repo.decideApproval(client, String(sensitive.id), decision as never, "x")).rejects.toThrow(DomainError);
      expect(sensitive.status).toBe("pending");
      expect(req.status).toBe("awaiting_action_approval");
    }
    await repo.decideApproval(client, String(sensitive.id), "approved", "ok");
    expect(req.status).toBe("in_progress");
  });
});

// request-authority-gates.test.ts covers the gate helpers' own reads. These
// cover the other reads and writes that a raise and an approval request depend on.
describe("Supabase workspace: a failed read or write on the raise path stops it", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
  const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
  const BRIEF = { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" };
  const TO_CLIENTS = { description: "Draft the brief, then send to the client list." };

  async function created() {
    vi.stubEnv("XAI_API_KEY", "");
    db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
    const repo = new SupabaseWorkspaceRepository();
    await repo.createRequest(client, BRIEF);
    return { repo, req: db.tables.requests[0], id: String(db.tables.requests[0].id) };
  }

  async function queued() {
    const setup = await created();
    for (const a of db.tables.approvals.filter((x) => x.status === "pending")) await setup.repo.decideApproval(client, String(a.id), "approved", "ok");
    expect(setup.req.status).toBe("queued");
    return setup;
  }

  it("refuses the scope edit when it cannot read whether the request had a plan approval", async () => {
    const { repo, req, id } = await queued();
    db.failReads = (table, columns) => table === "approvals" && columns === "id";
    await expect(repo.updateRequestScope(manager, id, TO_CLIENTS)).rejects.toThrow(/read of approvals failed/);
    expect(req).toMatchObject({ approval_level: "prepare_only", status: "queued", description: BRIEF.description });
  });

  it.each([
    ["the plan cannot be read", () => { db.failReads = (table, columns) => table === "execution_plans" && columns === "*"; }],
    ["the plan cannot be rebound to the raised class", () => { db.failUpdates = (table) => table === "execution_plans"; }],
    ["the steps cannot be read", () => { db.failReads = (table, columns) => table === "request_steps" && columns === "*"; }],
    [
      "a step cannot be re-routed to an operator",
      () => {
        // A step the raise must take from an unsupervised executor.
        db.tables.request_steps[0].owner = "ai";
        db.failUpdates = (table) => table === "request_steps";
      },
    ],
  ])("requests no approval of the raised work when %s", async (_, fail) => {
    const { repo, req, id } = await queued();
    fail();
    await expect(repo.updateRequestScope(manager, id, TO_CLIENTS)).rejects.toThrow(/failed/);
    // The raise is written and holds the request; nothing is put to the
    // customer, so no plan is approved while it still shows the lower class.
    expect(req).toMatchObject({ approval_level: "external_execution", status: "awaiting_plan_approval" });
    expect(db.tables.approvals.filter((a) => a.status === "pending")).toHaveLength(0);
    db.failReads = null;
    db.failUpdates = null;
    await expect(repo.transitionRequest(manager, id, "queued")).rejects.toThrow(/must be approved/);
  });

  it("does not request a duplicate approval when the pending approvals cannot be read", async () => {
    const { repo, id } = await created();
    const count = db.tables.approvals.length;
    db.failReads = (table, columns) => table === "approvals" && columns === "*";
    await expect(repo.createApproval(manager, id, "prepare_only", "Confirm the plan", "execution_plan")).rejects.toThrow(/read of approvals failed/);
    expect(db.tables.approvals).toHaveLength(count);
  });
});

// Each test isolates one gate that no other test holds on its own: every other
// check the action passes is satisfied, so the test fails if that gate alone
// is removed.
describe("plan-approval holds and the delivery package, each on its own", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const client: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
  const manager: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };
  const BRIEF = { ...FUNDS_TRANSFER, title: "Research brief", objective: "Prepare the draft", description: "Draft a research brief comparing three vendors with pricing details.", deliverable: "Draft" };

  describe("in-memory store", () => {
    async function created() {
      vi.stubEnv("XAI_API_KEY", "");
      const store = new MemoryStore(seedData());
      const founder = store.actorFromUser("usr_founder")!;
      const ops = store.actorFromUser("usr_manager")!;
      const id = (await store.createRequest(founder, BRIEF)).request.id;
      return { store, founder, ops, id, req: store.data.requests.find((r) => r.id === id)! };
    }

    it("a plan approval given below the request's class holds the start", async () => {
      const { store, founder, ops, id, req } = await created();
      for (const a of store.getRequestBundle(founder, id).approvals) store.decideApproval(founder, a.id, "approved", "ok");
      expect(req.status).toBe("queued");
      // A raise whose re-approvals were never written: only the lower-class plan approval exists.
      req.approvalLevel = "external_execution";
      expect(() => store.transitionRequest(ops, id, "in_progress")).toThrow(/plan must be approved/);
      expect(req.status).toBe("queued");
    });

    it("a request awaiting plan approval with no plan approval on record is not queued", async () => {
      const { store, ops, id, req } = await created();
      store.data.approvals = store.data.approvals.filter((a) => a.requestId !== id);
      expect(req.status).toBe("awaiting_plan_approval");
      expect(() => store.transitionRequest(ops, id, "queued")).toThrow(/must be approved before the request enters the queue/);
    });
  });

  describe("Supabase workspace", () => {
    async function created() {
      vi.stubEnv("XAI_API_KEY", "");
      db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
      const repo = new SupabaseWorkspaceRepository();
      await repo.createRequest(client, BRIEF);
      return { repo, req: db.tables.requests[0], id: String(db.tables.requests[0].id) };
    }

    async function queued() {
      const setup = await created();
      for (const a of db.tables.approvals.filter((x) => x.status === "pending")) await setup.repo.decideApproval(client, String(a.id), "approved", "ok");
      expect(setup.req.status).toBe("queued");
      return setup;
    }

    it("a plan approval given below the request's class holds the start", async () => {
      const { repo, req, id } = await queued();
      req.approval_level = "external_execution";
      await expect(repo.transitionRequest(manager, id, "in_progress")).rejects.toThrow(/plan must be approved/);
      expect(req.status).toBe("queued");
    });

    it("a pending plan approval at the request's class holds the start beside an approved one", async () => {
      const { repo, req, id } = await queued();
      await repo.createApproval(manager, id, "prepare_only", "Confirm the plan again", "execution_plan");
      // An in-flight row that still holds the undecided re-approval.
      req.status = "queued";
      await expect(repo.transitionRequest(manager, id, "in_progress")).rejects.toThrow(/plan must be approved/);
      expect(req.status).toBe("queued");
    });

    it("a request awaiting plan approval with no plan approval on record is not queued", async () => {
      const { repo, req, id } = await created();
      db.tables.approvals = [];
      expect(req.status).toBe("awaiting_plan_approval");
      await expect(repo.transitionRequest(manager, id, "queued")).rejects.toThrow(/must be approved before the request enters the queue/);
    });

    it("the delivered transition needs a recorded delivery package", async () => {
      const { repo, req, id } = await queued();
      await repo.transitionRequest(manager, id, "in_progress");
      await repo.transitionRequest(manager, id, "qa");
      await repo.createQaReview(manager, id, { passed: true, score: 90, notes: "" });
      expect(req.status).toBe("ready_to_deliver");
      await expect(repo.transitionRequest(manager, id, "delivered")).rejects.toThrow(/delivery package/);
      expect(req.status).toBe("ready_to_deliver");
    });
  });
});
