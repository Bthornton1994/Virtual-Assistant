import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { DomainError, type ActionClass } from "@/lib/domain";
import {
  hashExecutorEnvelope,
  validateExecutorEnvelope,
  type ExecutorEnvelopeV1,
} from "@/lib/executor-envelope";
import {
  authorizeToolClass,
  validateExecutionContext,
  type ExecutionContext,
  type ToolClass,
} from "@/lib/execution-context";
import { checkExecutionLease, type ExecutionLease } from "@/lib/execution-runtime";
import {
  ECONOMICS_RESERVATION_METADATA_KEY,
  OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION,
  assertCheaperRouteDoesNotWeakenAuthority,
  assertRedactedEconomicsTelemetry,
  commitReservation,
  evaluateAndReserve,
  releaseReservation,
  routeExecutorTier,
  type AuthorityFreeze,
  type BudgetDecision,
  type BudgetReservation,
  type CallerPricing,
  type EconomicsSession,
  type EscalationReason,
  type ExecutorTier,
  type GovernorResult,
  type ReservationCommit,
  type RoutingDecision,
  type UsageObservation,
} from "@/lib/outcome-economics-governor";

/**
 * Outcome Economics Governor adapter v1.
 *
 * Surrounds a real in-process model, tool, or executor call with
 * evaluateAndReserve / commit / release. It does not issue Outcome Receipts,
 * mark Workstream Runs verified, talk to a provider SDK, or create a second
 * budget, lease, planner, queue, evidence, receipt, or memory store.
 *
 * Reservations are process-local Maps. This is not global serverless
 * enforcement. Cross-request and off-box workers remain advisory unless a
 * durable authorized seam exists. Concurrent native prepares are not closed
 * by this slice. A future SQL seam requires separate authorization and
 * runtime verification.
 */

export const EXECUTION_ECONOMICS_ADAPTER_SCHEMA_VERSION = "execution-economics-adapter/v1" as const;

const HEX64 = /^[0-9a-f]{64}$/;
const ACTION_CLASS_RANK: Record<ActionClass, number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

export const NATIVE_PUBLIC_WEB_RESERVATION_TTL_MS = 120_000;

export const ZERO_CALLER_PRICING: CallerPricing = {
  currency: "USD",
  inputMicrosPerToken: 0,
  outputMicrosPerToken: 0,
  toolCallMicros: 0,
};

export type GovernedCallKind = "model" | "tool" | "executor_process";

export type FrozenAuthorityBinding = {
  specVersion: string;
  canonicalPlanHash: string | null;
  inputManifestContentHash: string | null;
  authority: AuthorityFreeze;
};

export type TrustedExecutionRuntimeState = {
  organizationId: string;
  tenantId: string;
  runId: string;
  executionAttemptId: string;
  assignmentId: string;
  capabilityKey: string;
  executorKey: string;
  workCellPhase: ExecutorEnvelopeV1["phase"];
  workCellPhaseAlreadyRecorded: boolean;
  attemptNumber: number;
  maxAttempts: number;
  deadlineAt: string;
  cancelled: boolean;
  lease: ExecutionLease | null;
  expectedLease: ExecutionLease | null;
  specVersion: string;
  canonicalPlanHash: string | null;
  inputManifestContentHash: string | null;
  evaluationClock: string;
};

export type NativePublicWebEconomicsBinding = {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  runtime: TrustedExecutionRuntimeState;
  frozenAuthority: FrozenAuthorityBinding;
  proposedAuthority: AuthorityFreeze;
  requestedTier: ExecutorTier;
  availableTiers: readonly ExecutorTier[];
  escalationReason: EscalationReason | null;
  pricing: CallerPricing;
  reservationTtlMs: number;
};

export type GovernedExecutionInput<T> = {
  session: EconomicsSession;
  context: ExecutionContext;
  envelope: ExecutorEnvelopeV1;
  expectedEnvelopeHash: string;
  runtime: TrustedExecutionRuntimeState;
  frozenAuthority: FrozenAuthorityBinding;
  proposedAuthority: AuthorityFreeze;
  requestedTier: ExecutorTier;
  availableTiers: readonly ExecutorTier[];
  escalationReason?: EscalationReason | null;
  callKind: GovernedCallKind;
  toolClass?: ToolClass;
  toolKeys: readonly string[];
  stepKey: string;
  estimatedAiCostMicros: number;
  estimatedToolCostMicros: number;
  estimatedCostMicros: number | null;
  unknownPricing?: boolean;
  usageUnavailable?: boolean;
  usageIncomplete?: boolean;
  streamTerminatedBeforeUsage?: boolean;
  pricing: CallerPricing;
  reservationExpiresAt: string;
  telemetry?: unknown;
  execute: () => Promise<T>;
  usageOnSuccess: (result: T) => UsageObservation;
};

export type GovernedExecutionSuccess<T> = {
  ok: true;
  executed: true;
  value: T;
  reservation: BudgetReservation;
  commit: ReservationCommit;
  routing: RoutingDecision;
  decision: "allow";
};

export type GovernedExecutionFailure = {
  ok: false;
  executed: boolean;
  failures: string[];
  decision: BudgetDecision | "reject";
  reservation: BudgetReservation | null;
};

export type GovernedExecutionResult<T> = GovernedExecutionSuccess<T> | GovernedExecutionFailure;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireTrimmedIdentifier(value: unknown, label: string, failures: string[]): string | null {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    failures.push(`${label} must be a non-empty trimmed identifier.`);
    return null;
  }
  return value;
}

function requireHex64(value: unknown, label: string, failures: string[]): string | null {
  const identifier = requireTrimmedIdentifier(value, label, failures);
  if (!identifier) return null;
  if (!HEX64.test(identifier)) {
    failures.push(`${label} must be a 64-character lowercase hex digest.`);
    return null;
  }
  return identifier;
}

function optionalHex64(value: unknown, label: string, failures: string[]): string | null {
  if (value === null || value === undefined) return null;
  return requireHex64(value, label, failures);
}

function isAbortTimeoutOrCancel(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return /timeout|timed out|aborted|cancell?ed/i.test(error.message);
}

function canonicalFrozenAuthorityBinding(binding: FrozenAuthorityBinding): string {
  return canonicalJsonStringify({
    specVersion: binding.specVersion,
    canonicalPlanHash: binding.canonicalPlanHash,
    inputManifestContentHash: binding.inputManifestContentHash,
    authority: {
      actionClass: binding.authority.actionClass,
      requiresHumanApproval: binding.authority.requiresHumanApproval,
      mayOwnAuthoritativeState: binding.authority.mayOwnAuthoritativeState,
      independentReviewRequired: binding.authority.independentReviewRequired,
      requiredArtifactSchemaVersions: [...binding.authority.requiredArtifactSchemaVersions].sort(),
    },
  });
}

export function workCellPhaseAlreadyRecordedFromAssignment(
  assignment: { status?: string } | null | undefined,
): boolean {
  return assignment != null;
}

export function assertExecutorEnvelopeIntegrity(input: {
  envelope: unknown;
  expectedEnvelopeHash: unknown;
}): GovernorResult<ExecutorEnvelopeV1> {
  const failures: string[] = [];
  const expectedHash = requireHex64(input.expectedEnvelopeHash, "expectedEnvelopeHash", failures);
  if (!expectedHash) {
    return {
      ok: false,
      failures: failures.length
        ? failures
        : ["Governed execution cannot obtain a trusted expected Executor Envelope hash."],
    };
  }
  const envelopeCheck = validateExecutorEnvelope(input.envelope);
  if (!envelopeCheck.ok) return envelopeCheck;
  const observedHash = hashExecutorEnvelope(envelopeCheck.value);
  if (observedHash !== expectedHash) {
    return {
      ok: false,
      failures: [
        "Executor Envelope hash does not match the trusted expected envelope hash. Mutated envelope fields cannot execute.",
      ],
    };
  }
  return { ok: true, value: envelopeCheck.value };
}

function assertTrustedLeaseBinding(input: {
  presented: ExecutionLease | null;
  expected: ExecutionLease | null;
  evaluationClock: string;
  executionAttemptId: string;
}): GovernorResult<true> {
  const { presented, expected } = input;
  if (!presented && !expected) return { ok: true, value: true };
  if (presented && !expected) {
    return {
      ok: false,
      failures: [
        "Non-null lease requires a trusted expected lease from claimed-attempt persistence. TrustedExecutionRuntimeState is not a source of lease trust.",
      ],
    };
  }
  if (!presented && expected) {
    return {
      ok: false,
      failures: ["Trusted expected lease is present but no presented lease credentials were supplied."],
    };
  }
  if (!presented || !expected) {
    return { ok: false, failures: ["Lease binding is incomplete."] };
  }
  if (presented.attemptId !== input.executionAttemptId) {
    return { ok: false, failures: ["Live lease attempt does not match the trusted execution attempt."] };
  }
  const lease = checkExecutionLease(expected, presented, input.evaluationClock);
  if (!lease.ok) {
    return { ok: false, failures: [`Live lease failed closed (${lease.reason}).`] };
  }
  return { ok: true, value: true };
}

function authorizeGovernedToolClass(input: {
  context: ExecutionContext;
  callKind: GovernedCallKind;
  toolClass: ToolClass | undefined;
}): GovernorResult<true> {
  if (input.callKind === "model") return { ok: true, value: true };
  if (input.callKind === "executor_process" && input.toolClass === undefined) {
    return {
      ok: false,
      failures: [
        "executor_process is not authorized by economics presence alone. Bind an explicit authorized tool class from execution-context or reject the unsupported combination.",
      ],
    };
  }
  if (input.callKind === "tool" && input.toolClass === undefined) {
    return {
      ok: false,
      failures: [
        "Tool execution requires an explicit ToolClass. toolKeys are not tool classes and cannot authorize work.",
      ],
    };
  }
  if (input.toolClass === undefined) {
    return { ok: false, failures: ["Governed tool work requires an explicit authorized tool class."] };
  }
  const authorized = authorizeToolClass(input.context, input.toolClass);
  if (!authorized.ok) return authorized;
  return { ok: true, value: true };
}

export function bindFrozenAuthorityFromTrustedContracts(input: {
  context: ExecutionContext;
  envelope: ExecutorEnvelopeV1;
  canonicalPlanHash?: string | null;
  inputManifestContentHash?: string | null;
}): GovernorResult<FrozenAuthorityBinding> {
  const failures: string[] = [];
  const spec = input.context.delegationSpecSnapshot;
  if (spec.mayOwnAuthoritativeState !== false) {
    failures.push("Frozen Delegation Spec cannot grant authoritative state ownership.");
  }
  if (input.envelope.authoritySnapshot.mayOwnAuthoritativeState !== false) {
    failures.push("Frozen Executor Envelope cannot grant authoritative state ownership.");
  }
  if (ACTION_CLASS_RANK[input.envelope.authoritySnapshot.actionClass] > ACTION_CLASS_RANK[spec.actionClass]) {
    failures.push("Frozen envelope action class cannot exceed the Delegation Spec ceiling.");
  }
  const canonicalPlanHash = optionalHex64(input.canonicalPlanHash ?? null, "canonicalPlanHash", failures);
  const inputManifestContentHash = optionalHex64(
    input.inputManifestContentHash ?? null,
    "inputManifestContentHash",
    failures,
  );
  if (!canonicalPlanHash && !inputManifestContentHash) {
    failures.push("Frozen authority requires a trusted canonical plan hash or a trusted input-manifest content hash.");
  }
  const specVersion = requireTrimmedIdentifier(spec.specVersion, "specVersion", failures);
  if (failures.length || !specVersion) return { ok: false, failures };
  return {
    ok: true,
    value: {
      specVersion,
      canonicalPlanHash,
      inputManifestContentHash,
      authority: {
        actionClass: spec.actionClass,
        requiresHumanApproval: spec.requiresHumanApproval,
        mayOwnAuthoritativeState: false,
        independentReviewRequired: input.envelope.evidenceRequirements.independentReviewRequired,
        requiredArtifactSchemaVersions: [...input.envelope.evidenceRequirements.requiredArtifactSchemaVersions],
      },
    },
  };
}

export function buildExecutionLimitsFromTrustedState(
  context: ExecutionContext,
  runtime: TrustedExecutionRuntimeState,
): GovernorResult<{
  attemptNumber: number;
  maxAttempts: number;
  deadlineAt: string;
  workCellPhaseAlreadyRecorded: boolean;
}> {
  const failures: string[] = [];
  const nowMs = Date.parse(runtime.evaluationClock);
  if (!Number.isFinite(nowMs)) {
    return { ok: false, failures: ["Trusted evaluation clock is not a valid timestamp."] };
  }
  const createdAtMs = Date.parse(context.assignmentSnapshot.createdAt);
  const assignmentDeadlineMs = Date.parse(context.assignmentSnapshot.deadline);
  if (
    Number.isFinite(createdAtMs) &&
    Number.isFinite(assignmentDeadlineMs) &&
    assignmentDeadlineMs > createdAtMs &&
    assignmentDeadlineMs <= nowMs
  ) {
    failures.push("Expired Execution Context deadline blocked execution.");
  }
  if (runtime.cancelled) {
    failures.push("Cancelled execution cannot reserve or run.");
  }
  if (failures.length) return { ok: false, failures };
  return {
    ok: true,
    value: {
      attemptNumber: runtime.attemptNumber,
      maxAttempts: runtime.maxAttempts,
      deadlineAt: runtime.deadlineAt,
      workCellPhaseAlreadyRecorded: runtime.workCellPhaseAlreadyRecorded,
    },
  };
}

export function assertTrustedIdentityMatch(input: {
  context: ExecutionContext;
  envelope: ExecutorEnvelopeV1;
  runtime: TrustedExecutionRuntimeState;
  frozenAuthority: FrozenAuthorityBinding;
  session: EconomicsSession;
}): GovernorResult<true> {
  const { context, envelope, runtime, frozenAuthority, session } = input;
  const failures: string[] = [];
  if (session.organizationId !== runtime.organizationId) {
    failures.push("Economics session organization does not match trusted runtime organization.");
  }
  if (session.tenantId !== runtime.tenantId) {
    failures.push("Economics session tenant does not match trusted runtime tenant.");
  }
  if (context.runId !== runtime.runId || envelope.runId !== runtime.runId) {
    failures.push("Run identity does not match trusted Execution Context and envelope.");
  }
  if (context.assignmentId !== runtime.assignmentId || envelope.assignmentId !== runtime.assignmentId) {
    failures.push("Assignment identity does not match trusted Execution Context and envelope.");
  }
  if (
    context.assignmentSnapshot.capabilityKey !== runtime.capabilityKey ||
    envelope.capabilityKey !== runtime.capabilityKey
  ) {
    failures.push("Capability identity does not match trusted Execution Context and envelope.");
  }
  if (
    context.assignmentSnapshot.executorKey !== runtime.executorKey ||
    envelope.executorConfigurationSnapshot.executorKey !== runtime.executorKey
  ) {
    failures.push("Executor identity does not match trusted Execution Context and envelope.");
  }
  if (envelope.phase !== runtime.workCellPhase) {
    failures.push("Work-cell phase does not match the frozen Executor Envelope.");
  }
  if (frozenAuthority.specVersion !== runtime.specVersion || frozenAuthority.specVersion !== context.delegationSpecSnapshot.specVersion) {
    failures.push("Frozen authority is not bound to the trusted Delegation Spec version.");
  }
  if (frozenAuthority.canonicalPlanHash !== runtime.canonicalPlanHash) {
    failures.push("Frozen authority is not bound to the trusted canonical plan hash.");
  }
  if (frozenAuthority.inputManifestContentHash !== runtime.inputManifestContentHash) {
    failures.push("Frozen authority is not bound to the trusted input-manifest content hash.");
  }
  if (!runtime.canonicalPlanHash && !runtime.inputManifestContentHash) {
    failures.push("Trusted runtime must bind a canonical plan hash or an input-manifest content hash.");
  }
  if (frozenAuthority.authority.mayOwnAuthoritativeState !== false) {
    failures.push("Frozen authority cannot declare executor-owned authoritative state.");
  }
  const lease = assertTrustedLeaseBinding({
    presented: runtime.lease,
    expected: runtime.expectedLease,
    evaluationClock: runtime.evaluationClock,
    executionAttemptId: runtime.executionAttemptId,
  });
  if (!lease.ok) failures.push(...lease.failures);
  return failures.length ? { ok: false, failures } : { ok: true, value: true };
}

export function deriveGovernedIdempotencyKey(input: {
  organizationId: string;
  tenantId: string;
  runId: string;
  executionAttemptId: string;
  assignmentId: string;
  specVersion: string;
  canonicalPlanHash: string | null;
  inputManifestContentHash: string | null;
  callKind: GovernedCallKind;
  stepKey: string;
}): string {
  return sha256Hex({
    schemaVersion: "execution-economics-idempotency/v1",
    ...input,
  });
}

export function attachEconomicsReservationMetadata(
  metadata: Record<string, unknown> | undefined,
  reservationId: string,
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  next[ECONOMICS_RESERVATION_METADATA_KEY] = reservationId;
  const redacted = assertRedactedEconomicsTelemetry(next, "completionMetadata");
  if (!redacted.ok) {
    throw new DomainError(redacted.failures.join(" "));
  }
  return next;
}

export function assertSuccessfulCompletionMayProceed(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  executionAttemptId: string;
  reservationId?: string | null;
}): GovernorResult<true> {
  const failures: string[] = [];
  if (input.session.organizationId !== input.organizationId) {
    failures.push("Completion organization does not match the economics session.");
  }
  if (input.session.tenantId !== input.tenantId) {
    failures.push("Completion tenant does not match the economics session.");
  }
  if (failures.length) return { ok: false, failures };

  for (const reservation of input.session.reservations.values()) {
    if (reservation.executionAttemptId !== input.executionAttemptId) continue;
    if (reservation.organizationId !== input.organizationId || reservation.tenantId !== input.tenantId) {
      return { ok: false, failures: ["Reservation tenant, run, or attempt identity is mismatched."] };
    }
    if (reservation.state === "reserved") {
      return {
        ok: false,
        failures: ["Successful completion cannot occur while an economic reservation remains reserved."],
      };
    }
  }

  if (input.reservationId) {
    const reservation = input.session.reservations.get(input.reservationId);
    if (!reservation) return { ok: false, failures: ["Completion reservation was not found in this process."] };
    if (reservation.executionAttemptId !== input.executionAttemptId) {
      return { ok: false, failures: ["Completion reservation does not match the trusted execution attempt."] };
    }
    if (reservation.state !== "committed") {
      return {
        ok: false,
        failures: ["Successful completion cannot occur while an economic reservation remains reserved."],
      };
    }
  }

  return { ok: true, value: true };
}

function releaseSafely(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  reservation: BudgetReservation | null;
  now: string;
}): void {
  if (!input.reservation || input.reservation.state !== "reserved") return;
  releaseReservation({
    session: input.session,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    reservationId: input.reservation.reservationId,
    idempotencyKey: input.reservation.idempotencyKey,
    now: input.now,
  });
}

export function releaseAttemptBoundReservation(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  reservationId: string;
  attemptId: string;
  now: string;
}): GovernorResult<{ reservationId: string; releasedAt: string }> {
  const failures: string[] = [];
  if (input.session.organizationId !== input.organizationId) {
    failures.push("Economics session organization does not match the reservation release organization.");
  }
  if (input.session.tenantId !== input.tenantId) {
    failures.push("Economics session tenant does not match the reservation release tenant.");
  }
  if (failures.length) return { ok: false, failures };

  const reservation = input.session.reservations.get(input.reservationId);
  if (!reservation) {
    return { ok: false, failures: ["Reservation was not found."] };
  }
  if (reservation.organizationId !== input.organizationId || reservation.tenantId !== input.tenantId) {
    return { ok: false, failures: ["Reservation tenant does not match the economics session."] };
  }
  if (reservation.executionAttemptId !== input.attemptId) {
    return {
      ok: false,
      failures: ["Reservation execution attempt does not match the failing attempt; release was not applied."],
    };
  }
  return releaseReservation({
    session: input.session,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    reservationId: input.reservationId,
    idempotencyKey: reservation.idempotencyKey,
    now: input.now,
  });
}

export async function runGovernedExecution<T>(
  input: GovernedExecutionInput<T>,
): Promise<GovernedExecutionResult<T>> {
  const contextCheck = validateExecutionContext(input.context);
  if (!contextCheck.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: contextCheck.failures };
  }
  const envelopeCheck = assertExecutorEnvelopeIntegrity({
    envelope: input.envelope,
    expectedEnvelopeHash: input.expectedEnvelopeHash,
  });
  if (!envelopeCheck.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: envelopeCheck.failures };
  }
  const toolAuthorization = authorizeGovernedToolClass({
    context: contextCheck.value,
    callKind: input.callKind,
    toolClass: input.toolClass,
  });
  if (!toolAuthorization.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: toolAuthorization.failures };
  }
  const derivedFrozen = bindFrozenAuthorityFromTrustedContracts({
    context: contextCheck.value,
    envelope: envelopeCheck.value,
    canonicalPlanHash: input.runtime.canonicalPlanHash,
    inputManifestContentHash: input.runtime.inputManifestContentHash,
  });
  if (!derivedFrozen.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: derivedFrozen.failures };
  }
  if (canonicalFrozenAuthorityBinding(input.frozenAuthority) !== canonicalFrozenAuthorityBinding(derivedFrozen.value)) {
    return {
      ok: false,
      executed: false,
      decision: "reject",
      reservation: null,
      failures: ["Caller-supplied frozen authority does not match authority re-derived from trusted contracts."],
    };
  }
  const identity = assertTrustedIdentityMatch({
    context: contextCheck.value,
    envelope: envelopeCheck.value,
    runtime: input.runtime,
    frozenAuthority: derivedFrozen.value,
    session: input.session,
  });
  if (!identity.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: identity.failures };
  }
  const limits = buildExecutionLimitsFromTrustedState(contextCheck.value, input.runtime);
  if (!limits.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: limits.failures };
  }
  const cheaper = assertCheaperRouteDoesNotWeakenAuthority({
    frozen: derivedFrozen.value.authority,
    proposed: input.proposedAuthority,
  });
  if (!cheaper.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: cheaper.failures };
  }

  const routing = routeExecutorTier({
    availableTiers: input.availableTiers,
    requestedTier: input.requestedTier,
    escalationReason: input.escalationReason ?? null,
  });
  if (!routing.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: routing.failures };
  }

  const idempotencyKey = deriveGovernedIdempotencyKey({
    organizationId: input.runtime.organizationId,
    tenantId: input.runtime.tenantId,
    runId: input.runtime.runId,
    executionAttemptId: input.runtime.executionAttemptId,
    assignmentId: input.runtime.assignmentId,
    specVersion: derivedFrozen.value.specVersion,
    canonicalPlanHash: derivedFrozen.value.canonicalPlanHash,
    inputManifestContentHash: derivedFrozen.value.inputManifestContentHash,
    callKind: input.callKind,
    stepKey: input.stepKey,
  });

  const reserved = evaluateAndReserve({
    session: input.session,
    organizationId: input.runtime.organizationId,
    tenantId: input.runtime.tenantId,
    runId: input.runtime.runId,
    executionAttemptId: input.runtime.executionAttemptId,
    assignmentId: input.runtime.assignmentId,
    capabilityKey: input.runtime.capabilityKey,
    executorKey: input.runtime.executorKey,
    executorTier: routing.value.selectedTier,
    toolKeys: input.toolKeys,
    stepKey: input.stepKey,
    estimatedAiCostMicros: input.estimatedAiCostMicros,
    estimatedToolCostMicros: input.estimatedToolCostMicros,
    estimatedCostMicros: input.estimatedCostMicros,
    unknownPricing: input.unknownPricing ?? false,
    usageUnavailable: input.usageUnavailable ?? false,
    usageIncomplete: input.usageIncomplete,
    streamTerminatedBeforeUsage: input.streamTerminatedBeforeUsage,
    pricing: input.pricing,
    executionLimits: limits.value,
    frozenAuthority: derivedFrozen.value.authority,
    proposedAuthority: input.proposedAuthority,
    idempotencyKey,
    now: input.runtime.evaluationClock,
    expiresAt: input.reservationExpiresAt,
    routing: routing.value,
    telemetry: input.telemetry,
  });
  if (!reserved.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: reserved.failures };
  }
  if (reserved.value.decision !== "allow" || !reserved.value.reservation) {
    return {
      ok: false,
      executed: false,
      decision: reserved.value.decision,
      reservation: reserved.value.reservation,
      failures: [
        reserved.value.decision === "hold"
          ? "Held reservation prevented the underlying call."
          : reserved.value.decision === "downgrade"
            ? "Downgrade decision prevented the underlying call until a cheaper eligible route is selected."
            : "Reservation was not allowed; the underlying call was not started.",
      ],
    };
  }

  const reservation = reserved.value.reservation;
  let result: T;
  try {
    result = await input.execute();
  } catch (error) {
    releaseSafely({
      session: input.session,
      organizationId: input.runtime.organizationId,
      tenantId: input.runtime.tenantId,
      reservation,
      now: input.runtime.evaluationClock,
    });
    const reason = error instanceof Error ? error.message : "underlying call failed";
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: input.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: [
        isAbortTimeoutOrCancel(error)
          ? `Underlying call aborted, timed out, or cancelled: ${reason}`
          : `Underlying call failed: ${reason}`,
      ],
    };
  }

  let observation: UsageObservation;
  try {
    observation = input.usageOnSuccess(result);
  } catch (error) {
    releaseSafely({
      session: input.session,
      organizationId: input.runtime.organizationId,
      tenantId: input.runtime.tenantId,
      reservation,
      now: input.runtime.evaluationClock,
    });
    const reason = error instanceof Error ? error.message : "usage observation failed";
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: input.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: [`Provider usage could not be observed: ${reason}`],
    };
  }

  const committed = commitReservation({
    session: input.session,
    organizationId: input.runtime.organizationId,
    tenantId: input.runtime.tenantId,
    reservationId: reservation.reservationId,
    idempotencyKey,
    observation,
    pricing: input.pricing,
    now: input.runtime.evaluationClock,
    telemetry: input.telemetry,
  });
  if (!committed.ok) {
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: input.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: committed.failures,
    };
  }

  const completion = assertSuccessfulCompletionMayProceed({
    session: input.session,
    organizationId: input.runtime.organizationId,
    tenantId: input.runtime.tenantId,
    executionAttemptId: input.runtime.executionAttemptId,
    reservationId: reservation.reservationId,
  });
  if (!completion.ok) {
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: input.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: completion.failures,
    };
  }

  return {
    ok: true,
    executed: true,
    value: result,
    reservation: input.session.reservations.get(reservation.reservationId) ?? reservation,
    commit: committed.value,
    routing: routing.value,
    decision: "allow",
  };
}

export function bindNativePublicWebEconomics(input: {
  session: EconomicsSession;
  binding: {
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
    context: ExecutionContext;
    envelope: ExecutorEnvelopeV1;
  };
  organizationId: string;
  tenantId: string;
  now: string;
  inputManifestContentHash: string;
  deadlineAt: string;
  executionAttemptId?: string;
  attemptNumber?: number;
  maxAttempts?: number;
  cancelled?: boolean;
  workCellPhaseAlreadyRecorded?: boolean;
  lease?: ExecutionLease | null;
  proposedAuthority?: AuthorityFreeze;
  requestedTier?: ExecutorTier;
  availableTiers?: readonly ExecutorTier[];
  escalationReason?: EscalationReason | null;
  pricing?: CallerPricing;
  reservationTtlMs?: number;
}): GovernorResult<NativePublicWebEconomicsBinding> {
  const contextCheck = validateExecutionContext(input.binding.context);
  if (!contextCheck.ok) return contextCheck;
  if (
    contextCheck.value.contextHash !== input.binding.contextHash ||
    input.binding.contextHash !== input.binding.context.contextHash ||
    input.binding.assignmentId !== contextCheck.value.assignmentId
  ) {
    return { ok: false, failures: ["Native economics binding context hashes do not match."] };
  }
  const envelopeCheck = assertExecutorEnvelopeIntegrity({
    envelope: input.binding.envelope,
    expectedEnvelopeHash: input.binding.envelopeHash,
  });
  if (!envelopeCheck.ok) return envelopeCheck;
  if (input.lease) {
    return {
      ok: false,
      failures: [
        "Native public-web prepare does not accept a presented lease. Native economics keep lease null rather than treating caller-created lease objects as trusted.",
      ],
    };
  }
  const frozen = bindFrozenAuthorityFromTrustedContracts({
    context: contextCheck.value,
    envelope: envelopeCheck.value,
    canonicalPlanHash: null,
    inputManifestContentHash: input.inputManifestContentHash,
  });
  if (!frozen.ok) return frozen;
  const runtime: TrustedExecutionRuntimeState = {
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    runId: contextCheck.value.runId,
    executionAttemptId: input.executionAttemptId ?? `native-prepare:${input.binding.assignmentId}`,
    assignmentId: input.binding.assignmentId,
    capabilityKey: contextCheck.value.assignmentSnapshot.capabilityKey,
    executorKey: contextCheck.value.assignmentSnapshot.executorKey,
    workCellPhase: envelopeCheck.value.phase,
    workCellPhaseAlreadyRecorded: input.workCellPhaseAlreadyRecorded ?? false,
    attemptNumber: input.attemptNumber ?? 1,
    maxAttempts: input.maxAttempts ?? 1,
    deadlineAt: input.deadlineAt,
    cancelled: input.cancelled ?? false,
    lease: null,
    expectedLease: null,
    specVersion: frozen.value.specVersion,
    canonicalPlanHash: null,
    inputManifestContentHash: frozen.value.inputManifestContentHash,
    evaluationClock: input.now,
  };
  const identity = assertTrustedIdentityMatch({
    context: contextCheck.value,
    envelope: envelopeCheck.value,
    runtime,
    frozenAuthority: frozen.value,
    session: input.session,
  });
  if (!identity.ok) return identity;
  return {
    ok: true,
    value: {
      session: input.session,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      runtime,
      frozenAuthority: frozen.value,
      proposedAuthority: input.proposedAuthority ?? frozen.value.authority,
      requestedTier: input.requestedTier ?? "deterministic",
      availableTiers: input.availableTiers ?? ["deterministic"],
      escalationReason: input.escalationReason ?? null,
      pricing: input.pricing ?? ZERO_CALLER_PRICING,
      reservationTtlMs: input.reservationTtlMs ?? NATIVE_PUBLIC_WEB_RESERVATION_TTL_MS,
    },
  };
}

export function reportedToolUsage(input: {
  runtime: TrustedExecutionRuntimeState;
  executorTier: ExecutorTier;
  toolKeys: readonly string[];
  stepKey: string;
  idempotencyKey: string;
  toolCallCount: number;
  recordedAt: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  reasoningTokens?: number | null;
  cacheTokens?: number | null;
  retryCount?: number;
  latencyMs?: number;
  usageStatus?: UsageObservation["usageStatus"];
}): UsageObservation {
  const inputTokens = input.inputTokens ?? null;
  const outputTokens = input.outputTokens ?? null;
  const totalTokens =
    input.totalTokens !== undefined
      ? input.totalTokens
      : typeof inputTokens === "number" && typeof outputTokens === "number"
        ? inputTokens + outputTokens
        : null;
  return {
    schemaVersion: OUTCOME_ECONOMICS_GOVERNOR_SCHEMA_VERSION,
    organizationId: input.runtime.organizationId,
    tenantId: input.runtime.tenantId,
    runId: input.runtime.runId,
    executionAttemptId: input.runtime.executionAttemptId,
    assignmentId: input.runtime.assignmentId,
    capabilityKey: input.runtime.capabilityKey,
    executorKey: input.runtime.executorKey,
    executorTier: input.executorTier,
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens: input.reasoningTokens ?? null,
    cacheTokens: input.cacheTokens ?? null,
    toolCallCount: input.toolCallCount,
    retryCount: input.retryCount ?? 0,
    latencyMs: input.latencyMs ?? 0,
    usageStatus: input.usageStatus ?? "reported",
    recordedAt: input.recordedAt,
    toolKeys: input.toolKeys,
    stepKey: input.stepKey,
    idempotencyKey: input.idempotencyKey,
  };
}

export function reservationExpiresAt(now: string, ttlMs: number): string {
  return new Date(Date.parse(now) + ttlMs).toISOString();
}

export function isRecordedReservationState(
  session: EconomicsSession,
  reservationId: string,
): BudgetReservation["state"] | null {
  return session.reservations.get(reservationId)?.state ?? null;
}

export function findAttemptReservations(session: EconomicsSession, executionAttemptId: string): BudgetReservation[] {
  return [...session.reservations.values()].filter((reservation) => reservation.executionAttemptId === executionAttemptId);
}

export function economicsFailures(result: { failures: string[] }): string {
  return result.failures.join(" ");
}

export function requireEconomicsEnvelope(value: unknown): unknown {
  return isObject(value) ? value : {};
}

export function isReleasedUnderlyingCallFailure(result: GovernedExecutionFailure): boolean {
  return (
    result.executed === true &&
    result.reservation?.state === "released" &&
    result.failures.some((failure) => /Underlying call (failed|aborted)/.test(failure))
  );
}
