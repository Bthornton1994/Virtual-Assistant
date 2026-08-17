import Link from "next/link";
import { notFound } from "next/navigation";
import { addPlaybookVersionAction } from "@/app/actions/requests";
import { PageHeader, StatusBadge } from "@/components/product";
import { Button, Field, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { getStore } from "@/lib/store";

export const metadata = { title: "Playbook" };

export default async function PlaybookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireClient();
  const { id } = await params;
  let bundle;
  try {
    bundle = getStore().getPlaybook(actor, id);
  } catch (e) {
    if (e instanceof AuthzError || e instanceof DomainError) notFound();
    throw e;
  }
  const { playbook, versions, current, linkedRequests } = bundle;
  return (
    <div className="space-y-8">
      <PageHeader kicker={`Version ${playbook.currentVersion}`} title={playbook.title} description={playbook.objective} />
      {current ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-line bg-surface p-5 lg:col-span-2">
            <h2 className="text-sm font-semibold">Steps</h2>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {current.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
          <div className="space-y-4">
            <section className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold">Preferences</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
                {current.clientPreferences.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
            <section className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold">Warnings</h2>
              <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
                {current.warnings.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Version history</h2>
        <ul className="space-y-2 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="rounded-lg border border-line bg-surface px-4 py-2">
              v{v.version} · {new Date(v.createdAt).toLocaleDateString()}
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
          <Field label="Steps">
            <Textarea name="steps" defaultValue={current?.steps.join("\n")} />
          </Field>
          <Field label="Preferences">
            <Textarea name="preferences" defaultValue={current?.clientPreferences.join("\n")} />
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
