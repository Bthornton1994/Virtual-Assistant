import Link from "next/link";
import { createPlaybookAction } from "@/app/actions/requests";
import { EmptyState, PageHeader } from "@/components/product";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Playbooks" };

export default async function PlaybooksPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  const playbooks = store.listPlaybooks(actor);
  const workstreams = store.listWorkstreams(actor);
  return (
    <div className="space-y-8">
      <PageHeader title="Playbooks" description="Reusable SOPs for this organization. Inspectable and versioned." />
      {playbooks.length === 0 ? (
        <EmptyState
          title="No playbooks captured yet"
          body="After a path is delivered and checked, write it down here. Playbooks stay inside this organization and are never reused as another tenant’s SOP."
        />
      ) : (
      <div className="grid gap-3">
        {playbooks.map((p) => (
          <Link key={p.id} href={`/app/playbooks/${p.id}`} className="rounded-xl border border-line bg-surface px-5 py-4 hover:bg-bg-elevated">
            <p className="font-medium">{p.title}</p>
            <p className="text-sm text-muted">{p.objective}</p>
            <p className="mt-1 text-xs text-muted">v{p.currentVersion}</p>
          </Link>
        ))}
      </div>
      )}
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
          <Field label="Trigger">
            <Input name="trigger" placeholder="Every weekday at 8 AM" />
          </Field>
          <Field label="Steps (one per line)">
            <Textarea name="steps" />
          </Field>
          <Field label="Required inputs">
            <Textarea name="requiredInputs" />
          </Field>
          <Field label="Tools / systems">
            <Textarea name="tools" />
          </Field>
          <Field label="Client preferences (one per line)">
            <Textarea name="preferences" />
          </Field>
          <Field label="Authority limits">
            <Textarea name="authorityLimits" />
          </Field>
          <Field label="Approval points">
            <Textarea name="approvalPoints" />
          </Field>
          <Field label="QA checklist">
            <Textarea name="qaChecklist" />
          </Field>
          <Field label="Known exceptions">
            <Textarea name="knownExceptions" />
          </Field>
          <Field label="Templates">
            <Textarea name="templates" />
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
