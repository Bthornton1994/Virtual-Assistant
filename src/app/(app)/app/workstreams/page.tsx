import Link from "next/link";
import { EmptyState, HealthBar, PageHeader, formatHours } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Workstreams" };

export default async function WorkstreamsPage() {
  const actor = await requireClient();
  const workstreams = getWorkspace(actor).listWorkstreams(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Workstreams" description="Recurring operational systems, not a list of people." />
      {workstreams.length === 0 ? (
        <EmptyState
          title="No workstreams scoped"
          body="A new organization starts with the eight standard workstreams in scoping. If you are seeing this, the workspace has no organization_id on the session."
        />
      ) : (
      <div className="grid gap-4 md:grid-cols-2">
        {workstreams.map((ws) => (
          <Link key={ws.id} href={`/app/workstreams/${ws.id}`} className="rounded-xl border border-line bg-surface p-5 hover:border-line-strong">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold tracking-tight">{ws.name}</h2>
                <p className="mt-1 text-sm text-muted">{ws.objective}</p>
              </div>
              <HealthBar score={ws.healthScore} />
            </div>
            <p className="mt-4 text-xs uppercase tracking-wide text-muted">
              {ws.status} · {formatHours(ws.hoursReturned)} returned
            </p>
          </Link>
        ))}
      </div>
      )}
    </div>
  );
}
