import { updateOperatingMemoryAction, updateOrganizationAction } from "@/app/actions/requests";
import { PageHeader } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { ACTION_CLASS_COPY, OPERATING_MEMORY_FIELDS } from "@/lib/domain";
import { requireClient } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  const org = actor.organizationId ? store.getOrganization(actor, actor.organizationId) : null;
  const canEdit = actor.role === "client_admin" || actor.role === "platform_admin";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Organization profile, default authority, and an inspectable audit export. Nothing here is a public profile."
      />

      {org && canEdit ? (
        <form action={updateOrganizationAction} className="grid gap-4 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2">
          <h2 className="text-sm font-semibold sm:col-span-2">Organization</h2>
          <Field label="Name">
            <Input name="name" defaultValue={org.name} required />
          </Field>
          <Field label="Industry">
            <Input name="industry" defaultValue={org.industry} />
          </Field>
          <Field label="Company size">
            <Input name="companySize" defaultValue={org.companySize} />
          </Field>
          <Field label="Timezone">
            <Input name="timezone" defaultValue={org.timezone} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit">Save organization</Button>
          </div>
        </form>
      ) : (
        <section className="rounded-xl border border-line bg-surface p-6 text-sm">
          <p>
            <span className="text-muted">Organization</span> · {org?.name ?? "No organization on this account"}
          </p>
          <p className="mt-2">
            <span className="text-muted">You</span> · {actor.name} ({actor.role.replaceAll("_", " ")})
          </p>
          <p className="mt-4 text-muted">Only a client admin can change organization settings.</p>
        </section>
      )}

      {org && canEdit ? (
        <form action={updateOperatingMemoryAction} className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold">Customer operating memory</h2>
          <p className="text-sm text-muted">
            Stored on the organization, not on a single request. Operators see these preferences on every future
            execution.
          </p>
          {(() => {
            const memory = store.getOperatingMemory(actor, org.id);
            return OPERATING_MEMORY_FIELDS.map((field) => (
              <Field key={field.key} label={field.label}>
                <Textarea name={field.key} defaultValue={memory[field.key]} />
              </Field>
            ));
          })()}
          <Button type="submit">Save operating memory</Button>
        </form>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-6">
        <h2 className="text-sm font-semibold">Authority defaults</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          New requests start as prepare-only unless the intake language or an external-communication flag raises the
          action class. These four classes are the product contract — they are not marketing labels.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          {Object.entries(ACTION_CLASS_COPY).map(([key, copy]) => (
            <li key={key}>
              <p className="font-medium">{copy.label}</p>
              <p className="text-muted">{copy.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {canEdit && actor.organizationId ? (
        <section className="rounded-xl border border-line bg-surface p-6">
          <h2 className="text-sm font-semibold">Audit export</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Downloads the audit events for this organization only. The export itself is written to the audit log.
          </p>
          <a
            href="/app/settings/export"
            className="mt-4 inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg-elevated"
          >
            Download organization audit JSON
          </a>
        </section>
      ) : null}
    </div>
  );
}
