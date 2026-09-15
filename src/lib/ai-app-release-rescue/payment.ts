import { DomainError } from "@/lib/domain";
import { RESCUE_REMEDIATION_PRICE_USD, RESCUE_REVIEW_PRICE_USD } from "@/lib/ai-app-release-rescue/constants";

/**
 * Payment is copy-and-architecture ready. Checkout is not activated.
 * This module must not call Stripe or any processor.
 */
export const RESCUE_PAYMENT = {
  reviewUsd: RESCUE_REVIEW_PRICE_USD,
  remediationUsd: RESCUE_REMEDIATION_PRICE_USD,
  checkoutActivated: false,
  processor: "stripe_prepared_not_activated",
  customerCopy:
    "Checkout is prepared and is not active on this page. When activated, the $299 review is charged when an engagement is created. Nothing is billed from this demo.",
  remediationCopy:
    "The $1,250 remediation sprint is charged only if you accept it after the report. That checkout is also not active here.",
} as const;

export function rescueCheckoutActivated() {
  return RESCUE_PAYMENT.checkoutActivated;
}

export function createRescueCheckout(): never {
  throw new DomainError(
    "Rescue checkout is prepared but not activated. No payment is collected on this page.",
  );
}
