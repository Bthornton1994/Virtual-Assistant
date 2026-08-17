import Link from "next/link";
import { Button } from "@/components/ui";
import { SOLUTIONS } from "@/lib/solutions";

export const metadata = { title: "What we take on" };

export default function SolutionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Operations catalog</p>
      <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
        The work that keeps becoming your job.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-soft">
        Pick the part of the week you want back. We take ownership of the path — not a seat you have to manage.
      </p>
      <div className="mt-16 divide-y divide-line border-y border-line">
        {SOLUTIONS.map((s) => (
          <Link key={s.slug} href={`/solutions/${s.slug}`} className="block py-10 transition hover:bg-bg-elevated">
            <div className="grid gap-4 md:grid-cols-[200px_1fr_auto] md:items-end">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted">{s.catalogLabel}</p>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{s.outcome}</h2>
                <p className="mt-2 max-w-2xl text-sm text-ink-soft">{s.catalogHint}</p>
              </div>
              <span className="text-sm text-muted">Open →</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="mt-12">
        <Link href="/delegation-audit">
          <Button size="lg">Get My Delegation Plan</Button>
        </Link>
      </div>
    </div>
  );
}
