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

  it("routes executors without calling the model", async () => {
    const { prompts } = stubModel(HOSTILE);
    const route = await delegationAI.suggestExecutor({ actionClass: "sensitive_execution", title: FUNDS_TRANSFER.title });
    expect(route).toMatchObject({ executor: "specialist", humanRequired: true });
    expect(prompts).toEqual([]);
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
