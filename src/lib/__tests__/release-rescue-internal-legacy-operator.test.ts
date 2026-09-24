import { beforeEach, describe, expect, it, vi } from "vitest";

// An operator registered before the typed-field professional claims were added
// to the claim guard ("penetration tester", "pentester", ...), whose display
// name makes one of them. What each path does with that operator now, as
// docs/RELEASE-RESCUE-INTERNAL.md describes it.
//
// The old rule is simulated by filtering the typed-field claims out of the
// guard's answer while the operator is registered and the report signed, then
// restoring the current rule.

const guard = vi.hoisted(() => ({ legacy: false }));

vi.mock("@/lib/release-rescue-intake", async (original) => {
  const actual = await original<typeof import("@/lib/release-rescue-intake")>();
  const typedOnly = new Set<string>(actual.TYPED_FIELD_PROHIBITED_CLAIMS);
  return {
    ...actual,
    findProhibitedClaims: (...args: Parameters<typeof actual.findProhibitedClaims>) => {
      const found = actual.findProhibitedClaims(...args);
      return guard.legacy ? found.filter((claim) => !typedOnly.has(claim)) : found;
    },
  };
});

import { hashReleaseRescueReviewSubject } from "@/lib/release-rescue-report";
import {
  addOperator,
  authenticateOperator,
  issueSession,
  operatorFromSession,
  removeOperator,
} from "@/lib/release-rescue-internal/local-identity";
import { deliveryForRun, signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { initiatorFromOperator, startInternalRun } from "@/lib/release-rescue-internal/run";
import { loadRun } from "@/lib/release-rescue-internal/store";
import { runSummary } from "@/lib/release-rescue-internal/summary";
import { fixtureAllowlist, makeFixtureRepo, tempDir } from "@/lib/__tests__/release-rescue-internal-fixtures";

const PASSPHRASE = "a long local test passphrase";
const REASON = "reviewed_findings_and_verdict_match_the_recorded_observations";
const LEGACY_NAME = "Certified pentester";

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-legacy-");
  guard.legacy = false;
});

async function draftBy(operator: ReturnType<typeof addOperator>) {
  const repo = makeFixtureRepo({ "src/app.ts": "ok\n" });
  return startInternalRun({
    initiatedBy: initiatorFromOperator(operator),
    repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
    commitSha: repo.commitSha,
    retentionPolicy: "minimum_7_day",
    ownershipConfirmed: true,
    source: { kind: "checkout", path: repo.path },
    allowlist: fixtureAllowlist(),
  });
}

function sign(operator: ReturnType<typeof addOperator>, runId: string) {
  const record = loadRun(runId)!;
  const shown = record.draft ? hashReleaseRescueReviewSubject(record.draft.report) : "0".repeat(64);
  return signRunAsLocalOperator(operator, runId, { reasonCode: REASON, approvedContentHash: shown });
}

describe("an operator whose name the current guard refuses, registered before it", () => {
  it("can sign in, cannot sign, and cannot deliver what they signed before", async () => {
    // Registered, and a report signed, under the old rule.
    guard.legacy = true;
    const legacy = addOperator(LEGACY_NAME, PASSPHRASE);
    const earlier = await draftBy(legacy);
    const signedEarlier = sign(legacy, earlier.runId);
    expect(signedEarlier.ok, "control: the old rule let this name sign").toBe(true);
    guard.legacy = false;

    // Sign-in and a session still work: neither reads the name's content.
    const login = authenticateOperator(LEGACY_NAME, PASSPHRASE);
    expect(login.ok).toBe(true);
    expect(operatorFromSession(issueSession(legacy.operatorId))?.displayName).toBe(LEGACY_NAME);

    // A new signature is refused by the product signer.
    const fresh = await draftBy(legacy);
    const refused = sign(legacy, fresh.runId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("signature_refused");
    expect(loadRun(fresh.runId)!.status).toBe("awaiting_review");

    // The report signed before is withheld at export, and is not delivered.
    const exported = deliveryForRun(earlier.runId);
    expect(exported.status).toBe("withheld");
    if (exported.status === "withheld") expect(exported.blockers.join(" ")).toMatch(/prohibited claim/i);
    expect(loadRun(earlier.runId)!.deliveredAt).toBeNull();

    // It cannot be signed again: it is no longer a draft.
    const again = sign(legacy, earlier.runId);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("not_awaiting_review");

    // The terminal summary still shows the name the report was signed with.
    const summary = runSummary(loadRun(earlier.runId)!) as { createdBy: string; report: { reviewer: string | null } };
    expect(summary.createdBy).toBe(LEGACY_NAME);
    expect(summary.report.reviewer).toBe(LEGACY_NAME);
  });

  it("recovers only by a new operator and a new run: the earlier report stays withheld", async () => {
    guard.legacy = true;
    const legacy = addOperator(LEGACY_NAME, PASSPHRASE);
    const earlier = await draftBy(legacy);
    expect(sign(legacy, earlier.runId).ok).toBe(true);
    guard.legacy = false;

    expect(removeOperator(legacy.operatorId)).toBe(true);
    const replacement = addOperator("Dana Okafor", PASSPHRASE);
    const rerun = await draftBy(replacement);
    expect(sign(replacement, rerun.runId).ok).toBe(true);
    expect(deliveryForRun(rerun.runId).status).toBe("deliverable");

    expect(deliveryForRun(earlier.runId).status).toBe("withheld");
  });
});
