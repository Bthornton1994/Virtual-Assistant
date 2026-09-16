import { describe, expect, it } from "vitest";
import { LIMITATION_CATALOG, type LimitationCode } from "@/lib/release-rescue-observation-catalog";
import { RELEASE_RESCUE_RUBRIC_V1_HASH } from "@/lib/release-rescue-rubric";

import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  STANDING_LIMITATIONS,
  buildReleaseRescueReport,
  toReportScope,
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
    const report = buildReleaseRescueReport(makeReportInput());
    const validation = validateReleaseRescueReport(report);

    expect(validation.hardFailures).toEqual([]);
    expect(validation.hardGatePass).toBe(true);
    expect(report.verdict).toBe("no_blocking_findings_identified");
    expect(report.coverage.notAssessedChecks).toBe(0);
    expect(report.rubricHash).toBe(RELEASE_RESCUE_RUBRIC_V1_HASH);
    // The hash is of the PROJECTION the report carries, so a reader of the
    // artifact can recompute it from what the artifact contains. The binding to
    // the engagement's frozen intake scope is the database's job.
    expect(report.scopeHash).toBe(sha256Hex(toReportScope(makeScope())));
  });

  it("always carries the standing limitations and the required disclaimers", () => {
    const report = buildReleaseRescueReport(makeReportInput({ limitationCodes: ["customer_excluded_part_of_the_repository"] }));

    const rendered = report.limitationCodes.map((code) => LIMITATION_CATALOG[code as LimitationCode]);
    for (const limitation of STANDING_LIMITATIONS) {
      expect(rendered).toContain(limitation);
    }
    expect(report.disclaimers).toEqual({
      notPenetrationTest: true,
      notComplianceCertification: true,
      noSecurityGuarantee: true,
      reviewedCommitOnly: true,
    });
  });

  it("hashes deterministically and changes when content changes", () => {
    const first = buildReleaseRescueReport(makeReportInput());
    const second = buildReleaseRescueReport(makeReportInput());

    expect(hashReleaseRescueReport(first)).toBe(hashReleaseRescueReport(second));
    expect(hashReleaseRescueReport(first)).toMatch(/^[0-9a-f]{64}$/);

    const changed = buildReleaseRescueReport(makeReportInput({ reportId: "rep-002" }));
    expect(hashReleaseRescueReport(changed)).not.toBe(hashReleaseRescueReport(first));
  });
});

describe("verdict ladder", () => {
  it("blocks a release on a confirmed blocking finding", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [makeFinding()],
      }),
    );

    expect(report.verdict).toBe("release_blocked");
    expect(report.blockingFindingCount).toBe(1);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("holds an unconfirmed critical at conditional rather than blocking the release", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "ai.untrusted_input_is_not_authority", {
          outcome: "concern",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            observationCode: "ai.model_visible_content_can_grant_authority",
            remediationCode: "declare_tool_authority_explicitly",
            confidence: "likely",
            uncertaintyCode: "static_read_only_no_runtime_confirmation",
          }),
        ],
      }),
    );

    expect(report.verdict).toBe("conditional_release");
    expect(report.blockingFindingCount).toBe(0);
    expect(validateReleaseRescueReport(report).warnings.join(" ")).toContain("unconfirmed");
  });

  it("caps the verdict at conditional whenever a check was not assessed", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "deps.known_vulnerable_dependencies", {
          outcome: "not_assessed",
          rationaleCode: "controls_present_and_evidenced",
          evidence: [],
        }),
      }),
    );

    expect(report.verdict).toBe("conditional_release");
    expect(report.coverage.notAssessedChecks).toBe(1);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("reports tracked findings when nothing reaches high", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "observe.error_reporting_without_leakage", {
          outcome: "concern",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            observationCode: "observe.logs_carry_secrets_or_customer_data",
            remediationCode: "strip_secrets_and_customer_data_from_logs",
            confidence: "confirmed",
          }),
        ],
      }),
    );

    expect(report.verdict).toBe("release_with_tracked_findings");
  });

  it("does not let a confirmed high on an ungated check read as clean", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "deps.known_vulnerable_dependencies", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            observationCode: "deps.known_vulnerable_dependency_on_a_reachable_path",
            remediationCode: "upgrade_or_replace_the_dependency",
            confidence: "confirmed",
          }),
        ],
      }),
    );

    expect(report.verdict).toBe("conditional_release");
  });
});

describe("report integrity", () => {
  it("rejects edited severity counts", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = { ...report, severityCounts: { ...report.severityCounts, critical: 5 } };

    expect(failures(tampered)).toContain("recomputation from the findings gives 0");
  });

  it("rejects an edited verdict", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [makeFinding()],
      }),
    );
    const tampered = { ...report, verdict: "no_blocking_findings_identified" as const };

    expect(failures(tampered)).toContain("recomputation gives");
  });

  it("rejects edited coverage", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = { ...report, coverage: { ...report.coverage, notAssessedChecks: 0, assessedChecks: 99 } };

    expect(failures(tampered)).toContain("coverage.assessedChecks");
  });

  it("rejects a report bound to a different rubric", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = { ...report, rubricHash: "b".repeat(64) };

    expect(failures(tampered)).toContain("does not match the release-rescue-rubric/v1 rubric");
  });

  it("rejects a scope hash that does not match the scope", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = { ...report, scopeHash: "c".repeat(64) };

    expect(failures(tampered)).toContain("does not match the hash recomputed from its scope");
  });

  it("rejects a missing assessment for any rubric check", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = { ...report, assessments: report.assessments.slice(1) };

    expect(failures(tampered)).toContain("has no assessment");
  });

  it("rejects a duplicated assessment or finding", () => {
    const report = buildReleaseRescueReport(makeReportInput());

    expect(failures({ ...report, assessments: [...report.assessments, report.assessments[0]] })).toContain(
      "is assessed more than once",
    );

    const withFindings = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [makeFinding(), makeFinding()],
      }),
    );
    expect(failures(withFindings)).toContain("appears more than once");
  });

  it("rejects a blocking check passed on argument alone", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.tenant_isolation_at_data_layer", {
          outcome: "pass",
          rationaleCode: "controls_present_and_evidenced",
          evidence: [{ kind: "reasoned_argument", path: "src/a.ts", startLine: 1, endLine: null }],
        }),
      }),
    );

    expect(failures(report)).toContain("without artifact evidence");
  });

  it("allows a non-blocking check to pass on a reasoned argument", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "data.customer_data_inventory", {
          outcome: "pass",
          rationaleCode: "controls_present_and_evidenced",
          evidence: [{ kind: "reasoned_argument", path: "src/a.ts", startLine: 1, endLine: null }],
        }),
      }),
    );

    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("rejects a finding on a check marked pass, not_applicable, or not_assessed", () => {
    for (const outcome of ["pass", "not_applicable", "not_assessed"] as const) {
      const report = buildReleaseRescueReport(
        makeReportInput({
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome,
            rationaleCode: "controls_present_and_evidenced",
          }),
          findings: [makeFinding()],
        }),
      );
      expect(failures(report), outcome).toContain(`is marked ${outcome}`);
    }
  });

  it("rejects a failed check with no finding to explain it", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "input.boundary_validation", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
      }),
    );

    expect(failures(report)).toContain("but no finding explains it");
  });

  it("removes an unredacted secret anywhere in the report, and records the removal", () => {
    // Validation used to be the only defence, and its only move was to refuse the
    // whole report. The pipeline now removes the material at build, so the
    // artifact is clean and the report is held for a reviewer instead.
    //
    // The carrier changed with Option 1. `limitations` was executor-written
    // prose; it is a closed enum now, and there is no field on a finding or an
    // assessment that holds a sentence either. The reviewer's display name is
    // one of the two free-text strings that remain — it is a person's name, an
    // operator types it, and it is rendered to the customer as the signature.
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: "Ops Manager AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );

    expect(JSON.stringify(report)).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(report.unresolvedHolds.some((hold) => hold.classification === "credential_evidence")).toBe(true);
    expect(releaseRescueDeliveryGate(report, validateReleaseRescueReport(report)).deliverable).toBe(false);
  });

  it("still refuses an artifact that reaches validation with a secret in it", () => {
    // The backstop, for an artifact assembled somewhere this pipeline did not
    // touch — a database row read back, say. Validation keeps its refusal.
    const clean = buildReleaseRescueReport(makeReportInput());
    const tampered = {
      ...clean,
      reviewedBy: { ...clean.reviewedBy, displayName: "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" },
    };

    expect(validateReleaseRescueReport(tampered).hardFailures.join(" ")).toContain("Unredacted secret material");
  });

  it("rejects a report whose auditor took an external action", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({ authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 1 } }),
    );

    expect(failures(report)).toContain("This review is prepare-only");
  });

  it("rejects report text that makes a prohibited claim", () => {
    // Same change of carrier. The catalog's own wording is fixed and asserted
    // clean elsewhere; what a human still types is the signature, and the claim
    // guard keeps its job there.
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: "Ops Manager, who certifies this application is secure",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );

    expect(failures(report)).toContain("prohibited claim");
  });

  it("cannot be given a prohibited claim through a finding, because a finding has no prose", () => {
    // The stronger half, and the reason the carrier above is the ONLY one left.
    // Every customer-facing sentence about a finding comes from the frozen
    // catalog, so there is no executor-written string on this path to guard.
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [makeFinding()],
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "control_missing_on_a_reachable_path",
        }),
      }),
    );
    const findingStrings = JSON.stringify(report.findings);

    for (const value of Object.values(report.findings[0])) {
      if (typeof value !== "string") continue;
      expect(findProhibitedClaims(value), value).toEqual([]);
    }
    // A stronger, structural statement of the same thing: the serialised
    // finding contains no space anywhere. Every string it holds is a code, an
    // identifier, an enum value or a path, and none of those may contain one.
    // A sentence cannot be written without a space, so this assertion fails the
    // moment any prose field returns to a finding.
    expect(findingStrings, "a finding must not carry a sentence").not.toContain(" ");
  });

  it("warns, without failing, when a report contains no findings at all", () => {
    const validation = validateReleaseRescueReport(buildReleaseRescueReport(makeReportInput()));

    expect(validation.hardGatePass).toBe(true);
    expect(validation.warnings.join(" ")).toContain("no findings");
  });

  it("returns zeroed metrics rather than throwing on malformed input", () => {
    const validation = validateReleaseRescueReport({ schemaVersion: "nope" });

    expect(validation.hardGatePass).toBe(false);
    expect(validation.metrics.findingCount).toBe(0);
  });

  it("fails closed when a finding names a check the rubric does not have", () => {
    // deriveReportMetrics is exported. It must not answer "not blocking" for a
    // confirmed critical merely because it cannot place the finding.
    const metrics = deriveReportMetrics(
      passingAssessments(),
      [
        makeFinding({
          confidence: "confirmed",
        }),
      ],
      ZERO_AUTHORITY,
    );

    expect(metrics.blockingFindingCount).toBe(1);
    expect(metrics.verdict).toBe("release_blocked");
  });

  it("computes metrics from observations even when stored severity is inflated", () => {
    const metrics = deriveReportMetrics(passingAssessments(), [{ ...makeFinding(), severity: "critical" }], ZERO_AUTHORITY);

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
    const report = buildReleaseRescueReport(makeReportInput({ scope: humanOnlyScope() }));

    expect(failures(report)).toContain("declined AI-assisted review");
  });

  it("refuses to deliver it as well", () => {
    const report = buildReleaseRescueReport(makeReportInput({ scope: humanOnlyScope() }));
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("declined AI-assisted review");
  });

  it("accepts a human-prepared report for the same engagement", () => {
    const report = buildReleaseRescueReport(
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
    const report = buildReleaseRescueReport(makeReportInput());

    expect(report.scope.aiAssistedReviewAccepted).toBe(true);
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });

  it("binds the choice into the scope hash", () => {
    // Otherwise the choice could be edited after the fact without invalidating
    // the report it governs.
    const accepted = buildReleaseRescueReport(makeReportInput());
    const declined = buildReleaseRescueReport(makeReportInput({ scope: humanOnlyScope() }));

    expect(declined.scopeHash).not.toBe(accepted.scopeHash);
  });
});

describe("delivery gate", () => {
  it("clears a validated, human-reviewed report", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate).toEqual({ deliverable: true, blockers: [] });
  });

  it("refuses to deliver an unsigned report", () => {
    const report = buildReleaseRescueReport(makeReportInput({ reviewedBy: null }));
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("No human reviewer");
    expect(gate.blockers.join(" ")).toContain("agent-prepared report");
  });

  it("refuses to deliver a report that failed validation", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = { ...report, severityCounts: { ...report.severityCounts, high: 9 } };
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(tampered));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("did not pass deterministic validation");
  });
});
