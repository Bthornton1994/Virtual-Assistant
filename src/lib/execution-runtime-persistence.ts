import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AuthzError,
  DomainError,
  assertOrgAccess,
  isManagerRole,
  isOpsRole,
  type Actor,
} from "@/lib/domain";
import { sha256Text } from "@/lib/catalog-evidence-hash";
import {
  assertRedactedEconomicsTelemetry,
  readRuntimeEconomicsReservationId,
  releaseReservation,
  type EconomicsSession,
} from "@/lib/outcome-economics-governor";
import { assertSuccessfulCompletionMayProceed } from "@/lib/execution-economics-adapter";
import {
  validateExecutionPlan,
  type ExecutionFailureClass,
  type ExecutionPlanInput,
} from "@/lib/execution-runtime";
import { executionStepAssignmentToEnvelope } from "@/lib/assignment-to-envelope";
import {
  assertLeasedCompleteAllowed,
  loadObservationTrace,
  snapshotDelegationSpec,
} from "@/lib/execution-context-enforcement";
import type { ActionClass } from "@/lib/domain";
import type { ExecutionContext } from "@/lib/execution-context";
import { getCapabilityDefinition } from "@/lib/capability-registry";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Server-only persistence boundary for Execution Runtime v1.
 *
 * The browser never receives the service-role client, a plaintext lease token,
 * or direct write access to runtime tables. Human-facing operations authorize
 * the actor first; worker-facing operations accept an ephemeral token and send
 * only its SHA-256 hash to the database RPCs.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_METADATA_KEY_PATTERN = /(authorization|cookie|password|secret|token|api[_-]?key|private[_-]?key)/i;
const ACTION_CLASS_RANK: Record<string, number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

type RuntimeRow = Record<string, unknown>;

export type ExecutionPlanRecord = {
  id: string;
  organizationId: string;
  runId: string;
  delegationSpecId: string;
  planVersion: number;
  delegationSpecVersion: number;
  status: string;
  planHash: string;
  objective: string;
  authorityClass: string;
  dataPolicy: RuntimeRow;
  frozenBy: string | null;
  frozenAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionClaim = {
  attemptId: string;
  planId: string;
  stepId: string;
  runId: string;
  stepKey: string;
  capabilityKey: string;
  actionClass: string;
  executorContext: RuntimeRow;
  leaseExpiresAt: string;
  attemptNumber: number;
};

export type ExecutionApprovalDecision = "approved" | "rejected";

export type ExecutionFailureInput = {
  failureClass: ExecutionFailureClass;
  failureCode?: string;
  failureSummary: string;
  metadata?: RuntimeRow;
  humanMinutes?: number;
  aiCostMicros?: number;
  toolCostMicros?: number;
};

function runtimeDb(): SupabaseClient {
  const db = supabaseAdmin();
  if (!db) {
    throw new DomainError("Execution Runtime requires a verified server-side Supabase service-role client.");
  }
  return db;
}

function requirePersistentActor(actor: Actor) {
  if (actor.source === "demo") {
    throw new DomainError("Execution Runtime is unavailable in demo mode.");
  }
}

function requireOps(actor: Actor) {
  requirePersistentActor(actor);
  if (!isOpsRole(actor.role)) throw new AuthzError("Only operations staff can operate Execution Runtime.");
}

function requireManager(actor: Actor) {
  requirePersistentActor(actor);
  if (!isManagerRole(actor.role)) throw new AuthzError("Only operations managers can govern Execution Runtime.");
}

function requireUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new DomainError(`${label} must be a UUID.`);
}

function requireIdentifier(value: string, label: string) {
  if (!IDENTIFIER_PATTERN.test(value)) throw new DomainError(`${label} is not a valid bounded identifier.`);
}

function requireLeaseToken(token: string) {
  if (typeof token !== "string" || token.length < 32 || token.length > 512) {
    throw new DomainError("Lease tokens must be 32 to 512 characters and are never persisted in plaintext.");
  }
  return sha256Text(token);
}

function requireHash(value: string, label: string) {
  if (!SHA256_PATTERN.test(value)) throw new DomainError(`${label} must be a lowercase SHA-256 hash.`);
}

function requireCost(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new DomainError(`${label} must be finite and non-negative.`);
}

function requireSafeMetadata(value: unknown, label: string): RuntimeRow {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError(`${label} must be a JSON object.`);
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new DomainError(`${label} must be JSON serializable.`);
  }
  if (serialized.length > 64_000) throw new DomainError(`${label} must be at most 64 KB.`);

  const walk = (candidate: unknown, path: string, depth: number): void => {
    if (depth > 8 || candidate === null || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    for (const [key, nested] of Object.entries(candidate as RuntimeRow)) {
      if (SECRET_METADATA_KEY_PATTERN.test(key)) {
        throw new DomainError(`${label} cannot contain secret-bearing field ${path}.${key}.`);
      }
      walk(nested, `${path}.${key}`, depth + 1);
    }
  };
  walk(value, label, 0);
  const redacted = assertRedactedEconomicsTelemetry(value, label);
  if (!redacted.ok) {
    throw new DomainError(redacted.failures.join("; "));
  }
  return value as RuntimeRow;
}

function asObject(value: unknown): RuntimeRow {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RuntimeRow) : {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapPlan(row: RuntimeRow): ExecutionPlanRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    runId: String(row.run_id),
    delegationSpecId: String(row.delegation_spec_id),
    planVersion: Number(row.plan_version),
    delegationSpecVersion: Number(row.delegation_spec_version),
    status: String(row.status),
    planHash: String(row.plan_hash),
    objective: String(row.objective_snapshot ?? ""),
    authorityClass: String(row.authority_class),
    dataPolicy: asObject(row.data_policy_snapshot),
    frozenBy: asStringOrNull(row.frozen_by),
    frozenAt: asStringOrNull(row.frozen_at),
    startedAt: asStringOrNull(row.started_at),
    completedAt: asStringOrNull(row.completed_at),
    createdBy: asStringOrNull(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapClaim(row: RuntimeRow): ExecutionClaim {
  return {
    attemptId: String(row.attempt_id),
    planId: String(row.plan_id),
    stepId: String(row.step_id),
    runId: String(row.run_id),
    stepKey: String(row.step_key),
    capabilityKey: String(row.capability_key),
    actionClass: String(row.action_class),
    executorContext: asObject(row.executor_context),
    leaseExpiresAt: String(row.lease_expires_at),
    attemptNumber: Number(row.attempt_number),
  };
}

async function recordAudit(
  db: SupabaseClient,
  actor: Actor,
  organizationId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: RuntimeRow = {},
) {
  const { error } = await db.from("audit_events").insert({
    organization_id: organizationId,
    actor_id: actor.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (error) throw new DomainError(error.message || "Could not record Execution Runtime audit event.");
}

async function loadRun(db: SupabaseClient, runId: string) {
  requireUuid(runId, "runId");
  const { data, error } = await db
    .from("workstream_runs")
    .select("id, organization_id, delegation_spec_id, status")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Workstream Run not found.");
  return data as RuntimeRow;
}

async function loadPlan(db: SupabaseClient, planId: string) {
  requireUuid(planId, "planId");
  const { data, error } = await db.from("execution_plans").select("*").eq("id", planId).maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Execution plan not found.");
  return data as RuntimeRow;
}

export async function createExecutionPlan(actor: Actor, input: ExecutionPlanInput) {
  requireOps(actor);
  const checked = validateExecutionPlan(input);
  if (!checked.ok) throw new DomainError(`Invalid execution plan: ${checked.failures.join(" ")}`);

  const plan = checked.value;
  requireUuid(plan.planId, "planId");
  requireUuid(plan.runId, "runId");
  requireUuid(plan.organizationId, "organizationId");
  requireUuid(plan.delegationSpecId, "delegationSpecId");

  const db = runtimeDb();
  const run = await loadRun(db, plan.runId);
  if (String(run.organization_id) !== plan.organizationId) throw new AuthzError("Execution plan tenant does not match its Run.");
  if (String(run.delegation_spec_id) !== plan.delegationSpecId) {
    throw new DomainError("Execution plan Delegation Spec does not match its Run.");
  }
  assertOrgAccess(actor, plan.organizationId);

  const { data: spec, error: specError } = await db
    .from("delegation_specs")
    .select("id, organization_id, version, status, action_class")
    .eq("id", plan.delegationSpecId)
    .maybeSingle();
  if (specError) throw new DomainError(specError.message);
  if (!spec || String(spec.organization_id) !== plan.organizationId) {
    throw new DomainError("Delegation Spec not found in the plan tenant.");
  }
  if (spec.status !== "active" || Number(spec.version) !== plan.delegationSpecVersion) {
    throw new DomainError("Execution plan must snapshot the active Delegation Spec version.");
  }
  if (ACTION_CLASS_RANK[plan.authorityClass] > ACTION_CLASS_RANK[String(spec.action_class)]) {
    throw new DomainError("Execution plan authority cannot exceed the Delegation Spec authority ceiling.");
  }

  const { data, error } = await db.rpc("create_execution_plan", {
    p_plan_id: plan.planId,
    p_organization_id: plan.organizationId,
    p_run_id: plan.runId,
    p_delegation_spec_id: plan.delegationSpecId,
    p_plan_version: plan.planVersion,
    p_delegation_spec_version: plan.delegationSpecVersion,
    p_plan_hash: plan.planHash,
    p_objective_snapshot: plan.objective,
    p_authority_class: plan.authorityClass,
    p_data_policy_snapshot: plan.dataPolicy,
    p_steps: plan.steps,
    p_created_at: plan.createdAt,
    p_created_by: actor.id,
  });
  if (error) throw new DomainError(error.message);
  const planId = typeof data === "string" ? data : plan.planId;
  if (planId !== plan.planId) throw new DomainError("Execution plan RPC returned an unexpected identity.");
  await recordAudit(db, actor, plan.organizationId, "execution.runtime_plan_created", "execution_plan", planId, {
    planHash: plan.planHash,
    planVersion: plan.planVersion,
    delegationSpecVersion: plan.delegationSpecVersion,
  });
  return { planId, planHash: plan.planHash };
}

export async function listExecutionPlans(actor: Actor, organizationId?: string) {
  requireOps(actor);
  const db = runtimeDb();
  if (organizationId) {
    requireUuid(organizationId, "organizationId");
    assertOrgAccess(actor, organizationId);
  }
  let query = db.from("execution_plans").select("*").order("created_at", { ascending: false });
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query;
  if (error) throw new DomainError(error.message);
  return (data ?? []).map((row: RuntimeRow) => mapPlan(row));
}

export async function getExecutionPlan(actor: Actor, planId: string) {
  requireOps(actor);
  const db = runtimeDb();
  const row = await loadPlan(db, planId);
  assertOrgAccess(actor, String(row.organization_id));
  return mapPlan(row);
}

export async function freezeExecutionPlan(actor: Actor, planId: string) {
  requireManager(actor);
  const db = runtimeDb();
  const row = await loadPlan(db, planId);
  assertOrgAccess(actor, String(row.organization_id));
  const { error } = await db.rpc("freeze_execution_plan", { p_plan_id: planId, p_actor_id: actor.id });
  if (error) throw new DomainError(error.message);
  await recordAudit(db, actor, String(row.organization_id), "execution.runtime_plan_frozen", "execution_plan", planId, {
    planHash: String(row.plan_hash),
  });
}

export async function refreshExecutionPlanQueue(actor: Actor, planId: string) {
  requireOps(actor);
  const db = runtimeDb();
  const row = await loadPlan(db, planId);
  assertOrgAccess(actor, String(row.organization_id));
  const { error } = await db.rpc("refresh_execution_plan_queue", { p_plan_id: planId });
  if (error) throw new DomainError(error.message);
}

function validateWorker(workerId: string, leaseSeconds: number) {
  requireIdentifier(workerId, "workerId");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 3600) {
    throw new DomainError("Lease duration must be an integer from 30 through 3600 seconds.");
  }
}

async function previewReadyStep(db: SupabaseClient, capabilityKey: string) {
  const { data, error } = await db
    .from("execution_plan_steps")
    .select("id, organization_id, plan_id, run_id, step_key, capability_key, action_class, deadline_at, input_artifact_ids, output_contract_version")
    .eq("capability_key", capabilityKey)
    .eq("status", "ready")
    .order("available_at", { ascending: true })
    .order("sequence", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  return data as RuntimeRow | null;
}

async function bindClaimedStep(
  db: SupabaseClient,
  step: RuntimeRow,
  workerId: string,
): Promise<{
  contextHash: string;
  envelopeHash: string;
  assignmentId: string;
  stepKey: string;
  planId: string;
  context: ExecutionContext;
}> {
  const plan = await loadPlan(db, String(step.plan_id));
  const { data: spec, error: specError } = await db
    .from("delegation_specs")
    .select("id, version, action_class, objective")
    .eq("id", String(plan.delegation_spec_id))
    .maybeSingle();
  if (specError) throw new DomainError(specError.message);
  if (!spec) throw new DomainError("Delegation Spec not found for the frozen execution plan.");

  const { data: profile, error: profileError } = await db
    .from("executor_profiles")
    .select("key, executor_kind, provider, authority_envelope, forbidden_actions, configuration_metadata")
    .eq("key", workerId)
    .maybeSingle();
  if (profileError) throw new DomainError(profileError.message);
  if (!profile) throw new DomainError("Executor profile not found for the claiming worker.");

  const capability = getCapabilityDefinition(String(step.capability_key));
  const outputSchema =
    (typeof step.output_contract_version === "string" && step.output_contract_version) ||
    capability?.outputContractVersions[0] ||
    "artifact/v1";
  const specSnapshot = snapshotDelegationSpec({
    specKey: "execution-runtime-delegation-spec",
    specVersion: "delegation-spec/v" + String(spec.version),
    actionClass: String(spec.action_class) as ActionClass,
  });
  const inputIds = Array.isArray(step.input_artifact_ids) ? step.input_artifact_ids : [];
  const refs: Array<{ artifactId: string; schemaVersion: string; contentHash: string }> = [];
  if (inputIds.length > 0) {
    const { data: artifacts, error: artifactError } = await db
      .from("evidence_artifacts")
      .select("id, content_hash, payload")
      .in("id", inputIds.map(String));
    if (artifactError) throw new DomainError(artifactError.message);
    for (const artifact of artifacts ?? []) {
      const payload = asObject(artifact.payload);
      refs.push({
        artifactId: String(artifact.id),
        schemaVersion: String(payload.schemaVersion ?? "artifact/v1"),
        contentHash: String(artifact.content_hash ?? ""),
      });
    }
  }

  const translated = executionStepAssignmentToEnvelope(
    {
      organizationId: String(step.organization_id),
      runId: String(step.run_id),
      phase: String(profile.executor_kind) === "deterministic" ? "validate" : "prepare",
      planHash: String(plan.plan_hash),
      stepKey: String(step.step_key),
      capabilityKey: String(step.capability_key),
      executorKey: workerId,
      executorKind: String(profile.executor_kind),
      provider: String(profile.provider ?? "delegation-cloud"),
      protocolVersion: String(asObject(profile.configuration_metadata).protocolVersion ?? "execution-runtime/v1"),
      modelId: null,
      configHash: null,
      objective: String(plan.objective_snapshot ?? spec.objective ?? "Execute the frozen plan step."),
      createdAt: String(plan.created_at),
      deadline: String(step.deadline_at),
      outputContract: { schemaVersion: outputSchema, artifactKind: "candidate_evidence" },
      evidenceRequirements: {
        requiredArtifactSchemaVersions: capability?.outputContractVersions ? [...capability.outputContractVersions] : [],
        requiredSourceProvenance: [],
        independentReviewRequired: false,
      },
      economicLimit: { currency: "USD", maxHumanMinutes: 0, maxAiCostMicros: 0, maxToolCostMicros: 0 },
      profileAuthoritySnapshot: {
        executorKey: workerId,
        executorKind: String(profile.executor_kind),
        authorityEnvelope: asObject(profile.authority_envelope),
        forbiddenActions: Array.isArray(profile.forbidden_actions) ? profile.forbidden_actions : [],
      },
    },
    specSnapshot,
    refs,
  );
  if (!translated.ok) {
    throw new DomainError("Cannot claim an execution step without a valid execution context: " + translated.failures.join(" "));
  }
  return {
    contextHash: translated.value.contextHash,
    envelopeHash: translated.value.envelopeHash,
    assignmentId: translated.value.assignmentId,
    stepKey: String(step.step_key),
    planId: String(step.plan_id),
    context: translated.value.context,
  };
}

export async function claimExecutionStep(input: {
  workerId: string;
  capabilityKey: string;
  leaseToken: string;
  leaseSeconds?: number;
}): Promise<ExecutionClaim | null> {
  const leaseSeconds = input.leaseSeconds ?? 300;
  validateWorker(input.workerId, leaseSeconds);
  requireIdentifier(input.capabilityKey, "capabilityKey");
  const leaseTokenHash = requireLeaseToken(input.leaseToken);
  const db = runtimeDb();
  const preview = await previewReadyStep(db, input.capabilityKey);
  if (!preview) return null;
  const binding = await bindClaimedStep(db, preview, input.workerId);
  const { data, error } = await db.rpc("claim_execution_step", {
    p_worker_id: input.workerId,
    p_capability_key: input.capabilityKey,
    p_lease_token_hash: leaseTokenHash,
    p_context_hash: binding.contextHash,
    p_envelope_hash: binding.envelopeHash,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new DomainError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const claimed = mapClaim(row as RuntimeRow);
  if (claimed.stepKey !== binding.stepKey || claimed.planId !== binding.planId) {
    throw new DomainError("Claimed execution step does not match the frozen assignment used to hash the execution context.");
  }
  return claimed;
}

async function attemptRpc(
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const db = runtimeDb();
  const { data, error } = await db.rpc(functionName, args);
  if (error) throw new DomainError(error.message);
  return data;
}

export async function heartbeatExecutionAttempt(input: {
  attemptId: string;
  workerId: string;
  leaseToken: string;
  leaseSeconds?: number;
}) {
  requireUuid(input.attemptId, "attemptId");
  const leaseSeconds = input.leaseSeconds ?? 300;
  validateWorker(input.workerId, leaseSeconds);
  const leaseTokenHash = requireLeaseToken(input.leaseToken);
  return (await attemptRpc("heartbeat_execution_attempt", {
    p_attempt_id: input.attemptId,
    p_worker_id: input.workerId,
    p_lease_token_hash: leaseTokenHash,
    p_lease_seconds: leaseSeconds,
  })) as string;
}

export async function completeExecutionAttempt(input: {
  attemptId: string;
  workerId: string;
  leaseToken: string;
  outputArtifactIds?: string[];
  metadata?: RuntimeRow;
  humanMinutes?: number;
  aiCostMicros?: number;
  toolCostMicros?: number;
  economicsSession?: EconomicsSession;
}) {
  requireUuid(input.attemptId, "attemptId");
  requireIdentifier(input.workerId, "workerId");
  const leaseTokenHash = requireLeaseToken(input.leaseToken);
  const outputArtifactIds = input.outputArtifactIds ?? [];
  if (!Array.isArray(outputArtifactIds) || outputArtifactIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new DomainError("outputArtifactIds must contain UUIDs only.");
  }
  if (new Set(outputArtifactIds).size !== outputArtifactIds.length) {
    throw new DomainError("outputArtifactIds must not contain duplicates.");
  }
  const metadata = requireSafeMetadata(input.metadata, "metadata");
  requireCost(input.humanMinutes ?? 0, "humanMinutes");
  requireCost(input.aiCostMicros ?? 0, "aiCostMicros");
  requireCost(input.toolCostMicros ?? 0, "toolCostMicros");

  const db = runtimeDb();
  const { data: attempt, error: attemptError } = await db
    .from("execution_attempts")
    .select(
      "id, organization_id, run_id, plan_id, step_id, status, worker_id, lease_token_hash, lease_expires_at, context_hash, authority_snapshot",
    )
    .eq("id", input.attemptId)
    .maybeSingle();
  if (attemptError) throw new DomainError(attemptError.message);
  if (!attempt) throw new DomainError("Execution attempt not found.");
  const { data: step, error: stepError } = await db
    .from("execution_plan_steps")
    .select(
      "id, organization_id, plan_id, run_id, step_key, capability_key, action_class, deadline_at, input_artifact_ids, output_contract_version, lease_worker_id",
    )
    .eq("id", String(attempt.step_id))
    .maybeSingle();
  if (stepError) throw new DomainError(stepError.message);
  if (!step) throw new DomainError("Execution step not found.");

  const storedEnvelopeHash = String(asObject(attempt.authority_snapshot).envelopeHash ?? "");
  const storedContextHash = typeof attempt.context_hash === "string" ? attempt.context_hash : "";
  const binding = await bindClaimedStep(db, step as RuntimeRow, String(attempt.worker_id));
  const loaded =
    typeof metadata.assignmentId === "string"
      ? await loadObservationTrace(db, String(attempt.run_id), metadata.assignmentId)
      : null;

  assertLeasedCompleteAllowed({
    attempt: {
      status: String(attempt.status),
      organizationId: String(attempt.organization_id),
      runId: String(attempt.run_id),
      workerId: String(attempt.worker_id),
      leaseTokenHash: String(attempt.lease_token_hash),
      leaseExpiresAt: String(attempt.lease_expires_at),
      contextHash: storedContextHash || null,
      envelopeHash: storedEnvelopeHash || null,
      stepLeaseWorkerId: step.lease_worker_id == null ? null : String(step.lease_worker_id),
    },
    caller: {
      attemptId: input.attemptId,
      stepKey: String(step.step_key),
      workerId: input.workerId,
      leaseTokenHash,
      now: new Date().toISOString(),
      metadata,
      outputArtifactIds,
    },
    observation: loaded
      ? {
          organizationId: String(attempt.organization_id),
          runId: String(attempt.run_id),
          kind: "observation",
          contentHash: loaded.contentHash,
          payload: loaded.payload,
        }
      : null,
    context: binding.context,
    expectedAssignmentId: binding.assignmentId,
    expectedEnvelopeHash: binding.envelopeHash,
    expectedContextHash: binding.contextHash,
  });

  if (input.economicsSession) {
    if (input.economicsSession.organizationId !== String(attempt.organization_id)) {
      throw new DomainError("Same-process economics session organization does not match the execution attempt.");
    }
    const completion = assertSuccessfulCompletionMayProceed({
      session: input.economicsSession,
      organizationId: input.economicsSession.organizationId,
      tenantId: input.economicsSession.tenantId,
      executionAttemptId: input.attemptId,
      reservationId: readRuntimeEconomicsReservationId(metadata),
    });
    if (!completion.ok) {
      throw new DomainError(completion.failures.join(" "));
    }
  }

  return attemptRpc("complete_execution_attempt", {
    p_attempt_id: input.attemptId,
    p_worker_id: input.workerId,
    p_lease_token_hash: leaseTokenHash,
    p_output_artifact_ids: outputArtifactIds,
    p_metadata: metadata,
    p_human_minutes: input.humanMinutes ?? 0,
    p_ai_cost_micros: Math.round(input.aiCostMicros ?? 0),
    p_tool_cost_micros: Math.round(input.toolCostMicros ?? 0),
  });
}

export async function failExecutionAttempt(input: ExecutionFailureInput & {
  attemptId: string;
  workerId: string;
  leaseToken: string;
  economicsSession?: EconomicsSession;
}) {
  requireUuid(input.attemptId, "attemptId");
  requireIdentifier(input.workerId, "workerId");
  requireIdentifier(input.failureClass, "failureClass");
  if (!input.failureSummary.trim()) throw new DomainError("failureSummary is required.");
  if (input.failureSummary.length > 2000) throw new DomainError("failureSummary must be at most 2000 characters.");
  if (input.failureCode !== undefined) requireIdentifier(input.failureCode, "failureCode");
  const leaseTokenHash = requireLeaseToken(input.leaseToken);
  requireHash(leaseTokenHash, "leaseTokenHash");
  const metadata = requireSafeMetadata(input.metadata, "metadata");
  requireCost(input.humanMinutes ?? 0, "humanMinutes");
  requireCost(input.aiCostMicros ?? 0, "aiCostMicros");
  requireCost(input.toolCostMicros ?? 0, "toolCostMicros");
  if (input.economicsSession) {
    const reservationId = readRuntimeEconomicsReservationId(metadata);
    if (reservationId) {
      const released = releaseReservation({
        session: input.economicsSession,
        organizationId: input.economicsSession.organizationId,
        tenantId: input.economicsSession.tenantId,
        reservationId,
        idempotencyKey: reservationId,
        now: new Date().toISOString(),
      });
      if (!released.ok && !released.failures.some((failure) => /not be released|not found|Committed/.test(failure))) {
        throw new DomainError(released.failures.join(" "));
      }
    }
  }
  return attemptRpc("fail_execution_attempt", {
    p_attempt_id: input.attemptId,
    p_worker_id: input.workerId,
    p_lease_token_hash: leaseTokenHash,
    p_failure_class: input.failureClass,
    p_failure_code: input.failureCode ?? input.failureClass,
    p_failure_summary: input.failureSummary.trim(),
    p_metadata: metadata,
    p_human_minutes: input.humanMinutes ?? 0,
    p_ai_cost_micros: Math.round(input.aiCostMicros ?? 0),
    p_tool_cost_micros: Math.round(input.toolCostMicros ?? 0),
    p_allow_expired: false,
  });
}

export async function reapExecutionLeases(limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new DomainError("Reap limit must be an integer from 1 through 1000.");
  }
  return (await attemptRpc("reap_execution_leases", { p_limit: limit })) as number;
}

export async function decideExecutionApproval(
  actor: Actor,
  approvalId: string,
  decision: ExecutionApprovalDecision,
  decisionNote = "",
) {
  requirePersistentActor(actor);
  if (!(actor.role === "client_admin" || actor.role === "client_member" || isManagerRole(actor.role))) {
    throw new AuthzError("Only an accountable organization member or operations manager can decide approval.");
  }
  requireUuid(approvalId, "approvalId");
  if (decisionNote.length > 2000) throw new DomainError("decisionNote must be at most 2000 characters.");
  const db = runtimeDb();
  const { data: approval, error: approvalError } = await db
    .from("execution_approval_requests")
    .select("id, organization_id, status")
    .eq("id", approvalId)
    .maybeSingle();
  if (approvalError) throw new DomainError(approvalError.message);
  if (!approval) throw new DomainError("Execution approval request not found.");
  assertOrgAccess(actor, String(approval.organization_id));
  const { error } = await db.rpc("decide_execution_approval", {
    p_approval_id: approvalId,
    p_decision: decision,
    p_decided_by: actor.id,
    p_decision_note: decisionNote.trim(),
  });
  if (error) throw new DomainError(error.message);
  await recordAudit(db, actor, String(approval.organization_id), "execution.runtime_approval_decided", "execution_approval", approvalId, {
    decision,
  });
}

export async function cancelExecutionPlan(actor: Actor, planId: string) {
  requireManager(actor);
  const db = runtimeDb();
  const row = await loadPlan(db, planId);
  assertOrgAccess(actor, String(row.organization_id));
  const { error } = await db.rpc("cancel_execution_plan", { p_plan_id: planId, p_actor_id: actor.id });
  if (error) throw new DomainError(error.message);
  await recordAudit(db, actor, String(row.organization_id), "execution.runtime_plan_cancelled", "execution_plan", planId, {
    planHash: String(row.plan_hash),
  });
}
