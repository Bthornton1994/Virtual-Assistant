import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionClass, Actor, ApprovalKind, RequestStatus } from "@/lib/domain";
import { createFakeDb, type FakeDb } from "./fake-supabase";

let db: FakeDb;
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => db }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: () => null }));

import { SupabaseWorkspaceRepository } from "@/lib/data/supabase-workspace";
import { MemoryStore, seedData } from "@/lib/store";

// Each test here holds one request-authority gate: it fails when that gate is
// removed. `npm run proof:request-authority` removes each gate in turn and
// checks that a test notices.

type RequestInput = Parameters<MemoryStore["createRequest"]>[1];
type ApprovalRow = { id: string; kind: string; status: string; actionClass: string | null; decidedAt: string | null };
type ScopePatch = { objective?: string; description?: string; deliverable?: string };

const BASE = { dueAt: null, workstreamId: null, recurring: false, externalCommunication: false };
// prepare_only: plan approval only.
const BRIEF: RequestInput = {
  ...BASE,
  title: "Research brief",
  objective: "Prepare the draft",
  description: "Draft a research brief comparing three vendors with pricing details.",
  deliverable: "Draft",
};
// external_execution: plan and outbound approvals.
const CUSTOMER_UPDATE: RequestInput = {
  ...BASE,
  title: "Customer update",
  objective: "Tell the customer about the new release",
  description: "Prepare the customer update on the new release with the key changes and dates.",
  deliverable: "Customer update",
  externalCommunication: true,
};
// sensitive_execution: plan and sensitive approvals.
const WIRE: RequestInput = {
  ...BASE,
  title: "Wire the vendor",
  objective: "Pay the research vendor",
  description: "Transfer funds to the research vendor today from the operating account.",
  deliverable: "Payment confirmation",
};
// sensitive_execution with outbound communication: plan, outbound and sensitive approvals.
const PAY_AND_NOTIFY: RequestInput = {
  ...BASE,
  title: "Vendor payment notice",
  objective: "Pay the vendor and tell them",
  description: "Transfer funds to the vendor and send them the remittance advice by email.",
  deliverable: "Remittance advice",
  externalCommunication: true,
};
const PACK = { summary: "Done.", deliverables: ["Pack"], attachments: [], actionsTaken: [], exceptions: [], unresolvedDecisions: [], nextStep: "" };
const LONG_AGO = "2000-01-01T00:00:00.000Z";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT: Actor = { id: "22222222-2222-4222-8222-222222222222", email: "o@example.com", name: "O", role: "client_admin", organizationId: ORG, operatorId: null, source: "supabase" };
const MANAGER: Actor = { id: "33333333-3333-4333-8333-333333333333", email: "p@example.com", name: "P", role: "ops_manager", organizationId: ORG, operatorId: null, source: "supabase" };

/** The operations each test needs, over either store, with the customer deciding and ops running the queue. */
type Stores = {
  create(input: RequestInput): Promise<string>;
  approvals(id: string): ApprovalRow[];
  /** Overwrite stored approval fields, as a legacy row or a concurrent writer would. */
  patchApproval(approvalId: string, patch: Partial<Pick<ApprovalRow, "status" | "actionClass" | "decidedAt">>): void;
  decide(approvalId: string, decision: "approved" | "rejected"): Promise<unknown>;
  requestApproval(id: string, kind: ApprovalKind): Promise<unknown>;
  move(id: string, to: RequestStatus, as?: "client"): Promise<unknown>;
  passQa(id: string): Promise<unknown>;
  setQaCreatedAt(id: string, iso: string): void;
  clearQa(id: string): void;
  deliver(id: string): Promise<unknown>;
  deliveries(id: string): number;
  editScope(id: string, patch: ScopePatch): Promise<unknown>;
  request(id: string): { status: string; approvalLevel: string; riskLevel: string };
  setStatus(id: string, status: RequestStatus): void;
};

function memoryStores(): Stores {
  const store = new MemoryStore(seedData());
  const founder = store.actorFromUser("usr_founder")!;
  const manager = store.actorFromUser("usr_manager")!;
  const request = (id: string) => store.data.requests.find((r) => r.id === id)!;
  return {
    create: async (input) => (await store.createRequest(founder, input)).request.id,
    approvals: (id) =>
      store.data.approvals
        .filter((a) => a.requestId === id)
        .map((a) => ({ id: a.id, kind: a.kind, status: a.status, actionClass: a.actionClass, decidedAt: a.decidedAt })),
    patchApproval: (approvalId, patch) => Object.assign(store.data.approvals.find((a) => a.id === approvalId)!, patch),
    decide: async (approvalId, decision) => store.decideApproval(founder, approvalId, decision, "ok"),
    requestApproval: async (id, kind) => store.createApproval(manager, id, request(id).approvalLevel, "Confirm again", kind),
    move: async (id, to, as) => store.transitionRequest(as === "client" ? founder : manager, id, to),
    passQa: async (id) => store.createQaReview(manager, id, { passed: true, score: 90, notes: "" }),
    setQaCreatedAt: (id, iso) => store.data.qaReviews.filter((q) => q.requestId === id).forEach((q) => (q.createdAt = iso)),
    clearQa: (id) => {
      store.data.qaReviews = store.data.qaReviews.filter((q) => q.requestId !== id);
    },
    deliver: async (id) => store.deliverRequest(manager, id, PACK),
    deliveries: (id) => store.data.deliveries.filter((d) => d.requestId === id).length,
    editScope: async (id, patch) => store.updateRequestScope(manager, id, patch),
    request,
    setStatus: (id, status) => {
      request(id).status = status;
    },
  };
}

function supabaseStores(): Stores {
  db = createFakeDb({ workstreams: [{ id: "ws1", organization_id: ORG, template_id: null, name: "B", status: "active", created_at: "", updated_at: "" }] });
  const repo = new SupabaseWorkspaceRepository();
  const row = (id: string) => db.tables.requests.find((r) => r.id === id)!;
  const rows = (table: string, id: string) => (db.tables[table] ?? []).filter((r) => r.request_id === id);
  return {
    create: async (input) => {
      await repo.createRequest(CLIENT, input);
      return String(db.tables.requests.at(-1)!.id);
    },
    approvals: (id) =>
      rows("approvals", id).map((a) => ({
        id: String(a.id),
        kind: String(a.kind),
        status: String(a.status),
        actionClass: (a.action_class ?? null) as string | null,
        decidedAt: (a.decided_at ?? null) as string | null,
      })),
    patchApproval: (approvalId, patch) => {
      const approval = db.tables.approvals.find((a) => a.id === approvalId)!;
      if (patch.status !== undefined) approval.status = patch.status;
      if (patch.actionClass !== undefined) approval.action_class = patch.actionClass;
      if (patch.decidedAt !== undefined) approval.decided_at = patch.decidedAt;
    },
    decide: (approvalId, decision) => repo.decideApproval(CLIENT, approvalId, decision, "ok"),
    requestApproval: (id, kind) => repo.createApproval(MANAGER, id, row(id).approval_level as ActionClass, "Confirm again", kind),
    move: (id, to, as) => repo.transitionRequest(as === "client" ? CLIENT : MANAGER, id, to),
    passQa: (id) => repo.createQaReview(MANAGER, id, { passed: true, score: 90, notes: "" }),
    setQaCreatedAt: (id, iso) => rows("qa_reviews", id).forEach((q) => (q.created_at = iso)),
    clearQa: (id) => {
      db.tables.qa_reviews = (db.tables.qa_reviews ?? []).filter((q) => q.request_id !== id);
    },
    deliver: (id) => repo.deliverRequest(MANAGER, id, PACK),
    deliveries: (id) => rows("deliveries", id).length,
    editScope: (id, patch) => repo.updateRequestScope(MANAGER, id, patch),
    request: (id) => ({ status: String(row(id).status), approvalLevel: String(row(id).approval_level), riskLevel: String(row(id).risk_level) }),
    setStatus: (id, status) => {
      row(id).status = status;
    },
  };
}

const STORES = [
  ["in-memory store", memoryStores],
  ["Supabase workspace", supabaseStores],
] as const;

beforeEach(() => {
  vi.stubEnv("XAI_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function approval(s: Stores, id: string, kind: ApprovalKind) {
  return s.approvals(id).find((a) => a.kind === kind)!;
}

async function approveAll(s: Stores, id: string) {
  for (const a of s.approvals(id).filter((x) => x.status === "pending")) await s.decide(a.id, "approved");
}

/** Approve everything, do the work, pass QA: every delivery check holds. */
async function readyToDeliver(s: Stores, input: RequestInput) {
  const id = await s.create(input);
  await approveAll(s, id);
  if (s.request(id).status !== "in_progress") await s.move(id, "in_progress");
  await s.move(id, "qa");
  await s.passQa(id);
  expect(s.request(id).status).toBe("ready_to_deliver");
  return id;
}

/** Put a decided approval back to pending, as if it had never been decided. */
function undecide(s: Stores, id: string, kind: ApprovalKind) {
  for (const a of s.approvals(id).filter((x) => x.kind === kind)) s.patchApproval(a.id, { status: "pending", decidedAt: null });
}

// RR119-P1-A. Each check is broken alone, with every other check satisfied,
// so removing that one check lets delivery through.
const DELIVERY_CHECKS = [
  { check: "a current QA pass", error: /QA must pass before delivery/, undo: (s: Stores, id: string) => s.clearQa(id) },
  {
    check: "the plan approved at the current class",
    error: /execution plan must be approved at the request's current authority before delivery/,
    undo: (s: Stores, id: string) => undecide(s, id, "execution_plan"),
  },
  {
    check: "a covering outbound approval",
    error: /Outbound action requires customer approval before delivery/,
    undo: (s: Stores, id: string) => undecide(s, id, "external_email"),
  },
  {
    check: "a covering sensitive approval",
    error: /Sensitive action requires customer approval before delivery/,
    undo: (s: Stores, id: string) => undecide(s, id, "sensitive_action"),
  },
];

describe.each(STORES)("%s: each delivery check refuses on its own", (_label, make) => {
  it("delivers sensitive outbound work when every check passes, by package and after a reopen", async () => {
    const s = make();
    const id = await readyToDeliver(s, PAY_AND_NOTIFY);
    await s.deliver(id);
    expect(s.request(id).status).toBe("delivered");
    await s.move(id, "in_progress");
    await s.move(id, "qa");
    await s.move(id, "ready_to_deliver");
    await s.move(id, "delivered");
    expect(s.request(id).status).toBe("delivered");
  });

  it.each(DELIVERY_CHECKS)("deliverRequest refuses without $check", async ({ error, undo }) => {
    const s = make();
    const id = await readyToDeliver(s, PAY_AND_NOTIFY);
    undo(s, id);
    await expect(s.deliver(id)).rejects.toThrow(error);
    expect(s.request(id).status).toBe("ready_to_deliver");
    expect(s.deliveries(id)).toBe(0);
  });

  it.each(DELIVERY_CHECKS)("transitionRequest to delivered refuses without $check", async ({ error, undo }) => {
    const s = make();
    const id = await readyToDeliver(s, PAY_AND_NOTIFY);
    await s.deliver(id);
    await s.move(id, "in_progress");
    await s.move(id, "qa");
    await s.move(id, "ready_to_deliver");
    undo(s, id);
    await expect(s.move(id, "delivered")).rejects.toThrow(error);
    expect(s.request(id).status).toBe("ready_to_deliver");
  });
});

// RR119-P1-B.
describe.each(STORES)("%s: sensitive work starts only on a covering sensitive approval", (_label, make) => {
  async function queuedSensitive(s: Stores) {
    const id = await s.create(WIRE);
    await s.decide(approval(s, id, "execution_plan").id, "approved");
    expect(s.request(id)).toMatchObject({ status: "queued", approvalLevel: "sensitive_execution" });
    return id;
  }

  it("refuses to start while the sensitive approval is pending, and puts it to the customer", async () => {
    const s = make();
    const id = await queuedSensitive(s);
    expect(approval(s, id, "sensitive_action").status).toBe("pending");
    await expect(s.move(id, "in_progress")).rejects.toThrow(/Sensitive execution cannot proceed without explicit approval/);
    expect(s.request(id).status).toBe("awaiting_action_approval");
    expect(s.approvals(id).filter((a) => a.kind === "sensitive_action")).toHaveLength(1);
  });

  it("refuses to start on a sensitive approval recorded below the request's class", async () => {
    const s = make();
    const id = await queuedSensitive(s);
    // A row written before approvals were stamped at the request's class.
    s.patchApproval(approval(s, id, "sensitive_action").id, { status: "approved", actionClass: "external_execution", decidedAt: LONG_AGO });
    await expect(s.move(id, "in_progress")).rejects.toThrow(/Sensitive execution cannot proceed without explicit approval/);
    expect(s.request(id).status).not.toBe("in_progress");
  });

  it("starts once the sensitive approval covers the request", async () => {
    const s = make();
    const id = await queuedSensitive(s);
    s.patchApproval(approval(s, id, "sensitive_action").id, { status: "approved", decidedAt: LONG_AGO });
    await s.move(id, "in_progress");
    expect(s.request(id).status).toBe("in_progress");
  });

  it("does not start any work while the plan approval is outstanding", async () => {
    const s = make();
    const id = await s.create(BRIEF);
    expect(approval(s, id, "execution_plan").status).toBe("pending");
    s.setStatus(id, "queued");
    await expect(s.move(id, "in_progress")).rejects.toThrow(/before work starts/);
    expect(s.request(id).status).toBe("queued");
  });
});

// RR119-P1-C. The floor reads the objective and the deliverable on their own,
// at creation and when scope is edited.
const BENIGN: RequestInput = {
  ...BASE,
  title: "Vendor prep",
  objective: "Choose the pilot vendor",
  description: "Compare the shortlisted vendors and pick one for the pilot.",
  deliverable: "Vendor decision",
};
const WIRE_OBJECTIVE = "Wire the deposit to the chosen vendor";
const WIRE_DELIVERABLE = "Wire confirmation for the vendor deposit";

describe.each(STORES)("%s: the floor reads the objective and the deliverable", (_label, make) => {
  it("keeps a request without consequential wording below sensitive", async () => {
    const s = make();
    const id = await s.create(BENIGN);
    expect(s.request(id).approvalLevel).not.toBe("sensitive_execution");
  });

  it.each([
    ["objective", { ...BENIGN, objective: WIRE_OBJECTIVE }],
    ["deliverable", { ...BENIGN, deliverable: WIRE_DELIVERABLE }],
  ])("creates a request sensitive from wording in its %s alone", async (_field, input) => {
    const s = make();
    const id = await s.create(input);
    expect(s.request(id)).toMatchObject({ approvalLevel: "sensitive_execution", riskLevel: "critical" });
  });

  it.each([
    ["objective", { objective: WIRE_OBJECTIVE }],
    ["deliverable", { deliverable: WIRE_DELIVERABLE }],
  ])("raises a request to sensitive when only its %s is edited", async (_field, patch) => {
    const s = make();
    const id = await s.create(BENIGN);
    await s.editScope(id, patch);
    expect(s.request(id)).toMatchObject({ approvalLevel: "sensitive_execution", riskLevel: "critical" });
  });
});

// QA currency: a pass counts only if recorded no earlier than the first
// decision that approved the plan at the request's current class.
describe.each(STORES)("%s: only a current QA pass counts", (_label, make) => {
  it("does not deliver on a QA pass recorded before the plan was approved", async () => {
    const s = make();
    const id = await readyToDeliver(s, BRIEF);
    s.setQaCreatedAt(id, LONG_AGO);
    await expect(s.deliver(id)).rejects.toThrow(/QA must pass before delivery/);
    s.setQaCreatedAt(id, "2999-01-01T00:00:00.000Z");
    await s.deliver(id);
    expect(s.request(id).status).toBe("delivered");
  });

  it("does not anchor QA on a plan decision below the request's current class", async () => {
    const s = make();
    const id = await readyToDeliver(s, BRIEF);
    s.patchApproval(approval(s, id, "execution_plan").id, { decidedAt: "2001-01-01T00:00:00.000Z" });
    s.setQaCreatedAt(id, "2002-01-01T00:00:00.000Z");
    await s.editScope(id, { description: "Draft the research brief with pricing details, then send to the client list." });
    expect(s.request(id)).toMatchObject({ status: "awaiting_plan_approval", approvalLevel: "external_execution" });
    await approveAll(s, id);
    s.setStatus(id, "ready_to_deliver");
    // The only plan decision older than the QA pass was given at prepare_only.
    await expect(s.deliver(id)).rejects.toThrow(/QA must pass before delivery/);
  });

  it("keeps a QA pass when the plan is re-approved at the same class", async () => {
    const s = make();
    const id = await readyToDeliver(s, BRIEF);
    s.patchApproval(approval(s, id, "execution_plan").id, { decidedAt: "2001-01-01T00:00:00.000Z" });
    s.setQaCreatedAt(id, "2002-01-01T00:00:00.000Z");
    await s.requestApproval(id, "execution_plan");
    await approveAll(s, id);
    await s.move(id, "in_progress");
    await s.move(id, "qa");
    await s.move(id, "ready_to_deliver");
    await s.deliver(id);
    expect(s.request(id).status).toBe("delivered");
  });

  async function awaitingOutbound(s: Stores) {
    const id = await s.create(CUSTOMER_UPDATE);
    await s.decide(approval(s, id, "execution_plan").id, "approved");
    await s.move(id, "in_progress");
    await s.move(id, "qa");
    await s.passQa(id);
    expect(s.request(id).status).toBe("awaiting_action_approval");
    return id;
  }

  it("does not move work to ready_to_deliver on an outbound approval when the QA pass is stale", async () => {
    const s = make();
    const id = await awaitingOutbound(s);
    s.setQaCreatedAt(id, LONG_AGO);
    await s.decide(approval(s, id, "external_email").id, "approved");
    expect(s.request(id).status).toBe("queued");
  });

  it("moves work to ready_to_deliver on an outbound approval when the QA pass is current", async () => {
    const s = make();
    const id = await awaitingOutbound(s);
    await s.decide(approval(s, id, "external_email").id, "approved");
    expect(s.request(id).status).toBe("ready_to_deliver");
  });
});

describe.each(STORES)("%s: a decided approval cannot be decided again", (_label, make) => {
  it("refuses a second decision and keeps the first", async () => {
    const s = make();
    const id = await s.create(BRIEF);
    const plan = approval(s, id, "execution_plan");
    await s.decide(plan.id, "approved");
    expect(s.request(id).status).toBe("queued");
    await expect(s.decide(plan.id, "rejected")).rejects.toThrow(/Approval already decided/);
    expect(approval(s, id, "execution_plan").status).toBe("approved");
    expect(s.request(id).status).toBe("queued");
  });
});

describe.each(STORES)("%s: approval kinds a model adds are requested", (_label, make) => {
  it("requests a known approval kind the model adds, at the request's class", async () => {
    vi.stubEnv("XAI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const prompt = String(JSON.parse(String(init?.body)).messages[1].content);
        if (!prompt.startsWith("Approval requirements")) return new Response("", { status: 500 });
        const reply = { kinds: ["execution_plan", "crm_destructive_change"], reasons: ["It changes CRM records."], requiresCustomerDecision: true };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const s = make();
    const id = await s.create(BRIEF);
    expect(s.request(id).approvalLevel).toBe("prepare_only");
    expect(approval(s, id, "crm_destructive_change")).toMatchObject({ status: "pending", actionClass: "prepare_only" });
  });
});

// Supabase calls are not one transaction. Each conditional-write predicate is
// held by a race that changes only the value that predicate checks.
describe("Supabase workspace: each conditional-write predicate refuses a stale write", () => {
  /** Run `concurrent` to completion just before the next requests update that sets `status` executes. */
  function beforeStatusWrite(status: string, concurrent: () => Promise<unknown>) {
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
          query.then = ((ok, bad) => concurrent().then(() => then(ok, bad), bad)) as typeof query.then;
        }
        return query;
      };
      return builder;
    };
  }

  it("a request write fails when only the status changed since the gates ran", async () => {
    const s = supabaseStores();
    const id = await s.create(BRIEF);
    await s.decide(approval(s, id, "execution_plan").id, "approved");
    expect(s.request(id).status).toBe("queued");
    // The customer cancels while ops starts the work; the class does not change.
    beforeStatusWrite("in_progress", () => s.move(id, "cancelled", "client"));
    await expect(s.move(id, "in_progress")).rejects.toThrow(/changed while this action ran/);
    expect(s.request(id)).toMatchObject({ status: "cancelled", approvalLevel: "prepare_only" });
  });

  it("a request write fails when only the action class changed since the gates ran", async () => {
    const s = supabaseStores();
    const id = await s.create(BRIEF);
    // A raise lands while the customer approves the plan; the status stays at plan approval.
    beforeStatusWrite("queued", () => s.editScope(id, { description: "Draft the brief, then wire the $40k deposit from the operating bank account." }));
    await expect(s.decide(approval(s, id, "execution_plan").id, "approved")).rejects.toThrow(/changed while this action ran/);
    expect(s.request(id)).toMatchObject({ status: "awaiting_plan_approval", approvalLevel: "sensitive_execution" });
  });

  it("an approval write fails when the approval was decided since it was read", async () => {
    const s = supabaseStores();
    const id = await s.create(BRIEF);
    const plan = approval(s, id, "execution_plan");
    const from = db.from.bind(db);
    db.from = (table: string) => {
      const builder = from(table);
      if (table !== "approvals") return builder;
      const update = builder.update.bind(builder);
      builder.update = (patch: Record<string, unknown>) => {
        // Another decision lands between the read and this write.
        if ("decided_at" in patch) s.patchApproval(plan.id, { status: "rejected", decidedAt: LONG_AGO });
        return update(patch);
      };
      return builder;
    };
    await expect(s.decide(plan.id, "approved")).rejects.toThrow(/changed before it was decided/);
    expect(approval(s, id, "execution_plan")).toMatchObject({ status: "rejected", decidedAt: LONG_AGO });
  });
});

// A failed read is not an empty result. Where an empty result would pass a
// gate, reading it as one fails open.
describe("Supabase workspace: a failed gate read refuses the action", () => {
  it.each([
    ["in_progress", "queued"],
    ["queued", "triage"],
  ] as const)("does not move to %s when the plan approvals cannot be read", async (to, from) => {
    const s = supabaseStores();
    const id = await s.create(BRIEF);
    s.setStatus(id, from);
    await expect(s.move(id, to)).rejects.toThrow(/must be approved/);
    db.failReads = (table, columns) => table === "approvals" && columns === "status, action_class";
    await expect(s.move(id, to)).rejects.toThrow(/read of approvals failed/);
    expect(s.request(id).status).toBe(from);
  });

  it("does not deliver on a stale QA pass when the plan decisions cannot be read", async () => {
    const s = supabaseStores();
    const id = await readyToDeliver(s, BRIEF);
    s.setQaCreatedAt(id, LONG_AGO);
    await expect(s.deliver(id)).rejects.toThrow(/QA must pass before delivery/);
    db.failReads = (table, columns) => table === "approvals" && columns === "action_class, decided_at";
    await expect(s.deliver(id)).rejects.toThrow(/read of approvals failed/);
    expect(s.request(id).status).toBe("ready_to_deliver");
    expect(s.deliveries(id)).toBe(0);
  });

  it("reports a failed QA read as a failed read", async () => {
    const s = supabaseStores();
    const id = await readyToDeliver(s, BRIEF);
    db.failReads = (table, columns) => table === "qa_reviews" && columns === "created_at";
    await expect(s.deliver(id)).rejects.toThrow(/read of qa_reviews failed/);
    expect(s.deliveries(id)).toBe(0);
  });

  it("reports a failed approval read at the sensitive gate, and requests no approval", async () => {
    const s = supabaseStores();
    const id = await s.create(WIRE);
    await s.decide(approval(s, id, "execution_plan").id, "approved");
    s.patchApproval(approval(s, id, "sensitive_action").id, { status: "approved", decidedAt: LONG_AGO });
    db.failReads = (table, columns) => table === "approvals" && columns === "id, action_class";
    await expect(s.move(id, "in_progress")).rejects.toThrow(/read of approvals failed/);
    expect(s.request(id).status).toBe("queued");
    expect(s.approvals(id).filter((a) => a.kind === "sensitive_action")).toHaveLength(1);
  });
});
