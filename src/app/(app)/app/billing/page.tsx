import { activatePlanAction } from "@/app/actions/requests";
import { Metric, PageHeader } from "@/components/product";
import { Button } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { getWorkspace } from "@/lib/workspace";
import { BILLING_PLANS } from "@/lib/stripe";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const actor = await requireClient();
  const store = getWorkspace(actor);
  const sub = store.getSubscription(actor);
  const usage = store.listUsage(actor)[0];
  return (
    <div className="space-y-8">
      <PageHeader
        title="Billing"
        description="Stripe is wired for production. In this MVP, plan changes are recorded locally and audited."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Plan" value={sub?.plan ?? "none"} hint={sub?.status} />
        <Metric label="Included hours" value={String(sub?.monthlyHours ?? 0)} />
        <Metric label="Used this period" value={String(usage?.hoursUsed ?? 0)} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {BILLING_PLANS.map((plan) => (
          <form key={plan.id} action={activatePlanAction} className="rounded-xl border border-line bg-surface p-5">
            <input type="hidden" name="plan" value={plan.id} />
            <h2 className="font-semibold">{plan.name}</h2>
            <p className="mt-1 text-2xl font-semibold">{plan.priceLabel}</p>
            <p className="mt-2 text-sm text-muted">{plan.blurb}</p>
            <Button className="mt-5" type="submit" variant={sub?.plan === plan.id ? "secondary" : "primary"}>
              {sub?.plan === plan.id ? "Current plan" : "Activate (demo)"}
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}
