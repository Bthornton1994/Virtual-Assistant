import { notFound } from "next/navigation";
import { acceptRequestAction, addCommentAction, cancelRequestAction } from "@/app/actions/requests";
import { ActionClassBadge, PageHeader, RiskBadge, StatusBadge, formatDate } from "@/components/product";
import { Button, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Request" };

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  const store = getStore();
  let bundle;
  try {
    bundle = store.getRequestBundle(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const { request, steps, plan, comments, approvals, attachments } = bundle;

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={bundle.workstream?.name ?? "Request"}
        title={request.title}
        description={request.objective}
        actions={
          <div className="flex gap-2">
            {request.status === "delivered" ? (
              <form action={acceptRequestAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <Button type="submit">Accept delivery</Button>
              </form>
            ) : null}
            {request.status !== "accepted" && request.status !== "cancelled" ? (
              <form action={cancelRequestAction}>
                <input type="hidden" name="requestId" value={request.id} />
                <Button type="submit" variant="secondary">
                  Cancel
                </Button>
              </form>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={request.status} />
        <RiskBadge risk={request.riskLevel} />
        <ActionClassBadge value={request.approvalLevel} />
        <span className="text-sm text-muted">Due {formatDate(request.dueAt)}</span>
      </div>

      {plan ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Execution plan</p>
          <p className="mt-2 text-sm text-ink-soft">{plan.summary}</p>
          <p className="mt-2 text-xs text-muted">
            Shown before work begins. AI does not independently perform high-risk external actions.
          </p>
          <ol className="mt-5 space-y-3">
            {plan.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="text-muted">{step.detail}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">{step.owner}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Steps</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {steps.map((s) => (
            <li key={s.id} className="flex justify-between px-4 py-3 text-sm">
              <span>{s.title}</span>
              <span className="text-muted">{s.status.replaceAll("_", " ")}</span>
            </li>
          ))}
        </ul>
      </section>

      {approvals.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Approvals</h2>
          <ul className="space-y-2">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                <p className="font-medium">{a.actionClass.replaceAll("_", " ")} · {a.status}</p>
                <p className="text-muted">{a.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {attachments.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Files</h2>
          <ul className="text-sm text-ink-soft">
            {attachments.map((a) => (
              <li key={a.id}>{a.name}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Discussion</h2>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <p>{c.body}</p>
              <p className="mt-1 text-xs text-muted">{store.userName(c.authorId)}</p>
            </li>
          ))}
        </ul>
        <form action={addCommentAction} className="mt-4 space-y-3">
          <input type="hidden" name="requestId" value={request.id} />
          <Textarea name="body" required placeholder="Add context" />
          <Button type="submit" variant="secondary">
            Comment
          </Button>
        </form>
      </section>
    </div>
  );
}
