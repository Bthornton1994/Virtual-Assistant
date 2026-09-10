import { checkEconomicEnvelope, type EconomicTotals } from "@/lib/economic-envelope";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { LEDGER_OUTCOME_SOURCES, type LedgerOutcomeSource } from "@/lib/capability-performance-ledger";
import type { ActionClass } from "@/lib/domain";
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

export const BUDGET_DECISIONS = ["allow", "downgrade", "hold", "reject"] as const;
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
  quotedAt?: string | null;
  maxAgeMs?: number | null;
};

export type ExecutionLimitSnapshot = {
  attemptNumber: number;
  maxAttempts: number;
  deadlineAt: string;
  workCellPhaseAlreadyRecorded: boolean;
};

export type AuthorityFreeze = {
  actionClass: ActionClass;
  requiresHumanApproval: boolean;
  mayOwnAuthoritativeState: boolean;
  independentReviewRequired: boolean;
  requiredArtifactSchemaVersions: readonly string[];
};

const ACTION_CLASS_RANK: Record<ActionClass, number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

export const PRICING_DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;

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
  failedAttemptCostMicros: number;
  reservedBudgetMicros: number;
  consumedBudgetMicros: number;
  releasedBudgetMicros: number;
  retryCount: number;
  estimatedUsageTokens: number | null;
  actualUsageTokens: number | null;
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
  releasedAiCostMicros: number;
  releasedToolCostMicros: number;
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

export const INVALID_USAGE_FAILURE = "Malformed or non-finite usage cannot be committed.";
export const INVALID_SESSION_BUDGET_FAILURE = "Economics session monetary state is invalid.";

export function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function assertSafeNonNegativeInteger(
  value: unknown,
  label: string,
  code: string = INVALID_USAGE_FAILURE,
): GovernorResult<number> {
  if (!isSafeNonNegativeInteger(value)) {
    return { ok: false, failures: [`${label} must be a non-negative safe integer.`, code] };
  }
  return { ok: true, value };
}

export function assertOptionalSafeNonNegativeInteger(
  value: unknown,
  label: string,
  code: string = INVALID_USAGE_FAILURE,
): GovernorResult<number | null> {
  if (value === null || value === undefined) return { ok: true, value: null };
  return assertSafeNonNegativeInteger(value, label, code);
}

function requireNonNegativeInteger(value: unknown, label: string, failures: string[]): number | null {
  const checked = assertSafeNonNegativeInteger(value, label, INVALID_USAGE_FAILURE);
  if (!checked.ok) {
    failures.push(...checked.failures);
    return null;
  }
  return checked.value;
}

function collectSafeIntegerFailure(
  value: unknown,
  label: string,
  failures: string[],
  optional: boolean,
): void {
  if (optional && (value === null || value === undefined)) return;
  if (!isSafeNonNegativeInteger(value)) {
    failures.push(`${label} must be a non-negative safe integer.`);
  }
}

export function assertUsageObservationNumerics(observation: UsageObservation): GovernorResult<true> {
  const failures: string[] = [];
  collectSafeIntegerFailure(observation.inputTokens, "observation.inputTokens", failures, true);
  collectSafeIntegerFailure(observation.outputTokens, "observation.outputTokens", failures, true);
  collectSafeIntegerFailure(observation.totalTokens, "observation.totalTokens", failures, true);
  collectSafeIntegerFailure(observation.reasoningTokens, "observation.reasoningTokens", failures, true);
  collectSafeIntegerFailure(observation.cacheTokens, "observation.cacheTokens", failures, true);
  collectSafeIntegerFailure(observation.toolCallCount, "observation.toolCallCount", failures, false);
  collectSafeIntegerFailure(observation.retryCount, "observation.retryCount", failures, false);
  collectSafeIntegerFailure(observation.latencyMs, "observation.latencyMs", failures, false);
  if (failures.length) {
    return { ok: false, failures: [...failures, INVALID_USAGE_FAILURE] };
  }
  return { ok: true, value: true };
}

export function assertCallerPricingNumerics(pricing: CallerPricing): GovernorResult<true> {
  const failures: string[] = [];
  collectSafeIntegerFailure(pricing.inputMicrosPerToken, "pricing.inputMicrosPerToken", failures, true);
  collectSafeIntegerFailure(pricing.outputMicrosPerToken, "pricing.outputMicrosPerToken", failures, true);
  collectSafeIntegerFailure(pricing.toolCallMicros, "pricing.toolCallMicros", failures, true);
  if (failures.length) {
    return { ok: false, failures: [...failures, INVALID_USAGE_FAILURE] };
  }
  return { ok: true, value: true };
}

function sessionReservedAndConsumed(session: EconomicsSession): {
  reservedAiCostMicros: number;
  reservedToolCostMicros: number;
  consumedAiCostMicros: number;
  consumedToolCostMicros: number;
  failures: string[];
} {
  const failures: string[] = [];
  let reservedAiCostMicros = 0;
  let reservedToolCostMicros = 0;
  let consumedAiCostMicros = 0;
  let consumedToolCostMicros = 0;
  for (const reservation of session.reservations.values()) {
    collectSafeIntegerFailure(reservation.reservedAiCostMicros, "reservation.reservedAiCostMicros", failures, false);
    collectSafeIntegerFailure(reservation.reservedToolCostMicros, "reservation.reservedToolCostMicros", failures, false);
    collectSafeIntegerFailure(reservation.estimatedCostMicros, "reservation.estimatedCostMicros", failures, true);
    if (reservation.state === "reserved") {
      reservedAiCostMicros += reservation.reservedAiCostMicros;
      reservedToolCostMicros += reservation.reservedToolCostMicros;
    }
    if (reservation.committed) {
      collectSafeIntegerFailure(
        reservation.committed.consumedAiCostMicros,
        "reservation.consumedAiCostMicros",
        failures,
        false,
      );
      collectSafeIntegerFailure(
        reservation.committed.consumedToolCostMicros,
        "reservation.consumedToolCostMicros",
        failures,
        false,
      );
      collectSafeIntegerFailure(
        reservation.committed.observedCostMicros,
        "reservation.observedCostMicros",
        failures,
        true,
      );
      collectSafeIntegerFailure(
        reservation.committed.unusedAiCostMicros,
        "reservation.unusedAiCostMicros",
        failures,
        false,
      );
      collectSafeIntegerFailure(
        reservation.committed.unusedToolCostMicros,
        "reservation.unusedToolCostMicros",
        failures,
        false,
      );
      consumedAiCostMicros += reservation.committed.consumedAiCostMicros;
      consumedToolCostMicros += reservation.committed.consumedToolCostMicros;
    }
  }
  for (const event of session.fingerprints) {
    collectSafeIntegerFailure(event.estimatedCostMicros, "fingerprint.estimatedCostMicros", failures, false);
  }
  collectSafeIntegerFailure(reservedAiCostMicros, "reservedAiCostMicros", failures, false);
  collectSafeIntegerFailure(reservedToolCostMicros, "reservedToolCostMicros", failures, false);
  collectSafeIntegerFailure(consumedAiCostMicros, "consumedAiCostMicros", failures, false);
  collectSafeIntegerFailure(consumedToolCostMicros, "consumedToolCostMicros", failures, false);
  return {
    reservedAiCostMicros,
    reservedToolCostMicros,
    consumedAiCostMicros,
    consumedToolCostMicros,
    failures,
  };
}

export function assertEconomicsSessionMonetaryState(session: EconomicsSession): GovernorResult<true> {
  const failures: string[] = [];
  collectSafeIntegerFailure(session.maxAiCostMicros, "maxAiCostMicros", failures, false);
  collectSafeIntegerFailure(session.maxToolCostMicros, "maxToolCostMicros", failures, false);
  collectSafeIntegerFailure(session.remainingAiCostMicros, "remainingAiCostMicros", failures, false);
  collectSafeIntegerFailure(session.remainingToolCostMicros, "remainingToolCostMicros", failures, false);
  collectSafeIntegerFailure(session.releasedAiCostMicros, "releasedAiCostMicros", failures, false);
  collectSafeIntegerFailure(session.releasedToolCostMicros, "releasedToolCostMicros", failures, false);
  const derived = sessionReservedAndConsumed(session);
  failures.push(...derived.failures);
  if (failures.length) {
    return { ok: false, failures: [...failures, INVALID_SESSION_BUDGET_FAILURE] };
  }
  return { ok: true, value: true };
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

export function assertCheaperRouteDoesNotWeakenAuthority(input: {
  frozen: AuthorityFreeze;
  proposed: AuthorityFreeze;
}): GovernorResult<true> {
  const failures: string[] = [];
  if (input.proposed.mayOwnAuthoritativeState) {
    failures.push("A cheaper route cannot grant authoritative state ownership.");
  }
  if (input.frozen.mayOwnAuthoritativeState) {
    failures.push("Frozen authority cannot declare executor-owned authoritative state.");
  }
  if (ACTION_CLASS_RANK[input.proposed.actionClass] > ACTION_CLASS_RANK[input.frozen.actionClass]) {
    failures.push("A cheaper route cannot raise the action class above the frozen Delegation Spec ceiling.");
  }
  if (input.frozen.requiresHumanApproval && !input.proposed.requiresHumanApproval) {
    failures.push("A cheaper route cannot drop a required human approval.");
  }
  if (input.frozen.independentReviewRequired && !input.proposed.independentReviewRequired) {
    failures.push("A cheaper route cannot drop independent review.");
  }
  const frozenSchemas = new Set(input.frozen.requiredArtifactSchemaVersions);
  for (const schema of frozenSchemas) {
    if (!input.proposed.requiredArtifactSchemaVersions.includes(schema)) {
      failures.push("A cheaper route cannot drop required evidence artifact schemas.");
      break;
    }
  }
  return failures.length ? { ok: false, failures } : { ok: true, value: true };
}

export function assertExecutionLimits(
  limits: ExecutionLimitSnapshot,
  nowMs: number,
): GovernorResult<true> {
  const failures: string[] = [];
  if (!Number.isInteger(limits.attemptNumber) || limits.attemptNumber < 1) {
    failures.push("attemptNumber must be a positive integer.");
  }
  if (!Number.isInteger(limits.maxAttempts) || limits.maxAttempts < 1 || limits.maxAttempts > 10) {
    failures.push("maxAttempts must be an integer from 1 through 10.");
  }
  if (limits.attemptNumber > limits.maxAttempts) {
    failures.push("Attempt budget is exhausted.");
  }
  const deadlineMs = requireClock(limits.deadlineAt, "deadlineAt", failures);
  if (deadlineMs !== null && deadlineMs <= nowMs) {
    failures.push("Evaluation clock is at or after the execution deadline.");
  }
  if (limits.workCellPhaseAlreadyRecorded) {
    failures.push("Work-cell phase already has a recorded attempt.");
  }
  return failures.length ? { ok: false, failures } : { ok: true, value: true };
}

export function pricingIsStale(pricing: CallerPricing, nowMs: number): boolean {
  if (!pricing.quotedAt) return false;
  const quotedMs = Date.parse(pricing.quotedAt);
  if (!Number.isFinite(quotedMs)) return true;
  const maxAge = pricing.maxAgeMs ?? PRICING_DEFAULT_MAX_AGE_MS;
  return nowMs - quotedMs > maxAge || quotedMs > nowMs;
}

export function reconcileUntrustedUsage(input: {
  tokenDerivedMicros: number | null;
  billedCostMicros: number | null;
  usageStatus: UsageStatus;
}): GovernorResult<{ observedCostMicros: number | null }> {
  if (input.usageStatus === "incomplete") {
    return { ok: false, failures: ["Incomplete provider usage is untrusted and cannot commit."] };
  }
  if (input.billedCostMicros !== null && input.tokenDerivedMicros !== null && input.billedCostMicros !== input.tokenDerivedMicros) {
    return {
      ok: false,
      failures: ["Provider billed usage does not match token-derived cost; both are untrusted until they agree."],
    };
  }
  return {
    ok: true,
    value: { observedCostMicros: input.billedCostMicros ?? input.tokenDerivedMicros },
  };
}

export function verifyEconomicEvidence(evidence: OutcomeEconomicsEvidence): GovernorResult<true> {
  const redacted = assertRedactedEconomicsTelemetry(evidence, "economicEvidence");
  if (!redacted.ok) return redacted;
  const { contentHash, ...payload } = evidence;
  if (sha256Hex(payload) !== contentHash) {
    return { ok: false, failures: ["Economic evidence content hash does not match the frozen payload."] };
  }
  return { ok: true, value: true };
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
      releasedAiCostMicros: 0,
      releasedToolCostMicros: 0,
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
  usageIncomplete?: boolean;
  streamTerminatedBeforeUsage?: boolean;
  billedCostMicros?: number | null;
  pricing?: CallerPricing | null;
  executionLimits?: ExecutionLimitSnapshot | null;
  frozenAuthority?: AuthorityFreeze | null;
  proposedAuthority?: AuthorityFreeze | null;
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

function expireReservations(session: EconomicsSession, nowMs: number): GovernorResult<true> {
  const toExpire: ReservationRecord[] = [];
  let nextRemainingAi = session.remainingAiCostMicros;
  let nextRemainingTool = session.remainingToolCostMicros;
  for (const reservation of session.reservations.values()) {
    if (reservation.state !== "reserved") continue;
    if (Date.parse(reservation.expiresAt) <= nowMs) {
      toExpire.push(reservation);
      nextRemainingAi += reservation.reservedAiCostMicros;
      nextRemainingTool += reservation.reservedToolCostMicros;
    }
  }
  const nextAi = assertSafeNonNegativeInteger(
    nextRemainingAi,
    "remainingAiCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  const nextTool = assertSafeNonNegativeInteger(
    nextRemainingTool,
    "remainingToolCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  if (!nextAi.ok) return nextAi;
  if (!nextTool.ok) return nextTool;
  for (const reservation of toExpire) {
    reservation.state = "expired";
  }
  session.remainingAiCostMicros = nextAi.value;
  session.remainingToolCostMicros = nextTool.value;
  return { ok: true, value: true };
}

function expensiveGate(input: ReserveInput): GovernorResult<BudgetDecision> {
  if (input.executorTier !== "expensive") return { ok: true, value: "allow" };
  if (input.streamTerminatedBeforeUsage || input.usageIncomplete) {
    return { ok: true, value: "hold" };
  }
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
  if (input.estimatedCostMicros !== null && input.estimatedCostMicros !== undefined) {
    requireNonNegativeInteger(input.estimatedCostMicros, "estimatedCostMicros", failures);
  }
  if (nowMs !== null && expiresMs !== null && expiresMs <= nowMs) {
    failures.push("Reservation expiresAt must be after the evaluation clock.");
  }
  if (
    input.executorTier !== input.routing.selectedTier &&
    input.routing.selectedTier !== "expensive" &&
    input.executorTier === "expensive"
  ) {
    failures.push("Executor cannot switch to an expensive tier around a cheaper routing decision.");
  }
  if (failures.length || reservedAi === null || reservedTool === null || nowMs === null) {
    return { ok: false, failures };
  }

  const sessionState = assertEconomicsSessionMonetaryState(input.session);
  if (!sessionState.ok) return sessionState;

  if (input.executionLimits) {
    const limits = assertExecutionLimits(input.executionLimits, nowMs);
    if (!limits.ok) return limits;
  }
  if (input.frozenAuthority && input.proposedAuthority) {
    const authority = assertCheaperRouteDoesNotWeakenAuthority({
      frozen: input.frozenAuthority,
      proposed: input.proposedAuthority,
    });
    if (!authority.ok) return authority;
  }
  const pricingUnknown =
    input.unknownPricing || (input.pricing ? pricingIsStale(input.pricing, nowMs) : false);

  const expired = expireReservations(input.session, nowMs);
  if (!expired.ok) return expired;
  const afterExpire = assertEconomicsSessionMonetaryState(input.session);
  if (!afterExpire.ok) return afterExpire;

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

  const gate = expensiveGate({ ...input, unknownPricing: pricingUnknown });
  if (!gate.ok) return gate;
  if (gate.value === "downgrade" || gate.value === "hold") {
    return {
      ok: true,
      value: {
        decision: gate.value,
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

  const remainingAi = assertSafeNonNegativeInteger(
    input.session.remainingAiCostMicros,
    "remainingAiCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  const remainingTool = assertSafeNonNegativeInteger(
    input.session.remainingToolCostMicros,
    "remainingToolCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  if (!remainingAi.ok) return remainingAi;
  if (!remainingTool.ok) return remainingTool;
  if (reservedAi > remainingAi.value || reservedTool > remainingTool.value) {
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
  const nextRemainingAi = assertSafeNonNegativeInteger(
    input.session.remainingAiCostMicros - input.estimatedAiCostMicros,
    "remainingAiCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  const nextRemainingTool = assertSafeNonNegativeInteger(
    input.session.remainingToolCostMicros - input.estimatedToolCostMicros,
    "remainingToolCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  const fingerprintEstimate = assertSafeNonNegativeInteger(
    input.estimatedAiCostMicros + input.estimatedToolCostMicros,
    "fingerprint.estimatedCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  if (!nextRemainingAi.ok) return nextRemainingAi;
  if (!nextRemainingTool.ok) return nextRemainingTool;
  if (!fingerprintEstimate.ok) return fingerprintEstimate;
  input.session.remainingAiCostMicros = nextRemainingAi.value;
  input.session.remainingToolCostMicros = nextRemainingTool.value;
  input.session.reservations.set(reservationId, reservation);
  input.session.reservationsByIdempotency.set(input.idempotencyKey, reservationId);
  input.session.fingerprints.push({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: input.runId,
    fingerprint,
    recordedAtMs: nowMs,
    progressed: false,
    estimatedCostMicros: fingerprintEstimate.value,
    executorTier: input.executorTier,
  });
  const afterReserve = assertEconomicsSessionMonetaryState(input.session);
  if (!afterReserve.ok) {
    input.session.remainingAiCostMicros += input.estimatedAiCostMicros;
    input.session.remainingToolCostMicros += input.estimatedToolCostMicros;
    input.session.reservations.delete(reservationId);
    input.session.reservationsByIdempotency.delete(input.idempotencyKey);
    input.session.fingerprints.pop();
    return afterReserve;
  }
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
  billedCostMicros?: number | null;
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

  const usageNumerics = assertUsageObservationNumerics(input.observation);
  if (!usageNumerics.ok) return usageNumerics;
  const billedNumerics = assertOptionalSafeNonNegativeInteger(
    input.billedCostMicros,
    "billedCostMicros",
    INVALID_USAGE_FAILURE,
  );
  if (!billedNumerics.ok) return billedNumerics;
  const pricingNumerics = assertCallerPricingNumerics(input.pricing);
  if (!pricingNumerics.ok) return pricingNumerics;
  const sessionState = assertEconomicsSessionMonetaryState(input.session);
  if (!sessionState.ok) return sessionState;

  const expired = expireReservations(input.session, nowMs);
  if (!expired.ok) return expired;
  const afterExpire = assertEconomicsSessionMonetaryState(input.session);
  if (!afterExpire.ok) return afterExpire;

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
  const observedAiSafe = assertOptionalSafeNonNegativeInteger(observedAi, "observedAiCostMicros");
  const observedToolSafe = assertOptionalSafeNonNegativeInteger(observedTool, "observedToolCostMicros");
  const observedTotalSafe = assertOptionalSafeNonNegativeInteger(observedTotal, "observedCostMicros");
  if (!observedAiSafe.ok) return observedAiSafe;
  if (!observedToolSafe.ok) return observedToolSafe;
  if (!observedTotalSafe.ok) return observedTotalSafe;
  if (pricingIsStale(input.pricing, nowMs)) {
    return { ok: false, failures: ["Stale or future-dated pricing cannot reconcile usage."] };
  }
  const billed = reconcileUntrustedUsage({
    tokenDerivedMicros: observedTotalSafe.value,
    billedCostMicros: billedNumerics.value,
    usageStatus: input.observation.usageStatus,
  });
  if (!billed.ok) return billed;
  const billedObserved = assertOptionalSafeNonNegativeInteger(
    billed.value.observedCostMicros,
    "reconciledObservedCostMicros",
  );
  if (!billedObserved.ok) return billedObserved;
  if (
    reservation.executorTier === "expensive" &&
    (input.observation.usageStatus !== "reported" || observedTotalSafe.value === null)
  ) {
    return {
      ok: false,
      failures: ["Expensive execution cannot commit without provider-reported usage and known pricing."],
    };
  }
  if (
    observedAiSafe.value !== null &&
    observedToolSafe.value !== null &&
    (observedAiSafe.value > reservation.reservedAiCostMicros ||
      observedToolSafe.value > reservation.reservedToolCostMicros)
  ) {
    return { ok: false, failures: ["Provider-reported usage exceeds the reserved budget."] };
  }

  const underReported =
    reservation.executorTier === "expensive" &&
    observedAiSafe.value !== null &&
    observedToolSafe.value !== null &&
    (observedAiSafe.value < reservation.reservedAiCostMicros ||
      observedToolSafe.value < reservation.reservedToolCostMicros);

  let consumedAi: number;
  let consumedTool: number;
  let unusedAi: number;
  let unusedTool: number;
  if (observedAiSafe.value === null || observedToolSafe.value === null) {
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
    consumedAi = observedAiSafe.value;
    consumedTool = observedToolSafe.value;
    unusedAi = reservation.reservedAiCostMicros - consumedAi;
    unusedTool = reservation.reservedToolCostMicros - consumedTool;
  }

  const consumedAiSafe = assertSafeNonNegativeInteger(consumedAi, "consumedAiCostMicros", INVALID_USAGE_FAILURE);
  const consumedToolSafe = assertSafeNonNegativeInteger(consumedTool, "consumedToolCostMicros", INVALID_USAGE_FAILURE);
  const unusedAiSafe = assertSafeNonNegativeInteger(unusedAi, "unusedAiCostMicros", INVALID_USAGE_FAILURE);
  const unusedToolSafe = assertSafeNonNegativeInteger(unusedTool, "unusedToolCostMicros", INVALID_USAGE_FAILURE);
  if (!consumedAiSafe.ok) return consumedAiSafe;
  if (!consumedToolSafe.ok) return consumedToolSafe;
  if (!unusedAiSafe.ok) return unusedAiSafe;
  if (!unusedToolSafe.ok) return unusedToolSafe;

  const nextRemainingAi = assertSafeNonNegativeInteger(
    input.session.remainingAiCostMicros + unusedAiSafe.value,
    "remainingAiCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  const nextRemainingTool = assertSafeNonNegativeInteger(
    input.session.remainingToolCostMicros + unusedToolSafe.value,
    "remainingToolCostMicros",
    INVALID_SESSION_BUDGET_FAILURE,
  );
  if (!nextRemainingAi.ok) return nextRemainingAi;
  if (!nextRemainingTool.ok) return nextRemainingTool;

  const commit: ReservationCommit = {
    reservationId: reservation.reservationId,
    idempotencyKey: input.idempotencyKey,
    consumedAiCostMicros: consumedAiSafe.value,
    consumedToolCostMicros: consumedToolSafe.value,
    observedCostMicros: observedTotalSafe.value,
    unusedAiCostMicros: unusedAiSafe.value,
    unusedToolCostMicros: unusedToolSafe.value,
    committedAt: input.now,
    underReported,
  };
  input.session.remainingAiCostMicros = nextRemainingAi.value;
  input.session.remainingToolCostMicros = nextRemainingTool.value;
  reservation.state = "committed";
  reservation.committed = commit;
  input.session.commitsByIdempotency.set(input.idempotencyKey, commit);
  const afterCommit = assertEconomicsSessionMonetaryState(input.session);
  if (!afterCommit.ok) {
    input.session.remainingAiCostMicros -= unusedAiSafe.value;
    input.session.remainingToolCostMicros -= unusedToolSafe.value;
    reservation.state = "reserved";
    delete reservation.committed;
    input.session.commitsByIdempotency.delete(input.idempotencyKey);
    return afterCommit;
  }
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

  const sessionState = assertEconomicsSessionMonetaryState(input.session);
  if (!sessionState.ok) return sessionState;

  const existing = input.session.releasesByIdempotency.get(input.idempotencyKey);
  if (existing) return { ok: true, value: existing };

  const expired = expireReservations(input.session, nowMs);
  if (!expired.ok) return expired;
  const afterExpire = assertEconomicsSessionMonetaryState(input.session);
  if (!afterExpire.ok) return afterExpire;
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
  const previousState = reservation.state;
  let restoredReserved = false;
  if (previousState === "reserved") {
    const nextRemainingAi = assertSafeNonNegativeInteger(
      input.session.remainingAiCostMicros + reservation.reservedAiCostMicros,
      "remainingAiCostMicros",
      INVALID_SESSION_BUDGET_FAILURE,
    );
    const nextRemainingTool = assertSafeNonNegativeInteger(
      input.session.remainingToolCostMicros + reservation.reservedToolCostMicros,
      "remainingToolCostMicros",
      INVALID_SESSION_BUDGET_FAILURE,
    );
    const nextReleasedAi = assertSafeNonNegativeInteger(
      input.session.releasedAiCostMicros + reservation.reservedAiCostMicros,
      "releasedAiCostMicros",
      INVALID_SESSION_BUDGET_FAILURE,
    );
    const nextReleasedTool = assertSafeNonNegativeInteger(
      input.session.releasedToolCostMicros + reservation.reservedToolCostMicros,
      "releasedToolCostMicros",
      INVALID_SESSION_BUDGET_FAILURE,
    );
    if (!nextRemainingAi.ok) return nextRemainingAi;
    if (!nextRemainingTool.ok) return nextRemainingTool;
    if (!nextReleasedAi.ok) return nextReleasedAi;
    if (!nextReleasedTool.ok) return nextReleasedTool;
    input.session.remainingAiCostMicros = nextRemainingAi.value;
    input.session.remainingToolCostMicros = nextRemainingTool.value;
    input.session.releasedAiCostMicros = nextReleasedAi.value;
    input.session.releasedToolCostMicros = nextReleasedTool.value;
    restoredReserved = true;
  }
  reservation.state = "released";
  const released = { reservationId: reservation.reservationId, releasedAt: input.now };
  input.session.releasesByIdempotency.set(input.idempotencyKey, released);
  const afterRelease = assertEconomicsSessionMonetaryState(input.session);
  if (!afterRelease.ok) {
    reservation.state = previousState;
    input.session.releasesByIdempotency.delete(input.idempotencyKey);
    if (restoredReserved) {
      input.session.remainingAiCostMicros -= reservation.reservedAiCostMicros;
      input.session.remainingToolCostMicros -= reservation.reservedToolCostMicros;
      input.session.releasedAiCostMicros -= reservation.reservedAiCostMicros;
      input.session.releasedToolCostMicros -= reservation.reservedToolCostMicros;
    }
    return afterRelease;
  }
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
  releasedBudgetMicros?: number;
  retryCount?: number;
  estimatedUsageTokens?: number | null;
  actualUsageTokens?: number | null;
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
  for (const item of input.evidence) {
    const estimatedField = assertOptionalSafeNonNegativeInteger(
      item.estimatedCostMicros,
      "evidence.estimatedCostMicros",
    );
    const actualField = assertOptionalSafeNonNegativeInteger(
      item.actualObservedCostMicros,
      "evidence.actualObservedCostMicros",
    );
    if (!estimatedField.ok) return estimatedField;
    if (!actualField.ok) return actualField;
  }
  const actuals = input.evidence.map((item) => item.actualObservedCostMicros);
  const actualObservedCostMicros = actuals.every((value) => value !== null)
    ? actuals.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
  const estimated = input.evidence.every((item) => item.estimatedCostMicros !== null)
    ? input.evidence.reduce((sum, item) => sum + (item.estimatedCostMicros ?? 0), 0)
    : null;
  const actualSafe = assertOptionalSafeNonNegativeInteger(actualObservedCostMicros, "actualObservedCostMicros");
  const estimatedSafe = assertOptionalSafeNonNegativeInteger(estimated, "estimatedCostMicros");
  if (!actualSafe.ok) return actualSafe;
  if (!estimatedSafe.ok) return estimatedSafe;
  const reservedVersusConsumedAiMicros = input.evidence.reduce(
    (sum, item) => sum + item.reservedVersusConsumedAiMicros,
    0,
  );
  const retryReworkCostMicros = input.evidence.reduce((sum, item) => sum + item.retryReworkCostMicros, 0);
  const reservedBudgetMicros = input.evidence.reduce(
    (sum, item) => sum + item.reservedAiCostMicros + item.reservedToolCostMicros,
    0,
  );
  const consumedBudgetMicros = input.evidence.reduce(
    (sum, item) => sum + item.consumedAiCostMicros + item.consumedToolCostMicros,
    0,
  );
  return {
    ok: true,
    value: {
      estimatedCostMicros: estimatedSafe.value,
      actualObservedCostMicros: actualSafe.value,
      reservedVersusConsumedAiMicros,
      retryReworkCostMicros,
      failedAttemptCostMicros: retryReworkCostMicros,
      reservedBudgetMicros,
      consumedBudgetMicros,
      releasedBudgetMicros: input.releasedBudgetMicros ?? 0,
      retryCount: input.retryCount ?? input.evidence.length,
      estimatedUsageTokens: input.estimatedUsageTokens ?? null,
      actualUsageTokens: input.actualUsageTokens ?? null,
      costPerAcceptedOutcomeReceiptMicros: actualSafe.value,
      firstPassVerificationRate: input.firstPassVerified ? 1 : 0,
      expensiveEscalationYield:
        input.expensiveEscalations === 0 ? null : input.expensiveEscalationsAccepted / input.expensiveEscalations,
      wastedExecutionPercentage:
        actualSafe.value === null || actualSafe.value === 0
          ? null
          : retryReworkCostMicros / actualSafe.value,
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
