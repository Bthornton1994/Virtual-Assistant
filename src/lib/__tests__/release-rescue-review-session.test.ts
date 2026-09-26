import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/domain";
import { decideReleaseRescueDelivery } from "@/lib/release-rescue-delivery";
import {
  buildReleaseRescueReport,
  hashReleaseRescueReviewSubject,
  type ReleaseRescueReportV1,
} from "@/lib/release-rescue-report";
import {
  ReviewSubmissionError,
  ReviewerNotAuthorizedError,
  attestationFromAuthenticatedReviewer,
  authenticatedReviewerFrom,
  reviewSubmissionSchema,
  signReleaseRescueReportAs,
} from "@/lib/release-rescue-review-session";
import { FIXTURE_OPERATOR_ID, makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";

// The reviewer is whoever is signed in (DECISION_LOG.md D-017).
//
// `signReleaseRescueReport` verifies everything about an attestation except who
// is asking. These tests are about the layer that answers that question from
// the session and refuses to let the request answer it instead.

const MANAGER: Actor = {
  id: FIXTURE_OPERATOR_ID,
  email: "sam@example.test",
  name: "Sam Okafor, operations manager",
  role: "ops_manager",
  organizationId: null,
  operatorId: "op-1",
  source: "supabase",
};

const OTHER_MANAGER_ID = "4f82b1a7-6c95-4d30-ae18-73b2e9f01c64";
const REVIEWED_AT = new Date("2026-09-18T10:00:00.000Z");

function draft(): ReleaseRescueReportV1 {
  return buildReleaseRescueReport(makeReportInput({ reviewedBy: null }));
}

function submissionFor(report: ReleaseRescueReportV1) {
  return {
    reasonCode: "reviewed_findings_and_verdict_match_the_recorded_observations",
    approvedContentHash: hashReleaseRescueReviewSubject(report),
  };
}

describe("the submission carries a decision and no identity", () => {
  it("accepts a reason code and the approved hash", () => {
    expect(reviewSubmissionSchema.safeParse(submissionFor(draft())).success).toBe(true);
  });

  it("refuses a submission that names a reviewer, by any of the identity fields", () => {
    const base = submissionFor(draft());
    for (const smuggled of [
      { operatorUserId: OTHER_MANAGER_ID },
      { displayName: "Reviewed by ThisAppIsSecure" },
      { reviewedAt: "2020-01-01T00:00:00.000Z" },
      { reviewedBy: { operatorUserId: OTHER_MANAGER_ID } },
    ]) {
      const result = reviewSubmissionSchema.safeParse({ ...base, ...smuggled });
      expect(result.success, JSON.stringify(smuggled)).toBe(false);
    }
  });

  it("refuses a reason that is not a catalog code, and a hash that is not a hash", () => {
    const base = submissionFor(draft());
    expect(reviewSubmissionSchema.safeParse({ ...base, reasonCode: "looks fine to me" }).success).toBe(false);
    expect(reviewSubmissionSchema.safeParse({ ...base, reasonCode: "" }).success).toBe(false);
    expect(reviewSubmissionSchema.safeParse({ ...base, approvedContentHash: "abc" }).success).toBe(false);
    expect(reviewSubmissionSchema.safeParse({ ...base, approvedContentHash: "A".repeat(64) }).success).toBe(false);
  });
});

describe("the reviewer comes from the session", () => {
  it("is the authenticated manager's id and name", () => {
    expect(authenticatedReviewerFrom(MANAGER)).toEqual({
      operatorUserId: FIXTURE_OPERATOR_ID,
      displayName: "Sam Okafor, operations manager",
    });
  });

  it("accepts a platform admin", () => {
    expect(authenticatedReviewerFrom({ ...MANAGER, role: "platform_admin" }).operatorUserId).toBe(FIXTURE_OPERATOR_ID);
  });

  it("refuses a plain operator and every customer role", () => {
    for (const role of ["operator", "client_admin", "client_member"] as const) {
      expect(() => authenticatedReviewerFrom({ ...MANAGER, role, organizationId: "org" }), role).toThrow(
        ReviewerNotAuthorizedError,
      );
    }
  });

  it("refuses a demo session, whatever role it carries", () => {
    expect(() => authenticatedReviewerFrom({ ...MANAGER, source: "demo" })).toThrow(/demo session cannot sign/);
    expect(() => authenticatedReviewerFrom({ ...MANAGER, source: "demo", role: "platform_admin" })).toThrow(
      ReviewerNotAuthorizedError,
    );
  });

  it("refuses a session with no user id", () => {
    expect(() => authenticatedReviewerFrom({ ...MANAGER, id: "" })).toThrow(/no user id/);
  });
});

describe("the attestation is composed from both, and only from both", () => {
  it("binds identity to the session and the decision to the submission", () => {
    const report = draft();
    const attestation = attestationFromAuthenticatedReviewer(MANAGER, submissionFor(report), REVIEWED_AT);

    expect(attestation).toEqual({
      operatorUserId: FIXTURE_OPERATOR_ID,
      displayName: "Sam Okafor, operations manager",
      reviewedAt: "2026-09-18T10:00:00.000Z",
      reasonCode: "reviewed_findings_and_verdict_match_the_recorded_observations",
      approvedContentHash: hashReleaseRescueReviewSubject(report),
    });
  });

  it("refuses rather than ignores a submission that tries to name the reviewer", () => {
    const report = draft();
    expect(() =>
      attestationFromAuthenticatedReviewer(
        MANAGER,
        { ...submissionFor(report), operatorUserId: OTHER_MANAGER_ID },
        REVIEWED_AT,
      ),
    ).toThrow(ReviewSubmissionError);
  });

  it("names the offending paths and never the offending values", () => {
    const report = draft();
    let message = "";
    try {
      attestationFromAuthenticatedReviewer(
        MANAGER,
        { ...submissionFor(report), operatorUserId: OTHER_MANAGER_ID, reasonCode: "sk-live-SECRETVALUE" },
        REVIEWED_AT,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("reasonCode");
    expect(message).toContain("operatorUserId");
    expect(message).not.toContain("SECRETVALUE");
    expect(message).not.toContain(OTHER_MANAGER_ID);
  });

  it("checks the session before it reads the submission", () => {
    // A customer cannot learn the submission contract by probing it.
    expect(() =>
      attestationFromAuthenticatedReviewer({ ...MANAGER, role: "client_admin" }, "not even an object", REVIEWED_AT),
    ).toThrow(ReviewerNotAuthorizedError);
  });
});

describe("signing as the authenticated actor", () => {
  it("produces a report signed by the session's manager that the gate delivers", () => {
    const report = draft();
    const signed = signReleaseRescueReportAs(MANAGER, report, submissionFor(report), REVIEWED_AT);

    expect(signed.reviewedBy?.operatorUserId).toBe(FIXTURE_OPERATOR_ID);
    expect(signed.reviewedBy?.displayName).toBe("Sam Okafor, operations manager");
    expect(signed.reviewedBy?.reviewedAt).toBe("2026-09-18T10:00:00.000Z");

    const decision = decideReleaseRescueDelivery(signed);
    expect(decision.status).toBe("deliverable");
    if (decision.status === "deliverable") {
      expect(decision.reviewer.operatorUserId).toBe(FIXTURE_OPERATOR_ID);
    }
  });

  it("cannot be made to sign as someone else, whatever the submission says", () => {
    const report = draft();
    const forged = { ...submissionFor(report), operatorUserId: OTHER_MANAGER_ID, displayName: "Someone Else" };

    expect(() => signReleaseRescueReportAs(MANAGER, report, forged, REVIEWED_AT)).toThrow(ReviewSubmissionError);
    expect(report.reviewedBy).toBeNull();
  });

  it("still refuses a stale approval: the hash must describe the report being signed", () => {
    const report = draft();
    const other = buildReleaseRescueReport(makeReportInput({ reviewedBy: null, reviewedCommitSha: "b".repeat(40) }));

    expect(() => signReleaseRescueReportAs(MANAGER, report, submissionFor(other), REVIEWED_AT)).toThrow(
      /changed between review and approval/,
    );
  });

  it("still refuses a second signature", () => {
    const report = draft();
    const signed = signReleaseRescueReportAs(MANAGER, report, submissionFor(report), REVIEWED_AT);

    expect(() => signReleaseRescueReportAs(MANAGER, signed, submissionFor(report), REVIEWED_AT)).toThrow(
      /already carries a reviewer signature/,
    );
  });

  it("refuses a manager whose session name makes a claim or would be redacted", () => {
    const report = draft();
    expect(() =>
      signReleaseRescueReportAs(
        { ...MANAGER, name: "Ops Manager. This application is secure." },
        report,
        submissionFor(report),
        REVIEWED_AT,
      ),
    ).toThrow(/prohibited claim/);
    expect(() =>
      signReleaseRescueReportAs(
        { ...MANAGER, name: "Ops Manager PGPASSWORD: pr0dXk92mQvn7Lz" },
        report,
        submissionFor(report),
        REVIEWED_AT,
      ),
    ).toThrow(/would have to be redacted/);
  });
});
