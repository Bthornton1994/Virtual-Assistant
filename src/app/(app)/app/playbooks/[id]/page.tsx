import Link from "next/link";
import { notFound } from "next/navigation";
import { addPlaybookVersionAction } from "@/app/actions/requests";
import { PageHeader, StatusBadge } from "@/components/product";
import { Button, ButtonLink, Field, Input, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Playbook" };

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
          {items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">None recorded.</p>
      )}
    </section>
  );
}

export default async function PlaybookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  let bundle;
  try {
    bundle = await getWorkspace(actor).getPlaybook(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const { playbook, versions, current, linkedRequests } = bundle;
  return (
    <div className="space-y-8">
      <PageHeader
        kicker={`Version ${playbook.currentVersion}`}
        title={playbook.title}
        description={playbook.objective}
        actions={
          <ButtonLink href={`/app/requests/new?playbookId=${playbook.id}`}>Use this playbook</ButtonLink>
        }
      />
      {current ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-line bg-surface p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold">Steps</h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {current.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-4 text-xs uppercase tracking-wide text-muted">Trigger</p>
            <p className="text-sm">{current.trigger || "On request"}</p>
          </section>
          <div className="space-y-4">
            <List title="Required inputs" items={current.requiredInputs} />
            <List title="Tools / systems" items={current.tools} />
            <List title="Customer preferences" items={current.clientPreferences} />
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <List title="Authority limits" items={current.authorityLimits} />
          <List title="Approval points" items={current.approvalPoints} />
          <List title="QA checklist" items={current.qaChecklist} />
          <List title="Known exceptions" items={current.knownExceptions} />
          <List title="Templates" items={current.templates} />
          <List title="Warnings" items={current.warnings} />
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Version history</h2>
        <ul className="space-y-2 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="rounded-lg border border-line bg-surface px-4 py-2">
              v{v.version} · {new Date(v.createdAt).toLocaleDateString()} · {v.steps.length} steps
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Linked requests</h2>
        <div className="space-y-2">
          {linkedRequests.slice(0, 8).map((r) => (
            <Link key={r.id} href={`/app/requests/${r.id}`} className="flex items-center justify-between rounded-lg border border-line bg-surface px-4 py-2 text-sm">
              <span>{r.title}</span>
              <StatusBadge status={r.status} />
            </Link>
          ))}
        </div>
      </section>

      {actor.role === "client_admin" ? (
        <form action={addPlaybookVersionAction} className="space-y-3 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">New version</h2>
          <input type="hidden" name="playbookId" value={playbook.id} />
          <Field label="Trigger">
            <Input name="trigger" defaultValue={current?.trigger} />
          </Field>
          <Field label="Steps">
            <Textarea name="steps" defaultValue={current?.steps.join("\n")} />
          </Field>
          <Field label="Required inputs">
            <Textarea name="requiredInputs" defaultValue={current?.requiredInputs.join("\n")} />
          </Field>
          <Field label="Tools">
            <Textarea name="tools" defaultValue={current?.tools.join("\n")} />
          </Field>
          <Field label="Preferences">
            <Textarea name="preferences" defaultValue={current?.clientPreferences.join("\n")} />
          </Field>
          <Field label="Authority limits">
            <Textarea name="authorityLimits" defaultValue={current?.authorityLimits.join("\n")} />
          </Field>
          <Field label="Approval points">
            <Textarea name="approvalPoints" defaultValue={current?.approvalPoints.join("\n")} />
          </Field>
          <Field label="QA checklist">
            <Textarea name="qaChecklist" defaultValue={current?.qaChecklist.join("\n")} />
          </Field>
          <Field label="Known exceptions">
            <Textarea name="knownExceptions" defaultValue={current?.knownExceptions.join("\n")} />
          </Field>
          <Field label="Templates">
            <Textarea name="templates" defaultValue={current?.templates.join("\n")} />
          </Field>
          <Field label="Warnings">
            <Textarea name="warnings" defaultValue={current?.warnings.join("\n")} />
          </Field>
          <Button type="submit">Publish version</Button>
        </form>
      ) : null}
    </div>
  );
}
