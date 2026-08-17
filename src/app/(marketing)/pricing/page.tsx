import Link from "next/link";
import { Button } from "@/components/ui";
import { BILLING_PLANS } from "@/lib/stripe";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Pricing</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Capacity, not hourly inventory.</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft">
        You buy managed hours against outcomes. Payments can run through Stripe; this MVP can also activate a plan in
        demo mode.
      </p>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {BILLING_PLANS.map((plan) => (
          <article
            key={plan.id}
            className="flex flex-col rounded-xl border border-line bg-surface p-6"
          >
            <h2 className="text-lg font-semibold">{plan.name}</h2>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{plan.priceLabel}</p>
            <p className="mt-2 text-sm text-muted">{plan.blurb}</p>
            <ul className="mt-6 space-y-2 text-sm text-ink-soft">
              {plan.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link href="/signup" className="mt-8">
              <Button className="w-full" variant={plan.id === "growth" ? "primary" : "secondary"}>
                Start with {plan.name}
              </Button>
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
