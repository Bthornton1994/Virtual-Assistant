import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthBar, PageHeader, StatusBadge } from "@/components/product";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Client" };

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOps();
  const { id } = await params;
  const store = getWorkspace(actor);
  let org;
  try {
    org = store.getOrganization(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const requests = store.listRequests(actor, { organizationId: id });
  const workstreams = store.listWorkstreams(actor, id);
  const members = store.listMembers(actor, id);
  return (
    <div className="space-y-8">
      <PageHeader kicker={org.industry} title={org.name} description={`${org.companySize} people · ${org.timezone}`} />
      <section>
        <h2 className="mb-3 text-sm font-semibold">Members</h2>
        <ul className="text-sm">
          {members.map((m) => (
            <li key={m.id}>
              {m.user?.name} · {m.role.replaceAll("_", " ")}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Workstreams</h2>
        <div className="space-y-2">
          {workstreams.map((ws) => (
            <div key={ws.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2">
              <span className="text-sm">{ws.name}</span>
              <HealthBar score={ws.healthScore} />
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">Requests</h2>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {requests.map((r) => (
            <Link key={r.id} href={`/ops/requests/${r.id}`} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{r.title}</span>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
