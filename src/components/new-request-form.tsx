"use client";

import { useState } from "react";
import { createRequestAction } from "@/app/actions/requests";
import { Button, Field, Input, Textarea } from "@/components/ui";

export function NewRequestForm({
  workstreams,
}: {
  workstreams: Array<{ id: string; name: string }>;
}) {
  const [what, setWhat] = useState("");
  return (
    <form action={createRequestAction} className="space-y-8">
      <section className="rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Delegation Cloud</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">What needs to happen?</h2>
        <p className="mt-1 text-sm text-muted">Describe the result, not the task list. We will propose the path.</p>
        <Textarea
          name="what"
          required
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          className="mt-4 min-h-32"
          placeholder="e.g. I need a one-page brief for Monday’s partners meeting covering open decisions."
        />
        <input type="hidden" name="title" value={what.slice(0, 80) || "New request"} />
        <input type="hidden" name="description" value={what} />
      </section>

      <section className="grid gap-5 rounded-xl border border-line bg-surface p-6 sm:grid-cols-2">
        <Field label="Desired outcome">
          <Textarea name="objective" required placeholder="What does done look like?" />
        </Field>
        <Field label="Deliverable">
          <Input name="deliverable" required placeholder="A document, pack, draft…" />
        </Field>
        <Field label="Deadline">
          <Input name="dueAt" type="datetime-local" />
        </Field>
        <Field label="Workstream (optional)">
          <select name="workstreamId" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
            <option value="">Suggest one</option>
            {workstreams.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Files (names, comma separated)" hint="Demo mode stores metadata. Connect Supabase Storage in production.">
          <Input name="files" placeholder="brief-notes.pdf, rate-card.pdf" />
        </Field>
        <div className="space-y-3 pt-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="recurring" /> Recurring workstream item
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="externalCommunication" /> External communication is permitted
          </label>
          <p className="text-xs text-muted">
            Even if permitted, external and sensitive actions still require the matching approval.
          </p>
        </div>
      </section>

      <Button type="submit" size="lg">
        Submit and see the execution plan
      </Button>
    </form>
  );
}
