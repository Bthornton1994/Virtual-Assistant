import Link from "next/link";
import { opsAssignAction } from "@/app/actions/requests";
import { EmptyState, PageHeader, PriorityBadge, RiskBadge, StatusBadge, formatDate } from "@/components/product";
import { Button } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { PRIORITIES, QUEUE_SECTIONS, REQUEST_STATUSES, RISK_LEVELS } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Queue" };

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    operator?: string;
    workstream?: string;
    priority?: string;
    risk?: string;
    deadline?: string;
    status?: string;
  }>;
}) {
  const actor = await requireOps();
  const filters = await searchParams;
  const store = getWorkspace(actor);
  await store.runDueSchedules(actor);
  const operators = await store.listOperators(actor);
  const orgs = await store.listOrganizations(actor);
  const workstreams = await store.listWorkstreams(actor);
  const requests = await store.listRequests(actor, {
    organizationId: filters.client || undefined,
    operatorId: filters.operator || undefined,
    workstreamId: filters.workstream || undefined,
    priority: PRIORITIES.includes(filters.priority as (typeof PRIORITIES)[number])
      ? (filters.priority as (typeof PRIORITIES)[number])
      : undefined,
    riskLevel: RISK_LEVELS.includes(filters.risk as (typeof RISK_LEVELS)[number])
      ? (filters.risk as (typeof RISK_LEVELS)[number])
      : undefined,
    deadline:
      filters.deadline === "overdue" || filters.deadline === "today" || filters.deadline === "week"
        ? filters.deadline
        : undefined,
    status: REQUEST_STATUSES.includes(filters.status as (typeof REQUEST_STATUSES)[number])
      ? (filters.status as (typeof REQUEST_STATUSES)[number])
      : undefined,
  });
  const orgNames = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
  const wsNames = Object.fromEntries(workstreams.map((w) => [w.id, w.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations queue"
        description="Command center. Work is grouped by operating state. Filters persist on the URL."
      />

      <form className="grid gap-2 rounded-xl border border-line bg-surface p-4 sm:grid-cols-4 lg:grid-cols-8">
        <select name="client" defaultValue={filters.client ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">All clients</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select name="operator" defaultValue={filters.operator ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">All operators</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select name="workstream" defaultValue={filters.workstream ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">All workstreams</option>
          {workstreams.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={filters.priority ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select name="risk" defaultValue={filters.risk ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">All risk</option>
          {RISK_LEVELS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select name="deadline" defaultValue={filters.deadline ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">Any deadline</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="week">Due this week</option>
        </select>
        <select name="status" defaultValue={filters.status ?? ""} className="h-9 rounded-md border border-line px-2 text-xs">
          <option value="">All statuses</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </form>

      {requests.length === 0 ? (
        <EmptyState title="No work matches" body="Clear filters or wait for a customer to delegate an outcome." />
      ) : (
        <div className="space-y-8">
          {QUEUE_SECTIONS.map((section) => {
            const rows = requests.filter((r) => section.statuses.includes(r.status));
            return (
              <section key={section.id}>
                <h2 className="mb-2 text-sm font-semibold">
                  {section.label}
                  <span className="ml-2 text-xs font-normal text-muted">{rows.length}</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line px-4 py-3 text-sm text-muted">Empty</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                    <table className="w-full min-w-[880px] text-left text-sm">
                      <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-2 font-medium">Request</th>
                          <th className="px-3 py-2 font-medium">Client</th>
                          <th className="px-3 py-2 font-medium">Priority</th>
                          <th className="px-3 py-2 font-medium">Deadline</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Risk</th>
                          <th className="px-3 py-2 font-medium">Operator</th>
                          <th className="px-3 py-2 font-medium">Workstream</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id} className="border-b border-line last:border-0 align-top">
                            <td className="px-3 py-2">
                              <Link href={`/ops/requests/${r.id}`} className="font-medium hover:underline">
                                {r.title}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-muted">{orgNames[r.organizationId]}</td>
                            <td className="px-3 py-2">
                              <PriorityBadge priority={r.priority} />
                            </td>
                            <td className="px-3 py-2 text-muted">{formatDate(r.dueAt)}</td>
                            <td className="px-3 py-2">
                              <StatusBadge status={r.status} />
                            </td>
                            <td className="px-3 py-2">
                              <RiskBadge risk={r.riskLevel} />
                            </td>
                            <td className="px-3 py-2">
                              {actor.role === "operator" ? (
                                <span>{operators.find((o) => o.id === r.assignedOperatorId)?.name ?? "Unassigned"}</span>
                              ) : (
                                <form action={opsAssignAction} className="flex gap-1">
                                  <input type="hidden" name="requestId" value={r.id} />
                                  <select
                                    name="operatorId"
                                    defaultValue={r.assignedOperatorId ?? ""}
                                    className="h-8 rounded border border-line px-2 text-xs"
                                  >
                                    <option value="">Assign</option>
                                    {operators.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.name}
                                      </option>
                                    ))}
                                  </select>
                                  <Button type="submit" size="sm">
                                    Set
                                  </Button>
                                </form>
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted">{r.workstreamId ? wsNames[r.workstreamId] : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
