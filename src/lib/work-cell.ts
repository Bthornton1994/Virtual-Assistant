import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError, DomainError, assertOrgAccess, isOpsRole, type Actor } from "@/lib/domain";
import { supabaseServer } from "@/lib/supabase/server";
import { addGauntletReview } from "@/lib/gauntlet";
import {
  CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
  type CatalogEvidencePacketV1,
} from "@/lib/catalog-evidence-packet";
import {
  CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION,
  type CatalogEvidenceReviewV1,
} from "@/lib/catalog-evidence-review";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  validateInputManifest,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";
import { checkPayloadHash, hashCatalogEvidencePacket, sha256Hex, sha256Text } from "@/lib/catalog-evidence-hash";
import {
  collectPacketClaims,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
  type CatalogEvidencePacketMetrics,
  type CatalogEvidenceReviewMetrics,
  type ValidationResult,
} from "@/lib/catalog-evidence-validator";
import {
  summarizeWorkCellBenchmark,
  summarizeWorkCellGate,
  type WorkCellBenchmark,
  type WorkCellGate,
} from "@/lib/work-cell-policy";
import {
  PUBLIC_WEB_RESEARCHER_KEY,
  prepareAuthorizedPublicWebEvidencePacket,
  GovernedNativePrepareError,
} from "@/lib/public-web-researcher";
import {
  alreadyClaimedPhaseFailure,
  attachEconomicsReservationIds,
  bindNativePublicWebEconomics,
  claimFailureAllowedAfterPrepareOutcome,
  claimMetadataFromInput,
  COMPLETE_WORK_CELL_PHASE_CLAIM_RPC,
  commitDeferredGovernedReservations,
  decideStaleWorkCellPhaseClaimReclaim,
  FAIL_WORK_CELL_PHASE_CLAIM_RPC,
  releaseReservedGovernedExecutions,
  requireEconomicsEnvelope,
  workCellPhaseAlreadyRecordedFromAssignment,
  WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
  WORK_CELL_PHASE_CLAIM_SCHEMA_VERSION,
  type WorkCellPhaseClaimInput,
} from "@/lib/execution-economics-adapter";
import { sealPersistedWorkCellProjectionFromWorkCellLoader } from "@/lib/execution-economics-binding-internal";
import {
  createEconomicsSession,
} from "@/lib/outcome-economics-governor";
import { parseExtractedJson } from "@/lib/work-cell-json";
import type { AssignmentToEnvelopeAssignment } from "@/lib/assignment-to-envelope";
import type { ActionClass } from "@/lib/domain";
import {
  assertObservationBound,
  assertWorkCellPhasePersistAllowed,
  buildRequiredEmptyTrace,
  loadObservationTrace,
  mergeObservationPointers,
  persistObservationArtifact,
  snapshotDelegationSpec,
  translateWorkCellAssignment,
  workCellPersistIdentity,
  type ExecutionBinding,
} from "@/lib/execution-context-enforcement";
import { validateToolInvocationTraceArtifact } from "@/lib/tool-invocation-trace";
import type { ExecutorEnvelopeV1 } from "@/lib/executor-envelope";

export const WORK_CELL_VALIDATION_SCHEMA_VERSION = "catalog-evidence-validation/v1" as const;
export const WORK_CELL_REJECTION_SCHEMA_VERSION = "catalog-evidence-rejection/v1" as const;

/** The single reviewer_ref the work cell writes its authoritative Gauntlet review under. */
export const WORK_CELL_REVIEWER_REF = "delegation-cloud-work-cell-v1";

export const VALIDATOR_EXECUTOR_KEY = "catalog-evidence-validator-v1";

/** Executor role required for each phase, checked before an assignment is created. */
const REQUIRED_PHASE_ROLE: Record<ExecutorPhase, string> = {
  prepare: "researcher",
  review: "reviewer",
  validate: "validator",
};

/** Raw rejected output is preserved for audit, but bounded so one bad paste cannot dominate storage. */
const REJECTED_OUTPUT_EXCERPT_LIMIT = 20_000;

export type ExecutorPhase = "prepare" | "review" | "validate";

export type ExecutorProfile = {
  id: string;
  key: string;
  displayName: string;
  executorKind: "agent" | "deterministic" | "human";
  provider: string;
  role: string;
  status: "shadow" | "active" | "suspended" | "retired";
  capabilities: unknown[];
  authorityEnvelope: Record<string, unknown>;
  forbiddenActions: unknown[];
  configurationMetadata: Record<string, unknown>;
};

export type RunExecutorAssignment = {
  id: string;
  organizationId: string;
  runId: string;
  executorProfileId: string;
  phase: ExecutorPhase;
  status: "planned" | "running" | "completed" | "failed";
  authoritySnapshot: Record<string, unknown>;
  inputArtifactId: string | null;
  outputArtifactId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  humanMinutes: number;
  aiCostMicros: number;
  toolCostMicros: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapProfile(row: Record<string, unknown>): ExecutorProfile {
  return {
    id: String(row.id),
    key: String(row.key),
    displayName: String(row.display_name ?? ""),
    executorKind: row.executor_kind as ExecutorProfile["executorKind"],
    provider: String(row.provider ?? ""),
    role: String(row.role ?? ""),
    status: row.status as ExecutorProfile["status"],
    capabilities: asArray(row.capabilities),
    authorityEnvelope: asObject(row.authority_envelope),
    forbiddenActions: asArray(row.forbidden_actions),
    configurationMetadata: asObject(row.configuration_metadata),
  };
}

function mapAssignment(row: Record<string, unknown>): RunExecutorAssignment {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    runId: String(row.run_id),
    executorProfileId: String(row.executor_profile_id),
    phase: row.phase as ExecutorPhase,
    status: row.status as RunExecutorAssignment["status"],
    authoritySnapshot: asObject(row.authority_snapshot),
    inputArtifactId: (row.input_artifact_id as string) ?? null,
    outputArtifactId: (row.output_artifact_id as string) ?? null,
    startedAt: (row.started_at as string) ?? null,
    completedAt: (row.completed_at as string) ?? null,
    humanMinutes: Number(row.human_minutes ?? 0),
    aiCostMicros: Number(row.ai_cost_micros ?? 0),
    toolCostMicros: Number(row.tool_cost_micros ?? 0),
    metadata: asObject(row.metadata),
    createdAt: String(row.created_at ?? ""),
  };
}

async function persistentDb(actor: Actor): Promise<SupabaseClient> {
  if (actor.source === "demo") throw new DomainError("The work cell requires the persistent Supabase workspace.");
  const db = await supabaseServer();
  if (!db) throw new DomainError("The work cell requires Supabase.");
  return db;
}

function managerOnly(actor: Actor) {
  if (actor.role !== "ops_manager" && actor.role !== "platform_admin") {
    throw new AuthzError("Only operations managers can ingest or validate work-cell evidence.");
  }
}

function opsOnly(actor: Actor) {
  if (!isOpsRole(actor.role)) throw new AuthzError("Only operations staff can read the work cell.");
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
  if (error) throw new DomainError(error.message || "Could not record work-cell audit event");
}

/**
 * Parses operator-pasted executor output. Surrounding chat is stripped.
 * Field values are never repaired.
 */
export function parseRawExecutorJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  return parseExtractedJson(raw);
}

async function loadRun(db: SupabaseClient, actor: Actor, runId: string) {
  const { data, error } = await db
    .from("workstream_runs")
    .select("id, organization_id, status, gauntlet_cycle_id, delegation_spec_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Workstream run not found.");
  assertOrgAccess(actor, String(data.organization_id));
  return data as {
    id: string;
    organization_id: string;
    status: string;
    gauntlet_cycle_id: string | null;
    delegation_spec_id: string;
  };
}

async function loadTypedArtifact(db: SupabaseClient, runId: string, schemaVersion: string) {
  const { data, error } = await db
    .from("evidence_artifacts")
    .select("*")
    .eq("run_id", runId)
    .eq("payload->>schemaVersion", schemaVersion)
    .order("created_at", { ascending: true });
  if (error) throw new DomainError(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.length ? rows[0] : null;
}

async function getProfileByKey(db: SupabaseClient, key: string) {
  const { data, error } = await db.from("executor_profiles").select("*").eq("key", key).maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) {
    throw new DomainError(
      `Executor profile "${key}" is not registered. Register the Step 3D executor profiles before running a work cell.`,
    );
  }
  return mapProfile(data as Record<string, unknown>);
}

async function getProfileById(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("executor_profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Executor profile not found.");
  return mapProfile(data as Record<string, unknown>);
}

async function getAssignment(db: SupabaseClient, runId: string, phase: ExecutorPhase) {
  const { data, error } = await db
    .from("run_executor_assignments")
    .select("*")
    .eq("run_id", runId)
    .eq("phase", phase)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  return data ? mapAssignment(data as Record<string, unknown>) : null;
}

async function claimWorkCellPhase(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string },
  profile: ExecutorProfile,
  phase: ExecutorPhase,
  input: WorkCellPhaseClaimInput,
  inputArtifactId: string | null,
): Promise<RunExecutorAssignment> {
  const { data, error } = await db
    .from("run_executor_assignments")
    .insert({
      organization_id: run.organization_id,
      run_id: run.id,
      executor_profile_id: profile.id,
      phase,
      status: "running",
      authority_snapshot: buildAuthoritySnapshot(profile),
      input_artifact_id: inputArtifactId,
      metadata: claimMetadataFromInput(input),
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) {
    const uniqueConflict =
      error.code === "23505" || /duplicate|unique/i.test(String(error.message || ""));
    if (uniqueConflict) {
      const existing = await getAssignment(db, run.id, phase);
      throw new DomainError(alreadyClaimedPhaseFailure(phase, existing?.status ?? "claimed"));
    }
    throw new DomainError(error.message || "Could not claim the work-cell phase.");
  }
  return mapAssignment(data as Record<string, unknown>);
}

function assignmentIdFromMetadata(metadata: Record<string, unknown>): string | null {
  const assignmentId = metadata.assignmentId;
  return typeof assignmentId === "string" && assignmentId.length > 0 ? assignmentId : null;
}

async function failWorkCellPhaseClaim(
  db: SupabaseClient,
  run: { id: string },
  phase: ExecutorPhase,
  _now: string,
  reason: string,
  reservationIds: readonly string[] = [],
  staleOnly = false,
): Promise<RunExecutorAssignment | null> {
  const { data, error } = await db.rpc(FAIL_WORK_CELL_PHASE_CLAIM_RPC, {
    p_run_id: run.id,
    p_phase: phase,
    p_reason: reason,
    p_stale_only: staleOnly,
    p_ttl_ms: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    p_reservation_ids: [...reservationIds],
  });
  if (error) throw new DomainError(error.message || "Could not fail the work-cell phase claim.");
  const existing = await getAssignment(db, run.id, phase);
  if (!existing) return null;
  if (existing.status === "completed") {
    throw new DomainError("A completed work-cell phase assignment cannot be overwritten by a claim failure.");
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    assignment_id?: string;
    assignment_status?: string;
  }>;
  if (rows[0]?.assignment_status === "completed") {
    throw new DomainError("A completed work-cell phase assignment cannot be overwritten by a claim failure.");
  }
  return existing;
}

async function rpcCompleteWorkCellPhaseClaim(
  db: SupabaseClient,
  run: { id: string },
  phase: ExecutorPhase,
  metadataPatch: Record<string, unknown>,
  assignmentId: string | null,
): Promise<RunExecutorAssignment> {
  const { data, error } = await db.rpc(COMPLETE_WORK_CELL_PHASE_CLAIM_RPC, {
    p_run_id: run.id,
    p_phase: phase,
    p_metadata_patch: metadataPatch,
    p_assignment_id: assignmentId,
  });
  if (error) throw new DomainError(error.message || "Could not complete the work-cell phase claim.");
  const existing = await getAssignment(db, run.id, phase);
  if (existing?.status === "completed") return existing;
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    assignment_id?: string;
    assignment_status?: string;
  }>;
  if (rows[0]?.assignment_status === "completed" && existing) return existing;
  throw new DomainError(
    "Cannot complete a work-cell phase claim that is not running with output evidence. Assignment cannot be successful with an incomplete economics commit set.",
  );
}

async function completeWorkCellPhaseClaim(
  db: SupabaseClient,
  run: { id: string },
  phase: ExecutorPhase,
  _now: string,
  metadataPatch: Record<string, unknown> = {},
): Promise<RunExecutorAssignment> {
  const existing = await getAssignment(db, run.id, phase);
  if (existing?.status === "completed") return existing;
  const assignmentId = existing ? assignmentIdFromMetadata(existing.metadata) : null;
  try {
    return await rpcCompleteWorkCellPhaseClaim(db, run, phase, metadataPatch, assignmentId);
  } catch (error) {
    const raced = await getAssignment(db, run.id, phase);
    if (raced?.status === "completed") return raced;
    if (raced?.status === "running" && raced.outputArtifactId) {
      return rpcCompleteWorkCellPhaseClaim(db, run, phase, metadataPatch, assignmentId);
    }
    throw error;
  }
}

async function expireStaleRunningWorkCellPhaseClaim(
  db: SupabaseClient,
  existing: RunExecutorAssignment,
  now: string,
): Promise<RunExecutorAssignment | null> {
  const packet = await loadTypedArtifact(db, existing.runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  const action = decideStaleWorkCellPhaseClaimReclaim({
    status: existing.status,
    createdAt: existing.createdAt,
    now,
    ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    acceptedCatalogPacketExists: packet != null,
    outputArtifactId: existing.outputArtifactId,
  });
  if (action === "noop") return null;
  if (action === "complete") {
    try {
      return await completeWorkCellPhaseClaim(db, { id: existing.runId }, existing.phase, now);
    } catch {
      // Leave running for the operator. Never fail an accepted packet.
      return existing;
    }
  }
  try {
    const failed = await failWorkCellPhaseClaim(
      db,
      { id: existing.runId },
      existing.phase,
      now,
      "Stale running work-cell phase claim reclaimed to failed without fetching.",
      [],
      true,
    );
    return failed?.status === "failed" ? failed : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/accepted catalog evidence packet|cannot be overwritten by a claim failure/i.test(message)) {
      try {
        return await completeWorkCellPhaseClaim(db, { id: existing.runId }, existing.phase, now);
      } catch {
        return existing;
      }
    }
    throw error;
  }
}

async function insertEvidenceArtifact(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string },
  input: { kind: string; summary: string; sourceUri?: string | null; payload: Record<string, unknown>; contentHash: string },
) {
  const { data, error } = await db
    .from("evidence_artifacts")
    .insert({
      organization_id: run.organization_id,
      run_id: run.id,
      kind: input.kind,
      summary: input.summary,
      source_uri: input.sourceUri ?? null,
      content_hash: input.contentHash,
      payload: input.payload,
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  return data as Record<string, unknown>;
}

/** Phase suitability: role and executor kind must both match what the phase needs. */
function assertProfileFitsPhase(profile: ExecutorProfile, phase: ExecutorPhase) {
  if (profile.status === "suspended" || profile.status === "retired") {
    throw new DomainError(`Executor "${profile.key}" is ${profile.status} and cannot be assigned new work.`);
  }
  if (profile.role !== REQUIRED_PHASE_ROLE[phase]) {
    throw new DomainError(
      `Executor "${profile.key}" has role "${profile.role}" and cannot take the ${phase} phase, which requires role "${REQUIRED_PHASE_ROLE[phase]}".`,
    );
  }
  if (phase === "validate" && profile.executorKind !== "deterministic") {
    throw new DomainError("The validate phase requires a deterministic executor; an AI worker cannot own a verification gate.");
  }
  if (phase !== "validate" && profile.executorKind === "deterministic") {
    throw new DomainError(`The ${phase} phase requires an agent or human executor.`);
  }
}

/**
 * Non-secret provenance a future run can compare itself against to prove the
 * worker was not silently swapped between runs: executor identity and role,
 * authority ceiling, and whatever protocol/model/config version the profile
 * declares. Never a credential, and never a new authority mechanism — the
 * authority envelope and forbidden-actions list stay exactly what they were.
 */
function buildAuthoritySnapshot(profile: ExecutorProfile): Record<string, unknown> {
  return {
    executorKey: profile.key,
    executorKind: profile.executorKind,
    executorRole: profile.role,
    profileStatus: profile.status,
    authorityEnvelope: profile.authorityEnvelope,
    forbiddenActions: profile.forbiddenActions,
    configurationMetadata: profile.configurationMetadata,
  };
}

function phaseCapability(phase: ExecutorPhase, executorKey: string): {
  capabilityKey: string;
  outputContract: ExecutorEnvelopeV1["outputContract"];
  evidenceRequirements: ExecutorEnvelopeV1["evidenceRequirements"];
  objective: string;
} {
  if (phase === "prepare") {
    return {
      capabilityKey: executorKey === PUBLIC_WEB_RESEARCHER_KEY ? "public_web_retrieval" : "evidence_research",
      outputContract: { schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION, artifactKind: "candidate_evidence" },
      evidenceRequirements: {
        requiredArtifactSchemaVersions: [CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION],
        requiredSourceProvenance: ["sourceUrl"],
        independentReviewRequired: true,
      },
      objective: "Prepare source-backed candidate evidence.",
    };
  }
  if (phase === "review") {
    return {
      capabilityKey: "independent_evidence_review",
      outputContract: { schemaVersion: CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION, artifactKind: "independent_review" },
      evidenceRequirements: {
        requiredArtifactSchemaVersions: [CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION],
        requiredSourceProvenance: ["sourceUrl"],
        independentReviewRequired: false,
      },
      objective: "Independently review frozen candidate evidence.",
    };
  }
  return {
    capabilityKey: "deterministic_catalog_validation",
    outputContract: { schemaVersion: WORK_CELL_VALIDATION_SCHEMA_VERSION, artifactKind: "test" },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: [WORK_CELL_VALIDATION_SCHEMA_VERSION],
      requiredSourceProvenance: [],
      independentReviewRequired: false,
    },
    objective: "Deterministically validate the work cell.",
  };
}

async function loadSpecSnapshot(db: SupabaseClient, specId: string, allowedToolClasses?: Parameters<typeof snapshotDelegationSpec>[0]["allowedToolClasses"]) {
  const { data, error } = await db
    .from("delegation_specs")
    .select("id, version, action_class, objective")
    .eq("id", specId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Delegation Spec not found for this Workstream Run.");
  return snapshotDelegationSpec({
    specKey: "workstream-delegation-spec",
    specVersion: "delegation-spec/v" + String(data.version),
    actionClass: data.action_class as ActionClass,
    allowedToolClasses,
  });
}

async function loadSpecEconomicEnvelope(db: SupabaseClient, specId: string): Promise<unknown> {
  const { data, error } = await db
    .from("delegation_specs")
    .select("economic_envelope")
    .eq("id", specId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Delegation Spec not found for this Workstream Run.");
  return requireEconomicsEnvelope(data.economic_envelope);
}

async function bindWorkCellPhase(
  db: SupabaseClient,
  run: { id: string; organization_id: string; delegation_spec_id: string },
  profile: ExecutorProfile,
  phase: ExecutorPhase,
  inputManifestContentHash: string,
  inputArtifactRefs: ExecutorEnvelopeV1["inputArtifactRefs"],
  createdAt: string,
  allowedToolClasses?: Parameters<typeof snapshotDelegationSpec>[0]["allowedToolClasses"],
): Promise<ExecutionBinding> {
  const spec = await loadSpecSnapshot(db, run.delegation_spec_id, allowedToolClasses);
  const contracts = phaseCapability(phase, profile.key);
  const assignment: AssignmentToEnvelopeAssignment = {
    organizationId: run.organization_id,
    runId: run.id,
    phase,
    capabilityKey: contracts.capabilityKey,
    executorKey: profile.key,
    executorKind: profile.executorKind,
    provider: profile.provider || "delegation-cloud",
    protocolVersion: String(profile.configurationMetadata.protocolVersion || profile.provider || "work-cell/v1"),
    modelId: typeof profile.configurationMetadata.modelId === "string" ? profile.configurationMetadata.modelId : null,
    configHash: null,
    objective: contracts.objective,
    createdAt,
    deadline: createdAt,
    outputContract: contracts.outputContract,
    evidenceRequirements: contracts.evidenceRequirements,
    economicLimit: { currency: "USD", maxHumanMinutes: 0, maxAiCostMicros: 0, maxToolCostMicros: 0 },
    inputManifestContentHash,
    profileAuthoritySnapshot: buildAuthoritySnapshot(profile),
  };
  return translateWorkCellAssignment(assignment, spec, inputArtifactRefs);
}

async function persistWorkCellObservation(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string; delegation_spec_id: string },
  profile: ExecutorProfile,
  phase: ExecutorPhase,
  manifest: { id: string; contentHash: string; createdAt: string },
  inputArtifactRefs: ExecutorEnvelopeV1["inputArtifactRefs"],
  productionClass: "operator_submitted" | "deterministic_validation_no_tools" = phase === "validate"
    ? "deterministic_validation_no_tools"
    : "operator_submitted",
  allowedToolClasses?: Parameters<typeof snapshotDelegationSpec>[0]["allowedToolClasses"],
) {
  if (phase === "validate" && profile.executorKind !== "deterministic") {
    throw new DomainError("The validate phase requires a deterministic executor; an AI worker cannot own a verification gate.");
  }
  const binding = await bindWorkCellPhase(
    db,
    run,
    profile,
    phase,
    manifest.contentHash,
    inputArtifactRefs,
    manifest.createdAt,
    allowedToolClasses,
  );
  const trace = buildRequiredEmptyTrace(productionClass, binding);
  const persisted = await persistObservationArtifact(db, actor, run, trace);
  return { binding, pointers: persisted.pointers };
}

/**
 * Persists one phase's evidence artifact and its executor assignment together,
 * atomically, via the record_work_cell_phase_artifact RPC.
 *
 * Before this, the artifact insert and the assignment insert were two
 * independent statements: if the second failed (a race on the (run_id, phase)
 * unique constraint, a trigger exception, a dropped connection) the first had
 * already committed, leaving a durable "accepted" artifact with no assignment
 * behind it. The RPC wraps both inserts in one function call, so one implicit
 * transaction covers both — nothing partial is ever left behind.
 */
async function persistPhaseArtifact(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string; delegation_spec_id?: string },
  profile: ExecutorProfile,
  input: {
    kind: string;
    summary: string;
    sourceUri?: string | null;
    payload: Record<string, unknown>;
    contentHash: string;
    phase: ExecutorPhase;
    assignmentStatus: RunExecutorAssignment["status"];
    inputArtifactId?: string | null;
    humanMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
    assignmentMetadata?: Record<string, unknown>;
  },
): Promise<{ artifactId: string; assignmentId: string }> {
  assertProfileFitsPhase(profile, input.phase);
  const identity = workCellPersistIdentity({
    organizationId: run.organization_id,
    runId: run.id,
    phase: input.phase,
    executorKey: profile.key,
    capabilityKey: phaseCapability(input.phase, profile.key).capabilityKey,
  });
  const assignmentMetadata = {
    ...(input.assignmentMetadata ?? {}),
    ...identity,
  };
  await assertObservationBound(db, run, assignmentMetadata);
  const observation = await loadObservationTrace(db, run.id, String(assignmentMetadata.assignmentId ?? ""));
  let specActionClass: ActionClass = "prepare_only";
  if (run.delegation_spec_id) {
    const { data: specRow, error: specError } = await db
      .from("delegation_specs")
      .select("action_class")
      .eq("id", run.delegation_spec_id)
      .maybeSingle();
    if (specError) throw new DomainError(specError.message);
    if (specRow && typeof specRow.action_class === "string") {
      specActionClass = specRow.action_class as ActionClass;
    }
  }
  const snapshotActionClass = profile.authorityEnvelope.actionClass;
  assertWorkCellPhasePersistAllowed({
    organizationId: run.organization_id,
    runId: run.id,
    phase: input.phase,
    executorKey: profile.key,
    capabilityKey: identity.capabilityKey,
    specActionClass,
    assignmentActionClass: typeof snapshotActionClass === "string" ? (snapshotActionClass as ActionClass) : null,
    metadata: assignmentMetadata,
    observation: observation
      ? {
          organizationId: run.organization_id,
          runId: run.id,
          kind: "observation",
          contentHash: observation.contentHash,
          payload: observation.payload,
        }
      : null,
  });

  const existing = await getAssignment(db, run.id, input.phase);
  if (existing) {
    const claimSchema = existing.metadata.schemaVersion;
    const claimMatches =
      existing.status === "running" &&
      claimSchema === WORK_CELL_PHASE_CLAIM_SCHEMA_VERSION &&
      existing.metadata.assignmentId === assignmentMetadata.assignmentId &&
      existing.metadata.executorKey === identity.executorKey &&
      existing.executorProfileId === profile.id;
    if (!claimMatches) {
      throw new DomainError(
        `The ${input.phase} phase of this run already has a recorded attempt (status: ${existing.status}). A retry belongs to a new Gauntlet attempt, not an overwrite.`,
      );
    }
  }

  const { data, error } = await db.rpc("record_work_cell_phase_artifact", {
    p_run_id: run.id,
    p_kind: input.kind,
    p_summary: input.summary,
    p_source_uri: input.sourceUri ?? null,
    p_content_hash: input.contentHash,
    p_payload: input.payload,
    p_executor_profile_id: profile.id,
    p_phase: input.phase,
    p_assignment_status: input.assignmentStatus,
    p_authority_snapshot: buildAuthoritySnapshot(profile),
    p_input_artifact_id: input.inputArtifactId ?? null,
    p_human_minutes: input.humanMinutes ?? 0,
    p_ai_cost_micros: Math.round(input.aiCostMicros ?? 0),
    p_tool_cost_micros: Math.round(input.toolCostMicros ?? 0),
    p_assignment_metadata: assignmentMetadata,
  });
  if (error) throw new DomainError(error.message);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    artifact_id: string;
    assignment_id: string;
  }>;
  const row = rows[0];
  if (!row?.artifact_id || !row?.assignment_id) {
    throw new DomainError("The work-cell phase RPC did not return the persisted artifact and assignment.");
  }

  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", row.artifact_id, {
    runId: run.id,
    phase: input.phase,
    assignmentStatus: input.assignmentStatus,
    executorKey: profile.key,
    contentHash: input.contentHash,
  });

  return { artifactId: row.artifact_id, assignmentId: row.assignment_id };
}

/**
 * Records a rejected executor output as immutable, clearly-untrusted evidence,
 * AND as a failed phase assignment bound to that rejection artifact.
 *
 * The rejected payload never becomes a CatalogEvidencePacketV1 or
 * CatalogEvidenceReviewV1 artifact, so no later stage can mistake it for
 * accepted evidence. But the attempt, its hash, and why it failed stay
 * auditable — including human/AI/tool cost, which a failed executor run still
 * spent — because a rejected executor run is exactly the raw material the
 * Gauntlet needs for failure classification and executor economics.
 *
 * Recording the failed assignment here, not just the artifact, is what makes
 * "one executor execution per phase per Gauntlet attempt" real: the
 * unique(run_id, phase) constraint on run_executor_assignments then refuses a
 * second attempt at the same phase within this attempt. A retry belongs to a
 * new Gauntlet attempt.
 */
async function recordRejectedExecutorOutput(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string },
  input: {
    phase: ExecutorPhase;
    profile: ExecutorProfile;
    raw: string;
    hardFailures: string[];
    metrics: Record<string, number>;
    inputArtifactId?: string | null;
    humanMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
    assignmentMetadata?: Record<string, unknown>;
  },
) {
  const rawHash = sha256Text(input.raw);
  const payload = {
    schemaVersion: WORK_CELL_REJECTION_SCHEMA_VERSION,
    runId: run.id,
    phase: input.phase,
    declaredExecutorKey: input.profile.key,
    rawOutputHash: rawHash,
    rawOutputExcerpt: input.raw.slice(0, REJECTED_OUTPUT_EXCERPT_LIMIT),
    rawOutputTruncated: input.raw.length > REJECTED_OUTPUT_EXCERPT_LIMIT,
    rawOutputLength: input.raw.length,
    hardFailures: input.hardFailures,
    metrics: input.metrics,
  };
  const contentHash = sha256Hex(payload);
  const { artifactId } = await persistPhaseArtifact(db, actor, run, input.profile, {
    kind: "other",
    summary: `REJECTED ${input.phase} output (${input.hardFailures.length} hard failure(s)). Not accepted as evidence.`,
    payload,
    contentHash,
    phase: input.phase,
    assignmentStatus: "failed",
    inputArtifactId: input.inputArtifactId ?? null,
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    assignmentMetadata: {
      rawOutputHash: rawHash,
      hardFailureCount: input.hardFailures.length,
      ...(input.assignmentMetadata ?? {}),
    },
  });
  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", artifactId, {
    runId: run.id,
    schemaVersion: WORK_CELL_REJECTION_SCHEMA_VERSION,
    phase: input.phase,
    rawOutputHash: rawHash,
    rejected: true,
  });
  return artifactId;
}

// --- Frozen input manifest ---------------------------------------------------------

/**
 * Loads and fully verifies the frozen input manifest. Two distinct hashes are
 * checked, for two distinct kinds of tampering: `inputHash` is the hash of the
 * frozen task/input contract itself (checked by validateInputManifest, via
 * inputManifestHashSource), while the artifact's own `content_hash` is the
 * hash of the complete stored manifest payload as written — the same
 * tamper-detection every other typed artifact in this run gets. A manifest
 * whose runId does not match this run is rejected outright: without that
 * check, a manifest frozen for a different run could be read here and its
 * inputHash would still self-consistently validate.
 */
async function loadInputManifest(db: SupabaseClient, runId: string) {
  const row = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION);
  if (!row) return null;
  const result = validateInputManifest(row.payload, sha256Hex);
  if (!result.ok) throw new DomainError(`The frozen input manifest for this run is invalid: ${result.failures.join(" ")}`);
  if (result.manifest.runId !== runId) {
    throw new DomainError(
      `The frozen input manifest for this run belongs to a different run ("${result.manifest.runId}"). Its inputHash cannot be trusted for this run.`,
    );
  }
  const contentHashCheck = checkPayloadHash(row.payload, String(row.content_hash ?? ""), "input manifest");
  if (contentHashCheck.tampered) {
    throw new DomainError(`The frozen input manifest for this run is invalid: ${contentHashCheck.failure}`);
  }
  return { id: String(row.id), contentHash: String(row.content_hash ?? ""), manifest: result.manifest };
}

async function requireInputManifest(db: SupabaseClient, runId: string) {
  const manifest = await loadInputManifest(db, runId);
  if (!manifest) {
    throw new DomainError(
      "Freeze the run input manifest before ingesting or validating work-cell evidence. The expected batch is run provenance, not per-stage form input.",
    );
  }
  return manifest;
}

/**
 * Freezes exactly what this attempt is expected to cover, before any executor
 * evidence exists. Every later stage reads the batch from here.
 */
export async function freezeWorkCellInputManifest(
  actor: Actor,
  runId: string,
  input: {
    market: string;
    expectedProductIds: string[];
    inputRecords: Array<{ productId: string; record: Record<string, unknown> }>;
    prepareExecutorKey: string;
    reviewExecutorKey: string;
  },
) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") throw new DomainError("The input manifest is frozen while the run is in progress.");
  if (await loadInputManifest(db, runId)) {
    throw new DomainError("This run already has a frozen input manifest. Changing the expected batch belongs to a new attempt.");
  }
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION)) {
    throw new DomainError("Evidence has already been ingested for this run; the input manifest can no longer be frozen.");
  }

  const market = input.market.trim();
  const expectedProductIds = input.expectedProductIds.map((id) => id.trim()).filter(Boolean);
  const prepareExecutorKey = input.prepareExecutorKey.trim();
  const reviewExecutorKey = input.reviewExecutorKey.trim();
  if (!market) throw new DomainError("The input manifest requires a market.");
  if (!expectedProductIds.length) throw new DomainError("The input manifest requires at least one expected product ID.");
  if (!input.inputRecords.length) {
    throw new DomainError("The input manifest requires a frozen input record for every expected product.");
  }

  // Both executors must already be registered and suitable for their phase, so a
  // manifest cannot freeze a plan that ingestion would later refuse.
  const prepareProfile = await getProfileByKey(db, prepareExecutorKey);
  const reviewProfile = await getProfileByKey(db, reviewExecutorKey);
  assertProfileFitsPhase(prepareProfile, "prepare");
  assertProfileFitsPhase(reviewProfile, "review");
  if (prepareProfile.key === reviewProfile.key) {
    throw new DomainError("The prepare and review phases must be filled by different executors; a reviewer cannot review its own output.");
  }

  const inputRecords = input.inputRecords;
  const manifestCandidate = {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    runId,
    market,
    expectedProductIds,
    inputRecords,
    prepareExecutorKey,
    reviewExecutorKey,
    createdAt: new Date().toISOString(),
    inputHash: sha256Hex(
      inputManifestHashSource({ runId, market, expectedProductIds, inputRecords, prepareExecutorKey, reviewExecutorKey }),
    ),
  };
  // Re-uses the same shape/consistency checks a later read applies (duplicate
  // product IDs, missing/unexpected input records, self-review), so a manifest
  // this function will not itself accept can never be frozen in the first place.
  const validated = validateInputManifest(manifestCandidate, sha256Hex);
  if (!validated.ok) {
    throw new DomainError(`The input manifest is invalid: ${validated.failures.join(" ")}`);
  }
  const manifest: CatalogEvidenceInputManifestV1 = validated.manifest;

  const payload = manifest as unknown as Record<string, unknown>;
  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "other",
    summary: `Frozen work-cell input manifest: ${expectedProductIds.length} product(s) in market ${market}.`,
    payload,
    contentHash: sha256Hex(payload),
  });
  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", String(artifact.id), {
    runId,
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    inputHash: manifest.inputHash,
  });
  return manifest;
}

// --- Ingestion ---------------------------------------------------------------------

export type PacketIngestResult = {
  persisted: boolean;
  validation: ValidationResult<CatalogEvidencePacketMetrics>;
  contentHash: string | null;
  artifactId: string | null;
};

/**
 * Validates a pasted research packet BEFORE persistence and persists it only if
 * the deterministic gate accepts it. A rejected packet is recorded as an
 * explicitly untrusted rejection artifact, never as evidence.
 */
export async function runNativePublicWebPrepare(
  actor: Actor,
  runId: string,
): Promise<PacketIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Work-cell evidence can only be ingested while the run is in progress.");
  }
  const frozen = await requireInputManifest(db, runId);
  if (frozen.manifest.prepareExecutorKey !== PUBLIC_WEB_RESEARCHER_KEY) {
    throw new DomainError(
      `Native public-web prepare is only valid when the frozen prepare executor is ${PUBLIC_WEB_RESEARCHER_KEY}.`,
    );
  }
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen catalog evidence packet. Ingesting another belongs to a new attempt.");
  }
  const now = new Date().toISOString();
  const existingPrepare = await getAssignment(db, run.id, "prepare");
  if (existingPrepare?.status === "running") {
    const reclaimed = await expireStaleRunningWorkCellPhaseClaim(db, existingPrepare, now);
    throw new DomainError(alreadyClaimedPhaseFailure("prepare", reclaimed?.status ?? existingPrepare.status));
  }
  const workCellPhaseAlreadyRecorded = workCellPhaseAlreadyRecordedFromAssignment(existingPrepare);
  if (workCellPhaseAlreadyRecorded) {
    throw new DomainError(
      `The prepare phase of this run already has a recorded attempt (status: ${existingPrepare?.status ?? "unknown"}). Fetch was not started.`,
    );
  }
  const profile = await getProfileByKey(db, frozen.manifest.prepareExecutorKey);
  assertProfileFitsPhase(profile, "prepare");

  const binding = await bindWorkCellPhase(
    db,
    run,
    profile,
    "prepare",
    frozen.contentHash,
    [
      {
        artifactId: frozen.id,
        schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
        contentHash: frozen.contentHash,
      },
    ],
    frozen.manifest.createdAt,
    ["public_read", "artifact_read", "artifact_write"],
  );
  const claimInput: WorkCellPhaseClaimInput = {
    organizationId: run.organization_id,
    tenantId: run.organization_id,
    runId: run.id,
    phase: "prepare",
    assignmentId: binding.assignmentId,
    executorKey: profile.key,
    capabilityKey: phaseCapability("prepare", profile.key).capabilityKey,
    inputManifestContentHash: frozen.contentHash,
    envelopeHash: binding.envelopeHash,
    contextHash: binding.contextHash,
    now,
  };
  await claimWorkCellPhase(db, actor, run, profile, "prepare", claimInput, frozen.id);

  let assignmentIsTerminal = false;
  let acceptedCatalogPacketPersisted = false;
  let trackedReservationIds: string[] = [];
  try {
    const session = createEconomicsSession({
      organizationId: run.organization_id,
      tenantId: run.organization_id,
      economicEnvelope: await loadSpecEconomicEnvelope(db, run.delegation_spec_id),
    });
    if (!session.ok) {
      throw new DomainError(
        "Native public-web prepare cannot start without a trusted economic envelope. Fetch was not started. " +
          session.failures.join(" "),
      );
    }
    const projection = sealPersistedWorkCellProjectionFromWorkCellLoader(binding, frozen.contentHash);
    const economics = bindNativePublicWebEconomics({
      session: session.value,
      projection,
      organizationId: run.organization_id,
      tenantId: run.organization_id,
      now,
      deadlineAt: new Date(Date.parse(now) + 120_000).toISOString(),
      workCellPhaseAlreadyRecorded: false,
      cancelled: run.status !== "running",
    });
    if (!economics.ok) {
      throw new DomainError(
        "Native public-web prepare is blocked by the Outcome Economics Governor. Fetch was not started. " +
          economics.failures.join(" "),
      );
    }

    const releaseEconomics = (reservationIds: readonly string[]) =>
      releaseReservedGovernedExecutions({
        session: session.value,
        organizationId: run.organization_id,
        tenantId: run.organization_id,
        reservationIds,
        now,
      });

    let prepared: Awaited<ReturnType<typeof prepareAuthorizedPublicWebEvidencePacket>>;
    try {
      prepared = await prepareAuthorizedPublicWebEvidencePacket(frozen.manifest, binding, {
        economics: economics.value,
        now,
      });
    } catch (error) {
      const reservationIds =
        error instanceof GovernedNativePrepareError ? error.economicReservationIds : [];
      trackedReservationIds = reservationIds;
      releaseEconomics(reservationIds);
      throw error;
    }
    trackedReservationIds = prepared.economicReservationIds;
    if (prepared.trace.outcomes.some((outcome) => outcome.result === "blocked_preflight")) {
      releaseEconomics(prepared.economicReservationIds);
      throw new DomainError(
        "Native public-web prepare is blocked_preflight and cannot persist a completed assignment. Fetch was not started.",
      );
    }
    const checked = validateToolInvocationTraceArtifact(prepared.trace, binding.context, {
      productionClass: "native_tool_execution",
      assignmentId: binding.assignmentId,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
    });
    if (!checked.ok) {
      releaseEconomics(prepared.economicReservationIds);
      throw new DomainError("Native observation trace is invalid: " + checked.failures.join(" "));
    }

    const reservationMetadata = attachEconomicsReservationIds({}, prepared.economicReservationIds);

    let observation;
    try {
      observation = await persistObservationArtifact(db, actor, run, checked.value);
    } catch (error) {
      releaseEconomics(prepared.economicReservationIds);
      throw error;
    }
    const pointers = observation.pointers;

    const validation = validateCatalogEvidencePacket(prepared.packet, {
      expectedProductIds: frozen.manifest.expectedProductIds,
      expectedRunId: runId,
      expectedExecutorKey: profile.key,
      expectedMarket: frozen.manifest.market,
    });
    if (!validation.hardGatePass) {
      try {
        await recordRejectedExecutorOutput(db, actor, run, {
          phase: "prepare",
          profile,
          raw: JSON.stringify(prepared.packet),
          hardFailures: validation.hardFailures,
          metrics: validation.metrics as unknown as Record<string, number>,
          assignmentMetadata: { ...reservationMetadata, ...pointers },
        });
      } catch (error) {
        releaseEconomics(prepared.economicReservationIds);
        throw error;
      }
      assignmentIsTerminal = true;
      const committed = commitDeferredGovernedReservations({
        session: session.value,
        organizationId: run.organization_id,
        tenantId: run.organization_id,
        now,
        pricing: economics.value.pricing,
        items: prepared.pendingCommits,
      });
      if (!committed.ok) {
        releaseEconomics(prepared.economicReservationIds);
        throw new DomainError(committed.failures.join(" "));
      }
      return { persisted: false, contentHash: null, artifactId: null, validation };
    }

    const contentHash = hashCatalogEvidencePacket(prepared.packet);
    let artifactId: string;
    try {
      const persisted = await persistPhaseArtifact(db, actor, run, profile, {
        kind: "source",
        summary: `Catalog evidence packet v1 from ${profile.key} covering ${prepared.packet.products.length} product(s).`,
        payload: prepared.packet as unknown as Record<string, unknown>,
        contentHash,
        phase: "prepare",
        assignmentStatus: "running",
        inputArtifactId: frozen.id,
        assignmentMetadata: mergeObservationPointers(
          {
            packetHash: contentHash,
            productCount: validation.metrics.productCount,
            inputHash: frozen.manifest.inputHash,
            ...reservationMetadata,
          },
          pointers,
        ),
      });
      artifactId = persisted.artifactId;
      acceptedCatalogPacketPersisted = true;
    } catch (error) {
      releaseEconomics(prepared.economicReservationIds);
      throw error;
    }
    const committed = commitDeferredGovernedReservations({
      session: session.value,
      organizationId: run.organization_id,
      tenantId: run.organization_id,
      now,
      pricing: economics.value.pricing,
      items: prepared.pendingCommits,
    });
    if (!committed.ok) {
      releaseEconomics(prepared.economicReservationIds);
      // Packet is durable. Leave the assignment running; reclaim may complete it.
      // Do not fail a successful packet because process-local commit rolled back.
      throw new DomainError(committed.failures.join(" "));
    }
    await completeWorkCellPhaseClaim(db, run, "prepare", now, reservationMetadata);
    assignmentIsTerminal = true;
    return { persisted: true, validation, contentHash, artifactId };
  } finally {
    if (
      claimFailureAllowedAfterPrepareOutcome({
        assignmentAlreadyTerminal: assignmentIsTerminal,
        acceptedCatalogPacketPersisted,
      })
    ) {
      try {
        await failWorkCellPhaseClaim(
          db,
          run,
          "prepare",
          now,
          "Native public-web prepare failed after claiming the (run_id, phase) slot. Fetch will not retry on this run.",
          trackedReservationIds,
        );
      } catch {
        // Keep the original prepare failure; claim fail is best-effort representation.
      }
    }
  }
}

/** Validates a pasted research packet BEFORE persistence. Rejected output is untrusted audit, never evidence. */
export async function ingestCatalogEvidencePacket(
  actor: Actor,
  runId: string,
  input: { raw: string; humanMinutes?: number; aiCostMicros?: number; toolCostMicros?: number },
): Promise<PacketIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Work-cell evidence can only be ingested while the run is in progress.");
  }
  const frozen = await requireInputManifest(db, runId);
  const manifest = frozen.manifest;
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen catalog evidence packet. Ingesting another belongs to a new attempt.");
  }

  // The executor identity comes from the frozen manifest, never from operator
  // input at ingest time: an operator must not be able to relabel one executor's
  // output as another's after seeing it.
  const profile = await getProfileByKey(db, manifest.prepareExecutorKey);
  // Checked before any write, so an unfit profile never reaches the persistence RPC.
  assertProfileFitsPhase(profile, "prepare");
  const observation = await persistWorkCellObservation(
    db,
    actor,
    run,
    profile,
    "prepare",
    { id: frozen.id, contentHash: frozen.contentHash, createdAt: manifest.createdAt },
    [
      {
        artifactId: frozen.id,
        schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
        contentHash: frozen.contentHash,
      },
    ],
  );
  const pointers = observation.pointers;

  const parsed = parseRawExecutorJson(input.raw);
  if (!parsed.ok) {
    const validation: ValidationResult<CatalogEvidencePacketMetrics> = {
      hardGatePass: false,
      hardFailures: [parsed.error],
      warnings: [],
      metrics: validateCatalogEvidencePacket(null).metrics,
    };
    await recordRejectedExecutorOutput(db, actor, run, {
      phase: "prepare",
      profile,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
      humanMinutes: input.humanMinutes,
      aiCostMicros: input.aiCostMicros,
      toolCostMicros: input.toolCostMicros,
      assignmentMetadata: pointers,
    });
    return { persisted: false, contentHash: null, artifactId: null, validation };
  }

  const validation = validateCatalogEvidencePacket(parsed.value, {
    expectedProductIds: manifest.expectedProductIds,
    expectedRunId: runId,
    expectedExecutorKey: profile.key,
    expectedMarket: manifest.market,
  });
  if (!validation.hardGatePass) {
    await recordRejectedExecutorOutput(db, actor, run, {
      phase: "prepare",
      profile,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
      humanMinutes: input.humanMinutes,
      aiCostMicros: input.aiCostMicros,
      toolCostMicros: input.toolCostMicros,
      assignmentMetadata: pointers,
    });
    return { persisted: false, contentHash: null, artifactId: null, validation };
  }

  const packet = parsed.value as CatalogEvidencePacketV1;
  const contentHash = hashCatalogEvidencePacket(packet);

  const { artifactId } = await persistPhaseArtifact(db, actor, run, profile, {
    kind: "source",
    summary: `Catalog evidence packet v1 from ${profile.key} covering ${packet.products.length} product(s).`,
    payload: packet as unknown as Record<string, unknown>,
    contentHash,
    phase: "prepare",
    assignmentStatus: "completed",
    inputArtifactId: null,
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    assignmentMetadata: mergeObservationPointers(
      { packetHash: contentHash, productCount: validation.metrics.productCount, inputHash: manifest.inputHash },
      pointers,
    ),
  });

  return { persisted: true, validation, contentHash, artifactId };
}

export type ReviewIngestResult = {
  persisted: boolean;
  validation: ValidationResult<CatalogEvidenceReviewMetrics>;
  contentHash: string | null;
  artifactId: string | null;
  expectedPacketHash: string;
};

/**
 * A review is accepted only if it references the exact frozen packet hash. The
 * reviewer never edits the packet; the review is a separate immutable artifact
 * bound to it by content hash.
 */
export async function ingestCatalogEvidenceReview(
  actor: Actor,
  runId: string,
  input: { raw: string; humanMinutes?: number; aiCostMicros?: number; toolCostMicros?: number },
): Promise<ReviewIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Work-cell evidence can only be ingested while the run is in progress.");
  }
  const frozen = await requireInputManifest(db, runId);
  const manifest = frozen.manifest;

  const packetRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  if (!packetRow) throw new DomainError("Freeze a catalog evidence packet before ingesting an independent review.");
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen independent review. Ingesting another belongs to a new attempt.");
  }

  const packet = packetRow.payload as CatalogEvidencePacketV1;
  const expectedPacketHash = String(packetRow.content_hash ?? "");
  const profile = await getProfileByKey(db, manifest.reviewExecutorKey);
  assertProfileFitsPhase(profile, "review");
  const observation = await persistWorkCellObservation(
    db,
    actor,
    run,
    profile,
    "review",
    { id: frozen.id, contentHash: frozen.contentHash, createdAt: manifest.createdAt },
    [
      {
        artifactId: frozen.id,
        schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
        contentHash: frozen.contentHash,
      },
      {
        artifactId: String(packetRow.id),
        schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
        contentHash: expectedPacketHash,
      },
    ],
  );
  const pointers = observation.pointers;
  const context = {
    expectedPacketHash,
    claims: collectPacketClaims(packet),
    packetProductIds: packet.products.map((product) => product.productId),
    expectedRunId: runId,
    expectedReviewerKey: profile.key,
  };

  const parsed = parseRawExecutorJson(input.raw);
  if (!parsed.ok) {
    const validation: ValidationResult<CatalogEvidenceReviewMetrics> = {
      hardGatePass: false,
      hardFailures: [parsed.error],
      warnings: [],
      metrics: validateCatalogEvidenceReview(null, context).metrics,
    };
    await recordRejectedExecutorOutput(db, actor, run, {
      phase: "review",
      profile,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
      inputArtifactId: String(packetRow.id),
      humanMinutes: input.humanMinutes,
      aiCostMicros: input.aiCostMicros,
      toolCostMicros: input.toolCostMicros,
      assignmentMetadata: pointers,
    });
    return { persisted: false, contentHash: null, artifactId: null, expectedPacketHash, validation };
  }

  const validation = validateCatalogEvidenceReview(parsed.value, context);
  if (!validation.hardGatePass) {
    await recordRejectedExecutorOutput(db, actor, run, {
      phase: "review",
      profile,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
      inputArtifactId: String(packetRow.id),
      humanMinutes: input.humanMinutes,
      aiCostMicros: input.aiCostMicros,
      toolCostMicros: input.toolCostMicros,
      assignmentMetadata: pointers,
    });
    return { persisted: false, contentHash: null, artifactId: null, expectedPacketHash, validation };
  }

  const reviewPacket = parsed.value as CatalogEvidenceReviewV1;
  const contentHash = sha256Hex(reviewPacket);

  const { artifactId } = await persistPhaseArtifact(db, actor, run, profile, {
    kind: "source",
    summary: `Independent catalog evidence review v1 from ${profile.key} covering ${reviewPacket.claimReviews.length} claim(s).`,
    payload: reviewPacket as unknown as Record<string, unknown>,
    contentHash,
    phase: "review",
    assignmentStatus: "completed",
    inputArtifactId: String(packetRow.id),
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    assignmentMetadata: mergeObservationPointers(
      { reviewHash: contentHash, reviewedPacketHash: expectedPacketHash },
      pointers,
    ),
  });

  return { persisted: true, validation, contentHash, artifactId, expectedPacketHash };
}

// --- Deterministic validation ------------------------------------------------------

export type WorkCellValidationReport = {
  schemaVersion: typeof WORK_CELL_VALIDATION_SCHEMA_VERSION;
  inputHash: string;
  packetHash: string;
  reviewHash: string | null;
  packet: ValidationResult<CatalogEvidencePacketMetrics>;
  review: ValidationResult<CatalogEvidenceReviewMetrics> | null;
  gate: WorkCellGate;
  benchmark: WorkCellBenchmark;
};

/**
 * Describes why a phase's artifact is not backed by a matching completed
 * assignment, or returns null when the binding is sound. Checked against the
 * FROZEN manifest's executor keys, never against whatever assignment happens
 * to exist — an accepted artifact with no assignment, an assignment for the
 * wrong executor, or an assignment pointed at a different artifact must all
 * refuse final validation rather than silently pass with an unbound key.
 */
async function describeAssignmentBindingFailure(
  db: SupabaseClient,
  assignment: RunExecutorAssignment | null,
  expected: {
    phase: ExecutorPhase;
    expectedExecutorKey: string;
    expectedInputArtifactId?: string;
    expectedOutputArtifactId: string;
  },
): Promise<string | null> {
  if (!assignment || assignment.status !== "completed") {
    return `No completed ${expected.phase} executor assignment is bound to this run; a frozen artifact without a matching assignment cannot be validated.`;
  }
  const profile = await getProfileById(db, assignment.executorProfileId);
  if (profile.key !== expected.expectedExecutorKey) {
    return `The ${expected.phase} assignment was completed by executor "${profile.key}", not the frozen manifest's "${expected.expectedExecutorKey}".`;
  }
  if (expected.expectedInputArtifactId !== undefined && assignment.inputArtifactId !== expected.expectedInputArtifactId) {
    return `The ${expected.phase} assignment's input artifact does not match this run's frozen evidence packet.`;
  }
  if (assignment.outputArtifactId !== expected.expectedOutputArtifactId) {
    return `The ${expected.phase} assignment's output artifact does not match this run's frozen ${expected.phase === "prepare" ? "evidence packet" : "independent review"}.`;
  }
  return null;
}

/**
 * Recomputes the whole work-cell verdict from the stored artifacts. Reads the
 * expected batch from the frozen manifest, re-derives both artifact hashes from
 * their payloads, and re-runs both validators. A tampered artifact fails here
 * rather than riding a stale pass.
 *
 * Validation ALWAYS checks against the frozen manifest's prepareExecutorKey and
 * reviewExecutorKey — never conditionally against whatever assignment happens
 * to exist. Deriving the expected key from an optional assignment lookup meant
 * a run with an accepted packet but no assignment validated with no executor
 * check at all (`expectedExecutorKey: undefined`), which the validator treats
 * as "don't check". This also requires each phase's completed assignment to
 * exist and to be bound to the exact artifact being validated, so an accepted
 * packet or review with no matching assignment hard-fails here instead of
 * validating as if the work cell were complete.
 */
async function computeValidationReport(
  db: SupabaseClient,
  runId: string,
): Promise<{ report: WorkCellValidationReport; packetArtifactId: string }> {
  const { manifest } = await requireInputManifest(db, runId);

  const packetRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  if (!packetRow) throw new DomainError("This run has no frozen catalog evidence packet to validate.");
  const packet = packetRow.payload as CatalogEvidencePacketV1;
  const storedPacketHash = String(packetRow.content_hash ?? "");

  const packetResult = validateCatalogEvidencePacket(packet, {
    expectedProductIds: manifest.expectedProductIds,
    expectedRunId: runId,
    expectedExecutorKey: manifest.prepareExecutorKey,
    expectedMarket: manifest.market,
  });

  const packetHashCheck = checkPayloadHash(packet, storedPacketHash, "packet");
  if (packetHashCheck.tampered) {
    packetResult.hardFailures.push(packetHashCheck.failure);
    packetResult.hardGatePass = false;
  }

  const prepareAssignment = await getAssignment(db, runId, "prepare");
  const prepareBindingFailure = await describeAssignmentBindingFailure(db, prepareAssignment, {
    phase: "prepare",
    expectedExecutorKey: manifest.prepareExecutorKey,
    expectedOutputArtifactId: String(packetRow.id),
  });
  if (prepareBindingFailure) {
    packetResult.hardFailures.push(prepareBindingFailure);
    packetResult.hardGatePass = false;
  }

  const reviewRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  let reviewResult: ValidationResult<CatalogEvidenceReviewMetrics> | null = null;
  if (reviewRow) {
    reviewResult = validateCatalogEvidenceReview(reviewRow.payload, {
      expectedPacketHash: storedPacketHash,
      claims: collectPacketClaims(packet),
      packetProductIds: packet.products.map((product) => product.productId),
      expectedRunId: runId,
      expectedReviewerKey: manifest.reviewExecutorKey,
    });

    const storedReviewHash = String(reviewRow.content_hash ?? "");
    const reviewHashCheck = checkPayloadHash(reviewRow.payload, storedReviewHash, "review");
    if (reviewHashCheck.tampered) {
      reviewResult.hardFailures.push(reviewHashCheck.failure);
      reviewResult.hardGatePass = false;
    }

    const reviewAssignment = await getAssignment(db, runId, "review");
    const reviewBindingFailure = await describeAssignmentBindingFailure(db, reviewAssignment, {
      phase: "review",
      expectedExecutorKey: manifest.reviewExecutorKey,
      expectedInputArtifactId: String(packetRow.id),
      expectedOutputArtifactId: String(reviewRow.id),
    });
    if (reviewBindingFailure) {
      reviewResult.hardFailures.push(reviewBindingFailure);
      reviewResult.hardGatePass = false;
    }
  }

  return {
    packetArtifactId: String(packetRow.id),
    report: {
      schemaVersion: WORK_CELL_VALIDATION_SCHEMA_VERSION,
      inputHash: manifest.inputHash,
      packetHash: storedPacketHash,
      reviewHash: reviewRow ? String(reviewRow.content_hash ?? "") : null,
      packet: packetResult,
      review: reviewResult,
      gate: summarizeWorkCellGate(packetResult, reviewResult),
      benchmark: summarizeWorkCellBenchmark(packetResult, reviewResult),
    },
  };
}

/**
 * Runs the deterministic validator over the frozen artifacts and records the
 * result as the validate-phase output.
 */
export async function runWorkCellValidation(actor: Actor, runId: string) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Deterministic work-cell validation runs while the run is still in progress.");
  }
  // Validation covers the whole cell, so it runs once both executor artifacts
  // exist. Validating a half-built cell would produce a report that looks
  // authoritative while describing an incomplete attempt.
  if (!(await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION))) {
    throw new DomainError("Ingest the independent review before running deterministic work-cell validation.");
  }

  const frozen = await requireInputManifest(db, runId);
  const { report, packetArtifactId } = await computeValidationReport(db, runId);
  const profile = await getProfileByKey(db, VALIDATOR_EXECUTOR_KEY);
  const reviewRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  const observation = await persistWorkCellObservation(
    db,
    actor,
    run,
    profile,
    "validate",
    { id: frozen.id, contentHash: frozen.contentHash, createdAt: frozen.manifest.createdAt },
    [
      {
        artifactId: packetArtifactId,
        schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
        contentHash: report.packetHash,
      },
      ...(reviewRow && report.reviewHash
        ? [
            {
              artifactId: String(reviewRow.id),
              schemaVersion: CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION,
              contentHash: report.reviewHash,
            },
          ]
        : []),
    ],
    "deterministic_validation_no_tools",
    ["deterministic_validation"],
  );
  const payload = report as unknown as Record<string, unknown>;
  const contentHash = sha256Hex(payload);

  await persistPhaseArtifact(db, actor, run, profile, {
    kind: "test",
    summary: `Deterministic work-cell validation: ${report.gate.hardGatePass ? "hard gate passed" : "hard gate FAILED"}.`,
    payload,
    contentHash,
    phase: "validate",
    assignmentStatus: "completed",
    inputArtifactId: packetArtifactId,
    assignmentMetadata: mergeObservationPointers(
      { hardGatePass: report.gate.hardGatePass, packetHash: report.packetHash, reviewHash: report.reviewHash },
      observation.pointers,
    ),
  });

  return report;
}

/**
 * Writes the work cell's verdict into the Gauntlet as exactly ONE authoritative
 * independent review row.
 *
 * One row, not two, is a safety property rather than a simplification. The
 * receipt guard passes a run as soon as ANY independent review has
 * verdict='passed' with a clean hard gate. A second row could therefore satisfy
 * the guard on its own while the first rejects the attempt. With a single row
 * whose verdict already incorporates the reviewer's conclusions, that is
 * impossible. It also makes this operation atomic and idempotent: one insert,
 * guarded by an existence check.
 */
export async function recordWorkCellGauntletReviews(actor: Actor, runId: string) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (!run.gauntlet_cycle_id) throw new DomainError("This run is not attached to a Gauntlet cycle.");
  if (run.status !== "awaiting_verification") {
    throw new DomainError("Work-cell verdicts are recorded once the run has been submitted for verification.");
  }

  // Probe by run_id ALONE, matching gauntlet_one_final_review_per_run_idx.
  // Filtering by reviewer_ref here would disagree with the constraint: a review
  // row written by any other path would be invisible to this check, so execution
  // would fall through and die on a raw unique violation instead of reporting
  // what actually happened.
  const { data: existing, error: existingError } = await db
    .from("gauntlet_reviews")
    .select("id, reviewer_ref, verdict")
    .eq("run_id", runId)
    .maybeSingle();
  if (existingError) throw new DomainError(existingError.message);

  const validateAssignment = await getAssignment(db, runId, "validate");
  if (!validateAssignment || validateAssignment.status !== "completed" || !validateAssignment.outputArtifactId) {
    throw new DomainError(
      "Deterministic work-cell validation has not completed for this run, so its verdict cannot be recorded. Validation runs while the run is in progress.",
    );
  }
  // The reserved reviewer_ref is bound at the database level to a completed
  // validate assignment's output artifact (see reserve_work_cell_reviewer_ref).
  // Checking the same binding here, before writing anything, turns a DB-trigger
  // exception into a clear application error and confirms the assignment
  // belongs to the registered validator specifically, not merely to some
  // deterministic executor.
  const validateProfile = await getProfileById(db, validateAssignment.executorProfileId);
  if (validateProfile.key !== VALIDATOR_EXECUTOR_KEY) {
    throw new DomainError(
      `The validate phase of this run was completed by executor "${validateProfile.key}", not the registered validator "${VALIDATOR_EXECUTOR_KEY}". The work-cell verdict can only be recorded over the registered validator's own output.`,
    );
  }
  const validationRow = await loadTypedArtifact(db, runId, WORK_CELL_VALIDATION_SCHEMA_VERSION);
  if (!validationRow || String(validationRow.id) !== validateAssignment.outputArtifactId) {
    throw new DomainError(
      "The validate assignment's recorded output does not match this run's validation artifact, so the work-cell verdict cannot be recorded.",
    );
  }

  const { report } = await computeValidationReport(db, runId);
  if (existing) {
    if (String(existing.reviewer_ref) === WORK_CELL_REVIEWER_REF) return report;
    throw new DomainError(
      `This run already carries a Gauntlet review from "${existing.reviewer_ref}" (verdict ${existing.verdict}), and a run may hold only one. The deterministic work-cell verdict cannot be recorded, so this attempt cannot be verified; retry the work under a new attempt.`,
    );
  }

  const { gate, benchmark } = report;
  const reviewArtifact = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  const reviewPayload = reviewArtifact ? (reviewArtifact.payload as CatalogEvidenceReviewV1) : null;

  const defects: unknown[] = [
    ...report.packet.hardFailures.map((finding) => ({ severity: "high", source: "packet-validation", finding })),
    ...(report.review?.hardFailures ?? []).map((finding) => ({ severity: "high", source: "review-validation", finding })),
    ...gate.reviewerBlockers.map((finding) => ({ severity: "high", source: "reviewer-conclusion", finding })),
    ...(reviewPayload?.claimReviews ?? [])
      .filter((claimReview) => claimReview.verdict === "reject")
      .map((claimReview) => ({
        severity: claimReview.severity,
        source: "reviewer-rejected-claim",
        claimId: claimReview.claimId,
        finding: claimReview.reason,
      })),
    ...(reviewPayload?.newFindings ?? []).map((finding) => ({ ...finding, source: "reviewer-new-finding" })),
  ];

  await addGauntletReview(actor, runId, {
    reviewerKind: "deterministic",
    reviewerRef: WORK_CELL_REVIEWER_REF,
    verdict: gate.workCellVerdict,
    hardGatePass: gate.hardGatePass,
    challengedAssumptions: reviewPayload?.challengedAssumptions ?? [],
    defects,
    evidenceGaps: [...report.packet.warnings, ...(reviewPayload?.evidenceGaps ?? [])],
    authorityIncidents: gate.authorityIncidents,
    workCellVerdict: true,
    notes: [
      `Work-cell verdict over frozen input ${report.inputHash}, packet ${report.packetHash}, review ${report.reviewHash ?? "none"}.`,
      `The hard gate reflects deterministic validation plus the independent reviewer's conclusions, never the reviewer's own gate claim.`,
      gate.reasons.join(" "),
      `Reviewer benchmark: ${benchmark.claimsReviewed} claim(s) reviewed, ${benchmark.independentVerifications} independently verified, ${benchmark.rejectedClaims} rejected, ${benchmark.newFindings} new finding(s).`,
      benchmark.reviewerCaughtDefectStructuralValidationMissed
        ? "The reviewer surfaced a defect structural validation did not. That is good reviewer performance and a failed attempt; both are true."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  });

  await audit(db, actor, run.organization_id, "execution.evidence_added", "workstream_run", runId, {
    workCellHardGatePass: gate.hardGatePass,
    workCellVerdict: gate.workCellVerdict,
    authorityIncidents: gate.authorityIncidents.length,
    reviewerBlockers: gate.reviewerBlockers.length,
  });

  return report;
}

// --- Read surface ------------------------------------------------------------------

export type WorkCellBundle = {
  manifest: CatalogEvidenceInputManifestV1 | null;
  assignments: Array<RunExecutorAssignment & { profile: ExecutorProfile | null }>;
  packet: { id: string; contentHash: string; payload: CatalogEvidencePacketV1 } | null;
  review: { id: string; contentHash: string; payload: CatalogEvidenceReviewV1 } | null;
  validation: WorkCellValidationReport | null;
  rejections: Array<{ id: string; phase: string; declaredExecutorKey: string; hardFailures: string[]; rawOutputHash: string }>;
  ledgerObservationCount: number;
};

export async function getRunWorkCell(actor: Actor, runId: string): Promise<WorkCellBundle> {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);

  const [assignmentResult, profileResult, artifactResult] = await Promise.all([
    db.from("run_executor_assignments").select("*").eq("run_id", run.id).order("created_at", { ascending: true }),
    db.from("executor_profiles").select("*"),
    db.from("evidence_artifacts").select("*").eq("run_id", run.id).order("created_at", { ascending: true }),
  ]);
  for (const result of [assignmentResult, profileResult, artifactResult]) {
    if (result.error) throw new DomainError(result.error.message);
  }

  const profiles = new Map(
    ((profileResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const profile = mapProfile(row);
      return [profile.id, profile] as const;
    }),
  );
  const artifacts = (artifactResult.data ?? []) as Array<Record<string, unknown>>;
  const find = (schemaVersion: string) =>
    artifacts.find((row) => asObject(row.payload).schemaVersion === schemaVersion) ?? null;

  const manifestRow = find(CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION);
  const packetRow = find(CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  const reviewRow = find(CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  const validationRow = find(WORK_CELL_VALIDATION_SCHEMA_VERSION);
  const ledgerObservationCount = artifacts.filter(
    (row) => asObject(row.payload).schemaVersion === "capability-performance-ledger/v1",
  ).length;

  const rejections = artifacts
    .filter((row) => asObject(row.payload).schemaVersion === WORK_CELL_REJECTION_SCHEMA_VERSION)
    .map((row) => {
      const payload = asObject(row.payload);
      return {
        id: String(row.id),
        phase: String(payload.phase ?? ""),
        declaredExecutorKey: String(payload.declaredExecutorKey ?? ""),
        hardFailures: asArray(payload.hardFailures).map(String),
        rawOutputHash: String(payload.rawOutputHash ?? ""),
      };
    });

  return {
    manifest: manifestRow ? (manifestRow.payload as unknown as CatalogEvidenceInputManifestV1) : null,
    assignments: ((assignmentResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const assignment = mapAssignment(row);
      return { ...assignment, profile: profiles.get(assignment.executorProfileId) ?? null };
    }),
    packet: packetRow
      ? { id: String(packetRow.id), contentHash: String(packetRow.content_hash ?? ""), payload: packetRow.payload as CatalogEvidencePacketV1 }
      : null,
    review: reviewRow
      ? { id: String(reviewRow.id), contentHash: String(reviewRow.content_hash ?? ""), payload: reviewRow.payload as CatalogEvidenceReviewV1 }
      : null,
    validation: validationRow ? (validationRow.payload as unknown as WorkCellValidationReport) : null,
    rejections,
    ledgerObservationCount,
  };
}

export async function listExecutorProfiles(actor: Actor) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const { data, error } = await db.from("executor_profiles").select("*").order("key", { ascending: true });
  if (error) throw new DomainError(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapProfile);
}
