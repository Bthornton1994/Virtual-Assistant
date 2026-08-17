import Link from "next/link";
import { createPlaybookAction } from "@/app/actions/requests";
import { PageHeader } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Playbooks" };

export default async function PlaybooksPage() {
  const actor = await requireClient();
  const store = getStore();
  const playbooks = store.listPlaybooks(actor);
  const workstreams = store.listWorkstreams(actor);
  return (
    <div className="space-y-8">
      <PageHeader title="Playbooks" description="Reusable SOPs for this organization. Inspectable and versioned." />
      <div className="grid gap-3">
        {playbooks.map((p) => (
          <Link key={p.id} href={`/app/playbooks/${p.id}`} className="rounded-xl border border-line bg-surface px-5 py-4 hover:bg-bg-elevated">
            <p className="font-medium">{p.title}</p>
            <p className="text-sm text-muted">{p.objective}</p>
            <p className="mt-1 text-xs text-muted">v{p.currentVersion}</p>
          </Link>
        ))}
      </div>
      {actor.role === "client_admin" ? (
        <form action={createPlaybookAction} className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">New playbook</h2>
          <Field label="Title">
            <Input name="title" required />
          </Field>
          <Field label="Objective">
            <Input name="objective" required />
          </Field>
          <Field label="Workstream">
            <select name="workstreamId" className="h-10 w-full rounded-md border border-line px-3 text-sm">
              <option value="">None</option>
              {workstreams.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Steps (one per line)">
            <Textarea name="steps" />
          </Field>
          <Field label="Client preferences (one per line)">
            <Textarea name="preferences" />
          </Field>
          <Field label="Warnings (one per line)">
            <Textarea name="warnings" defaultValue="Do not send, purchase, publish, or change access without approval." />
          </Field>
          <Button type="submit">Save playbook</Button>
        </form>
      ) : null}
    </div>
  );
}
