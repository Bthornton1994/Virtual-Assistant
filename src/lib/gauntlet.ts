import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError, DomainError, assertOrgAccess, isOpsRole, type Actor } from "@/lib/domain";
import { supabaseServer } from "@/lib/supabase/server";
import {
  DEFAULT_AUTONOMY_POLICY,
  defaultRetryDecision,
  evaluateAutonomy,
  type AutonomyDecisionKind,
  type AutonomyLevel,
  type AutonomyMetrics,
  type AutonomyPolicy,
  type AutonomyProfileState,
  type FailureClassification,
  type ImpactDirection,
  type RetryDecision,
} from "@/lib/gauntlet-policy";

export type GauntletCycle = {
  id: string;
  organizationId: string;
  workstreamId: string;
  delegationSpecId: string;
  sequence: number;
  status: string;
  recurrenceMode: "manual" | "recurring" | "event";
  triggerKind: string;
  triggerRef: string | null;
  objectiveSnapshot: string;
  hypothesis: string;
  parentCycleId: string | null;
  reentryReason: string;
  createdBy: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutonomyProfile = {
  id: string;
  organizationId: string;
  workstreamId: string;
  currentLevel: AutonomyLevel;
  maxLevel: AutonomyLevel;
  state: AutonomyProfileState;
  policy: AutonomyPolicy;
  policyVersion: number;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapCycle(row: Record<string, unknown>): GauntletCycle {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workstreamId: String(row.workstream_id),
    delegationSpecId: String(row.delegation_spec_id),
    sequence: Number(row.sequence),
    status: String(row.status),
    recurrenceMode: row.recurrence_mode as GauntletCycle["recurrenceMode"],
    triggerKind: String(row.trigger_kind),
    triggerRef: (row.trigger_ref as string) ?? null,
    objectiveSnapshot: String(row.objective_snapshot ?? ""),
    hypothesis: String(row.hypothesis ?? ""),
    parentCycleId: (row.parent_cycle_id as string) ?? null,
    reentryReason: String(row.reentry_reason ?? ""),
    createdBy: (row.created_by as string) ?? null,
    startedAt: String(row.started_at),
    endedAt: (row.ended_at as string) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPolicy(value: unknown): AutonomyPolicy {
  const raw = asObject(value);
  return {
    ...DEFAULT_AUTONOMY_POLICY,
    minimumVerifiedRunsForPromotion:
      raw.minimumVerifiedRunsForPromotion === null || raw.minimumVerifiedRunsForPromotion === undefined
        ? null
        : Number(raw.minimumVerifiedRunsForPromotion),
    minimumQaScore: raw.minimumQaScore === null || raw.minimumQaScore === undefined ? null : Number(raw.minimumQaScore),
    maximumFailureRate:
      raw.maximumFailureRate === null || raw.maximumFailureRate === undefined ? null : Number(raw.maximumFailureRate),
    maximumExceptionRate:
      raw.maximumExceptionRate === null || raw.maximumExceptionRate === undefined ? null : Number(raw.maximumExceptionRate),
    maximumOwnerMinutesPerRun:
      raw.maximumOwnerMinutesPerRun === null || raw.maximumOwnerMinutesPerRun === undefined
        ? null
        : Number(raw.maximumOwnerMinutesPerRun),
    requireImprovedImpactForPromotion:
      raw.requireImprovedImpactForPromotion === undefined ? true : Boolean(raw.requireImprovedImpactForPromotion),
    allowAutomaticPromotion: Boolean(raw.allowAutomaticPromotion),
    promotionRequiresApproval: raw.promotionRequiresApproval === undefined ? true : Boolean(raw.promotionRequiresApproval),
    autoDemoteOnHardGateFailure:
      raw.autoDemoteOnHardGateFailure === undefined ? true : Boolean(raw.autoDemoteOnHardGateFailure),
    autoDemoteOnRegression: raw.autoDemoteOnRegression === undefined ? true : Boolean(raw.autoDemoteOnRegression),
    autoSuspendOnAuthorityIncident:
      raw.autoSuspendOnAuthorityIncident === undefined ? true : Boolean(raw.autoSuspendOnAuthorityIncident),
  };
}

function mapProfile(row: Record<string, unknown>): AutonomyProfile {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    workstreamId: String(row.workstream_id),
    currentLevel: Number(row.current_level) as AutonomyLevel,
    maxLevel: Number(row.max_level) as AutonomyLevel,
    state: row.state as AutonomyProfileState,
    policy: mapPolicy(row.policy),
    policyVersion: Number(row.policy_version),
  };
}

async function persistentDb(actor: Actor): Promise<SupabaseClient> {
  if (actor.source === "demo") throw new DomainError("The Gauntlet requires the persistent Supabase workspace.");
  const db = await supabaseServer();
  if (!db) throw new DomainError("The Gauntlet requires Supabase.");
  return db;
}

function managerOnly(actor: Actor) {
  if (actor.role !== "ops_manager" && actor.role !== "platform_admin") {
    throw new AuthzError("Only operations managers can change Gauntlet governance or autonomy.");
  }
}

function opsOnly(actor: Actor) {
  if (!isOpsRole(actor.role)) throw new AuthzError("Only operations staff can operate the Gauntlet.");
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
  if (error) throw new DomainError(error.message || "Could not record Gauntlet audit event");
}

export async function listGauntletCycles(actor: Actor, organizationId?: string) {
  const db = await persistentDb(actor);
  let query = db.from("gauntlet_cycles").select("*").order("created_at", { ascending: false });
  if (organizationId) {
    assertOrgAccess(actor, organizationId);
    query = query.eq("organization_id", organizationId);
  }
  const { data, error } = await query;
  if (error) throw new DomainError(error.message);
  return (data ?? []).map((row) => mapCycle(row as Record<string, unknown>));
}

export async function listAutonomyProfiles(actor: Actor) {
  const db = await persistentDb(actor);
  const { data, error } = await db.from("workstream_autonomy_profiles").select("*").order("updated_at", { ascending: false });
  if (error) throw new DomainError(error.message);
  return (data ?? []).map((row) => mapProfile(row as Record<string, unknown>));
}

export async function createGauntletCycle(
  actor: Actor,
  input: {
    delegationSpecId: string;
    recurrenceMode: "manual" | "recurring" | "event";
    triggerKind?: "manual" | "scheduled" | "event";
    triggerRef?: string | null;
    hypothesis?: string;
  },
) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const { data: spec, error: specError } = await db
    .from("delegation_specs")
    .select("id, organization_id, workstream_id, objective, status")
    .eq("id", input.delegationSpecId)
    .maybeSingle();
  if (specError) throw new DomainError(specError.message);
  if (!spec || spec.status !== "active") throw new DomainError("Gauntlet cycles require an active Delegation Spec.");
  assertOrgAccess(actor, spec.organization_id);

  const { data: sequenceRows, error: sequenceError } = await db
    .from("gauntlet_cycles")
    .select("sequence")
    .eq("organization_id", spec.organization_id)
    .eq("workstream_id", spec.workstream_id)
    .order("sequence", { ascending: false })
    .limit(1);
  if (sequenceError) throw new DomainError(sequenceError.message);
  const sequence = Number(sequenceRows?.[0]?.sequence ?? 0) + 1;

  const { error: profileError } = await db.from("workstream_autonomy_profiles").upsert(
    {
      organization_id: spec.organization_id,
      workstream_id: spec.workstream_id,
      current_level: 0,
      max_level: 4,
      state: "active",
      policy: DEFAULT_AUTONOMY_POLICY,
      updated_by: actor.id,
    },
    { onConflict: "organization_id,workstream_id", ignoreDuplicates: true },
  );
  if (profileError) throw new DomainError(profileError.message);

  const { data, error } = await db
    .from("gauntlet_cycles")
    .insert({
      organization_id: spec.organization_id,
      workstream_id: spec.workstream_id,
      delegation_spec_id: spec.id,
      sequence,
      recurrence_mode: input.recurrenceMode,
      trigger_kind: input.triggerKind ?? "manual",
      trigger_ref: input.triggerRef ?? null,
      objective_snapshot: spec.objective,
      hypothesis: input.hypothesis?.trim() ?? "",
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, spec.organization_id, "gauntlet.cycle_created", "gauntlet_cycle", data.id, {
    workstreamId: spec.workstream_id,
    sequence,
    recurrenceMode: input.recurrenceMode,
  });
  return mapCycle(data as Record<string, unknown>);
}

async function getCycleRow(db: SupabaseClient, cycleId: string) {
  const { data, error } = await db.from("gauntlet_cycles").select("*").eq("id", cycleId).maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Gauntlet cycle not found.");
  return data as Record<string, unknown>;
}

export async function addGauntletObservation(
  actor: Actor,
  cycleId: string,
  input: { signalType: string; summary: string; sourceUri?: string | null; payload?: Record<string, unknown> },
) {
  opsOnly(actor);
  if (!input.summary.trim() || !input.signalType.trim()) throw new DomainError("Observation requires a signal type and summary.");
  const db = await persistentDb(actor);
  const cycle = mapCycle(await getCycleRow(db, cycleId));
  assertOrgAccess(actor, cycle.organizationId);
  if (cycle.status !== "observing") throw new DomainError("Observations can only be added while the cycle is observing.");
  const { data, error } = await db
    .from("gauntlet_observations")
    .insert({
      organization_id: cycle.organizationId,
      cycle_id: cycle.id,
      signal_type: input.signalType.trim(),
      summary: input.summary.trim(),
      source_uri: input.sourceUri?.trim() || null,
      payload: input.payload ?? {},
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, cycle.organizationId, "gauntlet.observation_added", "gauntlet_observation", data.id, { cycleId });
  return data;
}

export async function diagnoseGauntletCycle(
  actor: Actor,
  cycleId: string,
  input: { diagnosis: string; bindingConstraint: string; selectedAction: string; hypothesis: string; evidenceRefs?: string[] },
) {
  opsOnly(actor);
  if (![input.diagnosis, input.bindingConstraint, input.selectedAction, input.hypothesis].every((value) => value.trim())) {
    throw new DomainError("Diagnosis, binding constraint, selected action, and hypothesis are all required.");
  }
  const db = await persistentDb(actor);
  const cycle = mapCycle(await getCycleRow(db, cycleId));
  assertOrgAccess(actor, cycle.organizationId);
  const { data, error } = await db
    .from("gauntlet_diagnoses")
    .insert({
      organization_id: cycle.organizationId,
      cycle_id: cycle.id,
      diagnosis: input.diagnosis.trim(),
      binding_constraint: input.bindingConstraint.trim(),
      selected_action: input.selectedAction.trim(),
      hypothesis: input.hypothesis.trim(),
      evidence_refs: input.evidenceRefs ?? [],
      diagnosed_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, cycle.organizationId, "gauntlet.diagnosis_locked", "gauntlet_diagnosis", data.id, { cycleId });
  return data;
}

export async function createGauntletAttempt(actor: Actor, cycleId: string, retryOfRunId?: string | null) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const cycle = mapCycle(await getCycleRow(db, cycleId));
  assertOrgAccess(actor, cycle.organizationId);
  if (!['executing', 'corrective_action'].includes(cycle.status)) throw new DomainError("Cycle is not ready for an execution attempt.");

  const { data: attempts, error: attemptError } = await db
    .from("workstream_runs")
    .select("attempt_number")
    .eq("gauntlet_cycle_id", cycle.id)
    .order("attempt_number", { ascending: false })
    .limit(1);
  if (attemptError) throw new DomainError(attemptError.message);
  const attemptNumber = Number(attempts?.[0]?.attempt_number ?? 0) + 1;

  const { data, error } = await db
    .from("workstream_runs")
    .insert({
      organization_id: cycle.organizationId,
      workstream_id: cycle.workstreamId,
      delegation_spec_id: cycle.delegationSpecId,
      status: "planned",
      initiated_by: actor.id,
      gauntlet_cycle_id: cycle.id,
      attempt_number: attemptNumber,
      retry_of_run_id: retryOfRunId ?? null,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, cycle.organizationId, "gauntlet.attempt_created", "workstream_run", data.id, {
    cycleId,
    attemptNumber,
    retryOfRunId: retryOfRunId ?? null,
  });
  return data;
}

export async function addGauntletReview(
  actor: Actor,
  runId: string,
  input: {
    reviewerKind: "human" | "deterministic" | "agent" | "hybrid";
    reviewerRef?: string;
    verdict: "passed" | "failed" | "inconclusive";
    hardGatePass: boolean;
    challengedAssumptions: string[];
    defects: unknown[];
    evidenceGaps: string[];
    authorityIncidents: unknown[];
    notes?: string;
  },
) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const { data: run, error: runError } = await db
    .from("workstream_runs")
    .select("id, organization_id, gauntlet_cycle_id, status, initiated_by")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw new DomainError(runError.message);
  if (!run?.gauntlet_cycle_id) throw new DomainError("Run is not attached to a Gauntlet cycle.");
  assertOrgAccess(actor, run.organization_id);
  if (run.status !== "awaiting_verification") throw new DomainError("Adversarial review requires a submitted run.");
  if (input.reviewerKind === "human" && run.initiated_by === actor.id) {
    throw new AuthzError("A human executor cannot independently review their own Gauntlet attempt.");
  }
  if (input.verdict === "passed" && !input.hardGatePass) throw new DomainError("A passing review requires the hard gate to pass.");

  const { data, error } = await db
    .from("gauntlet_reviews")
    .insert({
      organization_id: run.organization_id,
      cycle_id: run.gauntlet_cycle_id,
      run_id: run.id,
      reviewer_kind: input.reviewerKind,
      reviewer_ref: input.reviewerRef?.trim() ?? "",
      independent: true,
      verdict: input.verdict,
      hard_gate_pass: input.hardGatePass,
      challenged_assumptions: input.challengedAssumptions,
      defects: input.defects,
      evidence_gaps: input.evidenceGaps,
      authority_incidents: input.authorityIncidents,
      notes: input.notes?.trim() ?? "",
      reviewed_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, run.organization_id, "gauntlet.review_recorded", "gauntlet_review", data.id, {
    runId,
    verdict: input.verdict,
    hardGatePass: input.hardGatePass,
  });
  return data;
}

export async function classifyGauntletFailure(
  actor: Actor,
  failureId: string,
  input: {
    classification: FailureClassification;
    severity: "low" | "medium" | "high" | "critical";
    retryDecision?: RetryDecision;
    rootCause: string;
    correctiveAction: string;
  },
) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const { data: failure, error: readError } = await db.from("gauntlet_failures").select("*").eq("id", failureId).maybeSingle();
  if (readError) throw new DomainError(readError.message);
  if (!failure) throw new DomainError("Gauntlet failure not found.");
  assertOrgAccess(actor, failure.organization_id);
  if (failure.status !== "open") throw new DomainError("Only open failures can be classified.");
  const retryDecision = input.retryDecision ?? defaultRetryDecision(input.classification, input.severity);
  const { data, error } = await db
    .from("gauntlet_failures")
    .update({
      classification: input.classification,
      severity: input.severity,
      retry_decision: retryDecision,
      root_cause: input.rootCause.trim(),
      corrective_action: input.correctiveAction.trim(),
    })
    .eq("id", failureId)
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, failure.organization_id, "gauntlet.failure_classified", "gauntlet_failure", failureId, {
    classification: input.classification,
    severity: input.severity,
    retryDecision,
  });
  return data;
}

export async function resolveGauntletFailure(actor: Actor, failureId: string) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const { data: failure, error: readError } = await db.from("gauntlet_failures").select("*").eq("id", failureId).maybeSingle();
  if (readError) throw new DomainError(readError.message);
  if (!failure) throw new DomainError("Gauntlet failure not found.");
  assertOrgAccess(actor, failure.organization_id);
  const { data, error } = await db
    .from("gauntlet_failures")
    .update({ status: "resolved", resolved_by: actor.id, resolved_at: new Date().toISOString() })
    .eq("id", failureId)
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  return data;
}

export async function addGauntletImpactAssessment(
  actor: Actor,
  cycleId: string,
  input: {
    direction: ImpactDirection;
    hypothesis: string;
    primaryMetric: string;
    baseline: Record<string, unknown>;
    observed: Record<string, unknown>;
    delta: Record<string, unknown>;
    guardrails: unknown[];
    evidenceRefs: string[];
    evidenceQuality: "weak" | "moderate" | "strong";
    interpretation: string;
  },
) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const cycle = mapCycle(await getCycleRow(db, cycleId));
  assertOrgAccess(actor, cycle.organizationId);
  if (cycle.status !== "impact_review") throw new DomainError("Cycle is not ready for business-impact assessment.");

  const { data: run, error: runError } = await db
    .from("workstream_runs")
    .select("id")
    .eq("gauntlet_cycle_id", cycle.id)
    .eq("status", "verified")
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new DomainError(runError.message);
  if (!run) throw new DomainError("No verified Gauntlet run exists for impact assessment.");
  const { data: receipt, error: receiptError } = await db.from("outcome_receipts").select("id").eq("run_id", run.id).single();
  if (receiptError) throw new DomainError(receiptError.message);

  const { data, error } = await db
    .from("gauntlet_impact_assessments")
    .insert({
      organization_id: cycle.organizationId,
      cycle_id: cycle.id,
      run_id: run.id,
      receipt_id: receipt.id,
      direction: input.direction,
      hypothesis: input.hypothesis.trim(),
      primary_metric: input.primaryMetric.trim(),
      baseline: input.baseline,
      observed: input.observed,
      delta: input.delta,
      guardrails: input.guardrails,
      evidence_refs: input.evidenceRefs,
      evidence_quality: input.evidenceQuality,
      interpretation: input.interpretation.trim(),
      assessed_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, cycle.organizationId, "gauntlet.impact_assessed", "gauntlet_impact", data.id, {
    cycleId,
    direction: input.direction,
    evidenceQuality: input.evidenceQuality,
  });
  return data;
}

async function getOrCreateProfile(db: SupabaseClient, actor: Actor, organizationId: string, workstreamId: string) {
  const { data: existing, error: readError } = await db
    .from("workstream_autonomy_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("workstream_id", workstreamId)
    .maybeSingle();
  if (readError) throw new DomainError(readError.message);
  if (existing) return mapProfile(existing as Record<string, unknown>);
  const { data, error } = await db
    .from("workstream_autonomy_profiles")
    .insert({ organization_id: organizationId, workstream_id: workstreamId, policy: DEFAULT_AUTONOMY_POLICY, updated_by: actor.id })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  return mapProfile(data as Record<string, unknown>);
}

async function computeAutonomyMetrics(db: SupabaseClient, cycle: GauntletCycle): Promise<AutonomyMetrics> {
  const { data: runs, error: runError } = await db
    .from("workstream_runs")
    .select("id, status, owner_minutes")
    .eq("organization_id", cycle.organizationId)
    .eq("workstream_id", cycle.workstreamId)
    .not("gauntlet_cycle_id", "is", null);
  if (runError) throw new DomainError(runError.message);
  const runRows = runs ?? [];
  const runIds = runRows.map((row) => row.id);
  const verifiedRuns = runRows.filter((row) => row.status === "verified").length;
  const failedRuns = runRows.filter((row) => row.status === "failed" || row.status === "cancelled").length;
  const completedRuns = verifiedRuns + failedRuns;
  const ownerValues = runRows.map((row) => Number(row.owner_minutes ?? 0)).filter(Number.isFinite);

  let receipts: Array<Record<string, unknown>> = [];
  let reviews: Array<Record<string, unknown>> = [];
  if (runIds.length) {
    const [receiptResult, reviewResult] = await Promise.all([
      db.from("outcome_receipts").select("run_id, qa_score, exceptions").in("run_id", runIds),
      db.from("gauntlet_reviews").select("run_id, hard_gate_pass, authority_incidents, created_at").in("run_id", runIds).order("created_at", { ascending: false }),
    ]);
    if (receiptResult.error) throw new DomainError(receiptResult.error.message);
    if (reviewResult.error) throw new DomainError(reviewResult.error.message);
    receipts = (receiptResult.data ?? []) as Array<Record<string, unknown>>;
    reviews = (reviewResult.data ?? []) as Array<Record<string, unknown>>;
  }

  const qaScores = receipts
    .map((row) => row.qa_score)
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter(Number.isFinite);
  const exceptionReceipts = receipts.filter((row) => asArray(row.exceptions).length > 0).length;
  const authorityIncidents = reviews.reduce((count, row) => count + asArray(row.authority_incidents).length, 0);
  const latestReview = reviews[0];

  const { data: currentImpact, error: impactError } = await db
    .from("gauntlet_impact_assessments")
    .select("direction")
    .eq("cycle_id", cycle.id)
    .maybeSingle();
  if (impactError) throw new DomainError(impactError.message);

  return {
    verifiedRuns,
    failedRuns,
    averageQaScore: qaScores.length ? qaScores.reduce((a, b) => a + b, 0) / qaScores.length : null,
    exceptionRate: receipts.length ? exceptionReceipts / receipts.length : 0,
    failureRate: completedRuns ? failedRuns / completedRuns : 0,
    averageOwnerMinutes: ownerValues.length ? ownerValues.reduce((a, b) => a + b, 0) / ownerValues.length : null,
    authorityIncidents,
    latestHardGatePass: latestReview ? Boolean(latestReview.hard_gate_pass) : null,
    latestImpact: (currentImpact?.direction as ImpactDirection | undefined) ?? null,
  };
}

export async function evaluateGauntletAutonomy(actor: Actor, cycleId: string) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const cycle = mapCycle(await getCycleRow(db, cycleId));
  assertOrgAccess(actor, cycle.organizationId);
  if (cycle.status !== "autonomy_review") throw new DomainError("Cycle is not ready for autonomy review.");
  const profile = await getOrCreateProfile(db, actor, cycle.organizationId, cycle.workstreamId);
  const metrics = await computeAutonomyMetrics(db, cycle);
  const evaluation = evaluateAutonomy(profile, metrics, profile.policy);
  const status = evaluation.applyImmediately ? "applied" : "proposed";
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("autonomy_decisions")
    .insert({
      organization_id: cycle.organizationId,
      workstream_id: cycle.workstreamId,
      cycle_id: cycle.id,
      decision: evaluation.decision,
      from_level: profile.currentLevel,
      to_level: evaluation.toLevel,
      reason: evaluation.reasons.join(" "),
      metrics_snapshot: metrics,
      policy_snapshot: profile.policy,
      requires_approval: evaluation.requiresApproval,
      status,
      created_by: actor.id,
      applied_by: evaluation.applyImmediately ? actor.id : null,
      applied_at: evaluation.applyImmediately ? now : null,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, cycle.organizationId, "gauntlet.autonomy_evaluated", "autonomy_decision", data.id, {
    cycleId,
    decision: evaluation.decision,
    status,
    toLevel: evaluation.toLevel,
  });
  return { decision: data, evaluation, metrics, profile };
}

export async function applyAutonomyDecision(actor: Actor, decisionId: string) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const { data: decision, error: readError } = await db.from("autonomy_decisions").select("*").eq("id", decisionId).maybeSingle();
  if (readError) throw new DomainError(readError.message);
  if (!decision) throw new DomainError("Autonomy decision not found.");
  assertOrgAccess(actor, decision.organization_id);
  if (decision.status !== "proposed") throw new DomainError("Only proposed autonomy decisions can be applied.");
  const { data, error } = await db
    .from("autonomy_decisions")
    .update({ status: "applied", applied_by: actor.id, applied_at: new Date().toISOString() })
    .eq("id", decisionId)
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  await audit(db, actor, decision.organization_id, "gauntlet.autonomy_applied", "autonomy_decision", decisionId, {
    decision: decision.decision,
    toLevel: decision.to_level,
  });
  return data;
}

export async function updateAutonomyPolicy(actor: Actor, profileId: string, policy: AutonomyPolicy) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const { data: profile, error: readError } = await db.from("workstream_autonomy_profiles").select("*").eq("id", profileId).maybeSingle();
  if (readError) throw new DomainError(readError.message);
  if (!profile) throw new DomainError("Autonomy profile not found.");
  assertOrgAccess(actor, profile.organization_id);
  const { data, error } = await db
    .from("workstream_autonomy_profiles")
    .update({ policy, policy_version: Number(profile.policy_version) + 1, updated_by: actor.id })
    .eq("id", profileId)
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  return mapProfile(data as Record<string, unknown>);
}

export async function getGauntletCycleBundle(actor: Actor, cycleId: string) {
  const db = await persistentDb(actor);
  const cycle = mapCycle(await getCycleRow(db, cycleId));
  assertOrgAccess(actor, cycle.organizationId);
  const [observations, diagnosis, runs, reviews, failures, impact, profile, decisions] = await Promise.all([
    db.from("gauntlet_observations").select("*").eq("cycle_id", cycle.id).order("created_at", { ascending: true }),
    db.from("gauntlet_diagnoses").select("*").eq("cycle_id", cycle.id).maybeSingle(),
    db.from("workstream_runs").select("*").eq("gauntlet_cycle_id", cycle.id).order("attempt_number", { ascending: true }),
    db.from("gauntlet_reviews").select("*").eq("cycle_id", cycle.id).order("created_at", { ascending: true }),
    db.from("gauntlet_failures").select("*").eq("cycle_id", cycle.id).order("created_at", { ascending: true }),
    db.from("gauntlet_impact_assessments").select("*").eq("cycle_id", cycle.id).maybeSingle(),
    db.from("workstream_autonomy_profiles").select("*").eq("organization_id", cycle.organizationId).eq("workstream_id", cycle.workstreamId).maybeSingle(),
    db.from("autonomy_decisions").select("*").eq("cycle_id", cycle.id).order("created_at", { ascending: true }),
  ]);
  for (const result of [observations, diagnosis, runs, reviews, failures, impact, profile, decisions]) {
    if (result.error) throw new DomainError(result.error.message);
  }
  return {
    cycle,
    observations: observations.data ?? [],
    diagnosis: diagnosis.data ?? null,
    runs: runs.data ?? [],
    reviews: reviews.data ?? [],
    failures: failures.data ?? [],
    impact: impact.data ?? null,
    profile: profile.data ? mapProfile(profile.data as Record<string, unknown>) : null,
    decisions: decisions.data ?? [],
  };
}
