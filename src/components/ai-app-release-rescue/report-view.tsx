import Link from "next/link";
import { Badge } from "@/components/ui";
import { NonClaimsCallout } from "@/components/ai-app-release-rescue/non-claims";
import { RESCUE_PATH } from "@/lib/ai-app-release-rescue/constants";
import type { FindingSeverity } from "@/lib/release-rescue-findings";
import type { ReleaseVerdict } from "@/lib/release-rescue-report";
import type { CustomerFindingView, CustomerReportView } from "@/lib/release-rescue-presentation";

const SEVERITY_TONE: Record<FindingSeverity, "bad" | "warn" | "info" | "neutral"> = {
  critical: "bad",
  high: "bad",
  medium: "warn",
  low: "info",
  informational: "neutral",
};

const VERDICT_TONE: Record<ReleaseVerdict, "good" | "warn" | "bad"> = {
  release_blocked: "bad",
  conditional_release: "warn",
  release_with_tracked_findings: "warn",
  no_blocking_findings_identified: "good",
};

export function ReportView({
  report,
  contentHash,
  view,
  synthetic,
}: {
  report: CustomerReportView;
  contentHash: string;
  view: "readable" | "json";
  synthetic: boolean;
}) {
  const jsonHref = `${RESCUE_PATH}/demo/report?view=json`;
  const readableHref = `${RESCUE_PATH}/demo/report`;

  return (
    <article className="space-y-10">
      {synthetic ? (
        <p className="rounded-md border border-gold/40 bg-warn-bg px-3 py-2 text-sm text-warn" role="status">
          Synthetic sample. Harbor Ledger is a fictional app. This is not a customer report and not a live review.
        </p>
      ) : null}

      <header className="space-y-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Customer-safe report</p>
        <h1 className="text-balance text-3xl font-semibold tracking-tight">{report.scope.applicationName}</h1>
        <p className="text-sm text-ink-soft">
          Engagement {report.engagementId}. Reviewed commit {report.scope.commitSha.slice(0, 12)}. Rubric{" "}
          {report.rubricVersion}.
        </p>
        <p className="font-mono text-xs text-muted break-all">Report hash {contentHash}</p>
        <p className="text-sm">
          <Link className="underline underline-offset-4" href={view === "json" ? readableHref : jsonHref}>
            {view === "json" ? "Read the report" : "View the JSON"}
          </Link>
          {" · "}
          <Link className="underline underline-offset-4" href={`${RESCUE_PATH}/demo/report/download`}>
            Download JSON
          </Link>
        </p>
      </header>

      {view === "json" ? (
        <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed">
          <code>{JSON.stringify(report, null, 2)}</code>
        </pre>
      ) : (
        <>
          <section aria-labelledby="scope-heading">
            <h2 id="scope-heading" className="text-xl font-semibold tracking-tight">
              What was reviewed
            </h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Item term="Repository" detail={report.scope.repositoryRef} />
              <Item term="Commit" detail={report.scope.commitSha} />
              <Item term="Stack" detail={report.scope.primaryStack.replaceAll("_", " ")} />
              <Item term="Critical workflow" detail={report.scope.criticalWorkflowName} />
              <Item term="Workflow entry point" detail={report.scope.criticalWorkflowDescription} />
              <Item term="Reviewed by" detail={report.reviewedByName ?? "Pending human review"} />
              <Item
                term="Review mode"
                detail={
                  report.scope.aiAssistedReviewAccepted
                    ? "AI-assisted, signed by a human reviewer"
                    : "Human-only, as you requested"
                }
              />
            </dl>
            {report.scope.exclusions.length > 0 ? (
              <p className="mt-4 text-sm text-ink-soft">
                Excluded at your request: {report.scope.exclusions.join(" ")}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="verdict-heading">
            <h2 id="verdict-heading" className="text-xl font-semibold tracking-tight">
              Where this release stands
            </h2>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Badge tone={VERDICT_TONE[report.verdict]}>{report.verdictHeadline}</Badge>
              <p className="text-sm text-ink-soft">
                {report.coverage.assessedChecks} of {report.coverage.totalChecks} checks assessed
              </p>
            </div>
            <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed">{report.verdictExplanation}</p>
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Count label="Critical" value={report.severityCounts.critical} />
              <Count label="High" value={report.severityCounts.high} />
              <Count label="Medium" value={report.severityCounts.medium} />
              <Count label="Low" value={report.severityCounts.low} />
              <Count label="Info" value={report.severityCounts.informational} />
            </ul>
            <p className="mt-4 text-sm text-ink-soft">
              {report.blockingFindingCount === 0
                ? "No finding was confirmed as release-blocking."
                : `${report.blockingFindingCount} finding${report.blockingFindingCount === 1 ? "" : "s"} confirmed as release-blocking.`}
            </p>
          </section>

          <section aria-labelledby="coverage-heading">
            <h2 id="coverage-heading" className="text-xl font-semibold tracking-tight">
              Coverage by area
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {report.dimensions.map((row) => (
                <li key={row.dimension} className="rounded-xl border border-line bg-surface px-4 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold">{row.title}</h3>
                    <p className="text-xs text-muted tabular-nums">
                      {row.assessedChecks}/{row.totalChecks} assessed
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    {row.passedChecks} pass · {row.concernChecks} concern · {row.failedChecks} fail
                    {row.notApplicableChecks > 0 ? ` · ${row.notApplicableChecks} n/a` : ""}
                    {row.notAssessedChecks > 0 ? ` · ${row.notAssessedChecks} not assessed` : ""}
                  </p>
                  <p className="mt-2 text-xs text-muted tabular-nums">
                    {row.findingCount} finding{row.findingCount === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="findings-heading">
            <h2 id="findings-heading" className="text-xl font-semibold tracking-tight">
              Findings
            </h2>
            <ul className="mt-4 space-y-4">
              {report.findings.map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
            </ul>
            {report.findings.length === 0 ? (
              <p className="mt-4 text-sm text-ink-soft">This review identified nothing above informational.</p>
            ) : null}
          </section>

          {report.remediationSprint.eligibleCount > 0 ? (
            <section aria-labelledby="sprint-heading">
              <h2 id="sprint-heading" className="text-xl font-semibold tracking-tight">
                What a remediation sprint would cover
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
                {report.remediationSprint.eligibleCount} of these findings are in scope for the remediation sprint:{" "}
                {report.remediationSprint.eligibleFindingIds.join(", ")}. The rest are yours to schedule, and you are
                free to fix all of them yourself.
              </p>
            </section>
          ) : null}

          <section aria-labelledby="limits-heading">
            <h2 id="limits-heading" className="text-xl font-semibold tracking-tight">
              What this review did not establish
            </h2>
            <ul className="mt-4 space-y-2 text-sm text-ink-soft">
              {report.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </section>

          <NonClaimsCallout />
        </>
      )}
    </article>
  );
}

function FindingCard({ finding }: { finding: CustomerFindingView }) {
  return (
    <li className="rounded-xl border border-line bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-xs text-muted">{finding.id}</p>
        <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
        {finding.blocking ? <Badge tone="bad">blocks release</Badge> : null}
        {finding.confidence !== "confirmed" ? <Badge tone="warn">{finding.confidence}</Badge> : null}
        {finding.inRemediationSprintScope ? <Badge tone="neutral">sprint scope</Badge> : null}
      </div>
      <h3 className="mt-2 text-base font-semibold tracking-tight">{finding.title}</h3>
      <p className="mt-1 text-xs text-muted">
        {finding.dimensionTitle} · {finding.checkTitle}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{finding.whatWeObserved}</p>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-medium">Why it matters.</span> {finding.whyItMatters}
      </p>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-medium">What to do.</span> {finding.recommendation}
      </p>
      {finding.locations.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {finding.locations.map((location) => (
            <li key={`${location.path}-${location.lines ?? "all"}`} className="font-mono text-xs text-muted">
              {location.path}
              {location.lines ? ` · ${location.lines}` : ""}
              {location.excerpt ? (
                <pre className="mt-1 overflow-x-auto rounded-md border border-line bg-bg-elevated p-2">
                  <code>{location.excerpt}</code>
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {finding.residualUncertainty ? (
        <p className="mt-3 text-sm text-warn">
          <span className="font-medium">Not confirmed.</span> {finding.residualUncertainty}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">Effort {finding.effort}</p>
    </li>
  );
}

function Item({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-muted">{term}</dt>
      <dd className="mt-1 break-words">{detail}</dd>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-md border border-line bg-surface px-3 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </li>
  );
}
