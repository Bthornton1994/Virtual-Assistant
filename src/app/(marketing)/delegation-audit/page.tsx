import { DelegationAuditForm } from "@/components/delegation-audit";

export const metadata = { title: "Get your delegation plan" };

export default function DelegationAuditPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Delegation plan</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
        Find what should come off your plate.
      </h1>
      <p className="mt-4 text-lg text-ink-soft">
        Five short steps. The result is a ranked estimate — not a promise of hours saved.
      </p>
      <div className="mt-12">
        <DelegationAuditForm />
      </div>
    </div>
  );
}
