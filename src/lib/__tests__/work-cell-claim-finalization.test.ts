import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  claimFailureAllowedAfterPrepareOutcome,
  completeWorkCellPhaseClaim,
  COMPLETE_WORK_CELL_PHASE_CLAIM_RPC,
  createMemoryWorkCellPhaseClaim,
  decideStaleWorkCellPhaseClaimReclaim,
  expireStaleRunningWorkCellPhaseClaim,
  failWorkCellPhaseClaim,
  FAIL_WORK_CELL_PHASE_CLAIM_RPC,
  failWorkCellPhaseClaimBlockedReason,
  WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
} from "@/lib/execution-economics-adapter";
import { PUBLIC_WEB_RESEARCHER_KEY } from "@/lib/public-web-researcher";

const HASH = "a".repeat(64);
const NOW = "2026-09-10T12:00:00.000Z";
const STALE = "2026-09-10T12:03:00.000Z";
const ARTIFACT = "artifact-packet-0001";

const claimInput = {
  organizationId: "org-loadout-internal-qa",
  tenantId: "org-loadout-internal-qa",
  runId: "run-claim-finalization-0001",
  phase: "prepare" as const,
  assignmentId: "assign-claim-finalization-0001",
  executorKey: PUBLIC_WEB_RESEARCHER_KEY,
  capabilityKey: "public_web_retrieval",
  inputManifestContentHash: HASH,
  envelopeHash: HASH,
  contextHash: HASH,
  now: NOW,
};

function sliceFn(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end);
}

describe("work-cell claim finalization — authoritative RPC path", () => {
  it("production TypeScript calls fail_work_cell_phase_claim and complete_work_cell_phase_claim", () => {
    const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const failFn = sliceFn(
      workCell,
      "async function failWorkCellPhaseClaim(",
      "async function rpcCompleteWorkCellPhaseClaim(",
    );
    const completeFn = sliceFn(
      workCell,
      "async function rpcCompleteWorkCellPhaseClaim(",
      "async function expireStaleRunningWorkCellPhaseClaim(",
    );
    expect(failFn).toMatch(/db\.rpc\(FAIL_WORK_CELL_PHASE_CLAIM_RPC/);
    expect(completeFn).toMatch(/db\.rpc\(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC/);
    expect(failFn).not.toMatch(/\.from\("run_executor_assignments"\)/);
    expect(completeFn).not.toMatch(/\.from\("run_executor_assignments"\)\.update/);
    expect(workCell).toMatch(`FAIL_WORK_CELL_PHASE_CLAIM_RPC`);
    expect(workCell).toMatch(`COMPLETE_WORK_CELL_PHASE_CLAIM_RPC`);
    expect(FAIL_WORK_CELL_PHASE_CLAIM_RPC).toBe("fail_work_cell_phase_claim");
    expect(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC).toBe("complete_work_cell_phase_claim");
    expect(workCell).not.toMatch(/claimFailureMetadata/);
  });

  it("native prepare uses the packet-safe fail guard and packet-aware reclaim", () => {
    const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = workCell.slice(
      workCell.indexOf("export async function runNativePublicWebPrepare"),
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn).toMatch(/claimFailureAllowedAfterPrepareOutcome/);
    expect(nativeFn).toMatch(/acceptedCatalogPacketPersisted/);
    expect(nativeFn.lastIndexOf("acceptedCatalogPacketPersisted = true")).toBeGreaterThan(
      nativeFn.lastIndexOf("persistPhaseArtifact"),
    );
    expect(nativeFn.lastIndexOf("commitDeferredGovernedReservations")).toBeLessThan(
      nativeFn.lastIndexOf("completeWorkCellPhaseClaim"),
    );
    expect(nativeFn).toMatch(/expireStaleRunningWorkCellPhaseClaim/);
    const expireFn = sliceFn(
      workCell,
      "async function expireStaleRunningWorkCellPhaseClaim(",
      "async function insertEvidenceArtifact(",
    );
    expect(expireFn).toMatch(/decideStaleWorkCellPhaseClaimReclaim/);
    expect(expireFn).toMatch(/CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION/);
    expect(expireFn).toMatch(/action === "complete"/);
    expect(expireFn).toMatch(/Never fail an accepted packet/);
    expect(nativeFn.lastIndexOf("claimFailureAllowedAfterPrepareOutcome")).toBeLessThan(
      nativeFn.lastIndexOf("failWorkCellPhaseClaim"),
    );
  });

  it("authoritative SQL enforces manager role, packet-safe fail, and idempotent complete", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260910220000_work_cell_phase_claim_finalization_v1.sql"),
      "utf8",
    );
    expect(sql).toMatch(/DROP FUNCTION ONLY|REPLACE\/DROP FUNCTIONS ONLY/);
    expect(sql).toMatch(/drop function if exists public\.fail_work_cell_phase_claim/);
    expect(sql).toMatch(/drop function if exists public\.complete_work_cell_phase_claim/);
    expect(sql).toMatch(/coalesce\(public\.is_ops_manager\(\), false\) is not true/);
    expect(sql).toMatch(/catalog-evidence-packet\/v1/);
    expect(sql).toMatch(/refusing to fail the work-cell phase claim/);
    expect(sql).toMatch(/A completed work-cell phase assignment cannot be overwritten/);
    expect(sql).toMatch(/A failed work-cell phase assignment cannot be completed/);
    expect(sql).toMatch(/and output_artifact_id is null/);
    expect(sql).toMatch(/and output_artifact_id is not null/);
    expect(sql).toMatch(/OWNER_BLOCKED/);
    expect(sql).toMatch(/evidence_artifacts plus open reservations on existing/);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).toMatch(/revoke execute on function public\.fail_work_cell_phase_claim[\s\S]*from anon/);
    expect(sql).toMatch(/revoke execute on function public\.complete_work_cell_phase_claim[\s\S]*from anon/);
  });
});

describe("work-cell claim finalization — crash and reclaim windows", () => {
  it("refuses to fail after an accepted packet is persisted even if complete fails", async () => {
    expect(
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: false,
        acceptedCatalogPacketPersisted: true,
      }),
    ).toBe(false);
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const economicsCommitted = true;
    const completeFailed = true;
    const allowed = claimFailureAllowedAfterPrepareOutcome({
      assignmentAlreadyTerminal: false,
      acceptedCatalogPacketPersisted: true,
    });
    expect(economicsCommitted).toBe(true);
    expect(completeFailed).toBe(true);
    expect(allowed).toBe(false);
    const failed = await failWorkCellPhaseClaim(store.fail, {
      ...claimInput,
      reason: "complete RPC failed after commit",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failures.join(" ")).toMatch(/accepted catalog evidence packet/);
    expect([...store.records.values()][0]?.status).toBe("running");
    expect([...store.records.values()][0]?.acceptedCatalogPacketExists).toBe(true);
  });

  it("process death after economics commit and before complete leaves running; stale reclaim completes", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    expect([...store.records.values()][0]?.status).toBe("running");
    expect(
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: false,
        acceptedCatalogPacketPersisted: true,
      }),
    ).toBe(false);

    const tooSoon = await expireStaleRunningWorkCellPhaseClaim(store.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: NOW,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(tooSoon.ok).toBe(true);
    if (tooSoon.ok) expect(tooSoon.value).toBeNull();
    expect([...store.records.values()][0]?.status).toBe("running");

    const reclaimed = await expireStaleRunningWorkCellPhaseClaim(store.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: STALE,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) expect(reclaimed.value?.status).toBe("completed");
    expect([...store.records.values()][0]?.status).toBe("completed");
    expect(store.records.size).toBe(1);
  });

  it("stale reclaim after a persisted packet completes and never fetches", async () => {
    expect(
      decideStaleWorkCellPhaseClaimReclaim({
        status: "running",
        createdAt: NOW,
        now: STALE,
        ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
        acceptedCatalogPacketExists: true,
        outputArtifactId: ARTIFACT,
      }),
    ).toBe("complete");
    expect(
      decideStaleWorkCellPhaseClaimReclaim({
        status: "running",
        createdAt: NOW,
        now: STALE,
        ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
        acceptedCatalogPacketExists: false,
        outputArtifactId: null,
      }),
    ).toBe("fail");
  });

  it("repeated complete and fail calls are idempotent and never overwrite completed", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const first = await completeWorkCellPhaseClaim(store.complete, claimInput);
    const second = await completeWorkCellPhaseClaim(store.complete, claimInput);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.status).toBe("completed");
      expect(second.value.status).toBe("completed");
    }
    const failed = await failWorkCellPhaseClaim(store.fail, {
      ...claimInput,
      reason: "repeat fail after complete",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failures.join(" ")).toMatch(/completed/);
    expect([...store.records.values()][0]?.status).toBe("completed");

    const failStore = createMemoryWorkCellPhaseClaim();
    expect((await failStore.claim(claimInput)).ok).toBe(true);
    const firstFail = await failWorkCellPhaseClaim(failStore.fail, { ...claimInput, reason: "first" });
    const secondFail = await failWorkCellPhaseClaim(failStore.fail, { ...claimInput, reason: "second" });
    expect(firstFail.ok).toBe(true);
    expect(secondFail.ok).toBe(true);
    if (firstFail.ok && secondFail.ok) {
      expect(firstFail.value.status).toBe("failed");
      expect(secondFail.value.status).toBe("failed");
    }
    const cannotComplete = await completeWorkCellPhaseClaim(failStore.complete, claimInput);
    expect(cannotComplete.ok).toBe(false);
    if (!cannotComplete.ok) expect(cannotComplete.failures.join(" ")).toMatch(/cannot be completed/);
  });

  it("failure after one deferred commit and before remaining commits cannot fail an accepted packet", () => {
    expect(
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: false,
        acceptedCatalogPacketPersisted: true,
      }),
    ).toBe(false);
    expect(
      failWorkCellPhaseClaimBlockedReason({
        status: "running",
        acceptedCatalogPacketExists: true,
        outputArtifactId: ARTIFACT,
      }),
    ).toMatch(/accepted catalog evidence packet/);
    expect(
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: false,
        acceptedCatalogPacketPersisted: false,
      }),
    ).toBe(true);
  });

  it("completion failure must not convert a committed successful packet into a failed claim", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const completeOnce = async () => ({
      ok: false as const,
      failures: ["complete RPC failed after economics commit"],
    });
    const failedComplete = await completeWorkCellPhaseClaim(completeOnce, claimInput);
    expect(failedComplete.ok).toBe(false);
    expect(
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: false,
        acceptedCatalogPacketPersisted: true,
      }),
    ).toBe(false);
    const failed = await failWorkCellPhaseClaim(store.fail, {
      ...claimInput,
      reason: "must not convert accepted packet into failed claim",
    });
    expect(failed.ok).toBe(false);
    expect([...store.records.values()][0]?.status).toBe("running");
    const reclaimed = await expireStaleRunningWorkCellPhaseClaim(store.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: STALE,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) expect(reclaimed.value?.status).toBe("completed");
  });
});
