import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";

// The release-readiness rubric for the AI App Release Rescue review.
//
// This file is the single source of truth for WHAT the review covers. It is a
// frozen, versioned, content-hashed contract for three reasons:
//
//   1. The customer bought a defined review, not "whatever the auditor felt like
//      looking at". The rubric is what makes a fixed-price offer honest.
//   2. A report is only comparable to another report if both were produced
//      against the same rubric version. Every report carries rubricVersion and
//      rubricHash so a stale or hand-edited rubric cannot ride an old pass.
//   3. Coverage is computed from this list, not self-reported by the auditor.
//      An unassessed check is visible as a gap rather than silently absent.
//
// Scope ceiling: one repository, one application, one critical workflow. This
// rubric describes a structured, evidence-backed REVIEW. It is not a penetration
// test, not a compliance certification, and not a security guarantee. Those
// words are refused at intake (release-rescue-intake.ts) and the resulting
// limitations are carried on every report (release-rescue-report.ts).

export const RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION = "release-rescue-rubric/v1" as const;

export const RUBRIC_DIMENSIONS = [
  "secrets_and_credentials",
  "authentication_and_session",
  "authorization_and_tenancy",
  "ai_boundary",
  "data_handling_and_retention",
  "input_validation_and_abuse",
  "dependency_and_supply_chain",
  "release_operations",
  "observability_and_incident_response",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];
export const rubricDimensionSchema = z.enum(RUBRIC_DIMENSIONS);

/**
 * What an auditor must point at before a check may be marked `pass`.
 *
 * `reasoned_argument` is deliberately the weakest kind and is never sufficient
 * on its own for a blocking check — see `passRequiresArtifact` below.
 */
export const RUBRIC_EVIDENCE_KINDS = [
  "code_reference",
  "configuration_reference",
  "test_reference",
  "database_policy_reference",
  "dependency_manifest_reference",
  "runtime_observation",
  "reasoned_argument",
] as const;

export type RubricEvidenceKind = (typeof RUBRIC_EVIDENCE_KINDS)[number];
export const rubricEvidenceKindSchema = z.enum(RUBRIC_EVIDENCE_KINDS);

export const RUBRIC_CHECK_OUTCOMES = ["pass", "concern", "fail", "not_applicable", "not_assessed"] as const;
export type RubricCheckOutcome = (typeof RUBRIC_CHECK_OUTCOMES)[number];
export const rubricCheckOutcomeSchema = z.enum(RUBRIC_CHECK_OUTCOMES);

export type RubricCheck = {
  /** Stable across the life of this rubric version. Reports reference it by value. */
  readonly id: string;
  readonly dimension: RubricDimension;
  readonly title: string;
  /** The single question the auditor answers. One question per check, on purpose. */
  readonly question: string;
  /** Evidence kinds that can support an outcome on this check. */
  readonly acceptableEvidence: readonly RubricEvidenceKind[];
  /**
   * A confirmed critical/high finding on a blocking check stops the release
   * verdict. Non-blocking checks still produce findings; they do not stop a
   * release on their own.
   */
  readonly blocking: boolean;
  /** Relative contribution to its dimension's coverage weight. 1 (context) to 3 (core). */
  readonly weight: 1 | 2 | 3;
};

// Weight is coverage weight, not a risk score. It answers "how much of this
// dimension did we actually look at", never "how secure is this app" — a single
// number claiming the latter would be exactly the false precision this offer
// promises not to sell.
export const RELEASE_RESCUE_RUBRIC_V1: readonly RubricCheck[] = [
  {
    id: "secrets.no_secrets_in_version_control",
    dimension: "secrets_and_credentials",
    title: "No live secrets committed to the repository",
    question:
      "Does the repository history or working tree contain live credentials, API keys, private keys, or connection strings?",
    acceptableEvidence: ["code_reference", "configuration_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "secrets.no_secrets_reachable_from_client",
    dimension: "secrets_and_credentials",
    title: "Privileged secrets are not reachable from the client bundle",
    question:
      "Can any privileged key reach the browser through client components, public environment variables, or a response body?",
    acceptableEvidence: ["code_reference", "configuration_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "secrets.scope_and_rotation_path",
    dimension: "secrets_and_credentials",
    title: "Secrets are least-privilege and rotatable",
    question: "Is each secret scoped to what it needs, and is there a documented path to rotate it without downtime?",
    acceptableEvidence: ["configuration_reference", "reasoned_argument"],
    blocking: false,
    weight: 2,
  },
  {
    id: "auth.boundary_is_server_enforced",
    dimension: "authentication_and_session",
    title: "The authentication boundary is enforced server-side",
    question:
      "Is every protected read and mutation re-checked in server code, rather than relying on middleware, routing, or client state?",
    acceptableEvidence: ["code_reference", "test_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "auth.session_integrity",
    dimension: "authentication_and_session",
    title: "Session and token handling is sound",
    question:
      "Are session cookies scoped, flagged, and expired correctly, and is a token rejected once revoked or expired?",
    acceptableEvidence: ["code_reference", "configuration_reference", "test_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "auth.credential_recovery_paths",
    dimension: "authentication_and_session",
    title: "Recovery and invitation flows cannot be abused",
    question:
      "Can password reset, magic link, or invitation flows be replayed, enumerated, or redirected to an attacker-controlled destination?",
    acceptableEvidence: ["code_reference", "test_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "authz.object_level_authorization",
    dimension: "authorization_and_tenancy",
    title: "Object-level authorization is enforced on every access path",
    question:
      "Can a signed-in user read or mutate a record they do not own by changing an identifier in a request?",
    acceptableEvidence: ["code_reference", "database_policy_reference", "test_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "authz.tenant_isolation_at_data_layer",
    dimension: "authorization_and_tenancy",
    title: "Tenant isolation holds at the data layer",
    question:
      "If application code were bypassed, would the database still refuse cross-tenant reads and writes?",
    acceptableEvidence: ["database_policy_reference", "test_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "authz.privileged_role_separation",
    dimension: "authorization_and_tenancy",
    title: "Privileged and customer roles are separated",
    question:
      "Are administrative capabilities gated by a distinct role rather than by a flag a customer-controlled record can set?",
    acceptableEvidence: ["code_reference", "database_policy_reference", "reasoned_argument"],
    blocking: false,
    weight: 2,
  },
  {
    id: "ai.untrusted_input_is_not_authority",
    dimension: "ai_boundary",
    title: "Model-visible content cannot grant authority",
    question:
      "Can text from a document, web page, email, or user message cause the application to take an action it would otherwise refuse?",
    acceptableEvidence: ["code_reference", "test_reference", "runtime_observation"],
    blocking: true,
    weight: 3,
  },
  {
    id: "ai.tool_authority_is_bounded",
    dimension: "ai_boundary",
    title: "Tool and action authority is bounded and explicit",
    question:
      "Is every tool the model can call restricted to a declared action class, with consequential actions requiring human approval?",
    acceptableEvidence: ["code_reference", "configuration_reference", "test_reference"],
    blocking: true,
    weight: 3,
  },
  {
    id: "ai.output_sink_handling",
    dimension: "ai_boundary",
    title: "Model output is treated as untrusted at its sinks",
    question:
      "Is model output escaped, validated, or sandboxed before it reaches HTML, SQL, a shell, a file path, or an outbound request?",
    acceptableEvidence: ["code_reference", "test_reference", "runtime_observation"],
    blocking: true,
    weight: 2,
  },
  {
    id: "ai.cost_and_rate_controls",
    dimension: "ai_boundary",
    title: "Model usage has cost and rate ceilings",
    question:
      "Can an unauthenticated or low-privilege caller drive unbounded model spend or unbounded provider calls?",
    acceptableEvidence: ["code_reference", "configuration_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "data.customer_data_inventory",
    dimension: "data_handling_and_retention",
    title: "Customer data in the critical workflow is inventoried",
    question: "Is it clear what customer data the reviewed workflow stores, where it lives, and who can read it?",
    acceptableEvidence: ["code_reference", "database_policy_reference", "reasoned_argument"],
    blocking: false,
    weight: 2,
  },
  {
    id: "data.retention_and_deletion_path",
    dimension: "data_handling_and_retention",
    title: "Data has a retention limit and a deletion path",
    question: "Is there a defined retention period and a working deletion path for customer data in this workflow?",
    acceptableEvidence: ["code_reference", "configuration_reference", "test_reference"],
    blocking: false,
    weight: 2,
  },
  {
    id: "data.third_party_egress",
    dimension: "data_handling_and_retention",
    title: "Third-party data egress is intentional",
    question:
      "Which third parties receive customer data in this workflow, and is each one intentional, disclosed, and necessary?",
    acceptableEvidence: ["code_reference", "configuration_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "input.boundary_validation",
    dimension: "input_validation_and_abuse",
    title: "External input is validated at the system boundary",
    question:
      "Is every request body, query parameter, webhook, and file upload validated against a schema before use?",
    acceptableEvidence: ["code_reference", "test_reference"],
    blocking: true,
    weight: 2,
  },
  {
    id: "input.abuse_and_rate_limiting",
    dimension: "input_validation_and_abuse",
    title: "Abuse and automation have limits",
    question: "Are there rate limits or abuse controls on the endpoints that cost money, send messages, or create records?",
    acceptableEvidence: ["code_reference", "configuration_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "deps.known_vulnerable_dependencies",
    dimension: "dependency_and_supply_chain",
    title: "No known-vulnerable dependency on a reachable path",
    question:
      "Does the dependency manifest resolve to a version with a known advisory that is reachable from the reviewed workflow?",
    acceptableEvidence: ["dependency_manifest_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "release.environment_separation",
    dimension: "release_operations",
    title: "Production is separated from development and preview",
    question:
      "Do preview, development, and test environments share a database, credential, or provider account with production?",
    acceptableEvidence: ["configuration_reference", "runtime_observation", "reasoned_argument"],
    blocking: true,
    weight: 3,
  },
  {
    id: "release.migration_and_rollback",
    dimension: "release_operations",
    title: "The release can be rolled back",
    question: "If this release fails in production, is there a tested path back that does not lose customer data?",
    acceptableEvidence: ["code_reference", "configuration_reference", "test_reference", "reasoned_argument"],
    blocking: true,
    weight: 2,
  },
  {
    id: "release.configuration_defaults",
    dimension: "release_operations",
    title: "Shipped defaults are safe",
    question:
      "Do debug flags, seeded accounts, permissive CORS, or demo data remain enabled in the production configuration?",
    acceptableEvidence: ["configuration_reference", "code_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "observe.audit_trail_for_sensitive_actions",
    dimension: "observability_and_incident_response",
    title: "Sensitive actions leave an audit trail",
    question:
      "Is there a durable record of who or what performed each consequential action, sufficient to reconstruct an incident?",
    acceptableEvidence: ["code_reference", "database_policy_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
  {
    id: "observe.error_reporting_without_leakage",
    dimension: "observability_and_incident_response",
    title: "Errors and logs do not leak secrets or customer data",
    question: "Do error responses, logs, or third-party monitoring receive secrets, tokens, or customer records?",
    acceptableEvidence: ["code_reference", "configuration_reference", "runtime_observation"],
    blocking: false,
    weight: 2,
  },
] as const;

/**
 * Evidence kinds that do not, on their own, justify a `pass` on a blocking check.
 *
 * A blocking check exists because getting it wrong stops a release. "I read the
 * code and it looked fine" is a judgment, not an artifact, and an AI executor
 * producing that sentence is exactly the self-report this architecture refuses
 * to treat as proof. Passing a blocking check requires something a second
 * person could open and check.
 */
const NON_ARTIFACT_EVIDENCE: ReadonlySet<RubricEvidenceKind> = new Set<RubricEvidenceKind>(["reasoned_argument"]);

export function isArtifactEvidence(kind: RubricEvidenceKind): boolean {
  return !NON_ARTIFACT_EVIDENCE.has(kind);
}

const CHECKS_BY_ID: ReadonlyMap<string, RubricCheck> = new Map(
  RELEASE_RESCUE_RUBRIC_V1.map((check) => [check.id, check]),
);

export const RELEASE_RESCUE_RUBRIC_CHECK_IDS: readonly string[] = RELEASE_RESCUE_RUBRIC_V1.map((check) => check.id);

export function getRubricCheck(checkId: string): RubricCheck | undefined {
  return CHECKS_BY_ID.get(checkId);
}

export function isKnownRubricCheck(checkId: string): boolean {
  return CHECKS_BY_ID.has(checkId);
}

export function blockingCheckIds(): readonly string[] {
  return RELEASE_RESCUE_RUBRIC_V1.filter((check) => check.blocking).map((check) => check.id);
}

export function checksForDimension(dimension: RubricDimension): readonly RubricCheck[] {
  return RELEASE_RESCUE_RUBRIC_V1.filter((check) => check.dimension === dimension);
}

export function totalRubricWeight(): number {
  return RELEASE_RESCUE_RUBRIC_V1.reduce((total, check) => total + check.weight, 0);
}

/**
 * Content hash of the rubric itself, computed at module load from the frozen
 * definition. A report records this value; if the rubric is edited without a
 * version bump, every previously issued report stops matching and the mismatch
 * is visible instead of silent.
 */
export const RELEASE_RESCUE_RUBRIC_V1_HASH: string = sha256Hex({
  schemaVersion: RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION,
  checks: RELEASE_RESCUE_RUBRIC_V1,
});
