import { RescueIntakeForm } from "@/components/ai-app-release-rescue/intake-form";
import { RESCUE_REVIEW_PRICE_USD, formatUsd } from "@/lib/ai-app-release-rescue/constants";

export const metadata = {
  title: "Request a release review",
  description: `Demo intake for the ${formatUsd(RESCUE_REVIEW_PRICE_USD)} AI App Release Rescue review. No payment and no access tokens.`,
};

export const dynamic = "force-dynamic";

export default function RescueIntakePage() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted">Demo intake</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em]">One repo. One app. One workflow.</h1>
      <p className="mt-4 text-base text-ink-soft">
        This path records a local demo request. It does not charge {formatUsd(RESCUE_REVIEW_PRICE_USD)}, does not call Stripe,
        and does not accept an access token.
      </p>
      <div className="mt-10">
        <RescueIntakeForm />
      </div>
    </div>
  );
}
