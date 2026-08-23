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
import { hashCatalogEvidencePacket, sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  collectClaimIds,
  collectHighSeverityClaimIds,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
  type CatalogEvidencePacketMetrics,
  type CatalogEvidenceReviewMetrics,
  type ValidationResult,
} from "@/lib/catalog-evidence-validator";
import { summarizeWorkCellGate, type WorkCellGate } from "@/lib/work-cell-policy";

export const WORK_CELL_VALIDATION_SCHEMA_VERSION = "catalog-evidence-validation/v1" as const;

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
  const { data: existing, error: readError } = await db
    .from("run_executor_assignments")
    .select("id, status")
    .eq("run_id", run.id)
    .eq("phase", input.phase)
    .maybeSingle();
  if (readError) throw new DomainError(readError.message);
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

export type PacketIngestResult = {
  persisted: boolean;
  validation: ValidationResult<CatalogEvidencePacketMetrics>;
  contentHash: string | null;
  artifactId: string | null;
};

/**
 * Step H(1-5): validate a pasted Hermes packet BEFORE persistence, and persist it
 * only if the deterministic gate accepts it. A rejected packet returns its report
 * and writes nothing: the executor's output is never silently repaired.
 */
export async function ingestCatalogEvidencePacket(
  actor: Actor,
  runId: string,
  input: {
    raw: string;
    executorKey?: string;
    expectedProductIds?: string[];
    humanMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
  },
): Promise<PacketIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Work-cell evidence can only be ingested while the run is in progress.");
  }
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen catalog evidence packet. Ingesting another belongs to a new attempt.");
  }

  const parsed = parseRawExecutorJson(input.raw);
  if (!parsed.ok) {
    return {
      persisted: false,
      contentHash: null,
      artifactId: null,
      validation: {
        hardGatePass: false,
        hardFailures: [parsed.error],
        warnings: [],
        metrics: validateCatalogEvidencePacket(null).metrics,
      },
    };
  }

  const validation = validateCatalogEvidencePacket(parsed.value, { expectedProductIds: input.expectedProductIds });
  if (!validation.hardGatePass) return { persisted: false, contentHash: null, artifactId: null, validation };

  const packet = parsed.value as CatalogEvidencePacketV1;
  const executorKey = input.executorKey?.trim() || packet.executorKey;
  const profile = await getProfileByKey(db, executorKey);
  if (profile.executorKind !== "agent" && profile.executorKind !== "human") {
    throw new DomainError("The prepare phase requires an agent or human executor profile.");
  }
  const contentHash = hashCatalogEvidencePacket(packet);

  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "source",
    summary: `Catalog evidence packet v1 from ${executorKey} covering ${packet.products.length} product(s).`,
    payload: packet as unknown as Record<string, unknown>,
    contentHash,
  });

  await createAssignment(db, actor, run, profile, {
    phase: "prepare",
    status: "completed",
    outputArtifactId: String(artifact.id),
    humanMinutes: input.humanMinutes,
    aiCostMicros: input.aiCostMicros,
    toolCostMicros: input.toolCostMicros,
    metadata: { packetHash: contentHash, productCount: validation.metrics.productCount },
  });

  await audit(db, actor, run.organization_id, "execution.evidence_added", "evidence_artifact", String(artifact.id), {
    runId,
    schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
    executorKey,
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
 * Step H(6-9): a review is accepted only if it references the exact frozen packet
 * hash. The reviewer never edits the packet; the review is a separate immutable
 * artifact bound to the packet by content hash.
 */
export async function ingestCatalogEvidenceReview(
  actor: Actor,
  runId: string,
  input: {
    raw: string;
    executorKey?: string;
    humanMinutes?: number;
    aiCostMicros?: number;
    toolCostMicros?: number;
  },
): Promise<ReviewIngestResult> {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Work-cell evidence can only be ingested while the run is in progress.");
  }

  const packetRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  if (!packetRow) throw new DomainError("Freeze a catalog evidence packet before ingesting an independent review.");
  if (await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION)) {
    throw new DomainError("This run already has a frozen independent review. Ingesting another belongs to a new attempt.");
  }

  const packet = packetRow.payload as CatalogEvidencePacketV1;
  const expectedPacketHash = String(packetRow.content_hash ?? "");
  const context = {
    expectedPacketHash,
    allClaimIds: collectClaimIds(packet),
    highSeverityClaimIds: collectHighSeverityClaimIds(packet),
  };

  const parsed = parseRawExecutorJson(input.raw);
  if (!parsed.ok) {
    return {
      persisted: false,
      contentHash: null,
      artifactId: null,
      expectedPacketHash,
      validation: {
        hardGatePass: false,
        hardFailures: [parsed.error],
        warnings: [],
        metrics: validateCatalogEvidenceReview(null, context).metrics,
      },
    };
  }

  const validation = validateCatalogEvidenceReview(parsed.value, context);
  if (!validation.hardGatePass) {
    return { persisted: false, contentHash: null, artifactId: null, expectedPacketHash, validation };
  }

  const reviewPacket = parsed.value as CatalogEvidenceReviewV1;
  const executorKey = input.executorKey?.trim() || reviewPacket.reviewerExecutorKey;
  const profile = await getProfileByKey(db, executorKey);
  if (profile.executorKind !== "agent" && profile.executorKind !== "human") {
    throw new DomainError("The review phase requires an agent or human executor profile.");
  }
  const contentHash = sha256Hex(reviewPacket);

  const artifact = await insertEvidenceArtifact(db, actor, run, {
    kind: "source",
    summary: `Independent catalog evidence review v1 from ${executorKey} covering ${reviewPacket.claimReviews.length} claim(s).`,
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
    executorKey,
    contentHash,
    reviewedPacketHash: expectedPacketHash,
  });

  return { persisted: true, validation, contentHash, artifactId: String(artifact.id), expectedPacketHash };
}

export type WorkCellValidationReport = {
  schemaVersion: typeof WORK_CELL_VALIDATION_SCHEMA_VERSION;
  packetHash: string;
  reviewHash: string | null;
  packet: ValidationResult<CatalogEvidencePacketMetrics>;
  review: ValidationResult<CatalogEvidenceReviewMetrics> | null;
  gate: WorkCellGate;
};

async function computeValidationReport(
  db: SupabaseClient,
  runId: string,
  expectedProductIds?: string[],
): Promise<{ report: WorkCellValidationReport; packetArtifactId: string }> {
  const packetRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  if (!packetRow) throw new DomainError("This run has no frozen catalog evidence packet to validate.");
  const packet = packetRow.payload as CatalogEvidencePacketV1;
  const storedPacketHash = String(packetRow.content_hash ?? "");
  const packetResult = validateCatalogEvidencePacket(packet, { expectedProductIds });

  // Recomputing the hash from the stored payload proves the artifact still hashes
  // to what the review was bound to. A mismatch means the stored evidence no
  // longer matches its recorded identity, which is a hard failure, not a warning.
  const recomputed = hashCatalogEvidencePacket(packet);
  if (recomputed !== storedPacketHash) {
    packetResult.hardFailures.push(
      `Stored packet hash "${storedPacketHash}" does not match the hash recomputed from its payload ("${recomputed}").`,
    );
    packetResult.hardGatePass = false;
  }

  const reviewRow = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  let reviewResult: ValidationResult<CatalogEvidenceReviewMetrics> | null = null;
  if (reviewRow) {
    reviewResult = validateCatalogEvidenceReview(reviewRow.payload, {
      expectedPacketHash: storedPacketHash,
      allClaimIds: collectClaimIds(packet),
      highSeverityClaimIds: collectHighSeverityClaimIds(packet),
    });
  }

  return {
    packetArtifactId: String(packetRow.id),
    report: {
      schemaVersion: WORK_CELL_VALIDATION_SCHEMA_VERSION,
      packetHash: storedPacketHash,
      reviewHash: reviewRow ? String(reviewRow.content_hash ?? "") : null,
      packet: packetResult,
      review: reviewResult,
      gate: summarizeWorkCellGate(packetResult, reviewResult),
    },
  };
}

/**
 * Runs the deterministic validator over the frozen artifacts and records the
 * result as the validate-phase output. Deterministic by construction: it reads
 * only stored artifacts and calls no model and no network.
 */
export async function runWorkCellValidation(actor: Actor, runId: string, expectedProductIds?: string[]) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (run.status !== "running") {
    throw new DomainError("Deterministic work-cell validation runs while the run is still in progress.");
  }

  const { report, packetArtifactId } = await computeValidationReport(db, runId, expectedProductIds);
  const profile = await getProfileByKey(db, "catalog-evidence-validator-v1");
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
 * Surfaces the work cell into the existing Gauntlet adversarial-review model.
 *
 * The deterministic validator, not the reviewing agent, owns hard_gate_pass. A
 * reviewer that says "accept" on evidence the validator rejects still produces a
 * failing hard gate, so no passing Outcome Receipt can follow from agent
 * confidence alone.
 */
export async function recordWorkCellGauntletReviews(actor: Actor, runId: string, expectedProductIds?: string[]) {
  managerOnly(actor);
  const db = await persistentDb(actor);
  const run = await loadRun(db, actor, runId);
  if (!run.gauntlet_cycle_id) throw new DomainError("This run is not attached to a Gauntlet cycle.");
  if (run.status !== "awaiting_verification") {
    throw new DomainError("Work-cell verdicts are recorded once the run has been submitted for verification.");
  }

  // Re-derived from the stored artifacts rather than read back from the earlier
  // validate-phase report, so a tampered artifact cannot ride a stale pass.
  const { report } = await computeValidationReport(db, runId, expectedProductIds);
  const { gate } = report;

  await addGauntletReview(actor, runId, {
    reviewerKind: "deterministic",
    reviewerRef: "catalog-evidence-validator-v1",
    verdict: gate.deterministicVerdict,
    hardGatePass: gate.hardGatePass,
    challengedAssumptions: [],
    defects: [...report.packet.hardFailures, ...(report.review?.hardFailures ?? [])].map((finding) => ({
      severity: "high",
      finding,
    })),
    evidenceGaps: report.packet.warnings,
    authorityIncidents: gate.authorityIncidents,
    notes: `Deterministic validation over frozen artifact ${report.packetHash}. ${gate.reasons.join(" ")}`,
  });

  const reviewArtifact = await loadTypedArtifact(db, runId, CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  if (reviewArtifact && report.review) {
    const reviewPayload = reviewArtifact.payload as CatalogEvidenceReviewV1;
    await addGauntletReview(actor, runId, {
      reviewerKind: "agent",
      reviewerRef: reviewPayload.reviewerExecutorKey,
      verdict: gate.agentVerdict,
      hardGatePass: gate.hardGatePass,
      challengedAssumptions: reviewPayload.challengedAssumptions,
      defects: reviewPayload.newFindings,
      evidenceGaps: reviewPayload.evidenceGaps,
      authorityIncidents: gate.authorityIncidents,
      notes: `Independent review of frozen packet ${report.packetHash}. The hard gate reflects deterministic validation, not the reviewer's own verdict.`,
    });
  }

  await audit(db, actor, run.organization_id, "execution.evidence_added", "workstream_run", runId, {
    workCellHardGatePass: gate.hardGatePass,
    agentVerdict: gate.agentVerdict,
    authorityIncidents: gate.authorityIncidents.length,
  });

  return report;
}

export type WorkCellBundle = {
  assignments: Array<RunExecutorAssignment & { profile: ExecutorProfile | null }>;
  packet: { id: string; contentHash: string; payload: CatalogEvidencePacketV1 } | null;
  review: { id: string; contentHash: string; payload: CatalogEvidenceReviewV1 } | null;
  validation: WorkCellValidationReport | null;
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

  const packetRow = find(CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  const reviewRow = find(CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION);
  const validationRow = find(WORK_CELL_VALIDATION_SCHEMA_VERSION);

  return {
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
  };
}

export async function listExecutorProfiles(actor: Actor) {
  opsOnly(actor);
  const db = await persistentDb(actor);
  const { data, error } = await db.from("executor_profiles").select("*").order("key", { ascending: true });
  if (error) throw new DomainError(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapProfile);
}
