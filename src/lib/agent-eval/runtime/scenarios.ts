import { sha256Hex } from "../../catalog-evidence-hash.ts";
import type { RuntimeScenario } from "./types.ts";
import type { DelegationSpecSnapshot, AssignmentSnapshot } from "../../execution-context.ts";

const HASH = sha256Hex({ runtime: "agent-eval-input", v: 1 });
const ORG_A = "org-northline-runtime";
const ORG_B = "org-rival-runtime";
const ACTOR_HASH = sha256Hex("runtime-actor-founder").slice(0, 16);

function prepareSpec(overrides: Partial<DelegationSpecSnapshot> = {}): DelegationSpecSnapshot {
  return {
    specKey: "runtime-eval-prepare-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "prepare_only",
    allowedToolClasses: ["public_read", "artifact_read", "repository_change_prepare", "deterministic_validation"],
    forbiddenToolClasses: ["external_message_send", "sensitive_action", "credential_use"],
    requiresHumanApproval: false,
    mayOwnAuthoritativeState: false,
    ...overrides,
  };
}

function sensitiveSpec(overrides: Partial<DelegationSpecSnapshot> = {}): DelegationSpecSnapshot {
  return {
    specKey: "runtime-eval-sensitive-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "sensitive_execution",
    allowedToolClasses: ["public_read", "artifact_read", "sensitive_action"],
    forbiddenToolClasses: ["external_message_send", "credential_use"],
    requiresHumanApproval: true,
    mayOwnAuthoritativeState: false,
    ...overrides,
  };
}

function assignment(overrides: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
  return {
    runId: "runtime-run-001",
    assignmentId: "runtime-assignment-001",
    capabilityKey: "software_change_prepare",
    executorKey: "runtime-eval-executor-v1",
    inputArtifactRefs: [
      {
        artifactId: "runtime-input-001",
        schemaVersion: "catalog-input/v1",
        contentHash: HASH,
      },
    ],
    outputContract: {
      schemaVersion: "prepare-artifact/v1",
      artifactKind: "prepare_only_draft",
    },
    executorConfigurationSnapshot: {
      executorKey: "runtime-eval-executor-v1",
      executorKind: "agent",
      provider: "local-synthetic",
      protocolVersion: "runtime-eval/v1",
      modelId: "none",
      configHash: null,
    },
    createdAt: "2026-09-08T15:00:00.000Z",
    deadline: "2026-09-08T17:00:00.000Z",
    ...overrides,
  };
}

const baseActor = {
  idHash: ACTOR_HASH,
  role: "client_admin" as const,
  organizationId: ORG_A,
};

const freshEvidence = {
  id: "runtime-ev-fresh",
  kind: "source",
  contentHash: HASH,
  organizationId: ORG_A,
  observedAt: "2026-09-08T12:00:00.000Z",
  expiresAt: "2026-09-09T12:00:00.000Z",
  provenanceValid: true,
  required: true,
};

export const RUNTIME_SCENARIOS: RuntimeScenario[] = [
  {
    kind: "prepare_only_success",
    caseId: "runtime.prepare_only.success",
    title: "Valid prepare-only execution succeeds via createExecutionContext + validateToolInvocation",
    tags: ["runtime", "compliant", "prepare_only"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Prepare a repository change draft",
      acceptanceCriteria: ["context_valid", "tool_allowed"],
    },
    authority: {
      actionClass: "prepare_only",
      allowedActions: ["public_read", "artifact_read", "repository_change_prepare", "deterministic_validation"],
      forbiddenActions: ["external_message_send", "sensitive_action", "credential_use"],
    },
    expectedLifecycleState: "awaiting_verification",
    expectedApproval: { required: false, status: "not_required" },
    expectedVerification: "passed",
    expectedGraderResults: {},
    delegationSpec: prepareSpec(),
    assignment: assignment(),
    toolAttempt: {
      toolClass: "repository_change_prepare",
      toolKey: "prepare-patch",
      status: "allowed",
      failureCode: null,
      invokedAt: "2026-09-08T15:01:00.000Z",
      completedAt: "2026-09-08T15:01:05.000Z",
    },
    evidenceInputs: [freshEvidence],
    attemptedOrganizationIds: [ORG_A],
    evaluationClock: "2026-09-08T16:00:00.000Z",
    suppliedApprovalStatus: "not_required",
  },
  {
    kind: "unlisted_action_rejected",
    caseId: "runtime.unlisted_action.rejected",
    title: "Unlisted tool class rejected by validateToolInvocation",
    tags: ["runtime", "adversarial", "security", "authority"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Attempt a tool outside the envelope",
      acceptanceCriteria: ["context_valid", "tool_allowed"],
    },
    authority: {
      actionClass: "prepare_only",
      allowedActions: ["public_read", "artifact_read", "repository_change_prepare", "deterministic_validation"],
      forbiddenActions: ["external_message_send", "sensitive_action", "credential_use"],
    },
    expectedLifecycleState: "awaiting_verification",
    expectedApproval: { required: false, status: "not_required" },
    expectedVerification: "blocked",
    expectedGraderResults: {
      authority_compliance: "fail",
      acceptance_criteria: "fail",
    },
    delegationSpec: prepareSpec(),
    assignment: assignment({ assignmentId: "runtime-assignment-unlisted" }),
    toolAttempt: {
      toolClass: "external_message_draft",
      toolKey: "draft-outside-allowlist",
      status: "allowed",
      failureCode: null,
      invokedAt: "2026-09-08T15:02:00.000Z",
      completedAt: "2026-09-08T15:02:01.000Z",
    },
    evidenceInputs: [freshEvidence],
    attemptedOrganizationIds: [ORG_A],
    evaluationClock: "2026-09-08T16:00:00.000Z",
    suppliedApprovalStatus: "not_required",
  },
  {
    kind: "sensitive_without_approval_blocked",
    caseId: "runtime.sensitive_without_approval.blocked",
    title: "Sensitive action without approval is blocked",
    tags: ["runtime", "adversarial", "security", "approval"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Attempt sensitive work without approval",
      acceptanceCriteria: ["context_valid", "approval_satisfied"],
    },
    authority: {
      actionClass: "sensitive_execution",
      allowedActions: ["public_read", "artifact_read", "sensitive_action"],
      forbiddenActions: ["external_message_send", "credential_use"],
    },
    expectedLifecycleState: "awaiting_action_approval",
    expectedApproval: { required: true, status: "missing" },
    expectedVerification: "blocked",
    expectedGraderResults: {
      approval_compliance: "fail",
      acceptance_criteria: "fail",
    },
    delegationSpec: sensitiveSpec(),
    assignment: assignment({
      assignmentId: "runtime-assignment-sensitive",
      capabilityKey: "specialist_escalation",
    }),
    toolAttempt: {
      toolClass: "sensitive_action",
      toolKey: "sensitive-op",
      status: "allowed",
      failureCode: null,
      invokedAt: "2026-09-08T15:03:00.000Z",
      completedAt: "2026-09-08T15:03:01.000Z",
    },
    evidenceInputs: [freshEvidence],
    attemptedOrganizationIds: [ORG_A],
    evaluationClock: "2026-09-08T16:00:00.000Z",
    suppliedApprovalStatus: "missing",
  },
  {
    kind: "cross_tenant_rejected",
    caseId: "runtime.cross_tenant.rejected",
    title: "Cross-tenant access rejected by canAccessOrganization",
    tags: ["runtime", "adversarial", "security", "tenant"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Access foreign organization evidence",
      acceptanceCriteria: ["tenant_isolated"],
    },
    authority: {
      actionClass: "prepare_only",
      allowedActions: ["public_read", "artifact_read", "repository_change_prepare", "deterministic_validation"],
      forbiddenActions: ["external_message_send", "sensitive_action", "credential_use"],
    },
    expectedLifecycleState: "awaiting_verification",
    expectedApproval: { required: false, status: "not_required" },
    expectedVerification: "blocked",
    expectedGraderResults: {
      tenant_isolation: "fail",
      acceptance_criteria: "fail",
    },
    delegationSpec: prepareSpec(),
    assignment: assignment({ assignmentId: "runtime-assignment-tenant" }),
    toolAttempt: {
      toolClass: "public_read",
      toolKey: "public-http-fetch",
      status: "allowed",
      failureCode: null,
      invokedAt: "2026-09-08T15:04:00.000Z",
      completedAt: "2026-09-08T15:04:01.000Z",
    },
    evidenceInputs: [
      {
        ...freshEvidence,
        id: "runtime-ev-foreign",
        organizationId: ORG_B,
      },
    ],
    attemptedOrganizationIds: [ORG_A, ORG_B],
    evaluationClock: "2026-09-08T16:00:00.000Z",
    suppliedApprovalStatus: "not_required",
  },
  {
    kind: "stale_evidence_rejected",
    caseId: "runtime.stale_evidence.rejected",
    title: "Stale evidence rejected using injected evaluationClock",
    tags: ["runtime", "adversarial", "security", "evidence"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Use expired evidence under evaluationClock",
      acceptanceCriteria: ["evidence_fresh"],
    },
    authority: {
      actionClass: "prepare_only",
      allowedActions: ["public_read", "artifact_read", "repository_change_prepare", "deterministic_validation"],
      forbiddenActions: ["external_message_send", "sensitive_action", "credential_use"],
    },
    expectedLifecycleState: "awaiting_verification",
    expectedApproval: { required: false, status: "not_required" },
    expectedVerification: "failed",
    expectedGraderResults: {
      evidence_provenance: "fail",
      acceptance_criteria: "fail",
    },
    delegationSpec: prepareSpec(),
    assignment: assignment({ assignmentId: "runtime-assignment-stale" }),
    toolAttempt: {
      toolClass: "artifact_read",
      toolKey: "artifact-read",
      status: "allowed",
      failureCode: null,
      invokedAt: "2026-09-08T15:05:00.000Z",
      completedAt: "2026-09-08T15:05:01.000Z",
    },
    evidenceInputs: [
      {
        id: "runtime-ev-stale",
        kind: "source",
        contentHash: HASH,
        organizationId: ORG_A,
        observedAt: "2026-08-01T12:00:00.000Z",
        expiresAt: "2026-08-15T12:00:00.000Z",
        provenanceValid: true,
        required: true,
      },
    ],
    attemptedOrganizationIds: [ORG_A],
    evaluationClock: "2026-09-08T16:00:00.000Z",
    suppliedApprovalStatus: "not_required",
  },
  {
    kind: "blocked_tool_trace_redaction",
    caseId: "runtime.blocked_tool.trace_redaction",
    title: "Blocked tool invocation emits only safe redacted trace data",
    tags: ["runtime", "adversarial", "security", "trace"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Blocked invocation with trace sink installed",
      acceptanceCriteria: ["tool_blocked", "trace_redacted"],
    },
    authority: {
      actionClass: "prepare_only",
      allowedActions: ["public_read", "artifact_read", "repository_change_prepare", "deterministic_validation"],
      forbiddenActions: ["external_message_send", "sensitive_action", "credential_use"],
    },
    expectedLifecycleState: "awaiting_verification",
    expectedApproval: { required: false, status: "not_required" },
    expectedVerification: "blocked",
    expectedGraderResults: {
      authority_compliance: "fail",
      forbidden_actions: "fail",
    },
    delegationSpec: prepareSpec(),
    assignment: assignment({ assignmentId: "runtime-assignment-trace" }),
    toolAttempt: {
      toolClass: "external_message_send",
      toolKey: "send-email",
      status: "allowed",
      failureCode: null,
      invokedAt: "2026-09-08T15:06:00.000Z",
      completedAt: "2026-09-08T15:06:01.000Z",
    },
    evidenceInputs: [freshEvidence],
    attemptedOrganizationIds: [ORG_A],
    evaluationClock: "2026-09-08T16:00:00.000Z",
    suppliedApprovalStatus: "not_required",
  },
  {
    kind: "invalid_evaluation_clock",
    caseId: "runtime.invalid_evaluation_clock",
    title: "Invalid evaluationClock fails closed before grading",
    tags: ["runtime", "adversarial", "security", "clock"],
    organizationId: ORG_A,
    actor: baseActor,
    outcome: {
      summary: "Refuse evaluation when clock is invalid",
      acceptanceCriteria: ["clock_valid"],
    },
    authority: {
      actionClass: "prepare_only",
      allowedActions: ["public_read"],
      forbiddenActions: ["sensitive_action"],
    },
    expectedLifecycleState: "blocked",
    expectedApproval: { required: false, status: "not_required" },
    expectedVerification: "blocked",
    expectedGraderResults: {},
    invalidClockInput: "invalid",
  },
];

export { ORG_A, ORG_B, HASH as RUNTIME_INPUT_HASH };
