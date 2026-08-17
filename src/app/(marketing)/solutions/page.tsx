import { WORKSTREAM_TEMPLATES } from "@/lib/domain";

export const metadata = { title: "Solutions" };

export default function SolutionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Solutions</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">Workstreams built around results, not job titles.</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        Each workstream has an objective, an SLA, recurring work, and a health score. You do not staff it. You sponsor it.
      </p>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {WORKSTREAM_TEMPLATES.map((tpl) => (
          <article key={tpl.id} className="rounded-xl border border-line bg-surface p-6">
            <h2 className="text-lg font-semibold tracking-tight">{tpl.name}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{tpl.objective}</p>
            <p className="mt-4 text-xs uppercase tracking-[0.14em] text-muted">SLA</p>
            <p className="mt-1 text-sm">{tpl.sla}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
