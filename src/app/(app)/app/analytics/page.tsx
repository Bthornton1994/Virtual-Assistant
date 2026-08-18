import { EmptyState, HealthBar, Metric, PageHeader, formatHours } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { deliveredStatuses } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  const requests = store.listRequests(actor);
  const workstreams = store.listWorkstreams(actor);
  const hours = store.hoursReturned(actor);
  const delivered = requests.filter((r) => deliveredStatuses().includes(r.status));
  const usage = store.listUsage(actor)[0];

  if (requests.length === 0 && workstreams.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Analytics" description="Figures come from this organization’s own requests and workstreams." />
        <EmptyState
          title="No operating history yet"
          body="Hours returned and delivery counts appear after the first request is accepted. Nothing here is a benchmark against other companies."
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description="Leverage from this organization’s records — not utilization theater, and not a comparison to other tenants."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Hours returned" value={formatHours(hours)} hint="From workstream totals and accepted deliveries" />
        <Metric label="Outcomes delivered" value={String(delivered.length)} hint="Status delivered or accepted" />
        <Metric
          label="Avg automation score"
          value={`${Math.round(requests.reduce((s, r) => s + r.automationScore, 0) / Math.max(1, requests.length))}`}
          hint="Model or mock estimate of how much of the path is rule-shaped"
        />
      </div>
      {usage ? (
        <p className="text-sm text-muted">
          Period {usage.period}: {usage.hoursUsed} of {usage.hoursIncluded} included hours used, {usage.requestsDelivered}{" "}
          deliveries recorded on the usage row.
        </p>
      ) : null}
      <section>
        <h2 className="mb-3 text-sm font-semibold">Hours returned by workstream</h2>
        <div className="space-y-2">
          {workstreams.map((ws) => (
            <div key={ws.id} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium">{ws.name}</p>
                <p className="text-xs text-muted">{formatHours(ws.hoursReturned)}</p>
              </div>
              <HealthBar score={ws.healthScore} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
