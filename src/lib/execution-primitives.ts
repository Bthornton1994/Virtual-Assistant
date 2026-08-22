import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AuthzError,
  DomainError,
  assertOrgAccess,
  isOpsRole,
  type ActionClass,
  type Actor,
} from "@/lib/domain";
import {
  canTransitionWorkstreamRun,
  finalRunStatusForReceipt,
  requiresEvidence,
  type WorkstreamRunStatus,
} from "@/lib/execution-policy";
import { supabaseServer } from "@/lib/supabase/server";

export type DelegationSpecStatus = "draft" | "active" | "retired";
export type EvidenceKind =
  | "source"
  | "before_after"
  | "test"
  | "deployment"
  | "communication"
  | "reconciliation"
  | "observation"
  | "other";

export type DelegationSpec = {
  id: string;
  organizationId: string;
  workstreamId: string | null;
  version: number;
  status: DelegationSpecStatus;
  objective: string;
  definitionOfDone: string[];
  triggerDescription: string;
  requiredInputs: string[];
  actionClass: ActionClass;
  authorityRules: string[];
  approvalPoints: string[];
  verificationRules: string[];
  exceptionPolicy: string[];
  sla: string;
  economicEnvelope: Record<string, unknown>;
  dataPolicy: Record<string, unknown>;
  createdBy: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkstreamRun = {
  id: string;
  organizationId: string;
  workstreamId: string | null;
  requestId: string | null;
  delegationSpecId: string;
  status: WorkstreamRunStatus;
  initiatedBy: string | null;
  executorSummary: Record<string, unknown>;
  humanMinutes: number;
  ownerMinutes: number;
  aiCostMicros: number;
  toolCostMicros: number;
  startedAt: string | null;
  completedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceArtifact = {
  id: string;
  organizationId: string;
  runId: string;
  requestId: string | null;
  kind: EvidenceKind;
  summary: string;
  sourceUri: string | null;
  contentHash: string | null;
  payload: Record<string, unknown>;
  observedAt: string;
  createdBy: string | null;
  createdAt: string;
};

export type OutcomeReceipt = {
  id: string;
  organizationId: string;
  runId: string;
  verificationStatus: "passed" | "failed";
  definitionOfDoneMet: boolean;
  summary: string;
  verificationNotes: string;
  actionsTaken: string[];
  exceptions: string[];
  unresolvedDecisions: string[];
  qaScore: number | null;
  verifiedBy: string | null;
  verifiedAt: string;
  createdAt: string;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function mapSpec(row: Record<string, unknown>): DelegationSpec {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workstreamId: (row.workstream_id as string) ?? null,
    version: Number(row.version),
    status: row.status as DelegationSpecStatus,
    objective: String(row.objective ?? ""),
    definitionOfDone: asStringArray(row.definition_of_done),
    triggerDescription: String(row.trigger_description ?? ""),
    requiredInputs: asStringArray(row.required_inputs),
    actionClass: row.action_class as ActionClass,
    authorityRules: asStringArray(row.authority_rules),
    approvalPoints: asStringArray(row.approval_points),
    verificationRules: asStringArray(row.verification_rules),
    exceptionPolicy: asStringArray(row.exception_policy),
    sla: String(row.sla ?? ""),
    economicEnvelope: asObject(row.economic_envelope),
    dataPolicy: asObject(row.data_policy),
    createdBy: (row.created_by as string) ?? null,
    activatedBy: (row.activated_by as string) ?? null,
    activatedAt: (row.activated_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRun(row: Record<string, unknown>): WorkstreamRun {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workstreamId: (row.workstream_id as string) ?? null,
    requestId: (row.request_id as string) ?? null,
    delegationSpecId: String(row.delegation_spec_id),
    status: row.status as WorkstreamRunStatus,
    initiatedBy: (row.initiated_by as string) ?? null,
    executorSummary: asObject(row.executor_summary),
    humanMinutes: Number(row.human_minutes ?? 0),
    ownerMinutes: Number(row.owner_minutes ?? 0),
    aiCostMicros: Number(row.ai_cost_micros ?? 0),
    toolCostMicros: Number(row.tool_cost_micros ?? 0),
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapEvidence(row: Record<string, unknown>): EvidenceArtifact {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    runId: String(row.run_id),
    requestId: (row.request_id as string) ?? null,
    kind: row.kind as EvidenceKind,
    summary: String(row.summary ?? ""),
    sourceUri: (row.source_uri as string) ?? null,
    contentHash: (row.content_hash as string) ?? null,
    payload: asObject(row.payload),
    observedAt: String(row.observed_at),
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
  };
}

function mapReceipt(row: Record<string, unknown>): OutcomeReceipt {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    runId: String(row.run_id),
    verificationStatus: row.verification_status as "passed" | "failed",
    definitionOfDoneMet: Boolean(row.definition_of_done_met),
    summary: String(row.summary ?? ""),
    verificationNotes: String(row.verification_notes ?? ""),
    actionsTaken: asStringArray(row.actions_taken),
    exceptions: asStringArray(row.exceptions),
    unresolvedDecisions: asStringArray(row.unresolved_decisions),
    qaScore: row.qa_score === null || row.qa_score === undefined ? null : Number(row.qa_score),
    verifiedBy: (row.verified_by as string) ?? null,
    verifiedAt: String(row.verified_at),
    createdAt: String(row.created_at),
  };
}

async function persistentDb(actor: Actor): Promise<SupabaseClient> {
  if (actor.source === "demo") {
    throw new DomainError("Execution primitives require the persistent Supabase workspace; demo mode is read-only for this feature.");
  }
  const db = await supabaseServer();
  if (!db) throw new DomainError("Execution primitives require Supabase.");
  return db;
}

function canAuthorSpec(actor: Actor) {
  return actor.role === "client_admin" || actor.role === "ops_manager" || actor.role === "platform_admin";
}

function canActivateSpec(actor: Actor) {
  return actor.role === "ops_manager" || actor.role === "platform_admin";
}

function canVerifyRun(actor: Actor) {
  return actor.role === "ops_manager" || actor.role === "platform_admin";
}

function canOperateRun(actor: Actor) {
  return isOpsRole(actor.role);
}

async function audit(
  db: SupabaseClient,
  actor: Actor,
  organizationId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await db.from("audit_events").insert({
    organization_id: organizationId,
    actor_id: actor.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (error) throw new DomainError(error.message || "Could not record execution audit event");
}

export async function listDelegationSpecs(actor: Actor, organizationId?: string) {
  const db = await persistentDb(actor);
  let query = db.from("delegation_specs").select("*").order("created_at", { ascending: false });
  if (organizationId) {
    assertOrgAccess(actor, organizationId);
    query = query.eq("organization_id", organizationId);
  }
  const { data, error } = await query;
  if (error) throw new DomainError(error.message);
  return (data ?? []).map((row) => mapSpec(row as Record<string, unknown>));
}

export async function createDelegationSpec(
  actor: Actor,
  input: {
    workstreamId: string;
    objective: string;
    definitionOfDone: string[];
    triggerDescription: string;
    requiredInputs: string[];
    actionClass: ActionClass;
    authorityRules: string[];
    approvalPoints: string[];
    verificationRules: string[];
    exceptionPolicy: string[];
    sla: string;
    economicEnvelope?: Record<string, unknown>;
    dataPolicy?: Record<string, unknown>;
  },
) {
  if (!canAuthorSpec(actor)) throw new AuthzError("Only organization admins or operations managers can author Delegation Specs");
  if (!input.objective.trim()) throw new DomainError("A Delegation Spec requires an objective");
  if (!input.definitionOfDone.length) throw new DomainError("A Delegation Spec requires at least one definition-of-done criterion");
  const db = await persistentDb(actor);
  const { data: workstream, error: workstreamError } = await db
    .from("workstreams")
    .select("id, organization_id")
    .eq("id", input.workstreamId)
    .maybeSingle();
  if (workstreamError) throw new DomainError(workstreamError.message);
  if (!workstream) throw new DomainError("Workstream not found");
  assertOrgAccess(actor, workstream.organization_id);

  const { data: versions, error: versionError } = await db
    .from("delegation_specs")
    .select("version")
    .eq("organization_id", workstream.organization_id)
    .eq("workstream_id", input.workstreamId)
    .order("version", { ascending: false })
    .limit(1);
  if (versionError) throw new DomainError(versionError.message);
  const nextVersion = Number(versions?.[0]?.version ?? 0) + 1;

  const { data, error } = await db
    .from("delegation_specs")
    .insert({
      organization_id: workstream.organization_id,
      workstream_id: input.workstreamId,
      version: nextVersion,
      status: "draft",
      objective: input.objective.trim(),
      definition_of_done: input.definitionOfDone,
      trigger_description: input.triggerDescription.trim(),
      required_inputs: input.requiredInputs,
      action_class: input.actionClass,
      authority_rules: input.authorityRules,
      approval_points: input.approvalPoints,
      verification_rules: input.verificationRules,
      exception_policy: input.exceptionPolicy,
      sla: input.sla.trim(),
      economic_envelope: input.economicEnvelope ?? {},
      data_policy: input.dataPolicy ?? {},
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, workstream.organization_id, "execution.spec_created", "delegation_spec", data.id, {
    workstreamId: input.workstreamId,
    version: nextVersion,
    actionClass: input.actionClass,
  });
  return mapSpec(data as Record<string, unknown>);
}

export async function activateDelegationSpec(actor: Actor, specId: string) {
  if (!canActivateSpec(actor)) throw new AuthzError("Only operations managers can activate a Delegation Spec");
  const db = await persistentDb(actor);
  const { data: specRow, error: specError } = await db.from("delegation_specs").select("*").eq("id", specId).maybeSingle();
  if (specError) throw new DomainError(specError.message);
  if (!specRow) throw new DomainError("Delegation Spec not found");
  const spec = mapSpec(specRow as Record<string, unknown>);
  assertOrgAccess(actor, spec.organizationId);
  if (spec.status !== "draft") throw new DomainError("Only a draft Delegation Spec can be activated");
  if (!spec.workstreamId) throw new DomainError("Step 2 requires a Delegation Spec to belong to a workstream");

  const { data: active, error: activeError } = await db
    .from("delegation_specs")
    .select("id")
    .eq("organization_id", spec.organizationId)
    .eq("workstream_id", spec.workstreamId)
    .eq("status", "active")
    .maybeSingle();
  if (activeError) throw new DomainError(activeError.message);
  if (active) throw new DomainError("That workstream already has an active Delegation Spec");

  const { data, error } = await db
    .from("delegation_specs")
    .update({ status: "active", activated_by: actor.id, activated_at: new Date().toISOString() })
    .eq("id", specId)
    .eq("status", "draft")
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, spec.organizationId, "execution.spec_activated", "delegation_spec", specId, {
    workstreamId: spec.workstreamId,
    version: spec.version,
  });
  return mapSpec(data as Record<string, unknown>);
}

export async function listWorkstreamRuns(actor: Actor, organizationId?: string) {
  const db = await persistentDb(actor);
  let query = db.from("workstream_runs").select("*").order("created_at", { ascending: false });
  if (organizationId) {
    assertOrgAccess(actor, organizationId);
    query = query.eq("organization_id", organizationId);
  }
  const { data, error } = await query;
  if (error) throw new DomainError(error.message);
  return (data ?? []).map((row) => mapRun(row as Record<string, unknown>));
}

export async function createWorkstreamRun(actor: Actor, specId: string) {
  if (!canOperateRun(actor)) throw new AuthzError("Only operations staff can create workstream runs");
  const db = await persistentDb(actor);
  const { data: specRow, error: specError } = await db.from("delegation_specs").select("*").eq("id", specId).maybeSingle();
  if (specError) throw new DomainError(specError.message);
  if (!specRow) throw new DomainError("Delegation Spec not found");
  const spec = mapSpec(specRow as Record<string, unknown>);
  assertOrgAccess(actor, spec.organizationId);
  if (spec.status !== "active") throw new DomainError("A run can only start from an active Delegation Spec");

  const { data, error } = await db
    .from("workstream_runs")
    .insert({
      organization_id: spec.organizationId,
      workstream_id: spec.workstreamId,
      delegation_spec_id: spec.id,
      status: "planned",
      initiated_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, spec.organizationId, "execution.run_created", "workstream_run", data.id, {
    delegationSpecId: spec.id,
    specVersion: spec.version,
  });
  return mapRun(data as Record<string, unknown>);
}

export async function getWorkstreamRunBundle(actor: Actor, runId: string) {
  const db = await persistentDb(actor);
  const { data: runRow, error: runError } = await db.from("workstream_runs").select("*").eq("id", runId).maybeSingle();
  if (runError) throw new DomainError(runError.message);
  if (!runRow) throw new DomainError("Workstream run not found");
  const run = mapRun(runRow as Record<string, unknown>);
  assertOrgAccess(actor, run.organizationId);
  const [specResult, evidenceResult, receiptResult] = await Promise.all([
    db.from("delegation_specs").select("*").eq("id", run.delegationSpecId).single(),
    db.from("evidence_artifacts").select("*").eq("run_id", run.id).order("created_at", { ascending: true }),
    db.from("outcome_receipts").select("*").eq("run_id", run.id).maybeSingle(),
  ]);
  if (specResult.error) throw new DomainError(specResult.error.message);
  if (evidenceResult.error) throw new DomainError(evidenceResult.error.message);
  if (receiptResult.error) throw new DomainError(receiptResult.error.message);
  return {
    run,
    spec: mapSpec(specResult.data as Record<string, unknown>),
    evidence: (evidenceResult.data ?? []).map((row) => mapEvidence(row as Record<string, unknown>)),
    receipt: receiptResult.data ? mapReceipt(receiptResult.data as Record<string, unknown>) : null,
  };
}

export async function transitionWorkstreamRun(
  actor: Actor,
  runId: string,
  to: WorkstreamRunStatus,
  patch?: {
    humanMinutes?: number;
    ownerMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
    notes?: string;
    executorSummary?: Record<string, unknown>;
  },
) {
  if (!canOperateRun(actor)) throw new AuthzError("Only operations staff can run delegated work");
  const db = await persistentDb(actor);
  const { data: row, error: readError } = await db.from("workstream_runs").select("*").eq("id", runId).maybeSingle();
  if (readError) throw new DomainError(readError.message);
  if (!row) throw new DomainError("Workstream run not found");
  const run = mapRun(row as Record<string, unknown>);
  assertOrgAccess(actor, run.organizationId);
  if (!canTransitionWorkstreamRun(run.status, to)) throw new DomainError(`Cannot move workstream run ${run.status} → ${to}`);

  for (const [name, value] of Object.entries({
    humanMinutes: patch?.humanMinutes,
    ownerMinutes: patch?.ownerMinutes,
    aiCostMicros: patch?.aiCostMicros,
    toolCostMicros: patch?.toolCostMicros,
  })) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new DomainError(`${name} must be zero or greater`);
  }

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = { status: to };
  if (to === "running" && !run.startedAt) payload.started_at = now;
  if (["failed", "cancelled"].includes(to)) payload.completed_at = now;
  if (patch?.humanMinutes !== undefined) payload.human_minutes = patch.humanMinutes;
  if (patch?.ownerMinutes !== undefined) payload.owner_minutes = patch.ownerMinutes;
  if (patch?.aiCostMicros !== undefined) payload.ai_cost_micros = Math.round(patch.aiCostMicros);
  if (patch?.toolCostMicros !== undefined) payload.tool_cost_micros = Math.round(patch.toolCostMicros);
  if (patch?.notes !== undefined) payload.notes = patch.notes;
  if (patch?.executorSummary !== undefined) payload.executor_summary = patch.executorSummary;

  const { data, error } = await db.from("workstream_runs").update(payload).eq("id", runId).select("*").single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, run.organizationId, "execution.run_status_changed", "workstream_run", runId, {
    from: run.status,
    to,
  });
  return mapRun(data as Record<string, unknown>);
}

export async function addEvidenceArtifact(
  actor: Actor,
  runId: string,
  input: { kind: EvidenceKind; summary: string; sourceUri?: string | null; payload?: Record<string, unknown> },
) {
  if (!canOperateRun(actor)) throw new AuthzError("Only operations staff can attach execution evidence");
  if (!input.summary.trim()) throw new DomainError("Evidence requires a summary");
  const db = await persistentDb(actor);
  const { data: runRow, error: runError } = await db.from("workstream_runs").select("*").eq("id", runId).maybeSingle();
  if (runError) throw new DomainError(runError.message);
  if (!runRow) throw new DomainError("Workstream run not found");
  const run = mapRun(runRow as Record<string, unknown>);
  assertOrgAccess(actor, run.organizationId);
  if (run.status !== "running") throw new DomainError("Evidence can only be added while a run is in progress");

  const payload = input.payload ?? {};
  const contentHash = createHash("sha256")
    .update(JSON.stringify({ kind: input.kind, summary: input.summary.trim(), sourceUri: input.sourceUri ?? null, payload }))
    .digest("hex");
  const { data, error } = await db
    .from("evidence_artifacts")
    .insert({
      organization_id: run.organizationId,
      run_id: run.id,
      request_id: run.requestId,
      kind: input.kind,
      summary: input.summary.trim(),
      source_uri: input.sourceUri?.trim() || null,
      content_hash: contentHash,
      payload,
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, run.organizationId, "execution.evidence_added", "evidence_artifact", data.id, {
    runId,
    kind: input.kind,
    contentHash,
  });
  return mapEvidence(data as Record<string, unknown>);
}

export async function verifyWorkstreamRun(
  actor: Actor,
  runId: string,
  input: {
    verificationStatus: "passed" | "failed";
    definitionOfDoneMet: boolean;
    summary: string;
    verificationNotes: string;
    actionsTaken: string[];
    exceptions: string[];
    unresolvedDecisions: string[];
    qaScore?: number | null;
  },
) {
  if (!canVerifyRun(actor)) throw new AuthzError("Only operations managers can issue Outcome Receipts");
  if (!input.summary.trim()) throw new DomainError("Outcome Receipt requires a summary");
  if (input.verificationStatus === "passed" && !input.definitionOfDoneMet) {
    throw new DomainError("A run cannot pass verification when its definition of done is not met");
  }
  if (input.qaScore !== undefined && input.qaScore !== null && (input.qaScore < 0 || input.qaScore > 100)) {
    throw new DomainError("QA score must be between 0 and 100");
  }

  const db = await persistentDb(actor);
  const { data: runRow, error: runError } = await db.from("workstream_runs").select("*").eq("id", runId).maybeSingle();
  if (runError) throw new DomainError(runError.message);
  if (!runRow) throw new DomainError("Workstream run not found");
  const run = mapRun(runRow as Record<string, unknown>);
  assertOrgAccess(actor, run.organizationId);

  const { data: existing, error: existingError } = await db.from("outcome_receipts").select("*").eq("run_id", runId).maybeSingle();
  if (existingError) throw new DomainError(existingError.message);
  if (existing) {
    const receipt = mapReceipt(existing as Record<string, unknown>);
    const finalStatus = finalRunStatusForReceipt(receipt.verificationStatus, receipt.definitionOfDoneMet);
    if (run.status !== finalStatus) {
      await db.from("workstream_runs").update({ status: finalStatus, completed_at: receipt.verifiedAt }).eq("id", runId);
    }
    return receipt;
  }

  if (run.status !== "awaiting_verification") throw new DomainError("Only a submitted run can be verified");
  const { data: specRow, error: specError } = await db.from("delegation_specs").select("*").eq("id", run.delegationSpecId).single();
  if (specError) throw new DomainError(specError.message);
  const spec = mapSpec(specRow as Record<string, unknown>);
  const { count: evidenceCount, error: evidenceError } = await db
    .from("evidence_artifacts")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId);
  if (evidenceError) throw new DomainError(evidenceError.message);
  if (input.verificationStatus === "passed" && requiresEvidence(spec.verificationRules) && !evidenceCount) {
    throw new DomainError("This Delegation Spec requires evidence before a run can pass verification");
  }

  const finalStatus = finalRunStatusForReceipt(input.verificationStatus, input.definitionOfDoneMet);
  const verifiedAt = new Date().toISOString();
  const { data, error } = await db
    .from("outcome_receipts")
    .insert({
      organization_id: run.organizationId,
      run_id: run.id,
      verification_status: input.verificationStatus,
      definition_of_done_met: input.definitionOfDoneMet,
      summary: input.summary.trim(),
      verification_notes: input.verificationNotes.trim(),
      actions_taken: input.actionsTaken,
      exceptions: input.exceptions,
      unresolved_decisions: input.unresolvedDecisions,
      qa_score: input.qaScore ?? null,
      verified_by: actor.id,
      verified_at: verifiedAt,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);

  const { error: finalError } = await db
    .from("workstream_runs")
    .update({ status: finalStatus, completed_at: verifiedAt })
    .eq("id", run.id);
  if (finalError) throw new DomainError(finalError.message);
  await audit(db, actor, run.organizationId, "execution.outcome_receipt_issued", "outcome_receipt", data.id, {
    runId,
    finalStatus,
    verificationStatus: input.verificationStatus,
    definitionOfDoneMet: input.definitionOfDoneMet,
    evidenceCount: evidenceCount ?? 0,
  });
  return mapReceipt(data as Record<string, unknown>);
}
