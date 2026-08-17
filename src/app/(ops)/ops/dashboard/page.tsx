import Link from "next/link";
import { Metric, PageHeader, StatusBadge } from "@/components/product";
import { requireOps } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Ops dashboard" };

export default async function OpsDashboardPage() {
  const actor = await requireOps();
  const store = getStore();
  const queue = store.listRequests(actor);
  const pendingQa = queue.filter((r) => r.status === "qa");
  const approvals = store.listApprovals(actor).filter((a) => a.status === "pending");
  return (
    <div className="space-y-8">
      <PageHeader kicker="Operations" title="Delivery console" description="Queue health across every tenant." />
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Open requests" value={String(queue.filter((r) => !["accepted", "cancelled", "delivered"].includes(r.status)).length)} />
        <Metric label="In QA" value={String(pendingQa.length)} />
        <Metric label="Waiting on customer" value={String(approvals.length)} />
        <Metric label="Clients" value={String(store.listOrganizations(actor).length)} />
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {queue
            .filter((r) => ["blocked", "qa", "triage", "awaiting_approval"].includes(r.status))
            .slice(0, 8)
            .map((r) => (
              <Link key={r.id} href={`/ops/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
                <span>{r.title}</span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
