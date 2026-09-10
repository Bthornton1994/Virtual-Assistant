/**
 * Process-local governed-binding mint and persistence-backed projection seal.
 *
 * This module is the trusted internal-caller boundary for economics bindings.
 * A module-private Symbol (not Symbol.for) plus a WeakSet records objects
 * minted here after a work-cell loader or an explicit test double.
 *
 * This is NOT cryptographic authenticity, not a SQL proof, not a Postgres
 * transaction, and not a global Map. HTTP routes must not import this file.
 * Production callers are work-cell.ts (after loadRun / getProfile /
 * requireInputManifest / bindWorkCellPhase) and adapter tests that name the
 * test double explicitly.
 */

import {
  assignmentToEnvelope,
  executionStepAssignmentToEnvelope,
} from "@/lib/assignment-to-envelope";
import {
  assertExecutorEnvelopeIntegrity,
  assertTrustedIdentityMatch,
  bindFrozenAuthorityFromTrustedContracts,
  NATIVE_PUBLIC_WEB_RESERVATION_TTL_MS,
  ZERO_CALLER_PRICING,
  type NativePublicWebEconomicsBinding,
  type TrustedGovernedBinding,
  type TrustedGovernedBindingSource,
  type TrustedExecutionRuntimeState,
} from "@/lib/execution-economics-adapter";
import { validateExecutionContext, type ExecutionContext } from "@/lib/execution-context";
import type { ExecutorEnvelopeV1 } from "@/lib/executor-envelope";
import type { AuthorityFreeze, CallerPricing, EconomicsSession, EscalationReason, ExecutorTier, GovernorResult } from "@/lib/outcome-economics-governor";
import type { ExecutionLease } from "@/lib/execution-runtime";

const TRUSTED_GOVERNED_BINDING = Symbol("delegation-cloud.trusted-governed-binding");
const PERSISTED_WORK_CELL_PROJECTION = Symbol("delegation-cloud.persisted-work-cell-projection");

const mintedTrustedGovernedBindings = new WeakSet<object>();
const sealedPersistedWorkCellProjections = new WeakSet<object>();

export type PersistedWorkCellProjection = {
  assignmentId: string;
  envelopeHash: string;
  contextHash: string;
  context: ExecutionContext;
  envelope: ExecutorEnvelopeV1;
  inputManifestContentHash: string;
};

function sealTrustedGovernedBinding(binding: TrustedGovernedBinding): TrustedGovernedBinding {
  Object.defineProperty(binding, TRUSTED_GOVERNED_BINDING, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  mintedTrustedGovernedBindings.add(binding);
  return binding;
}

function isTrustedGovernedBinding(value: object): value is TrustedGovernedBinding {
  return (
    mintedTrustedGovernedBindings.has(value) &&
    TRUSTED_GOVERNED_BINDING in value &&
    "session" in value &&
    "organizationId" in value &&
    "tenantId" in value &&
    "context" in value &&
    "envelope" in value &&
    "envelopeHash" in value &&
    "contextHash" in value &&
    "runtime" in value &&
    "frozenAuthority" in value &&
    "proposedAuthority" in value &&
    "requestedTier" in value &&
    "availableTiers" in value &&
    "pricing" in value &&
    "reservationTtlMs" in value
  );
}

function isPersistedWorkCellProjection(value: object): value is PersistedWorkCellProjection {
  return (
    sealedPersistedWorkCellProjections.has(value) &&
    PERSISTED_WORK_CELL_PROJECTION in value &&
    "assignmentId" in value &&
    "envelopeHash" in value &&
    "contextHash" in value &&
    "context" in value &&
    "envelope" in value &&
    "inputManifestContentHash" in value
  );
}

export function requireMintedTrustedGovernedBinding(value: unknown): GovernorResult<TrustedGovernedBinding> {
  if (!value || typeof value !== "object" || !isTrustedGovernedBinding(value)) {
    return {
      ok: false,
      failures: [
        "Governed execution requires a factory-minted trusted binding from a persistence-backed loader. Hash equality is not authenticity.",
      ],
    };
  }
  return { ok: true, value };
}

function requirePersistedWorkCellProjection(value: unknown): GovernorResult<PersistedWorkCellProjection> {
  if (!value || typeof value !== "object" || !isPersistedWorkCellProjection(value)) {
    return {
      ok: false,
      failures: [
        "Native public-web economics require a persistence-backed work-cell projection. Caller-built assignment, spec, and hash tuples are not a loader. Hash equality is not authenticity.",
      ],
    };
  }
  return { ok: true, value };
}

function sealPersistedWorkCellProjection(projection: PersistedWorkCellProjection): PersistedWorkCellProjection {
  Object.defineProperty(projection, PERSISTED_WORK_CELL_PROJECTION, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  sealedPersistedWorkCellProjections.add(projection);
  return projection;
}

/**
 * Seals a projection after work-cell persistence reads succeed.
 * Process-local loader mint only; not cryptographic authenticity.
 */
export function sealPersistedWorkCellProjectionFromWorkCellLoader(
  binding: {
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
    context: ExecutionContext;
    envelope: ExecutorEnvelopeV1;
  },
  inputManifestContentHash: string,
): PersistedWorkCellProjection {
  return sealPersistedWorkCellProjection({
    assignmentId: binding.assignmentId,
    envelopeHash: binding.envelopeHash,
    contextHash: binding.contextHash,
    context: binding.context,
    envelope: binding.envelope,
    inputManifestContentHash,
  });
}

/**
 * Explicit test double for native-path tests. Not a production public API.
 * Routes must not import this. It is still only process-local loader mint.
 */
export function createPersistedWorkCellProjectionForTests(
  binding: {
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
    context: ExecutionContext;
    envelope: ExecutorEnvelopeV1;
  },
  inputManifestContentHash: string,
): PersistedWorkCellProjection {
  return sealPersistedWorkCellProjectionFromWorkCellLoader(binding, inputManifestContentHash);
}

function sealFromValidatedProjection(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  now: string;
  deadlineAt: string;
  binding: {
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
    context: ExecutionContext;
    envelope: ExecutorEnvelopeV1;
  };
  inputManifestContentHash: string | null;
  canonicalPlanHash: string | null;
  executionAttemptId?: string;
  attemptNumber?: number;
  maxAttempts?: number;
  cancelled?: boolean;
  workCellPhaseAlreadyRecorded?: boolean;
  lease?: ExecutionLease | null;
  expectedLease?: ExecutionLease | null;
  proposedAuthority?: AuthorityFreeze;
  requestedTier?: ExecutorTier;
  availableTiers?: readonly ExecutorTier[];
  escalationReason?: EscalationReason | null;
  pricing?: CallerPricing;
  reservationTtlMs?: number;
}): GovernorResult<TrustedGovernedBinding> {
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
  const frozen = bindFrozenAuthorityFromTrustedContracts({
    context: contextCheck.value,
    envelope: envelopeCheck.value,
    canonicalPlanHash: input.canonicalPlanHash,
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
    lease: input.lease ?? null,
    expectedLease: input.expectedLease ?? null,
    specVersion: frozen.value.specVersion,
    canonicalPlanHash: frozen.value.canonicalPlanHash,
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
    value: sealTrustedGovernedBinding({
      session: input.session,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      context: contextCheck.value,
      envelope: envelopeCheck.value,
      envelopeHash: input.binding.envelopeHash,
      contextHash: input.binding.contextHash,
      runtime,
      frozenAuthority: frozen.value,
      proposedAuthority: input.proposedAuthority ?? frozen.value.authority,
      requestedTier: input.requestedTier ?? "deterministic",
      availableTiers: input.availableTiers ?? ["deterministic"],
      escalationReason: input.escalationReason ?? null,
      pricing: input.pricing ?? ZERO_CALLER_PRICING,
      reservationTtlMs: input.reservationTtlMs ?? NATIVE_PUBLIC_WEB_RESERVATION_TTL_MS,
    }),
  };
}

/**
 * Internal mint used by persistence-backed loaders and by adapter unit tests
 * that import this file explicitly as an internal test of the loader.
 * Not re-exported from execution-economics-adapter.ts.
 */
export function mintTrustedGovernedBinding(input: TrustedGovernedBindingSource): GovernorResult<TrustedGovernedBinding> {
  const translated =
    input.identityKind === "execution_step_assignment"
      ? executionStepAssignmentToEnvelope(input.assignment, input.spec, input.inputArtifactRefs)
      : assignmentToEnvelope(input.assignment, input.spec, input.inputArtifactRefs);
  if (!translated.ok) return translated;
  if (input.identityKind !== "execution_step_assignment" && input.lease) {
    return {
      ok: false,
      failures: [
        "Native public-web prepare does not accept a presented lease. Native economics keep lease null rather than treating caller-created lease objects as trusted.",
      ],
    };
  }
  return sealFromValidatedProjection({
    session: input.session,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    now: input.now,
    deadlineAt: input.deadlineAt,
    binding: translated.value,
    inputManifestContentHash:
      "inputManifestContentHash" in input.assignment && typeof input.assignment.inputManifestContentHash === "string"
        ? input.assignment.inputManifestContentHash
        : null,
    canonicalPlanHash:
      "planHash" in input.assignment && typeof input.assignment.planHash === "string" ? input.assignment.planHash : null,
    executionAttemptId: input.executionAttemptId,
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    cancelled: input.cancelled,
    workCellPhaseAlreadyRecorded: input.workCellPhaseAlreadyRecorded,
    lease: input.lease ?? null,
    expectedLease: input.expectedLease ?? null,
    proposedAuthority: input.proposedAuthority,
    requestedTier: input.requestedTier,
    availableTiers: input.availableTiers,
    escalationReason: input.escalationReason,
    pricing: input.pricing,
    reservationTtlMs: input.reservationTtlMs,
  });
}

export function bindNativePublicWebEconomics(input: {
  session: EconomicsSession;
  projection: PersistedWorkCellProjection;
  organizationId: string;
  tenantId: string;
  now: string;
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
  const projection = requirePersistedWorkCellProjection(input.projection);
  if (!projection.ok) return projection;
  if (input.lease) {
    return {
      ok: false,
      failures: [
        "Native public-web prepare does not accept a presented lease. Native economics keep lease null rather than treating caller-created lease objects as trusted.",
      ],
    };
  }
  return sealFromValidatedProjection({
    session: input.session,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    now: input.now,
    deadlineAt: input.deadlineAt,
    binding: projection.value,
    inputManifestContentHash: projection.value.inputManifestContentHash,
    canonicalPlanHash: null,
    executionAttemptId: input.executionAttemptId,
    attemptNumber: input.attemptNumber,
    maxAttempts: input.maxAttempts,
    cancelled: input.cancelled,
    workCellPhaseAlreadyRecorded: input.workCellPhaseAlreadyRecorded,
    lease: null,
    expectedLease: null,
    proposedAuthority: input.proposedAuthority,
    requestedTier: input.requestedTier,
    availableTiers: input.availableTiers,
    escalationReason: input.escalationReason,
    pricing: input.pricing,
    reservationTtlMs: input.reservationTtlMs,
  });
}
