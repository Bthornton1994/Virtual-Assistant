import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "@/lib/catalog-evidence-hash";
import {
  RELEASE_RESCUE_RUBRIC_V1,
  type RubricDimension,
} from "@/lib/release-rescue-rubric";
import type {
  FindingExploitability,
  FindingImpact,
  RemediationEffort,
} from "@/lib/release-rescue-findings-model";

// Every word a customer reads, in one file.
//
// THE DECISION THIS IMPLEMENTS. Thirteen independent audits attacked the same
// question from every side: can arbitrary prose written by an executor be made
// safe to put in a paid report? The answer, measured four different ways, is no.
// A value-based detector leaked credentials and bricked correct reports in the
// same commit. A construct rule with an enumerated operator list delivered 346
// of 366 generated credentials through `DB_PASSWORD += "value"`. A construct
// rule with a general bridge delivered 12 of 12 carriers that use no operator at
// all — `DB_PASSWORD is set to <value>` is plain English with nothing to refuse
// — while refusing 15 of 21 sentences an auditor plainly writes.
//
// Any rule keyed on a construct is defeated by prose that has no construct, and
// any rule strict enough to catch prose refuses the sentences the product exists
// to produce. So the owner's decision was to stop trying: an executor no longer
// writes the customer's report. It SELECTS from this catalog.
//
// What that buys, and it is the whole point: a credential cannot appear in a
// finding's prose because no finding has prose. It has a code. The renderer
// looks the code up here. There is no field for a value to travel in, which is
// the same move that removed the source excerpt, applied to the last place
// customer text could still reach.
//
// WHAT AN EXECUTOR STILL CHOOSES, and why each is safe:
//
//   observationCode   one of the codes below                      (enum)
//   confidence        confirmed | likely | possible               (enum)
//   remediationCode   one the observation declares acceptable     (enum)
//   uncertaintyCode   one of the codes below, when not confirmed  (enum)
//   locations         path + line numbers, grammar-bounded        (typed)
//   evidence          kind + path + line numbers                  (typed)
//
// Impact and exploitability are NOT in that list. They used to be executor
// inputs feeding the severity table; they are properties of the observation
// class and now come from this catalog, so two of severity's three inputs are
// fixed by the code the executor picked rather than asserted alongside it.

// --- Remediation -----------------------------------------------------------------

export const REMEDIATION_CODES = [
  "rotate_and_move_to_secret_store",
  "remove_secret_from_history",
  "move_privileged_call_server_side",
  "scope_key_down_and_document_rotation",
  "enforce_auth_check_server_side",
  "shorten_session_lifetime_and_revoke_on_logout",
  "bind_session_to_a_single_device_or_origin",
  "rate_limit_and_expire_recovery_tokens",
  "scope_query_by_authenticated_principal",
  "add_row_level_security_policy",
  "separate_privileged_role_from_customer_role",
  "treat_model_visible_content_as_data",
  "declare_tool_authority_explicitly",
  "escape_or_validate_model_output_at_the_sink",
  "add_usage_ceiling_and_alert",
  "inventory_the_data_the_workflow_touches",
  "add_retention_window_and_deletion_path",
  "make_third_party_egress_explicit_and_documented",
  "validate_input_at_the_boundary_with_a_schema",
  "add_abuse_and_rate_limits",
  "upgrade_or_replace_the_dependency",
  "separate_production_from_preview_credentials",
  "add_a_tested_rollback_path",
  "change_the_shipped_default_to_the_safe_value",
  "record_sensitive_actions_in_an_audit_trail",
  "strip_secrets_and_customer_data_from_logs",
  "add_an_automated_test_for_the_critical_workflow",
  "handle_the_failure_path_explicitly",
  "enforce_type_and_lint_checks_in_ci",
  "document_local_setup_and_verification",
  "document_known_limits_and_the_on_call_path",
  "make_the_workflow_keyboard_operable",
  "give_every_control_a_name_role_and_announced_error",
  "meet_contrast_and_honour_reduced_motion",
] as const;

export type RemediationCode = (typeof REMEDIATION_CODES)[number];

export type RemediationEntry = {
  readonly code: RemediationCode;
  /** Customer-facing. The only place this sentence exists. */
  readonly text: string;
  readonly effort: RemediationEffort;
  /** Whether the separate remediation sprint would cover it. Commercial, not technical. */
  readonly inSprintScope: boolean;
};

export const REMEDIATION_CATALOG: Readonly<Record<RemediationCode, RemediationEntry>> = {
  rotate_and_move_to_secret_store: {
    code: "rotate_and_move_to_secret_store",
    text: "Treat the value as compromised and rotate it, then read it from your platform's secret store at runtime instead of from a committed file.",
    effort: "small",
    inSprintScope: true,
  },
  remove_secret_from_history: {
    code: "remove_secret_from_history",
    text: "Rotate the value first, then remove it from the repository history. Rotation is what makes the old value harmless; history rewriting on its own does not, because clones already exist.",
    effort: "medium",
    inSprintScope: true,
  },
  move_privileged_call_server_side: {
    code: "move_privileged_call_server_side",
    text: "Move the privileged call to a server route and give the browser only the result. A key shipped to the client is public however it is obfuscated.",
    effort: "medium",
    inSprintScope: true,
  },
  scope_key_down_and_document_rotation: {
    code: "scope_key_down_and_document_rotation",
    text: "Reissue the key with only the permissions this workflow needs, and write down who rotates it and how often.",
    effort: "small",
    inSprintScope: true,
  },
  enforce_auth_check_server_side: {
    code: "enforce_auth_check_server_side",
    text: "Perform the authentication check on the server for every request that reaches this path. A check that runs only in the browser is a display choice, not a boundary.",
    effort: "medium",
    inSprintScope: true,
  },
  shorten_session_lifetime_and_revoke_on_logout: {
    code: "shorten_session_lifetime_and_revoke_on_logout",
    text: "Give the session a bounded lifetime and invalidate it server-side on logout, so signing out ends access rather than only clearing the browser.",
    effort: "small",
    inSprintScope: true,
  },
  bind_session_to_a_single_device_or_origin: {
    code: "bind_session_to_a_single_device_or_origin",
    text: "Bind the session to the origin it was issued for and reject it elsewhere.",
    effort: "medium",
    inSprintScope: true,
  },
  rate_limit_and_expire_recovery_tokens: {
    code: "rate_limit_and_expire_recovery_tokens",
    text: "Make recovery and invitation tokens single-use and short-lived, and rate-limit the endpoint that issues them.",
    effort: "small",
    inSprintScope: true,
  },
  scope_query_by_authenticated_principal: {
    code: "scope_query_by_authenticated_principal",
    text: "Scope the lookup by the authenticated caller, so an identifier from the request cannot select a record the caller does not own.",
    effort: "small",
    inSprintScope: true,
  },
  add_row_level_security_policy: {
    code: "add_row_level_security_policy",
    text: "Enforce the tenant boundary in the database with a row-level policy, so an application mistake cannot cross it on its own.",
    effort: "medium",
    inSprintScope: true,
  },
  separate_privileged_role_from_customer_role: {
    code: "separate_privileged_role_from_customer_role",
    text: "Give staff and customer access separate roles, and check the role on the server at each privileged action.",
    effort: "medium",
    inSprintScope: true,
  },
  treat_model_visible_content_as_data: {
    code: "treat_model_visible_content_as_data",
    text: "Treat everything the model reads as data rather than instruction, and take authority decisions in code outside the model's reach.",
    effort: "large",
    inSprintScope: false,
  },
  declare_tool_authority_explicitly: {
    code: "declare_tool_authority_explicitly",
    text: "Declare, per tool, what it may do and what it may never do, and enforce that list outside the model.",
    effort: "medium",
    inSprintScope: true,
  },
  escape_or_validate_model_output_at_the_sink: {
    code: "escape_or_validate_model_output_at_the_sink",
    text: "Validate or escape model output where it is used, on the same terms as any other untrusted input.",
    effort: "small",
    inSprintScope: true,
  },
  add_usage_ceiling_and_alert: {
    code: "add_usage_ceiling_and_alert",
    text: "Put a per-account and per-period ceiling on model usage, and alert before the ceiling rather than after the invoice.",
    effort: "small",
    inSprintScope: true,
  },
  inventory_the_data_the_workflow_touches: {
    code: "inventory_the_data_the_workflow_touches",
    text: "Write down which customer data this workflow reads, writes and sends onward. The inventory is what makes the remaining data questions answerable.",
    effort: "small",
    inSprintScope: true,
  },
  add_retention_window_and_deletion_path: {
    code: "add_retention_window_and_deletion_path",
    text: "Give the data a retention window and an executable deletion path, and test that the path actually clears the content.",
    effort: "medium",
    inSprintScope: true,
  },
  make_third_party_egress_explicit_and_documented: {
    code: "make_third_party_egress_explicit_and_documented",
    text: "List every third party this workflow sends customer data to, and confirm each one is intended.",
    effort: "small",
    inSprintScope: true,
  },
  validate_input_at_the_boundary_with_a_schema: {
    code: "validate_input_at_the_boundary_with_a_schema",
    text: "Validate the request against a schema at the boundary and reject what does not match, rather than repairing it downstream.",
    effort: "small",
    inSprintScope: true,
  },
  add_abuse_and_rate_limits: {
    code: "add_abuse_and_rate_limits",
    text: "Add a rate limit on this endpoint, keyed by account and by source, before release rather than after the first incident.",
    effort: "small",
    inSprintScope: true,
  },
  upgrade_or_replace_the_dependency: {
    code: "upgrade_or_replace_the_dependency",
    text: "Upgrade the dependency to a version without the known advisory, or replace it if no fixed version exists.",
    effort: "small",
    inSprintScope: true,
  },
  separate_production_from_preview_credentials: {
    code: "separate_production_from_preview_credentials",
    text: "Give preview and development environments their own credentials and their own data, so a preview cannot reach production.",
    effort: "medium",
    inSprintScope: true,
  },
  add_a_tested_rollback_path: {
    code: "add_a_tested_rollback_path",
    text: "Write down the rollback steps and run them once against a copy, so release day is not the first attempt.",
    effort: "medium",
    inSprintScope: true,
  },
  change_the_shipped_default_to_the_safe_value: {
    code: "change_the_shipped_default_to_the_safe_value",
    text: "Change the shipped default to the safe value, so an operator has to opt into the risky one deliberately.",
    effort: "trivial",
    inSprintScope: true,
  },
  record_sensitive_actions_in_an_audit_trail: {
    code: "record_sensitive_actions_in_an_audit_trail",
    text: "Record who did what and when for sensitive actions, in a place an operator can read after an incident.",
    effort: "medium",
    inSprintScope: true,
  },
  strip_secrets_and_customer_data_from_logs: {
    code: "strip_secrets_and_customer_data_from_logs",
    text: "Remove credentials and customer data from log and error output before it leaves the process.",
    effort: "small",
    inSprintScope: true,
  },
  add_an_automated_test_for_the_critical_workflow: {
    code: "add_an_automated_test_for_the_critical_workflow",
    text: "Add an automated test that exercises the critical workflow end to end, so a regression fails the build rather than the customer.",
    effort: "medium",
    inSprintScope: true,
  },
  handle_the_failure_path_explicitly: {
    code: "handle_the_failure_path_explicitly",
    text: "Handle the failure explicitly and decide what the user sees, rather than letting the error surface as it is.",
    effort: "small",
    inSprintScope: true,
  },
  enforce_type_and_lint_checks_in_ci: {
    code: "enforce_type_and_lint_checks_in_ci",
    text: "Run the type and lint checks in the pipeline and fail the build on error, so the configuration is enforced rather than merely present.",
    effort: "trivial",
    inSprintScope: true,
  },
  document_local_setup_and_verification: {
    code: "document_local_setup_and_verification",
    text: "Write the steps to run and verify the application locally, and have someone who has not done it before follow them once.",
    effort: "small",
    inSprintScope: true,
  },
  document_known_limits_and_the_on_call_path: {
    code: "document_known_limits_and_the_on_call_path",
    text: "Write down the known limits and who to contact when this breaks, where an operator will find it during an incident.",
    effort: "trivial",
    inSprintScope: true,
  },
  make_the_workflow_keyboard_operable: {
    code: "make_the_workflow_keyboard_operable",
    text: "Make every step of the workflow reachable and completable with a keyboard alone, with focus visible at each step and no element that traps it.",
    effort: "medium",
    inSprintScope: true,
  },
  give_every_control_a_name_role_and_announced_error: {
    code: "give_every_control_a_name_role_and_announced_error",
    text: "Give each control an accessible name and the correct role, and announce validation errors to assistive technology rather than showing them only in colour or position.",
    effort: "medium",
    inSprintScope: true,
  },
  meet_contrast_and_honour_reduced_motion: {
    code: "meet_contrast_and_honour_reduced_motion",
    text: "Bring text and interface contrast up to the required ratio, and honour the reduced-motion preference for any animation in the workflow.",
    effort: "small",
    inSprintScope: true,
  },
};

// --- Residual uncertainty --------------------------------------------------------

export const UNCERTAINTY_CODES = [
  "static_read_only_no_runtime_confirmation",
  "configuration_not_visible_in_the_snapshot",
  "behaviour_depends_on_deployment_settings",
  "third_party_behaviour_not_observable",
  "path_reachable_only_under_conditions_not_tested",
  "partial_coverage_of_a_large_surface",
] as const;

export type UncertaintyCode = (typeof UNCERTAINTY_CODES)[number];

export const UNCERTAINTY_CATALOG: Readonly<Record<UncertaintyCode, string>> = {
  static_read_only_no_runtime_confirmation:
    "This review read the source and did not exercise a running system, so the behaviour was inferred from the code rather than observed.",
  configuration_not_visible_in_the_snapshot:
    "The deployed configuration was not part of the reviewed snapshot, so the value in use at release could differ.",
  behaviour_depends_on_deployment_settings:
    "What happens here depends on settings applied at deployment, which this review could not see.",
  third_party_behaviour_not_observable:
    "This depends on how a third-party service behaves, which could not be confirmed from the repository.",
  path_reachable_only_under_conditions_not_tested:
    "The path appears reachable only under conditions this review did not exercise.",
  partial_coverage_of_a_large_surface:
    "The surface is larger than one fixed-price review covers, so this describes what was examined and not the whole of it.",
};

// --- Assessment rationale --------------------------------------------------------

export const ASSESSMENT_RATIONALE_CODES = [
  "controls_present_and_evidenced",
  "control_present_but_not_enforced",
  "control_missing_on_a_reachable_path",
  "partial_control_with_a_gap",
  "not_applicable_to_this_application",
  "not_assessed_outside_agreed_scope",
  "not_assessed_snapshot_lacked_the_evidence",
  "not_assessed_automated_check_found_no_instance",
  "not_assessed_automated_check_could_not_read_everything",
  "not_assessed_requires_a_reviewers_reading",
] as const;

export type AssessmentRationaleCode = (typeof ASSESSMENT_RATIONALE_CODES)[number];

export type RationaleEntry = {
  readonly code: AssessmentRationaleCode;
  readonly text: string;
  /** The outcomes this rationale may accompany. Checked by the validator. */
  readonly outcomes: readonly ("pass" | "concern" | "fail" | "not_applicable" | "not_assessed")[];
};

export const ASSESSMENT_RATIONALE_CATALOG: Readonly<
  Record<AssessmentRationaleCode, RationaleEntry>
> = {
  controls_present_and_evidenced: {
    code: "controls_present_and_evidenced",
    text: "The control this check asks about is present, and the cited evidence shows it applying on the reviewed path.",
    outcomes: ["pass"],
  },
  control_present_but_not_enforced: {
    code: "control_present_but_not_enforced",
    text: "The control exists but is not enforced where it needs to be, so it does not hold on the reviewed path.",
    outcomes: ["concern", "fail"],
  },
  control_missing_on_a_reachable_path: {
    code: "control_missing_on_a_reachable_path",
    text: "The control this check asks about is absent on a path the critical workflow reaches.",
    outcomes: ["fail"],
  },
  partial_control_with_a_gap: {
    code: "partial_control_with_a_gap",
    text: "The control covers part of the surface and leaves an identified gap.",
    outcomes: ["concern"],
  },
  not_applicable_to_this_application: {
    code: "not_applicable_to_this_application",
    text: "This check does not apply to the application and workflow in scope.",
    outcomes: ["not_applicable"],
  },
  not_assessed_outside_agreed_scope: {
    code: "not_assessed_outside_agreed_scope",
    text: "This check was not assessed because it falls outside the scope agreed at intake.",
    outcomes: ["not_assessed"],
  },
  not_assessed_snapshot_lacked_the_evidence: {
    code: "not_assessed_snapshot_lacked_the_evidence",
    text: "This check was not assessed because the reviewed snapshot did not contain the evidence it needs.",
    outcomes: ["not_assessed"],
  },
  // The three below are what an automated-only run says about a check it did
  // not assess. They exist so that "not run" is a stated reason rather than a
  // borrowed one: none of the older codes described an automated check that
  // ran and found nothing, and borrowing one would misstate why.
  not_assessed_automated_check_found_no_instance: {
    code: "not_assessed_automated_check_found_no_instance",
    text: "An automated check read every file it covers in the reviewed snapshot and recorded no instance of this problem. An automated check finding nothing does not show the control holds, so this check is left for a reviewer to assess.",
    outcomes: ["not_assessed"],
  },
  not_assessed_automated_check_could_not_read_everything: {
    code: "not_assessed_automated_check_could_not_read_everything",
    text: "An automated check for this ran but could not read every file it covers, so this check was not assessed.",
    outcomes: ["not_assessed"],
  },
  not_assessed_requires_a_reviewers_reading: {
    code: "not_assessed_requires_a_reviewers_reading",
    text: "This check needs a reviewer to read and judge the code, and that was not done in this review.",
    outcomes: ["not_assessed"],
  },
};

// --- Observations ----------------------------------------------------------------

/**
 * Every observation code, as a literal tuple.
 *
 * Declared here rather than derived from `ENTRIES` because the derivation
 * produced `readonly string[]`, and an audit measured what that cost. A
 * `readonly string[]` cannot be handed to `z.enum`, so every call site carried
 * `as [string, ...string[]]` — and that cast makes the schema's INFERRED TYPE
 * plain `string`. The type system then constrained nothing: `composeFinding`
 * accepted an arbitrary sentence as a code, `tsc` was happy, and the sentence
 * rendered verbatim in the customer's report.
 *
 * A literal tuple gives `z.enum` a real union, which removes the cast, which
 * makes the compiler refuse the call. `codesMatchEntries` below asserts this
 * list and `ENTRIES` stay in step, so the explicitness costs nothing in safety.
 */
export const OBSERVATION_CODES = [
  "secrets.literal_credential_in_repository",
  "secrets.credential_in_repository_history",
  "secrets.privileged_key_reaches_the_client",
  "secrets.key_is_broader_than_the_workflow_needs",
  "secrets.no_rotation_path_recorded",
  "auth.check_runs_only_in_the_client",
  "auth.route_reachable_without_authentication",
  "auth.session_does_not_end_on_logout",
  "auth.session_lifetime_is_unbounded",
  "auth.recovery_token_is_reusable_or_long_lived",
  "auth.recovery_endpoint_is_not_rate_limited",
  "authz.record_lookup_is_not_scoped_to_the_caller",
  "authz.mutation_is_not_scoped_to_the_caller",
  "authz.tenant_boundary_is_application_only",
  "authz.staff_and_customer_share_a_role",
  "ai.model_visible_content_can_grant_authority",
  "ai.tool_authority_is_not_declared",
  "ai.model_output_is_trusted_at_its_sink",
  "ai.no_usage_ceiling",
  "data.workflow_data_is_not_inventoried",
  "data.no_retention_limit_or_deletion_path",
  "data.undocumented_third_party_egress",
  "input.boundary_accepts_unvalidated_request",
  "input.no_abuse_or_rate_limit",
  "deps.known_vulnerable_dependency_on_a_reachable_path",
  "release.preview_shares_production_credentials",
  "release.no_tested_rollback_path",
  "release.unsafe_shipped_default",
  "observe.sensitive_action_leaves_no_trail",
  "observe.logs_carry_secrets_or_customer_data",
  "quality.critical_workflow_has_no_automated_test",
  "quality.failure_path_is_unhandled",
  "quality.type_or_lint_checks_are_not_enforced",
  "docs.cannot_run_and_verify_locally",
  "docs.no_known_limits_or_on_call_path",
  "a11y.workflow_cannot_be_completed_by_keyboard",
  "a11y.controls_lack_names_roles_or_announced_errors",
  "a11y.contrast_or_motion_preferences_are_not_respected",
] as const;

export type ObservationCode = (typeof OBSERVATION_CODES)[number];

export type ObservationEntry = {
  readonly code: ObservationCode;
  readonly checkId: string;
  readonly dimension: RubricDimension;
  /**
   * Fixed by the catalog, not asserted by the executor.
   *
   * These are properties of the observation CLASS. An executor that could assert
   * them alongside the code could move severity without changing what it claims
   * to have seen, which is the inflation the derived-severity model exists to
   * stop. Two of severity's three inputs now come from the code itself.
   */
  readonly impact: FindingImpact;
  readonly exploitability: FindingExploitability;
  /** The customer-facing headline. */
  readonly title: string;
  /** What the review found, as a class. The location says where. */
  readonly whatWeObserved: string;
  /** Why it matters for a release, in this application's terms. */
  readonly whyItMatters: string;
  /** Remediations an executor may select for this observation. */
  readonly remediationCodes: readonly RemediationCode[];
};

function entry(
  code: ObservationCode,
  checkId: string,
  impact: FindingImpact,
  exploitability: FindingExploitability,
  title: string,
  whatWeObserved: string,
  whyItMatters: string,
  remediationCodes: readonly RemediationCode[],
): ObservationEntry {
  const check = RELEASE_RESCUE_RUBRIC_V1.find((candidate) => candidate.id === checkId);
  if (!check) throw new Error(`Observation ${code} references unknown rubric check ${checkId}.`);
  return {
    code,
    checkId,
    dimension: check.dimension,
    impact,
    exploitability,
    title,
    whatWeObserved,
    whyItMatters,
    remediationCodes,
  };
}

const ENTRIES: readonly ObservationEntry[] = [
  // --- secrets ---
  entry(
    "secrets.literal_credential_in_repository",
    "secrets.no_secrets_in_version_control",
    "severe",
    "remote_unauthenticated",
    "A live credential is committed to the repository",
    "A file in the reviewed snapshot assigns a credential a literal value. The location below is where it is; open it in your own checkout to see which value.",
    "Anyone who can read the repository has that credential, including every past collaborator and anyone who obtains a clone. Rotating it is the only action that makes the exposure stop.",
    ["rotate_and_move_to_secret_store", "remove_secret_from_history"],
  ),
  entry(
    "secrets.credential_in_repository_history",
    "secrets.no_secrets_in_version_control",
    "serious",
    "requires_privilege",
    "A credential appears in the repository history",
    "A credential value appears in the history of the reviewed snapshot even though the current working tree no longer contains it.",
    "Removing a value from the current files does not remove it from clones that already exist. Until it is rotated, the old value still works.",
    ["remove_secret_from_history", "rotate_and_move_to_secret_store"],
  ),
  entry(
    "secrets.privileged_key_reaches_the_client",
    "secrets.no_secrets_reachable_from_client",
    "severe",
    "remote_unauthenticated",
    "A privileged key is reachable from the browser",
    "A key with privileges beyond the signed-in user is exposed to client-side code in the reviewed snapshot.",
    "Anything shipped to a browser is readable by whoever opens it. A privileged key there is a public key with private permissions.",
    ["move_privileged_call_server_side", "scope_key_down_and_document_rotation"],
  ),
  entry(
    "secrets.key_is_broader_than_the_workflow_needs",
    "secrets.scope_and_rotation_path",
    "serious",
    "requires_privilege",
    "A key carries more permission than this workflow needs",
    "A key used by the critical workflow holds permissions the workflow does not exercise.",
    "The blast radius of a leaked key is whatever it is allowed to do. Scoping it down shrinks the damage before the leak rather than after.",
    ["scope_key_down_and_document_rotation"],
  ),
  entry(
    "secrets.no_rotation_path_recorded",
    "secrets.scope_and_rotation_path",
    "limited",
    "requires_privilege",
    "No rotation path is written down for this credential",
    "The reviewed snapshot records no owner or procedure for rotating this credential.",
    "A credential nobody owns is a credential nobody rotates, including on the day it has to be rotated urgently.",
    ["scope_key_down_and_document_rotation", "document_known_limits_and_the_on_call_path"],
  ),

  // --- authentication ---
  entry(
    "auth.check_runs_only_in_the_client",
    "auth.boundary_is_server_enforced",
    "severe",
    "remote_unauthenticated",
    "The authentication check runs only in the browser",
    "The path below decides access in client-side code, and the server accepts the request without repeating the check.",
    "A check that runs in the browser can be skipped by anyone who sends the request directly. It shapes what the interface offers, not what the system allows.",
    ["enforce_auth_check_server_side"],
  ),
  entry(
    "auth.route_reachable_without_authentication",
    "auth.boundary_is_server_enforced",
    "severe",
    "remote_unauthenticated",
    "A route that handles customer data is reachable without signing in",
    "The path below serves or accepts customer data and does not require an authenticated caller.",
    "An unauthenticated path into customer data is reachable by anyone who finds the URL, and URLs are found.",
    ["enforce_auth_check_server_side"],
  ),
  entry(
    "auth.session_does_not_end_on_logout",
    "auth.session_integrity",
    "serious",
    "requires_user_interaction",
    "Signing out does not end the session",
    "Logout clears client-side state in the reviewed snapshot without invalidating the session on the server.",
    "A session that survives logout still works from anywhere it was copied, which is the case that matters on a shared or stolen device.",
    ["shorten_session_lifetime_and_revoke_on_logout"],
  ),
  entry(
    "auth.session_lifetime_is_unbounded",
    "auth.session_integrity",
    "serious",
    "requires_privilege",
    "Sessions do not expire",
    "The reviewed snapshot issues sessions without a bounded lifetime.",
    "A session that never expires turns a single moment of exposure into permanent access.",
    ["shorten_session_lifetime_and_revoke_on_logout", "bind_session_to_a_single_device_or_origin"],
  ),
  entry(
    "auth.recovery_token_is_reusable_or_long_lived",
    "auth.credential_recovery_paths",
    "severe",
    "remote_unauthenticated",
    "A recovery link can be reused or does not expire",
    "The recovery or invitation flow below issues a token that is not single-use, or that does not expire promptly.",
    "A recovery link is a credential. One that can be replayed is an account takeover for anyone who reaches it, including in a forwarded email.",
    ["rate_limit_and_expire_recovery_tokens"],
  ),
  entry(
    "auth.recovery_endpoint_is_not_rate_limited",
    "auth.credential_recovery_paths",
    "serious",
    "remote_unauthenticated",
    "The recovery endpoint has no rate limit",
    "The endpoint that issues recovery or invitation messages accepts unlimited requests in the reviewed snapshot.",
    "Without a limit the endpoint can be used to enumerate accounts or to flood a customer's inbox from your domain.",
    ["add_abuse_and_rate_limits", "rate_limit_and_expire_recovery_tokens"],
  ),

  // --- authorization ---
  entry(
    "authz.record_lookup_is_not_scoped_to_the_caller",
    "authz.object_level_authorization",
    "severe",
    "requires_privilege",
    "A record is loaded by identifier without checking who is asking",
    "The path below selects a record using an identifier taken from the request, without restricting the query to the authenticated caller.",
    "Any signed-in customer who changes the identifier reads another customer's record. This is the most common way customer data leaves a young application.",
    ["scope_query_by_authenticated_principal", "add_row_level_security_policy"],
  ),
  entry(
    "authz.mutation_is_not_scoped_to_the_caller",
    "authz.object_level_authorization",
    "severe",
    "requires_privilege",
    "A record is modified by identifier without checking who is asking",
    "The path below updates or deletes a record selected by an identifier from the request, without restricting it to the authenticated caller.",
    "A customer can change or destroy another customer's data, and the damage is not reversible by reading alone.",
    ["scope_query_by_authenticated_principal", "add_row_level_security_policy"],
  ),
  entry(
    "authz.tenant_boundary_is_application_only",
    "authz.tenant_isolation_at_data_layer",
    "severe",
    "requires_privilege",
    "The tenant boundary exists only in application code",
    "Tenant separation in the reviewed snapshot is enforced by application queries, with no policy at the data layer behind it.",
    "One missed filter in one query crosses the boundary. A data-layer policy is what makes that mistake fail instead of leak.",
    ["add_row_level_security_policy"],
  ),
  entry(
    "authz.staff_and_customer_share_a_role",
    "authz.privileged_role_separation",
    "serious",
    "requires_privilege",
    "Staff and customer access share one role",
    "The reviewed snapshot does not separate privileged staff access from customer access.",
    "Every customer account becomes a potential staff account, and an ordinary account compromise becomes an administrative one.",
    ["separate_privileged_role_from_customer_role"],
  ),

  // --- ai boundary ---
  entry(
    "ai.model_visible_content_can_grant_authority",
    "ai.untrusted_input_is_not_authority",
    "severe",
    "remote_unauthenticated",
    "Text the model reads can change what the system does",
    "Content the model reads in the reviewed snapshot can influence an authority decision rather than only the words it produces.",
    "Anyone who can put text where the model reads it can steer the system. Instructions arriving as data must not become authority.",
    ["treat_model_visible_content_as_data", "declare_tool_authority_explicitly"],
  ),
  entry(
    "ai.tool_authority_is_not_declared",
    "ai.tool_authority_is_bounded",
    "severe",
    "requires_user_interaction",
    "A tool the model can call has no declared limit",
    "A tool reachable by the model has no explicit statement of what it may and may not do, enforced outside the model.",
    "An undeclared limit is not a limit. The model decides, and the model can be steered by whatever it reads.",
    ["declare_tool_authority_explicitly", "treat_model_visible_content_as_data"],
  ),
  entry(
    "ai.model_output_is_trusted_at_its_sink",
    "ai.output_sink_handling",
    "serious",
    "remote_unauthenticated",
    "Model output is used without validation where it lands",
    "Model output reaches a sink in the reviewed snapshot without being escaped or validated first.",
    "Model output is untrusted input that happens to come from your own system. Where it lands decides what a crafted response can do.",
    ["escape_or_validate_model_output_at_the_sink", "validate_input_at_the_boundary_with_a_schema"],
  ),
  entry(
    "ai.no_usage_ceiling",
    "ai.cost_and_rate_controls",
    "serious",
    "remote_unauthenticated",
    "Model usage has no ceiling",
    "The reviewed snapshot places no per-account or per-period limit on model usage.",
    "Without a ceiling, one loop or one abusive account turns into an invoice you find out about after it is due.",
    ["add_usage_ceiling_and_alert", "add_abuse_and_rate_limits"],
  ),

  // --- data ---
  entry(
    "data.workflow_data_is_not_inventoried",
    "data.customer_data_inventory",
    "limited",
    "requires_privilege",
    "The customer data this workflow touches is not written down",
    "The reviewed snapshot contains no inventory of the customer data the critical workflow reads, writes or sends onward.",
    "Retention, deletion and breach questions all start with knowing what you hold. Without the inventory none of them has an answer.",
    ["inventory_the_data_the_workflow_touches"],
  ),
  entry(
    "data.no_retention_limit_or_deletion_path",
    "data.retention_and_deletion_path",
    "serious",
    "requires_privilege",
    "Customer data has no retention limit and no deletion path",
    "Data the workflow stores has no expiry and no executable path to delete it on request.",
    "Data kept forever is data still exposed by a breach years later, and a deletion request you cannot execute is a commitment you cannot keep.",
    ["add_retention_window_and_deletion_path", "inventory_the_data_the_workflow_touches"],
  ),
  entry(
    "data.undocumented_third_party_egress",
    "data.third_party_egress",
    "serious",
    "requires_privilege",
    "Customer data is sent to a third party that is not documented",
    "The critical workflow sends customer data to an external service that the reviewed snapshot does not record as intended.",
    "Data leaving to a party nobody listed is a party nobody reviewed, and it is the hardest kind of exposure to notice.",
    ["make_third_party_egress_explicit_and_documented", "inventory_the_data_the_workflow_touches"],
  ),

  // --- input ---
  entry(
    "input.boundary_accepts_unvalidated_request",
    "input.boundary_validation",
    "serious",
    "remote_unauthenticated",
    "A boundary accepts a request without validating it",
    "The path below reads request data and uses it without validating the shape first.",
    "Unvalidated input reaches logic that assumed it was well formed, and the failure shows up somewhere the cause is no longer visible.",
    ["validate_input_at_the_boundary_with_a_schema"],
  ),
  entry(
    "input.no_abuse_or_rate_limit",
    "input.abuse_and_rate_limiting",
    "serious",
    "remote_unauthenticated",
    "An exposed endpoint has no abuse or rate limit",
    "The endpoint below is reachable without a limit on how often it may be called.",
    "The first automated abuse arrives before the first customer complaint, and an unlimited endpoint is the cheapest thing to abuse.",
    ["add_abuse_and_rate_limits"],
  ),

  // --- dependencies ---
  entry(
    "deps.known_vulnerable_dependency_on_a_reachable_path",
    "deps.known_vulnerable_dependencies",
    "serious",
    "remote_unauthenticated",
    "A dependency with a known advisory is on a reachable path",
    "A dependency in the reviewed manifest has a published advisory and is reachable from the critical workflow.",
    "A published advisory is a public instruction for exploiting it. Reachability is what turns it from noise into exposure.",
    ["upgrade_or_replace_the_dependency"],
  ),

  // --- release ---
  entry(
    "release.preview_shares_production_credentials",
    "release.environment_separation",
    "severe",
    "requires_privilege",
    "Preview or development shares production credentials",
    "The reviewed snapshot uses the same credentials or data store for production and for a non-production environment.",
    "A preview deployment is the least guarded thing you run. Sharing production credentials with it makes it the way in.",
    ["separate_production_from_preview_credentials"],
  ),
  entry(
    "release.no_tested_rollback_path",
    "release.migration_and_rollback",
    "serious",
    "requires_privilege",
    "There is no tested way to roll back",
    "The reviewed snapshot records no rollback procedure for the release, or none that has been exercised.",
    "Release day is a bad time to discover the rollback does not work, and a migration without one is a one-way door.",
    ["add_a_tested_rollback_path"],
  ),
  entry(
    "release.unsafe_shipped_default",
    "release.configuration_defaults",
    "serious",
    "remote_unauthenticated",
    "A shipped default is not the safe value",
    "A configuration value below ships with a default that is permissive rather than safe.",
    "Defaults decide what happens on every deployment nobody configured, which over time is most of them.",
    ["change_the_shipped_default_to_the_safe_value"],
  ),

  // --- observability ---
  entry(
    "observe.sensitive_action_leaves_no_trail",
    "observe.audit_trail_for_sensitive_actions",
    "limited",
    "requires_privilege",
    "A sensitive action leaves no audit trail",
    "The action below changes access, money or customer data and records no durable account of who did it and when.",
    "Without a trail you cannot answer what happened during an incident, and that question is always asked.",
    ["record_sensitive_actions_in_an_audit_trail"],
  ),
  entry(
    "observe.logs_carry_secrets_or_customer_data",
    "observe.error_reporting_without_leakage",
    "serious",
    "requires_privilege",
    "Logs or errors carry secrets or customer data",
    "Log or error output in the reviewed snapshot includes credential material or customer data.",
    "Logs travel further than the systems that wrote them, into third-party tools and support tickets, and they are rarely deleted.",
    ["strip_secrets_and_customer_data_from_logs"],
  ),

  // --- quality ---
  entry(
    "quality.critical_workflow_has_no_automated_test",
    "quality.tests_cover_the_critical_workflow",
    "serious",
    "requires_privilege",
    "The critical workflow has no automated test",
    "No automated test in the reviewed snapshot exercises the workflow named in scope end to end.",
    "The one path that must not fail on release day is the one with nothing watching it, so a regression reaches the customer first.",
    ["add_an_automated_test_for_the_critical_workflow"],
  ),
  entry(
    "quality.failure_path_is_unhandled",
    "quality.error_handling_on_the_critical_path",
    "serious",
    "requires_user_interaction",
    "A failure on the critical path is not handled",
    "The path below can fail in a way the surrounding code does not handle.",
    "An unhandled failure on the critical path decides for you what the customer sees, usually at the worst moment.",
    ["handle_the_failure_path_explicitly"],
  ),
  entry(
    "quality.type_or_lint_checks_are_not_enforced",
    "quality.type_and_lint_discipline",
    "limited",
    "requires_privilege",
    "Type or lint checks are configured but not enforced",
    "The reviewed snapshot configures type or lint checking without failing the build when it reports an error.",
    "A check that cannot fail the build is documentation. The errors accumulate until nobody reads the output.",
    ["enforce_type_and_lint_checks_in_ci"],
  ),

  // --- documentation ---
  entry(
    "docs.cannot_run_and_verify_locally",
    "docs.run_and_verify_locally",
    "limited",
    "requires_privilege",
    "A new engineer cannot run and verify the application",
    "The reviewed snapshot does not contain steps sufficient to run the application locally and confirm it works.",
    "Every incident response and every handover starts here. Without it the only person who can fix this is the person who built it.",
    ["document_local_setup_and_verification"],
  ),
  entry(
    "docs.no_known_limits_or_on_call_path",
    "docs.known_limits_and_operational_contacts",
    "limited",
    "requires_privilege",
    "Known limits and the on-call path are not written down",
    "The reviewed snapshot records no known operational limits and no contact path for when the application breaks.",
    "During an incident nobody reads code to find out who to call. What is not written down is not available when it is needed.",
    ["document_known_limits_and_the_on_call_path"],
  ),

  // --- accessibility ---
  //
  // These three exist because a property test asked a question nobody had asked:
  // can an auditor report a failure of every rubric check? Three accessibility
  // checks had no observation, which under the old contract was invisible — an
  // auditor simply wrote a sentence. Under Option 1 it would have meant the
  // finding could not be reported at all, so a gap in the catalog is now a
  // failing test rather than a silent limit on what the product can say.
  entry(
    "a11y.workflow_cannot_be_completed_by_keyboard",
    "a11y.keyboard_and_focus",
    "limited",
    "requires_user_interaction",
    "The workflow cannot be completed with a keyboard",
    "The reviewed snapshot contains a step in the critical workflow that cannot be reached or completed with a keyboard alone, or that loses or traps focus.",
    "Anyone who does not use a mouse cannot finish the workflow. It is also the first thing an accessibility complaint names.",
    ["make_the_workflow_keyboard_operable"],
  ),
  entry(
    "a11y.controls_lack_names_roles_or_announced_errors",
    "a11y.semantics_and_labels",
    "limited",
    "requires_user_interaction",
    "Controls have no accessible name, role, or announced error",
    "The reviewed snapshot contains controls in the critical workflow without an accessible name or correct role, or errors that are shown visually without being announced.",
    "A screen reader reports what the markup says, not what the design intended. An unnamed control is an unusable one, and an unannounced error is an invisible one.",
    ["give_every_control_a_name_role_and_announced_error"],
  ),
  entry(
    "a11y.contrast_or_motion_preferences_are_not_respected",
    "a11y.contrast_and_motion",
    "limited",
    "requires_user_interaction",
    "Contrast is below requirement or reduced-motion is ignored",
    "The reviewed snapshot contains text or interface elements below the required contrast ratio, or animation that runs regardless of the reduced-motion preference.",
    "Low contrast excludes people with ordinary vision differences, and unrequested motion can cause real physical symptoms.",
    ["meet_contrast_and_honour_reduced_motion"],
  ),
];

// --- Clearance reasons ----------------------------------------------------------

/**
 * Why a named manager cleared a held item.
 *
 * Stored on the report, so it is a delivered field and takes the same treatment
 * as every other one: a code, not a note. The accountability is unchanged — a
 * named human still has to record a decision before a held report moves — and
 * what changes is that their keystrokes do not become report content.
 */
export const CLEARANCE_REASON_CODES = [
  "value_is_a_placeholder_not_a_credential",
  "value_is_a_documented_example",
  "value_was_already_rotated_and_is_dead",
  "text_is_product_vocabulary_not_a_secret",
  "customer_confirmed_the_value_is_public",
] as const;

export type ClearanceReasonCode = (typeof CLEARANCE_REASON_CODES)[number];

export const CLEARANCE_REASON_CATALOG: Readonly<Record<ClearanceReasonCode, string>> = {
  value_is_a_placeholder_not_a_credential:
    "A reviewer confirmed the held text is a placeholder rather than a live credential.",
  value_is_a_documented_example:
    "A reviewer confirmed the held text is a documented example value.",
  value_was_already_rotated_and_is_dead:
    "A reviewer confirmed the held value has already been rotated and no longer works.",
  text_is_product_vocabulary_not_a_secret:
    "A reviewer confirmed the held text is ordinary product vocabulary rather than a secret.",
  customer_confirmed_the_value_is_public:
    "The customer confirmed the held value is intended to be public.",
};

// --- Review decisions -----------------------------------------------------------

/**
 * Why a named reviewer released a report to the customer.
 *
 * A code, for the same reason a clearance reason is a code. The signature line
 * of a $299 report is not a place for a reviewer's keystrokes to become report
 * content, and this field sits directly beside `displayName`, which an audit
 * already caught carrying "Reviewed by ThisAppIsSecure".
 *
 * The accountability is not weakened by making it an enum. A reviewer still has
 * to pick one and their name is still on it; what they cannot do is write a
 * sentence the product would then have to guarantee.
 */
export const REVIEW_DECISION_REASON_CODES = [
  "reviewed_findings_and_verdict_match_the_recorded_observations",
  "reviewed_after_every_held_item_was_cleared",
  "reviewed_and_the_stated_limitations_are_accurate_for_this_engagement",
  "reviewed_and_the_scope_matches_what_the_customer_agreed",
] as const;

export type ReviewDecisionReasonCode = (typeof REVIEW_DECISION_REASON_CODES)[number];

export const REVIEW_DECISION_REASON_CATALOG: Readonly<Record<ReviewDecisionReasonCode, string>> = {
  reviewed_findings_and_verdict_match_the_recorded_observations:
    "A named reviewer read this report and confirmed its findings and verdict follow from the observations recorded during the review.",
  reviewed_after_every_held_item_was_cleared:
    "A named reviewer read this report after every held item had been examined and cleared, and released it.",
  reviewed_and_the_stated_limitations_are_accurate_for_this_engagement:
    "A named reviewer read this report and confirmed the limitations it states are accurate for this engagement.",
  reviewed_and_the_scope_matches_what_the_customer_agreed:
    "A named reviewer read this report and confirmed it covers the repository, application, and workflow the customer agreed at intake.",
};

// --- Limitations -----------------------------------------------------------------

/**
 * What every report says about itself, and what an engagement may add.
 *
 * `limitations` used to be up to thirty strings of free text. The standing six
 * were ours and fixed; the rest were whatever an executor wrote, on a report
 * surface the customer reads as carefully as the findings. They are codes now,
 * for the same reason the observations are.
 */
export const STANDING_LIMITATION_CODES = [
  "one_repository_at_one_commit",
  "read_only_no_running_system",
  "absence_is_not_proof",
  "severity_is_relative_to_the_workflow_in_scope",
  "ai_assisted_review_residual_risk",
] as const;

export const ENGAGEMENT_LIMITATION_CODES = [
  "customer_excluded_part_of_the_repository",
  "snapshot_predates_recent_changes",
  "third_party_service_behaviour_not_observable",
  "infrastructure_outside_the_repository_not_reviewed",
  "accessibility_reviewed_only_on_the_critical_workflow",
  "dependency_advisories_current_as_of_the_reviewed_commit",
  "review_limited_to_automated_checks",
] as const;

export type StandingLimitationCode = (typeof STANDING_LIMITATION_CODES)[number];
export type EngagementLimitationCode = (typeof ENGAGEMENT_LIMITATION_CODES)[number];
export type LimitationCode = StandingLimitationCode | EngagementLimitationCode;

export const LIMITATION_CATALOG: Readonly<Record<LimitationCode, string>> = {
  one_repository_at_one_commit:
    "This review examined one repository at one commit. Changes made after that commit were not reviewed.",
  read_only_no_running_system:
    "The review read source, configuration, and dependency manifests. It did not attack, load-test, or otherwise exercise a running system.",
  absence_is_not_proof:
    "Findings describe what this review identified. The absence of a finding is not evidence that a problem does not exist.",
  severity_is_relative_to_the_workflow_in_scope:
    "Severity reflects the impact, exploitability, and confidence recorded for each finding, judged against the one critical workflow in scope.",
  ai_assisted_review_residual_risk:
    "Part of this review is performed by an AI system reading your source. Text inside a repository can attempt to influence such a system. Our controls prevent that text from changing this report's findings, severity, counts, or verdict, which are computed by deterministic code from recorded observations. They cannot rule out that it caused a real problem to go unreported. This residual risk is not solved, and a human reviewer signing this report is the mitigation, not a guarantee.",
  customer_excluded_part_of_the_repository:
    "The customer excluded part of the repository from this review at intake. Anything inside an exclusion was not examined.",
  snapshot_predates_recent_changes:
    "The reviewed snapshot predates changes made during the engagement, which were not re-reviewed.",
  third_party_service_behaviour_not_observable:
    "The workflow depends on a third-party service whose behaviour could not be observed from the repository.",
  infrastructure_outside_the_repository_not_reviewed:
    "Infrastructure defined outside this repository was not reviewed.",
  accessibility_reviewed_only_on_the_critical_workflow:
    "Accessibility was reviewed on the critical workflow only, not across the whole application.",
  dependency_advisories_current_as_of_the_reviewed_commit:
    "Dependency advisories are current as of the reviewed commit. New advisories published since then are not reflected.",
  review_limited_to_automated_checks:
    "This review ran only the automated checks this report names. Every other check needs a reviewer to read the code and is marked not assessed.",
};

/** The limitations every report carries, in the order they are rendered. */
export const STANDING_LIMITATIONS: readonly string[] = STANDING_LIMITATION_CODES.map(
  (code) => LIMITATION_CATALOG[code],
);

export const OBSERVATION_CATALOG: Readonly<Record<ObservationCode, ObservationEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((observation) => [observation.code, observation])),
) as Readonly<Record<ObservationCode, ObservationEntry>>;

// The tuple above is written by hand so `z.enum` gets a real union. This is what
// stops that from drifting: a code in one and not the other throws at import,
// which is the earliest possible moment and the hardest one to ignore.
{
  const declared = new Set<string>(OBSERVATION_CODES);
  const defined = new Set(ENTRIES.map((observation) => observation.code));
  const missingEntry = [...declared].filter((code) => !defined.has(code as ObservationCode));
  const missingCode = [...defined].filter((code) => !declared.has(code));
  if (missingEntry.length > 0 || missingCode.length > 0) {
    throw new Error(
      `OBSERVATION_CODES and ENTRIES disagree. Declared with no entry: ${missingEntry.join(", ") || "none"}. Entry with no declaration: ${missingCode.join(", ") || "none"}.`,
    );
  }
  if (declared.size !== ENTRIES.length) {
    throw new Error(`OBSERVATION_CODES contains a duplicate: ${ENTRIES.length} entries, ${declared.size} codes.`);
  }
}

/**
 * Looks up an observation. Takes `string`, deliberately.
 *
 * Callers include the presenter, which reads a STORED artifact that may have
 * been written by a different build. Narrowing this to `ObservationCode` would
 * make the caller cast, and a cast at a trust boundary is how the last defect
 * got in. It returns `undefined` for an unknown code and the caller decides.
 */
export function getObservation(code: string): ObservationEntry | undefined {
  return OBSERVATION_CATALOG[code as ObservationCode];
}

export function getRemediation(code: string): RemediationEntry | undefined {
  return REMEDIATION_CATALOG[code as RemediationCode];
}

/** Whether a string is a code this build knows. Used where a cast would otherwise be. */
export function isObservationCode(code: string): code is ObservationCode {
  return Object.prototype.hasOwnProperty.call(OBSERVATION_CATALOG, code);
}

export function isRemediationCode(code: string): code is RemediationCode {
  return Object.prototype.hasOwnProperty.call(REMEDIATION_CATALOG, code);
}

export function isUncertaintyCode(code: string): code is UncertaintyCode {
  return Object.prototype.hasOwnProperty.call(UNCERTAINTY_CATALOG, code);
}

export function isAssessmentRationaleCode(code: string): code is AssessmentRationaleCode {
  return Object.prototype.hasOwnProperty.call(ASSESSMENT_RATIONALE_CATALOG, code);
}

export function isLimitationCode(code: string): code is LimitationCode {
  return Object.prototype.hasOwnProperty.call(LIMITATION_CATALOG, code);
}

export function isClearanceReasonCode(code: string): code is ClearanceReasonCode {
  return Object.prototype.hasOwnProperty.call(CLEARANCE_REASON_CATALOG, code);
}

export function isReviewDecisionReasonCode(code: string): code is ReviewDecisionReasonCode {
  return Object.prototype.hasOwnProperty.call(REVIEW_DECISION_REASON_CATALOG, code);
}

/**
 * Binds a report to the catalog that produced its words.
 *
 * The same role `rubricHash` plays for the rubric: a stored report names the
 * catalog version it was rendered from, so a later edit to a sentence cannot
 * silently change what an already-delivered report is understood to have said.
 */
export const RELEASE_RESCUE_OBSERVATION_CATALOG_VERSION = "release-rescue-observations/v1" as const;

export const RELEASE_RESCUE_OBSERVATION_CATALOG_HASH = createHash("sha256")
  .update(
    canonicalJsonStringify({
      version: RELEASE_RESCUE_OBSERVATION_CATALOG_VERSION,
      observations: ENTRIES,
      remediations: REMEDIATION_CATALOG,
      uncertainties: UNCERTAINTY_CATALOG,
      rationales: ASSESSMENT_RATIONALE_CATALOG,
      limitations: LIMITATION_CATALOG,
      clearances: CLEARANCE_REASON_CATALOG,
      reviewDecisions: REVIEW_DECISION_REASON_CATALOG,
    }),
    "utf8",
  )
  .digest("hex");
