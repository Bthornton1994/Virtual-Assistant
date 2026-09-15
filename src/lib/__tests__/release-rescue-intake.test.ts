import { describe, expect, it } from "vitest";
import {
  MAX_GRANT_WINDOW_DAYS,
  RELEASE_RESCUE_OFFER,
  RETENTION_DAYS,
  evaluateIntake,
  findProhibitedClaims,
  freezeScope,
  pinReviewedCommit,
  hashScope,
  releaseRescueIntakeV1Schema,
} from "@/lib/release-rescue-intake";
import { COMMIT_SHA, makeIntake, makeScope } from "@/lib/__tests__/release-rescue-fixtures";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function refusalCodes(input: unknown, now: Date = NOW): string[] {
  const decision = evaluateIntake(input, now);
  return decision.accepted ? [] : decision.refusals.map((refusal) => refusal.code);
}

describe("release rescue intake boundary", () => {
  it("accepts a complete, in-scope submission", () => {
    const decision = evaluateIntake(makeIntake(), NOW);

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.acceptedServices).toEqual(["release_readiness_review"]);
    expect(decision.declinedServices).toEqual([]);
    expect(decision.retentionDays).toBe(RETENTION_DAYS.minimum_7_day);
    // No scope hash yet: the commit is not known until the snapshot is taken.
    expect(decision.intake.repository).not.toHaveProperty("commitSha");
  });

  it("declines out-of-scope services without rejecting the engagement", () => {
    const decision = evaluateIntake(
      makeIntake({ requestedServices: ["release_readiness_review", "penetration_test", "compliance_certification"] }),
      NOW,
    );

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.acceptedServices).toEqual(["release_readiness_review"]);
    expect(decision.declinedServices.map((entry) => entry.service)).toEqual([
      "penetration_test",
      "compliance_certification",
    ]);
    for (const declined of decision.declinedServices) {
      expect(declined.reason.length).toBeGreaterThan(20);
    }
  });

  it("refuses a submission that asks for nothing in scope", () => {
    expect(refusalCodes(makeIntake({ requestedServices: ["penetration_test"] }))).toContain(
      "no_in_scope_service_requested",
    );
  });

  it("keeps remediation implementation out of the review", () => {
    const decision = evaluateIntake(
      makeIntake({ requestedServices: ["release_readiness_review", "remediation_implementation"] }),
      NOW,
    );

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.declinedServices.map((entry) => entry.service)).toContain("remediation_implementation");
  });

  it("refuses an intake where any attestation is missing or false", () => {
    const attestations = makeIntake().attestations as Record<string, boolean>;

    for (const key of Object.keys(attestations)) {
      const codes = refusalCodes(
        makeIntake({ attestations: { ...attestations, [key]: false } }),
      );
      expect(codes, key).toContain("schema_violation");
    }
  });

  it("refuses a repository reference that carries a credential", () => {
    const repository = makeScope().repository;

    for (const badRef of [
      "https://user:token@github.com/acme/app",
      "git@github.com:acme/app.git",
      "https://github.com/acme/app",
      "acme",
    ]) {
      const codes = refusalCodes(makeIntake({ repository: { ...repository, repositoryRef: badRef } }));
      expect(codes, badRef).toContain("schema_violation");
    }
  });

  it("refuses a commit sha at intake, where it cannot yet be known", () => {
    const repository = makeIntake().repository as Record<string, unknown>;

    expect(refusalCodes(makeIntake({ repository: { ...repository, commitSha: "a".repeat(40) } }))).toContain(
      "schema_violation",
    );
  });

  it("requires a full commit sha when the reviewed commit is pinned", () => {
    const scope = freezeScope(releaseRescueIntakeV1Schema.parse(makeIntake()));

    expect(() => pinReviewedCommit(scope, "abc1234")).toThrow();
    expect(() => pinReviewedCommit(scope, "A".repeat(40))).toThrow();
    expect(pinReviewedCommit(scope, "a".repeat(40)).reviewedCommitSha).toBe("a".repeat(40));
  });

  it("freezes a scope that carries no commit, because none exists yet", () => {
    // The whole point of the split: at intake the customer has granted nothing,
    // so there is no commit to freeze. A scope schema that demanded one made the
    // engagement row unwritable at the only moment it could legally be written.
    const scope = freezeScope(releaseRescueIntakeV1Schema.parse(makeIntake()));

    expect(scope.repository).not.toHaveProperty("commitSha");
  });

  it("pins the commit against the scope hash the engagement already stored", () => {
    // This is the binding that was broken: hashScope had to be computed over a
    // scope containing a commit, so it could never equal the hash written at
    // intake. Now the two are the same value by construction.
    const scope = freezeScope(releaseRescueIntakeV1Schema.parse(makeIntake()));
    const pinned = pinReviewedCommit(scope, COMMIT_SHA);

    expect(pinned.scopeHash).toBe(hashScope(scope));
  });

  it("does not change the scope hash when a different commit is pinned", () => {
    // Two reviews of the same agreement at different commits share a scope hash.
    // That is correct — the agreement is the same — and it is why the commit has
    // to be recorded somewhere other than the scope.
    const scope = freezeScope(releaseRescueIntakeV1Schema.parse(makeIntake()));

    expect(pinReviewedCommit(scope, "a".repeat(40)).scopeHash).toBe(
      pinReviewedCommit(scope, "b".repeat(40)).scopeHash,
    );
  });

  it("refuses an access grant that has already expired", () => {
    expect(refusalCodes(makeIntake({ grantExpiresAt: "2026-09-14T12:00:00.000Z" }))).toContain(
      "grant_window_invalid",
    );
  });

  it("refuses an access grant longer than the maximum window", () => {
    const tooLong = new Date(Date.UTC(2026, 8, 15, 12) + (MAX_GRANT_WINDOW_DAYS + 1) * 86_400_000).toISOString();

    expect(refusalCodes(makeIntake({ grantExpiresAt: tooLong }))).toContain("grant_window_too_long");
  });

  it("refuses an unknown retention policy", () => {
    expect(refusalCodes(makeIntake({ retentionPolicy: "forever" }))).toContain("schema_violation");
  });

  it("holds every retention election inside the maximum", () => {
    for (const days of Object.values(RETENTION_DAYS)) {
      expect(days).toBeLessThanOrEqual(30);
      expect(days).toBeGreaterThanOrEqual(0);
    }
  });

  it("rejects unknown fields rather than silently dropping them", () => {
    expect(refusalCodes(makeIntake({ internalNotes: "charge them more" }))).toContain("schema_violation");
  });

  it("freezes and hashes scope deterministically and independently of key order", () => {
    const intake = releaseRescueIntakeV1Schema.parse(makeIntake());
    const scope = freezeScope(intake);
    const reordered = {
      aiAssistedReviewAccepted: scope.aiAssistedReviewAccepted,
      customerExclusions: scope.customerExclusions,
      criticalWorkflow: scope.criticalWorkflow,
      application: scope.application,
      repository: scope.repository,
      offerVersion: scope.offerVersion,
    };

    expect(hashScope(scope)).toBe(hashScope(reordered as typeof scope));
  });

  it("changes the scope hash when the agreed repository changes", () => {
    const scope = makeScope();
    const other = makeScope({ repository: { ...scope.repository, repositoryRef: "acme/other-app" } });

    expect(hashScope(scope)).not.toBe(hashScope(other));
  });

  it("names the offer's commercial terms in one place", () => {
    expect(RELEASE_RESCUE_OFFER.reviewPriceCents).toBe(29_900);
    expect(RELEASE_RESCUE_OFFER.remediationSprintPriceCents).toBe(125_000);
    expect(RELEASE_RESCUE_OFFER.scopeCeiling).toEqual({ repositories: 1, applications: 1, criticalWorkflows: 1 });
  });

  it("detects the claims this offer must never make", () => {
    expect(findProhibitedClaims("A full penetration test of your app")).toContain("penetration test");
    expect(findProhibitedClaims("We provide a SECURITY GUARANTEE")).toContain("security guarantee");
    expect(findProhibitedClaims("A structured release-readiness review")).toEqual([]);
  });

  it("permits the required denials, which necessarily contain the phrases", () => {
    // These four sentences are the disclaimers the customer must receive. A
    // checker that flagged them would make the correct copy unshippable.
    for (const denial of [
      "This review is not a penetration test.",
      "This review is not a compliance certification.",
      "This review does not guarantee the absence of vulnerabilities.",
      "It is not a compliance certification (SOC 2, ISO 27001, or any other standard).",
      "We do not offer a security guarantee.",
      "Unlike a penetration test, this review reads source rather than attacking a running system.",
      "Customers who need penetration testing should engage qualified specialists.",
    ]) {
      expect(findProhibitedClaims(denial), denial).toEqual([]);
    }
  });

  it("still catches an affirmative claim in a sentence that also denies something else", () => {
    const text = "This is not a compliance certification. We do provide a penetration test.";

    expect(findProhibitedClaims(text)).toContain("penetration test");
    expect(findProhibitedClaims(text)).not.toContain("compliance certification");
  });
});
