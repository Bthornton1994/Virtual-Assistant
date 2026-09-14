import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, type Actor } from "@/lib/domain";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import { addGauntletReview, applyAutonomyDecision, createGauntletCycle } from "@/lib/gauntlet";

const ORG = "org_northline";
const RUN_ID = "run_1";
const CYCLE_ID = "cycle_1";

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

type QueryCall = {
  table: string;
  method: "select" | "insert" | "update" | "upsert";
  filters: Array<{ op: string; args: unknown[] }>;
  payload?: unknown;
};

function filterEq(call: QueryCall, column: string) {
  return call.filters.find((filter) => filter.op === "eq" && filter.args[0] === column)?.args[1];
}

function createDb(handler: (call: QueryCall) => { data?: unknown; error?: { message: string } | null }) {
  function from(table: string) {
    const call: QueryCall = { table, method: "select", filters: [] };
    const resolve = () => {
      const result = handler(call);
      return { data: result.data ?? null, error: result.error ?? null };
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
      upsert(payload: unknown) {
        call.method = "upsert";
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
        onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  return { from };
}

function reviewInput(partial: Partial<Parameters<typeof addGauntletReview>[2]> = {}) {
  return {
    reviewerKind: "human" as const,
    reviewerRef: "ops-reviewer",
    verdict: "failed" as const,
    hardGatePass: false,
    challengedAssumptions: [],
    defects: [],
    evidenceGaps: [],
    authorityIncidents: [],
    ...partial,
  };
}

function submittedRun(partial: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    organization_id: ORG,
    gauntlet_cycle_id: CYCLE_ID,
    status: "awaiting_verification",
    initiated_by: "usr_other",
    ...partial,
  };
}

describe("addGauntletReview", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("review must not open Supabase in this case"));
  });

  it("is ops-only and refuses the demo workspace", async () => {
    await expect(addGauntletReview(actor({ id: "usr_client", role: "client_admin" }), RUN_ID, reviewInput())).rejects.toThrow(
      "Only operations staff can operate the Gauntlet.",
    );
    await expect(addGauntletReview({ ...operator, source: "demo" }, RUN_ID, reviewInput())).rejects.toThrow(
      "The Gauntlet requires the persistent Supabase workspace.",
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("rejects a run that is not on a Gauntlet cycle or not submitted", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({
        data: submittedRun({ gauntlet_cycle_id: null }),
      })),
    );
    await expect(addGauntletReview(operator, RUN_ID, reviewInput())).rejects.toThrow(
      "Run is not attached to a Gauntlet cycle.",
    );

    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({
        data: submittedRun({ status: "running" }),
      })),
    );
    await expect(addGauntletReview(operator, RUN_ID, reviewInput())).rejects.toThrow(
      "Adversarial review requires a submitted run.",
    );
  });

  it("blocks a human executor from reviewing their own attempt", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({
        data: submittedRun({ initiated_by: operator.id }),
      })),
    );
    await expect(addGauntletReview(operator, RUN_ID, reviewInput({ reviewerKind: "human" }))).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(addGauntletReview(operator, RUN_ID, reviewInput({ reviewerKind: "human" }))).rejects.toThrow(
      "A human executor cannot independently review their own Gauntlet attempt.",
    );
  });

  it("refuses a passing verdict when the hard gate failed", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({
        data: submittedRun(),
      })),
    );
    await expect(
      addGauntletReview(operator, RUN_ID, reviewInput({ verdict: "passed", hardGatePass: false })),
    ).rejects.toThrow("A passing review requires the hard gate to pass.");
  });

  it("reserves the single review slot for the work-cell verdict", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: submittedRun() };
        if (call.table === "run_executor_assignments") return { data: [{ id: "asg_1" }] };
        if (call.table === "evidence_artifacts") return { data: [] };
        if (call.table === "gauntlet_reviews") {
          throw new Error("manual review must not insert over a work-cell run");
        }
        return { data: [] };
      }),
    );
    await expect(addGauntletReview(operator, RUN_ID, reviewInput())).rejects.toThrow(
      /its single Gauntlet review is written by the deterministic work-cell verdict/,
    );
  });

  it("also treats a frozen catalog artifact without assignments as a work-cell run", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: submittedRun() };
        if (call.table === "run_executor_assignments") return { data: [] };
        if (call.table === "evidence_artifacts") return { data: [{ id: "art_manifest" }] };
        if (call.table === "gauntlet_reviews") {
          throw new Error("manual review must not insert over a rejected-ingest work cell");
        }
        return { data: [] };
      }),
    );
    await expect(addGauntletReview(operator, RUN_ID, reviewInput())).rejects.toThrow(
      /Record findings in the work cell rather than as a separate review/,
    );
  });

  it("writes a work-cell verdict even when the run already looks like a work cell", async () => {
    const inserted: Record<string, unknown>[] = [];
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_runs") return { data: submittedRun() };
        if (call.table === "run_executor_assignments") return { data: [{ id: "asg_1" }] };
        if (call.table === "gauntlet_reviews" && call.method === "insert") {
          inserted.push(call.payload as Record<string, unknown>);
          return { data: { id: "rev_1", ...(call.payload as Record<string, unknown>) } };
        }
        if (call.table === "audit_events") return { data: { id: "aud_1" } };
        return { data: [] };
      }),
    );

    const row = await addGauntletReview(
      manager,
      RUN_ID,
      reviewInput({
        reviewerKind: "deterministic",
        reviewerRef: "delegation-cloud-work-cell-v1",
        verdict: "failed",
        hardGatePass: false,
        workCellVerdict: true,
      }),
    );
    expect(row).toMatchObject({ id: "rev_1", verdict: "failed", reviewer_kind: "deterministic" });
    expect(inserted[0]).toMatchObject({
      run_id: RUN_ID,
      reviewer_ref: "delegation-cloud-work-cell-v1",
      independent: true,
      reviewed_by: manager.id,
    });
  });
});

describe("createGauntletCycle", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("cycle create must not open Supabase in this case"));
  });

  it("is manager-only", async () => {
    await expect(
      createGauntletCycle(operator, { delegationSpecId: "spec_1", recurrenceMode: "manual" }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("requires an active Delegation Spec", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({
        data: { id: "spec_1", organization_id: ORG, workstream_id: "ws_1", objective: "Do the work", status: "draft" },
      })),
    );
    await expect(
      createGauntletCycle(manager, { delegationSpecId: "spec_1", recurrenceMode: "manual" }),
    ).rejects.toThrow("Gauntlet cycles require an active Delegation Spec.");
  });
});

describe("applyAutonomyDecision", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
  });

  it("is manager-only and applies only proposed decisions", async () => {
    await expect(applyAutonomyDecision(operator, "dec_1")).rejects.toThrow(
      "Only operations managers can change Gauntlet governance or autonomy.",
    );

    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "autonomy_decisions" && filterEq(call, "id") === "dec_missing") return { data: null };
        return {
          data: {
            id: "dec_1",
            organization_id: ORG,
            status: "applied",
            decision: "promote",
            to_level: 1,
          },
        };
      }),
    );
    await expect(applyAutonomyDecision(manager, "dec_missing")).rejects.toThrow("Autonomy decision not found.");
    await expect(applyAutonomyDecision(manager, "dec_1")).rejects.toThrow(
      "Only proposed autonomy decisions can be applied.",
    );
  });
});
