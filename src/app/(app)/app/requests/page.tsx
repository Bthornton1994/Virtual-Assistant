import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { ActionClassBadge, EmptyState, PageHeader, PriorityBadge, StatusBadge, formatDate } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Requests" };

export default async function RequestsPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  const requests = await store.listRequests(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests"
        description="Outcomes in motion. Not a ticket dump."
        actions={
          <ButtonLink href="/app/requests/new">New request</ButtonLink>
        }
      />
      {requests.length === 0 ? (
        <EmptyState
          title="No outcomes in motion"
          body="Describe what needs to happen. We will return an execution plan before work starts. This is not a ticket inbox."
          action={
            <ButtonLink href="/app/requests/new">What should we take off your plate?</ButtonLink>
          }
        />
      ) : (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Request</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Authority</th>
              <th className="px-4 py-3 font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/app/requests/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className="px-4 py-3">
                  <ActionClassBadge value={r.approvalLevel} />
                </td>
                <td className="px-4 py-3 text-muted">{formatDate(r.dueAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
