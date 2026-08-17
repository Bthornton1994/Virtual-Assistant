import { PageHeader } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireClient();
  const org = actor.organizationId ? getStore().getOrganization(actor, actor.organizationId) : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organization profile and authority defaults." />
      <section className="rounded-xl border border-line bg-surface p-6 text-sm">
        <p><span className="text-muted">Organization</span> · {org?.name}</p>
        <p className="mt-2"><span className="text-muted">Industry</span> · {org?.industry}</p>
        <p className="mt-2"><span className="text-muted">Timezone</span> · {org?.timezone}</p>
        <p className="mt-2"><span className="text-muted">You</span> · {actor.name} ({actor.role.replaceAll("_", " ")})</p>
        <p className="mt-4 max-w-xl text-muted">
          Default action class is prepare-only. External and sensitive work always require an approval record.
        </p>
      </section>
    </div>
  );
}
