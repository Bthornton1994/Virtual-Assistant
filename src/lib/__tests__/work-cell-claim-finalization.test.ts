import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import {
  claimFailureAllowedAfterPrepareOutcome,
  completeWorkCellPhaseClaim,
  COMPLETE_WORK_CELL_PHASE_CLAIM_RPC,
  createMemoryWorkCellPhaseClaim,
  decideStaleWorkCellPhaseClaimReclaim,
  economicsCommitUnknownOwnerActionFailure,
  expireStaleRunningWorkCellPhaseClaim,
  failWorkCellPhaseClaim,
  FAIL_WORK_CELL_PHASE_CLAIM_RPC,
  failWorkCellPhaseClaimBlockedReason,
  workCellPhaseClaimBoundIdentityFailure,
  WORK_CELL_ECONOMICS_COMMIT_UNKNOWN_OWNER_ACTION,
  WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
  type WorkCellPhaseClaimCompleteFn,
} from "@/lib/execution-economics-adapter";
import { PUBLIC_WEB_RESEARCHER_KEY } from "@/lib/public-web-researcher";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const NOW = "2026-09-10T12:00:00.000Z";
const STALE = "2026-09-10T12:03:00.000Z";
const ARTIFACT = "artifact-packet-0001";
const UNRELATED_PACKET = "artifact-packet-unrelated";

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

const boundCompleteInput = {
  ...claimInput,
  outputArtifactId: ARTIFACT,
  acceptedCatalogPacketExists: true,
  economicsCommitConfirmed: true as const,
  boundPacket: {
    artifactId: ARTIFACT,
    runId: claimInput.runId,
    executorKey: PUBLIC_WEB_RESEARCHER_KEY,
    schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
  },
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
      "function claimIdentityFromAssignment(",
    );
    const completeFn = sliceFn(
      workCell,
      "async function rpcCompleteWorkCellPhaseClaim(",
      "async function expireStaleRunningWorkCellPhaseClaim(",
    );
    expect(failFn).toMatch(/db\.rpc\(FAIL_WORK_CELL_PHASE_CLAIM_RPC/);
    expect(completeFn).toMatch(/db\.rpc\(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC/);
    expect(completeFn).toMatch(/p_output_artifact_id/);
    expect(completeFn).toMatch(/p_input_manifest_content_hash/);
    expect(completeFn).toMatch(/p_envelope_hash/);
    expect(completeFn).toMatch(/p_context_hash/);
    expect(completeFn).toMatch(/p_executor_key/);
    expect(completeFn).toMatch(/p_capability_key/);
    expect(failFn).not.toMatch(/\.from\("run_executor_assignments"\)/);
    expect(completeFn).not.toMatch(/\.from\("run_executor_assignments"\)\.update/);
    expect(workCell).toMatch(`FAIL_WORK_CELL_PHASE_CLAIM_RPC`);
    expect(workCell).toMatch(`COMPLETE_WORK_CELL_PHASE_CLAIM_RPC`);
    expect(FAIL_WORK_CELL_PHASE_CLAIM_RPC).toBe("fail_work_cell_phase_claim");
    expect(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC).toBe("complete_work_cell_phase_claim");
    expect(workCell).not.toMatch(/claimFailureMetadata/);
  });

  it("native prepare uses the packet-safe fail guard and does not reclaim-complete from a packet", () => {
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
    expect(nativeFn).toMatch(/economicsCommitUnknownOwnerActionFailure/);
    expect(nativeFn).toMatch(/deferredCommitFailedAfterAcceptedPacketReason/);
    expect(nativeFn).toMatch(/economicsCommitConfirmed: true/);
    const assignmentIdx = nativeFn.indexOf("getAssignment");
    const runningBranchIdx = nativeFn.indexOf('existingPrepare?.status === "running"');
    const expireIdx = nativeFn.indexOf("expireStaleRunningWorkCellPhaseClaim");
    const packetPrecheckIdx = nativeFn.indexOf("loadTypedArtifact");
    const packetErrorIdx = nativeFn.indexOf("This run already has a frozen catalog evidence packet");
    expect(assignmentIdx).toBeGreaterThan(-1);
    expect(runningBranchIdx).toBeGreaterThan(-1);
    expect(expireIdx).toBeGreaterThan(-1);
    expect(packetPrecheckIdx).toBeGreaterThan(-1);
    expect(packetErrorIdx).toBeGreaterThan(-1);
    expect(assignmentIdx).toBeLessThan(runningBranchIdx);
    expect(runningBranchIdx).toBeLessThan(expireIdx);
    expect(expireIdx).toBeLessThan(packetPrecheckIdx);
    expect(packetPrecheckIdx).toBeLessThan(packetErrorIdx);
    expect(nativeFn.indexOf("bindWorkCellPhase")).toBeGreaterThan(packetErrorIdx);
    expect(nativeFn.indexOf("claimWorkCellPhase")).toBeGreaterThan(expireIdx);
    expect(nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket")).toBeGreaterThan(expireIdx);
    const expireFn = sliceFn(
      workCell,
      "async function expireStaleRunningWorkCellPhaseClaim(",
      "async function insertEvidenceArtifact(",
    );
    const boundLoadFn = sliceFn(
      workCell,
      "async function loadBoundAcceptedCatalogPacketForClaim(",
      "async function rpcCompleteWorkCellPhaseClaim(",
    );
    expect(expireFn).toMatch(/decideStaleWorkCellPhaseClaimReclaim/);
    expect(expireFn).toMatch(/loadBoundAcceptedCatalogPacketForClaim/);
    expect(boundLoadFn).toMatch(/CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION/);
    expect(boundLoadFn).toMatch(/eq\("id", existing.outputArtifactId\)/);
    expect(expireFn).toMatch(/action === "blocked"/);
    expect(expireFn).not.toMatch(/action === "complete"/);
    expect(expireFn).not.toMatch(/completeWorkCellPhaseClaim/);
    expect(expireFn).not.toMatch(/prepareAuthorizedPublicWebEvidencePacket|fetchPage/);
    expect(expireFn).toMatch(/Never complete/);
    expect(expireFn).toMatch(/Never fail an accepted packet/);
    expect(expireFn).not.toMatch(/loadTypedArtifact/);
    expect(nativeFn.lastIndexOf("claimFailureAllowedAfterPrepareOutcome")).toBeLessThan(
      nativeFn.lastIndexOf("failWorkCellPhaseClaim"),
    );
  });

  it("authoritative SQL enforces bound identity complete and packet-safe fail", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260910233000_work_cell_phase_claim_economics_safety_v1.sql"),
      "utf8",
    );
    expect(sql).toMatch(/DROP FUNCTIONS ONLY|REPLACE\/DROP FUNCTIONS ONLY/);
    expect(sql).toMatch(/drop function if exists public\.complete_work_cell_phase_claim/);
    expect(sql).toMatch(/coalesce\(public\.is_ops_manager\(\), false\) is not true/);
    expect(sql).toMatch(/catalog-evidence-packet\/v1/);
    expect(sql).toMatch(/e\.id = p_output_artifact_id/);
    expect(sql).toMatch(/e\.id = v_existing\.output_artifact_id/);
    expect(sql).toMatch(/unbound or unrelated catalog evidence packet/);
    expect(sql).toMatch(/exact bound[\s\S]*claim identity|requires bound claim identity/);
    expect(sql).toMatch(/refusing to fail the work-cell phase claim/);
    expect(sql).toMatch(/A completed work-cell phase assignment cannot be overwritten/);
    expect(sql).toMatch(/A failed work-cell phase assignment cannot be completed/);
    expect(sql).toMatch(/and output_artifact_id is null/);
    expect(sql).toMatch(/OWNER_BLOCKED/);
    expect(sql).toMatch(/evidence_artifacts plus open reservations on existing/);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/jsonb_build_object\('economicsCommit', 'complete'\)/);
    expect(sql).toMatch(/revoke execute on function public\.fail_work_cell_phase_claim[\s\S]*from anon/);
    expect(sql).toMatch(/revoke execute on function public\.complete_work_cell_phase_claim[\s\S]*from anon/);
  });
});

describe("work-cell claim finalization — crash and reclaim windows", () => {
  it("accepted packet plus deferred commit failure leaves running and reclaim does not complete", async () => {
    expect(
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: false,
        acceptedCatalogPacketPersisted: true,
      }),
    ).toBe(false);
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const economicsCommitted = false;
    expect(economicsCommitted).toBe(false);
    const unconfirmed = await completeWorkCellPhaseClaim(store.complete, {
      ...boundCompleteInput,
      economicsCommitConfirmed: false,
    });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) {
      expect(unconfirmed.failures.join(" ")).toMatch(/not economics proof|confirmed process-local economics commit/);
    }
    const failed = await failWorkCellPhaseClaim(store.fail, {
      ...claimInput,
      reason: "deferred commit failed after packet persist",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failures.join(" ")).toMatch(/accepted catalog evidence packet/);
    expect([...store.records.values()][0]?.status).toBe("running");
    expect([...store.records.values()][0]?.acceptedCatalogPacketExists).toBe(true);

    const reclaimed = await expireStaleRunningWorkCellPhaseClaim(store.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: STALE,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(reclaimed.ok).toBe(false);
    if (!reclaimed.ok) {
      expect(reclaimed.failures.join(" ")).toMatch(/OWNER_ACTION_REQUIRED/);
      expect(reclaimed.failures.join(" ")).toMatch(/not economics proof/);
    }
    expect([...store.records.values()][0]?.status).toBe("running");
  });

  it("successful commit then completion failure stays non-terminal, preserves the packet, and retries idempotently", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    let attempts = 0;
    const flakyComplete: WorkCellPhaseClaimCompleteFn = async (input) => {
      attempts += 1;
      if (attempts === 1) {
        return { ok: false as const, failures: ["complete RPC failed after economics commit"] };
      }
      return store.complete(input);
    };
    const first = await completeWorkCellPhaseClaim(flakyComplete, boundCompleteInput);
    expect(first.ok).toBe(false);
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
    expect([...store.records.values()][0]?.outputArtifactId).toBe(ARTIFACT);

    const retry = await completeWorkCellPhaseClaim(store.complete, boundCompleteInput);
    expect(retry.ok).toBe(true);
    if (retry.ok) expect(retry.value.status).toBe("completed");
    const again = await completeWorkCellPhaseClaim(store.complete, boundCompleteInput);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.status).toBe("completed");
    expect(attempts).toBe(1);
  });

  it("process death after economics commit and before complete cannot reconstruct economics from a packet", async () => {
    const durable = createMemoryWorkCellPhaseClaim();
    expect((await durable.claim(claimInput)).ok).toBe(true);
    durable.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    expect([...durable.records.values()][0]?.status).toBe("running");

    // Restarted isolate: no process-local Maps. Packet presence is not commit proof.
    const restarted = await completeWorkCellPhaseClaim(durable.complete, {
      ...boundCompleteInput,
      economicsCommitConfirmed: false,
    });
    expect(restarted.ok).toBe(false);
    if (!restarted.ok) {
      expect(restarted.failures.join(" ")).toMatch(/not economics proof|confirmed process-local economics commit/);
    }
    expect([...durable.records.values()][0]?.status).toBe("running");

    const tooSoon = await expireStaleRunningWorkCellPhaseClaim(durable.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: NOW,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(tooSoon.ok).toBe(true);
    if (tooSoon.ok) expect(tooSoon.value).toBeNull();

    const reclaimed = await expireStaleRunningWorkCellPhaseClaim(durable.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: STALE,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(reclaimed.ok).toBe(false);
    if (!reclaimed.ok) {
      expect(reclaimed.failures.join(" ")).toBe(WORK_CELL_ECONOMICS_COMMIT_UNKNOWN_OWNER_ACTION);
      expect(reclaimed.failures.join(" ")).toMatch(/OWNER_ACTION_REQUIRED/);
    }
    expect([...durable.records.values()][0]?.status).toBe("running");
    expect(durable.records.size).toBe(1);
  });

  it("stale reclaim after a persisted packet blocks for owner action and never fetches or completes", async () => {
    expect(
      decideStaleWorkCellPhaseClaimReclaim({
        status: "running",
        createdAt: NOW,
        now: STALE,
        ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
        acceptedCatalogPacketExists: true,
        outputArtifactId: ARTIFACT,
      }),
    ).toBe("blocked");
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
    expect(economicsCommitUnknownOwnerActionFailure(["res-1", "res-2"])).toMatch(/Reservation IDs: res-1, res-2/);
    expect(WORK_CELL_ECONOMICS_COMMIT_UNKNOWN_OWNER_ACTION).toMatch(/OWNER_BLOCKED:/);
    expect(WORK_CELL_ECONOMICS_COMMIT_UNKNOWN_OWNER_ACTION).toMatch(/not economics proof/);
  });

  it("unrelated catalog packet and mismatched identity cannot complete the current claim", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    const fromUnrelated = await completeWorkCellPhaseClaim(store.complete, {
      ...boundCompleteInput,
      outputArtifactId: UNRELATED_PACKET,
      boundPacket: {
        artifactId: UNRELATED_PACKET,
        runId: claimInput.runId,
        executorKey: PUBLIC_WEB_RESEARCHER_KEY,
        schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
      },
    });
    expect(fromUnrelated.ok).toBe(false);
    if (!fromUnrelated.ok) {
      expect(fromUnrelated.failures.join(" ")).toMatch(/output evidence|output artifact/);
    }
    expect([...store.records.values()][0]?.status).toBe("running");

    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const mismatches = [
      { assignmentId: "assign-other" },
      { outputArtifactId: UNRELATED_PACKET },
      { inputManifestContentHash: OTHER_HASH },
      { envelopeHash: OTHER_HASH },
      { contextHash: OTHER_HASH },
      { executorKey: "other-executor" },
      { capabilityKey: "other_capability" },
      {
        boundPacket: {
          artifactId: UNRELATED_PACKET,
          runId: claimInput.runId,
          executorKey: PUBLIC_WEB_RESEARCHER_KEY,
          schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
        },
      },
    ] as const;
    for (const override of mismatches) {
      const rejected = await completeWorkCellPhaseClaim(store.complete, {
        ...boundCompleteInput,
        ...override,
      });
      expect(rejected.ok).toBe(false);
    }
    expect(
      workCellPhaseClaimBoundIdentityFailure({
        existing: {
          ...claimInput,
          outputArtifactId: ARTIFACT,
        },
        presented: { ...claimInput, outputArtifactId: UNRELATED_PACKET },
        boundPacket: {
          artifactId: UNRELATED_PACKET,
          runId: claimInput.runId,
          executorKey: PUBLIC_WEB_RESEARCHER_KEY,
          schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
        },
      }),
    ).toMatch(/output artifact|unrelated catalog evidence packet/);
    expect([...store.records.values()][0]?.status).toBe("running");
  });

  it("repeated complete and fail calls are idempotent only for the same bound identity", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const first = await completeWorkCellPhaseClaim(store.complete, boundCompleteInput);
    const second = await completeWorkCellPhaseClaim(store.complete, boundCompleteInput);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.status).toBe("completed");
      expect(second.value.status).toBe("completed");
    }
    const otherIdentity = await completeWorkCellPhaseClaim(store.complete, {
      ...boundCompleteInput,
      assignmentId: "assign-other",
    });
    expect(otherIdentity.ok).toBe(false);
    const failed = await failWorkCellPhaseClaim(store.fail, {
      ...claimInput,
      reason: "repeat fail after complete",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failures.join(" ")).toMatch(/completed/);
    expect([...store.records.values()][0]?.status).toBe("completed");
    expect([...store.records.values()][0]?.outputArtifactId).toBe(ARTIFACT);

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
    failStore.recordAcceptedPacket(claimInput.runId, "prepare", ARTIFACT);
    const cannotComplete = await completeWorkCellPhaseClaim(failStore.complete, boundCompleteInput);
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
});
