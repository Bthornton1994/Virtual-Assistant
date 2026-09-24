import type { RunRecord } from "@/lib/release-rescue-internal/store";

// A run, summarised for a terminal or a local output file.
//
// Codes, counts, hashes, paths and line numbers only. It holds nothing a
// repository's files said, which is what makes it safe to print and to save
// under a gitignored output directory.

/**
 * Why model-assisted analysis did not run, and what did run instead. Shared by
 * the summary and the run page, so neither says checks ran when none did.
 */
export function modelAnalysisReason(record: Pick<RunRecord, "checkRuns">): string {
  return record.checkRuns.length > 0
    ? "No model provider is authorized for Release Rescue, so only the automated checks in the ledger ran."
    : "No model provider is authorized for Release Rescue, and no automated check ran either.";
}

export function runSummary(record: RunRecord) {
  const report = record.signed?.report ?? record.draft?.report ?? null;
  return {
    runId: record.runId,
    status: record.status,
    repositoryRef: record.repositoryRef,
    application: record.applicationName,
    criticalWorkflow: record.workflowName,
    commitSha: record.commitSha,
    source: record.source,
    createdAt: record.createdAt,
    createdBy: record.createdBy.displayName,
    retentionPolicy: record.retentionPolicy,
    acquisition: record.acquisition,
    checks: record.checkRuns.map((run) => ({
      checkId: run.checkId,
      status: run.status,
      implementation: run.implementation,
      filesExamined: run.filesExamined,
      filesNotRead: run.filesNotRead,
      observationCount: run.observationCount,
      uncitedObservationCount: run.uncitedObservationCount,
    })),
    checkStatusCounts: record.checkRuns.reduce<Record<string, number>>((counts, run) => {
      counts[run.status] = (counts[run.status] ?? 0) + 1;
      return counts;
    }, {}),
    notes: record.notes,
    processingFailure: record.processingFailure ?? null,
    report: report
      ? {
          verdict: report.verdict,
          coverage: report.coverage,
          severityCounts: report.severityCounts,
          blockingFindingCount: report.blockingFindingCount,
          findings: report.findings.map((finding) => ({
            findingId: finding.findingId,
            observationCode: finding.observationCode,
            severity: finding.severity,
            confidence: finding.confidence,
            blocking: finding.blocking,
            locations: finding.locations.map((location) =>
              location.startLine === null ? location.path : `${location.path}:${location.startLine}`,
            ),
          })),
          limitationCodes: report.limitationCodes,
          preparedBy: report.preparedBy.executorKind,
          signed: record.signed !== null,
          reviewer: record.signed ? record.signed.report.reviewedBy?.displayName ?? null : null,
        }
      : null,
    subjectHash: record.draft?.subjectHash ?? record.accounting.subjectHash,
    reportHash: record.signed?.reportHash ?? record.accounting.reportHash,
    deliveredAt: record.deliveredAt,
    purgedAt: record.purgedAt,
    modelDependentAnalysis: `NOT RUN: ${modelAnalysisReason(record)}`,
  };
}
