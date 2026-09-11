import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { DomainError } from "@/lib/domain";

/**
 * Distinct typed schema for append-only economics events.
 * Do not silently change outcome-economics-evidence/v1 snapshots.
 */
export const OUTCOME_ECONOMICS_EVENT_SCHEMA_VERSION = "outcome-economics-event/v1" as const;

export const OUTCOME_ECONOMICS_EVENT_TYPES = [
  "reserved",
  "invocation_started",
  "committed",
  "released",
  "expired",
  "owner_action_required",
] as const;

export type OutcomeEconomicsEventType = (typeof OUTCOME_ECONOMICS_EVENT_TYPES)[number];

/**
 * Lifecycle-terminal events. These stop further appends for a reservation.
 * They are NOT the remaining/budget formula. `owner_action_required` is
 * lifecycle-terminal and financially unresolved: it continues to hold budget.
 */
export const OUTCOME_ECONOMICS_TERMINAL_EVENT_TYPES = [
  "committed",
  "released",
  "expired",
  "owner_action_required",
] as const;

/** Explicit financial release is allowed only when invocation never started. */
export const OUTCOME_ECONOMICS_FINANCIALLY_RELEASING_EVENT_TYPES = ["released", "expired"] as const;

/** Financially resolved for remaining AND for assignment completion eligibility. */
export const OUTCOME_ECONOMICS_FINANCIALLY_RESOLVED_EVENT_TYPES = [
  "committed",
  "released",
  "expired",
] as const;

export const OUTCOME_ECONOMICS_FINALIZER_FORBIDDEN_METADATA_KEYS = [
  "assignmentId",
  "organizationId",
  "runId",
  "phase",
  "executorKey",
  "capabilityKey",
  "actionClass",
  "authoritySnapshot",
  "inputManifestContentHash",
  "envelopeHash",
  "contextHash",
  "canonicalPlanHash",
  "outputArtifactId",
  "economicReservationIds",
  "economicReservationId",
  "economicsFinalized",
  "workerId",
  "leaseToken",
  "leaseTokenHash",
  "tokenHash",
  "status",
] as const;

const FINALIZER_FORBIDDEN_METADATA_KEY_SET = new Set(
  [
    ...OUTCOME_ECONOMICS_FINALIZER_FORBIDDEN_METADATA_KEYS,
    "assignment_id",
    "organization_id",
    "run_id",
    "executor_key",
    "capability_key",
    "action_class",
    "authority_snapshot",
    "input_manifest_content_hash",
    "envelope_hash",
    "context_hash",
    "canonical_plan_hash",
    "output_artifact_id",
    "economic_reservation_ids",
    "economic_reservation_id",
    "economics_finalized",
    "worker_id",
    "lease_token",
    "lease_token_hash",
    "token_hash",
  ].map((key) => key.toLowerCase()),
);

export type OutcomeEconomicsOwnerKind = "native_assignment" | "leased_attempt";

export const RESERVE_OUTCOME_ECONOMICS_EVENT_RPC = "reserve_outcome_economics_event" as const;
export const START_OUTCOME_ECONOMICS_INVOCATION_RPC = "start_outcome_economics_invocation" as const;
export const RELEASE_OUTCOME_ECONOMICS_EVENT_RPC = "release_outcome_economics_event" as const;
export const FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC = "finalize_work_cell_phase_economics" as const;

const HEX64 = /^[0-9a-f]{64}$/;
const FORBIDDEN_EVENT_KEYS = new Set([
  "prompt",
  "completion",
  "content",
  "payload",
  "body",
  "message",
  "raw",
  "chainofthought",
  "chain_of_thought",
  "reasoning",
  "credential",
  "credentials",
  "secret",
  "secrets",
  "token",
  "password",
  "apikey",
  "api_key",
  "leasetoken",
  "leasetokenhash",
  "tokenhash",
]);

const MAX_SAFE_MICROS = 9_007_199_254_740_991;

export type OutcomeEconomicsEventPayload = {
  schemaVersion: typeof OUTCOME_ECONOMICS_EVENT_SCHEMA_VERSION;
  eventType: OutcomeEconomicsEventType;
  organizationId: string;
  runId: string;
  reservationId: string;
  idempotencyKey: string;
  ownerKind: OutcomeEconomicsOwnerKind;
  nativeAssignmentId: string | null;
  leasedAttemptId: string | null;
  eventAt: string;
  expiresAt: string | null;
  aiCostMicros: number;
  toolCostMicros: number;
  executorKey: string | null;
  capabilityKey: string | null;
  inputManifestContentHash: string | null;
  envelopeHash: string | null;
  contextHash: string | null;
  planHash: string | null;
  outputArtifactId: string | null;
  packetContentHash: string | null;
  contentHash: string;
};

export type DurableNativeEconomicsIdentity = {
  runId: string;
  phase: "prepare" | "review" | "validate";
  assignmentId: string;
  executorKey: string;
  capabilityKey: string;
  inputManifestContentHash: string;
  envelopeHash: string;
  contextHash: string;
};

export type DurableReserveInput = DurableNativeEconomicsIdentity & {
  reservationId: string;
  idempotencyKey: string;
  aiCostMicros: number;
  toolCostMicros: number;
  expiresAt: string;
  planHash?: string | null;
};

export type DurableReservationRef = DurableNativeEconomicsIdentity & {
  reservationId: string;
  idempotencyKey: string;
};

export type DurableFinalizeInput = DurableNativeEconomicsIdentity & {
  outputArtifactId: string;
  packetContentHash: string;
  reservationIds: readonly string[];
  metadataPatch?: Record<string, unknown>;
};

export type DurableEconomicsWriter = {
  reserve(input: DurableReserveInput): Promise<{ artifactId: string }>;
  invocationStarted(input: DurableReservationRef): Promise<{ artifactId: string }>;
  release(input: DurableReservationRef & { ownerAction?: boolean }): Promise<{ artifactId: string }>;
  finalize(input: DurableFinalizeInput): Promise<{ assignmentId: string; assignmentStatus: string }>;
};

export function isOutcomeEconomicsEventType(value: string): value is OutcomeEconomicsEventType {
  return (OUTCOME_ECONOMICS_EVENT_TYPES as readonly string[]).includes(value);
}

export function isTerminalOutcomeEconomicsEventType(value: string): boolean {
  return (OUTCOME_ECONOMICS_TERMINAL_EVENT_TYPES as readonly string[]).includes(value);
}

export function isFinanciallyReleasingOutcomeEconomicsEventType(value: string): boolean {
  return (OUTCOME_ECONOMICS_FINANCIALLY_RELEASING_EVENT_TYPES as readonly string[]).includes(value);
}

export function isFinanciallyResolvedOutcomeEconomicsEventType(value: string): boolean {
  return (OUTCOME_ECONOMICS_FINANCIALLY_RESOLVED_EVENT_TYPES as readonly string[]).includes(value);
}

export function assertOutcomeEconomicsFinalizerMetadataPatch(patch: Record<string, unknown> | undefined): void {
  if (patch == null) return;
  for (const key of Object.keys(patch)) {
    if (FINALIZER_FORBIDDEN_METADATA_KEY_SET.has(key.toLowerCase())) {
      throw new DomainError(
        "Work-cell economics finalization must not rewrite binding, authority, identity, lease, or economic metadata",
      );
    }
  }
}

export type ReservationBudgetHoldKind =
  | "committed"
  | "unexpired_unstarted"
  | "unresolved_started_or_owner_action"
  | "financially_released";

export function classifyOutcomeEconomicsReservationHold(
  events: readonly OutcomeEconomicsEventPayload[],
  reservationId: string,
  nowMs: number,
): ReservationBudgetHoldKind {
  const forReservation = events.filter((event) => event.reservationId === reservationId);
  const types = new Set(forReservation.map((event) => event.eventType));
  if (types.has("committed")) return "committed";
  if (types.has("owner_action_required") || types.has("invocation_started")) {
    return "unresolved_started_or_owner_action";
  }
  if (types.has("released") || types.has("expired")) return "financially_released";
  const reserved = forReservation.find((event) => event.eventType === "reserved");
  if (!reserved) return "financially_released";
  if (!reserved.expiresAt || Date.parse(reserved.expiresAt) <= nowMs) return "financially_released";
  return "unexpired_unstarted";
}

export function reservationIsCompletionEligible(
  events: readonly OutcomeEconomicsEventPayload[],
  reservationId: string,
): boolean {
  const forReservation = events.filter((event) => event.reservationId === reservationId);
  const types = new Set(forReservation.map((event) => event.eventType));
  if (types.has("owner_action_required")) return false;
  if (types.has("committed")) return true;
  if (types.has("invocation_started")) return false;
  if (types.has("released") || types.has("expired")) return true;
  return false;
}

export function assertSafeMicros(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_SAFE_MICROS) {
    throw new DomainError(`${label} must be a safe non-negative integer`);
  }
  return value;
}

function assertHex64(value: string, label: string): string {
  if (!HEX64.test(value)) {
    throw new DomainError(`${label} must be a sha256 hex digest`);
  }
  return value;
}

function hasForbiddenKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKeys);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_EVENT_KEYS.has(key.toLowerCase())) return true;
    if (hasForbiddenKeys(child)) return true;
  }
  return false;
}

export function outcomeEconomicsEventHasForbiddenKeys(value: unknown): boolean {
  return hasForbiddenKeys(value);
}

export function buildOutcomeEconomicsEventPayload(
  input: Omit<OutcomeEconomicsEventPayload, "schemaVersion" | "contentHash">,
): OutcomeEconomicsEventPayload {
  const aiCostMicros = assertSafeMicros(input.aiCostMicros, "aiCostMicros");
  const toolCostMicros = assertSafeMicros(input.toolCostMicros, "toolCostMicros");
  if (!isOutcomeEconomicsEventType(input.eventType)) {
    throw new DomainError("Unsupported outcome-economics-event/v1 eventType");
  }
  assertHex64(input.reservationId, "reservationId");
  assertHex64(input.idempotencyKey, "idempotencyKey");
  if (input.ownerKind === "native_assignment") {
    if (!input.nativeAssignmentId || input.leasedAttemptId != null) {
      throw new DomainError("Native economics events require nativeAssignmentId and a null leased attempt");
    }
  } else {
    throw new DomainError("Leased economics events are out of scope for this seam");
  }
  const payloadWithoutHash = {
    schemaVersion: OUTCOME_ECONOMICS_EVENT_SCHEMA_VERSION,
    eventType: input.eventType,
    organizationId: input.organizationId,
    runId: input.runId,
    reservationId: input.reservationId,
    idempotencyKey: input.idempotencyKey,
    ownerKind: input.ownerKind,
    nativeAssignmentId: input.nativeAssignmentId,
    leasedAttemptId: input.leasedAttemptId,
    eventAt: input.eventAt,
    expiresAt: input.expiresAt,
    aiCostMicros,
    toolCostMicros,
    executorKey: input.executorKey,
    capabilityKey: input.capabilityKey,
    inputManifestContentHash: input.inputManifestContentHash,
    envelopeHash: input.envelopeHash,
    contextHash: input.contextHash,
    planHash: input.planHash,
    outputArtifactId: input.outputArtifactId,
    packetContentHash: input.packetContentHash,
  };
  if (hasForbiddenKeys(payloadWithoutHash)) {
    throw new DomainError(
      "outcome-economics-event/v1 must not store prompts, completions, secrets, or raw provider content",
    );
  }
  return {
    ...payloadWithoutHash,
    contentHash: sha256Hex(payloadWithoutHash),
  };
}

export type ComputedEconomicsRemaining = {
  remainingAiCostMicros: number | null;
  remainingToolCostMicros: number | null;
  committedAiCostMicros: number;
  committedToolCostMicros: number;
  openReservedAiCostMicros: number;
  openReservedToolCostMicros: number;
  unexpiredUnstartedAiCostMicros: number;
  unexpiredUnstartedToolCostMicros: number;
  unresolvedStartedOrOwnerActionAiCostMicros: number;
  unresolvedStartedOrOwnerActionToolCostMicros: number;
  ceilingAiCostMicros: number | null;
  ceilingToolCostMicros: number | null;
};

function envelopeCeiling(envelope: unknown, camel: string, snake: string): number | null {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
  const record = envelope as Record<string, unknown>;
  const values: number[] = [];
  for (const key of [camel, snake]) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_SAFE_MICROS) {
      throw new DomainError(`Economic envelope ceiling ${key} is not a safe integer`);
    }
    values.push(value);
  }
  if (values.length === 2 && values[0] !== values[1]) {
    throw new DomainError("Economic envelope camel and snake ceilings conflict");
  }
  return values[0] ?? null;
}

export function computeOutcomeEconomicsRemaining(input: {
  envelope: unknown;
  events: readonly OutcomeEconomicsEventPayload[];
  nowMs: number;
}): ComputedEconomicsRemaining {
  const committed = input.events.filter((event) => event.eventType === "committed");
  const reserved = input.events.filter((event) => event.eventType === "reserved");
  let committedAi = 0;
  let committedTool = 0;
  for (const event of committed) {
    committedAi += event.aiCostMicros;
    committedTool += event.toolCostMicros;
  }
  let unexpiredUnstartedAi = 0;
  let unexpiredUnstartedTool = 0;
  let unresolvedStartedOrOwnerActionAi = 0;
  let unresolvedStartedOrOwnerActionTool = 0;
  for (const event of reserved) {
    const hold = classifyOutcomeEconomicsReservationHold(input.events, event.reservationId, input.nowMs);
    if (hold === "unexpired_unstarted") {
      unexpiredUnstartedAi += event.aiCostMicros;
      unexpiredUnstartedTool += event.toolCostMicros;
    } else if (hold === "unresolved_started_or_owner_action") {
      unresolvedStartedOrOwnerActionAi += event.aiCostMicros;
      unresolvedStartedOrOwnerActionTool += event.toolCostMicros;
    }
  }
  const openAi = unexpiredUnstartedAi + unresolvedStartedOrOwnerActionAi;
  const openTool = unexpiredUnstartedTool + unresolvedStartedOrOwnerActionTool;
  const ceilingAi = envelopeCeiling(input.envelope, "maxAiCostMicros", "max_ai_cost_micros");
  const ceilingTool = envelopeCeiling(input.envelope, "maxToolCostMicros", "max_tool_cost_micros");
  return {
    remainingAiCostMicros: ceilingAi == null ? null : ceilingAi - committedAi - openAi,
    remainingToolCostMicros: ceilingTool == null ? null : ceilingTool - committedTool - openTool,
    committedAiCostMicros: committedAi,
    committedToolCostMicros: committedTool,
    openReservedAiCostMicros: openAi,
    openReservedToolCostMicros: openTool,
    unexpiredUnstartedAiCostMicros: unexpiredUnstartedAi,
    unexpiredUnstartedToolCostMicros: unexpiredUnstartedTool,
    unresolvedStartedOrOwnerActionAiCostMicros: unresolvedStartedOrOwnerActionAi,
    unresolvedStartedOrOwnerActionToolCostMicros: unresolvedStartedOrOwnerActionTool,
    ceilingAiCostMicros: ceilingAi,
    ceilingToolCostMicros: ceilingTool,
  };
}

type MemoryAssignment = DurableNativeEconomicsIdentity & {
  status: "running" | "completed" | "failed";
  outputArtifactId: string | null;
  packetContentHash: string | null;
  packetExecutorKey: string | null;
  packetRunId: string | null;
};

type MemoryRun = {
  id: string;
  organizationId: string;
  status: "running" | "planned" | "failed" | "cancelled" | "awaiting_verification" | "verified";
  envelope: unknown;
  assignment: MemoryAssignment | null;
};

export type MemoryDurableEconomicsStore = DurableEconomicsWriter & {
  events: OutcomeEconomicsEventPayload[];
  remaining(runId: string, nowMs?: number): ComputedEconomicsRemaining;
  assignmentStatus(): "running" | "completed" | "failed";
  setPacket(input: {
    runId: string;
    outputArtifactId: string;
    packetContentHash: string;
    executorKey: string;
  }): void;
  completeAssignment(runId: string): void;
};

function eventKey(runId: string, reservationId: string, eventType: string): string {
  return `${runId}::${reservationId}::${eventType}`;
}

function idempotencyKey(runId: string, idempotency: string, eventType: string): string {
  return `${runId}::${idempotency}::${eventType}`;
}

/**
 * In-process stand-in for the durable RPC lock. Serializes per runId to model
 * workstream_runs FOR UPDATE. SQL two-session behavior is documented in the
 * QA proof file and is SQL_VERIFICATION_NOT_AVAILABLE.
 */
export function createMemoryDurableEconomicsStore(input: {
  organizationId: string;
  runId: string;
  envelope: unknown;
  assignment: DurableNativeEconomicsIdentity;
}): MemoryDurableEconomicsStore {
  const run: MemoryRun = {
    id: input.runId,
    organizationId: input.organizationId,
    status: "running",
    envelope: input.envelope,
    assignment: { ...input.assignment, status: "running", outputArtifactId: null, packetContentHash: null, packetExecutorKey: null, packetRunId: null },
  };
  const events: OutcomeEconomicsEventPayload[] = [];
  const byReservationType = new Map<string, OutcomeEconomicsEventPayload>();
  const byIdempotencyType = new Map<string, OutcomeEconomicsEventPayload>();
  let chain = Promise.resolve();

  function withRunLock<T>(fn: () => T): Promise<T> {
    const runFn = async () => fn();
    const next = chain.then(runFn, runFn);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function requireAssignment(identity: DurableNativeEconomicsIdentity): MemoryAssignment {
    if (!run.assignment) throw new DomainError("Native work-cell assignment was not found for economics locking");
    if (run.assignment.assignmentId !== identity.assignmentId) {
      throw new DomainError("Work-cell phase claim identity does not match the economics request");
    }
    if (run.status !== "running") {
      throw new DomainError(
        "OWNER_ACTION_REQUIRED: economics events cannot be appended after the Workstream Run leaves running. Unresolved economics are preserved.",
      );
    }
    return run.assignment;
  }

  function existingEvent(runId: string, reservationId: string, eventType: string, idempotency: string) {
    return (
      byReservationType.get(eventKey(runId, reservationId, eventType)) ??
      byIdempotencyType.get(idempotencyKey(runId, idempotency, eventType))
    );
  }

  function append(payloadInput: Omit<OutcomeEconomicsEventPayload, "schemaVersion" | "contentHash">): OutcomeEconomicsEventPayload {
    const existing = existingEvent(
      payloadInput.runId,
      payloadInput.reservationId,
      payloadInput.eventType,
      payloadInput.idempotencyKey,
    );
    if (existing) {
      if (
        existing.reservationId !== payloadInput.reservationId ||
        existing.idempotencyKey !== payloadInput.idempotencyKey ||
        existing.eventType !== payloadInput.eventType ||
        existing.nativeAssignmentId !== payloadInput.nativeAssignmentId
      ) {
        throw new DomainError("Economics event idempotency conflict");
      }
      if (
        payloadInput.eventType === "reserved" &&
        (existing.aiCostMicros !== payloadInput.aiCostMicros || existing.toolCostMicros !== payloadInput.toolCostMicros)
      ) {
        throw new DomainError("Economics event idempotency conflict");
      }
      return existing;
    }
    const reserved = events.find(
      (event) => event.reservationId === payloadInput.reservationId && event.eventType === "reserved",
    );
    if (payloadInput.eventType !== "reserved" && !reserved) {
      throw new DomainError(`Economics ${payloadInput.eventType} requires a reserved event for this reservation`);
    }
    const terminal = events.find(
      (event) =>
        event.reservationId === payloadInput.reservationId && isTerminalOutcomeEconomicsEventType(event.eventType),
    );
    const started = events.some(
      (event) => event.reservationId === payloadInput.reservationId && event.eventType === "invocation_started",
    );
    if (payloadInput.eventType === "committed" && terminal && terminal.eventType !== "committed") {
      throw new DomainError(`A reservation that is ${terminal.eventType} cannot be committed`);
    }
    if (payloadInput.eventType === "released") {
      if (terminal?.eventType === "committed") throw new DomainError("A committed reservation cannot be released");
      if (started) {
        throw new DomainError("invocation_started cannot be silently released; owner_action_required is required");
      }
    }
    if (payloadInput.eventType === "expired") {
      if (terminal?.eventType === "committed") throw new DomainError("A committed reservation cannot expire");
      if (started) {
        throw new DomainError(
          "A reservation that reached invocation_started cannot expire; budget remains held until committed or an explicit owner-resolution event exists",
        );
      }
      if (terminal?.eventType === "owner_action_required") {
        throw new DomainError(
          "An owner_action_required reservation cannot expire; budget remains held until an explicit owner-resolution event exists",
        );
      }
    }
    if (payloadInput.eventType === "committed" && reserved) {
      const expiresAt = reserved.expiresAt ? Date.parse(reserved.expiresAt) : NaN;
      if (Number.isFinite(expiresAt) && expiresAt <= Date.parse(payloadInput.eventAt)) {
        throw new DomainError("An expired reservation cannot be committed");
      }
    }
    if (payloadInput.eventType === "reserved") {
      const remaining = computeOutcomeEconomicsRemaining({
        envelope: run.envelope,
        events,
        nowMs: Date.parse(payloadInput.eventAt),
      });
      if (remaining.remainingAiCostMicros != null && remaining.remainingAiCostMicros - payloadInput.aiCostMicros < 0) {
        throw new DomainError("Economics reservation would exceed the AI cost ceiling");
      }
      if (remaining.remainingToolCostMicros != null && remaining.remainingToolCostMicros - payloadInput.toolCostMicros < 0) {
        throw new DomainError("Economics reservation would exceed the tool cost ceiling");
      }
    }
    const payload = buildOutcomeEconomicsEventPayload(payloadInput);
    events.push(payload);
    byReservationType.set(eventKey(payload.runId, payload.reservationId, payload.eventType), payload);
    byIdempotencyType.set(idempotencyKey(payload.runId, payload.idempotencyKey, payload.eventType), payload);
    return payload;
  }

  const writer: MemoryDurableEconomicsStore = {
    events,
    remaining(runId, nowMs = Date.now()) {
      if (runId !== run.id) throw new DomainError("Workstream run was not found");
      return computeOutcomeEconomicsRemaining({ envelope: run.envelope, events, nowMs });
    },
    assignmentStatus() {
      return run.assignment?.status ?? "failed";
    },
    setPacket(packet) {
      if (!run.assignment) return;
      run.assignment.outputArtifactId = packet.outputArtifactId;
      run.assignment.packetContentHash = packet.packetContentHash;
      run.assignment.packetExecutorKey = packet.executorKey;
      run.assignment.packetRunId = packet.runId;
    },
    completeAssignment(runId) {
      if (run.id !== runId || !run.assignment) return;
      run.assignment.status = "completed";
    },
    async reserve(reserveInput) {
      return withRunLock(() => {
        const assignment = requireAssignment(reserveInput);
        const payload = append({
          eventType: "reserved",
          organizationId: run.organizationId,
          runId: reserveInput.runId,
          reservationId: reserveInput.reservationId,
          idempotencyKey: reserveInput.idempotencyKey,
          ownerKind: "native_assignment",
          nativeAssignmentId: assignment.assignmentId,
          leasedAttemptId: null,
          eventAt: new Date().toISOString(),
          expiresAt: reserveInput.expiresAt,
          aiCostMicros: reserveInput.aiCostMicros,
          toolCostMicros: reserveInput.toolCostMicros,
          executorKey: reserveInput.executorKey,
          capabilityKey: reserveInput.capabilityKey,
          inputManifestContentHash: reserveInput.inputManifestContentHash,
          envelopeHash: reserveInput.envelopeHash,
          contextHash: reserveInput.contextHash,
          planHash: reserveInput.planHash ?? null,
          outputArtifactId: null,
          packetContentHash: null,
        });
        return { artifactId: payload.contentHash };
      });
    },
    async invocationStarted(ref) {
      return withRunLock(() => {
        requireAssignment(ref);
        const payload = append({
          eventType: "invocation_started",
          organizationId: run.organizationId,
          runId: ref.runId,
          reservationId: ref.reservationId,
          idempotencyKey: ref.idempotencyKey,
          ownerKind: "native_assignment",
          nativeAssignmentId: ref.assignmentId,
          leasedAttemptId: null,
          eventAt: new Date().toISOString(),
          expiresAt: null,
          aiCostMicros: 0,
          toolCostMicros: 0,
          executorKey: ref.executorKey,
          capabilityKey: ref.capabilityKey,
          inputManifestContentHash: ref.inputManifestContentHash,
          envelopeHash: ref.envelopeHash,
          contextHash: ref.contextHash,
          planHash: null,
          outputArtifactId: null,
          packetContentHash: null,
        });
        return { artifactId: payload.contentHash };
      });
    },
    async release(ref) {
      return withRunLock(() => {
        requireAssignment(ref);
        const started = events.some(
          (event) => event.reservationId === ref.reservationId && event.eventType === "invocation_started",
        );
        if (started && ref.ownerAction !== true) {
          throw new DomainError("invocation_started cannot be silently released; owner_action_required is required");
        }
        const payload = append({
          eventType: started ? "owner_action_required" : "released",
          organizationId: run.organizationId,
          runId: ref.runId,
          reservationId: ref.reservationId,
          idempotencyKey: ref.idempotencyKey,
          ownerKind: "native_assignment",
          nativeAssignmentId: ref.assignmentId,
          leasedAttemptId: null,
          eventAt: new Date().toISOString(),
          expiresAt: null,
          aiCostMicros: 0,
          toolCostMicros: 0,
          executorKey: ref.executorKey,
          capabilityKey: ref.capabilityKey,
          inputManifestContentHash: ref.inputManifestContentHash,
          envelopeHash: ref.envelopeHash,
          contextHash: ref.contextHash,
          planHash: null,
          outputArtifactId: null,
          packetContentHash: null,
        });
        return { artifactId: payload.contentHash };
      });
    },
    async finalize(finalizeInput) {
      return withRunLock(() => {
        const assignment = requireAssignment(finalizeInput);
        if (assignment.status === "completed") {
          return { assignmentId: assignment.assignmentId, assignmentStatus: assignment.status };
        }
        if (assignment.status === "failed") {
          throw new DomainError("A failed work-cell phase assignment cannot be completed.");
        }
        const snapshot = events.map((event) => event);
        const priorStatus = assignment.status;
        try {
          assertOutcomeEconomicsFinalizerMetadataPatch(finalizeInput.metadataPatch);
          if (
            !assignment.outputArtifactId ||
            assignment.outputArtifactId !== finalizeInput.outputArtifactId ||
            assignment.packetContentHash !== finalizeInput.packetContentHash ||
            assignment.packetExecutorKey !== finalizeInput.executorKey ||
            assignment.packetRunId !== finalizeInput.runId
          ) {
            throw new DomainError(
              "An unbound or unrelated catalog evidence packet cannot complete this work-cell phase claim",
            );
          }
          const suppliedIds = [...finalizeInput.reservationIds];
          if (suppliedIds.length === 0) {
            throw new DomainError(
              "Economics finalization requires the exact durable reservation set; an empty reservation list cannot complete a native assignment",
            );
          }
          if (new Set(suppliedIds).size !== suppliedIds.length) {
            throw new DomainError("Economics finalization reservation IDs must not contain duplicates");
          }
          const durableReserved = events.filter(
            (event) =>
              event.eventType === "reserved" && event.nativeAssignmentId === finalizeInput.assignmentId,
          );
          const durableIds = durableReserved.map((event) => event.reservationId);
          const durableSet = new Set(durableIds);
          const suppliedSet = new Set(suppliedIds);
          for (const reservationId of suppliedIds) {
            if (!durableSet.has(reservationId)) {
              throw new DomainError(
                "Economics finalization reservation does not belong to this native assignment or is not in the durable reservation set",
              );
            }
          }
          for (const reservationId of durableIds) {
            if (!suppliedSet.has(reservationId)) {
              throw new DomainError(
                "Economics finalization omitted a durable reservation; the exact reservation set is required",
              );
            }
          }
          for (const reserved of durableReserved) {
            if (
              reserved.nativeAssignmentId !== finalizeInput.assignmentId ||
              reserved.organizationId !== run.organizationId ||
              reserved.runId !== finalizeInput.runId ||
              reserved.executorKey !== finalizeInput.executorKey ||
              reserved.capabilityKey !== finalizeInput.capabilityKey ||
              reserved.inputManifestContentHash !== finalizeInput.inputManifestContentHash ||
              reserved.envelopeHash !== finalizeInput.envelopeHash ||
              reserved.contextHash !== finalizeInput.contextHash
            ) {
              throw new DomainError(
                "Economics finalization reservation does not belong to this native assignment, run, organization, executor, capability, or binding hash",
              );
            }
            const types = new Set(
              events.filter((event) => event.reservationId === reserved.reservationId).map((event) => event.eventType),
            );
            if (types.has("owner_action_required")) {
              throw new DomainError(
                "Economics finalization cannot complete while a reservation is owner_action_required; budget remains held",
              );
            }
            if (types.has("committed")) continue;
            if (types.has("released") || types.has("expired")) {
              if (types.has("invocation_started")) {
                throw new DomainError("A started reservation cannot be financially released without owner resolution");
              }
              continue;
            }
            append({
              eventType: "committed",
              organizationId: run.organizationId,
              runId: finalizeInput.runId,
              reservationId: reserved.reservationId,
              idempotencyKey: reserved.idempotencyKey,
              ownerKind: "native_assignment",
              nativeAssignmentId: finalizeInput.assignmentId,
              leasedAttemptId: null,
              eventAt: new Date().toISOString(),
              expiresAt: reserved.expiresAt,
              aiCostMicros: reserved.aiCostMicros,
              toolCostMicros: reserved.toolCostMicros,
              executorKey: finalizeInput.executorKey,
              capabilityKey: finalizeInput.capabilityKey,
              inputManifestContentHash: finalizeInput.inputManifestContentHash,
              envelopeHash: finalizeInput.envelopeHash,
              contextHash: finalizeInput.contextHash,
              planHash: reserved.planHash,
              outputArtifactId: finalizeInput.outputArtifactId,
              packetContentHash: finalizeInput.packetContentHash,
            });
          }
          for (const reserved of durableReserved) {
            if (!reservationIsCompletionEligible(events, reserved.reservationId)) {
              throw new DomainError(
                "Economics finalization requires every native reservation to be committed or explicitly released/expired without invocation",
              );
            }
          }
          assignment.status = "completed";
          return { assignmentId: assignment.assignmentId, assignmentStatus: "completed" };
        } catch (error) {
          events.length = 0;
          events.push(...snapshot);
          byReservationType.clear();
          byIdempotencyType.clear();
          for (const event of events) {
            byReservationType.set(eventKey(event.runId, event.reservationId, event.eventType), event);
            byIdempotencyType.set(idempotencyKey(event.runId, event.idempotencyKey, event.eventType), event);
          }
          assignment.status = priorStatus;
          throw error;
        }
      });
    },
  };
  return writer;
}

export function createSupabaseDurableEconomicsWriter(db: SupabaseClient): DurableEconomicsWriter {
  return {
    async reserve(input) {
      const { data, error } = await db.rpc(RESERVE_OUTCOME_ECONOMICS_EVENT_RPC, {
        p_run_id: input.runId,
        p_phase: input.phase,
        p_assignment_id: input.assignmentId,
        p_reservation_id: input.reservationId,
        p_idempotency_key: input.idempotencyKey,
        p_ai_cost_micros: input.aiCostMicros,
        p_tool_cost_micros: input.toolCostMicros,
        p_expires_at: input.expiresAt,
        p_executor_key: input.executorKey,
        p_capability_key: input.capabilityKey,
        p_input_manifest_content_hash: input.inputManifestContentHash,
        p_envelope_hash: input.envelopeHash,
        p_context_hash: input.contextHash,
        p_plan_hash: input.planHash ?? null,
      });
      if (error) throw new DomainError(error.message || "Could not reserve outcome economics.");
      return { artifactId: String(data) };
    },
    async invocationStarted(input) {
      const { data, error } = await db.rpc(START_OUTCOME_ECONOMICS_INVOCATION_RPC, {
        p_run_id: input.runId,
        p_phase: input.phase,
        p_assignment_id: input.assignmentId,
        p_reservation_id: input.reservationId,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw new DomainError(error.message || "Could not persist invocation_started.");
      return { artifactId: String(data) };
    },
    async release(input) {
      const { data, error } = await db.rpc(RELEASE_OUTCOME_ECONOMICS_EVENT_RPC, {
        p_run_id: input.runId,
        p_phase: input.phase,
        p_assignment_id: input.assignmentId,
        p_reservation_id: input.reservationId,
        p_idempotency_key: input.idempotencyKey,
        p_owner_action: input.ownerAction === true,
      });
      if (error) throw new DomainError(error.message || "Could not release outcome economics.");
      return { artifactId: String(data) };
    },
    async finalize(input) {
      const { data, error } = await db.rpc(FINALIZE_WORK_CELL_PHASE_ECONOMICS_RPC, {
        p_run_id: input.runId,
        p_phase: input.phase,
        p_assignment_id: input.assignmentId,
        p_output_artifact_id: input.outputArtifactId,
        p_input_manifest_content_hash: input.inputManifestContentHash,
        p_envelope_hash: input.envelopeHash,
        p_context_hash: input.contextHash,
        p_executor_key: input.executorKey,
        p_capability_key: input.capabilityKey,
        p_reservation_ids: [...input.reservationIds],
        p_packet_content_hash: input.packetContentHash,
        p_metadata_patch: input.metadataPatch ?? {},
      });
      if (error) throw new DomainError(error.message || "Could not finalize work-cell economics.");
      const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<{
        assignment_id?: string;
        assignment_status?: string;
      }>;
      const row = rows[0];
      if (!row?.assignment_id || row.assignment_status !== "completed") {
        throw new DomainError(
          "OWNER_ACTION_REQUIRED: An accepted catalog evidence packet is persisted, but durable economics finalization did not complete. Packet presence is not economics proof. The assignment remains running.",
        );
      }
      return { assignmentId: String(row.assignment_id), assignmentStatus: String(row.assignment_status) };
    },
  };
}
