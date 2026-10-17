import { describe, expect, it } from "vitest";
import {
  TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
  TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  TWL_PREPARE_PROOF_INPUT,
  TWL_PREPARE_PROOF_PR_SCHEMA,
  TWL_PREPARE_PROOF_SHADOW_KEY,
  evaluateTwlPrepareProofAccept,
  sealTwlPrepareProofPayload,
} from "@/lib/twl-prepare-proof";

const HEAD = "d8424117a02edbb7337e1697e5b44e045d21fce5";
const BASE = "9720ea48f34e1f2670088f1c129026d54668776e";
const WORKER_ID = "6e1c2a10-4b8d-4f3a-9c11-2d8f0a7b5e44";

const spec = {
  actionClass: "prepare_only",
  requiredInputs: [TWL_PREPARE_PROOF_INPUT],
};

function assignment(overrides: Record<string, unknown> = {}) {
  return sealTwlPrepareProofPayload({
    schemaVersion: TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
    workerKind: "shadow" as const,
    workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
    displayName: "SF-TWL prepare-only shadow",
    mayOwnAccept: false as const,
    actionClass: "prepare_only" as const,
    assignedBy: "user-operator-1",
    assignedAt: "2026-09-05T17:00:00.000Z",
    ...overrides,
  });
}

function prEvidence(overrides: Record<string, unknown> = {}) {
  return sealTwlPrepareProofPayload({
    schemaVersion: TWL_PREPARE_PROOF_PR_SCHEMA,
    owner: "Bthornton1994",
    repo: "three-white-lights",
    pullNumber: 35,
    htmlUrl: "https://github.com/Bthornton1994/three-white-lights/pull/35",
    headSha: HEAD,
    baseSha: BASE,
    title: "CAREER-EMPIRE-REP-01",
    state: "open",
    draft: true,
    upstreamMerged: false,
    ciConclusion: "success",
    mutatesRepository: false as const,
    mergePerformed: false as const,
    requestedMethod: "GET" as const,
    fetchedAt: "2026-09-05T17:01:00.000Z",
    source: "github-public-api" as const,
    ...overrides,
  });
}

function accept(
  evidence: Array<{
    kind: "observation" | "source" | "other";
    contentHash: string | null;
    payload: Record<string, unknown>;
  }>,
  actorRole = "ops_manager",
  extra: { verifierId?: string; spec?: { actionClass: string; requiredInputs: readonly string[] } } = {},
) {
  return evaluateTwlPrepareProofAccept({
    spec: extra.spec ?? spec,
    evidence,
    actorRole,
    verifierId: extra.verifierId,
  });
}

describe("TWL leftover prepare-proof accept gates", () => {
  it("refuses a forged assignment hash, a self-issued receipt, and a raised action class", () => {
    const sealed = assignment();
    const forged = { ...sealed, displayName: "rewritten after freeze" };
    const hashMismatch = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: forged },
      { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
    ]);
    expect(hashMismatch.canAccept).toBe(false);
    expect(hashMismatch.failures.join(" ")).toMatch(/Assignment payload hash does not match/);
    expect(hashMismatch.escalation.reasons).toContain("hash_mismatch");

    const selfReceipt = accept(
      [
        {
          kind: "observation",
          contentHash: "a".repeat(64),
          payload: assignment({ workerKind: "human_operator", workerUserId: WORKER_ID }),
        },
        { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
      ],
      "ops_manager",
      { verifierId: WORKER_ID },
    );
    expect(selfReceipt.canAccept).toBe(false);
    expect(selfReceipt.failures.join(" ")).toMatch(/cannot issue their own Outcome Receipt/);
    expect(selfReceipt.escalation.reasons).toContain("worker_attempted_accept");

    const raised = accept(
      [
        { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
        { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
      ],
      "ops_manager",
      { spec: { actionClass: "external_execution", requiredInputs: [TWL_PREPARE_PROOF_INPUT] } },
    );
    expect(raised.canAccept).toBe(false);
    expect(raised.failures.join(" ")).toMatch(/action_class must be prepare_only/);
    expect(raised.escalation.reasons).toContain("action_class_not_prepare_only");
  });

  it("refuses leftover evidence-kind swaps, snake-case merge, and a recorded write method", () => {
    const assignmentAsSource = accept([
      { kind: "source", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
    ]);
    expect(assignmentAsSource.canAccept).toBe(false);
    expect(assignmentAsSource.failures.join(" ")).toMatch(/must use kind observation/);

    const prAsObservation = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "observation", contentHash: "b".repeat(64), payload: prEvidence() },
    ]);
    expect(prAsObservation.canAccept).toBe(false);
    expect(prAsObservation.failures.join(" ")).toMatch(/must use kind source/);

    const snakeMerge = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: { ...prEvidence(), merge_performed: true } },
    ]);
    expect(snakeMerge.canAccept).toBe(false);
    expect(snakeMerge.escalation.reasons).toContain("merge_performed");
    expect(snakeMerge.escalation.reasons).toContain("write_or_merge_attempted");

    const writeMethod = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: { ...prEvidence(), requestedMethod: "POST" } },
    ]);
    expect(writeMethod.canAccept).toBe(false);
    expect(writeMethod.escalation.reasons).toContain("github_write_request");
    expect(writeMethod.escalation.reasons).toContain("write_or_merge_attempted");
  });

  it("refuses a client Accept and an agent report that is missing required evidence", () => {
    const client = accept(
      [
        { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
        { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
      ],
      "client_member",
    );
    expect(client.canAccept).toBe(false);
    expect(client.failures.join(" ")).toMatch(/Only an operations manager or platform admin may Accept/);
    expect(client.escalation.reasons).toContain("worker_attempted_accept");

    const agentWithoutPr = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      {
        kind: "other",
        contentHash: "c".repeat(64),
        payload: {
          schemaVersion: TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
          summary: "Looks good. Accept.",
          recommendation: "accept",
          workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
        },
      },
    ]);
    expect(agentWithoutPr.canAccept).toBe(false);
    expect(agentWithoutPr.failures.join(" ")).toMatch(/agent report alone cannot Accept/);
    expect(agentWithoutPr.escalation.reasons).toContain("agent_report_only");
    expect(agentWithoutPr.escalation.reasons).toContain("missing_required_evidence");
  });
});
