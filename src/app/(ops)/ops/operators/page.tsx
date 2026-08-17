import { PageHeader } from "@/components/product";
import { requireOps } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Operators" };

export default async function OperatorsPage() {
  const actor = await requireOps();
  const operators = getStore().listOperators(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operators"
        description="Internal delivery staff. This is not a public directory and not a marketplace."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {operators.map((op) => (
          <article key={op.id} className="rounded-xl border border-line bg-surface p-5">
            <p className="font-medium">{op.name}</p>
            <p className="text-xs uppercase tracking-wide text-muted">{op.platformRole.replaceAll("_", " ")}</p>
            <p className="mt-2 text-sm text-ink-soft">{op.bio}</p>
            <p className="mt-3 text-xs text-muted">
              {op.capacityHours}h capacity · {op.status} ·{" "}
              {op.skills.map((s) => s.skill?.name).filter(Boolean).join(", ")}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
