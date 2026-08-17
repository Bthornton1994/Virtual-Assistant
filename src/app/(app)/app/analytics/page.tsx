import { HealthBar, Metric, PageHeader, formatHours } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { deliveredStatuses } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const actor = await requireClient();
  const store = getStore();
  const requests = store.listRequests(actor);
  const workstreams = store.listWorkstreams(actor);
  const hours = store.hoursReturned(actor);
  const delivered = requests.filter((r) => deliveredStatuses().includes(r.status));
  return (
    <div className="space-y-8">
      <PageHeader title="Analytics" description="Leverage, not utilization theater." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Hours returned" value={formatHours(hours)} />
        <Metric label="Outcomes delivered" value={String(delivered.length)} />
        <Metric
          label="Avg automation score"
          value={`${Math.round(requests.reduce((s, r) => s + r.automationScore, 0) / Math.max(1, requests.length))}`}
        />
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Workstream health</h2>
        <div className="space-y-2">
          {workstreams.map((ws) => (
            <div key={ws.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3">
              <span className="text-sm">{ws.name}</span>
              <HealthBar score={ws.healthScore} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
