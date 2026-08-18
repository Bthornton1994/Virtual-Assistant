import Link from "next/link";
import { createPlaybookAction } from "@/app/actions/requests";
import { EmptyState, PageHeader } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Ops playbooks" };

export default async function OpsPlaybooksPage() {
  const actor = await requireOps();
  const store = getWorkspace(actor);
  const playbooks = await store.listPlaybooks(actor);
  const orgs = Object.fromEntries((await store.listOrganizations(actor)).map((o) => [o.id, o.name]));
  return (
    <div className="space-y-8">
      <PageHeader title="Playbooks" description="Organization-owned SOPs. Confidentiality does not cross tenants." />
      {playbooks.length === 0 ? (
        <EmptyState
          title="No playbooks in view"
          body="Playbooks belong to a customer organization. They appear here after a path is captured. Do not copy one tenant’s SOP into another."
        />
      ) : (
      <div className="space-y-2">
        {playbooks.map((p) => (
          <div key={p.id} className="rounded-xl border border-line bg-surface px-5 py-4">
            <p className="font-medium">{p.title}</p>
            <p className="text-sm text-muted">
              {orgs[p.organizationId]} · v{p.currentVersion}
            </p>
            <p className="mt-1 text-sm text-ink-soft">{p.objective}</p>
          </div>
        ))}
      </div>
      )}
      {actor.role !== "operator" ? (
        <form action={createPlaybookAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Draft from a proven path</h2>
          <Field label="Title">
            <Input name="title" required />
          </Field>
          <Field label="Objective">
            <Input name="objective" required />
          </Field>
          <Field label="Steps">
            <Textarea name="steps" />
          </Field>
          <Field label="Warnings">
            <Textarea name="warnings" defaultValue="Do not reuse another organization's material." />
          </Field>
          <Button type="submit">Create</Button>
        </form>
      ) : (
        <p className="text-sm text-muted">Operators can read playbooks; managers publish versions.</p>
      )}
      <p className="text-xs text-muted">
        Customer playbook detail lives at <Link href="/app/playbooks" className="underline">/app/playbooks</Link> for the
        owning organization.
      </p>
    </div>
  );
}
