import { notFound } from "next/navigation";
import {
  addCommentAction,
  opsAssignAction,
  opsQaAction,
  opsRequestApprovalAction,
  opsScopeAction,
  opsSplitStepAction,
  opsTimeAction,
  opsTransitionAction,
} from "@/app/actions/requests";
import { ActionClassBadge, PageHeader, RiskBadge, StatusBadge } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError, REQUEST_STATUSES } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Ops request" };

export default async function OpsRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOps();
  const { id } = await params;
  const store = getStore();
  let bundle;
  try {
    bundle = store.getRequestBundle(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const operators = store.listOperators(actor);
  const { request, steps, plan, comments, organization } = bundle;
  const canManage = actor.role !== "operator";

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={`${organization.name} · ${bundle.workstream?.name ?? "Unscoped"}`}
        title={request.title}
        description={request.objective}
      />
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={request.status} />
        <RiskBadge risk={request.riskLevel} />
        <ActionClassBadge value={request.approvalLevel} />
      </div>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={opsTransitionAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Status</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <select name="status" defaultValue={request.status} className="h-10 w-full rounded-md border border-line px-3 text-sm">
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Input name="note" placeholder="Note" />
            <Button type="submit">Update status</Button>
          </form>
          <form action={opsAssignAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Assign operator</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <select name="operatorId" defaultValue={request.assignedOperatorId ?? ""} className="h-10 w-full rounded-md border border-line px-3 text-sm">
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.platformRole.replaceAll("_", " ")}
                </option>
              ))}
            </select>
            <Button type="submit">Assign</Button>
          </form>
        </div>
      ) : null}

      {canManage ? (
        <form action={opsScopeAction} className="grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Update scope</h2>
          <input type="hidden" name="requestId" value={request.id} />
          <Field label="Title">
            <Input name="title" defaultValue={request.title} />
          </Field>
          <Field label="Due">
            <Input name="dueAt" defaultValue={request.dueAt ?? ""} />
          </Field>
          <Field label="Objective">
            <Textarea name="objective" defaultValue={request.objective} />
          </Field>
          <Field label="Deliverable">
            <Textarea name="deliverable" defaultValue={request.deliverable} />
          </Field>
          <Field label="Description">
            <Textarea name="description" defaultValue={request.description} className="sm:col-span-2" />
          </Field>
          <Button type="submit">Save scope</Button>
        </form>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Steps</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {steps.map((s) => (
            <li key={s.id} className="px-4 py-3 text-sm">
              <p className="font-medium">{s.title}</p>
              <p className="text-muted">{s.detail}</p>
            </li>
          ))}
        </ul>
        {canManage ? (
          <form action={opsSplitStepAction} className="mt-3 flex gap-2">
            <input type="hidden" name="requestId" value={request.id} />
            <Input name="title" placeholder="Split a new step" />
            <Button type="submit" variant="secondary">
              Add step
            </Button>
          </form>
        ) : null}
      </section>

      {plan ? (
        <section className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Plan</p>
          <p className="mt-2">{plan.summary}</p>
        </section>
      ) : null}

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <form action={opsRequestApprovalAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Request approval</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <Textarea name="reason" defaultValue="Customer approval required before continuing." />
            <Button type="submit">Ask the customer</Button>
          </form>
          <form action={opsQaAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">QA</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <Input name="score" type="number" defaultValue={90} />
            <Textarea name="notes" placeholder="QA notes" />
            <div className="flex gap-2">
              <Button name="passed" value="true" type="submit">
                Pass → ready
              </Button>
              <Button name="passed" value="false" type="submit" variant="secondary">
                Return
              </Button>
            </div>
          </form>
          <form action={opsTimeAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Time</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <Input name="hours" type="number" step="0.25" defaultValue="1" />
            <Input name="note" placeholder="What was done" />
            <Button type="submit" variant="secondary">
              Log hours
            </Button>
          </form>
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Comments</h2>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm">
              {c.body}
            </li>
          ))}
        </ul>
        <form action={addCommentAction} className="mt-3 space-y-2">
          <input type="hidden" name="requestId" value={request.id} />
          <Textarea name="body" required />
          <Button type="submit" variant="secondary">
            Comment
          </Button>
        </form>
      </section>
    </div>
  );
}
