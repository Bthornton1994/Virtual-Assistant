import { decideApprovalAction } from "@/app/actions/requests";
import { ActionClassBadge, EmptyState, PageHeader } from "@/components/product";
import { Button, Input } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const actor = await requireClient();
  const approvals = getStore().listApprovals(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Sensitive execution never proceeds without an explicit decision here."
      />
      {approvals.length === 0 ? (
        <EmptyState
          title="Nothing needs your signature"
          body="External and sensitive work pauses here. When operations needs authority, the request and the action class will appear on this list."
        />
      ) : (
      <div className="space-y-4">
        {approvals.map((a) => (
          <article key={a.id} className="rounded-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{a.request?.title ?? a.requestId}</h2>
              <ActionClassBadge value={a.actionClass} />
              <span className="text-xs uppercase text-muted">{a.status}</span>
            </div>
            <p className="mt-2 text-sm text-muted">{a.reason}</p>
            {a.status === "pending" ? (
              <form action={decideApprovalAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input type="hidden" name="approvalId" value={a.id} />
                <Input name="note" placeholder="Decision note" className="sm:max-w-sm" />
                <Button name="decision" value="approved" type="submit">
                  Approve
                </Button>
                <Button name="decision" value="rejected" type="submit" variant="secondary">
                  Reject
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-xs text-muted">{a.decisionNote}</p>
            )}
          </article>
        ))}
      </div>
      )}
    </div>
  );
}
