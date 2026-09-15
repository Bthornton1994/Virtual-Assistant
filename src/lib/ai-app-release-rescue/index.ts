// Public surface for the Release Rescue customer pages.
//
// Contracts are re-exported from src/lib/release-rescue-* rather than redefined.
// Anything authoritative — the offer terms, the rubric, the severity model, the
// report schema, the redaction rules — belongs there, not here.

export {
  ACCESS_GRANT_METHOD_COPY,
  ACCESS_GRANT_METHODS,
  APP_TYPE_COPY,
  APP_TYPES,
  CANONICAL_NON_CLAIMS,
  DEMO_ENGAGEMENT_COOKIE,
  DEMO_SAMPLE_REPORT_ID,
  ENGAGEMENT_STATUSES,
  REPORT_LIMITATIONS_VERBATIM,
  RESCUE_GRANT_WINDOW_DAYS,
  RESCUE_PATH,
  RESCUE_REMEDIATION_PRICE_USD,
  RESCUE_RETENTION_DAYS,
  RESCUE_REVIEW_PRICE_USD,
  RESCUE_SCOPE_LIMIT,
  RESCUE_SERVICE_ID,
  RESCUE_SERVICE_NAME,
  RUBRIC_CATEGORIES,
  RUBRIC_CATEGORY_COPY,
} from "@/lib/ai-app-release-rescue/constants";

export {
  ATTESTATION_COPY,
  ATTESTATION_FIELDS,
  ACCESS_WINDOW_DAY_OPTIONS,
  RETENTION_POLICY_COPY,
  formDataToRecord,
  parseRepositoryReference,
  parseRescueIntake,
} from "@/lib/ai-app-release-rescue/intake";

export { createRescueCheckout, RESCUE_PAYMENT, rescueCheckoutActivated } from "@/lib/ai-app-release-rescue/payment";

export {
  createDemoEngagement,
  getDemoEngagement,
  getSampleCustomerReport,
  getSampleReport,
} from "@/lib/ai-app-release-rescue/engagement";

// The authoritative contracts, re-exported so a page never reaches for a copy.
export { VERDICT_COPY, toCustomerReportView, type CustomerReportView } from "@/lib/release-rescue-presentation";
export { RELEASE_RESCUE_OFFER, findProhibitedClaims } from "@/lib/release-rescue-intake";
