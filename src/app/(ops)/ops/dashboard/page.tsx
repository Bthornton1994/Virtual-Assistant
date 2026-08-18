import Link from "next/link";
import { runWorkstreamScheduleAction } from "@/app/actions/requests";
import { Metric, PageHeader, StatusBadge } from "@/components/product";
import { Button } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Ops dashboard" };

export default async function OpsDashboardPage() {
  const actor = await requireOps();
  const store = getWorkspace(actor);
  await store.runDueSchedules(actor);
  const queue = await store.listRequests(actor);
  const pendingQa = queue.filter((r) => r.status === "qa");
  const approvals = (await store.listApprovals(actor)).filter((a) => a.status === "pending");
  const scheduled = (await store.listWorkstreams(actor)).filter((w) => w.schedule && w.schedule.cadence !== "none");
  const clients = await store.listOrganizations(actor);
  return (
    <div className="space-y-8">
      <PageHeader kicker="Operations" title="Delivery console" description="Queue health across every tenant." />
      {queue.some((r) => r.id === "req_conference" && !["accepted", "cancelled"].includes(r.status)) ? (
        <Link
          href="/ops/requests/req_conference"
          className="block rounded-xl border border-line bg-surface px-5 py-4 text-sm hover:bg-bg-elevated"
        >
          <p className="text-xs uppercase tracking-wide text-muted">Same request walkthrough</p>
          <p className="mt-1 font-medium">Conference lead follow-up — Northline Consulting</p>
          <p className="mt-1 text-muted">
            After the client approves the plan, assign Maya Chen, execute, QA, then wait for outbound approval before
            delivering.
          </p>
        </Link>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Open requests" value={String(queue.filter((r) => !["accepted", "cancelled", "delivered"].includes(r.status)).length)} />
        <Metric label="In QA" value={String(pendingQa.length)} />
        <Metric label="Waiting on customer" value={String(approvals.length)} />
        <Metric label="Clients" value={String(clients.length)} />
      </div>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {queue
            .filter((r) =>
              ["blocked", "qa", "triage", "needs_clarification", "awaiting_action_approval", "revision_required"].includes(
                r.status,
              ),
            )
            .slice(0, 8)
            .map((r) => (
              <Link key={r.id} href={`/ops/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
                <span>{r.title}</span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
        </div>
      </section>
      {scheduled.length ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Recurring operating schedules</h2>
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {scheduled.map((ws) => (
              <div key={ws.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">{ws.name}</p>
                  <p className="text-xs text-muted">
                    {ws.schedule?.cadence === "weekdays" ? "Every weekday" : "Weekly"} at {ws.schedule?.time} ·{" "}
                    {ws.schedule?.tasks.join(" · ")}
                  </p>
                </div>
                <form action={runWorkstreamScheduleAction}>
                  <input type="hidden" name="workstreamId" value={ws.id} />
                  <Button type="submit" size="sm">
                    Run now
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
