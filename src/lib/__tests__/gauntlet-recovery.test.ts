import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, type Actor } from "@/lib/domain";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import { recoverAutonomyProfile } from "@/lib/gauntlet-recovery";

const ORG = "org_northline";
const PROFILE_ID = "autonomy_1";

function actor(partial: Partial<Actor> & Pick<Actor, "role">): Actor {
  return {
    id: "usr_manager",
    email: "manager@delegation.cloud",
    name: "Manager",
    organizationId: ORG,
    operatorId: "op_manager",
    source: "supabase",
    ...partial,
  };
}

const manager = actor({ role: "ops_manager" });

function filterEq(call: QueryCall, column: string) {
  return call.filters.find((filter) => filter.op === "eq" && filter.args[0] === column)?.args[1];
}

type QueryCall = {
  table: string;
  method: "select" | "insert" | "update" | "upsert";
  filters: Array<{ op: string; args: unknown[] }>;
  payload?: unknown;
};

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
      eq(column: string, value: unknown) {
        call.filters.push({ op: "eq", args: [column, value] });
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      single() {
        return Promise.resolve(resolve());
      },
      then(onFulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }
  return { from };
}

describe("recoverAutonomyProfile", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("recovery must not open Supabase in this case"));
  });

  it("is manager-only", async () => {
    await expect(recoverAutonomyProfile(actor({ role: "operator" }), PROFILE_ID, "reset")).rejects.toBeInstanceOf(AuthzError);
    await expect(recoverAutonomyProfile(actor({ role: "client_admin" }), PROFILE_ID, "reset")).rejects.toThrow(
      "Only operations managers can recover suspended autonomy profiles.",
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("rejects missing profile id or a blank reason before touching persistence", async () => {
    await expect(recoverAutonomyProfile(manager, "", "reset after incident")).rejects.toThrow("Autonomy profile is required.");
    await expect(recoverAutonomyProfile(manager, PROFILE_ID, "   ")).rejects.toThrow(
      "Autonomy recovery requires an explicit reason.",
    );
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("does not recover from the demo workspace", async () => {
    await expect(
      recoverAutonomyProfile({ ...manager, source: "demo" }, PROFILE_ID, "reset after incident"),
    ).rejects.toThrow("Autonomy recovery requires the persistent Supabase workspace.");
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("fails closed when Supabase is not configured", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(null);
    await expect(recoverAutonomyProfile(manager, PROFILE_ID, "reset after incident")).rejects.toThrow(
      "Autonomy recovery requires Supabase.",
    );
  });

  it("rejects a missing profile or one that is not suspended", async () => {
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({ data: null })),
    );
    await expect(recoverAutonomyProfile(manager, PROFILE_ID, "reset after incident")).rejects.toThrow(
      "Autonomy profile not found.",
    );

    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb(() => ({
        data: {
          id: PROFILE_ID,
          organization_id: ORG,
          workstream_id: "ws_1",
          current_level: 2,
          state: "active",
        },
      })),
    );
    await expect(recoverAutonomyProfile(manager, PROFILE_ID, "reset after incident")).rejects.toThrow(
      "Only a suspended autonomy profile can be recovered.",
    );
  });

  it("fails closed when recovery does not restore active Level 0", async () => {
    let profileReads = 0;
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_autonomy_profiles" && call.method === "select") {
          profileReads += 1;
          if (profileReads === 1) {
            return {
              data: {
                id: PROFILE_ID,
                organization_id: ORG,
                workstream_id: "ws_1",
                current_level: 3,
                state: "suspended",
              },
            };
          }
          return { data: { id: PROFILE_ID, current_level: 2, state: "active", updated_at: "2026-09-14T10:00:00.000Z" } };
        }
        if (call.table === "autonomy_recoveries") {
          return {
            data: {
              id: "rec_1",
              organization_id: ORG,
              workstream_id: "ws_1",
              from_level: 3,
              to_level: 0,
              reason: "reset after incident",
              recovered_by: manager.id,
              created_at: "2026-09-14T10:00:00.000Z",
            },
          };
        }
        return { data: null };
      }),
    );

    await expect(recoverAutonomyProfile(manager, PROFILE_ID, "reset after incident")).rejects.toThrow(
      "Autonomy recovery did not restore the profile to active Level 0.",
    );
  });

  it("records the recovery and returns the restored Level 0 profile", async () => {
    let inserted: Record<string, unknown> | null = null;
    let profileReads = 0;
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(
      createDb((call) => {
        if (call.table === "workstream_autonomy_profiles" && call.method === "select") {
          profileReads += 1;
          if (profileReads === 1) {
            expect(filterEq(call, "id")).toBe(PROFILE_ID);
            return {
              data: {
                id: PROFILE_ID,
                organization_id: ORG,
                workstream_id: "ws_1",
                current_level: 2,
                state: "suspended",
              },
            };
          }
          return { data: { id: PROFILE_ID, current_level: 0, state: "active", updated_at: "2026-09-14T10:00:00.000Z" } };
        }
        if (call.table === "autonomy_recoveries" && call.method === "insert") {
          inserted = call.payload as Record<string, unknown>;
          return {
            data: {
              id: "rec_1",
              ...(call.payload as Record<string, unknown>),
              created_at: "2026-09-14T10:00:00.000Z",
            },
          };
        }
        return { data: null };
      }),
    );

    const result = await recoverAutonomyProfile(manager, PROFILE_ID, "  owner approved reset  ");
    expect(inserted).toMatchObject({
      organization_id: ORG,
      workstream_id: "ws_1",
      from_level: 2,
      to_level: 0,
      reason: "owner approved reset",
      recovered_by: manager.id,
    });
    expect(result.profile).toMatchObject({ id: PROFILE_ID, current_level: 0, state: "active" });
    expect(result.recovery).toMatchObject({ id: "rec_1", to_level: 0, reason: "owner approved reset" });
  });
});
