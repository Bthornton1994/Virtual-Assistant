import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError, type Actor } from "@/lib/domain";
import {
  SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION,
  SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
} from "@/lib/software-factory-run-manager";
import { TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA, TWL_PREPARE_PROOF_PR_SCHEMA } from "@/lib/twl-prepare-proof";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import {
  addEvidenceArtifact,
  runHasWorkCell,
  transitionWorkstreamRun,
  verifyWorkstreamRun,
} from "@/lib/execution-primitives";

const ORG = "org_northline";
const RUN_ID = "run_1";
const SPEC_ID = "spec_1";
const NOW = "2026-09-14T10:00:00.000Z";

function actor(partial: Partial<Actor> & Pick<Actor, "role" | "id">): Actor {
  return {
    email: `${partial.id}@delegation.cloud`,
    name: partial.id,
    organizationId: ORG,
    operatorId: `op_${partial.id}`,
    source: "supabase",
    ...partial,
  };
}

const manager = actor({ id: "usr_manager", role: "ops_manager" });
const operator = actor({ id: "usr_operator", role: "operator" });
const client = actor({ id: "usr_client", role: "client_admin" });

type QueryCall = {
  table: string;
  method: "select" | "insert" | "update" | "upsert";
  filters: Array<{ op: string; args: unknown[] }>;
  payload?: unknown;
};

function filterEq(call: QueryCall, column: string) {
  return call.filters.find((filter) => filter.op === "eq" && filter.args[0] === column)?.args[1];
}

function createDb(handler: (call: QueryCall) => { data?: unknown; error?: { message: string } | null; count?: number | null }) {
  function from(table: string) {
    const call: QueryCall = { table, method: "select", filters: [] };
    const resolve = () => {
      const result = handler(call);
      return { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null };
    };
    const builder = {
      select() {
        return builder;
      },
      insert(payload: unknown) {
        call.method = "insert";
        call.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        call.method = "update";
        call.payload = payload;
        return builder;
      },
      eq(column: string, value: unknown) {
        call.filters.push({ op: "eq", args: [column, value] });
        return builder;
      },
      in(column: string, value: unknown) {
        call.filters.push({ op: "in", args: [column, value] });
        return builder;
      },
      not(column: string, operator: string, value: unknown) {
        call.filters.push({ op: "not", args: [column, operator, value] });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      single() {
        return Promise.resolve(resolve());
      },
      then(
        onFulfilled: (value: { data: unknown; error: { message: string } | null; count: number | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  return { from };
}

function runningRow(partial: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    organization_id: ORG,
    workstream_id: "ws_1",
    request_id: null,
    delegation_spec_id: SPEC_ID,
    gauntlet_cycle_id: "cycle_1",
    status: "running",
    initiated_by: operator.id,
    executor_summary: {},
    human_minutes: 0,
    owner_minutes: 0,
    ai_cost_micros: 0,
    tool_cost_micros: 0,
    started_at: NOW,
    completed_at: null,
    notes: "",
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

const passingReceiptInput = {
  verificationStatus: "passed" as const,
  definitionOfDoneMet: true,
  summary: "Done",
  verificationNotes: "Checked",
  actionsTaken: [],
  exceptions: [],
  unresolvedDecisions: [],
};

describe("runHasWorkCell", () => {
  it("is true when an executor assignment exists", async () => {
    const db = createDb((call) => {
      if (call.table === "run_executor_assignments") return { data: [{ id: "asg_1" }] };
      return { data: [] };
    });
    await expect(runHasWorkCell(db as unknown as SupabaseClient, RUN_ID)).resolves.toBe(true);
  });

  it("is true when only a frozen catalog artifact exists", async () => {
    const db = createDb((call) => {
      if (call.table === "evidence_artifacts") return { data: [{ id: "art_manifest" }] };
      return { data: [] };
    });
    await expect(runHasWorkCell(db as unknown as SupabaseClient, RUN_ID)).resolves.toBe(true);
  });

  it("is false when the run has neither assignments nor catalog artifacts", async () => {
    const db = createDb(() => ({ data: [] }));
    await expect(runHasWorkCell(db as unknown as SupabaseClient, RUN_ID)).resolves.toBe(false);
  });

  it("fails closed on a query error", async () => {
    const db = createDb((call) => {
      if (call.table === "run_executor_assignments") return { error: { message: "assignments unavailable" } };
      return { data: [] };
    });
    await expect(runHasWorkCell(db as unknown as SupabaseClient, RUN_ID)).rejects.toThrow("assignments unavailable");
  });
});

describe("addEvidenceArtifact", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("evidence must not open Supabase in this case"));
  });

  it("is ops-only and requires a summary", async () => {
    await expect(
      addEvidenceArtifact(client, RUN_ID, { kind: "observation", summary: "note" }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(addEvidenceArtifact(operator, RUN_ID, { kind: "observation", summary: "   " })).rejects.toThrow(
      "Evidence requires a summary",
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("does not attach evidence from the demo workspace", async () => {
    await expect(
      addEvidenceArtifact({ ...operator, source: "demo" }, RUN_ID, { kind: "observation", summary: "note" }),
    ).rejects.toThrow("Execution primitives require the persistent Supabase workspace");
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("rejects reserved TWL and Software Factory evidence writers", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: runningRow() };
        throw new Error(`unexpected write to ${call.table}`);
      }),
    );

    await expect(
      addEvidenceArtifact(operator, RUN_ID, {
        kind: "other",
        summary: "forged TWL assignment",
        payload: { schemaVersion: TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA },
      }),
    ).rejects.toThrow("Reserved TWL proof evidence must be created by its guarded assignment or public-GitHub writer");

    await expect(
      addEvidenceArtifact(operator, RUN_ID, {
        kind: "other",
        summary: "forged TWL PR",
        payload: { schemaVersion: TWL_PREPARE_PROOF_PR_SCHEMA },
      }),
    ).rejects.toThrow("Reserved TWL proof evidence must be created by its guarded assignment or public-GitHub writer");

    await expect(
      addEvidenceArtifact(operator, RUN_ID, {
        kind: "other",
        summary: "forged factory packet",
        payload: { schemaVersion: SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION },
      }),
    ).rejects.toThrow("Reserved Software Factory evidence must be created by its guarded packet or owner-decision writer");

    await expect(
      addEvidenceArtifact(operator, RUN_ID, {
        kind: "other",
        summary: "forged owner decision",
        payload: { schemaVersion: SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION },
      }),
    ).rejects.toThrow("Reserved Software Factory evidence must be created by its guarded packet or owner-decision writer");
  });

  it("persists ordinary evidence while a run is in progress", async () => {
    const inserted: Record<string, unknown>[] = [];
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: runningRow() };
        if (call.table === "evidence_artifacts" && call.method === "insert") {
          inserted.push(call.payload as Record<string, unknown>);
          return {
            data: {
              id: "art_1",
              ...(call.payload as Record<string, unknown>),
              observed_at: NOW,
              created_at: NOW,
            },
          };
        }
        if (call.table === "audit_events") return { data: { id: "aud_1" } };
        return { data: null };
      }),
    );

    const artifact = await addEvidenceArtifact(operator, RUN_ID, {
      kind: "observation",
      summary: "operator note",
      payload: { schemaVersion: "operator-note/v1" },
    });
    expect(artifact.id).toBe("art_1");
    expect(inserted[0]).toMatchObject({
      run_id: RUN_ID,
      kind: "observation",
      summary: "operator note",
      created_by: operator.id,
    });
    expect(inserted[0]?.payload).toEqual({ schemaVersion: "operator-note/v1" });
  });

  it("rejects evidence after the run leaves running", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({ data: runningRow({ status: "awaiting_verification" }) })),
    );
    await expect(addEvidenceArtifact(operator, RUN_ID, { kind: "observation", summary: "late note" })).rejects.toThrow(
      "Evidence can only be added while a run is in progress",
    );
  });
});

describe("verifyWorkstreamRun", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("verify must not open Supabase in this case"));
  });

  it("is manager-only and validates the receipt before persistence", async () => {
    await expect(verifyWorkstreamRun(operator, RUN_ID, passingReceiptInput)).rejects.toThrow(
      "Only operations managers can issue Outcome Receipts",
    );
    await expect(verifyWorkstreamRun(client, RUN_ID, passingReceiptInput)).rejects.toBeInstanceOf(AuthzError);
    await expect(verifyWorkstreamRun(manager, RUN_ID, { ...passingReceiptInput, summary: "  " })).rejects.toThrow(
      "Outcome Receipt requires a summary",
    );
    await expect(
      verifyWorkstreamRun(manager, RUN_ID, { ...passingReceiptInput, definitionOfDoneMet: false }),
    ).rejects.toThrow("A run cannot pass verification when its definition of done is not met");
    await expect(verifyWorkstreamRun(manager, RUN_ID, { ...passingReceiptInput, qaScore: -1 })).rejects.toThrow(
      "QA score must be between 0 and 100",
    );
    await expect(verifyWorkstreamRun(manager, RUN_ID, { ...passingReceiptInput, qaScore: 101 })).rejects.toThrow(
      "QA score must be between 0 and 100",
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("does not issue a receipt from the demo workspace", async () => {
    await expect(verifyWorkstreamRun({ ...manager, source: "demo" }, RUN_ID, passingReceiptInput)).rejects.toThrow(
      "Execution primitives require the persistent Supabase workspace",
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("returns an existing receipt instead of issuing a second one", async () => {
    const existing = {
      id: "rcpt_1",
      organization_id: ORG,
      run_id: RUN_ID,
      verification_status: "passed",
      definition_of_done_met: true,
      summary: "Already issued",
      verification_notes: "",
      actions_taken: [],
      exceptions: [],
      unresolved_decisions: [],
      qa_score: 98,
      verified_by: manager.id,
      verified_at: NOW,
      created_at: NOW,
    };
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: runningRow({ status: "verified" }) };
        if (call.table === "outcome_receipts") return { data: existing };
        throw new Error(`must not write ${call.table} when a receipt already exists`);
      }),
    );

    const receipt = await verifyWorkstreamRun(manager, RUN_ID, passingReceiptInput);
    expect(receipt).toMatchObject({ id: "rcpt_1", verificationStatus: "passed", summary: "Already issued" });
  });

  it("refuses a passing receipt when the spec requires evidence and none exists", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: runningRow({ status: "awaiting_verification" }) };
        if (call.table === "outcome_receipts") return { data: null };
        if (call.table === "delegation_specs") {
          return {
            data: {
              id: SPEC_ID,
              organization_id: ORG,
              workstream_id: "ws_1",
              version: 1,
              status: "active",
              objective: "Do the work",
              definition_of_done: ["Done"],
              trigger_description: "",
              required_inputs: [],
              action_class: "prepare_only",
              authority_rules: [],
              approval_points: [],
              verification_rules: ["Attach the frozen packet"],
              exception_policy: [],
              sla: "",
              economic_envelope: {},
              data_policy: {},
              created_at: NOW,
              updated_at: NOW,
            },
          };
        }
        if (call.table === "evidence_artifacts") return { data: [], count: 0 };
        throw new Error(`must not issue a receipt via ${call.table}`);
      }),
    );

    await expect(verifyWorkstreamRun(manager, RUN_ID, passingReceiptInput)).rejects.toThrow(
      "This Delegation Spec requires evidence before a run can pass verification",
    );
  });
});

describe("transitionWorkstreamRun", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("transition must not open Supabase in this case"));
  });

  it("is ops-only", async () => {
    await expect(transitionWorkstreamRun(client, RUN_ID, "running")).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("cannot skip verification or reopen a terminal run", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(createDb(() => ({ data: runningRow() })));
    await expect(transitionWorkstreamRun(operator, RUN_ID, "verified")).rejects.toThrow(
      "Cannot move workstream run running → verified",
    );

    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(createDb(() => ({ data: runningRow({ status: "verified" }) })));
    await expect(transitionWorkstreamRun(operator, RUN_ID, "running")).rejects.toThrow(
      "Cannot move workstream run verified → running",
    );
  });

  it("rejects non-finite or negative submitted costs", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(createDb(() => ({ data: runningRow() })));
    await expect(transitionWorkstreamRun(operator, RUN_ID, "failed", { humanMinutes: -1 })).rejects.toThrow(
      "humanMinutes must be zero or greater",
    );
    await expect(transitionWorkstreamRun(operator, RUN_ID, "failed", { aiCostMicros: Number.NaN })).rejects.toThrow(
      "aiCostMicros must be zero or greater",
    );
  });

  it("blocks work-cell submission before deterministic validation completes", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: runningRow() };
        if (call.table === "run_executor_assignments") {
          if (filterEq(call, "phase") === "validate") return { data: [] };
          return { data: [{ id: "asg_prepare" }] };
        }
        if (call.table === "evidence_artifacts") return { data: [] };
        throw new Error(`must not transition via ${call.table}`);
      }),
    );
    await expect(transitionWorkstreamRun(operator, RUN_ID, "awaiting_verification")).rejects.toThrow(
      /Run deterministic work-cell validation before submitting it for verification/,
    );
  });

  it("cannot under-report recorded assignment costs on a work-cell submit", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: runningRow() };
        if (call.table === "run_executor_assignments") {
          if (filterEq(call, "phase") === "validate") {
            return { data: [{ id: "asg_validate", output_artifact_id: "art_validation" }] };
          }
          return {
            data: [
              { human_minutes: 12, ai_cost_micros: 5_000, tool_cost_micros: 1_000 },
              { human_minutes: 3, ai_cost_micros: 0, tool_cost_micros: 500 },
            ],
          };
        }
        if (call.table === "evidence_artifacts") return { data: [] };
        throw new Error(`must not accept under-reported costs via ${call.table}`);
      }),
    );
    await expect(
      transitionWorkstreamRun(operator, RUN_ID, "awaiting_verification", { humanMinutes: 4 }),
    ).rejects.toThrow("Submitted human minutes cannot be lower than recorded executor assignment costs");
  });
});
