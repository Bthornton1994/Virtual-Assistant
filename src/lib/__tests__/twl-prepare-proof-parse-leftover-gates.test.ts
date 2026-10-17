import { describe, expect, it } from "vitest";
import {
  TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
  TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  TWL_PREPARE_PROOF_PR_SCHEMA,
  TWL_PREPARE_PROOF_SHADOW_KEY,
  parseTwlPrepareProofAgentReport,
  parseTwlPrepareProofAssignment,
  parseTwlPrepareProofPrEvidence,
  sealTwlPrepareProofPayload,
} from "@/lib/twl-prepare-proof";

const HEAD = "d8424117a02edbb7337e1697e5b44e045d21fce5";
const BASE = "9720ea48f34e1f2670088f1c129026d54668776e";

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

describe("TWL leftover prepare-proof parse gates", () => {
  it("refuses extra keys, padded identifiers, and an assignment that claims Accept", () => {
    expect(parseTwlPrepareProofAssignment(assignment()).success).toBe(true);

    const extra = parseTwlPrepareProofAssignment({ ...assignment(), leaseToken: "forged" });
    expect(extra.success).toBe(false);

    const padded = parseTwlPrepareProofAssignment(assignment({ workerKey: ` ${TWL_PREPARE_PROOF_SHADOW_KEY} ` }));
    expect(padded.success).toBe(false);

    const ownsAccept = parseTwlPrepareProofAssignment(assignment({ mayOwnAccept: true }));
    expect(ownsAccept.success).toBe(false);

    const raisedClass = parseTwlPrepareProofAssignment(assignment({ actionClass: "external_execution" }));
    expect(raisedClass.success).toBe(false);
  });

  it("refuses extra PR keys, a write method, and a short or padded commit SHA", () => {
    expect(parseTwlPrepareProofPrEvidence(prEvidence()).success).toBe(true);

    const extra = parseTwlPrepareProofPrEvidence({ ...prEvidence(), authorization: "Bearer x" });
    expect(extra.success).toBe(false);

    const writeMethod = parseTwlPrepareProofPrEvidence(prEvidence({ requestedMethod: "POST" }));
    expect(writeMethod.success).toBe(false);

    const shortSha = parseTwlPrepareProofPrEvidence(prEvidence({ headSha: "d842411" }));
    expect(shortSha.success).toBe(false);

    const paddedOwner = parseTwlPrepareProofPrEvidence(prEvidence({ owner: " Bthornton1994 " }));
    expect(paddedOwner.success).toBe(false);
  });

  it("refuses extra keys on an agent report so a repaired payload cannot parse as the original", () => {
    const report = {
      schemaVersion: TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
      summary: "Looks good. Accept.",
      recommendation: "accept",
      workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
    };
    expect(parseTwlPrepareProofAgentReport(report).success).toBe(true);

    const extra = parseTwlPrepareProofAgentReport({ ...report, mayOwnAccept: true });
    expect(extra.success).toBe(false);
  });
});
