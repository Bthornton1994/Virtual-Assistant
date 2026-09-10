import { readFileSync } from "node:fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  COMPLETE_WORK_CELL_PHASE_CLAIM_RPC,
  FAIL_WORK_CELL_PHASE_CLAIM_RPC,
  FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC,
  RELEASE_OUTCOME_ECONOMICS_EVENT_RPC,
  RESERVE_OUTCOME_ECONOMICS_EVENT_RPC,
  START_OUTCOME_ECONOMICS_INVOCATION_RPC,
} from "@/lib/execution-economics-adapter";
import {
  buildOutcomeEconomicsEventPayload,
  computeOutcomeEconomicsRemaining,
  createMemoryDurableEconomicsStore,
  outcomeEconomicsEventHasForbiddenKeys,
  OUTCOME_ECONOMICS_EVENT_SCHEMA_VERSION,
  type DurableNativeEconomicsIdentity,
} from "@/lib/outcome-economics-event";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_D = "d".repeat(64);
const NOW = "2026-09-11T00:00:00.000Z";
const FUTURE = "2026-09-11T00:02:00.000Z";
const PAST = "2026-09-10T00:00:00.000Z";

const identity: DurableNativeEconomicsIdentity = {
  runId: "run-econ-event-0001",
  phase: "prepare",
  assignmentId: "assign-native-prepare-0001",
  executorKey: "delegation-cloud-public-web-researcher-v1",
  capabilityKey: "public_web_retrieval",
  inputManifestContentHash: HEX_A,
  envelopeHash: HEX_A,
  contextHash: HEX_A,
};

function reservationId(label: string): string {
  return sha256Hex({ schemaVersion: "outcome-economics-reservation-id/v1", label });
}

function idempotency(label: string): string {
  return sha256Hex({ schemaVersion: "execution-economics-idempotency/v1", label });
}

function store() {
  return createMemoryDurableEconomicsStore({
    organizationId: "org-econ-event",
    runId: identity.runId,
    envelope: { maxAiCostMicros: 1_000, maxToolCostMicros: 500 },
    assignment: identity,
  });
}

describe("outcome-economics-event/v1 contract", () => {
  it("uses a distinct schema and does not alter outcome-economics-evidence/v1", () => {
    expect(OUTCOME_ECONOMICS_EVENT_SCHEMA_VERSION).toBe("outcome-economics-event/v1");
    const governor = readFileSync(resolve(process.cwd(), "src/lib/outcome-economics-governor.ts"), "utf8");
    expect(governor).toMatch(/outcome-economics-evidence\/v1/);
    expect(governor).not.toMatch(/outcome-economics-event\/v1/);
  });

  it("refuses forbidden prompt, completion, secret, and CoT keys", () => {
    expect(outcomeEconomicsEventHasForbiddenKeys({ prompt: "hi" })).toBe(true);
    expect(outcomeEconomicsEventHasForbiddenKeys({ nested: { chain_of_thought: "x" } })).toBe(true);
    expect(outcomeEconomicsEventHasForbiddenKeys({ credential: "x" })).toBe(true);
    const payload = buildOutcomeEconomicsEventPayload({
      eventType: "reserved",
      organizationId: "org-econ-event",
      runId: identity.runId,
      reservationId: reservationId("one"),
      idempotencyKey: idempotency("one"),
      ownerKind: "native_assignment",
      nativeAssignmentId: identity.assignmentId,
      leasedAttemptId: null,
      eventAt: NOW,
      expiresAt: FUTURE,
      aiCostMicros: 0,
      toolCostMicros: 10,
      executorKey: identity.executorKey,
      capabilityKey: identity.capabilityKey,
      inputManifestContentHash: HEX_A,
      envelopeHash: HEX_A,
      contextHash: HEX_A,
      planHash: null,
      outputArtifactId: null,
      packetContentHash: null,
    });
    expect(payload.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.schemaVersion).toBe("outcome-economics-event/v1");
    expect(JSON.stringify(payload)).not.toMatch(/prompt|completion|chain.of.thought|secret/i);
  });
});

describe("durable economics event seam — remaining and lock serialization", () => {
  it("two concurrent reservations against one run cannot overspend", async () => {
    const ledger = store();
    const first = ledger.reserve({
      ...identity,
      reservationId: reservationId("url-1"),
      idempotencyKey: idempotency("url-1"),
      aiCostMicros: 0,
      toolCostMicros: 400,
      expiresAt: FUTURE,
    });
    const second = ledger.reserve({
      ...identity,
      reservationId: reservationId("url-2"),
      idempotencyKey: idempotency("url-2"),
      aiCostMicros: 0,
      toolCostMicros: 400,
      expiresAt: FUTURE,
    });
    const results = await Promise.allSettled([first, second]);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status === "rejected") {
      expect(String(rejected[0].reason)).toMatch(/exceed the tool cost ceiling/);
    }
    const remaining = ledger.remaining(identity.runId, Date.parse(NOW));
    expect(remaining.openReservedToolCostMicros).toBe(400);
    expect(remaining.remainingToolCostMicros).toBe(100);
  });

  it("native multi-URL reservations serialize on the same assignment", async () => {
    const ledger = store();
    await ledger.reserve({
      ...identity,
      reservationId: reservationId("a"),
      idempotencyKey: idempotency("a"),
      aiCostMicros: 0,
      toolCostMicros: 200,
      expiresAt: FUTURE,
    });
    await ledger.reserve({
      ...identity,
      reservationId: reservationId("b"),
      idempotencyKey: idempotency("b"),
      aiCostMicros: 0,
      toolCostMicros: 200,
      expiresAt: FUTURE,
    });
    expect(ledger.events.filter((event) => event.eventType === "reserved")).toHaveLength(2);
    expect(ledger.remaining(identity.runId, Date.parse(NOW)).remainingToolCostMicros).toBe(100);
  });

  it("duplicate reserve/commit/release retries are idempotent", async () => {
    const ledger = store();
    const input = {
      ...identity,
      reservationId: reservationId("dup"),
      idempotencyKey: idempotency("dup"),
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: FUTURE,
    };
    const first = await ledger.reserve(input);
    const second = await ledger.reserve(input);
    expect(first.artifactId).toBe(second.artifactId);
    expect(ledger.events.filter((event) => event.eventType === "reserved")).toHaveLength(1);
    const released = await ledger.release({ ...identity, reservationId: input.reservationId, idempotencyKey: input.idempotencyKey });
    const releasedAgain = await ledger.release({
      ...identity,
      reservationId: input.reservationId,
      idempotencyKey: input.idempotencyKey,
    });
    expect(released.artifactId).toBe(releasedAgain.artifactId);
    expect(ledger.events.filter((event) => event.eventType === "released")).toHaveLength(1);
  });

  it("committed and released cannot both win", async () => {
    const ledger = store();
    const reservation = reservationId("race");
    const key = idempotency("race");
    await ledger.reserve({
      ...identity,
      reservationId: reservation,
      idempotencyKey: key,
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: FUTURE,
    });
    ledger.setPacket({
      runId: identity.runId,
      outputArtifactId: "artifact-1",
      packetContentHash: HEX_B,
      executorKey: identity.executorKey,
    });
    const commit = ledger.finalize({
      ...identity,
      outputArtifactId: "artifact-1",
      packetContentHash: HEX_B,
      reservationIds: [reservation],
    });
    const release = ledger.release({ ...identity, reservationId: reservation, idempotencyKey: key });
    const results = await Promise.allSettled([commit, release]);
    const states = new Set(ledger.events.map((event) => event.eventType));
    expect(states.has("committed") && states.has("released")).toBe(false);
    expect(results.some((result) => result.status === "rejected")).toBe(true);
  });

  it("expired reservations cannot commit", async () => {
    const ledger = store();
    const reservation = reservationId("expired");
    await ledger.reserve({
      ...identity,
      reservationId: reservation,
      idempotencyKey: idempotency("expired"),
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: PAST,
    });
    ledger.setPacket({
      runId: identity.runId,
      outputArtifactId: "artifact-expired",
      packetContentHash: HEX_B,
      executorKey: identity.executorKey,
    });
    await expect(
      ledger.finalize({
        ...identity,
        outputArtifactId: "artifact-expired",
        packetContentHash: HEX_B,
        reservationIds: [reservation],
      }),
    ).rejects.toThrow(/expired reservation cannot be committed/);
  });

  it("invocation_started cannot be silently released", async () => {
    const ledger = store();
    const reservation = reservationId("started");
    const key = idempotency("started");
    await ledger.reserve({
      ...identity,
      reservationId: reservation,
      idempotencyKey: key,
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: FUTURE,
    });
    await ledger.invocationStarted({ ...identity, reservationId: reservation, idempotencyKey: key });
    await expect(
      ledger.release({ ...identity, reservationId: reservation, idempotencyKey: key }),
    ).rejects.toThrow(/cannot be silently released/);
    const ownerAction = await ledger.release({
      ...identity,
      reservationId: reservation,
      idempotencyKey: key,
      ownerAction: true,
    });
    expect(ledger.events.some((event) => event.eventType === "owner_action_required")).toBe(true);
    expect(ownerAction.artifactId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("packet presence cannot complete economics", async () => {
    const ledger = store();
    const reservation = reservationId("packet");
    await ledger.reserve({
      ...identity,
      reservationId: reservation,
      idempotencyKey: idempotency("packet"),
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: FUTURE,
    });
    await expect(
      ledger.finalize({
        ...identity,
        outputArtifactId: "artifact-missing",
        packetContentHash: HEX_B,
        reservationIds: [reservation],
      }),
    ).rejects.toThrow(/not economics proof|unbound or unrelated catalog evidence packet/);
    expect(ledger.events.some((event) => event.eventType === "committed")).toBe(false);
  });

  it("finalization atomically commits events and assignment completion; rollback leaves neither", async () => {
    const ledger = store();
    const reservation = reservationId("final");
    await ledger.reserve({
      ...identity,
      reservationId: reservation,
      idempotencyKey: idempotency("final"),
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: FUTURE,
    });
    ledger.setPacket({
      runId: identity.runId,
      outputArtifactId: "artifact-ok",
      packetContentHash: HEX_B,
      executorKey: identity.executorKey,
    });
    await ledger.finalize({
      ...identity,
      outputArtifactId: "artifact-ok",
      packetContentHash: HEX_B,
      reservationIds: [reservation],
    });
    expect(ledger.events.some((event) => event.eventType === "committed")).toBe(true);

    const rolled = store();
    const other = reservationId("rollback");
    await rolled.reserve({
      ...identity,
      reservationId: other,
      idempotencyKey: idempotency("rollback"),
      aiCostMicros: 0,
      toolCostMicros: 10,
      expiresAt: FUTURE,
    });
    await expect(
      rolled.finalize({
        ...identity,
        outputArtifactId: "artifact-missing",
        packetContentHash: HEX_C,
        reservationIds: [other],
      }),
    ).rejects.toThrow(/unbound or unrelated/);
    expect(rolled.events.some((event) => event.eventType === "committed")).toBe(false);
    expect(rolled.events.filter((event) => event.eventType === "reserved")).toHaveLength(1);
  });
});

describe("outcome economics event seam — SQL catalog and native wiring", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260911000000_outcome_economics_event_seam_v1.sql"),
    "utf8",
  );
  const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
  const native = readFileSync(resolve(process.cwd(), "src/lib/public-web-researcher.ts"), "utf8");
  const adapter = readFileSync(resolve(process.cwd(), "src/lib/execution-economics-adapter.ts"), "utf8");
  const persistence = readFileSync(resolve(process.cwd(), "src/lib/execution-runtime-persistence.ts"), "utf8");

  it("migration adds event indexes, RLS exclusion, DEFINER writers, and lock order without a new table", () => {
    expect(sql).toMatch(/supabase\/qa\/outcome_economics_event_seam_proof\.sql|SQL_VERIFICATION_NOT_AVAILABLE/);
    const proof = readFileSync(
      resolve(process.cwd(), "supabase/qa/outcome_economics_event_seam_proof.sql"),
      "utf8",
    );
    expect(proof).toMatch(/SQL_VERIFICATION_NOT_AVAILABLE/);
    expect(proof).toMatch(/LEASED_EXECUTION_ATTEMPTS_OUT_OF_SCOPE/);
    expect(proof).toMatch(/workstream_runs FOR UPDATE then run_executor_assignments FOR UPDATE/);
    expect(sql).toMatch(/outcome-economics-event\/v1/);
    expect(sql).toMatch(/DISTINCT schemaVersion `outcome-economics-event\/v1`/);
    expect(sql).toMatch(/This does not change/);
    expect(sql).toMatch(/outcome-economics-evidence\/v1/);
    expect(sql).toMatch(/outcome_economics_event_reservation_type_idx/);
    expect(sql).toMatch(/outcome_economics_event_idempotency_type_idx/);
    expect(sql).toMatch(/payload->>'reservationId'/);
    expect(sql).toMatch(/payload->>'idempotencyKey'/);
    expect(sql).toMatch(/payload->>'eventType'/);
    expect(sql).not.toMatch(/run_id, \(payload->>'schemaVersion'\)/);
    expect(sql).toMatch(/outcome-economics-event\/v1/);
    expect(sql).toMatch(/current_user <> 'postgres'/);
    expect(sql).toMatch(/is_ops_manager/);
    expect(sql).toMatch(/Lock order: workstream_runs then run_executor_assignments/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/ceiling_ai - v_committed_ai - v_open_ai/);
    expect(sql).toMatch(/EXPLICITLY OUT OF SCOPE/);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).toMatch(/revoke execute on function public\.reserve_outcome_economics_event[\s\S]*from anon, service_role/);
    expect(sql).toMatch(/Work-cell phase claim completion requires committed economics events from finalize_work_cell_phase_economics/);
    expect(sql).toMatch(/invocation_started cannot be silently released/);
    expect(RESERVE_OUTCOME_ECONOMICS_EVENT_RPC).toBe("reserve_outcome_economics_event");
    expect(START_OUTCOME_ECONOMICS_INVOCATION_RPC).toBe("start_outcome_economics_invocation");
    expect(RELEASE_OUTCOME_ECONOMICS_EVENT_RPC).toBe("release_outcome_economics_event");
    expect(FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC).toBe("finalize_work_cell_phase_economics");
    expect(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC).toBe("complete_work_cell_phase_claim");
    expect(FAIL_WORK_CELL_PHASE_CLAIM_RPC).toBe("fail_work_cell_phase_claim");
  });

  it("native prepare reserves before fetch, starts invocation before fetchPage, and finalizes instead of Maps-then-old-complete", () => {
    const nativeFn = workCell.slice(
      workCell.indexOf("export async function runNativePublicWebPrepare"),
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn).toMatch(/createSupabaseDurableEconomicsWriter/);
    expect(nativeFn).toMatch(/durableEconomics/);
    expect(nativeFn).toMatch(/finalizeWorkCellPhaseClaim/);
    expect(nativeFn).not.toMatch(/completeWorkCellPhaseClaim/);
    expect(nativeFn.lastIndexOf("persistPhaseArtifact")).toBeLessThan(nativeFn.lastIndexOf("finalizeWorkCellPhaseClaim"));
    expect(nativeFn.lastIndexOf("finalizeWorkCellPhaseClaim")).toBeLessThan(
      nativeFn.lastIndexOf("commitDeferredGovernedReservations"),
    );
    expect(native).toMatch(/persistDurableReserve/);
    expect(native).toMatch(/persistDurableInvocationStarted/);
    expect(native.indexOf("persistDurableInvocationStarted")).toBeLessThan(native.indexOf("fetchPage(entry.url)"));
    expect(native.indexOf("persistDurableReserve")).toBeLessThan(native.indexOf("persistDurableInvocationStarted"));
    expect(nativeFn).toMatch(/native-prepare:|assignmentId: binding.assignmentId/);
    expect(nativeFn).not.toMatch(/execution_attempts/);
  });

  it("old completion RPC cannot bypass durable economics; leased complete/fail stay unchanged", () => {
    expect(sql).toMatch(/finalize_work_cell_phase_economics/);
    expect(sql).toMatch(/Work-cell phase claim completion requires committed economics events from finalize_work_cell_phase_economics/);
    expect(persistence).toMatch(/complete_execution_attempt/);
    expect(persistence).toMatch(/fail_execution_attempt/);
    expect(persistence).not.toMatch(/reserve_outcome_economics_event/);
    expect(adapter).toMatch(/FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC/);
  });

  it("remaining formula uses envelope ceilings minus committed and unexpired open reserved", () => {
    const remaining = computeOutcomeEconomicsRemaining({
      envelope: { maxAiCostMicros: 100, maxToolCostMicros: 50 },
      nowMs: Date.parse(NOW),
      events: [
        buildOutcomeEconomicsEventPayload({
          eventType: "reserved",
          organizationId: "org",
          runId: "run",
          reservationId: HEX_A,
          idempotencyKey: HEX_B,
          ownerKind: "native_assignment",
          nativeAssignmentId: "assign",
          leasedAttemptId: null,
          eventAt: NOW,
          expiresAt: FUTURE,
          aiCostMicros: 10,
          toolCostMicros: 20,
          executorKey: "exec",
          capabilityKey: "cap",
          inputManifestContentHash: HEX_A,
          envelopeHash: HEX_A,
          contextHash: HEX_A,
          planHash: null,
          outputArtifactId: null,
          packetContentHash: null,
        }),
        buildOutcomeEconomicsEventPayload({
          eventType: "committed",
          organizationId: "org",
          runId: "run",
          reservationId: HEX_C,
          idempotencyKey: HEX_D,
          ownerKind: "native_assignment",
          nativeAssignmentId: identity.assignmentId,
          leasedAttemptId: null,
          eventAt: NOW,
          expiresAt: FUTURE,
          aiCostMicros: 5,
          toolCostMicros: 5,
          executorKey: "exec",
          capabilityKey: "cap",
          inputManifestContentHash: HEX_A,
          envelopeHash: HEX_A,
          contextHash: HEX_A,
          planHash: null,
          outputArtifactId: null,
          packetContentHash: null,
        }),
      ],
    });
    expect(remaining.remainingAiCostMicros).toBe(85);
    expect(remaining.remainingToolCostMicros).toBe(25);
  });
});
