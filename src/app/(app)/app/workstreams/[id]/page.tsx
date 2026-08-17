import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthBar, PageHeader, StatusBadge } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Workstream" };

export default async function WorkstreamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  const store = getStore();
  let ws;
  try {
    ws = store.getWorkstream(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const requests = store.listRequests(actor, { workstreamId: ws.id });
  const owner = store.userName(ws.ownerUserId);
  return (
    <div className="space-y-8">
      <PageHeader kicker="Workstream" title={ws.name} description={ws.objective} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Health</p>
          <div className="mt-2">
            <HealthBar score={ws.healthScore} />
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">Owner</p>
          <p className="mt-2 font-medium">{owner}</p>
          <p className="text-xs text-muted">{ws.status}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-5">
          <p className="text-xs uppercase tracking-wide text-muted">SLA</p>
          <p className="mt-2 text-sm">{ws.sla}</p>
        </div>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Recurring work</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
          {ws.recurringTasks.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Metrics</h2>
        <div className="flex flex-wrap gap-2">
          {ws.metrics.map((m) => (
            <span key={m} className="rounded-full border border-line px-3 py-1 text-xs">
              {m}
            </span>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Linked requests</h2>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {requests.map((r) => (
            <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-bg-elevated">
              <span>{r.title}</span>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
