import { DelegationAuditForm } from "@/components/delegation-audit";

export const metadata = { title: "Delegation audit" };

export default function DelegationAuditPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Delegation audit</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">What should come off your plate first?</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        A short assessment. We estimate delegatable load and recommend workstreams. Figures are estimates.
      </p>
      <div className="mt-10">
        <DelegationAuditForm />
      </div>
    </div>
  );
}
