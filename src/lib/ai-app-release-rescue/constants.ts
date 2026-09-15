import {
  MAX_GRANT_WINDOW_DAYS,
  RELEASE_RESCUE_OFFER,
  REPOSITORY_ACCESS_MODES,
  RETENTION_DAYS,
  type RepositoryAccessMode,
} from "@/lib/release-rescue-intake";
import { RUBRIC_DIMENSIONS, type RubricDimension } from "@/lib/release-rescue-rubric";
import { DIMENSION_TITLES } from "@/lib/release-rescue-presentation";

// Presentation copy for the Release Rescue customer surface.
//
// This file holds WORDS. It deliberately holds no prices, no rubric, no severity
// vocabulary, and no scope rules of its own: every one of those is imported from
// the contracts in src/lib/release-rescue-*, which are the single source of
// truth for what the service actually does.
//
// The reason is specific. This offer's integrity rests on the marketing surface
// and the delivered report agreeing about what was promised. When the price, the
// rubric, or the non-claims live in two places, they drift, and the drift shows
// up as a customer who paid for something we did not deliver.

export const RESCUE_SERVICE_ID = "WS-REV-01" as const;
export const RESCUE_SERVICE_NAME = "AI App Release Rescue";

/** Dollars, for display. Cents are authoritative and live in the offer contract. */
export const RESCUE_REVIEW_PRICE_USD = RELEASE_RESCUE_OFFER.reviewPriceCents / 100;
export const RESCUE_REMEDIATION_PRICE_USD = RELEASE_RESCUE_OFFER.remediationSprintPriceCents / 100;

/** US currency with a thousands separator (`$1,250`, not `$1250`). */
export function formatUsd(dollars: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

export const RESCUE_SCOPE_LIMIT = RELEASE_RESCUE_OFFER.scopeCeiling;
export const RESCUE_GRANT_WINDOW_DAYS = MAX_GRANT_WINDOW_DAYS;
export const RESCUE_RETENTION_DAYS = RETENTION_DAYS;

/**
 * Mirrors the status check constraint on public.release_rescue_engagements.
 * The database is authoritative for lifecycle vocabulary; a value here that the
 * schema rejects is drift that only shows up when something tries to persist.
 */
export const ENGAGEMENT_STATUSES = [
  "intake",
  "scoped",
  "access_granted",
  "auditing",
  "report_ready",
  "delivered",
  "cancelled",
  "purged",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const ENGAGEMENT_TRANSITIONS: Record<EngagementStatus, readonly EngagementStatus[]> = {
  intake: ["scoped", "cancelled"],
  scoped: ["access_granted", "cancelled"],
  access_granted: ["auditing", "cancelled"],
  auditing: ["report_ready", "cancelled"],
  report_ready: ["delivered", "cancelled"],
  delivered: ["purged"],
  cancelled: ["purged"],
  purged: [],
};

/** The access modes the schema permits. Read-only, every one of them. */
export const ACCESS_GRANT_METHODS = REPOSITORY_ACCESS_MODES;
export type AccessGrantMethod = RepositoryAccessMode;

export const ACCESS_GRANT_METHOD_COPY: Record<AccessGrantMethod, string> = {
  customer_installed_readonly_app: "Install our read-only GitHub app on the one repository",
  customer_added_readonly_collaborator: "Add our reviewer as a read-only collaborator",
  customer_uploaded_archive: "Upload a source archive instead of granting access",
};

export const APP_TYPES = ["next_js_web_app", "react_spa", "other_web_app"] as const;
export type AppType = (typeof APP_TYPES)[number];

export const APP_TYPE_COPY: Record<AppType, string> = {
  next_js_web_app: "Next.js web application",
  react_spa: "React single-page application",
  other_web_app: "Other web application",
};

/** The rubric's dimensions, re-exported so the surface cannot invent its own. */
export const RUBRIC_CATEGORIES = RUBRIC_DIMENSIONS;
export type RubricCategory = RubricDimension;

/** What each dimension examines, in the customer's words. Titles come from the presenter. */
export const RUBRIC_CATEGORY_COPY: Record<RubricCategory, { title: string; examines: string }> = {
  secrets_and_credentials: {
    title: DIMENSION_TITLES.secrets_and_credentials,
    examines: "Committed credentials, keys reachable from the browser bundle, and whether secrets can be rotated.",
  },
  authentication_and_session: {
    title: DIMENSION_TITLES.authentication_and_session,
    examines: "Whether the auth boundary is enforced in server code, session and token handling, and recovery flows.",
  },
  authorization_and_tenancy: {
    title: DIMENSION_TITLES.authorization_and_tenancy,
    examines: "Object-level authorization, whether the database refuses cross-tenant access, and role separation.",
  },
  ai_boundary: {
    title: DIMENSION_TITLES.ai_boundary,
    examines: "Whether model-visible content can grant authority, tool and action limits, output sinks, and cost ceilings.",
  },
  data_handling_and_retention: {
    title: DIMENSION_TITLES.data_handling_and_retention,
    examines: "What customer data the workflow stores, its retention and deletion path, and third-party egress.",
  },
  input_validation_and_abuse: {
    title: DIMENSION_TITLES.input_validation_and_abuse,
    examines: "Schema validation at the request boundary and limits on endpoints that cost money or create records.",
  },
  dependency_and_supply_chain: {
    title: DIMENSION_TITLES.dependency_and_supply_chain,
    examines: "Whether a dependency with a known advisory is reachable from the reviewed workflow.",
  },
  release_operations: {
    title: DIMENSION_TITLES.release_operations,
    examines: "Production separation from preview and development, a tested rollback path, and shipped defaults.",
  },
  observability_and_incident_response: {
    title: DIMENSION_TITLES.observability_and_incident_response,
    examines: "Whether consequential actions leave an audit trail and whether logs or errors leak secrets or customer data.",
  },
  accessibility: {
    title: DIMENSION_TITLES.accessibility,
    examines: "Whether the reviewed workflow can be completed by keyboard, whether controls carry names and errors, and contrast and motion preferences.",
  },
  code_quality_and_tests: {
    title: DIMENSION_TITLES.code_quality_and_tests,
    examines: "Automated coverage of the critical workflow, how failures on that path are handled, and whether type and lint checks actually block a merge.",
  },
  documentation_and_handover: {
    title: DIMENSION_TITLES.documentation_and_handover,
    examines: "Whether a new engineer can run and verify the application, and whether known limits and the on-call path are written down.",
  },
};

/**
 * The four statements every surface and every report must carry.
 *
 * These are denials, and `findProhibitedClaims` is built to permit them: saying
 * "this is not a penetration test" is required copy, not a prohibited claim.
 */
export const CANONICAL_NON_CLAIMS = [
  "This review is not a penetration test.",
  "This review is not a compliance certification.",
  "This review does not guarantee the absence of security vulnerabilities.",
  "Findings describe one repository at one commit. Changes made after that commit were not reviewed.",
] as const;

export const REPORT_LIMITATIONS_VERBATIM = `This review is not a penetration test. It is not a compliance certification
(SOC 2, ISO 27001, HIPAA, PCI DSS, or any other standard). It does not
guarantee the absence of security vulnerabilities.

Findings come from reading source, configuration, and dependency manifests
at one commit. We do not attack or load-test a running system. Changes made
after the reviewed commit are not covered.

This review covers one repository, one application, and one critical
workflow. It is not legal, regulatory, or professional advice.

Customers who need penetration testing, compliance certification, or ongoing
security monitoring should engage qualified specialists for those services.`;

/**
 * Intake field names that would invite a customer to hand us a credential.
 *
 * The form must never contain a field with one of these names. Access is granted
 * separately, in the customer's own provider, and we hold no credential at all.
 */
export const FORBIDDEN_INTAKE_FIELD_NAMES = [
  "token",
  "pat",
  "password",
  "secret",
  "access_token",
  "accesstoken",
  "api_key",
  "apikey",
  "private_key",
  "privatekey",
  "service_role",
  "client_secret",
  "ssh_key",
] as const;

export const DEMO_SAMPLE_REPORT_ID = "demo-harbor-ledger";
/**
 * Authorizes the in-memory demo engagement page. Set with httpOnly, SameSite=Lax,
 * and Secure on HTTPS. Local HTTP demo cannot set a Secure cookie; that is a
 * local constraint, not a production default. See demoEngagementCookieSecure.
 */
export const DEMO_ENGAGEMENT_COOKIE = "dc_rescue_demo";
export const RESCUE_PATH = "/ai-app-release-rescue";
