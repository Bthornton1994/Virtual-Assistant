import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/domain";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
} from "@/lib/catalog-evidence-input";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import {
  COMPLETE_WORK_CELL_PHASE_CLAIM_RPC,
  FAIL_WORK_CELL_PHASE_CLAIM_RPC,
  FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC,
  WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
} from "@/lib/execution-economics-adapter";
import { PUBLIC_WEB_RESEARCHER_KEY } from "@/lib/public-web-researcher";

const { fetchMustNotStart, supabaseServer } = vi.hoisted(() => ({
  fetchMustNotStart: vi.fn(async () => {
    throw new Error("native public-web fetch must not start during reclaim");
  }),
  supabaseServer: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

vi.mock("@/lib/public-web-researcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-web-researcher")>();
  return {
    ...actual,
    prepareAuthorizedPublicWebEvidencePacket: fetchMustNotStart,
  };
});

import { runNativePublicWebPrepare } from "@/lib/work-cell";

const ORG = "org-native-entrypoint-owner-action";
const RUN_ID = "run-native-entrypoint-owner-action";
const ASSIGNMENT_ID = "assign-native-entrypoint-owner-action";
const PACKET_ID = "artifact-packet-native-entrypoint";
const INPUT_ID = "artifact-input-native-entrypoint";
const HASH = "a".repeat(64);
const RESERVATION_ID = "res-native-entrypoint-1";

const actor: Actor = {
  id: "usr-ops-manager",
  email: "ops@delegation.example",
  name: "Ops Manager",
  role: "ops_manager",
  organizationId: ORG,
  operatorId: "op-1",
  source: "supabase",
};

function frozenManifest() {
  const base = {
    runId: RUN_ID,
    market: "US",
    expectedProductIds: ["ks-sbd-7mm"],
    inputRecords: [{ productId: "ks-sbd-7mm", record: { thickness: "7mm" } }],
    prepareExecutorKey: PUBLIC_WEB_RESEARCHER_KEY,
    reviewExecutorKey: "delegation-cloud-catalog-reviewer-v1",
  };
  const payload = {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    createdAt: "2026-09-10T11:00:00.000Z",
    inputHash: sha256Hex(inputManifestHashSource(base)),
    ...base,
  };
  return { payload, contentHash: sha256Hex(payload) };
}

type AssignmentState = {
  status: "planned" | "running" | "completed" | "failed";
  outputArtifactId: string | null;
  createdAt: string;
};

type QueryLog = {
  table: string;
  op: "select" | "insert";
  filters: Record<string, unknown>;
  row?: unknown;
};

function createNativePrepareDb(options: {
  assignment: AssignmentState | null;
  packetExists: boolean;
}) {
  const queries: QueryLog[] = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  let assignment = options.assignment
    ? {
        id: ASSIGNMENT_ID,
        organization_id: ORG,
        run_id: RUN_ID,
        executor_profile_id: "profile-public-web",
        phase: "prepare",
        status: options.assignment.status,
        authority_snapshot: {},
        input_artifact_id: INPUT_ID,
        output_artifact_id: options.assignment.outputArtifactId,
        started_at: options.assignment.createdAt,
        completed_at: null,
        human_minutes: 0,
        ai_cost_micros: 0,
        tool_cost_micros: 0,
        metadata: {
          assignmentId: ASSIGNMENT_ID,
          executorKey: PUBLIC_WEB_RESEARCHER_KEY,
          capabilityKey: "public_web_retrieval",
          inputManifestContentHash: HASH,
          envelopeHash: HASH,
          contextHash: HASH,
          economicReservationIds: [RESERVATION_ID],
        },
        created_at: options.assignment.createdAt,
      }
    : null;

  const manifest = frozenManifest();
  const packetPayload = {
    schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
    runId: RUN_ID,
    executorKey: PUBLIC_WEB_RESEARCHER_KEY,
  };

  async function execute(query: QueryLog & { single?: boolean }) {
    queries.push({ table: query.table, op: query.op, filters: { ...query.filters }, row: query.row });
    if (query.op === "insert") {
      return { data: null, error: { message: "second claim must not insert", code: "23505" } };
    }
    if (query.table === "workstream_runs") {
      return {
        data: {
          id: RUN_ID,
          organization_id: ORG,
          status: "running",
          gauntlet_cycle_id: null,
          delegation_spec_id: "spec-native-entrypoint",
        },
        error: null,
      };
    }
    if (query.table === "run_executor_assignments") {
      return { data: assignment, error: null };
    }
    if (query.table === "evidence_artifacts") {
      if (query.filters.id === PACKET_ID) {
        return {
          data: {
            id: PACKET_ID,
            run_id: RUN_ID,
            payload: packetPayload,
          },
          error: null,
        };
      }
      const schema = query.filters["payload->>schemaVersion"];
      if (schema === CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION) {
        return {
          data: [
            {
              id: INPUT_ID,
              run_id: RUN_ID,
              payload: manifest.payload,
              content_hash: manifest.contentHash,
            },
          ],
          error: null,
        };
      }
      if (schema === CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION) {
        return {
          data: options.packetExists
            ? [
                {
                  id: PACKET_ID,
                  run_id: RUN_ID,
                  payload: packetPayload,
                  content_hash: HASH,
                },
              ]
            : [],
          error: null,
        };
      }
      return { data: query.single ? null : [], error: null };
    }
    return { data: query.single ? null : [], error: null };
  }

  const db = {
    from(table: string) {
      const query: QueryLog = { table, op: "select", filters: {} };
      const builder = {
        select() {
          return builder;
        },
        insert(row: unknown) {
          query.op = "insert" as const;
          query.row = row;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.filters[column] = value;
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return execute({ ...query, filters: { ...query.filters }, single: true });
        },
        single() {
          return execute({ ...query, filters: { ...query.filters }, single: true });
        },
        then(
          onFulfilled: (value: { data: unknown; error: unknown }) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return execute({ ...query, filters: { ...query.filters } }).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args });
      if (name === FAIL_WORK_CELL_PHASE_CLAIM_RPC && assignment) {
        assignment = { ...assignment, status: "failed" };
        return { data: [{ assignment_id: ASSIGNMENT_ID, assignment_status: "failed" }], error: null };
      }
      return { data: null, error: { message: `${name} must not be called on this path` } };
    },
  };

  return {
    db,
    queries,
    rpcs,
    currentAssignment: () => assignment,
  };
}

describe("native public-web prepare entrypoint — owner-action routing", () => {
  beforeEach(() => {
    fetchMustNotStart.mockClear();
    supabaseServer.mockReset();
  });

  it("stale running claim with a bound accepted packet reaches OWNER_ACTION_REQUIRED without fetch, complete, fail, or a second claim", async () => {
    const createdAt = new Date(Date.now() - WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS - 5_000).toISOString();
    const store = createNativePrepareDb({
      assignment: { status: "running", outputArtifactId: PACKET_ID, createdAt },
      packetExists: true,
    });
    supabaseServer.mockResolvedValue(store.db);

    await expect(runNativePublicWebPrepare(actor, RUN_ID)).rejects.toThrow(
      /OWNER_ACTION_REQUIRED[\s\S]*not economics proof/,
    );
    expect(store.currentAssignment()?.status).toBe("running");
    expect(store.rpcs.map((rpc) => rpc.name)).not.toContain(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC);
    expect(store.rpcs.map((rpc) => rpc.name)).not.toContain(FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC);
    expect(store.rpcs.map((rpc) => rpc.name)).not.toContain(FAIL_WORK_CELL_PHASE_CLAIM_RPC);
    expect(store.queries.some((query) => query.op === "insert" && query.table === "run_executor_assignments")).toBe(
      false,
    );
    expect(
      store.queries.some(
        (query) =>
          query.table === "evidence_artifacts" &&
          query.filters["payload->>schemaVersion"] === CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
      ),
    ).toBe(false);
    expect(store.queries.some((query) => query.table === "run_executor_assignments" && query.op === "select")).toBe(
      true,
    );
    expect(fetchMustNotStart).not.toHaveBeenCalled();
  });

  it("a non-stale running claim with a bound packet stays fail-closed as already claimed", async () => {
    const store = createNativePrepareDb({
      assignment: { status: "running", outputArtifactId: PACKET_ID, createdAt: new Date().toISOString() },
      packetExists: true,
    });
    supabaseServer.mockResolvedValue(store.db);

    await expect(runNativePublicWebPrepare(actor, RUN_ID)).rejects.toThrow(
      /already has a recorded attempt \(status: running\)/,
    );
    expect(store.currentAssignment()?.status).toBe("running");
    expect(store.rpcs).toEqual([]);
    expect(fetchMustNotStart).not.toHaveBeenCalled();
  });

  it("stale running claim without a bound packet still reclaims running to failed without fetching", async () => {
    const createdAt = new Date(Date.now() - WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS - 5_000).toISOString();
    const store = createNativePrepareDb({
      assignment: { status: "running", outputArtifactId: null, createdAt },
      packetExists: false,
    });
    supabaseServer.mockResolvedValue(store.db);

    await expect(runNativePublicWebPrepare(actor, RUN_ID)).rejects.toThrow(
      /already has a recorded attempt \(status: failed\)/,
    );
    expect(store.currentAssignment()?.status).toBe("failed");
    expect(store.rpcs.map((rpc) => rpc.name)).toEqual([FAIL_WORK_CELL_PHASE_CLAIM_RPC]);
    expect(store.rpcs.map((rpc) => rpc.name)).not.toContain(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC);
    expect(store.rpcs.map((rpc) => rpc.name)).not.toContain(FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC);
    expect(store.rpcs.map((rpc) => rpc.name)).not.toContain(FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC);
    expect(store.queries.some((query) => query.op === "insert" && query.table === "run_executor_assignments")).toBe(
      false,
    );
    expect(fetchMustNotStart).not.toHaveBeenCalled();
  });

  it("failed assignments with a packet keep the existing terminal packet error", async () => {
    const store = createNativePrepareDb({
      assignment: {
        status: "failed",
        outputArtifactId: PACKET_ID,
        createdAt: new Date(Date.now() - WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS - 5_000).toISOString(),
      },
      packetExists: true,
    });
    supabaseServer.mockResolvedValue(store.db);

    await expect(runNativePublicWebPrepare(actor, RUN_ID)).rejects.toThrow(
      /already has a frozen catalog evidence packet/,
    );
    expect(store.currentAssignment()?.status).toBe("failed");
    expect(store.rpcs).toEqual([]);
    expect(fetchMustNotStart).not.toHaveBeenCalled();
  });

  it("completed assignments with a packet keep the existing terminal packet error", async () => {
    const store = createNativePrepareDb({
      assignment: {
        status: "completed",
        outputArtifactId: PACKET_ID,
        createdAt: new Date(Date.now() - WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS - 5_000).toISOString(),
      },
      packetExists: true,
    });
    supabaseServer.mockResolvedValue(store.db);

    await expect(runNativePublicWebPrepare(actor, RUN_ID)).rejects.toThrow(
      /already has a frozen catalog evidence packet/,
    );
    expect(store.currentAssignment()?.status).toBe("completed");
    expect(store.rpcs).toEqual([]);
    expect(fetchMustNotStart).not.toHaveBeenCalled();
  });
});
