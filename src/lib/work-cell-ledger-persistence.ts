import { AuthzError, DomainError, type Actor } from "@/lib/domain";
import { getWorkstreamRunBundle } from "@/lib/execution-primitives";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  performanceObservationSchema,
  type CapabilityPerformanceObservation,
} from "@/lib/capability-performance-ledger";
import {
  FROZEN_WORK_CELL_EXECUTOR_KEYS,
} from "@/lib/capability-registry";
import {
  workCellLedgerObservations,
  type WorkCellLedgerPhaseBinding,
} from "@/lib/work-cell-ledger";
import { getRunWorkCell, type ExecutorPhase } from "@/lib/work-cell";
import { supabaseServer } from "@/lib/supabase/server";

const PHASES = ["prepare", "review", "validate"] as const;
type LedgerPhase = (typeof PHASES)[number];

function managerOnly(role: string) {
  if (role !== "ops_manager" && role !== "platform_admin") {
    throw new AuthzError("Only operations managers can record capability performance observations.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function verifiedArtifactHash(row: Record<string, unknown>, label: string): string {
  const contentHash = String(row.content_hash ?? "");
  if (!/^[0-9a-f]{64}$/.test(contentHash)) {
    throw new DomainError(`The ${label} artifact does not carry a valid SHA-256 content hash.`);
  }
  if (sha256Hex(row.payload) !== contentHash) {
    throw new DomainError(`The stored ${label} artifact no longer matches its recorded content hash.`);
  }
  return contentHash;
}

function phaseArtifactId(phase: LedgerPhase, packetId: string, reviewId: string, validationId: string) {
  if (phase === "prepare") return packetId;
  if (phase === "review") return reviewId;
  return validationId;
}

function expectedExecutorKey(phase: LedgerPhase, prepareKey: string, reviewKey: string) {
  if (phase === "prepare") return prepareKey;
  if (phase === "review") return reviewKey;
  return FROZEN_WORK_CELL_EXECUTOR_KEYS.validate;
}

function measuredLatencyMs(phase: LedgerPhase, startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) {
    throw new DomainError(`The ${phase} assignment is missing timestamps; latency cannot be inferred.`);
  }
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    throw new DomainError(`The ${phase} assignment has invalid execution timestamps.`);
  }
  return completed - started;
}

export type PersistedWorkCellLedgerResult = {
  persisted: boolean;
  artifactIds: string[];
  observations: CapabilityPerformanceObservation[];
};

/**
 * Reconstructs CS-4 observations from immutable, already-validated work-cell
 * artifacts and real phase assignments. It never accepts executor-supplied
 * aggregate scores, never promotes an implementation, and never routes work.
 *
 * Observations are written while the run is still running because the existing
 * evidence invariant intentionally freezes all evidence before submission. The
 * caller must record the deterministic validation first; a later receipt may
 * then pass or fail the attempt without changing these observations.
 */
export async function recordWorkCellPerformanceObservations(
  actor: Actor,
  runId: string,
): Promise<PersistedWorkCellLedgerResult> {
  managerOnly(actor.role);
  if (actor.source === "demo") {
    throw new DomainError("Capability performance observations require the persistent Supabase workspace.");
  }

  const bundle = await getWorkstreamRunBundle(actor, runId);
  if (bundle.run.status !== "running") {
    throw new DomainError("Capability performance observations must be recorded before the work-cell run is submitted.");
  }

  const db = await supabaseServer();
  if (!db) throw new DomainError("Capability performance observations require Supabase.");

  const existingResult = await db
    .from("evidence_artifacts")
    .select("id, content_hash, payload")
    .eq("run_id", runId)
    .eq("payload->>schemaVersion", "capability-performance-ledger/v1");
  if (existingResult.error) throw new DomainError(existingResult.error.message);
  const existingRows = (existingResult.data ?? []) as Array<Record<string, unknown>>;
  if (existingRows.length > 0) {
    if (existingRows.length !== PHASES.length) {
      throw new DomainError(
        "This run has a partial capability-performance ledger. It is immutable and requires a new work-cell attempt rather than repair.",
      );
    }
    const existingObservations = existingRows.map((row, index) => {
      const parsed = performanceObservationSchema.safeParse(row.payload);
      if (!parsed.success || verifiedArtifactHash(row, `performance observation ${index + 1}`) !== sha256Hex(parsed.data)) {
        throw new DomainError("An existing capability-performance observation is invalid or tampered.");
      }
      return parsed.data;
    });
    return {
      persisted: false,
      artifactIds: existingRows.map((row) => String(row.id)),
      observations: existingObservations,
    };
  }

  const workCell = await getRunWorkCell(actor, runId);
  const manifest = workCell.manifest;
  const packet = workCell.packet;
  const review = workCell.review;
  if (!manifest || !packet || !review) {
    throw new DomainError("Freeze the manifest and complete prepare plus independent review before recording the performance ledger.");
  }
  if (
    manifest.prepareExecutorKey !== FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare
    || manifest.reviewExecutorKey !== FROZEN_WORK_CELL_EXECUTOR_KEYS.review
  ) {
    throw new DomainError(
      "The persisted CS-4 adapter only covers the currently frozen Hermes/Grok work-cell executor keys.",
    );
  }

  const validationResult = await db
    .from("evidence_artifacts")
    .select("id, content_hash, payload, created_at")
    .eq("run_id", runId)
    .eq("payload->>schemaVersion", "catalog-evidence-validation/v1")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (validationResult.error) throw new DomainError(validationResult.error.message);
  if (!validationResult.data) {
    throw new DomainError("Run deterministic work-cell validation before recording the performance ledger.");
  }

  const packetHash = verifiedArtifactHash(
    { payload: packet.payload, content_hash: packet.contentHash },
    "packet",
  );
  const reviewHash = verifiedArtifactHash(
    { payload: review.payload, content_hash: review.contentHash },
    "review",
  );
  const validationRow = validationResult.data as Record<string, unknown>;
  const validationHash = verifiedArtifactHash(validationRow, "validation");
  const validationPayload = asRecord(validationRow.payload);
  const validationGate = asRecord(validationPayload.gate);

  const assignments = new Map(
    workCell.assignments.map((assignment) => [assignment.phase, assignment]),
  );
  const phaseBindings: Partial<Record<LedgerPhase, WorkCellLedgerPhaseBinding>> = {};

  for (const phase of PHASES) {
    const assignment = assignments.get(phase as ExecutorPhase);
    if (!assignment || assignment.status !== "completed" || !assignment.outputArtifactId) {
      throw new DomainError(`The ${phase} phase must have one completed assignment with output evidence.`);
    }

    const artifactId = phaseArtifactId(phase, packet.id, review.id, String(validationRow.id));
    if (assignment.outputArtifactId !== artifactId) {
      throw new DomainError(`The ${phase} assignment is not bound to its stored output artifact.`);
    }
    if (phase === "review" && assignment.inputArtifactId !== packet.id) {
      throw new DomainError("The review assignment is not bound to the stored prepare packet.");
    }

    const executorKey = assignment.profile?.key;
    const frozenExecutorKey = expectedExecutorKey(
      phase,
      manifest.prepareExecutorKey,
      manifest.reviewExecutorKey,
    );
    if (!executorKey || executorKey !== frozenExecutorKey) {
      throw new DomainError(`The ${phase} assignment executor does not match the frozen work-cell manifest.`);
    }

    phaseBindings[phase] = {
      assignmentId: assignment.id,
      executorKey,
      sourceArtifactHash: phase === "prepare" ? packetHash : phase === "review" ? reviewHash : validationHash,
      humanInterventionMinutes: assignment.humanMinutes,
      aiCostMicros: assignment.aiCostMicros,
      toolCostMicros: assignment.toolCostMicros,
      latencyMs: measuredLatencyMs(phase, assignment.startedAt, assignment.completedAt),
    };
  }

  const observations = workCellLedgerObservations({
    packet: packet.payload,
    review: review.payload,
    expectedProductIds: manifest.expectedProductIds,
    recordedAt: String(validationRow.created_at),
    phaseBindings,
  });

  const expectedHardGatePass = validationGate.hardGatePass === true;
  const expectedVerdict = observations[0]?.status === "completed"
    ? "passed"
    : observations[0]?.status === "failed"
      ? "failed"
      : "inconclusive";
  if (
    validationPayload.packetHash !== packetHash
    || validationPayload.reviewHash !== reviewHash
    || validationGate.hardGatePass !== expectedHardGatePass
    || validationGate.workCellVerdict !== expectedVerdict
  ) {
    throw new DomainError(
      "The stored deterministic validation does not match the packet, review, or recomputed work-cell gate.",
    );
  }

  const validatedObservations = observations.map((observation, index) => {
    const parsed = performanceObservationSchema.safeParse(observation);
    if (!parsed.success) {
      throw new DomainError(
        `The ${PHASES[index]} performance observation is invalid: ${parsed.error.issues
          .map((issue) => issue.path.join(".") + " " + issue.message)
          .join("; ")}`,
      );
    }
    return parsed.data;
  });

  const entries = validatedObservations.map((observation, index) => ({
    phase: PHASES[index],
    observation,
    contentHash: sha256Hex(observation),
  }));

  const { data, error } = await db.rpc("record_work_cell_ledger_observations", {
    p_run_id: runId,
    p_observations: entries,
  });
  if (error) throw new DomainError(error.message);

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{ artifact_id: string }>;
  if (rows.length !== PHASES.length || rows.some((row) => !row.artifact_id)) {
    throw new DomainError("The ledger persistence RPC did not return all three observation artifacts.");
  }

  const audit = await db.from("audit_events").insert({
    organization_id: bundle.run.organizationId,
    actor_id: actor.id,
    action: "execution.performance_observations_recorded",
    entity_type: "workstream_run",
    entity_id: runId,
    metadata: {
      schemaVersion: "capability-performance-ledger/v1",
      observationCount: validatedObservations.length,
      sourceArtifactHashes: validatedObservations.map((observation) => observation.sourceArtifactHash),
    },
  });
  if (audit.error) throw new DomainError(audit.error.message);

  return {
    persisted: true,
    artifactIds: rows.map((row) => row.artifact_id),
    observations: validatedObservations,
  };
}
