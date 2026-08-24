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
import { hashCatalogEvidencePacket, sha256Hex, sha256Text } from "@/lib/catalog-evidence-hash";
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
 * Parses operator-pasted executor output. Never repairs, reformats, or coerces:
 * a malformed paste is an executor failure worth surfacing, not something to fix
 * silently on the executor's behalf.
 */
export function parseRawExecutorJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "No executor output was provided." };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return { ok: false, error: `Executor output is not valid JSON: ${(error as Error).message}` };
  }
}

async function loadRun(db: SupabaseClient, actor: Actor, runId: string) {
  const { data, error } = await db
    .from("workstream_runs")
    .select("id, organization_id, status, gauntlet_cycle_id")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("Workstream run not found.");
  assertOrgAccess(actor, String(data.organization_id));
  return data as { id: string; organization_id: string; status: string; gauntlet_cycle_id: string | null };
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

async function createAssignment(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string },
  profile: ExecutorProfile,
  input: {
    phase: ExecutorPhase;
    status: RunExecutorAssignment["status"];
    inputArtifactId?: string | null;
    outputArtifactId?: string | null;
    humanMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
    metadata?: Record<string, unknown>;
  },
) {
  assertProfileFitsPhase(profile, input.phase);

  const existing = await getAssignment(db, run.id, input.phase);
  if (existing) {
    throw new DomainError(
      `The ${input.phase} phase of this run is already assigned. A second ${input.phase} pass belongs to a new Gauntlet attempt, not an overwrite.`,
    );
  }

  const { data, error } = await db
    .from("run_executor_assignments")
    .insert({
      organization_id: run.organization_id,
      run_id: run.id,
      executor_profile_id: profile.id,
      phase: input.phase,
      status: input.status,
      authority_snapshot: {
        executorKey: profile.key,
        executorKind: profile.executorKind,
        executorRole: profile.role,
        profileStatus: profile.status,
        authorityEnvelope: profile.authorityEnvelope,
        forbiddenActions: profile.forbiddenActions,
      },
      input_artifact_id: input.inputArtifactId ?? null,
      output_artifact_id: input.outputArtifactId ?? null,
      human_minutes: input.humanMinutes ?? 0,
      ai_cost_micros: Math.round(input.aiCostMicros ?? 0),
      tool_cost_micros: Math.round(input.toolCostMicros ?? 0),
      metadata: input.metadata ?? {},
      created_by: actor.id,
    })
    .select("*")
    .single();
  if (error) throw new DomainError(error.message);
  return mapAssignment(data as Record<string, unknown>);
}

/**
 * Records a rejected executor output as immutable, clearly-untrusted evidence.
 *
 * The rejected payload never becomes a CatalogEvidencePacketV1 or
 * CatalogEvidenceReviewV1 artifact, so no later stage can mistake it for
 * accepted evidence. But the attempt, its hash, and why it failed stay
 * auditable, because a rejected executor run is exactly the raw material the
 * Gauntlet needs for failure classification and executor economics.
 */
async function recordRejectedExecutorOutput(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string },
  input: { phase: ExecutorPhase; declaredExecutorKey: string; raw: string; hardFailures: string[]; metrics: Record<string, number> },
) {
  const rawHash = sha256Text(input.raw);
  const payload = {
    schemaVersion: WORK_CELL_REJECTION_SCHEMA_VERSION,
    runId: run.id,
    phase: input.phase,
    declaredExecutorKey: input.declaredExecutorKey,
    rawOutputHash: rawHash,
    rawOutputExcerpt: input.raw.slice(0, REJECTED_OUTPUT_EXCERPT_LIMIT),
    rawOutputTruncated: input.raw.length > REJECTED_OUTPUT_EXCERPT_LIMIT,
    rawOutputLength: input.raw.length,
    hardFailures: input.hardFailures,
    metrics: input.metrics,
  };
  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "other",
    summary: `REJECTED ${input.phase} output (${input.hardFailures.length} hard failure(s)). Not accepted as evidence.`,
    payload,
    contentHash: sha256Hex(payload),
  });
  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", String(artifact.id), {
    runId: run.id,
    schemaVersion: WORK_CELL_REJECTION_SCHEMA_VERSION,
    phase: input.phase,
    rawOutputHash: rawHash,
    rejected: true,
  });
  return String(artifact.id);
}

// --- Frozen input manifest ---------------------------------------------------------

async function loadInputManifest(db: SupabaseClient, runId: string) {
  const row = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION);
  if (!row) return null;
  const result = validateInputManifest(row.payload, sha256Hex);
  if (!result.ok) throw new DomainError(`The frozen input manifest for this run is invalid: ${result.failures.join(" ")}`);
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
  input: { market: string; expectedProductIds: string[]; prepareExecutorKey: string; reviewExecutorKey: string },
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
  const duplicates = expectedProductIds.filter((id, i) => expectedProductIds.indexOf(id) !== i);
  if (duplicates.length) {
    throw new DomainError(`The input manifest lists duplicate product IDs: ${[...new Set(duplicates)].join(", ")}.`);
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

  const manifest: CatalogEvidenceInputManifestV1 = {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    runId,
    market,
    expectedProductIds,
    prepareExecutorKey,
    reviewExecutorKey,
    createdAt: new Date().toISOString(),
    inputHash: sha256Hex(
      inputManifestHashSource({ runId, market, expectedProductIds, prepareExecutorKey, reviewExecutorKey }),
    ),
  };

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
  const { manifest } = await requireInputManifest(db, runId);
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen catalog evidence packet. Ingesting another belongs to a new attempt.");
  }

  // The executor identity comes from the frozen manifest, never from operator
  // input at ingest time: an operator must not be able to relabel one executor's
  // output as another's after seeing it.
  const profile = await getProfileByKey(db, manifest.prepareExecutorKey);

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
      declaredExecutorKey: profile.key,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
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
      declaredExecutorKey: profile.key,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
    });
    return { persisted: false, contentHash: null, artifactId: null, validation };
  }

  const packet = parsed.value as CatalogEvidencePacketV1;
  const contentHash = hashCatalogEvidencePacket(packet);

  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "source",
    summary: `Catalog evidence packet v1 from ${profile.key} covering ${packet.products.length} product(s).`,
    payload: packet as unknown as Record<string, unknown>,
    contentHash,
  });

  await createAssignment(db, actor, run, profile, {
    phase: "prepare",
    status: "completed",
    inputArtifactId: null,
    outputArtifactId: String(artifact.id),
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    metadata: { packetHash: contentHash, productCount: validation.metrics.productCount, inputHash: manifest.inputHash },
  });

  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", String(artifact.id), {
    runId,
    schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
    executorKey: profile.key,
    contentHash,
  });

  return { persisted: true, validation, contentHash, artifactId: String(artifact.id) };
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
  const { manifest } = await requireInputManifest(db, runId);

  const packetRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  if (!packetRow) throw new DomainError("Freeze a catalog evidence packet before ingesting an independent review.");
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen independent review. Ingesting another belongs to a new attempt.");
  }

  const packet = packetRow.payload as CatalogEvidencePacketV1;
  const expectedPacketHash = String(packetRow.content_hash ?? "");
  const profile = await getProfileByKey(db, manifest.reviewExecutorKey);
  const context = {
    expectedPacketHash,
    claims: collectPacketClaims(packet),
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
      declaredExecutorKey: profile.key,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
    });
    return { persisted: false, contentHash: null, artifactId: null, expectedPacketHash, validation };
  }

  const validation = validateCatalogEvidenceReview(parsed.value, context);
  if (!validation.hardGatePass) {
    await recordRejectedExecutorOutput(db, actor, run, {
      phase: "review",
      declaredExecutorKey: profile.key,
      raw: input.raw,
      hardFailures: validation.hardFailures,
      metrics: validation.metrics as unknown as Record<string, number>,
    });
    return { persisted: false, contentHash: null, artifactId: null, expectedPacketHash, validation };
  }

  const reviewPacket = parsed.value as CatalogEvidenceReviewV1;
  const contentHash = sha256Hex(reviewPacket);

  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "source",
    summary: `Independent catalog evidence review v1 from ${profile.key} covering ${reviewPacket.claimReviews.length} claim(s).`,
    payload: reviewPacket as unknown as Record<string, unknown>,
    contentHash,
  });

  await createAssignment(db, actor, run, profile, {
    phase: "review",
    status: "completed",
    inputArtifactId: String(packetRow.id),
    outputArtifactId: String(artifact.id),
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    metadata: { reviewHash: contentHash, reviewedPacketHash: expectedPacketHash },
  });

  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", String(artifact.id), {
    runId,
    schemaVersion: CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION,
    executorKey: profile.key,
    contentHash,
    reviewedPacketHash: expectedPacketHash,
  });

  return { persisted: true, validation, contentHash, artifactId: String(artifact.id), expectedPacketHash };
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
 * Recomputes the whole work-cell verdict from the stored artifacts. Reads the
 * expected batch from the frozen manifest, re-derives both artifact hashes from
 * their payloads, and re-runs both validators. A tampered artifact fails here
 * rather than riding a stale pass.
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

  const prepareAssignment = await getAssignment(db, runId, "prepare");
  const preparedBy = prepareAssignment ? await getProfileById(db, prepareAssignment.executorProfileId) : null;

  const packetResult = validateCatalogEvidencePacket(packet, {
    expectedProductIds: manifest.expectedProductIds,
    expectedRunId: runId,
    expectedExecutorKey: preparedBy?.key,
    expectedMarket: manifest.market,
  });

  const recomputedPacketHash = hashCatalogEvidencePacket(packet);
  if (recomputedPacketHash !== storedPacketHash) {
    packetResult.hardFailures.push(
      `Stored packet hash "${storedPacketHash}" does not match the hash recomputed from its payload ("${recomputedPacketHash}").`,
    );
    packetResult.hardGatePass = false;
  }

  const reviewRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  let reviewResult: ValidationResult<CatalogEvidenceReviewMetrics> | null = null;
  if (reviewRow) {
    const reviewAssignment = await getAssignment(db, runId, "review");
    const reviewedBy = reviewAssignment ? await getProfileById(db, reviewAssignment.executorProfileId) : null;
    reviewResult = validateCatalogEvidenceReview(reviewRow.payload, {
      expectedPacketHash: storedPacketHash,
      claims: collectPacketClaims(packet),
      expectedRunId: runId,
      expectedReviewerKey: reviewedBy?.key,
    });

    const storedReviewHash = String(reviewRow.content_hash ?? "");
    const recomputedReviewHash = sha256Hex(reviewRow.payload);
    if (recomputedReviewHash !== storedReviewHash) {
      reviewResult.hardFailures.push(
        `Stored review hash "${storedReviewHash}" does not match the hash recomputed from its payload ("${recomputedReviewHash}").`,
      );
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

  const { report, packetArtifactId } = await computeValidationReport(db, runId);
  const profile = await getProfileByKey(db, VALIDATOR_EXECUTOR_KEY);
  const payload = report as unknown as Record<string, unknown>;
  const contentHash = sha256Hex(payload);

  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "test",
    summary: `Deterministic work-cell validation: ${report.gate.hardGatePass ? "hard gate passed" : "hard gate FAILED"}.`,
    payload,
    contentHash,
  });

  await createAssignment(db, actor, run, profile, {
    phase: "validate",
    status: "completed",
    inputArtifactId: packetArtifactId,
    outputArtifactId: String(artifact.id),
    metadata: { hardGatePass: report.gate.hardGatePass, packetHash: report.packetHash, reviewHash: report.reviewHash },
  });

  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", String(artifact.id), {
    runId,
    schemaVersion: WORK_CELL_VALIDATION_SCHEMA_VERSION,
    hardGatePass: report.gate.hardGatePass,
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

  const { data: existing, error: existingError } = await db
    .from("gauntlet_reviews")
    .select("id")
    .eq("run_id", runId)
    .eq("reviewer_ref", WORK_CELL_REVIEWER_REF)
    .maybeSingle();
  if (existingError) throw new DomainError(existingError.message);

  const { report } = await computeValidationReport(db, runId);
  if (existing) return report;

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
  };
}

export async function listExecutorProfiles(actor: Actor) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const { data, error } = await db.from("executor_profiles").select("*").order("key", { ascending: true });
  if (error) throw new DomainError(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapProfile);
}
