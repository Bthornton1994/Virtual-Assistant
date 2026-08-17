import Link from "next/link";
import { opsQaAction } from "@/app/actions/requests";
import { PageHeader, StatusBadge } from "@/components/product";
import { Button, Textarea, Input } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "QA" };

export default async function QaPage() {
  const actor = await requireOps();
  const store = getStore();
  const inQa = store.listRequests(actor, { status: "qa" });
  const reviews = store.data.qaReviews.slice(0, 8);
  return (
    <div className="space-y-8">
      <PageHeader title="Quality assurance" description="A completed task is not a completed outcome." />
      <div className="space-y-4">
        {inQa.map((r) => (
          <article key={r.id} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <Link href={`/ops/requests/${r.id}`} className="font-medium hover:underline">
                {r.title}
              </Link>
              <StatusBadge status={r.status} />
            </div>
            <form action={opsQaAction} className="mt-4 space-y-2">
              <input type="hidden" name="requestId" value={r.id} />
              <Input name="score" type="number" defaultValue={88} />
              <Textarea name="notes" placeholder="Checklist notes" />
              <div className="flex gap-2">
                <Button name="passed" value="true" type="submit">
                  Pass
                </Button>
                <Button name="passed" value="false" type="submit" variant="secondary">
                  Return to operator
                </Button>
              </div>
            </form>
          </article>
        ))}
        {inQa.length === 0 ? <p className="text-sm text-muted">Nothing in QA.</p> : null}
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Recent reviews</h2>
        <ul className="space-y-2 text-sm">
          {reviews.map((q) => (
            <li key={q.id} className="rounded-lg border border-line bg-surface px-4 py-2">
              {q.passed ? "Passed" : "Returned"} · {q.score} · {q.notes}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
