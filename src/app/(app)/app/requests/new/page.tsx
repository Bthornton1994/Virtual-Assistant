import { NewRequestForm } from "@/components/new-request-form";
import { PageHeader } from "@/components/product";
import { requireClient } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "New request" };

export default async function NewRequestPage() {
  const actor = await requireClient();
  const workstreams = getStore().listWorkstreams(actor);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        kicker="New request"
        title="What should we take off your plate?"
        description="A conversational intake. After you submit, you will see the structured plan before work begins."
      />
      <NewRequestForm workstreams={workstreams.map((w) => ({ id: w.id, name: w.name }))} />
    </div>
  );
}
