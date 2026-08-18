import { notFound } from "next/navigation";
import {
  addCommentAction,
  addInternalNoteAction,
  askClarificationAction,
  deliverRequestAction,
  opsAssignAction,
  opsQaAction,
  opsRequestApprovalAction,
  opsScopeAction,
  opsSplitStepAction,
  opsTimeAction,
  opsTransitionAction,
  updateStepAction,
} from "@/app/actions/requests";
import { ActionClassBadge, PageHeader, PriorityBadge, RiskBadge, StatusBadge } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { APPROVAL_KINDS, APPROVAL_KIND_COPY, AuthzError, DomainError, REQUEST_STATUSES } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Ops request" };

export default async function OpsRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOps();
  const { id } = await params;
  const store = getWorkspace(actor);
  let bundle;
  try {
    bundle = await store.getRequestBundle(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const operators = await store.listOperators(actor);
  const {
    request,
    steps,
    plan,
    comments,
    organization,
    attachments,
    approvals,
    clarifications,
    internalNotes,
    playbook,
    playbookVersion,
    timeEntries,
    qa,
    delivery,
    memory,
    audits,
  } = bundle;
  const canManage = actor.role !== "operator";
  const assignedToSelf = actor.operatorId && request.assignedOperatorId === actor.operatorId;
  const canWork = canManage || assignedToSelf;
  const orgName = organization?.name ?? "Organization";
  const noteNames = Object.fromEntries(
    await Promise.all(internalNotes.map(async (n: { id: string; authorId: string }) => [n.id, await store.userName(n.authorId)] as const)),
  );
  const preferenceLines = ((playbookVersion?.clientPreferences ?? []) as string[]).length
    ? ((playbookVersion?.clientPreferences ?? []) as string[])
    : ["No playbook preferences"];

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={`${orgName} · ${bundle.workstream?.name ?? "Unscoped"}`}
        title={request.title}
        description={request.objective}
      />
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={request.status} />
        <PriorityBadge priority={request.priority} />
        <RiskBadge risk={request.riskLevel} />
        <ActionClassBadge value={request.approvalLevel} />
        {canWork && request.status === "assigned" ? (
          <form action={opsTransitionAction}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="status" value="in_progress" />
            <Button type="submit" size="sm">
              Start work
            </Button>
          </form>
        ) : null}
        {canWork && request.status === "in_progress" ? (
          <>
            <form action={opsTransitionAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="status" value="blocked" />
              <Button type="submit" size="sm" variant="secondary">
                Mark blocked
              </Button>
            </form>
            <form action={opsTransitionAction}>
              <input type="hidden" name="requestId" value={request.id} />
              <input type="hidden" name="status" value="qa" />
              <Button type="submit" size="sm">
                Submit for QA
              </Button>
            </form>
          </>
        ) : null}
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Customer · outcome · description</p>
          <p className="mt-2 font-medium">{orgName}</p>
          <p className="mt-2">{request.objective}</p>
          <p className="mt-2 text-ink-soft">{request.description}</p>
          <p className="mt-3 text-xs text-muted">Workstream · {bundle.workstream?.name ?? "Unscoped"}</p>
          <p className="mt-3 text-xs text-muted">Deliverable</p>
          <p>{request.deliverable}</p>
          <p className="mt-3 text-xs text-muted">
            Deadline {request.dueAt ?? "—"} · Recurring {request.recurring ? "yes" : "no"} · Operator{" "}
            {bundle.operator?.name ?? "Unassigned"}
          </p>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-surface p-5 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">Customer-visible instructions</p>
            <p className="mt-2">{request.customerInstructions || "None recorded."}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-5 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">Internal instructions</p>
            <p className="mt-2">{request.internalInstructions || "None recorded."}</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Attachments</p>
          <ul className="mt-2 space-y-1">
            {attachments.length ? attachments.map((a) => <li key={a.id}>{a.name}</li>) : <li className="text-muted">None</li>}
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Customer preferences</p>
          <ul className="mt-2 list-disc pl-5">
            {preferenceLines.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Playbook</p>
          <p className="mt-2 font-medium">{playbook?.title ?? "None referenced"}</p>
          {playbookVersion ? (
            <p className="mt-1 text-muted">
              v{playbookVersion.version} · {playbookVersion.trigger || "On request"}
            </p>
          ) : null}
        </section>
      </div>

      {memory ? (
        <section className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Customer operating memory</p>
          <p className="mt-1 text-xs text-muted">Organization preferences — not this request’s comments.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            <li>
              <span className="text-muted">Tone.</span> {memory.communicationTone || "—"}
            </li>
            <li>
              <span className="text-muted">Meetings.</span> {memory.preferredMeetingWindows || "—"}
            </li>
            <li>
              <span className="text-muted">CRM rules.</span> {memory.crmRules || "—"}
            </li>
            <li>
              <span className="text-muted">Escalation.</span> {memory.escalationContacts || "—"}
            </li>
            <li>
              <span className="text-muted">Vendors.</span> {memory.preferredVendors || "—"}
            </li>
            <li>
              <span className="text-muted">Prohibited.</span> {memory.prohibitedActions || "—"}
            </li>
            <li>
              <span className="text-muted">Approval thresholds.</span> {memory.approvalThresholds || "—"}
            </li>
            <li>
              <span className="text-muted">Formatting.</span> {memory.formattingPreferences || "—"}
            </li>
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-5 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted">Approval boundaries</p>
        <p className="mt-2">
          Action class {request.approvalLevel.replaceAll("_", " ")}. Sensitive and external steps cannot proceed without an approved record.
        </p>
        <ul className="mt-3 space-y-1">
          {approvals.map((a) => (
            <li key={a.id}>
              {APPROVAL_KIND_COPY[a.kind].label}: {a.status}
              {a.decisionNote ? ` — ${a.decisionNote}` : ""}
            </li>
          ))}
          {approvals.length === 0 ? <li className="text-muted">No approval objects yet.</li> : null}
        </ul>
      </section>

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={opsTransitionAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Change status</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <select name="status" defaultValue={request.status} className="h-10 w-full rounded-md border border-line px-3 text-sm">
              {REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
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
          <h2 className="text-sm font-semibold sm:col-span-2">Scope the work</h2>
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
            <Textarea name="description" defaultValue={request.description} />
          </Field>
          <Button type="submit">Save scope</Button>
        </form>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Task checklist</h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {steps.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-muted">{s.detail}</p>
              </div>
              {canWork ? (
                <form action={updateStepAction} className="flex items-center gap-2">
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="stepId" value={s.id} />
                  <select name="status" defaultValue={s.status} className="h-8 rounded border border-line px-2 text-xs">
                    <option value="pending">pending</option>
                    <option value="in_progress">in progress</option>
                    <option value="blocked">blocked</option>
                    <option value="done">done</option>
                  </select>
                  <Button type="submit" size="sm" variant="secondary">
                    Set
                  </Button>
                </form>
              ) : (
                <span className="text-muted">{s.status.replaceAll("_", " ")}</span>
              )}
            </li>
          ))}
        </ul>
        {canManage ? (
          <form action={opsSplitStepAction} className="mt-3 flex gap-2">
            <input type="hidden" name="requestId" value={request.id} />
            <Input name="title" placeholder="Split a new step" />
            <Input name="detail" placeholder="Detail" />
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

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={askClarificationAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Request customer information</h2>
          <input type="hidden" name="requestId" value={request.id} />
          <Textarea name="question" required placeholder="What is missing?" />
          <Button type="submit">Ask the customer</Button>
        </form>
        <form action={addInternalNoteAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Internal notes</h2>
          <input type="hidden" name="requestId" value={request.id} />
          <Textarea name="body" required placeholder="Visible to ops only" />
          <Button type="submit" variant="secondary">
            Add note
          </Button>
        </form>
      </div>

      {clarifications.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Clarifications</h2>
          <ul className="space-y-2 text-sm">
            {clarifications.map((c) => (
              <li key={c.id} className="rounded-lg border border-line bg-surface px-4 py-3">
                <p className="font-medium">{c.question}</p>
                <p className="text-muted">{c.answer ?? "Awaiting customer"}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {internalNotes.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Internal notes log</h2>
          <ul className="space-y-2 text-sm">
            {internalNotes.map((n) => (
              <li key={n.id} className="rounded-lg border border-line bg-surface px-4 py-2">
                {n.body}
                <span className="ml-2 text-xs text-muted">{noteNames[n.id]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <form action={opsRequestApprovalAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Request approval</h2>
            <input type="hidden" name="requestId" value={request.id} />
            <select name="kind" className="h-10 w-full rounded-md border border-line px-3 text-sm">
              {APPROVAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {APPROVAL_KIND_COPY[k].label}
                </option>
              ))}
            </select>
            <Textarea name="reason" defaultValue="Customer approval required before continuing." />
            <Button type="submit">Ask the customer</Button>
          </form>
          {request.status === "qa" ? (
            <form action={opsQaAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold">QA</h2>
              <input type="hidden" name="requestId" value={request.id} />
              <Input name="score" type="number" defaultValue={90} />
              <Textarea
                name="checklist"
                defaultValue={request.qaChecklist.map((item) => `ok: ${item}`).join("\n")}
              />
              <Textarea name="defects" placeholder="Defects, one per line" />
              <Textarea name="notes" placeholder="QA notes" />
              <div className="flex gap-2">
                <Button name="passed" value="true" type="submit">
                  Approve
                </Button>
                <Button name="passed" value="false" type="submit" variant="secondary">
                  Request revision
                </Button>
              </div>
            </form>
          ) : (
            <form action={opsTimeAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold">Time</h2>
              <input type="hidden" name="requestId" value={request.id} />
              <Input name="hours" type="number" step="0.25" defaultValue="1" />
              <Input name="note" placeholder="What was done" />
              <Button type="submit" variant="secondary">
                Log hours
              </Button>
            </form>
          )}
          {(request.status === "ready_to_deliver" || request.status === "qa") && !delivery ? (
            <form action={deliverRequestAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold">Deliver</h2>
              <input type="hidden" name="requestId" value={request.id} />
              <Textarea name="summary" required placeholder="Outcome summary" />
              <Textarea name="deliverables" defaultValue={request.deliverable} />
              <Textarea name="attachments" defaultValue={attachments.map((a) => a.name).join("\n")} />
              <Textarea name="actionsTaken" placeholder="Actions taken, one per line" />
              <Textarea name="exceptions" placeholder="Exceptions" />
              <Textarea name="unresolvedDecisions" placeholder="Unresolved decisions" />
              <Input name="nextStep" placeholder="Recommended next step" />
              <Button type="submit">Deliver package</Button>
            </form>
          ) : (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm">
              <h2 className="text-sm font-semibold">Hours logged</h2>
              <ul className="mt-2 space-y-1 text-muted">
                {timeEntries.map((t) => (
                  <li key={t.id}>
                    {t.hours}h · {t.note}
                  </li>
                ))}
                {qa.map((q) => (
                  <li key={q.id}>
                    QA {q.passed ? "passed" : "revision"} · {q.score}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {delivery ? (
        <section className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted">Delivered package</p>
          <p className="mt-2">{delivery.summary}</p>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Audit trail</h2>
        <ul className="space-y-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          {audits.length === 0 ? (
            <li className="text-muted">No audit events on this request yet.</li>
          ) : (
            audits.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span>{e.action.replaceAll(".", " · ").replaceAll("_", " ")}</span>
                <span className="text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Comments</h2>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm">
              <p>{c.body}</p>
              <p className="text-xs text-muted">{c.visibility}</p>
            </li>
          ))}
        </ul>
        <form action={addCommentAction} className="mt-3 space-y-2">
          <input type="hidden" name="requestId" value={request.id} />
          <select name="visibility" className="h-10 rounded-md border border-line px-3 text-sm">
            <option value="customer">Customer-visible</option>
            <option value="internal">Internal</option>
          </select>
          <Textarea name="body" required />
          <Button type="submit" variant="secondary">
            Comment
          </Button>
        </form>
      </section>
    </div>
  );
}
