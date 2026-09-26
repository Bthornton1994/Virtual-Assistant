import { Badge, Card } from "@/components/ui";
import {
  ASSESSMENT_RATIONALE_CATALOG,
  LIMITATION_CATALOG,
  UNCERTAINTY_CATALOG,
  getObservation,
  getRemediation,
  isAssessmentRationaleCode,
  isLimitationCode,
} from "@/lib/release-rescue-observation-catalog";
import { DIMENSION_TITLES, VERDICT_COPY } from "@/lib/release-rescue-presentation";
import { getRubricCheck } from "@/lib/release-rescue-rubric";
import type { ReleaseRescueReportV1 } from "@/lib/release-rescue-report";
import type { CheckRun } from "@/lib/release-rescue-internal/checks";

// The DRAFT a reviewer reads before signing.
//
// This is not the customer view. A customer view only exists once a signed
// report has passed `decideReleaseRescueDelivery`. Every sentence here is read
// from the catalog by the code the draft stores, so what the reviewer reads is
// exactly what the stored artifact says, and nothing a repository contained.

const STATUS_TONE: Record<CheckRun["status"], "good" | "bad" | "warn" | "neutral"> = {
  PASS: "good",
  FAIL: "bad",
  BLOCKED: "warn",
  NOT_RUN: "neutral",
};

const SEVERITY_TONE = { critical: "bad", high: "bad", medium: "warn", low: "info", informational: "neutral" } as const;

export function CheckLedger({ checkRuns }: { checkRuns: CheckRun[] }) {
  const counts = checkRuns.reduce<Record<string, number>>((totals, run) => {
    totals[run.status] = (totals[run.status] ?? 0) + 1;
    return totals;
  }, {});
  return (
    <section aria-labelledby="ledger-heading" className="space-y-3">
      <h2 id="ledger-heading" className="text-lg font-semibold">
        What ran
      </h2>
      <p className="text-sm text-ink-soft">
        {counts.FAIL ?? 0} FAIL, {counts.PASS ?? 0} PASS, {counts.BLOCKED ?? 0} BLOCKED, {counts.NOT_RUN ?? 0} NOT RUN.
        PASS means an automated check read every file it covers and recorded nothing; the report still leaves that check
        not assessed, because an automated check finding nothing does not show the control holds. BLOCKED means it
        could not read a file it covers, or recorded observations in files this report cannot name. NOT RUN means no
        automated check exists for it and no model-assisted analysis ran.
      </p>
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-2">Check</th>
            <th>Status</th>
            <th>Files read</th>
            <th>Files not read</th>
            <th>Observations</th>
            <th>Not citable</th>
          </tr>
        </thead>
        <tbody>
          {checkRuns.map((run) => (
            <tr key={run.checkId} className="border-t border-line">
              <td className="py-1.5 font-mono text-xs">{run.checkId}</td>
              <td>
                <Badge tone={STATUS_TONE[run.status]}>{run.status.replace("_", " ")}</Badge>
              </td>
              <td>{run.implementation === "deterministic" ? run.filesExamined : "none"}</td>
              <td>{run.implementation === "deterministic" ? run.filesNotRead : "none"}</td>
              <td>{run.implementation === "deterministic" ? run.observationCount : "none"}</td>
              <td>{run.implementation === "deterministic" ? run.uncitedObservationCount : "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function DraftReview({ report, subjectHash }: { report: ReleaseRescueReportV1; subjectHash: string }) {
  const verdict = VERDICT_COPY[report.verdict];
  return (
    <article className="space-y-8" aria-labelledby="draft-heading">
      <header className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Unsigned draft</p>
        <h2 id="draft-heading" className="text-2xl font-semibold tracking-tight">
          {report.scope.repository.repositoryRef}
        </h2>
        <p className="text-sm text-ink-soft">
          Commit <span className="font-mono">{report.reviewedCommitSha}</span>. Rubric {report.rubricVersion}. Prepared
          by {report.preparedBy.executorKind} checks, no model.
        </p>
        <p className="text-sm">
          Content you are signing: <span className="break-all font-mono text-xs">{subjectHash}</span>
        </p>
      </header>

      <Card className="p-4">
        <p className="text-sm font-semibold">
          Verdict: {verdict.headline} <span className="font-mono text-xs text-muted">({report.verdict})</span>
        </p>
        <p className="mt-1 text-sm text-ink-soft">{verdict.explanation}</p>
        <p className="mt-3 text-sm">
          Coverage: {report.coverage.assessedChecks} of {report.coverage.totalChecks} checks assessed,{" "}
          {report.coverage.blockingChecksAssessed} of {report.coverage.blockingChecksTotal} release-gating checks.
          Findings: {report.findings.length}, {report.blockingFindingCount} blocking.
        </p>
      </Card>

      <section aria-labelledby="findings-heading" className="space-y-3">
        <h3 id="findings-heading" className="text-lg font-semibold">
          Findings
        </h3>
        {report.findings.length === 0 ? <p className="text-sm text-ink-soft">No findings were recorded.</p> : null}
        {report.findings.map((finding) => {
          const observation = getObservation(finding.observationCode);
          const remediation = getRemediation(finding.remediationCode);
          return (
            <Card key={finding.findingId} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{finding.findingId}</span>
                <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
                <Badge tone="neutral">{finding.confidence}</Badge>
                {finding.blocking ? <Badge tone="bad">blocking</Badge> : null}
              </div>
              <p className="font-semibold">{observation?.title ?? finding.observationCode}</p>
              <p className="text-sm text-ink-soft">{observation?.whatWeObserved}</p>
              {finding.uncertaintyCode ? (
                <p className="text-sm text-ink-soft">{UNCERTAINTY_CATALOG[finding.uncertaintyCode]}</p>
              ) : null}
              <ul className="list-disc pl-5 font-mono text-xs">
                {finding.locations.map((location) => (
                  <li key={`${location.path}:${location.startLine}`}>
                    {location.path}
                    {location.startLine ? `:${location.startLine}` : ""}
                    {location.endLine && location.endLine !== location.startLine ? `-${location.endLine}` : ""}
                  </li>
                ))}
              </ul>
              {remediation ? <p className="text-sm">Remediation: {remediation.text}</p> : null}
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="assessments-heading" className="space-y-3">
        <h3 id="assessments-heading" className="text-lg font-semibold">
          Every check, as the report records it
        </h3>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2">Dimension</th>
              <th>Check</th>
              <th>Outcome</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {report.assessments.map((assessment) => {
              const check = getRubricCheck(assessment.checkId);
              return (
                <tr key={assessment.checkId} className="border-t border-line align-top">
                  <td className="py-1.5 text-xs">{check ? DIMENSION_TITLES[check.dimension] : ""}</td>
                  <td className="font-mono text-xs">{assessment.checkId}</td>
                  <td className="text-xs">{assessment.outcome}</td>
                  <td className="text-xs text-ink-soft">
                    {isAssessmentRationaleCode(assessment.rationaleCode)
                      ? ASSESSMENT_RATIONALE_CATALOG[assessment.rationaleCode].text
                      : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="limitations-heading" className="space-y-2">
        <h3 id="limitations-heading" className="text-lg font-semibold">
          Limitations
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {report.limitationCodes.map((code) => (
            <li key={code}>{isLimitationCode(code) ? LIMITATION_CATALOG[code] : code}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
