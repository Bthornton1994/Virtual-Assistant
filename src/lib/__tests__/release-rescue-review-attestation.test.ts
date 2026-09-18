import { describe, expect, it } from "vitest";
import {
  buildReleaseRescueReport,
  hashReleaseRescueReport,
  hashReleaseRescueReviewSubject,
  releaseRescueDeliveryGate,
  signReleaseRescueReport,
  validateReleaseRescueReport,
  type ReleaseRescueReportV1,
} from "@/lib/release-rescue-report";
import { decideReleaseRescueDelivery } from "@/lib/release-rescue-delivery";
import { REPORT_FIELD_POLICY, checkReportFieldCoverage } from "@/lib/release-rescue-field-policy";
import {
  REVIEW_DECISION_REASON_CATALOG,
  REVIEW_DECISION_REASON_CODES,
} from "@/lib/release-rescue-observation-catalog";
import {
  FIXTURE_REVIEWER,
  makeReportInput,
  signWithFixtureReviewer,
} from "@/lib/__tests__/release-rescue-fixtures";

// What a reviewer's signature has to record, and what happens when it does not.
//
// `reviewedBy` carried an operator id, a display name and a timestamp. That is a
// record that somebody signed something. It is not a record of WHY they signed
// or of WHAT they signed, and the delivery decision's own binding — a hash it
// recomputed from the bytes it was about to render — could not disagree with
// those bytes. It always matched, which is the shape of a check that is not one.

const draft = (): ReleaseRescueReportV1 => buildReleaseRescueReport(makeReportInput({ reviewedBy: null }));

function gateOf(report: ReleaseRescueReportV1) {
  return releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));
}

describe("the subject a reviewer attests to", () => {
  it("is the report without its own signature, because a signature cannot cover itself", () => {
    const unsigned = draft();
    const signed = signWithFixtureReviewer(unsigned);

    // Attaching the signature changes the report's content hash and leaves the
    // subject hash alone. That is the whole reason the subject exists: a
    // reviewer attesting to `hashReleaseRescueReport` would be attesting to a
    // value that cannot be known until after they have signed.
    expect(hashReleaseRescueReport(signed)).not.toBe(hashReleaseRescueReport(unsigned));
    expect(hashReleaseRescueReviewSubject(signed)).toBe(hashReleaseRescueReviewSubject(unsigned));
  });

  it("covers every other field, so an edit after signing is visible", () => {
    const signed = signWithFixtureReviewer(draft());
    const subject = hashReleaseRescueReviewSubject(signed);

    // One edit per top-level field a customer reads. Each must move the hash.
    const edits: Array<[string, ReleaseRescueReportV1]> = [
      // Not `no_blocking_findings_identified` — that is what this fixture's
      // verdict already is, so the "edit" changed nothing and the assertion
      // failed for the right reason on the first run.
      ["verdict", { ...signed, verdict: "release_blocked" }],
      ["blockingFindingCount", { ...signed, blockingFindingCount: signed.blockingFindingCount + 1 }],
      ["limitationCodes", { ...signed, limitationCodes: signed.limitationCodes.slice(1) }],
      ["severityCounts", { ...signed, severityCounts: { ...signed.severityCounts, high: 9 } }],
      ["coverage", { ...signed, coverage: { ...signed.coverage, assessedChecks: 0 } }],
      ["reviewedCommitSha", { ...signed, reviewedCommitSha: "f".repeat(40) }],
      ["generatedAt", { ...signed, generatedAt: "2026-09-16T23:59:59.000Z" }],
    ];

    const unmoved = edits.filter(([, edited]) => hashReleaseRescueReviewSubject(edited) === subject);
    expect(unmoved.map(([field]) => field), "an edit the reviewer's hash cannot see").toEqual([]);
  });
});

describe("a signature that does not describe the report is refused", () => {
  it("refuses an attestation collected against different bytes", () => {
    const unsigned = draft();

    expect(() =>
      signReleaseRescueReport(unsigned, { ...FIXTURE_REVIEWER, approvedContentHash: "a".repeat(64) }),
    ).toThrow(/changed between review and approval/);
  });

  it("blocks delivery when the report was edited after it was signed", () => {
    const signed = signWithFixtureReviewer(draft());
    expect(gateOf(signed).deliverable).toBe(true);

    // The verdict, changed under a valid signature. This is the case the old
    // system-recomputed hash could not see at all.
    const tampered: ReleaseRescueReportV1 = { ...signed, verdict: "release_blocked" };
    const validation = validateReleaseRescueReport(tampered);

    expect(validation.hardFailures.join(" ")).toContain("does not match this report");
    expect(gateOf(tampered).deliverable).toBe(false);
    expect(releaseRescueDeliveryGate(tampered, validation).blockers.join(" ")).toContain(
      "approved a different version of this report",
    );

    // And the production path withholds it rather than rendering it.
    const decision = decideReleaseRescueDelivery(tampered);
    expect(decision.status).toBe("withheld");
    expect(decision).not.toHaveProperty("view");
  });

  it("refuses a second signature rather than replacing the accountable human", () => {
    const signed = signWithFixtureReviewer(draft());

    expect(() =>
      signReleaseRescueReport(signed, {
        ...FIXTURE_REVIEWER,
        displayName: "Someone Else",
        approvedContentHash: hashReleaseRescueReviewSubject(signed),
      }),
    ).toThrow(/already carries a reviewer signature/);
  });
});

describe("a signature records why, as a code", () => {
  it("refuses a written reason", () => {
    expect(() =>
      signWithFixtureReviewer(draft(), {
        reasonCode: "I read it and it looked fine to me" as never,
      }),
    ).toThrow(/code from the review-decision catalog/);
  });

  it("does not echo the refused text, because the message reaches logs", () => {
    let message = "";
    try {
      signWithFixtureReviewer(draft(), { reasonCode: "SuperSecretReason" as never });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain("SuperSecretReason");
  });

  it("every code has catalog words, and the report stores the code", () => {
    const signed = signWithFixtureReviewer(draft());

    expect(REVIEW_DECISION_REASON_CODES.length).toBeGreaterThan(0);
    for (const code of REVIEW_DECISION_REASON_CODES) {
      expect(REVIEW_DECISION_REASON_CATALOG[code], code).toBeTruthy();
    }
    expect(signed.reviewedBy?.reasonCode).toBe(FIXTURE_REVIEWER.reasonCode);
    expect(JSON.stringify(signed)).not.toContain(
      REVIEW_DECISION_REASON_CATALOG[FIXTURE_REVIEWER.reasonCode],
    );
  });

  it("renders the catalog sentence rather than the code on a delivered report", () => {
    const decision = decideReleaseRescueDelivery(signWithFixtureReviewer(draft()));

    expect(decision.status).toBe("deliverable");
    if (decision.status !== "deliverable") throw new Error("unreachable");
    expect(decision.reviewer.reason).toBe(REVIEW_DECISION_REASON_CATALOG[FIXTURE_REVIEWER.reasonCode]);
  });
});

describe("a signature written before attestation was required", () => {
  // The migration case, asserted in code as well as in SQL. A stored artifact
  // from an older build satisfies `ReleaseRescueReportV1` at compile time — a
  // caller reads it back as `unknown` and casts — and reaches the gate carrying
  // a signature that records no reason and covers no bytes.
  function legacyRow(): ReleaseRescueReportV1 {
    const signed = signWithFixtureReviewer(draft());
    const reviewedBy = { ...signed.reviewedBy } as Record<string, unknown>;
    delete reviewedBy.reasonCode;
    delete reviewedBy.approvedContentHash;
    return { ...signed, reviewedBy } as unknown as ReleaseRescueReportV1;
  }

  it("is named by validation, not reported as an unrecognised key", () => {
    const failures = validateReleaseRescueReport(legacyRow()).hardFailures.join(" ");

    expect(failures).toContain("before reviewer attestation was required");
    expect(failures).toContain("reasonCode");
    expect(failures).toContain("approvedContentHash");
    // And it says what to do, which is not "edit the row".
    expect(failures).toContain("signed again");
  });

  it("is refused by the gate on both counts", () => {
    const blockers = gateOf(legacyRow()).blockers.join(" ");

    expect(blockers).toContain("records no reason");
    expect(blockers).toContain("names no approved content hash");
    expect(gateOf(legacyRow()).deliverable).toBe(false);
  });

  it("is withheld by the production path, carrying no view", () => {
    const decision = decideReleaseRescueDelivery(legacyRow());

    expect(decision.status).toBe("withheld");
    expect(decision).not.toHaveProperty("view");
  });
});

describe("the reviewer's own text is refused rather than rewritten", () => {
  it("refuses a display name holding credential material, without echoing it", () => {
    let message = "";
    try {
      signWithFixtureReviewer(draft(), { displayName: "Ops Manager PGPASSWORD: pr0dXk92mQvn7Lz" });
    } catch (error) {
      message = String(error);
    }

    expect(message).toContain("$.reviewedBy.displayName");
    expect(message).not.toContain("pr0dXk92mQvn7Lz");
  });

  it("refuses a display name that states what the review found", () => {
    expect(() =>
      signWithFixtureReviewer(draft(), {
        displayName: "Ops Manager. This application is secure.",
      }),
    ).toThrow(/prohibited claim/);
  });

  it("does not refuse an ordinary name that happens to mention a credential noun", () => {
    const signed = signWithFixtureReviewer(draft(), {
      displayName: "Ops Manager, password rotation programme",
    });

    expect(signed.reviewedBy?.displayName).toBe("Ops Manager, password rotation programme");
    expect(gateOf(signed).deliverable).toBe(true);
  });
});

describe("the new fields are covered by the field policy", () => {
  it("has a recorded disposition for each, so coverage does not fail closed", () => {
    expect(REPORT_FIELD_POLICY["$.reviewedBy.reasonCode"]?.disposition).toBe("generated");
    expect(REPORT_FIELD_POLICY["$.reviewedBy.approvedContentHash"]?.disposition).toBe("generated");
    expect(checkReportFieldCoverage(signWithFixtureReviewer(draft()))).toEqual([]);
  });
});
