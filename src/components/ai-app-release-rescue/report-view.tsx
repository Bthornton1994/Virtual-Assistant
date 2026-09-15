import Link from "next/link";
import { Badge } from "@/components/ui";
import { NonClaimsCallout } from "@/components/ai-app-release-rescue/non-claims";
import {
  READINESS_COPY,
  RESCUE_PATH,
  RUBRIC_CATEGORY_COPY,
  type FindingSeverity,
  type ReadinessLevel,
} from "@/lib/ai-app-release-rescue/constants";
import type { CustomerRescueReport } from "@/lib/ai-app-release-rescue/report";

const SEVERITY_TONE: Record<FindingSeverity, "bad" | "warn" | "info" | "neutral"> = {
  critical: "bad",
  high: "bad",
  medium: "warn",
  low: "info",
  informational: "neutral",
};

const READINESS_TONE: Record<ReadinessLevel, "good" | "warn" | "bad"> = {
  ready: "good",
  ready_with_caveats: "warn",
  not_ready: "bad",
};

export function ReportView({
  report,
  contentHash,
  view,
  synthetic,
}: {
  report: CustomerRescueReport;
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
        <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">Release-readiness report</h1>
        <p className="max-w-2xl text-pretty text-ink-soft">
          Engagement {report.engagement_id}. Reviewed commit {report.scope.repository_ref}. Status {report.status}.
        </p>
        <p className="text-xs text-muted">
          Content hash <span className="font-mono tabular-nums">{contentHash.slice(0, 12)}…</span>
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="underline" href={view === "json" ? readableHref : jsonHref}>
            {view === "json" ? "Readable view" : "Structured JSON"}
          </Link>
          <Link className="underline" href={`${RESCUE_PATH}/demo/report/download`}>
            Download JSON
          </Link>
        </div>
      </header>

      <NonClaimsCallout id="report-limitations" />

      {view === "json" ? (
        <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed">
          <code>{JSON.stringify(report, null, 2)}</code>
        </pre>
      ) : (
        <>
          <section>
            <h2 className="text-xl font-semibold tracking-tight">Scope</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Item term="Repository" detail={report.scope.repository_url} />
              <Item term="Commit" detail={report.scope.repository_ref} />
              <Item term="Application" detail={report.scope.app_type} />
              <Item term="Critical workflow" detail={report.scope.critical_workflow} />
              <Item term="Deployment" detail={report.scope.deployment_url ?? "Not provided"} />
              <Item term="Reviewer" detail={report.reviewer.executor_type.replaceAll("_", " ")} />
            </dl>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Badge tone={READINESS_TONE[report.summary.overall_readiness]}>
                {report.summary.overall_readiness.replaceAll("_", " ")}
              </Badge>
              <p className="text-sm text-ink-soft">{READINESS_COPY[report.summary.overall_readiness]}</p>
            </div>
            <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed">{report.summary.recommendation}</p>
            <ul className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Count label="Critical" value={report.summary.critical_findings} />
              <Count label="High" value={report.summary.high_findings} />
              <Count label="Medium" value={report.summary.medium_findings} />
              <Count label="Low" value={report.summary.low_findings} />
              <Count label="Info" value={report.summary.informational_findings} />
            </ul>
            {report.summary.remediation_estimate ? (
              <p className="mt-4 text-sm text-ink-soft">{report.summary.remediation_estimate}</p>
            ) : null}
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Rubric scores</h2>
            <ul className="mt-4 space-y-3">
              {report.rubric_scores.map((row) => (
                <li key={row.category} className="rounded-xl border border-line bg-surface px-4 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{RUBRIC_CATEGORY_COPY[row.category].title}</h3>
                    <p className="text-sm tabular-nums">
                      {row.score}/5 · {row.label}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">{row.summary}</p>
                  <p className="mt-2 text-xs text-muted tabular-nums">{row.findings_count} findings</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Findings</h2>
            <ul className="mt-4 space-y-4">
              {report.findings.map((finding) => (
                <li key={finding.id} className="rounded-xl border border-line bg-surface px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs text-muted">{finding.id}</p>
                    <Badge tone={SEVERITY_TONE[finding.severity]}>{finding.severity}</Badge>
                    {finding.remediation_sprint_eligible ? (
                      <Badge tone="accent">Sprint eligible</Badge>
                    ) : (
                      <Badge>Not in sprint</Badge>
                    )}
                  </div>
                  <h3 className="mt-2 text-base font-semibold tracking-tight">{finding.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{finding.description}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted">Evidence</p>
                  <p className="mt-1 text-sm">
                    {finding.evidence.type.replaceAll("_", " ")} · {finding.evidence.location}
                  </p>
                  {finding.evidence.snippet ? (
                    <pre className="mt-2 overflow-x-auto rounded-md bg-bg px-3 py-2 text-xs">
                      <code>{finding.evidence.snippet}</code>
                    </pre>
                  ) : null}
                  {finding.evidence.observation ? (
                    <p className="mt-2 text-sm text-ink-soft">{finding.evidence.observation}</p>
                  ) : null}
                  <p className="mt-3 text-sm">
                    <span className="font-medium">Impact.</span> {finding.impact}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Recommendation.</span> {finding.recommendation}
                  </p>
                  <p className="mt-2 text-xs text-muted">Effort {finding.effort}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Recommendations</h2>
            <RecommendationGroup title="Before release" items={report.recommendations.immediate} />
            <RecommendationGroup title="Short term" items={report.recommendations.short_term} />
            <RecommendationGroup title="Longer term" items={report.recommendations.long_term} />
            <p className="mt-4 text-sm text-ink-soft">{report.recommendations.remediation_sprint.estimated_scope}</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold tracking-tight">Appendices</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Item
                term="Dependencies"
                detail={`${report.appendices.dependency_summary.total_dependencies} total, ${report.appendices.dependency_summary.outdated} outdated (${report.appendices.dependency_summary.tool_used})`}
              />
              <Item
                term="CI"
                detail={`Pipeline ${report.appendices.ci_cd_summary.pipeline_present ? "present" : "absent"}. Lint ${report.appendices.ci_cd_summary.lint_configured ? "yes" : "no"}.`}
              />
              <Item
                term="Accessibility sample"
                detail={`${report.appendices.accessibility_summary.pages_tested} pages via ${report.appendices.accessibility_summary.tool_used}`}
              />
              <Item
                term="AI assistance"
                detail={report.appendices.review_metadata.ai_assisted ? "Yes" : "Human-only"}
              />
            </dl>
          </section>
        </>
      )}
    </article>
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

function RecommendationGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{ finding_id: string; action: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {items.map((item) => (
          <li key={`${item.finding_id}-${item.action}`}>
            <span className="font-mono text-xs text-muted">{item.finding_id}</span> {item.action}
          </li>
        ))}
      </ul>
    </div>
  );
}
