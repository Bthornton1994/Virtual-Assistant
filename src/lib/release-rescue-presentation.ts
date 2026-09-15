import {
  RELEASE_RESCUE_RUBRIC_V1,
  RUBRIC_DIMENSIONS,
  getRubricCheck,
  type RubricDimension,
} from "@/lib/release-rescue-rubric";
import { severityRank, type FindingSeverity } from "@/lib/release-rescue-findings";
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
  locations: Array<{ path: string; lines: string | null; excerpt: string | null }>;
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
    applicationName: string;
    applicationDescription: string;
    primaryStack: string;
    criticalWorkflowName: string;
    criticalWorkflowDescription: string;
    exclusions: string[];
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
export function toCustomerReportView(report: ReleaseRescueReportV1): CustomerReportView {
  const findings: CustomerFindingView[] = report.findings
    .map((finding) => ({
      id: finding.findingId,
      dimension: finding.dimension,
      dimensionTitle: DIMENSION_TITLES[finding.dimension],
      checkTitle: getRubricCheck(finding.rubricCheckId)?.title ?? finding.rubricCheckId,
      severity: finding.severity,
      blocking: finding.blocking,
      confidence: finding.confidence,
      title: finding.title,
      whatWeObserved: finding.whatWeObserved,
      whyItMatters: finding.whyItMatters,
      recommendation: finding.recommendation,
      locations: finding.locations.map((location) => ({
        path: location.path,
        lines: formatLines(location.startLine, location.endLine),
        excerpt: location.excerpt,
      })),
      effort: finding.remediationEffort,
      inRemediationSprintScope: finding.inRemediationSprintScope,
      residualUncertainty: finding.residualUncertainty.trim().length > 0 ? finding.residualUncertainty : null,
    }))
    .sort(compareFindings);

  const verdictCopy = VERDICT_COPY[report.verdict];

  return {
    engagementId: report.engagementId,
    generatedAt: report.generatedAt,
    rubricVersion: report.rubricVersion,
    scope: {
      repositoryRef: report.scope.repository.repositoryRef,
      commitSha: report.scope.repository.commitSha,
      defaultBranch: report.scope.repository.defaultBranch,
      applicationName: report.scope.application.name,
      applicationDescription: report.scope.application.description,
      primaryStack: report.scope.application.primaryStack,
      criticalWorkflowName: report.scope.criticalWorkflow.name,
      criticalWorkflowDescription: report.scope.criticalWorkflow.description,
      exclusions: [...report.scope.customerExclusions],
    },
    verdict: report.verdict,
    verdictHeadline: verdictCopy.headline,
    verdictExplanation: verdictCopy.explanation,
    severityCounts: { ...report.severityCounts },
    blockingFindingCount: report.blockingFindingCount,
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
    limitations: [...report.limitations],
    disclaimers: [
      "This review is not a penetration test.",
      "This review is not a compliance certification.",
      "This review does not guarantee the absence of security vulnerabilities.",
      "Findings describe one repository at one commit. Changes made after that commit were not reviewed.",
    ],
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
