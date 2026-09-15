import { describe, expect, it } from "vitest";
import { RELEASE_RESCUE_RUBRIC_V1_HASH } from "@/lib/release-rescue-rubric";
import { hashScope } from "@/lib/release-rescue-intake";
import {
  STANDING_LIMITATIONS,
  assembleReleaseRescueReport,
  deriveReportMetrics,
  hashReleaseRescueReport,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import {
  ZERO_AUTHORITY,
  makeFinding,
  makeReportInput,
  makeScope,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";

function failures(report: unknown): string {
  return validateReleaseRescueReport(report).hardFailures.join(" | ");
}

describe("report assembly", () => {
  it("produces a valid, fully covered report with no findings", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const validation = validateReleaseRescueReport(report);

    expect(validation.hardFailures).toEqual([]);
    expect(validation.hardGatePass).toBe(true);
    expect(report.verdict).toBe("no_blocking_findings_identified");
    expect(report.coverage.notAssessedChecks).toBe(0);
    expect(report.rubricHash).toBe(RELEASE_RESCUE_RUBRIC_V1_HASH);
    expect(report.scopeHash).toBe(hashScope(makeScope()));
  });

  it("always carries the standing limitations and the required disclaimers", () => {
    const report = assembleReleaseRescueReport(makeReportInput({ limitations: [] }));

    for (const limitation of STANDING_LIMITATIONS) {
      expect(report.limitations).toContain(limitation);
    }
    expect(report.disclaimers).toEqual({
      notPenetrationTest: true,
      notComplianceCertification: true,
      noSecurityGuarantee: true,
      reviewedCommitOnly: true,
    });
  });

  it("hashes deterministically and changes when content changes", () => {
    const first = assembleReleaseRescueReport(makeReportInput());
    const second = assembleReleaseRescueReport(makeReportInput());

    expect(hashReleaseRescueReport(first)).toBe(hashReleaseRescueReport(second));
    expect(hashReleaseRescueReport(first)).toMatch(/^[0-9a-f]{64}$/);

    const changed = assembleReleaseRescueReport(makeReportInput({ reportId: "rep-002" }));
    expect(hashReleaseRescueReport(changed)).not.toBe(hashReleaseRescueReport(first));
  });
});

describe("verdict ladder", () => {
  it("blocks a release on a confirmed blocking finding", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [makeFinding()],
      }),
    );

    expect(report.verdict).toBe("release_blocked");
    expect(report.blockingFindingCount).toBe(1);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("holds an unconfirmed critical at conditional rather than blocking the release", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "ai.untrusted_input_is_not_authority", {
          outcome: "concern",
          rationale: "The assistant may act on document text; we could not reach the tool call path.",
        }),
        findings: [
          makeFinding({
            rubricCheckId: "ai.untrusted_input_is_not_authority",
            dimension: "ai_boundary",
            impact: "severe",
            exploitability: "remote_unauthenticated",
            confidence: "likely",
            severity: "high",
            blocking: false,
            residualUncertainty: "We could not confirm the assistant actually invokes the refund tool.",
          }),
        ],
      }),
    );

    expect(report.verdict).toBe("conditional_release");
    expect(report.blockingFindingCount).toBe(0);
    expect(validateReleaseRescueReport(report).warnings.join(" ")).toContain("unconfirmed");
  });

  it("caps the verdict at conditional whenever a check was not assessed", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "deps.known_vulnerable_dependencies", {
          outcome: "not_assessed",
          rationale: "The lockfile was not included in the snapshot the customer shared.",
          evidence: [],
        }),
      }),
    );

    expect(report.verdict).toBe("conditional_release");
    expect(report.coverage.notAssessedChecks).toBe(1);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("reports tracked findings when nothing reaches high", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "observe.error_reporting_without_leakage", {
          outcome: "concern",
          rationale: "Stack traces reach the client on unhandled errors.",
        }),
        findings: [
          makeFinding({
            rubricCheckId: "observe.error_reporting_without_leakage",
            dimension: "observability_and_incident_response",
            impact: "limited",
            exploitability: "requires_user_interaction",
            confidence: "confirmed",
            severity: "low",
            blocking: false,
          }),
        ],
      }),
    );

    expect(report.verdict).toBe("release_with_tracked_findings");
  });

  it("does not let a confirmed high on an ungated check read as clean", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "deps.known_vulnerable_dependencies", {
          outcome: "fail",
          rationale: "A reachable dependency has a published advisory.",
        }),
        findings: [
          makeFinding({
            rubricCheckId: "deps.known_vulnerable_dependencies",
            dimension: "dependency_and_supply_chain",
            impact: "serious",
            exploitability: "remote_unauthenticated",
            confidence: "confirmed",
            severity: "high",
            blocking: false,
          }),
        ],
      }),
    );

    expect(report.verdict).toBe("conditional_release");
  });
});

describe("report integrity", () => {
  it("rejects edited severity counts", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const tampered = { ...report, severityCounts: { ...report.severityCounts, critical: 5 } };

    expect(failures(tampered)).toContain("recomputation from the findings gives 0");
  });

  it("rejects an edited verdict", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [makeFinding()],
      }),
    );
    const tampered = { ...report, verdict: "no_blocking_findings_identified" as const };

    expect(failures(tampered)).toContain("recomputation gives");
  });

  it("rejects edited coverage", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const tampered = { ...report, coverage: { ...report.coverage, notAssessedChecks: 0, assessedChecks: 99 } };

    expect(failures(tampered)).toContain("coverage.assessedChecks");
  });

  it("rejects a report bound to a different rubric", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const tampered = { ...report, rubricHash: "b".repeat(64) };

    expect(failures(tampered)).toContain("does not match the release-rescue-rubric/v1 rubric");
  });

  it("rejects a scope hash that does not match the scope", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const tampered = { ...report, scopeHash: "c".repeat(64) };

    expect(failures(tampered)).toContain("does not match the hash recomputed from its scope");
  });

  it("rejects a missing assessment for any rubric check", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const tampered = { ...report, assessments: report.assessments.slice(1) };

    expect(failures(tampered)).toContain("has no assessment");
  });

  it("rejects a duplicated assessment or finding", () => {
    const report = assembleReleaseRescueReport(makeReportInput());

    expect(failures({ ...report, assessments: [...report.assessments, report.assessments[0]] })).toContain(
      "is assessed more than once",
    );

    const withFindings = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [makeFinding(), makeFinding()],
      }),
    );
    expect(failures(withFindings)).toContain("appears more than once");
  });

  it("rejects a blocking check passed on argument alone", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.tenant_isolation_at_data_layer", {
          outcome: "pass",
          rationale: "The team told us row level security is enabled.",
          evidence: [{ kind: "reasoned_argument", reference: "Discussion with the engineering lead." }],
        }),
      }),
    );

    expect(failures(report)).toContain("without artifact evidence");
  });

  it("allows a non-blocking check to pass on a reasoned argument", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "data.customer_data_inventory", {
          outcome: "pass",
          rationale: "The workflow's data footprint was walked through and matches the described inventory.",
          evidence: [{ kind: "reasoned_argument", reference: "Walkthrough of the checkout data path." }],
        }),
      }),
    );

    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("rejects a finding on a check marked pass, not_applicable, or not_assessed", () => {
    for (const outcome of ["pass", "not_applicable", "not_assessed"] as const) {
      const report = assembleReleaseRescueReport(
        makeReportInput({
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome,
            rationale: "Recorded outcome.",
          }),
          findings: [makeFinding()],
        }),
      );
      expect(failures(report), outcome).toContain(`is marked ${outcome}`);
    }
  });

  it("rejects a failed check with no finding to explain it", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "input.boundary_validation", {
          outcome: "fail",
          rationale: "Webhook bodies are used unvalidated.",
        }),
      }),
    );

    expect(failures(report)).toContain("but no finding explains it");
  });

  it("rejects a report carrying an unredacted secret anywhere", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        limitations: ["We could not rotate the key AKIAIOSFODNN7EXAMPLE found in the deploy script."],
      }),
    );

    expect(failures(report)).toContain("Unredacted secret material");
  });

  it("rejects a report whose auditor took an external action", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({ authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 1 } }),
    );

    expect(failures(report)).toContain("This review is prepare-only");
  });

  it("rejects report text that makes a prohibited claim", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({ limitations: ["This penetration test covered only the checkout flow."] }),
    );

    expect(failures(report)).toContain("prohibited claim");
  });

  it("warns, without failing, when a report contains no findings at all", () => {
    const validation = validateReleaseRescueReport(assembleReleaseRescueReport(makeReportInput()));

    expect(validation.hardGatePass).toBe(true);
    expect(validation.warnings.join(" ")).toContain("no findings");
  });

  it("returns zeroed metrics rather than throwing on malformed input", () => {
    const validation = validateReleaseRescueReport({ schemaVersion: "nope" });

    expect(validation.hardGatePass).toBe(false);
    expect(validation.metrics.findingCount).toBe(0);
  });

  it("computes metrics from observations even when stored severity is inflated", () => {
    const metrics = deriveReportMetrics(passingAssessments(), [makeFinding({ severity: "critical" })], ZERO_AUTHORITY);

    // Stored "critical" is ignored; the observations derive "high".
    expect(metrics.severityCounts.critical).toBe(0);
    expect(metrics.severityCounts.high).toBe(1);
  });
});

describe("the customer's review-mode choice is enforced", () => {
  function humanOnlyScope() {
    return { ...makeScope(), aiAssistedReviewAccepted: false };
  }

  it("rejects an agent-prepared report for an engagement that declined AI review", () => {
    // The choice is offered at intake. A pipeline that records it and proceeds
    // anyway is worse than one that never offered it.
    const report = assembleReleaseRescueReport(makeReportInput({ scope: humanOnlyScope() }));

    expect(failures(report)).toContain("declined AI-assisted review");
  });

  it("refuses to deliver it as well", () => {
    const report = assembleReleaseRescueReport(makeReportInput({ scope: humanOnlyScope() }));
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("declined AI-assisted review");
  });

  it("accepts a human-prepared report for the same engagement", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        scope: humanOnlyScope(),
        preparedBy: {
          executorKey: "operator-sam",
          executorKind: "human",
          provider: "",
          modelId: null,
          protocolVersion: "v1",
        },
      }),
    );
    const validation = validateReleaseRescueReport(report);

    expect(validation.hardFailures).toEqual([]);
    expect(releaseRescueDeliveryGate(report, validation).deliverable).toBe(true);
  });

  it("leaves an engagement that accepted AI review unaffected", () => {
    const report = assembleReleaseRescueReport(makeReportInput());

    expect(report.scope.aiAssistedReviewAccepted).toBe(true);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("binds the choice into the scope hash", () => {
    // Otherwise the choice could be edited after the fact without invalidating
    // the report it governs.
    const accepted = assembleReleaseRescueReport(makeReportInput());
    const declined = assembleReleaseRescueReport(makeReportInput({ scope: humanOnlyScope() }));

    expect(declined.scopeHash).not.toBe(accepted.scopeHash);
  });
});

describe("delivery gate", () => {
  it("clears a validated, human-reviewed report", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate).toEqual({ deliverable: true, blockers: [] });
  });

  it("refuses to deliver an unsigned report", () => {
    const report = assembleReleaseRescueReport(makeReportInput({ reviewedBy: null }));
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("No human reviewer");
    expect(gate.blockers.join(" ")).toContain("agent-prepared report");
  });

  it("refuses to deliver a report that failed validation", () => {
    const report = assembleReleaseRescueReport(makeReportInput());
    const tampered = { ...report, severityCounts: { ...report.severityCounts, high: 9 } };
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(tampered));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("did not pass deterministic validation");
  });
});
