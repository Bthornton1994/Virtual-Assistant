import { EmptyState, Metric, PageHeader } from "@/components/product";
import { requireOps } from "@/lib/auth";
import { deliveredStatuses } from "@/lib/domain";
import { countOverdue, currentTimeMs } from "@/lib/ops-metrics";
import { getStore } from "@/lib/store";

export const metadata = { title: "Ops analytics" };

export default async function OpsAnalyticsPage() {
  const actor = await requireOps();
  const store = getStore();
  const requests = store.listRequests(actor);
  const delivered = requests.filter((r) => deliveredStatuses().includes(r.status));
  const qa = store.data.qaReviews;
  const pass = qa.filter((q) => q.passed).length;
  const orgs = store.listOrganizations(actor);
  const blocked = requests.filter((r) => r.status === "blocked").length;
  const waiting = requests.filter((r) =>
    ["awaiting_plan_approval", "awaiting_action_approval", "needs_clarification"].includes(r.status),
  ).length;
  const overdue = countOverdue(requests, currentTimeMs());

  if (requests.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Operations analytics" description="Counts are from the live queue, not a sample dashboard." />
        <EmptyState
          title="Queue is empty"
          body="Throughput and QA pass rate appear once requests exist. Open the queue after a customer submits an outcome."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Operations analytics"
        description="Throughput, quality, and wait states across tenants you can see. These are operating counts, not contracted SLAs."
      />
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Requests visible" value={String(requests.length)} />
        <Metric label="Delivered / accepted" value={String(delivered.length)} />
        <Metric label="QA pass rate" value={qa.length ? `${Math.round((pass / qa.length) * 100)}%` : "—"} hint={qa.length ? `${pass} of ${qa.length} reviews` : "No reviews yet"} />
        <Metric
          label="Hours logged"
          value={String(store.data.timeEntries.reduce((s, t) => s + t.hours, 0))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Blocked" value={String(blocked)} />
        <Metric label="Waiting on customer" value={String(waiting)} />
        <Metric label="Past due (open)" value={String(overdue)} hint="Compared to due_at, not a published SLA" />
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">By client</h2>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {orgs.map((org) => {
            const rows = requests.filter((r) => r.organizationId === org.id);
            return (
              <div key={org.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span>{org.name}</span>
                <span className="text-muted">{rows.length} requests · {store.hoursReturned(actor, org.id)}h returned</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
