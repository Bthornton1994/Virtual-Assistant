import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_TITLE,
  summarizeDimensions,
  toCustomerReportView,
} from "@/lib/release-rescue-presentation";
import { computeFindingBlocking, computeFindingSeverity } from "@/lib/release-rescue-findings";
import { getRubricCheck, RELEASE_RESCUE_RUBRIC_V1 } from "@/lib/release-rescue-rubric";
import { buildReleaseRescueReport } from "@/lib/release-rescue-report";
import {
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";

describe("summarizeDimensions rolls up the rubric, not the stored finding list", () => {
  it("counts mixed outcomes per dimension and treats a missing assessment as not assessed", () => {
    const assessments = setAssessment(
      setAssessment(passingAssessments(), "authz.object_level_authorization", {
        outcome: "fail",
        rationaleCode: "control_missing_on_a_reachable_path",
      }),
      "secrets.no_secrets_in_version_control",
      { outcome: "not_assessed", rationaleCode: "not_assessed_requires_a_reviewers_reading" },
    );
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments,
        findings: [makeFinding()],
      }),
    );

    const summaries = summarizeDimensions(report);
    const authz = summaries.find((row) => row.dimension === "authorization_and_tenancy");
    const secrets = summaries.find((row) => row.dimension === "secrets_and_credentials");

    expect(summaries).toHaveLength(new Set(RELEASE_RESCUE_RUBRIC_V1.map((check) => check.dimension)).size);
    expect(authz?.failedChecks).toBe(1);
    expect(authz?.findingCount).toBe(1);
    expect((authz?.assessedChecks ?? 0) + (authz?.notAssessedChecks ?? 0)).toBe(authz?.totalChecks);
    expect(secrets?.notAssessedChecks).toBeGreaterThanOrEqual(1);
    expect(summaries.reduce((sum, row) => sum + row.totalChecks, 0)).toBe(RELEASE_RESCUE_RUBRIC_V1.length);
  });
});

describe("the customer view derives severity, blocking, and line labels", () => {
  it("recomputes severity and blocking from observations, ignoring stored labels", () => {
    const report = buildReleaseRescueReport(makeReportInput({ findings: [makeFinding()] }));
    const stored = report.findings[0];
    const derived = computeFindingSeverity(stored);
    const check = getRubricCheck(stored.rubricCheckId);
    const derivedBlocking = check ? computeFindingBlocking(check, derived, stored.confidence) : true;

    const tampered = {
      ...report,
      findings: [{ ...stored, severity: "informational" as const, blocking: !derivedBlocking }],
    };
    const view = toCustomerReportView(tampered);

    expect(view.findings[0].severity).toBe(derived);
    expect(view.findings[0].severity).not.toBe("informational");
    expect(view.findings[0].blocking).toBe(derivedBlocking);
  });

  it("formats a single line, a range, and a missing start, and fail-closes an unknown check", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [
          makeFinding({
            locations: [
              { path: "src/a.ts", startLine: 18, endLine: 18 },
              { path: "src/b.ts", startLine: 18, endLine: 27 },
              { path: "src/c.ts", startLine: null, endLine: 9 },
            ],
          }),
        ],
      }),
    );
    const view = toCustomerReportView(report);
    expect(view.findings[0].locations.map((location) => location.lineRange)).toEqual([
      "line 18",
      "lines 18–27",
      null,
    ]);

    const unknownCheck = {
      ...report,
      findings: [{ ...report.findings[0], rubricCheckId: "not.a.real.check" }],
    };
    const unknownView = toCustomerReportView(unknownCheck);
    expect(unknownView.findings[0].checkTitle).toBe(UNAVAILABLE_TITLE);
    expect(unknownView.findings[0].blocking).toBe(true);
  });

  it("orders findings by derived severity, then blocking, then id", () => {
    const high = makeFinding({ findingId: "RR-200" });
    const informational = makeFinding({
      findingId: "RR-100",
      observationCode: "docs.cannot_run_and_verify_locally",
      remediationCode: "document_local_setup_and_verification",
      confidence: "confirmed",
    });
    const report = buildReleaseRescueReport(makeReportInput({ findings: [informational, high] }));
    const view = toCustomerReportView(report);

    expect(view.findings.map((finding) => finding.id)).toEqual(["RR-200", "RR-100"]);
    expect(view.findings[0].severity).not.toBe("informational");
  });
});
