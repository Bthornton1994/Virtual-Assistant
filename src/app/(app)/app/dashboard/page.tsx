import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { EmptyState, PageHeader, StatusBadge } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { formatOperatingMemory } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  if (actor.role === "client_admin" || actor.role === "platform_admin") {
    await store.runDueSchedules(actor);
  }
  const organizations = await store.listOrganizations(actor);
  const orgId = actor.organizationId ?? organizations[0]?.id;
  const org = orgId ? await store.getOrganization(actor, orgId) : null;
  const workstreams = await store.listWorkstreams(actor, orgId);
  const requests = await store.listRequests(actor, { organizationId: orgId });
  const approvals = (await store.listApprovals(actor, orgId)).filter((a) => a.status === "pending");
  const clarifications = await store.listOpenClarifications(actor);
  const handled = requests.filter((r) =>
    ["queued", "assigned", "in_progress", "qa", "awaiting_plan_approval", "awaiting_action_approval", "ready_to_deliver", "needs_clarification"].includes(
      r.status,
    ),
  );
  const blocked = requests.filter((r) => r.status === "blocked" || r.status === "revision_required");
  const completed = requests.filter((r) => r.status === "delivered" || r.status === "accepted");
  const recurringRunning = workstreams.filter((w) => w.schedule && w.schedule.cadence !== "none");
  const playbooks = await store.listPlaybooks(actor, orgId);
  const memory = orgId ? await store.getOperatingMemory(actor, orgId) : null;
  const walk = requests.find((r) => r.id === "req_conference" && r.status !== "accepted" && r.status !== "cancelled");

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={org?.name ?? "Workspace"}
        title="What is in motion"
        description="Status, decisions, and what the system learned — not a vanity scoreboard."
        actions={
          <ButtonLink href="/app/requests/new">Delegate an outcome</ButtonLink>
        }
      />

      {walk ? (
        <Link
          href={`/app/requests/${walk.id}`}
          className="block rounded-xl border border-line bg-surface px-5 py-4 hover:bg-bg-elevated"
        >
          <p className="text-xs uppercase tracking-wide text-muted">Walk this request</p>
          <p className="mt-1 font-medium">{walk.title}</p>
          <p className="mt-1 text-sm text-muted">
            Approve the plan. Ops assigns Maya Chen. Then execution, QA, outbound approval, delivery, and playbook.
          </p>
        </Link>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">1. What is being handled for me?</h2>
        {handled.length === 0 ? (
          <p className="text-sm text-muted">Nothing is in motion. Delegate an outcome to start.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {handled.map((r) => (
              <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
                <span>{r.title}</span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">2. What needs my decision?</h2>
        {approvals.length === 0 && clarifications.length === 0 ? (
          <p className="text-sm text-muted">No approvals or clarification questions are waiting.</p>
        ) : (
          <div className="space-y-2">
            {approvals.map((a) => (
              <Link key={a.id} href="/app/approvals" className="block rounded-lg border border-line bg-surface px-4 py-3 text-sm hover:bg-bg-elevated">
                <p className="font-medium">{a.request?.title}</p>
                <p className="text-xs text-muted">
                  {a.kind.replaceAll("_", " ")} · {a.action}
                </p>
              </Link>
            ))}
            {clarifications.map((c) => (
              <Link key={c.id} href={`/app/requests/${c.requestId}`} className="block rounded-lg border border-line bg-surface px-4 py-3 text-sm hover:bg-bg-elevated">
                <p className="font-medium">{c.question}</p>
                <p className="text-xs text-muted">Needs an answer</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">3. What has been completed?</h2>
        {completed.length === 0 ? (
          <p className="text-sm text-muted">No deliveries yet.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {completed.map((r) => (
              <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
                <span>{r.title}</span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">4. What is blocked?</h2>
        {blocked.length === 0 ? (
          <p className="text-sm text-muted">Nothing is blocked.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-surface">
            {blocked.map((r) => (
              <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
                <span>{r.title}</span>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">5. What recurring work is running?</h2>
        {recurringRunning.length === 0 ? (
          <p className="text-sm text-muted">No operating schedules are set.</p>
        ) : (
          <div className="space-y-2">
            {recurringRunning.map((ws) => (
              <Link key={ws.id} href={`/app/workstreams/${ws.id}`} className="block rounded-lg border border-line bg-surface px-4 py-3 text-sm hover:bg-bg-elevated">
                <p className="font-medium">{ws.name}</p>
                <p className="text-xs text-muted">
                  {ws.schedule?.cadence === "weekdays" ? "Every weekday" : "Weekly"} at {ws.schedule?.time} ·{" "}
                  {ws.schedule?.tasks.join(" · ")}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Next instance {ws.nextRunAt ? new Date(ws.nextRunAt).toLocaleString() : "queued"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">6. What did Delegation Cloud learn?</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs uppercase tracking-wide text-muted">Playbooks</p>
            {playbooks.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No playbooks captured yet. After a path is accepted, write it down.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {playbooks.map((p) => (
                  <li key={p.id}>
                    <Link href={`/app/playbooks/${p.id}`} className="hover:underline">
                      {p.title} · v{p.currentVersion}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border border-line bg-surface p-5">
            <p className="text-xs uppercase tracking-wide text-muted">Operating memory</p>
            {memory && formatOperatingMemory(memory).length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {formatOperatingMemory(memory).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No preferences stored" body="Operating memory lives in Settings and is reused on future work." />
            )}
            <Link href="/app/settings" className="mt-3 inline-block text-sm underline">
              Edit operating memory
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
