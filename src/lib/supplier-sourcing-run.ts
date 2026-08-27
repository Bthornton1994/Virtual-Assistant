import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthzError, DomainError, assertOrgAccess, type Actor } from "@/lib/domain";
import { addGauntletReview } from "@/lib/gauntlet";
import { transitionWorkstreamRun } from "@/lib/execution-primitives";
import { supabaseServer } from "@/lib/supabase/server";
import { checkPayloadHash, sha256Hex, sha256Text } from "@/lib/catalog-evidence-hash";
import { parseExtractedJson } from "@/lib/work-cell-json";
import {
  SUPPLIER_SOURCING_EXECUTOR_KEYS,
} from "@/lib/capability-registry";
import {
  SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION,
  SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION,
  SUPPLIER_SOURCING_REVIEW_SCHEMA_VERSION,
  SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
  SUPPLIER_SOURCING_REJECTION_SCHEMA_VERSION,
  hashSupplierSourcingInput,
  hashSupplierSourcingPacket,
  hashSupplierSourcingReview,
  serializeSupplierSourcingRejection,
  supplierSourcingAuthorityReport,
  supplierSourcingInputManifestV1Schema,
  supplierSourcingPacketV1Schema,
  supplierSourcingReviewV1Schema,
  supplierSourcingValidationV1Schema,
  buildGrokSupplierSourcingPrompt,
  validateSupplierSourcingInputManifest,
  validateSupplierSourcingPacket,
  validateSupplierSourcingReview,
  type SupplierSourcingInputManifestV1,
  type SupplierSourcingPacketV1,
  type SupplierSourcingReviewV1,
  type SupplierSourcingValidationV1,
  type SupplierSourcingValidationResult,
  type SupplierSourcingValidationMetrics,
} from "@/lib/supplier-sourcing";

export const SUPPLIER_SOURCING_REVIEWER_REF = "delegation-cloud-supplier-sourcing-v1";

type SupplierRun = {
  id: string;
  organizationId: string;
  organization_id: string;
  status: string;
  gauntletCycleId: string | null;
  gauntlet_cycle_id: string | null;
};

type SupplierProfile = {
  id: string;
  key: string;
  executorKind: string;
  role: string;
  status: string;
  provider: string;
  authorityEnvelope: Record<string, unknown>;
  forbiddenActions: unknown[];
  configurationMetadata: Record<string, unknown>;
};

type TypedArtifact = {
  id: string;
  contentHash: string;
  payload: Record<string, unknown>;
};

type Phase = "prepare" | "review" | "validate";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapRun(row: Record<string, unknown>): SupplierRun {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    organization_id: String(row.organization_id),
    status: String(row.status),
    gauntletCycleId: (row.gauntlet_cycle_id as string | null) ?? null,
    gauntlet_cycle_id: (row.gauntlet_cycle_id as string | null) ?? null,
  };
}

function mapProfile(row: Record<string, unknown>): SupplierProfile {
  return {
    id: String(row.id),
    key: String(row.key),
    executorKind: String(row.executor_kind ?? ""),
    role: String(row.role ?? ""),
    status: String(row.status ?? ""),
    provider: String(row.provider ?? ""),
    authorityEnvelope: asObject(row.authority_envelope),
    forbiddenActions: Array.isArray(row.forbidden_actions) ? row.forbidden_actions : [],
    configurationMetadata: asObject(row.configuration_metadata),
  };
}

async function persistentDb(actor: Actor): Promise<SupabaseClient> {
  if (actor.source === "demo") {
    throw new DomainError("Supplier sourcing requires the persistent Supabase workspace.");
  }
  const db = await supabaseServer();
  if (!db) throw new DomainError("Supplier sourcing requires Supabase.");
  return db;
}

function managerOnly(actor: Actor) {
  if (actor.role !== "ops_manager" && actor.role !== "platform_admin") {
    throw new AuthzError("Only operations managers can run supplier sourcing phases.");
  }
}

async function loadRun(db: SupabaseClient, actor: Actor, runId: string): Promise<SupplierRun> {
  const { data, error } = await db
    .from("workstream_runs")
    .select("id, organization_id, status, gauntlet_cycle_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Supplier sourcing workstream run was not found.");
  const run = mapRun(data as Record<string, unknown>);
  assertOrgAccess(actor, run.organizationId);
  return run;
}

async function loadTypedArtifact(
  db: SupabaseClient,
  runId: string,
  schemaVersion: string,
): Promise<TypedArtifact | null> {
  const { data, error } = await db
    .from("evidence_artifacts")
    .select("id, content_hash, payload")
    .eq("run_id", runId)
    .eq("payload->>schemaVersion", schemaVersion)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) return null;
  return {
    id: String(data.id),
    contentHash: String(data.content_hash ?? ""),
    payload: asObject(data.payload),
  };
}

async function loadProfile(db: SupabaseClient, key: string): Promise<SupplierProfile> {
  const { data, error } = await db
    .from("executor_profiles")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Executor profile " + key + " is not registered.");
  return mapProfile(data as Record<string, unknown>);
}

function assertProfileFitsPhase(profile: SupplierProfile, phase: Phase) {
  if (profile.status === "suspended" || profile.status === "retired") {
    throw new DomainError("Executor " + profile.key + " is " + profile.status + " and cannot take new work.");
  }
  if (phase === "validate") {
    if (profile.key !== SUPPLIER_SOURCING_EXECUTOR_KEYS.validate || profile.executorKind !== "deterministic") {
      throw new DomainError("Supplier sourcing validation requires the registered deterministic validator.");
    }
    return;
  }
  const expectedRole = phase === "prepare" ? "researcher" : "reviewer";
  if (profile.role !== expectedRole || profile.executorKind === "deterministic") {
    throw new DomainError(
      "Executor " +
        profile.key +
        " does not satisfy the " +
        phase +
        " supplier-sourcing phase contract.",
    );
  }
}

function authoritySnapshot(profile: SupplierProfile): Record<string, unknown> {
  return {
    executorKey: profile.key,
    executorKind: profile.executorKind,
    executorRole: profile.role,
    provider: profile.provider,
    profileStatus: profile.status,
    authorityEnvelope: profile.authorityEnvelope,
    forbiddenActions: profile.forbiddenActions,
    configurationMetadata: profile.configurationMetadata,
  };
}

async function insertManifestArtifact(
  db: SupabaseClient,
  actor: Actor,
  run: SupplierRun,
  manifest: SupplierSourcingInputManifestV1,
): Promise<string> {
  const payload = manifest as unknown as Record<string, unknown>;
  const { data, error } = await db
    .from("evidence_artifacts")
    .insert({
      organization_id: run.organization_id,
      run_id: run.id,
      kind: "other",
      summary: "Frozen supplier-sourcing input manifest covering " + manifest.candidates.length + " candidate(s).",
      source_uri: null,
      content_hash: sha256Hex(payload),
      payload,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) throw new DomainError(error.message);
  return String(data.id);
}

async function loadInputManifest(db: SupabaseClient, runId: string) {
  const row = await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION);
  if (!row) return null;
  const result = validateSupplierSourcingInputManifest(row.payload);
  if (!result.ok) {
    throw new DomainError("The frozen supplier-sourcing input is invalid: " + result.failures.join(" "));
  }
  if (result.value.runId !== runId) {
    throw new DomainError("The frozen supplier-sourcing input belongs to a different workstream run.");
  }
  const hashCheck = checkPayloadHash(row.payload, row.contentHash, "supplier-sourcing input");
  if (hashCheck.tampered) throw new DomainError(hashCheck.failure);
  return { ...row, manifest: result.value };
}

async function requireInputManifest(db: SupabaseClient, runId: string) {
  const input = await loadInputManifest(db, runId);
  if (!input) {
    throw new DomainError("Freeze the supplier-sourcing input manifest before running an executor phase.");
  }
  return input;
}

async function getPhaseAssignment(db: SupabaseClient, runId: string, phase: Phase) {
  const { data, error } = await db
    .from("run_executor_assignments")
    .select("id, status, executor_profile_id, input_artifact_id, output_artifact_id")
    .eq("run_id", runId)
    .eq("phase", phase)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  return data as Record<string, unknown> | null;
}

async function persistPhaseArtifact(
  db: SupabaseClient,
  actor: Actor,
  run: SupplierRun,
  profile: SupplierProfile,
  input: {
    phase: Phase;
    payload: Record<string, unknown>;
    contentHash: string;
    summary: string;
    inputArtifactId?: string | null;
    assignmentStatus: "completed" | "failed";
    assignmentMetadata?: Record<string, unknown>;
    humanMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
  },
): Promise<{ artifactId: string; assignmentId: string }> {
  assertProfileFitsPhase(profile, input.phase);
  if (await getPhaseAssignment(db, run.id, input.phase)) {
    throw new DomainError(
      "The " +
        input.phase +
        " supplier-sourcing phase is already recorded. Retry the Gauntlet with a new attempt.",
    );
  }

  const { data, error } = await db.rpc("record_work_cell_phase_artifact", {
    p_run_id: run.id,
    p_kind: input.phase === "validate" ? "test" : "source",
    p_summary: input.summary,
    p_source_uri: null,
    p_content_hash: input.contentHash,
    p_payload: input.payload,
    p_executor_profile_id: profile.id,
    p_phase: input.phase,
    p_assignment_status: input.assignmentStatus,
    p_authority_snapshot: authoritySnapshot(profile),
    p_input_artifact_id: input.inputArtifactId ?? null,
    p_human_minutes: input.humanMinutes ?? 0,
    p_ai_cost_micros: Math.round(input.aiCostMicros ?? 0),
    p_tool_cost_micros: Math.round(input.toolCostMicros ?? 0),
    p_assignment_metadata: input.assignmentMetadata ?? {},
  });
  if (error) throw new DomainError(error.message);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
    artifact_id?: string;
    assignment_id?: string;
  }>;
  const row = rows[0];
  if (!row?.artifact_id || !row.assignment_id) {
    throw new DomainError("The supplier-sourcing phase persistence RPC returned no artifact binding.");
  }
  return { artifactId: String(row.artifact_id), assignmentId: String(row.assignment_id) };
}

async function recordRejectedOutput(
  db: SupabaseClient,
  actor: Actor,
  run: SupplierRun,
  profile: SupplierProfile,
  phase: Phase,
  raw: string,
  failures: string[],
  inputArtifactId: string | null,
  metrics?: SupplierSourcingValidationMetrics,
) {
  const payload = {
    ...serializeSupplierSourcingRejection(
      run.id,
      profile.key,
      sha256Text(raw),
      failures,
    ),
    phase,
    metrics: metrics ?? null,
  };
  return persistPhaseArtifact(db, actor, run, profile, {
    phase,
    payload,
    contentHash: sha256Hex(payload),
    summary: "Rejected " + phase + " output from " + profile.key + ".",
    inputArtifactId,
    assignmentStatus: "failed",
    assignmentMetadata: {
      rejected: true,
      rawOutputHash: sha256Text(raw),
      failureCount: failures.length,
    },
  });
}

export async function freezeSupplierSourcingInputManifest(
  actor: Actor,
  runId: string,
  input: {
    objective: string;
    market: string;
    catalogRepository?: string | null;
    catalogRepositorySha?: string | null;
    candidates: unknown[];
    prepareExecutorKey?: string;
    reviewExecutorKey?: string;
  },
) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Freeze the supplier-sourcing input while the run is running.");
  }
  if (await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen supplier-sourcing input.");
  }

  const prepareExecutorKey = input.prepareExecutorKey?.trim() || SUPPLIER_SOURCING_EXECUTOR_KEYS.prepare;
  const reviewExecutorKey = input.reviewExecutorKey?.trim() || SUPPLIER_SOURCING_EXECUTOR_KEYS.review;
  const prepareProfile = await loadProfile(db, prepareExecutorKey);
  const reviewProfile = await loadProfile(db, reviewExecutorKey);
  assertProfileFitsPhase(prepareProfile, "prepare");
  assertProfileFitsPhase(reviewProfile, "review");
  if (prepareProfile.key === reviewProfile.key) {
    throw new DomainError("Supplier sourcing prepare and review executors must be different.");
  }

  const createdAt = new Date().toISOString();
  const unsigned = {
    schemaVersion: SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION,
    runId,
    objective: input.objective.trim(),
    market: input.market.trim(),
    catalogRepository: input.catalogRepository?.trim() || null,
    catalogRepositorySha: input.catalogRepositorySha?.trim() || null,
    candidates: input.candidates,
    prepareExecutorKey,
    reviewExecutorKey,
    createdAt,
    inputHash: "",
  } as unknown as SupplierSourcingInputManifestV1;
  const manifestCandidate = {
    ...unsigned,
    inputHash: hashSupplierSourcingInput(unsigned),
  };
  const validated = validateSupplierSourcingInputManifest(manifestCandidate);
  if (!validated.ok) throw new DomainError("The supplier-sourcing input is invalid: " + validated.failures.join(" "));

  const artifactId = await insertManifestArtifact(db, actor, run, validated.value);
  return { manifest: validated.value, artifactId };
}

export type SupplierSourcingPacketIngestResult = {
  persisted: boolean;
  validation: SupplierSourcingValidationResult;
  contentHash: string | null;
  artifactId: string | null;
};

export async function ingestSupplierSourcingPacket(
  actor: Actor,
  runId: string,
  input: { raw: string; humanMinutes?: number; aiCostMicros?: number; toolCostMicros?: number },
): Promise<SupplierSourcingPacketIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") throw new DomainError("Supplier packet ingest requires a running attempt.");
  const inputArtifact = await requireInputManifest(db, runId);
  if (await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a supplier-sourcing packet.");
  }

  const profile = await loadProfile(db, inputArtifact.manifest.prepareExecutorKey);
  assertProfileFitsPhase(profile, "prepare");
  const parsed = parseExtractedJson(input.raw);
  let validation = parsed.ok
    ? validateSupplierSourcingPacket(parsed.value, {
        manifest: inputArtifact.manifest,
        expectedExecutorKey: profile.key,
      })
    : validateSupplierSourcingPacket(null, {
        manifest: inputArtifact.manifest,
        expectedExecutorKey: profile.key,
      });

  if (!parsed.ok) {
    validation = {
      ...validation,
      hardFailures: [parsed.error, ...validation.hardFailures],
    };
  }
  if (!validation.hardGatePass) {
    await recordRejectedOutput(
      db,
      actor,
      run,
      profile,
      "prepare",
      input.raw,
      validation.hardFailures,
      inputArtifact.id,
      validation.metrics,
    );
    return { persisted: false, validation, contentHash: null, artifactId: null };
  }

  const packetResult = supplierSourcingPacketV1Schema.safeParse(parsed.ok ? parsed.value : null);
  if (!packetResult.success) {
    throw new DomainError("Supplier packet passed validation but could not be parsed as its typed contract.");
  }
  const packet = packetResult.data;
  const contentHash = hashSupplierSourcingPacket(packet);
  const persisted = await persistPhaseArtifact(db, actor, run, profile, {
    phase: "prepare",
    payload: packet as unknown as Record<string, unknown>,
    contentHash,
    summary: "Accepted supplier-sourcing packet from " + profile.key + ".",
    inputArtifactId: inputArtifact.id,
    assignmentStatus: "completed",
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    assignmentMetadata: {
      inputHash: inputArtifact.manifest.inputHash,
      packetHash: contentHash,
      candidateCount: validation.metrics.candidateCount,
    },
  });
  return { persisted: true, validation, contentHash, artifactId: persisted.artifactId };
}

export type SupplierSourcingReviewIngestResult = {
  persisted: boolean;
  hardGatePass: boolean;
  hardFailures: string[];
  warnings: string[];
  contentHash: string | null;
  artifactId: string | null;
  expectedPacketHash: string;
};

export async function ingestSupplierSourcingReview(
  actor: Actor,
  runId: string,
  input: { raw: string; humanMinutes?: number; aiCostMicros?: number; toolCostMicros?: number },
): Promise<SupplierSourcingReviewIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") throw new DomainError("Supplier review ingest requires a running attempt.");
  const inputArtifact = await requireInputManifest(db, runId);
  const packetArtifact = await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION);
  if (!packetArtifact) throw new DomainError("Ingest a supplier-sourcing packet before its independent review.");
  if (await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_REVIEW_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a supplier-sourcing review.");
  }

  const packetResult = supplierSourcingPacketV1Schema.safeParse(packetArtifact.payload);
  if (!packetResult.success) throw new DomainError("The stored supplier packet is no longer a valid typed contract.");
  const packetHashCheck = checkPayloadHash(
    packetArtifact.payload,
    packetArtifact.contentHash,
    "supplier-sourcing packet",
  );
  if (packetHashCheck.tampered) throw new DomainError(packetHashCheck.failure);

  const profile = await loadProfile(db, inputArtifact.manifest.reviewExecutorKey);
  assertProfileFitsPhase(profile, "review");
  const parsed = parseExtractedJson(input.raw);
  const validation = parsed.ok
    ? validateSupplierSourcingReview(parsed.value, {
        manifest: inputArtifact.manifest,
        packetHash: packetArtifact.contentHash,
        expectedReviewerKey: profile.key,
      })
    : {
        hardGatePass: false,
        hardFailures: [parsed.error],
        warnings: [],
      };
  if (!validation.hardGatePass) {
    await recordRejectedOutput(
      db,
      actor,
      run,
      profile,
      "review",
      input.raw,
      validation.hardFailures,
      packetArtifact.id,
    );
    return {
      persisted: false,
      ...validation,
      contentHash: null,
      artifactId: null,
      expectedPacketHash: packetArtifact.contentHash,
    };
  }

  const reviewResult = supplierSourcingReviewV1Schema.safeParse(parsed.ok ? parsed.value : null);
  if (!reviewResult.success) {
    throw new DomainError("Supplier review passed validation but could not be parsed as its typed contract.");
  }
  const review = reviewResult.data;
  const contentHash = hashSupplierSourcingReview(review);
  const persisted = await persistPhaseArtifact(db, actor, run, profile, {
    phase: "review",
    payload: review as unknown as Record<string, unknown>,
    contentHash,
    summary: "Accepted supplier-sourcing review from " + profile.key + ".",
    inputArtifactId: packetArtifact.id,
    assignmentStatus: "completed",
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    assignmentMetadata: {
      packetHash: packetArtifact.contentHash,
      reviewHash: contentHash,
    },
  });
  return {
    persisted: true,
    ...validation,
    contentHash,
    artifactId: persisted.artifactId,
    expectedPacketHash: packetArtifact.contentHash,
  };
}

function buildValidationPayload(
  runId: string,
  manifest: SupplierSourcingInputManifestV1,
  packet: TypedArtifact,
  review: TypedArtifact,
): SupplierSourcingValidationV1 {
  const packetResult = supplierSourcingPacketV1Schema.safeParse(packet.payload);
  const reviewResult = supplierSourcingReviewV1Schema.safeParse(review.payload);
  if (!packetResult.success || !reviewResult.success) {
    throw new DomainError("Supplier sourcing validation requires valid packet and review artifacts.");
  }

  const packetValidation = validateSupplierSourcingPacket(packetResult.data, {
    manifest,
    expectedExecutorKey: manifest.prepareExecutorKey,
  });
  const reviewValidation = validateSupplierSourcingReview(reviewResult.data, {
    manifest,
    packetHash: packet.contentHash,
    expectedReviewerKey: manifest.reviewExecutorKey,
  });
  const packetHashCheck = checkPayloadHash(packet.payload, packet.contentHash, "supplier-sourcing packet");
  if (packetHashCheck.tampered) {
    packetValidation.hardFailures.push(packetHashCheck.failure);
    packetValidation.hardGatePass = false;
  }
  const reviewHashCheck = checkPayloadHash(review.payload, review.contentHash, "supplier-sourcing review");
  if (reviewHashCheck.tampered) {
    reviewValidation.hardFailures.push(reviewHashCheck.failure);
    reviewValidation.hardGatePass = false;
  }

  const hardFailures = [...packetValidation.hardFailures, ...reviewValidation.hardFailures];
  const warnings = [...packetValidation.warnings, ...reviewValidation.warnings];
  const candidateCount = manifest.candidates.length;
  const payload = {
    schemaVersion: SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
    runId,
    inputHash: manifest.inputHash,
    packetHash: packet.contentHash,
    reviewHash: review.contentHash,
    packet: packetValidation,
    review: reviewValidation,
    hardGatePass: packetValidation.hardGatePass && reviewValidation.hardGatePass,
    hardFailures,
    warnings,
    authorityReport: supplierSourcingAuthorityReport(),
  };
  const parsed = supplierSourcingValidationV1Schema.safeParse(payload);
  if (!parsed.success) {
    throw new DomainError(
      "Supplier sourcing validation report is not internally valid: " +
        parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  if (parsed.data.packet.metrics.candidateCount !== candidateCount) {
    throw new DomainError("Supplier sourcing validation report candidate count drifted from the frozen input.");
  }
  return parsed.data;
}

function addAssignmentFailure(
  failures: string[],
  assignment: Record<string, unknown> | null,
  phase: Phase,
  expectedArtifactId: string,
) {
  if (!assignment || assignment.status !== "completed") {
    failures.push("No completed " + phase + " assignment is bound to the expected supplier-sourcing artifact.");
    return;
  }
  if (String(assignment.output_artifact_id ?? "") !== expectedArtifactId) {
    failures.push("The " + phase + " assignment output is not bound to the expected supplier-sourcing artifact.");
  }
}

export async function runSupplierSourcingValidation(
  actor: Actor,
  runId: string,
): Promise<SupplierSourcingValidationV1> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") throw new DomainError("Supplier validation requires a running attempt.");
  const inputArtifact = await requireInputManifest(db, runId);
  const packetArtifact = await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION);
  const reviewArtifact = await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_REVIEW_SCHEMA_VERSION);
  if (!packetArtifact || !reviewArtifact) {
    throw new DomainError("Supplier validation requires both an accepted packet and an accepted independent review.");
  }
  if (await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a supplier-sourcing validation report.");
  }

  const profile = await loadProfile(db, SUPPLIER_SOURCING_EXECUTOR_KEYS.validate);
  assertProfileFitsPhase(profile, "validate");
  const packetResult = supplierSourcingPacketV1Schema.safeParse(packetArtifact.payload);
  const reviewResult = supplierSourcingReviewV1Schema.safeParse(reviewArtifact.payload);
  if (!packetResult.success || !reviewResult.success) {
    throw new DomainError("Supplier validation inputs are not valid typed artifacts.");
  }

  const validation = buildValidationPayload(runId, inputArtifact.manifest, packetArtifact, reviewArtifact);
  const failures = [...validation.hardFailures];
  const prepareAssignment = await getPhaseAssignment(db, runId, "prepare");
  const reviewAssignment = await getPhaseAssignment(db, runId, "review");
  addAssignmentFailure(failures, prepareAssignment, "prepare", packetArtifact.id);
  addAssignmentFailure(failures, reviewAssignment, "review", reviewArtifact.id);
  const finalValidation: SupplierSourcingValidationV1 = {
    ...validation,
    hardGatePass: validation.hardGatePass && failures.length === 0,
    hardFailures: failures,
  };
  const checked = supplierSourcingValidationV1Schema.safeParse(finalValidation);
  if (!checked.success) throw new DomainError("Supplier validation report failed its own schema check.");

  const contentHash = sha256Hex(checked.data as unknown as Record<string, unknown>);
  const persisted = await persistPhaseArtifact(db, actor, run, profile, {
    phase: "validate",
    payload: checked.data as unknown as Record<string, unknown>,
    contentHash,
    summary: "Deterministic supplier-sourcing validation: " + (checked.data.hardGatePass ? "passed." : "failed."),
    inputArtifactId: packetArtifact.id,
    assignmentStatus: "completed",
    assignmentMetadata: {
      hardGatePass: checked.data.hardGatePass,
      packetHash: checked.data.packetHash,
      reviewHash: checked.data.reviewHash,
    },
  });
  if (!persisted.artifactId) throw new DomainError("Supplier validation artifact was not persisted.");
  return checked.data;
}

export async function recordSupplierSourcingGauntletReview(
  actor: Actor,
  runId: string,
): Promise<SupplierSourcingValidationV1> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "awaiting_verification") {
    throw new DomainError("Submit the supplier-sourcing run before recording its deterministic Gauntlet review.");
  }
  if (!run.gauntlet_cycle_id) throw new DomainError("Supplier sourcing attempt is not attached to a Gauntlet cycle.");

  const validationArtifact = await loadTypedArtifact(db, runId, SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION);
  if (!validationArtifact) throw new DomainError("Supplier validation must complete before the Gauntlet review.");
  const parsed = supplierSourcingValidationV1Schema.safeParse(validationArtifact.payload);
  if (!parsed.success) throw new DomainError("The stored supplier validation report is invalid.");
  const validation = parsed.data;

  const validateAssignment = await getPhaseAssignment(db, runId, "validate");
  if (!validateAssignment || validateAssignment.status !== "completed") {
    throw new DomainError("The supplier validation assignment is not complete.");
  }
  if (String(validateAssignment.output_artifact_id ?? "") !== validationArtifact.id) {
    throw new DomainError("The supplier validation assignment is not bound to its output artifact.");
  }

  const validateProfile = await loadProfile(db, SUPPLIER_SOURCING_EXECUTOR_KEYS.validate);
  if (String(validateAssignment.executor_profile_id ?? "") !== validateProfile.id) {
    throw new DomainError("The supplier validation assignment is bound to a different executor profile.");
  }

  const { data: existing, error: existingError } = await db
    .from("gauntlet_reviews")
    .select("id, reviewer_ref")
    .eq("run_id", runId)
    .maybeSingle();
  if (existingError) throw new DomainError(existingError.message);
  if (existing) {
    if (String(existing.reviewer_ref) === SUPPLIER_SOURCING_REVIEWER_REF) return validation;
    throw new DomainError("This run already has a different final Gauntlet review.");
  }

  const defects = validation.hardFailures.map((finding) => ({
    severity: "high",
    source: "supplier-sourcing-validator",
    finding,
  }));
  await addGauntletReview(actor, runId, {
    reviewerKind: "deterministic",
    reviewerRef: SUPPLIER_SOURCING_REVIEWER_REF,
    verdict: validation.hardGatePass ? "passed" : "failed",
    hardGatePass: validation.hardGatePass,
    challengedAssumptions: [],
    defects,
    evidenceGaps: validation.warnings,
    authorityIncidents: [],
    workCellVerdict: true,
    notes:
      "Deterministic supplier-sourcing review over frozen input " +
      validation.inputHash +
      ", packet " +
      validation.packetHash +
      ", and review " +
      validation.reviewHash +
      ". No supplier relationship, catalog, purchase, or external-message action was performed.",
  });
  return validation;
}

export async function getGrokSupplierSourcingPrompt(
  actor: Actor,
  runId: string,
): Promise<string> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const input = await requireInputManifest(db, runId);
  return buildGrokSupplierSourcingPrompt(input.manifest);
}

export async function submitSupplierSourcingRun(
  actor: Actor,
  runId: string,
): Promise<SupplierSourcingValidationV1> {
  managerOnly(actor);
  const run = await loadRun(await persistentDb(actor), actor, runId);
  if (run.status === "running") {
    await transitionWorkstreamRun(actor, runId, "awaiting_verification", {
      notes: "Supplier sourcing phases complete; awaiting deterministic Gauntlet verification.",
    });
  } else if (run.status !== "awaiting_verification") {
    throw new DomainError("Supplier sourcing can only be submitted from a running attempt.");
  }
  return recordSupplierSourcingGauntletReview(actor, runId);
}
