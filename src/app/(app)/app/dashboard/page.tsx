import Link from "next/link";
import { Button } from "@/components/ui";
import { EmptyState, HealthBar, Metric, PageHeader, StatusBadge, formatHours } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { activeWorkStatuses, deliveredStatuses } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireClient();
  const store = getStore();
  const orgId = actor.organizationId ?? store.listOrganizations(actor)[0]?.id;
  const workstreams = store.listWorkstreams(actor, orgId);
  const requests = store.listRequests(actor, { organizationId: orgId });
  const approvals = store.listApprovals(actor, orgId).filter((a) => a.status === "pending");
  const hours = orgId ? store.hoursReturned(actor, orgId) : 0;
  const recent = requests.filter((r) => deliveredStatuses().includes(r.status)).slice(0, 4);
  const feed = store.activityFeed(actor, orgId);
  const counts = Object.fromEntries(
    ["triage", "awaiting_approval", "queued", "in_progress", "blocked", "qa", "ready"].map((s) => [
      s,
      requests.filter((r) => r.status === s).length,
    ]),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={store.listOrganizations(actor)[0]?.name ?? "Workspace"}
        title="Hours returned"
        description="Capacity you got back — not hours we sold you."
        actions={
          <Link href="/app/requests/new">
            <Button>What should we take off your plate?</Button>
          </Link>
        }
      />

      <Metric label="Hours returned" value={formatHours(hours)} hint="Across active workstreams this period" large />

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Active workstreams" value={String(workstreams.filter((w) => w.status === "active").length)} />
        <Metric label="Decisions needed" value={String(approvals.length)} />
        <Metric label="Completed outcomes" value={String(recent.length)} />
        <Metric label="In motion" value={String(requests.filter((r) => activeWorkStatuses().includes(r.status)).length)} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Request status</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {Object.entries(counts).map(([status, n]) => (
            <div key={status} className="rounded-lg border border-line bg-surface px-3 py-3">
              <p className="text-[11px] uppercase tracking-wide text-muted">{status.replaceAll("_", " ")}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{n}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold">Workstream health</h2>
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {workstreams.map((ws) => (
              <Link key={ws.id} href={`/app/workstreams/${ws.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-bg-elevated">
                <div>
                  <p className="text-sm font-medium">{ws.name}</p>
                  <p className="text-xs text-muted">{ws.status}</p>
                </div>
                <HealthBar score={ws.healthScore} />
              </Link>
            ))}
          </div>
        </section>
        <section className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold">Decisions needed</h2>
            <div className="space-y-2">
              {approvals.length === 0 ? (
                <p className="text-sm text-muted">No approvals waiting. External and sensitive work will pause here.</p>
              ) : (
                approvals.map((a) => (
                  <Link key={a.id} href="/app/approvals" className="block rounded-lg border border-line bg-surface px-4 py-3 text-sm hover:bg-bg-elevated">
                    <p className="font-medium">{a.request?.title}</p>
                    <p className="text-xs text-muted">{a.actionClass.replaceAll("_", " ")}</p>
                  </Link>
                ))
              )}
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold">Completed outcomes</h2>
            <div className="space-y-2">
              {recent.length === 0 ? (
                <p className="text-sm text-muted">No deliveries yet. Accepted outcomes will land here with their status.</p>
              ) : (
                recent.map((r) => (
                  <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-3 text-sm hover:bg-bg-elevated">
                    <span>{r.title}</span>
                    <StatusBadge status={r.status} />
                  </Link>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Activity</h2>
        {feed.length === 0 ? (
          <EmptyState
            title="No activity recorded"
            body="Logins, request changes, approvals, assignments, and AI actions write to this feed for this organization only."
          />
        ) : (
        <ul className="space-y-2">
          {feed.map((e) => (
            <li key={e.id} className="flex justify-between gap-4 rounded-lg border border-line bg-surface px-4 py-2 text-sm">
              <span>{e.action.replaceAll(".", " · ").replaceAll("_", " ")}</span>
              <span className="text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
        )}
      </section>
    </div>
  );
}
