import Link from "next/link";
import { PageHeader } from "@/components/product";
import { requireOps } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const actor = await requireOps();
  const store = getWorkspace(actor);
  const orgs = await store.listOrganizations(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Clients" description="Organizations we operate for." />
      <div className="grid gap-3">
        {(await Promise.all(
          orgs.map(async (org) => ({
            org,
            hours: await store.hoursReturned(actor, org.id),
            open: (await store.listRequests(actor, { organizationId: org.id })).length,
          })),
        )).map(({ org, hours, open }) => {
          return (
            <Link key={org.id} href={`/ops/clients/${org.id}`} className="rounded-xl border border-line bg-surface px-5 py-4 hover:bg-bg-elevated">
              <p className="font-medium">{org.name}</p>
              <p className="text-sm text-muted">
                {org.industry} · {open} requests · {hours}h returned
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
