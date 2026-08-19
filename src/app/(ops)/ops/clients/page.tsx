import Link from "next/link";
import { provisionCustomerAction } from "@/app/actions/requests";
import { ActionError } from "@/components/action-error";
import { PageHeader } from "@/components/product";
import { Button, Field, Input } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { canProvisionCustomer } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const actor = await requireOps();
  const { error } = await searchParams;
  const store = getWorkspace(actor);
  const orgs = await store.listOrganizations(actor);
  return (
    <div className="space-y-6">
      <PageHeader title="Clients" description="Organizations we operate for." />
      {canProvisionCustomer(actor) ? (
        <form action={provisionCustomerAction} className="grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2">
          <h2 className="sm:col-span-2 text-sm font-semibold">Provision a founding customer</h2>
          <ActionError error={error} />
          <Field label="Organization">
            <Input name="name" required placeholder="Acme Partners" />
          </Field>
          <Field label="Industry">
            <Input name="industry" placeholder="Professional services" />
          </Field>
          <Field label="Client admin name">
            <Input name="adminName" required placeholder="Jordan Lee" />
          </Field>
          <Field label="Client admin email">
            <Input name="adminEmail" type="email" required placeholder="jordan@acme.com" />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">Create organization and send invitation</Button>
          </div>
          <p className="sm:col-span-2 text-xs text-muted">
            No public signup. The invited admin sets their own credentials. Preview fixture tenants must not be copied into Production.
          </p>
        </form>
      ) : null}
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
