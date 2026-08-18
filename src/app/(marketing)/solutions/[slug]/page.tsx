import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui";
import { SOLUTIONS, solutionBySlug, type SolutionSlug } from "@/lib/solutions";

export function generateStaticParams() {
  return SOLUTIONS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = solutionBySlug(slug);
  return { title: item?.name ?? "Solution" };
}

export default async function SolutionDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = solutionBySlug(slug);
  if (!item) notFound();

  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">{item.catalogLabel}</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">{item.outcome}</h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-soft">{item.problem}</p>

      <section className="mt-16 grid gap-12 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">What we own</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {item.owns.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">What you approve</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {item.customerApproves.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">People ask us for things like</h2>
        <ul className="mt-4 space-y-3 text-xl font-medium tracking-tight">
          {item.exampleRequests.map((row) => (
            <li key={row}>“{row}”</li>
          ))}
        </ul>
      </section>

      <section className="mt-16 bg-accent px-6 py-8 text-accent-fg sm:px-10">
        <h2 className="text-[11px] uppercase tracking-[0.16em] text-[#c5a46e]">How a week actually runs</h2>
        <ol className="mt-6 space-y-3">
          {item.workflow.map((row, i) => (
            <li key={row} className="flex gap-4 font-mono text-sm">
              <span className="text-[#c5a46e]">{String(i + 1).padStart(2, "0")}</span>
              {row}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16 grid gap-8 sm:grid-cols-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">You receive</h2>
          <p className="mt-3 text-sm">{item.deliverables.join(", ")}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Systems</h2>
          <p className="mt-3 text-sm">{item.integrations.join(", ")}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">We watch</h2>
          <p className="mt-3 text-sm">{item.metrics.join(", ")}</p>
        </div>
      </section>

      <div className="mt-16 flex flex-wrap gap-3">
        <Link href="/book">
          <Button size="lg">Start Delegating</Button>
        </Link>
        <Link href="/pricing">
          <Button size="lg" variant="secondary">
            Apply for Founding Membership
          </Button>
        </Link>
      </div>

      <p className="mt-10 text-sm text-muted">
        Other categories:{" "}
        {SOLUTIONS.filter((s) => s.slug !== (slug as SolutionSlug)).map((s, i) => (
          <span key={s.slug}>
            {i > 0 ? " · " : ""}
            <Link href={`/solutions/${s.slug}`} className="underline">
              {s.catalogLabel}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}
