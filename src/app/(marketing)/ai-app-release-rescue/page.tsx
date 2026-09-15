import Link from "next/link";
import { NonClaimsCallout } from "@/components/ai-app-release-rescue/non-claims";
import { OfferPricing } from "@/components/ai-app-release-rescue/offer-pricing";
import { RubricChecklist } from "@/components/ai-app-release-rescue/rubric-checklist";
import { Button } from "@/components/ui";
import { RESCUE_PATH, RESCUE_REVIEW_PRICE_USD } from "@/lib/ai-app-release-rescue/constants";

export const metadata = {
  title: "AI App Release Rescue",
  description:
    "A $299 release-readiness review of one repository, one web app, and one critical workflow. Optional $1,250 remediation sprint. Not a penetration test.",
};

const stages = [
  {
    id: "01",
    name: "Request",
    body: "You name one repo, one web app, and one workflow. Payment checkout is prepared and is not collected on this page.",
  },
  {
    id: "02",
    name: "Scope",
    body: "You confirm the boundary. Anything outside that repo, app, or workflow is out of scope.",
  },
  {
    id: "03",
    name: "Read-only access",
    body: "You grant access separately. Do not paste tokens here. Reviewers never receive write access for the $299 review.",
  },
  {
    id: "04",
    name: "Review",
    body: "An assigned operator records an outcome and evidence for every rubric check. Authority is prepare-only.",
  },
  {
    id: "05",
    name: "Draft report",
    body: "Internal QA checks schema, secret redaction, and the limitations section. Then you see the draft.",
  },
  {
    id: "06",
    name: "Close",
    body: "You accept or ask for clarification. Access is revoked. The optional sprint is a separate, later decision.",
  },
];

export default function RescueLandingPage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 lg:pt-20">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted">AI App Release Rescue</p>
        <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">
          A ${RESCUE_REVIEW_PRICE_USD} read of whether this web app is ready to ship.
        </h1>
        <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-soft">
          One repository. One application. One critical workflow. You get a structured report with findings,
          findings, and evidence. This is not a penetration test, and it is not a compliance certificate.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href={`${RESCUE_PATH}/intake`} className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto">Request the ${RESCUE_REVIEW_PRICE_USD} review</Button>
          </Link>
          <Link href={`${RESCUE_PATH}/demo/report`} className="w-full sm:w-auto">
            <Button size="lg" variant="secondary" className="w-full sm:w-auto">
              See a sample report
            </Button>
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted">Checkout is prepared. Payment is not collected on this page.</p>
      </section>

      <section className="border-y border-line bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Price, in the open</h2>
          <p className="mt-4 max-w-xl text-ink-soft">
            Separate from founding membership. The review is a one-time engagement. The sprint is optional and only
            after the report.
          </p>
          <div className="mt-10">
            <OfferPricing />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">What you receive</h2>
        <ul className="mt-10 grid gap-5 md:grid-cols-2">
          {[
            {
              title: "A fixed rubric",
              body: "Thirty-two checks across twelve areas, covering security, release safety, AI-specific risk, accessibility, code quality, and documentation. Every check gets a recorded outcome and evidence, and a check we could not assess is reported as exactly that.",
            },
            {
              title: "Findings you can check",
              body: "Every finding points at a file, config, runtime observation, or dependency report. Counts are computed, not self-reported.",
            },
            {
              title: "A readiness call",
              body: "Ready, ready with caveats, or not ready — derived from critical and high findings, not from marketing language.",
            },
            {
              title: "A customer-safe artifact",
              body: "No secret values. No executor identifiers. Readable HTML and structured JSON for the retention period.",
            },
          ].map((item) => (
            <li key={item.title} className="rounded-xl border border-line bg-surface px-5 py-5">
              <h3 className="text-lg font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-6">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">How the engagement moves</h2>
          <p className="mt-4 max-w-xl text-ink-soft">
            Target is a draft within 48 hours of access granted. That is an operational target, not a contractual SLA.
          </p>
        </div>
        <ol>
          {stages.map((stage, index) => (
            <li key={stage.id} className={index % 2 === 0 ? "bg-accent text-accent-fg" : "bg-bg-elevated"}>
              <div className="mx-auto grid max-w-6xl gap-6 px-5 py-12 md:grid-cols-[120px_1fr]">
                <p className={`font-mono text-sm ${index % 2 === 0 ? "text-gold" : "text-muted"}`}>{stage.id}</p>
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight">{stage.name}</h3>
                  <p className={`mt-3 max-w-2xl text-lg ${index % 2 === 0 ? "text-accent-fg/80" : "text-ink-soft"}`}>
                    {stage.body}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Data you should not send</h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface px-5 py-5">
            <h3 className="font-semibold">We read</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>One repository, read-only</li>
              <li>CI, lockfiles, and config templates in that repo</li>
              <li>A public deployment URL, if you provide one, over ordinary HTTPS</li>
            </ul>
          </div>
          <div className="rounded-xl border border-line bg-surface px-5 py-5">
            <h3 className="font-semibold">We do not take</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-soft">
              <li>Access tokens, passwords, or API keys on this form</li>
              <li>Production databases or live secret values</li>
              <li>Other repositories, native apps, or cloud-account admin</li>
              <li>Your code for model training or marketing</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">Audit checklist</h2>
          <p className="mt-4 max-w-xl text-ink-soft">Every check gets an outcome. A check we could not assess is reported, not quietly dropped.</p>
          <div className="mt-10">
            <RubricChecklist />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">What this is not</h2>
        <p className="mt-4 max-w-2xl text-pretty text-ink-soft">
          These limits appear on every report. They are not fine print we hope you skip.
        </p>
        <div className="mt-8">
          <NonClaimsCallout />
        </div>
      </section>

      <section className="bg-ink text-accent-fg">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-3xl text-balance text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
            Try the intake and a sample report without billing.
          </h2>
          <p className="mt-4 max-w-xl text-accent-fg/75">
            The demo uses synthetic data. It does not create a customer record, charge a card, or store a repository
            token.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link href={`${RESCUE_PATH}/intake`} className="w-full sm:w-auto">
              <Button size="lg" className="w-full bg-gold text-ink hover:bg-[#c49a55] sm:w-auto">
                Open the intake
              </Button>
            </Link>
            <Link href={`${RESCUE_PATH}/demo`} className="w-full sm:w-auto">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Demo hub
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
