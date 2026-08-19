import { notFound } from "next/navigation";
import {
  acceptRequestAction,
  addCommentAction,
  answerClarificationAction,
  cancelRequestAction,
  decideApprovalAction,
  generatePlaybookFromRequestAction,
  modifyPlanAction,
  openAttachmentAction,
} from "@/app/actions/requests";
import { ActionClassBadge, PageHeader, RiskBadge, StatusBadge, formatDate } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { APPROVAL_KIND_COPY, AuthzError, DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Request" };

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  const store = getWorkspace(actor);
  let bundle;
  try {
    bundle = await store.getRequestBundle(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const { request, steps, plan, comments, approvals, attachments, clarifications, delivery, playbook } = bundle;
  const planApproval = approvals.find((a) => a.kind === "execution_plan" && a.status === "pending");
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const openClarifications = clarifications.filter((c) => !c.answer);
  const commentNames = Object.fromEntries(
    await Promise.all(comments.map(async (c) => [c.id, await store.userName(c.authorId)] as const)),
  );

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
        {request.recurring ? <span className="text-sm text-muted">Recurring</span> : null}
        {playbook ? <span className="text-sm text-muted">Playbook · {playbook.title}</span> : null}
      </div>

      {openClarifications.length ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Questions we need answered</p>
          <p className="mt-2 text-sm text-muted">Work is paused until missing context is supplied.</p>
          <ul className="mt-4 space-y-4">
            {openClarifications.map((c) => (
              <li key={c.id}>
                <p className="text-sm font-medium">{c.question}</p>
                <form action={answerClarificationAction} className="mt-2 space-y-2">
                  <input type="hidden" name="clarificationId" value={c.id} />
                  <input type="hidden" name="requestId" value={request.id} />
                  <Textarea name="answer" required placeholder="Answer" />
                  <Button type="submit">Send answer</Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {clarifications.some((c) => c.answer) ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Answered questions</h2>
          <ul className="space-y-2">
            {clarifications
              .filter((c) => c.answer)
              .map((c) => (
                <li key={c.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                  <p className="font-medium">{c.question}</p>
                  <p className="mt-1 text-ink-soft">{c.answer}</p>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {plan ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Execution plan</p>
          <p className="mt-2 text-sm text-ink-soft">{plan.summary}</p>
          <p className="mt-2 text-xs text-muted">
            Risk {plan.riskLevel}. Authority {plan.actionClass.replaceAll("_", " ")}.
            {plan.approvalsRequired ? " Explicit approval is required before external or sensitive steps." : ""}
          </p>
          <ol className="mt-5 space-y-3">
            {steps.map((step, i) => (
              <li key={step.id} className="flex gap-3 text-sm">
                <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="text-muted">{step.detail}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-muted">
                    {step.owner} · {step.status.replaceAll("_", " ")}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {request.status === "awaiting_plan_approval" && planApproval ? (
            <div className="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
              <form action={decideApprovalAction} className="space-y-3">
                <h3 className="text-sm font-semibold">Approve or reject this plan</h3>
                <input type="hidden" name="approvalId" value={planApproval.id} />
                <Textarea name="note" placeholder="Decision note" />
                <div className="flex gap-2">
                  <Button name="decision" value="approved" type="submit">
                    Approve plan
                  </Button>
                  <Button name="decision" value="rejected" type="submit" variant="secondary">
                    Reject
                  </Button>
                </div>
              </form>
              <form action={modifyPlanAction} className="space-y-3">
                <h3 className="text-sm font-semibold">Modify the steps</h3>
                <input type="hidden" name="requestId" value={request.id} />
                <Textarea name="steps" defaultValue={steps.map((s) => s.title).join("\n")} />
                <Button type="submit" variant="secondary">
                  Save modified plan
                </Button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {pendingApprovals.filter((a) => a.kind !== "execution_plan").length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Action approvals</h2>
          <ul className="space-y-3">
            {pendingApprovals
              .filter((a) => a.kind !== "execution_plan")
              .map((a) => (
                <li key={a.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                  <p className="font-medium">
                    {APPROVAL_KIND_COPY[a.kind].label} · {a.riskLevel} risk
                  </p>
                  <p className="text-muted">{a.description || a.action}</p>
                  <form action={decideApprovalAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="approvalId" value={a.id} />
                    <Input name="note" placeholder="Decision note" />
                    <Button name="decision" value="approved" type="submit">
                      Approve
                    </Button>
                    <Button name="decision" value="rejected" type="submit" variant="secondary">
                      Reject
                    </Button>
                  </form>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {delivery ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Delivery</p>
          <p className="mt-2 text-sm">{delivery.summary}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 text-sm">
            <div>
              <p className="font-medium">Deliverables</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {delivery.deliverables.map((d: string) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Actions taken</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {delivery.actionsTaken.map((d: string) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Exceptions</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {(delivery.exceptions.length ? delivery.exceptions : ["None recorded"]).map((d: string) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-medium">Unresolved decisions</p>
              <ul className="mt-1 list-disc pl-5 text-ink-soft">
                {(delivery.unresolvedDecisions.length ? delivery.unresolvedDecisions : ["None"]).map((d: string) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-4 text-sm">
            <span className="font-medium">Recommended next step:</span> {delivery.nextStep || "—"}
          </p>
          {delivery.attachments.length ? (
            <p className="mt-2 text-xs text-muted">Attachments: {delivery.attachments.join(", ")}</p>
          ) : null}
        </section>
      ) : null}

      {request.status === "accepted" || request.status === "delivered" ? (
        <form action={generatePlaybookFromRequestAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Capture as a playbook</h2>
          <p className="text-sm text-muted">After successful recurring or repeatable work, keep the path for the next occurrence.</p>
          <input type="hidden" name="requestId" value={request.id} />
          <Field label="Playbook name">
            <Input name="name" defaultValue={`${request.title} playbook`} />
          </Field>
          <Button type="submit">Create customer playbook</Button>
        </form>
      ) : null}

      {attachments.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Files</h2>
          <ul className="text-sm text-ink-soft">
            {attachments.map((a) => (
              <li key={a.id}>
                <form action={openAttachmentAction}>
                  <input type="hidden" name="path" value={a.path} />
                  <button type="submit" className="underline">
                    {a.name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {approvals.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Approval record</h2>
          <ul className="space-y-2">
            {approvals.map((a) => (
              <li key={a.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
                <p className="font-medium">
                  {APPROVAL_KIND_COPY[a.kind].label} · {a.status} · {a.riskLevel} risk
                </p>
                <p className="text-muted">{a.description || a.action}</p>
                <p className="mt-1 text-xs text-muted">
                  Requested {formatDate(a.createdAt)}
                  {a.decidedAt ? ` · decided ${formatDate(a.decidedAt)}` : ""}
                  {a.decisionNote ? ` · ${a.decisionNote}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Discussion</h2>
        {comments.length === 0 ? (
          <p className="mb-3 text-sm text-muted">
            No discussion yet. Add source context, authority limits, or a correction.
          </p>
        ) : null}
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm">
              <p>{c.body}</p>
              <p className="mt-1 text-xs text-muted">{commentNames[c.id]}</p>
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
