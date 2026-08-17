import Link from "next/link";
import { opsAssignAction } from "@/app/actions/requests";
import { PageHeader, PriorityBadge, RiskBadge, StatusBadge, formatDate } from "@/components/product";
import { Button } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  const actor = await requireOps();
  const store = getStore();
  const requests = store.listRequests(actor);
  const operators = store.listOperators(actor);
  const orgs = Object.fromEntries(store.listOrganizations(actor).map((o) => [o.id, o.name]));
  const workstreams = Object.fromEntries(store.data.workstreams.map((w) => [w.id, w.name]));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Queue"
        description="Request, client, priority, deadline, status, risk, operator, workstream."
      />
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3 font-medium">Request</th>
              <th className="px-3 py-3 font-medium">Client</th>
              <th className="px-3 py-3 font-medium">Priority</th>
              <th className="px-3 py-3 font-medium">Deadline</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Risk</th>
              <th className="px-3 py-3 font-medium">Operator</th>
              <th className="px-3 py-3 font-medium">Workstream</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 align-top">
                <td className="px-3 py-3">
                  <Link href={`/ops/requests/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className="px-3 py-3 text-muted">{orgs[r.organizationId]}</td>
                <td className="px-3 py-3">
                  <PriorityBadge priority={r.priority} />
                </td>
                <td className="px-3 py-3 text-muted">{formatDate(r.dueAt)}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-3">
                  <RiskBadge risk={r.riskLevel} />
                </td>
                <td className="px-3 py-3">
                  {actor.role === "operator" ? (
                    <span>{operators.find((o) => o.id === r.assignedOperatorId)?.name ?? "Unassigned"}</span>
                  ) : (
                    <form action={opsAssignAction} className="flex gap-1">
                      <input type="hidden" name="requestId" value={r.id} />
                      <select name="operatorId" defaultValue={r.assignedOperatorId ?? ""} className="h-8 rounded border border-line px-2 text-xs">
                        <option value="">Assign</option>
                        {operators.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit">Set</Button>
                    </form>
                  )}
                </td>
                <td className="px-3 py-3 text-muted">{r.workstreamId ? workstreams[r.workstreamId] : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
