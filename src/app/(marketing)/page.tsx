import Link from "next/link";
import { Button } from "@/components/ui";
import { ACTION_CLASS_COPY, WORKSTREAM_TEMPLATES } from "@/lib/domain";

export const metadata = { title: "Stop managing tasks. Start delegating outcomes." };

const stages = [
  { label: "You", detail: "State the outcome, deadline, and authority." },
  { label: "Delegation Cloud", detail: "Triage, route, and hold the operating system." },
  { label: "AI | Automation | Operator | Specialist", detail: "The right executor for each step — never all of them by default." },
  { label: "Completed outcome", detail: "Checked against the request, then delivered." },
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Managed operations</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
          Stop managing tasks.
          <br />
          Start delegating outcomes.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">
          A managed operations team powered by humans, AI and automation. Tell us what needs to happen. We handle how
          it gets done.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/delegation-audit">
            <Button size="lg">Run My Delegation Audit</Button>
          </Link>
          <Link href="/how-it-works">
            <Button size="lg" variant="secondary">
              See How It Works
            </Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-line bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">The path</p>
          <div className="mt-6 hidden items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted md:flex">
            <span>You</span>
            <span>↓</span>
            <span>Delegation Cloud</span>
            <span>↓</span>
            <span>AI | Automation | Operator | Specialist</span>
            <span>↓</span>
            <span>Completed outcome</span>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {stages.map((stage, i) => (
              <div key={stage.label} className="relative rounded-xl border border-line bg-surface p-5">
                <p className="font-mono text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</p>
                <h2 className="mt-3 text-sm font-semibold uppercase tracking-[0.08em]">{stage.label}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{stage.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-20 md:grid-cols-3">
        {[
          {
            title: "Outcomes, not a bench of people",
            body: "You do not browse profiles or manage hours. You delegate a result. Operators stay inside our delivery system.",
          },
          {
            title: "Authority is explicit",
            body: "Prepare-only, low-risk, external, or sensitive. Sensitive work never proceeds without your approval.",
          },
          {
            title: "Work that learns",
            body: "Approved paths become playbooks. Automation is earned after a workflow is understood — not assumed on day one.",
          },
        ].map((card) => (
          <div key={card.title} className="rounded-xl border border-line bg-surface p-6">
            <h2 className="text-lg font-semibold tracking-tight">{card.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{card.body}</p>
          </div>
        ))}
      </section>

      <section className="border-t border-line bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Workstreams</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight">Capacity organized around results</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKSTREAM_TEMPLATES.map((tpl) => (
              <article key={tpl.id} className="rounded-xl border border-line bg-surface p-4">
                <h3 className="font-medium">{tpl.name}</h3>
                <p className="mt-2 text-sm text-muted">{tpl.objective}</p>
              </article>
            ))}
          </div>
          <p className="mt-6">
            <Link href="/solutions" className="text-sm font-medium underline">
              See SLA and recurring work for each workstream
            </Link>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Action classes</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">What we are allowed to do is written down</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {Object.values(ACTION_CLASS_COPY).map((copy) => (
            <article key={copy.label} className="rounded-xl border border-line bg-surface p-5">
              <h3 className="font-medium">{copy.label}</h3>
              <p className="mt-2 text-sm text-muted">{copy.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-semibold tracking-tight">What this is not</h2>
          <ul className="mt-6 max-w-2xl space-y-2 text-sm leading-relaxed text-ink-soft">
            <li>Not a freelancer marketplace or hourly assistant directory.</li>
            <li>Not a chatbot that sends mail, pays vendors, or publishes on its own.</li>
            <li>Not healthcare, legal practice, or custody of customer funds.</li>
            <li>Not a claim about hours you will save. Run the audit for an estimate labeled as an estimate.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
