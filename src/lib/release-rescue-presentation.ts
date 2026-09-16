import {
  RELEASE_RESCUE_RUBRIC_V1,
  RUBRIC_DIMENSIONS,
  getRubricCheck,
  type RubricEvidenceKind,
  type RubricDimension,
} from "@/lib/release-rescue-rubric";
import {
  computeFindingBlocking,
  computeFindingSeverity,
  severityRank,
  type FindingSeverity,
} from "@/lib/release-rescue-findings";
import {
  getObservation,
  getRemediation,
  LIMITATION_CATALOG,
  UNCERTAINTY_CATALOG,
  type LimitationCode,
  type UncertaintyCode,
} from "@/lib/release-rescue-observation-catalog";
import type { ReleaseRescueReportV1, ReleaseVerdict } from "@/lib/release-rescue-report";

// The customer-facing view of a Release Rescue report.
//
// Two jobs, and the second is the reason this module exists rather than the UI
// reading the report directly:
//
//   1. PRESENTATION. Turn the stored contract into something a page can render:
//      human titles, per-dimension rollups, findings ordered by what matters.
//   2. REDACTION OF INTERNAL IDENTITY. The stored report carries organizationId,
//      runId, the executor's key and provider, and the reviewing operator's user
//      id. None of that belongs in a document we hand to a customer. Building
//      the customer view by CONSTRUCTION rather than by deletion means a field
//      added to the stored contract later is absent from the customer view until
//      someone deliberately adds it here.
//
// `assertNoInternalIdentity` re-checks the result anyway, because "by
// construction" is a claim worth verifying.

export const DIMENSION_TITLES: Record<RubricDimension, string> = {
  secrets_and_credentials: "Secrets and credentials",
  authentication_and_session: "Authentication and session",
  authorization_and_tenancy: "Authorization and tenancy",
  ai_boundary: "AI boundary",
  data_handling_and_retention: "Data handling and retention",
  input_validation_and_abuse: "Input validation and abuse",
  dependency_and_supply_chain: "Dependencies and supply chain",
  release_operations: "Release operations",
  observability_and_incident_response: "Observability and incident response",
  accessibility: "Accessibility",
  code_quality_and_tests: "Code quality and tests",
  documentation_and_handover: "Documentation and handover",
};

/**
 * What each verdict means, in the customer's terms.
 *
 * Note what the last one does NOT say. It reports what the review found; it does
 * not tell the customer their application is secure, because a review of one
 * commit cannot establish that.
 */
export const VERDICT_COPY: Record<ReleaseVerdict, { headline: string; explanation: string }> = {
  release_blocked: {
    headline: "Blocked",
    explanation:
      "At least one confirmed finding on a release-gating check. We recommend resolving these before you ship.",
  },
  conditional_release: {
    headline: "Conditional",
    explanation:
      "Nothing confirmed as release-blocking, but something is unresolved: a check we could not assess, or a serious finding we could not confirm. Verify those before you ship.",
  },
  release_with_tracked_findings: {
    headline: "Findings to track",
    explanation:
      "Every check was assessed and nothing reached high severity. The findings below are worth fixing, but none of them blocks this release.",
  },
  no_blocking_findings_identified: {
    headline: "No blocking findings identified",
    explanation:
      "Every check was assessed and this review identified nothing above informational. That is what we found in one repository at one commit; it is not a guarantee that no problem exists.",
  },
};

export type CustomerFindingView = {
  id: string;
  dimension: RubricDimension;
  dimensionTitle: string;
  checkTitle: string;
  severity: FindingSeverity;
  blocking: boolean;
  confidence: string;
  title: string;
  whatWeObserved: string;
  whyItMatters: string;
  recommendation: string;
  /**
   * Where to look, never what is there. A customer opens these in their own
   * checkout, where the source already is; the artifact does not carry a copy.
   */
  /**
   * `lineRange` rather than `lines`, deliberately.
   *
   * `lines` is on the forbidden source-field list — a `lines` array is how source
   * text is carried — and a field whose name is forbidden elsewhere should not
   * also be a legitimate field here. This one holds a formatted range like
   * "18–27", never file content.
   */
  locations: Array<{ path: string; lineRange: string | null }>;
  /**
   * What the auditor looked at, on the same terms as a location: a kind from the
   * rubric's closed set, a path, and a formatted line range. It replaced a
   * 500-character free-text `reference`, which was a pointer-shaped field that
   * was still a field.
   */
  evidence: Array<{ kind: RubricEvidenceKind; path: string; lineRange: string | null }>;
  effort: string;
  inRemediationSprintScope: boolean;
  residualUncertainty: string | null;
};

export type DimensionSummaryView = {
  dimension: RubricDimension;
  title: string;
  totalChecks: number;
  assessedChecks: number;
  passedChecks: number;
  concernChecks: number;
  failedChecks: number;
  notApplicableChecks: number;
  notAssessedChecks: number;
  findingCount: number;
};

export type CustomerReportView = {
  engagementId: string;
  generatedAt: string;
  rubricVersion: string;
  scope: {
    repositoryRef: string;
    commitSha: string;
    defaultBranch: string;
    usesAiFeatures: boolean;
    handlesCustomerData: boolean;
    triggersExternalActions: boolean;
    /** How many exclusions the customer recorded, not what they said. */
    exclusionCount: number;
    aiAssistedReviewAccepted: boolean;
  };
  verdict: ReleaseVerdict;
  verdictHeadline: string;
  verdictExplanation: string;
  severityCounts: Record<FindingSeverity, number>;
  blockingFindingCount: number;
  coverage: { assessedChecks: number; totalChecks: number; notAssessedChecks: number };
  dimensions: DimensionSummaryView[];
  findings: CustomerFindingView[];
  remediationSprint: { eligibleFindingIds: string[]; eligibleCount: number };
  limitations: string[];
  disclaimers: string[];
  preparedByKind: string;
  reviewedByName: string | null;
};

function formatLines(startLine: number | null, endLine: number | null): string | null {
  if (startLine === null) return null;
  if (endLine === null || endLine === startLine) return `line ${startLine}`;
  return `lines ${startLine}–${endLine}`;
}

/** Most severe first; confirmed before unconfirmed at equal severity; then stable by id. */
function compareFindings(a: CustomerFindingView, b: CustomerFindingView): number {
  const bySeverity = severityRank(b.severity) - severityRank(a.severity);
  if (bySeverity !== 0) return bySeverity;
  if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function summarizeDimensions(report: ReleaseRescueReportV1): DimensionSummaryView[] {
  const assessmentsById = new Map(report.assessments.map((assessment) => [assessment.checkId, assessment]));
  const findingsByDimension = new Map<RubricDimension, number>();
  for (const finding of report.findings) {
    findingsByDimension.set(finding.dimension, (findingsByDimension.get(finding.dimension) ?? 0) + 1);
  }

  return RUBRIC_DIMENSIONS.map((dimension) => {
    const checks = RELEASE_RESCUE_RUBRIC_V1.filter((check) => check.dimension === dimension);
    const summary: DimensionSummaryView = {
      dimension,
      title: DIMENSION_TITLES[dimension],
      totalChecks: checks.length,
      assessedChecks: 0,
      passedChecks: 0,
      concernChecks: 0,
      failedChecks: 0,
      notApplicableChecks: 0,
      notAssessedChecks: 0,
      findingCount: findingsByDimension.get(dimension) ?? 0,
    };

    for (const check of checks) {
      const outcome = assessmentsById.get(check.id)?.outcome ?? "not_assessed";
      if (outcome === "not_assessed") {
        summary.notAssessedChecks += 1;
        continue;
      }
      summary.assessedChecks += 1;
      if (outcome === "pass") summary.passedChecks += 1;
      else if (outcome === "concern") summary.concernChecks += 1;
      else if (outcome === "fail") summary.failedChecks += 1;
      else summary.notApplicableChecks += 1;
    }

    return summary;
  });
}

/**
 * Builds the customer-facing view from a stored report.
 *
 * Every field is copied deliberately. There is no spread of the source report
 * anywhere in this function, which is what keeps a newly added internal field
 * from reaching a customer by default.
 */
/**
 * The four standing disclaimers, rendered on every report.
 *
 * Hoisted out of the presenter body so they have a NAME. A test that asks "does
 * every sentence in the customer's view have an owner in this repository?" needs
 * something to point at; an inline literal is indistinguishable from a sentence
 * somebody smuggled in.
 *
 * These are `verbatim_approved` in the field-coverage policy's sense: they
 * contain the prohibited phrases on purpose, because they are denying them.
 */
/**
 * What the customer sees when a stored code is not in this build's catalog.
 *
 * Two properties matter and only one is obvious. It must not crash or blank, so
 * a report written against a newer catalog still renders — that is the obvious
 * one. It must also not print the stored value, because an unknown code is
 * precisely the case where that value is untrusted. An audit found the earlier
 * `?? finding.observationCode` fallback rendering an auditor-supplied sentence,
 * credential and all, straight into the customer's report.
 */
export const UNAVAILABLE_TITLE = "This finding's wording is not available in this build" as const;
export const UNAVAILABLE_TEXT =
  "The wording for this entry is not available in the version of the catalog this report was rendered with. The finding's location, severity and remediation scope above are unaffected." as const;

export const STANDING_DISCLAIMERS: readonly string[] = Object.freeze([
  "This review is not a penetration test.",
  "This review is not a compliance certification.",
  "This review does not guarantee the absence of security vulnerabilities.",
  "Findings describe one repository at one commit. Changes made after that commit were not reviewed.",
]);

export function toCustomerReportView(report: ReleaseRescueReportV1): CustomerReportView {
  const findings: CustomerFindingView[] = report.findings
    .map((finding) => {
      // Recomputed, not copied.
      //
      // "Severity is derived, never chosen" was true of the validator and only
      // of the validator: this presenter used to copy the stored fields, so a
      // render path that forgot to validate first would show whatever the
      // artifact claimed. Deriving here means the document a customer reads
      // cannot disagree with the observations behind it, whatever reached it.
      const check = getRubricCheck(finding.rubricCheckId);
      const observation = getObservation(finding.observationCode);
      const remediation = getRemediation(finding.remediationCode);
      const severity = computeFindingSeverity(finding);
      const blocking = check ? computeFindingBlocking(check, severity, finding.confidence) : true;
      return {
      id: finding.findingId,
      dimension: finding.dimension,
      dimensionTitle: DIMENSION_TITLES[finding.dimension],
      checkTitle: check?.title ?? finding.rubricCheckId,
      severity,
      blocking,
      confidence: finding.confidence,
      // THE WORDS COME FROM THE CATALOG, not from the artifact.
      //
      // This is where Option 1 actually lands. The stored finding has an
      // observation code; the sentences a customer reads are looked up here. An
      // executor that wanted to put a credential in this paragraph would have to
      // add an entry to a file in the repository, which is a code review.
      //
      // THE FALLBACK DOES NOT ECHO THE STORED VALUE. It used to, and an audit
      // showed why that was the whole render path of a live defect: an unknown
      // code is exactly the case where the stored string is untrusted, and
      // `?? finding.observationCode` printed it to the customer verbatim. A
      // report written against a newer catalog still must not crash or blank, so
      // it degrades to a fixed sentence that says what happened and quotes
      // nothing.
      title: observation?.title ?? UNAVAILABLE_TITLE,
      whatWeObserved: observation?.whatWeObserved ?? UNAVAILABLE_TEXT,
      whyItMatters: observation?.whyItMatters ?? "",
      recommendation: remediation?.text ?? UNAVAILABLE_TEXT,
      locations: finding.locations.map((location) => ({
        path: location.path,
        lineRange: formatLines(location.startLine, location.endLine),
      })),
      evidence: finding.evidence.map((item) => ({
        kind: item.kind,
        path: item.path,
        lineRange: formatLines(item.startLine, item.endLine),
      })),
      effort: finding.remediationEffort,
      inRemediationSprintScope: finding.inRemediationSprintScope,
      residualUncertainty:
        finding.uncertaintyCode === null
          ? null
          : (UNCERTAINTY_CATALOG[finding.uncertaintyCode as UncertaintyCode] ?? UNAVAILABLE_TEXT),
      };
    })
    .sort(compareFindings);

  // Counts recomputed from the recomputed findings, for the same reason.
  const severityCounts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };
  for (const finding of findings) severityCounts[finding.severity] += 1;
  const blockingFindingCount = findings.filter((finding) => finding.blocking).length;

  const verdictCopy = VERDICT_COPY[report.verdict];

  return {
    engagementId: report.engagementId,
    generatedAt: report.generatedAt,
    rubricVersion: report.rubricVersion,
    scope: {
      repositoryRef: report.scope.repository.repositoryRef,
      // From the pinned field, not from the scope: the scope no longer carries a
      // commit, because it is frozen before one exists.
      commitSha: report.reviewedCommitSha,
      defaultBranch: report.scope.repository.defaultBranch,
      // The header identifies the engagement and stops there. It used to carry
      // the customer's own application and workflow descriptions verbatim; an
      // audit planted an assignment in `scope.application.description` and
      // delivered it to this surface. What identifies a review is the repository
      // reference and the commit, both of which are already bounded identifiers.
      usesAiFeatures: report.scope.application.usesAiFeatures,
      handlesCustomerData: report.scope.criticalWorkflow.handlesCustomerData,
      triggersExternalActions: report.scope.criticalWorkflow.triggersExternalActions,
      exclusionCount: report.scope.exclusionCount,
      aiAssistedReviewAccepted: report.scope.aiAssistedReviewAccepted,
    },
    verdict: report.verdict,
    verdictHeadline: verdictCopy.headline,
    verdictExplanation: verdictCopy.explanation,
    severityCounts,
    blockingFindingCount,
    coverage: {
      assessedChecks: report.coverage.assessedChecks,
      totalChecks: report.coverage.totalChecks,
      notAssessedChecks: report.coverage.notAssessedChecks,
    },
    dimensions: summarizeDimensions(report),
    findings,
    remediationSprint: {
      eligibleFindingIds: findings.filter((finding) => finding.inRemediationSprintScope).map((finding) => finding.id),
      eligibleCount: findings.filter((finding) => finding.inRemediationSprintScope).length,
    },
    limitations: report.limitationCodes.map(
      (code) => LIMITATION_CATALOG[code as LimitationCode] ?? UNAVAILABLE_TEXT,
    ),
    disclaimers: [...STANDING_DISCLAIMERS],
    preparedByKind: report.preparedBy.executorKind,
    reviewedByName: report.reviewedBy?.displayName ?? null,
  };
}

/** Internal identifiers that must never appear in a customer-facing document. */
export function findInternalIdentityLeaks(view: CustomerReportView, report: ReleaseRescueReportV1): string[] {
  const serialized = JSON.stringify(view);
  const leaks: string[] = [];
  const forbidden: Array<[string, string | null]> = [
    ["organizationId", report.organizationId],
    ["runId", report.runId],
    ["reportId", report.reportId],
    ["executorKey", report.preparedBy.executorKey],
    ["modelId", report.preparedBy.modelId],
    ["operatorUserId", report.reviewedBy?.operatorUserId ?? null],
  ];

  for (const [label, value] of forbidden) {
    if (value !== null && value.length > 0 && serialized.includes(value)) {
      leaks.push(`Customer report view leaked ${label} ("${value}").`);
    }
  }
  return leaks;
}
