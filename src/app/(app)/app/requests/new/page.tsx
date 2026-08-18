import { NewRequestForm } from "@/components/new-request-form";
import { PageHeader } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "New request" };

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ playbookId?: string }>;
}) {
  const actor = await requireClient();
  const { playbookId } = await searchParams;
  const store = getWorkspace(actor);
  const workstreams = store.listWorkstreams(actor);
  const playbooks = store.listPlaybooks(actor);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        kicker="New request"
        title="What should we take off your plate?"
        description="State the outcome, attach context, set the deadline and authority. The platform will triage, plan, and ask for approval before work starts."
      />
      <NewRequestForm
        workstreams={workstreams.map((w) => ({ id: w.id, name: w.name }))}
        playbooks={playbooks.map((p) => ({ id: p.id, title: p.title }))}
        defaultPlaybookId={playbookId}
      />
    </div>
  );
}
