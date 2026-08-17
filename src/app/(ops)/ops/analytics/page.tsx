import { Metric, PageHeader } from "@/components/product";
import { requireOps } from "@/lib/auth";
import { deliveredStatuses } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Ops analytics" };

export default async function OpsAnalyticsPage() {
  const actor = await requireOps();
  const store = getStore();
  const requests = store.listRequests(actor);
  const delivered = requests.filter((r) => deliveredStatuses().includes(r.status));
  const qa = store.data.qaReviews;
  const pass = qa.filter((q) => q.passed).length;
  return (
    <div className="space-y-8">
      <PageHeader title="Operations analytics" description="Throughput, quality, and hours returned across tenants." />
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Requests visible" value={String(requests.length)} />
        <Metric label="Delivered / accepted" value={String(delivered.length)} />
        <Metric label="QA pass rate" value={qa.length ? `${Math.round((pass / qa.length) * 100)}%` : "—"} />
        <Metric
          label="Hours logged"
          value={String(store.data.timeEntries.reduce((s, t) => s + t.hours, 0))}
        />
      </div>
    </div>
  );
}
