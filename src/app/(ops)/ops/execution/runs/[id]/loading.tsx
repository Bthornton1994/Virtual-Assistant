import { Card } from "@/components/ui";
import { PageHeader } from "@/components/product";

export default function ExecutionRunLoading() {
  return (
    <div className="space-y-6">
      <PageHeader kicker="Execution run" title="Loading run…" />
      <Card className="p-5">
        <p className="text-sm text-muted">Loading the work cell.</p>
      </Card>
    </div>
  );
}
