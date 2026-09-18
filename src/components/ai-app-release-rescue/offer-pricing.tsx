import { ButtonLink } from "@/components/ui";
import {
  RESCUE_PATH,
  RESCUE_REMEDIATION_PRICE_USD,
  RESCUE_REVIEW_PRICE_USD,
  formatUsd,
} from "@/lib/ai-app-release-rescue/constants";
import { RESCUE_PAYMENT } from "@/lib/ai-app-release-rescue/payment";
import { VERDICT_COPY } from "@/lib/release-rescue-presentation";

export function OfferPricing() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <article className="bg-accent px-6 py-8 text-accent-fg sm:px-8">
        <p className="text-[11px] uppercase tracking-[0.16em] text-gold-on-accent">Review</p>
        <p className="mt-3 font-semibold text-5xl tracking-tight tabular-nums">{formatUsd(RESCUE_REVIEW_PRICE_USD)}</p>
        <p className="mt-2 text-sm text-accent-fg/70">Fixed price. One repository, one web app, one workflow.</p>
        <ul className="mt-8 space-y-3 text-sm">
          <li>Thirty-two checks across twelve areas, each with a recorded outcome</li>
          <li>Findings with evidence you can check in the repo</li>
          <li>
            A report verdict: {VERDICT_COPY.release_blocked.headline.toLowerCase()},{" "}
            {VERDICT_COPY.conditional_release.headline.toLowerCase()},{" "}
            {VERDICT_COPY.release_with_tracked_findings.headline.toLowerCase()}, or{" "}
            {VERDICT_COPY.no_blocking_findings_identified.headline.toLowerCase()}
          </li>
          <li>Prepare-only. No writes to your repository.</li>
        </ul>
        <p className="mt-8 text-xs text-accent-fg/60">{RESCUE_PAYMENT.customerCopy}</p>
        <ButtonLink href={`${RESCUE_PATH}/intake`} size="lg" className="mt-8 w-full bg-gold text-ink hover:bg-[#c49a55] sm:w-auto">
          Request the {formatUsd(RESCUE_REVIEW_PRICE_USD)} review
        </ButtonLink>
      </article>
      <article className="flex flex-col justify-between rounded-xl border border-line bg-surface px-6 py-8 sm:px-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted">Optional sprint</p>
          <p className="mt-3 font-semibold text-4xl tracking-tight tabular-nums">
            {formatUsd(RESCUE_REMEDIATION_PRICE_USD)}
          </p>
          <p className="mt-2 text-sm text-ink-soft">One-time. Only after the report. Only for eligible findings.</p>
          <ul className="mt-8 space-y-3 text-sm text-ink-soft">
            <li>Work happens on a named branch, not main</li>
            <li>You review and merge every pull request</li>
            <li>No deployment, no production release</li>
            <li>Does not create features outside the report</li>
          </ul>
        </div>
        <p className="mt-8 text-xs text-muted">{RESCUE_PAYMENT.remediationCopy}</p>
      </article>
    </div>
  );
}
