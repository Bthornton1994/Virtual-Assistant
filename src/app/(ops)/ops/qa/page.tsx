import Link from "next/link";
import { addCommentAction, opsQaAction } from "@/app/actions/requests";
import { EmptyState, PageHeader, StatusBadge } from "@/components/product";
import { Button, Textarea, Input } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "QA" };

export default async function QaPage() {
  const actor = await requireOps();
  const store = getWorkspace(actor);
  const inQa = store.listRequests(actor, { status: "qa" });
  const reviews = store.data.qaReviews.slice(0, 8);
  return (
    <div className="space-y-8">
      <PageHeader
        title="Quality assurance"
        description="Inspect the deliverable, execution notes, and checklist. A completed task is not a completed outcome."
      />
      <div className="space-y-4">
        {inQa.map((r) => {
          const bundle = store.getRequestBundle(actor, r.id);
          return (
            <article key={r.id} className="rounded-xl border border-line bg-surface p-5">
              <div className="flex items-center justify-between gap-3">
                <Link href={`/ops/requests/${r.id}`} className="font-medium hover:underline">
                  {r.title}
                </Link>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-2 text-sm text-muted">{r.objective}</p>
              <div className="mt-4 grid gap-4 lg:grid-cols-2 text-sm">
                <div>
                  <p className="font-medium">Deliverables</p>
                  <p className="text-ink-soft">{r.deliverable}</p>
                  <ul className="mt-1 list-disc pl-5 text-ink-soft">
                    {bundle.attachments.map((a) => (
                      <li key={a.id}>{a.name}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Execution notes</p>
                  <ul className="mt-1 list-disc pl-5 text-ink-soft">
                    {bundle.timeEntries.map((t) => (
                      <li key={t.id}>
                        {t.hours}h · {t.note}
                      </li>
                    ))}
                    {bundle.internalNotes.map((n) => (
                      <li key={n.id}>{n.body}</li>
                    ))}
                    {bundle.timeEntries.length === 0 && bundle.internalNotes.length === 0 ? <li>None logged</li> : null}
                  </ul>
                </div>
              </div>
              <form action={opsQaAction} className="mt-4 space-y-2">
                <input type="hidden" name="requestId" value={r.id} />
                <Input name="score" type="number" defaultValue={88} />
                <Textarea
                  name="checklist"
                  defaultValue={r.qaChecklist.map((item) => `ok: ${item}`).join("\n") || "ok: Matches stated objective\nok: Authority limits respected"}
                />
                <Textarea name="defects" placeholder="Defects, one per line" />
                <Textarea name="notes" placeholder="Internal QA comments" />
                <div className="flex gap-2">
                  <Button name="passed" value="true" type="submit">
                    Approve
                  </Button>
                  <Button name="passed" value="false" type="submit" variant="secondary">
                    Request revision
                  </Button>
                </div>
              </form>
              <form action={addCommentAction} className="mt-3 space-y-2">
                <input type="hidden" name="requestId" value={r.id} />
                <input type="hidden" name="visibility" value="internal" />
                <Textarea name="body" placeholder="Internal comment without a QA decision" />
                <Button type="submit" variant="ghost" size="sm">
                  Add internal comment
                </Button>
              </form>
            </article>
          );
        })}
        {inQa.length === 0 ? (
          <EmptyState
            title="Nothing waiting on quality review"
            body="Move a request to QA from the request console after the operator finishes. A completed task is not a completed outcome until this step passes."
          />
        ) : null}
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Recent reviews</h2>
        <ul className="space-y-2 text-sm">
          {reviews.map((q) => (
            <li key={q.id} className="rounded-lg border border-line bg-surface px-4 py-2">
              {q.passed ? "Approved" : "Revision required"} · {q.score} · {q.notes}
              {q.defects.length ? ` · defects: ${q.defects.join("; ")}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
