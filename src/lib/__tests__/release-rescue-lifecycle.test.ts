import { describe, expect, it } from "vitest";
import {
  freezeScope,
  hashScope,
  pinReviewedCommit,
  releaseRescueIntakeV1Schema,
  repositoryIntakeSchema,
  repositoryScopeSchema,
} from "@/lib/release-rescue-intake";
import {
  buildReleaseRescueReport,
  hashReleaseRescueReport,
  releaseRescueReportV1Schema,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { toCustomerReportView } from "@/lib/release-rescue-presentation";
import { COMMIT_SHA, makeIntake, makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";

// The engagement lifecycle, at the contract level.
//
// A previous pass recorded a defect it could not fix from any single guard: the
// intended lifecycle could not be EXECUTED. `freezeScope(intake, commitSha)` put
// the reviewed commit inside a scope that is frozen and hashed at intake, while
// the commit is only resolved at the snapshot, which is later. Every individual
// contract was correct; the sequence was impossible.
//
// These tests assert the sequence, not the pieces. The live database proof in
// supabase/qa/release_rescue_lifecycle_v4_proof.sql walks the same path against
// the real schema.

function acceptedIntake() {
  return releaseRescueIntakeV1Schema.parse(makeIntake());
}

describe("the frozen scope holds only what is known at intake", () => {
  it("carries no commit, because the customer has granted nothing yet", () => {
    const scope = freezeScope(acceptedIntake());

    expect(scope.repository).not.toHaveProperty("commitSha");
  });

  it("refuses a commit smuggled into the intake shape", () => {
    const intake = acceptedIntake();
    const smuggled = { ...intake.repository, commitSha: COMMIT_SHA };

    expect(repositoryIntakeSchema.safeParse(smuggled).success).toBe(false);
    expect(repositoryScopeSchema.safeParse(smuggled).success).toBe(false);
  });

  it("hashes to the same value the engagement row stores at intake", () => {
    // The half of the defect nobody had noticed: because the hash was computed
    // over a scope CONTAINING the commit, it could never equal the scope_hash
    // written at intake. The hash that exists to bind a report to its engagement
    // bound nothing. Now the two are the same value by construction.
    const scope = freezeScope(acceptedIntake());

    expect(pinReviewedCommit(scope, COMMIT_SHA).scopeHash).toBe(hashScope(scope));
  });

  it("gives two reviews of the same agreement the same scope hash", () => {
    // Which is correct: the agreement is the same. It is also precisely why the
    // commit cannot live in the scope — the identity of the agreement must not
    // depend on which tree we happened to read.
    const scope = freezeScope(acceptedIntake());

    expect(pinReviewedCommit(scope, "a".repeat(40)).scopeHash).toBe(
      pinReviewedCommit(scope, "b".repeat(40)).scopeHash,
    );
  });
});

describe("the reviewed commit is pinned once, later, and separately", () => {
  it("must be a full lowercase sha", () => {
    const scope = freezeScope(acceptedIntake());

    for (const bad of ["", "abc1234", "A".repeat(40), "g".repeat(40), `${COMMIT_SHA}0`]) {
      expect(() => pinReviewedCommit(scope, bad), bad).toThrow();
    }
    expect(pinReviewedCommit(scope, COMMIT_SHA).reviewedCommitSha).toBe(COMMIT_SHA);
  });

  it("reaches the report as its own field, not as part of the scope", () => {
    const report = buildReleaseRescueReport(makeReportInput({ reviewedCommitSha: COMMIT_SHA }));

    expect(report.reviewedCommitSha).toBe(COMMIT_SHA);
    expect(report.scope.repository).not.toHaveProperty("commitSha");
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("is required: a report that cannot name what it read does not parse", () => {
    const report = buildReleaseRescueReport(makeReportInput({ reviewedCommitSha: COMMIT_SHA }));
    const without: Record<string, unknown> = { ...report };
    delete without.reviewedCommitSha;

    expect(releaseRescueReportV1Schema.safeParse(without).success).toBe(false);
    expect(validateReleaseRescueReport(without).hardGatePass).toBe(false);
  });

  it("is what the customer sees as the reviewed commit", () => {
    const report = buildReleaseRescueReport(makeReportInput({ reviewedCommitSha: COMMIT_SHA }));

    expect(toCustomerReportView(report).scope.commitSha).toBe(COMMIT_SHA);
  });

  it("changes the report hash, so two commits are two reports", () => {
    const a = buildReleaseRescueReport(makeReportInput({ reviewedCommitSha: "a".repeat(40) }));
    const b = buildReleaseRescueReport(makeReportInput({ reviewedCommitSha: "b".repeat(40) }));

    expect(hashReleaseRescueReport(a)).not.toBe(hashReleaseRescueReport(b));
    // ...while their engagements remain the same agreement.
    expect(a.scopeHash).toBe(b.scopeHash);
  });
});

describe("the sequence intake -> freeze -> snapshot -> pin -> report runs end to end", () => {
  it("executes without any step needing a fact from a later one", () => {
    // The test the old contract could not pass. Each line uses only what exists
    // at that point in the engagement.
    const intake = acceptedIntake();

    // 1. Intake: the agreement is frozen and hashed. No commit exists.
    const scope = freezeScope(intake);
    const scopeHash = hashScope(scope);

    // 2. Snapshot: the commit becomes a fact for the first time.
    const snapshottedCommit = COMMIT_SHA;

    // 3. Pin: bound to the scope hash that was already stored at step 1.
    const target = pinReviewedCommit(scope, snapshottedCommit);
    expect(target.scopeHash).toBe(scopeHash);

    // 4. Report: names both, and validates.
    const report = buildReleaseRescueReport(
      makeReportInput({ scope, reviewedCommitSha: target.reviewedCommitSha }),
    );

    expect(report.scopeHash).toBe(scopeHash);
    expect(report.reviewedCommitSha).toBe(snapshottedCommit);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });
});
