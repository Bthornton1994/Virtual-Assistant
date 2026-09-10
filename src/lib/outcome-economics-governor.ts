import { checkEconomicEnvelope, type EconomicTotals } from "@/lib/economic-envelope";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { LEDGER_OUTCOME_SOURCES, type LedgerOutcomeSource } from "@/lib/capability-performance-ledger";
import type { ModelUsage } from "@/lib/model-provider";

/**
 * Outcome Economics Governor v1
 *
 * Control-plane budget reservation and reconciliation. It is not a bot, planner,
 * evidence store, receipt system, or source of Workstream Run authority.
 * Callers supply pricing; this module never embeds provider rate cards.
 */

export const OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION = "outcome-economics-governor/v1" as const;
export const OUTCOME_ECONOMICS_EVIDENCE_SCHEMA_VERSION = "outcome-economics-evidence/v1" as const;

export const EXECUTOR_TIERS = ["deterministic", "cheap", "expensive"] as const;
export type ExecutorTier = (typeof EXECUTOR_TIERS)[number];

export const USAGE_STATUSES = ["reported", "unavailable", "incomplete"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const BUDGET_DECISIONS = ["allow", "downgrade", "reject"] as const;
export type BudgetDecision = (typeof BUDGET_DECISIONS)[number];

export const RESERVATION_STATES = ["reserved", "committed", "released", "expired"] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export const ESCALATION_REASONS = [
  "deterministic_unavailable",
  "deterministic_failed_closed",
  "cheap_failed_with_progress",
  "capability_requires_expensive_tier",
  "human_selected_expensive_tier",
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const LOOP_SIGNALS = ["none", "repeated_equivalent_attempt", "retry_storm", "no_progress"] as const;
export type LoopSignal = (typeof LOOP_SIGNALS)[number];

const FORBIDDEN_TELEMETRY_KEYS = new Set([
  "prompt",
  "completion",
  "content",
  "payload",
  "body",
  "message",
  "raw",
  "chainofthought",
  "reasoning",
]);

const BYPASS_KEYS = new Set([
  "bypassgovernor",
  "ignorelimits",
  "ignorebudget",
  "unlimited",
  "enforcementdisabled",
  "skipgovernor",
]);

const LIMIT_INJECTION_PATTERN =
  /ignore (all )?(the )?(budget |economic |governor )?limits|bypass (the )?(outcome )?economics governor|unlimited (budget|tokens|spend)|enforcement disabled/i;

const HEX64 = /^[0-9a-f]{64}$/;
const STORM_WINDOW_MS = 60_000;
const LOOP_WINDOW_MS = 15 * 60 * 1000;
const STORM_PRIOR_ATTEMPTS = 4;
const NO_PROGRESS_PRIOR_ATTEMPTS = 2;

export type GovernorFailure = { ok: false; failures: string[] };
export type GovernorSuccess<T> = { ok: true; value: T };
export type GovernorResult<T> = GovernorSuccess<T> | GovernorFailure;

export type CallerPricing = {
  currency: "USD";
  inputMicrosPerToken: number | null;
  outputMicrosPerToken: number | null;
  toolCallMicros: number | null;
};

export type UsageObservation = {
  schemaVersion: typeof OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION;
  organizationId: string;
  tenantId: string;
  runId: string;
  executionAttemptId: string;
  assignmentId: string;
  capabilityKey: string;
  executorKey: string;
  executorTier: ExecutorTier;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
  cacheTokens: number | null;
  toolCallCount: number;
  retryCount: number;
  latencyMs: number;
  usageStatus: UsageStatus;
  recordedAt: string;
  toolKeys: readonly string[];
  stepKey: string;
  idempotencyKey: string;
};

export type BudgetReservation = {
  reservationId: string;
  organizationId: string;
  tenantId: string;
  runId: string;
  executionAttemptId: string;
  assignmentId: string;
  idempotencyKey: string;
  executorTier: ExecutorTier;
  reservedAiCostMicros: number;
  reservedToolCostMicros: number;
  estimatedCostMicros: number | null;
  state: ReservationState;
  createdAt: string;
  expiresAt: string;
  loopFingerprint: string;
};

export type ReservationCommit = {
  reservationId: string;
  idempotencyKey: string;
  consumedAiCostMicros: number;
  consumedToolCostMicros: number;
  observedCostMicros: number | null;
  unusedAiCostMicros: number;
  unusedToolCostMicros: number;
  committedAt: string;
  underReported: boolean;
};

export type RoutingDecision = {
  schemaVersion: typeof OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION;
  selectedTier: ExecutorTier;
  eligibleTiers: ExecutorTier[];
  reason: string;
  escalationReason: EscalationReason | null;
};

export type OutcomeEconomicsEvidence = {
  schemaVersion: typeof OUTCOME_ECONOMICS_EVIDENCE_SCHEMA_VERSION;
  organizationId: string;
  tenantId: string;
  runId: string;
  executionAttemptId: string;
  reservationId: string;
  assignmentId: string;
  budgetDecision: BudgetDecision;
  routingReason: string;
  loopSignal: LoopSignal;
  reservedAiCostMicros: number;
  consumedAiCostMicros: number;
  reservedToolCostMicros: number;
  consumedToolCostMicros: number;
  estimatedCostMicros: number | null;
  actualObservedCostMicros: number | null;
  reservedVersusConsumedAiMicros: number;
  retryReworkCostMicros: number;
  contentHash: string;
};

export type VerifiedOutcomeEconomics = {
  estimatedCostMicros: number | null;
  actualObservedCostMicros: number | null;
  reservedVersusConsumedAiMicros: number;
  retryReworkCostMicros: number;
  costPerAcceptedOutcomeReceiptMicros: number | null;
  firstPassVerificationRate: number | null;
  expensiveEscalationYield: number | null;
  wastedExecutionPercentage: number | null;
  acceptedReceiptCount: number;
  attemptCount: number;
};

type ReservationRecord = BudgetReservation & {
  committed?: ReservationCommit;
};

type FingerprintEvent = {
  organizationId: string;
  tenantId: string;
  runId: string;
  fingerprint: string;
  recordedAtMs: number;
  progressed: boolean;
  estimatedCostMicros: number;
  executorTier: ExecutorTier;
};

export type EconomicsSession = {
  organizationId: string;
  tenantId: string;
  maxAiCostMicros: number;
  maxToolCostMicros: number;
  remainingAiCostMicros: number;
  remainingToolCostMicros: number;
  reservations: Map<string, ReservationRecord>;
  reservationsByIdempotency: Map<string, string>;
  commitsByIdempotency: Map<string, ReservationCommit>;
  releasesByIdempotency: Map<string, { reservationId: string; releasedAt: string }>;
  fingerprints: FingerprintEvent[];
};

const TIER_RANK: Record<ExecutorTier, number> = {
  deterministic: 0,
  cheap: 1,
  expensive: 2,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isForbiddenEconomicsTelemetryKey(key: string): boolean {
  return FORBIDDEN_TELEMETRY_KEYS.has(normalizeKey(key));
}

function walkForbiddenKeys(value: unknown, path: string, failures: string[], depth: number): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForbiddenKeys(item, `${path}[${index}]`, failures, depth + 1));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenEconomicsTelemetryKey(key)) {
      failures.push(`Telemetry cannot contain ${path}.${key}.`);
    }
    if (BYPASS_KEYS.has(normalizeKey(key))) {
      failures.push(`Executor cannot instruct the governor to ignore limits (${path}.${key}).`);
    }
    if (typeof nested === "string" && LIMIT_INJECTION_PATTERN.test(nested)) {
      failures.push(`Telemetry cannot instruct the governor to ignore limits (${path}.${key}).`);
    }
    walkForbiddenKeys(nested, `${path}.${key}`, failures, depth + 1);
  }
}

export function assertRedactedEconomicsTelemetry(value: unknown, label = "telemetry"): GovernorResult<true> {
  const failures: string[] = [];
  if (value === undefined) return { ok: true, value: true };
  if (!isObject(value) && !Array.isArray(value)) {
    return { ok: false, failures: [`${label} must be a JSON object.`] };
  }
  walkForbiddenKeys(value, label, failures, 0);
  return failures.length ? { ok: false, failures } : { ok: true, value: true };
}

function requireIdentifier(value: unknown, label: string, failures: string[]): string | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    failures.push(`${label} must be a non-empty trimmed identifier.`);
    return null;
  }
  return value;
}

function requireClock(value: unknown, label: string, failures: string[]): number | null {
  if (typeof value !== "string" || value.length === 0) {
    failures.push(`${label} is required.`);
    return null;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    failures.push(`${label} is not a valid timestamp.`);
    return null;
  }
  return ms;
}

function requireNonNegativeInteger(value: unknown, label: string, failures: string[]): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || !Number.isFinite(value)) {
    failures.push(`${label} must be a non-negative integer.`);
    return null;
  }
  return value;
}

function requireIsolation(
  session: EconomicsSession,
  organizationId: string,
  tenantId: string,
  failures: string[],
  label: string,
): void {
  if (organizationId !== session.organizationId) {
    failures.push(`${label} organizationId does not match the economics session tenant.`);
  }
  if (tenantId !== session.tenantId) {
    failures.push(`${label} tenantId does not match the economics session tenant.`);
  }
}

function cheaperTierAvailable(routing: RoutingDecision): boolean {
  return routing.eligibleTiers.some((tier) => TIER_RANK[tier] < TIER_RANK.expensive);
}

export function loopFingerprint(input: {
  organizationId: string;
  tenantId: string;
  runId: string;
  capabilityKey: string;
  stepKey: string;
  toolKeys: readonly string[];
}): string {
  return sha256Hex({
    schemaVersion: "outcome-economics-loop-fingerprint/v1",
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: input.runId,
    capabilityKey: input.capabilityKey,
    stepKey: input.stepKey,
    toolKeys: [...input.toolKeys].sort(),
  });
}

export function estimateCostMicros(
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    toolCallCount: number;
  },
  pricing: CallerPricing,
): { estimatedCostMicros: number | null; unknownPricing: boolean } {
  const ai = observedAiCostMicros({ ...usage, usageStatus: "reported" }, pricing);
  const tool = observedToolCostMicros({ toolCallCount: usage.toolCallCount, usageStatus: "reported" }, pricing);
  if (ai === null || tool === null) {
    return { estimatedCostMicros: null, unknownPricing: true };
  }
  return { estimatedCostMicros: ai + tool, unknownPricing: false };
}

export function observedAiCostMicros(
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    usageStatus: UsageStatus;
  },
  pricing: CallerPricing,
): number | null {
  if (usage.usageStatus !== "reported") return null;
  if (
    pricing.inputMicrosPerToken === null ||
    pricing.outputMicrosPerToken === null ||
    usage.inputTokens === null ||
    usage.outputTokens === null
  ) {
    return null;
  }
  return usage.inputTokens * pricing.inputMicrosPerToken + usage.outputTokens * pricing.outputMicrosPerToken;
}

export function observedToolCostMicros(
  usage: { toolCallCount: number; usageStatus: UsageStatus },
  pricing: CallerPricing,
): number | null {
  if (usage.usageStatus !== "reported") return null;
  if (pricing.toolCallMicros === null) return null;
  return usage.toolCallCount * pricing.toolCallMicros;
}

export function observedCostMicros(
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    toolCallCount: number;
    usageStatus: UsageStatus;
  },
  pricing: CallerPricing,
): number | null {
  const ai = observedAiCostMicros(usage, pricing);
  const tool = observedToolCostMicros(usage, pricing);
  if (ai === null || tool === null) return null;
  return ai + tool;
}

function expensiveUsageIncomplete(observation: UsageObservation): boolean {
  if (observation.executorTier !== "expensive") return false;
  if (observation.usageStatus !== "reported") return true;
  return observation.reasoningTokens === null || observation.cacheTokens === null;
}

export function createEconomicsSession(input: {
  organizationId: string;
  tenantId: string;
  economicEnvelope: unknown;
}): GovernorResult<EconomicsSession> {
  const redacted = assertRedactedEconomicsTelemetry(input.economicEnvelope, "economicEnvelope");
  if (!redacted.ok) return redacted;
  const failures: string[] = [];
  const organizationId = requireIdentifier(input.organizationId, "organizationId", failures);
  const tenantId = requireIdentifier(input.tenantId, "tenantId", failures);
  const envelope = checkEconomicEnvelope(input.economicEnvelope, {
    humanMinutes: 0,
    ownerMinutes: 0,
    aiCostMicros: 0,
    toolCostMicros: 0,
  });
  if (!envelope.ok) failures.push(...envelope.failures);
  if (!organizationId || !tenantId || failures.length) return { ok: false, failures };
  const maxAiCostMicros = envelope.ok ? (envelope.limits.maxAiCostMicros ?? Number.MAX_SAFE_INTEGER) : 0;
  const maxToolCostMicros = envelope.ok ? (envelope.limits.maxToolCostMicros ?? Number.MAX_SAFE_INTEGER) : 0;
  return {
    ok: true,
    value: {
      organizationId,
      tenantId,
      maxAiCostMicros,
      maxToolCostMicros,
      remainingAiCostMicros: maxAiCostMicros,
      remainingToolCostMicros: maxToolCostMicros,
      reservations: new Map(),
      reservationsByIdempotency: new Map(),
      commitsByIdempotency: new Map(),
      releasesByIdempotency: new Map(),
      fingerprints: [],
    },
  };
}

export function routeExecutorTier(input: {
  availableTiers: readonly ExecutorTier[];
  requestedTier: ExecutorTier;
  escalationReason?: EscalationReason | null;
}): GovernorResult<RoutingDecision> {
  const failures: string[] = [];
  const unique = [...new Set(input.availableTiers)].sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);
  if (unique.length === 0) return { ok: false, failures: ["No executor tiers are available."] };
  if (BYPASS_KEYS.has(normalizeKey(String(input.escalationReason ?? "")))) {
    failures.push("Executor cannot instruct the governor to ignore limits (escalationReason).");
  }
  const cheapest = unique[0];
  if (TIER_RANK[input.requestedTier] <= TIER_RANK[cheapest]) {
    return {
      ok: true,
      value: {
        schemaVersion: OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION,
        selectedTier: cheapest,
        eligibleTiers: unique,
        reason: "prefer_cheapest_deterministic_tier",
        escalationReason: null,
      },
    };
  }
  const reason = input.escalationReason ?? null;
  if (!reason || !ESCALATION_REASONS.includes(reason)) {
    failures.push("Expensive execution requires an explicit explainable escalation reason.");
  }
  if (failures.length) return { ok: false, failures };
  if (!unique.includes(input.requestedTier)) {
    return { ok: false, failures: ["Requested executor tier is not available."] };
  }
  return {
    ok: true,
    value: {
      schemaVersion: OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION,
      selectedTier: input.requestedTier,
      eligibleTiers: unique,
      reason: "explicit_escalation",
      escalationReason: reason,
    },
  };
}

function detectLoop(
  session: EconomicsSession,
  fingerprint: string,
  runId: string,
  nowMs: number,
): LoopSignal {
  const recentStorm = session.fingerprints.filter(
    (event) =>
      event.organizationId === session.organizationId &&
      event.tenantId === session.tenantId &&
      event.runId === runId &&
      nowMs - event.recordedAtMs <= STORM_WINDOW_MS,
  );
  if (recentStorm.length >= STORM_PRIOR_ATTEMPTS) return "retry_storm";
  const recent = session.fingerprints.filter(
    (event) =>
      event.organizationId === session.organizationId &&
      event.tenantId === session.tenantId &&
      event.fingerprint === fingerprint &&
      nowMs - event.recordedAtMs <= LOOP_WINDOW_MS,
  );
  if (recent.length >= NO_PROGRESS_PRIOR_ATTEMPTS && recent.every((event) => !event.progressed)) {
    return "no_progress";
  }
  if (recent.length >= 1) return "repeated_equivalent_attempt";
  return "none";
}

export type ReserveInput = {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  runId: string;
  executionAttemptId: string;
  assignmentId: string;
  capabilityKey: string;
  executorKey: string;
  executorTier: ExecutorTier;
  toolKeys: readonly string[];
  stepKey: string;
  estimatedAiCostMicros: number;
  estimatedToolCostMicros: number;
  estimatedCostMicros: number | null;
  unknownPricing: boolean;
  usageUnavailable: boolean;
  idempotencyKey: string;
  now: string;
  expiresAt: string;
  routing: RoutingDecision;
  telemetry?: unknown;
};

export type ReserveResult = {
  decision: BudgetDecision;
  reservation: BudgetReservation | null;
  loopSignal: LoopSignal;
  routing: RoutingDecision;
};

function expireReservations(session: EconomicsSession, nowMs: number): void {
  for (const reservation of session.reservations.values()) {
    if (reservation.state !== "reserved") continue;
    if (Date.parse(reservation.expiresAt) <= nowMs) {
      reservation.state = "expired";
      session.remainingAiCostMicros += reservation.reservedAiCostMicros;
      session.remainingToolCostMicros += reservation.reservedToolCostMicros;
    }
  }
}

function expensiveGate(input: ReserveInput): GovernorResult<BudgetDecision> {
  if (input.executorTier !== "expensive") return { ok: true, value: "allow" };
  const downgrade = cheaperTierAvailable(input.routing);
  if (input.unknownPricing) {
    if (downgrade) return { ok: true, value: "downgrade" };
    return { ok: false, failures: ["Unknown pricing cannot authorize expensive execution."] };
  }
  if (input.usageUnavailable) {
    if (downgrade) return { ok: true, value: "downgrade" };
    return { ok: false, failures: ["Usage-unavailable expensive actions are rejected."] };
  }
  if (input.routing.selectedTier !== "expensive") {
    return { ok: false, failures: ["Expensive execution requires an explicit explainable escalation reason."] };
  }
  if (cheaperTierAvailable(input.routing) && input.routing.escalationReason === null) {
    return { ok: false, failures: ["Expensive execution requires an explicit explainable escalation reason."] };
  }
  return { ok: true, value: "allow" };
}

export function evaluatePreExecutionBudget(input: ReserveInput): GovernorResult<ReserveResult> {
  const redacted = assertRedactedEconomicsTelemetry(input.telemetry, "telemetry");
  if (!redacted.ok) return redacted;
  const failures: string[] = [];
  requireIsolation(input.session, input.organizationId, input.tenantId, failures, "Reservation");
  const nowMs = requireClock(input.now, "now", failures);
  const expiresMs = requireClock(input.expiresAt, "expiresAt", failures);
  requireIdentifier(input.runId, "runId", failures);
  requireIdentifier(input.executionAttemptId, "executionAttemptId", failures);
  requireIdentifier(input.assignmentId, "assignmentId", failures);
  requireIdentifier(input.capabilityKey, "capabilityKey", failures);
  requireIdentifier(input.executorKey, "executorKey", failures);
  requireIdentifier(input.idempotencyKey, "idempotencyKey", failures);
  requireIdentifier(input.stepKey, "stepKey", failures);
  const reservedAi = requireNonNegativeInteger(input.estimatedAiCostMicros, "estimatedAiCostMicros", failures);
  const reservedTool = requireNonNegativeInteger(input.estimatedToolCostMicros, "estimatedToolCostMicros", failures);
  if (nowMs !== null && expiresMs !== null && expiresMs <= nowMs) {
    failures.push("Reservation expiresAt must be after the evaluation clock.");
  }
  if (failures.length || reservedAi === null || reservedTool === null || nowMs === null) {
    return { ok: false, failures };
  }

  expireReservations(input.session, nowMs);

  const existingId = input.session.reservationsByIdempotency.get(input.idempotencyKey);
  if (existingId) {
    const existing = input.session.reservations.get(existingId);
    if (!existing) return { ok: false, failures: ["Idempotent reservation is missing."] };
    if (existing.state === "expired") {
      return { ok: false, failures: ["Expired reservations cannot be reused."] };
    }
    if (existing.state === "released") {
      return { ok: false, failures: ["Released reservations cannot be reused."] };
    }
    return {
      ok: true,
      value: {
        decision: "allow",
        reservation: existing,
        loopSignal: detectLoop(input.session, existing.loopFingerprint, existing.runId, nowMs),
        routing: input.routing,
      },
    };
  }

  const gate = expensiveGate(input);
  if (!gate.ok) return gate;
  if (gate.value === "downgrade") {
    return {
      ok: true,
      value: {
        decision: "downgrade",
        reservation: null,
        loopSignal: "none",
        routing: input.routing,
      },
    };
  }

  const fingerprint = loopFingerprint({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: input.runId,
    capabilityKey: input.capabilityKey,
    stepKey: input.stepKey,
    toolKeys: input.toolKeys,
  });
  const loopSignal = detectLoop(input.session, fingerprint, input.runId, nowMs);
  if (loopSignal === "retry_storm" || loopSignal === "no_progress") {
    return { ok: false, failures: [`Repeated execution is fail-closed (${loopSignal}).`] };
  }

  if (reservedAi > input.session.remainingAiCostMicros || reservedTool > input.session.remainingToolCostMicros) {
    return { ok: false, failures: ["Budget exceeded: reservation is larger than remaining envelope."] };
  }

  return {
    ok: true,
    value: {
      decision: "allow",
      reservation: null,
      loopSignal,
      routing: input.routing,
    },
  };
}

export function evaluateAndReserve(input: ReserveInput): GovernorResult<ReserveResult> {
  const evaluated = evaluatePreExecutionBudget(input);
  if (!evaluated.ok) return evaluated;
  if (evaluated.value.decision !== "allow") return evaluated;
  if (evaluated.value.reservation) return evaluated;

  const nowMs = Date.parse(input.now);
  const fingerprint = loopFingerprint({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: input.runId,
    capabilityKey: input.capabilityKey,
    stepKey: input.stepKey,
    toolKeys: input.toolKeys,
  });
  const reservationId = sha256Hex({
    schemaVersion: "outcome-economics-reservation-id/v1",
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
    executionAttemptId: input.executionAttemptId,
  });
  const reservation: ReservationRecord = {
    reservationId,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: input.runId,
    executionAttemptId: input.executionAttemptId,
    assignmentId: input.assignmentId,
    idempotencyKey: input.idempotencyKey,
    executorTier: input.executorTier,
    reservedAiCostMicros: input.estimatedAiCostMicros,
    reservedToolCostMicros: input.estimatedToolCostMicros,
    estimatedCostMicros: input.estimatedCostMicros,
    state: "reserved",
    createdAt: input.now,
    expiresAt: input.expiresAt,
    loopFingerprint: fingerprint,
  };
  input.session.remainingAiCostMicros -= input.estimatedAiCostMicros;
  input.session.remainingToolCostMicros -= input.estimatedToolCostMicros;
  input.session.reservations.set(reservationId, reservation);
  input.session.reservationsByIdempotency.set(input.idempotencyKey, reservationId);
  input.session.fingerprints.push({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: input.runId,
    fingerprint,
    recordedAtMs: nowMs,
    progressed: false,
    estimatedCostMicros: input.estimatedAiCostMicros + input.estimatedToolCostMicros,
    executorTier: input.executorTier,
  });
  return {
    ok: true,
    value: {
      decision: "allow",
      reservation,
      loopSignal: evaluated.value.loopSignal,
      routing: input.routing,
    },
  };
}

export function commitReservation(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  reservationId: string;
  idempotencyKey: string;
  observation: UsageObservation;
  pricing: CallerPricing;
  now: string;
  progressed?: boolean;
  telemetry?: unknown;
}): GovernorResult<ReservationCommit> {
  const redacted = assertRedactedEconomicsTelemetry(input.telemetry ?? input.observation, "telemetry");
  if (!redacted.ok) return redacted;
  const failures: string[] = [];
  requireIsolation(input.session, input.organizationId, input.tenantId, failures, "Commit");
  const nowMs = requireClock(input.now, "now", failures);
  requireClock(input.observation.recordedAt, "observation.recordedAt", failures);
  if (input.observation.organizationId !== input.organizationId) {
    failures.push("Usage observation organization does not match the reservation tenant.");
  }
  if (input.observation.tenantId !== input.tenantId) {
    failures.push("Usage observation tenant does not match the reservation tenant.");
  }
  if (failures.length || nowMs === null) return { ok: false, failures };

  expireReservations(input.session, nowMs);

  const existingCommit = input.session.commitsByIdempotency.get(input.idempotencyKey);
  if (existingCommit) return { ok: true, value: existingCommit };

  const reservation = input.session.reservations.get(input.reservationId);
  if (!reservation) return { ok: false, failures: ["Reservation was not found."] };
  if (reservation.organizationId !== input.organizationId || reservation.tenantId !== input.tenantId) {
    return { ok: false, failures: ["Reservation tenant does not match the caller."] };
  }
  if (reservation.idempotencyKey !== input.idempotencyKey) {
    return { ok: false, failures: ["Commit idempotencyKey does not match the reservation."] };
  }
  if (reservation.state === "expired") return { ok: false, failures: ["Expired reservations cannot commit."] };
  if (reservation.state === "released") return { ok: false, failures: ["Released reservations cannot commit."] };
  if (reservation.state === "committed" && reservation.committed) return { ok: true, value: reservation.committed };

  if (expensiveUsageIncomplete(input.observation)) {
    return {
      ok: false,
      failures: ["Expensive execution cannot commit with missing usage, reasoning, or cache accounting."],
    };
  }
  const observedAi = observedAiCostMicros(input.observation, input.pricing);
  const observedTool = observedToolCostMicros(input.observation, input.pricing);
  const observedTotal = observedCostMicros(input.observation, input.pricing);
  if (
    reservation.executorTier === "expensive" &&
    (input.observation.usageStatus !== "reported" || observedTotal === null)
  ) {
    return {
      ok: false,
      failures: ["Expensive execution cannot commit without provider-reported usage and known pricing."],
    };
  }
  if (
    observedAi !== null &&
    observedTool !== null &&
    (observedAi > reservation.reservedAiCostMicros || observedTool > reservation.reservedToolCostMicros)
  ) {
    return { ok: false, failures: ["Provider-reported usage exceeds the reserved budget."] };
  }

  const underReported =
    reservation.executorTier === "expensive" &&
    observedAi !== null &&
    observedTool !== null &&
    (observedAi < reservation.reservedAiCostMicros || observedTool < reservation.reservedToolCostMicros);

  let consumedAi: number;
  let consumedTool: number;
  let unusedAi: number;
  let unusedTool: number;
  if (observedAi === null || observedTool === null) {
    consumedAi = reservation.reservedAiCostMicros;
    consumedTool = reservation.reservedToolCostMicros;
    unusedAi = 0;
    unusedTool = 0;
  } else if (underReported) {
    consumedAi = reservation.reservedAiCostMicros;
    consumedTool = reservation.reservedToolCostMicros;
    unusedAi = 0;
    unusedTool = 0;
  } else {
    consumedAi = observedAi;
    consumedTool = observedTool;
    unusedAi = reservation.reservedAiCostMicros - consumedAi;
    unusedTool = reservation.reservedToolCostMicros - consumedTool;
  }

  input.session.remainingAiCostMicros += unusedAi;
  input.session.remainingToolCostMicros += unusedTool;
  const commit: ReservationCommit = {
    reservationId: reservation.reservationId,
    idempotencyKey: input.idempotencyKey,
    consumedAiCostMicros: consumedAi,
    consumedToolCostMicros: consumedTool,
    observedCostMicros: observedTotal,
    unusedAiCostMicros: unusedAi,
    unusedToolCostMicros: unusedTool,
    committedAt: input.now,
    underReported,
  };
  reservation.state = "committed";
  reservation.committed = commit;
  input.session.commitsByIdempotency.set(input.idempotencyKey, commit);
  if (input.progressed) {
    for (const event of input.session.fingerprints) {
      if (event.fingerprint === reservation.loopFingerprint) event.progressed = true;
    }
  }
  return { ok: true, value: commit };
}

export function releaseReservation(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  reservationId: string;
  idempotencyKey: string;
  now: string;
}): GovernorResult<{ reservationId: string; releasedAt: string }> {
  const failures: string[] = [];
  requireIsolation(input.session, input.organizationId, input.tenantId, failures, "Release");
  const nowMs = requireClock(input.now, "now", failures);
  if (failures.length || nowMs === null) return { ok: false, failures };

  const existing = input.session.releasesByIdempotency.get(input.idempotencyKey);
  if (existing) return { ok: true, value: existing };

  expireReservations(input.session, nowMs);
  const reservation = input.session.reservations.get(input.reservationId);
  if (!reservation) return { ok: false, failures: ["Reservation was not found."] };
  if (reservation.organizationId !== input.organizationId || reservation.tenantId !== input.tenantId) {
    return { ok: false, failures: ["Reservation tenant does not match the caller."] };
  }
  if (reservation.state === "committed") {
    return { ok: false, failures: ["Committed reservations cannot be released."] };
  }
  if (reservation.state === "released") {
    const released = { reservationId: reservation.reservationId, releasedAt: input.now };
    input.session.releasesByIdempotency.set(input.idempotencyKey, released);
    return { ok: true, value: released };
  }
  if (reservation.state === "reserved") {
    input.session.remainingAiCostMicros += reservation.reservedAiCostMicros;
    input.session.remainingToolCostMicros += reservation.reservedToolCostMicros;
  }
  reservation.state = "released";
  const released = { reservationId: reservation.reservationId, releasedAt: input.now };
  input.session.releasesByIdempotency.set(input.idempotencyKey, released);
  return { ok: true, value: released };
}

export function buildEconomicEvidence(input: {
  reservation: BudgetReservation;
  commit?: ReservationCommit | null;
  decision: BudgetDecision;
  routing: RoutingDecision;
  loopSignal: LoopSignal;
  retryReworkCostMicros: number;
}): OutcomeEconomicsEvidence {
  const consumedAi = input.commit?.consumedAiCostMicros ?? 0;
  const consumedTool = input.commit?.consumedToolCostMicros ?? 0;
  const payload: Omit<OutcomeEconomicsEvidence, "contentHash"> = {
    schemaVersion: OUTCOME_ECONOMICS_EVIDENCE_SCHEMA_VERSION,
    organizationId: input.reservation.organizationId,
    tenantId: input.reservation.tenantId,
    runId: input.reservation.runId,
    executionAttemptId: input.reservation.executionAttemptId,
    reservationId: input.reservation.reservationId,
    assignmentId: input.reservation.assignmentId,
    budgetDecision: input.decision,
    routingReason: input.routing.reason,
    loopSignal: input.loopSignal,
    reservedAiCostMicros: input.reservation.reservedAiCostMicros,
    consumedAiCostMicros: consumedAi,
    reservedToolCostMicros: input.reservation.reservedToolCostMicros,
    consumedToolCostMicros: consumedTool,
    estimatedCostMicros: input.reservation.estimatedCostMicros,
    actualObservedCostMicros: input.commit?.observedCostMicros ?? null,
    reservedVersusConsumedAiMicros: input.reservation.reservedAiCostMicros - consumedAi,
    retryReworkCostMicros: input.retryReworkCostMicros,
  };
  return { ...payload, contentHash: sha256Hex(payload) };
}

export function deriveVerifiedOutcomeEconomics(input: {
  evidence: readonly OutcomeEconomicsEvidence[];
  receipt: { verificationStatus: string; definitionOfDoneMet: boolean };
  outcomeSource: LedgerOutcomeSource;
  firstPassVerified: boolean;
  expensiveEscalations: number;
  expensiveEscalationsAccepted: number;
}): GovernorResult<VerifiedOutcomeEconomics> {
  if (!(LEDGER_OUTCOME_SOURCES as readonly string[]).includes(input.outcomeSource)) {
    return { ok: false, failures: ["Performance ledger may only learn from deterministic_validator or human_qa."] };
  }
  if (input.receipt.verificationStatus !== "passed" || !input.receipt.definitionOfDoneMet) {
    return { ok: false, failures: ["Economic success requires an independently verified Outcome Receipt."] };
  }
  if (input.evidence.length === 0) {
    return { ok: false, failures: ["Verified outcome economics require attached economic evidence."] };
  }
  const actuals = input.evidence.map((item) => item.actualObservedCostMicros);
  const actualObservedCostMicros = actuals.every((value) => value !== null)
    ? actuals.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
  const estimated = input.evidence.every((item) => item.estimatedCostMicros !== null)
    ? input.evidence.reduce((sum, item) => sum + (item.estimatedCostMicros ?? 0), 0)
    : null;
  const reservedVersusConsumedAiMicros = input.evidence.reduce(
    (sum, item) => sum + item.reservedVersusConsumedAiMicros,
    0,
  );
  const retryReworkCostMicros = input.evidence.reduce((sum, item) => sum + item.retryReworkCostMicros, 0);
  return {
    ok: true,
    value: {
      estimatedCostMicros: estimated,
      actualObservedCostMicros,
      reservedVersusConsumedAiMicros,
      retryReworkCostMicros,
      costPerAcceptedOutcomeReceiptMicros: actualObservedCostMicros,
      firstPassVerificationRate: input.firstPassVerified ? 1 : 0,
      expensiveEscalationYield:
        input.expensiveEscalations === 0 ? null : input.expensiveEscalationsAccepted / input.expensiveEscalations,
      wastedExecutionPercentage:
        actualObservedCostMicros === null || actualObservedCostMicros === 0
          ? null
          : retryReworkCostMicros / actualObservedCostMicros,
      acceptedReceiptCount: 1,
      attemptCount: input.evidence.length,
    },
  };
}

export function totalsAgainstEnvelope(envelope: unknown, totals: EconomicTotals): GovernorResult<true> {
  const check = checkEconomicEnvelope(envelope, totals);
  return check.ok ? { ok: true, value: true } : { ok: false, failures: check.failures };
}

export function governModelUsage(
  usage: ModelUsage | null,
  tier: ExecutorTier,
): GovernorResult<{ usageStatus: UsageStatus }> {
  if (!usage) {
    if (tier === "expensive") return { ok: false, failures: ["Usage-unavailable expensive actions are rejected."] };
    return { ok: true, value: { usageStatus: "unavailable" } };
  }
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    return { ok: false, failures: ["Provider usage totals are inconsistent."] };
  }
  return { ok: true, value: { usageStatus: "reported" } };
}

export const ECONOMICS_RESERVATION_METADATA_KEY = "economicReservationId";

export function readRuntimeEconomicsReservationId(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) return null;
  const value = metadata[ECONOMICS_RESERVATION_METADATA_KEY];
  return typeof value === "string" && HEX64.test(value) ? value : null;
}
