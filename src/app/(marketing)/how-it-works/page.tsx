import Link from "next/link";
import { Button } from "@/components/ui";

export const metadata = { title: "How it works" };

const stages = [
  { id: "01", name: "Request", body: "“Make sure every lead from the conference gets followed up.”" },
  { id: "02", name: "Plan", body: "We turn that into a path: audit the list, find missing next steps, draft follow-ups." },
  { id: "03", name: "Authority", body: "Nothing is sent until you say the language is right." },
  { id: "04", name: "Execution", body: "Research, drafts, and CRM updates happen without you assigning each step." },
  { id: "05", name: "QA", body: "A person accountable reviews the pack against the outcome you asked for." },
  { id: "06", name: "Delivery", body: "You receive the hygiene summary and the three records that still need your judgment." },
  { id: "07", name: "Playbook", body: "The path is written down so the next conference does not start from zero." },
  { id: "08", name: "Repeat", body: "The same work comes back as a rhythm, not a fire drill." },
];

export default function HowItWorksPage() {
  return (
    <div>
      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">One request, all the way through</p>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
          Make sure every lead from the conference gets followed up.
        </h1>
        <p className="mt-5 max-w-xl text-lg text-ink-soft">
          You state the outcome. We own the path. This is a walk-through of a sample request — not a live action in
          anyone’s CRM.
        </p>
      </section>
      <ol>
        {stages.map((stage, i) => (
          <li
            key={stage.id}
            className={i % 2 === 0 ? "bg-accent text-accent-fg" : "bg-bg-elevated"}
          >
            <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 md:grid-cols-[140px_1fr]">
              <p className={`font-mono text-sm ${i % 2 === 0 ? "text-[#c5a46e]" : "text-muted"}`}>{stage.id}</p>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{stage.name}</h2>
                <p className={`mt-3 max-w-2xl text-lg ${i % 2 === 0 ? "text-accent-fg/80" : "text-ink-soft"}`}>
                  {stage.body}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="mx-auto max-w-6xl px-5 py-16">
        <Link href="/delegation-audit">
          <Button size="lg">Get My Delegation Plan</Button>
        </Link>
      </div>
    </div>
  );
}
