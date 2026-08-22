import { decideApprovalAction } from "@/app/actions/requests";
import { ActionClassBadge, EmptyState, PageHeader, RiskBadge } from "@/components/product";
import { Button, Input } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { APPROVAL_KIND_COPY } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  const approvals = await store.listApprovals(actor);
  const names = Object.fromEntries(
    await Promise.all(
      [...new Set(approvals.flatMap((a) => [a.requestedBy, a.decidedBy].filter(Boolean) as string[]))].map(async (id) => [
        id,
        await store.userName(id),
      ]),
    ),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Explicit approval objects. Sensitive execution never proceeds without a record here."
      />
      {approvals.length === 0 ? (
        <EmptyState
          title="Nothing needs your signature"
          body="Execution plans, external email, CRM changes, vendor communication, and sensitive actions pause here."
        />
      ) : (
        <div className="space-y-4">
          {approvals.map((a) => (
            <article key={a.id} className="rounded-xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{a.request?.title ?? a.requestId}</h2>
                <span className="rounded-full border border-line px-2 py-0.5 text-xs">
                  {APPROVAL_KIND_COPY[a.kind].label}
                </span>
                <ActionClassBadge value={a.actionClass} />
                <RiskBadge risk={a.riskLevel} />
                <span className="text-xs uppercase text-muted">{a.status}</span>
              </div>
              <p className="mt-2 text-sm">{a.action}</p>
              <p className="mt-1 text-sm text-muted">{a.description || a.reason}</p>
              <p className="mt-2 text-xs text-muted">
                Requested by {names[a.requestedBy] ?? "Unknown"} at {new Date(a.createdAt).toLocaleString()}
                {a.decidedBy
                  ? ` · ${a.status} by ${names[a.decidedBy] ?? "Unknown"} at ${a.decidedAt ? new Date(a.decidedAt).toLocaleString() : "—"}`
                  : ""}
              </p>
              {a.status === "pending" ? (
                <form action={decideApprovalAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="approvalId" value={a.id} />
                  <Input name="note" placeholder="Decision notes" className="sm:max-w-sm" />
                  <Button name="decision" value="approved" type="submit">
                    Approve
                  </Button>
                  <Button name="decision" value="rejected" type="submit" variant="secondary">
                    Reject
                  </Button>
                </form>
              ) : (
                <p className="mt-2 text-xs text-muted">{a.decisionNote || "No decision notes."}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
