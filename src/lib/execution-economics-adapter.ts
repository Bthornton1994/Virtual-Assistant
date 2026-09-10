import {
  type AssignmentToEnvelopeAssignment,
  type ExecutionStepToEnvelopeAssignment,
} from "@/lib/assignment-to-envelope";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { DomainError, type ActionClass } from "@/lib/domain";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import {
  hashExecutorEnvelope,
  validateExecutorEnvelope,
  type ExecutorEnvelopeV1,
} from "@/lib/executor-envelope";
import {
  authorizeToolClass,
  validateExecutionContext,
  type DelegationSpecSnapshot,
  type ExecutionContext,
  type ToolClass,
} from "@/lib/execution-context";
import { checkExecutionLease, type ExecutionLease } from "@/lib/execution-runtime";
import { requireMintedTrustedGovernedBinding } from "@/lib/execution-economics-binding-internal";
import {
  ECONOMICS_RESERVATION_IDS_METADATA_KEY,
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

export {
  bindNativePublicWebEconomics,
  type PersistedWorkCellProjection,
} from "@/lib/execution-economics-binding-internal";

/**
 * Outcome Economics Governor adapter v1.
 *
 * Surrounds a real in-process model, tool, or executor call with
 * evaluateAndReserve / commit / release. It does not issue Outcome Receipts,
 * mark Workstream Runs verified, talk to a provider SDK, or create a second
 * budget, lease, planner, queue, evidence, receipt, or memory store.
 *
 * Reservations are process-local Maps. This is not global serverless
 * enforcement. Cross-request economics remain advisory unless a durable
 * authorized seam exists. Native public-web prepare claims the existing
 * run_executor_assignments unique (run_id, phase) slot before fetch.
 * Binding mint lives on the internal loader module; this barrel does not
 * export mintTrustedGovernedBinding. A future SQL economics seam requires
 * separate authorization and runtime verification.
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

/** Bounded reclaim of a stranded running claim uses the existing native prepare window. It fails the slot; it does not insert a second fetch. */
export const WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS = NATIVE_PUBLIC_WEB_RESERVATION_TTL_MS;

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

export type TrustedGovernedBinding = {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  context: ExecutionContext;
  envelope: ExecutorEnvelopeV1;
  envelopeHash: string;
  contextHash: string;
  runtime: TrustedExecutionRuntimeState;
  frozenAuthority: FrozenAuthorityBinding;
  proposedAuthority: AuthorityFreeze;
  requestedTier: ExecutorTier;
  availableTiers: readonly ExecutorTier[];
  escalationReason: EscalationReason | null;
  pricing: CallerPricing;
  reservationTtlMs: number;
};

export type NativePublicWebEconomicsBinding = TrustedGovernedBinding;

export type TrustedGovernedBindingSource = {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  now: string;
  deadlineAt: string;
  identityKind?: "work_cell_assignment" | "execution_step_assignment";
  assignment: AssignmentToEnvelopeAssignment | ExecutionStepToEnvelopeAssignment;
  spec: DelegationSpecSnapshot;
  inputArtifactRefs: ExecutorEnvelopeV1["inputArtifactRefs"];
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
};

export const WORK_CELL_PHASE_CLAIM_SCHEMA_VERSION = "work-cell-phase-prefetch-claim/v1" as const;
export const WORK_CELL_PHASE_CLAIM_FAIL_SCHEMA_VERSION = "work-cell-phase-claim-fail/v1" as const;

export type WorkCellPhaseClaimInput = {
  organizationId: string;
  tenantId: string;
  runId: string;
  phase: ExecutorEnvelopeV1["phase"];
  assignmentId: string;
  executorKey: string;
  capabilityKey: string;
  inputManifestContentHash: string;
  envelopeHash: string;
  contextHash: string;
  now: string;
};

export type EconomicsCommitProof = "complete" | "failed" | "unknown";

export type WorkCellOwnerActionKind = "blocked_owner_action";

export type WorkCellPhaseClaimRecord = WorkCellPhaseClaimInput & {
  status: "planned" | "running" | "completed" | "failed";
  claimedAt: string;
  failedAt?: string;
  failReason?: string;
  outputArtifactId?: string | null;
  acceptedCatalogPacketExists?: boolean;
  /** TypeScript-only. Never a durable database status. */
  ownerAction?: WorkCellOwnerActionKind;
  /** TypeScript-only. Process-local proof; never inferred from packet presence. */
  economicsCommit?: EconomicsCommitProof;
};

export type WorkCellPhaseClaimIdentity = {
  runId: string;
  phase: string;
  assignmentId: string;
  outputArtifactId: string | null;
  inputManifestContentHash: string;
  envelopeHash: string;
  contextHash: string;
  executorKey: string;
  capabilityKey: string;
};

/**
 * Isolate death after a process-local commit cannot be proven. Automatic
 * reclaim completion is forbidden until a durable accounting seam exists on
 * existing `execution_attempts` and `evidence_artifacts`.
 */
export const WORK_CELL_ECONOMICS_OWNER_BLOCKED =
  "OWNER_BLOCKED: process-local economics cannot safely finalize a durable accepted packet across isolate death. A durable accounting seam is required before automatic reclaim completion." as const;

export type WorkCellPhaseClaimFailInput = WorkCellPhaseClaimInput & {
  reason: string;
};

export type WorkCellPhaseClaimFn = (
  input: WorkCellPhaseClaimInput,
) => Promise<GovernorResult<WorkCellPhaseClaimRecord>>;

export type WorkCellPhaseClaimFailFn = (
  input: WorkCellPhaseClaimFailInput,
) => Promise<GovernorResult<WorkCellPhaseClaimRecord>>;

export type WorkCellPhaseClaimBoundPacket = {
  artifactId: string;
  runId: string;
  executorKey: string;
  schemaVersion: string;
};

export type WorkCellPhaseClaimCompleteInput = WorkCellPhaseClaimInput & {
  outputArtifactId?: string | null;
  acceptedCatalogPacketExists?: boolean;
  /**
   * Same-process confirmation that commitDeferredGovernedReservations succeeded.
   * Packet persistence is not this flag. Isolate restart cannot set this true.
   */
  economicsCommitConfirmed?: boolean;
  boundPacket?: WorkCellPhaseClaimBoundPacket | null;
};

export type WorkCellPhaseClaimCompleteFn = (
  input: WorkCellPhaseClaimCompleteInput,
) => Promise<GovernorResult<WorkCellPhaseClaimRecord>>;

export const FAIL_WORK_CELL_PHASE_CLAIM_RPC = "fail_work_cell_phase_claim" as const;
export const COMPLETE_WORK_CELL_PHASE_CLAIM_RPC = "complete_work_cell_phase_claim" as const;

export type WorkCellPhaseClaimReclaimAction = "noop" | "blocked" | "fail";

/**
 * Packet persisted, economics commit succeeded, assignment completion succeeded,
 * and economics-unknown after isolate death are distinct. Packet presence is
 * never economics proof. This is not a new assignment status.
 */
export const WORK_CELL_ECONOMICS_COMMIT_UNKNOWN_OWNER_ACTION =
  "OWNER_ACTION_REQUIRED: An accepted catalog evidence packet is persisted, but process-local economics commitment is unknown. Packet presence is not economics proof. The assignment remains running. Stale reclaim will not complete or fail this claim. Fetch was not started. OWNER_BLOCKED: process-local economics cannot safely finalize a durable accepted packet across isolate death. A durable accounting seam is required before automatic reclaim completion.";

export function economicsCommitUnknownOwnerActionFailure(
  reservationIds: readonly string[] = [],
): string {
  const ids =
    reservationIds.length > 0 ? ` Reservation IDs: ${reservationIds.join(", ")}.` : "";
  return `${WORK_CELL_ECONOMICS_COMMIT_UNKNOWN_OWNER_ACTION}${ids}`;
}

export function deferredCommitFailedAfterAcceptedPacketReason(failures: readonly string[]): string {
  return `Deferred economics commit failed after the accepted catalog packet was persisted. Economics are not committed. ${failures.join(" ")}`;
}

export function economicsReservationIdsFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const ids = metadata?.[ECONOMICS_RESERVATION_IDS_METADATA_KEY];
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function acceptedCatalogPacketPresent(input: {
  acceptedCatalogPacketExists?: boolean;
  outputArtifactId?: string | null;
}): boolean {
  return Boolean(input.acceptedCatalogPacketExists) || Boolean(input.outputArtifactId);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled work-cell reclaim action: ${String(value)}`);
}

/**
 * Fail is forbidden after an accepted catalog packet is durable, even when
 * assignment completion has not yet succeeded. Completing that packet into an
 * ordinary failed claim would hide successful evidence behind a blocked retry.
 */
export function claimFailureAllowedAfterPrepareOutcome(input: {
  assignmentAlreadyTerminal: boolean;
  acceptedCatalogPacketPersisted: boolean;
}): boolean {
  return !input.assignmentAlreadyTerminal && !input.acceptedCatalogPacketPersisted;
}

export function failWorkCellPhaseClaimBlockedReason(input: {
  status: string;
  acceptedCatalogPacketExists?: boolean;
  outputArtifactId?: string | null;
}): string | null {
  if (input.status === "completed") {
    return "A completed work-cell phase assignment cannot be overwritten by a claim failure.";
  }
  if (input.status === "running" && acceptedCatalogPacketPresent(input)) {
    return "An accepted catalog evidence packet exists; refusing to fail the work-cell phase claim.";
  }
  return null;
}

export function workCellPhaseClaimBoundIdentityFailure(input: {
  existing: {
    runId: string;
    phase: string;
    assignmentId: string;
    executorKey: string;
    capabilityKey: string;
    inputManifestContentHash: string;
    envelopeHash: string;
    contextHash: string;
    outputArtifactId?: string | null;
  };
  presented: {
    runId: string;
    phase: string;
    assignmentId: string;
    outputArtifactId?: string | null;
    inputManifestContentHash: string;
    envelopeHash: string;
    contextHash: string;
    executorKey: string;
    capabilityKey: string;
  };
  boundPacket?: WorkCellPhaseClaimBoundPacket | null;
}): string | null {
  if (input.presented.runId !== input.existing.runId) {
    return "Work-cell phase claim run identity does not match the completion request.";
  }
  if (input.presented.phase !== input.existing.phase) {
    return "Work-cell phase claim phase does not match the completion request.";
  }
  if (input.presented.assignmentId !== input.existing.assignmentId) {
    return "Work-cell phase claim identity does not match the completion request.";
  }
  if (input.presented.executorKey !== input.existing.executorKey) {
    return "Work-cell phase claim executor identity does not match the completion request.";
  }
  if (input.presented.capabilityKey !== input.existing.capabilityKey) {
    return "Work-cell phase claim capability identity does not match the completion request.";
  }
  if (input.presented.inputManifestContentHash !== input.existing.inputManifestContentHash) {
    return "Work-cell phase claim input-manifest content hash does not match the completion request.";
  }
  if (input.presented.envelopeHash !== input.existing.envelopeHash) {
    return "Work-cell phase claim envelope hash does not match the completion request.";
  }
  if (input.presented.contextHash !== input.existing.contextHash) {
    return "Work-cell phase claim execution context hash does not match the completion request.";
  }
  if (!input.existing.outputArtifactId) {
    return "Cannot complete a work-cell phase claim that is not running with output evidence.";
  }
  if (!input.presented.outputArtifactId || input.presented.outputArtifactId !== input.existing.outputArtifactId) {
    return "Work-cell phase claim output artifact does not match the completion request.";
  }
  if (input.boundPacket) {
    if (input.boundPacket.artifactId !== input.existing.outputArtifactId) {
      return "An unrelated catalog evidence packet cannot complete this work-cell phase claim.";
    }
    if (input.boundPacket.runId !== input.existing.runId) {
      return "Work-cell phase claim run identity does not match the completion request.";
    }
    if (input.boundPacket.executorKey !== input.existing.executorKey) {
      return "Work-cell phase claim executor identity does not match the completion request.";
    }
    if (input.boundPacket.schemaVersion !== CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION) {
      return "An unrelated catalog evidence packet cannot complete this work-cell phase claim.";
    }
  }
  return null;
}

export function workCellPhaseClaimCompletionBlockedReason(input: {
  status: string;
  existing: Parameters<typeof workCellPhaseClaimBoundIdentityFailure>[0]["existing"];
  presented: WorkCellPhaseClaimCompleteInput;
}): string | null {
  if (input.status === "failed") {
    return "A failed work-cell phase assignment cannot be completed.";
  }
  const mismatch = workCellPhaseClaimBoundIdentityFailure({
    existing: input.existing,
    presented: input.presented,
    boundPacket: input.presented.boundPacket,
  });
  if (mismatch) return mismatch;
  if (input.status === "completed") return null;
  if (input.status !== "running") {
    return "Cannot complete a work-cell phase claim that is not running with output evidence.";
  }
  if (input.presented.economicsCommitConfirmed !== true) {
    return "Successful completion requires a confirmed process-local economics commit. An accepted catalog evidence packet is not economics proof.";
  }
  return null;
}

/**
 * Stale reclaim never fetches. Packet presence is not economics proof and must
 * not complete the assignment. Bound accepted packet: leave running and block
 * for owner action. No bound packet: running -> failed after TTL.
 */
export function decideStaleWorkCellPhaseClaimReclaim(input: {
  status: string;
  createdAt: string;
  now: string;
  ttlMs: number;
  acceptedCatalogPacketExists?: boolean;
  outputArtifactId?: string | null;
}): WorkCellPhaseClaimReclaimAction {
  if (input.status !== "running") return "noop";
  const createdMs = Date.parse(input.createdAt);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(createdMs) || !Number.isFinite(nowMs) || nowMs - createdMs < input.ttlMs) {
    return "noop";
  }
  if (acceptedCatalogPacketPresent(input)) return "blocked";
  return "fail";
}

export type WorkCellPhaseClaimExpireInput = {
  runId: string;
  phase: ExecutorEnvelopeV1["phase"];
  now: string;
  ttlMs: number;
  reason?: string;
};

export type WorkCellPhaseClaimExpireFn = (
  input: WorkCellPhaseClaimExpireInput,
) => Promise<GovernorResult<WorkCellPhaseClaimRecord | null>>;

export type GovernedExecutionMode = "full" | "reserve_only";

export type GovernedExecutionInput<T> = {
  trustedBinding: TrustedGovernedBinding;
  proposedAuthority?: AuthorityFreeze;
  requestedTier?: ExecutorTier;
  availableTiers?: readonly ExecutorTier[];
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
  reservationExpiresAt?: string;
  telemetry?: unknown;
  mode?: GovernedExecutionMode;
  execute?: () => Promise<T>;
  usageOnSuccess?: (result: T) => UsageObservation;
};

export type GovernedExecutionSuccess<T> = {
  ok: true;
  executed: boolean;
  value: T | undefined;
  reservation: BudgetReservation;
  commit: ReservationCommit | null;
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
  return attachEconomicsReservationIds(metadata, [reservationId]);
}

export function attachEconomicsReservationIds(
  metadata: Record<string, unknown> | undefined,
  reservationIds: readonly string[],
): Record<string, unknown> {
  const next = { ...(metadata ?? {}) };
  const ids = [...reservationIds];
  next[ECONOMICS_RESERVATION_IDS_METADATA_KEY] = ids;
  if (ids.length > 0) {
    next[ECONOMICS_RESERVATION_METADATA_KEY] = ids[ids.length - 1];
  }
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
  const minted = requireMintedTrustedGovernedBinding(input.trustedBinding);
  if (!minted.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: minted.failures };
  }
  const binding = minted.value;
  const mode = input.mode ?? "full";
  if (mode === "full" && (!input.execute || !input.usageOnSuccess)) {
    return {
      ok: false,
      executed: false,
      decision: "reject",
      reservation: null,
      failures: ["Full governed execution requires execute and usageOnSuccess."],
    };
  }

  const contextCheck = validateExecutionContext(binding.context);
  if (!contextCheck.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: contextCheck.failures };
  }
  const envelopeCheck = assertExecutorEnvelopeIntegrity({
    envelope: binding.envelope,
    expectedEnvelopeHash: binding.envelopeHash,
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
    canonicalPlanHash: binding.runtime.canonicalPlanHash,
    inputManifestContentHash: binding.runtime.inputManifestContentHash,
  });
  if (!derivedFrozen.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: derivedFrozen.failures };
  }
  if (canonicalFrozenAuthorityBinding(binding.frozenAuthority) !== canonicalFrozenAuthorityBinding(derivedFrozen.value)) {
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
    runtime: binding.runtime,
    frozenAuthority: derivedFrozen.value,
    session: binding.session,
  });
  if (!identity.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: identity.failures };
  }
  const limits = buildExecutionLimitsFromTrustedState(contextCheck.value, binding.runtime);
  if (!limits.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: limits.failures };
  }
  const proposedAuthority = input.proposedAuthority ?? binding.proposedAuthority;
  const cheaper = assertCheaperRouteDoesNotWeakenAuthority({
    frozen: derivedFrozen.value.authority,
    proposed: proposedAuthority,
  });
  if (!cheaper.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: cheaper.failures };
  }

  const requestedTier = input.requestedTier ?? binding.requestedTier;
  const availableTiers = input.availableTiers ?? binding.availableTiers;
  const escalationReason = input.escalationReason !== undefined ? input.escalationReason : binding.escalationReason;
  const routing = routeExecutorTier({
    availableTiers,
    requestedTier,
    escalationReason,
  });
  if (!routing.ok) {
    return { ok: false, executed: false, decision: "reject", reservation: null, failures: routing.failures };
  }

  const idempotencyKey = deriveGovernedIdempotencyKey({
    organizationId: binding.runtime.organizationId,
    tenantId: binding.runtime.tenantId,
    runId: binding.runtime.runId,
    executionAttemptId: binding.runtime.executionAttemptId,
    assignmentId: binding.runtime.assignmentId,
    specVersion: derivedFrozen.value.specVersion,
    canonicalPlanHash: derivedFrozen.value.canonicalPlanHash,
    inputManifestContentHash: derivedFrozen.value.inputManifestContentHash,
    callKind: input.callKind,
    stepKey: input.stepKey,
  });

  const reserved = evaluateAndReserve({
    session: binding.session,
    organizationId: binding.runtime.organizationId,
    tenantId: binding.runtime.tenantId,
    runId: binding.runtime.runId,
    executionAttemptId: binding.runtime.executionAttemptId,
    assignmentId: binding.runtime.assignmentId,
    capabilityKey: binding.runtime.capabilityKey,
    executorKey: binding.runtime.executorKey,
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
    pricing: binding.pricing,
    executionLimits: limits.value,
    frozenAuthority: derivedFrozen.value.authority,
    proposedAuthority,
    idempotencyKey,
    now: binding.runtime.evaluationClock,
    expiresAt: input.reservationExpiresAt ?? reservationExpiresAt(binding.runtime.evaluationClock, binding.reservationTtlMs),
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
  if (mode === "reserve_only") {
    return {
      ok: true,
      executed: false,
      value: undefined,
      reservation: binding.session.reservations.get(reservation.reservationId) ?? reservation,
      commit: null,
      routing: routing.value,
      decision: "allow",
    };
  }

  let result: T;
  try {
    result = await input.execute!();
  } catch (error) {
    releaseSafely({
      session: binding.session,
      organizationId: binding.runtime.organizationId,
      tenantId: binding.runtime.tenantId,
      reservation,
      now: binding.runtime.evaluationClock,
    });
    const reason = error instanceof Error ? error.message : "underlying call failed";
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: binding.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: [
        isAbortTimeoutOrCancel(error)
          ? `Underlying call aborted, timed out, or cancelled: ${reason}`
          : `Underlying call failed: ${reason}`,
      ],
    };
  }

  let observation: UsageObservation;
  try {
    observation = input.usageOnSuccess!(result);
  } catch (error) {
    releaseSafely({
      session: binding.session,
      organizationId: binding.runtime.organizationId,
      tenantId: binding.runtime.tenantId,
      reservation,
      now: binding.runtime.evaluationClock,
    });
    const reason = error instanceof Error ? error.message : "usage observation failed";
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: binding.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: [`Provider usage could not be observed: ${reason}`],
    };
  }

  const committed = commitReservation({
    session: binding.session,
    organizationId: binding.runtime.organizationId,
    tenantId: binding.runtime.tenantId,
    reservationId: reservation.reservationId,
    idempotencyKey,
    observation,
    pricing: binding.pricing,
    now: binding.runtime.evaluationClock,
    telemetry: input.telemetry,
  });
  if (!committed.ok) {
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: binding.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: committed.failures,
    };
  }

  const completion = assertSuccessfulCompletionMayProceed({
    session: binding.session,
    organizationId: binding.runtime.organizationId,
    tenantId: binding.runtime.tenantId,
    executionAttemptId: binding.runtime.executionAttemptId,
    reservationId: reservation.reservationId,
  });
  if (!completion.ok) {
    return {
      ok: false,
      executed: true,
      decision: "reject",
      reservation: binding.session.reservations.get(reservation.reservationId) ?? reservation,
      failures: completion.failures,
    };
  }

  return {
    ok: true,
    executed: true,
    value: result,
    reservation: binding.session.reservations.get(reservation.reservationId) ?? reservation,
    commit: committed.value,
    routing: routing.value,
    decision: "allow",
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

export function workCellPhaseClaimKey(runId: string, phase: string): string {
  return `${runId}::${phase}`;
}

export function alreadyClaimedPhaseFailure(phase: string, status: string): string {
  return `The ${phase} phase of this run already has a recorded attempt (status: ${status}). Fetch was not started.`;
}

export function createMemoryWorkCellPhaseClaim(options?: {
  beforeInsert?: () => Promise<void>;
}): {
  claim: WorkCellPhaseClaimFn;
  fail: WorkCellPhaseClaimFailFn;
  expireStale: WorkCellPhaseClaimExpireFn;
  complete: WorkCellPhaseClaimCompleteFn;
  recordAcceptedPacket: (runId: string, phase: string, artifactId: string) => void;
  records: Map<string, WorkCellPhaseClaimRecord>;
} {
  const records = new Map<string, WorkCellPhaseClaimRecord>();
  const fail: WorkCellPhaseClaimFailFn = async (input) => {
    const key = workCellPhaseClaimKey(input.runId, input.phase);
    const existing = records.get(key);
    if (!existing) {
      return { ok: false, failures: ["No work-cell phase claim exists to fail."] };
    }
    const blocked = failWorkCellPhaseClaimBlockedReason({
      status: existing.status,
      acceptedCatalogPacketExists: existing.acceptedCatalogPacketExists,
      outputArtifactId: existing.outputArtifactId,
    });
    if (blocked) {
      return { ok: false, failures: [blocked] };
    }
    if (existing.status === "failed") {
      return { ok: true, value: existing };
    }
    const record: WorkCellPhaseClaimRecord = {
      ...existing,
      status: "failed",
      failedAt: input.now,
      failReason: input.reason,
    };
    records.set(key, record);
    return { ok: true, value: record };
  };
  const complete: WorkCellPhaseClaimCompleteFn = async (input) => {
    const key = workCellPhaseClaimKey(input.runId, input.phase);
    const existing = records.get(key);
    if (!existing) {
      return { ok: false, failures: ["No work-cell phase claim exists to complete."] };
    }
    const blocked = workCellPhaseClaimCompletionBlockedReason({
      status: existing.status,
      existing,
      presented: input,
    });
    if (blocked) {
      return { ok: false, failures: [blocked] };
    }
    if (existing.status === "completed") {
      return { ok: true, value: existing };
    }
    const record: WorkCellPhaseClaimRecord = {
      ...existing,
      status: "completed",
      outputArtifactId: input.outputArtifactId ?? existing.outputArtifactId,
      acceptedCatalogPacketExists:
        input.acceptedCatalogPacketExists ?? existing.acceptedCatalogPacketExists,
    };
    records.set(key, record);
    return { ok: true, value: record };
  };
  return {
    records,
    recordAcceptedPacket: (runId, phase, artifactId) => {
      const key = workCellPhaseClaimKey(runId, phase);
      const existing = records.get(key);
      if (!existing) return;
      records.set(key, {
        ...existing,
        outputArtifactId: artifactId,
        acceptedCatalogPacketExists: true,
      });
    },
    claim: async (input) => {
      if (options?.beforeInsert) await options.beforeInsert();
      const key = workCellPhaseClaimKey(input.runId, input.phase);
      const existing = records.get(key);
      if (existing) {
        return { ok: false, failures: [alreadyClaimedPhaseFailure(input.phase, existing.status)] };
      }
      const record: WorkCellPhaseClaimRecord = {
        ...input,
        status: "running",
        claimedAt: input.now,
        outputArtifactId: null,
        acceptedCatalogPacketExists: false,
      };
      records.set(key, record);
      return { ok: true, value: record };
    },
    fail,
    complete,
    expireStale: async (input) => {
      const key = workCellPhaseClaimKey(input.runId, input.phase);
      const existing = records.get(key);
      if (!existing) {
        return { ok: true, value: null };
      }
      const action = decideStaleWorkCellPhaseClaimReclaim({
        status: existing.status,
        createdAt: existing.claimedAt,
        now: input.now,
        ttlMs: input.ttlMs,
        acceptedCatalogPacketExists: existing.acceptedCatalogPacketExists,
        outputArtifactId: existing.outputArtifactId,
      });
      if (action === "noop") return { ok: true, value: null };
      if (action === "blocked") {
        return {
          ok: false,
          failures: [economicsCommitUnknownOwnerActionFailure()],
        };
      }
      if (action === "fail") {
        return fail({
          ...existing,
          now: input.now,
          reason: input.reason ?? "Stale running work-cell phase claim reclaimed to failed without fetching.",
        });
      }
      return assertNever(action);
    },
  };
}

export async function claimWorkCellPhase(
  claim: WorkCellPhaseClaimFn,
  input: WorkCellPhaseClaimInput,
): Promise<GovernorResult<WorkCellPhaseClaimRecord>> {
  return claim(input);
}

export async function failWorkCellPhaseClaim(
  fail: WorkCellPhaseClaimFailFn,
  input: WorkCellPhaseClaimFailInput,
): Promise<GovernorResult<WorkCellPhaseClaimRecord>> {
  return fail(input);
}

export async function completeWorkCellPhaseClaim(
  complete: WorkCellPhaseClaimCompleteFn,
  input: WorkCellPhaseClaimCompleteInput,
): Promise<GovernorResult<WorkCellPhaseClaimRecord>> {
  return complete(input);
}

export async function expireStaleRunningWorkCellPhaseClaim(
  expire: WorkCellPhaseClaimExpireFn,
  input: WorkCellPhaseClaimExpireInput,
): Promise<GovernorResult<WorkCellPhaseClaimRecord | null>> {
  return expire(input);
}

export function claimFailureMetadata(reason: string, now: string, reservationIds: readonly string[] = []): Record<string, unknown> {
  return {
    claimFailure: {
      schemaVersion: WORK_CELL_PHASE_CLAIM_FAIL_SCHEMA_VERSION,
      reason,
      failedAt: now,
      economicReservationIds: [...reservationIds],
      reclaimedWithoutFetch: reason.includes("reclaimed"),
    },
  };
}

export function claimMetadataFromInput(input: WorkCellPhaseClaimInput): Record<string, unknown> {
  return {
    schemaVersion: WORK_CELL_PHASE_CLAIM_SCHEMA_VERSION,
    organizationId: input.organizationId,
    runId: input.runId,
    phase: input.phase,
    executorKey: input.executorKey,
    capabilityKey: input.capabilityKey,
    assignmentId: input.assignmentId,
    envelopeHash: input.envelopeHash,
    contextHash: input.contextHash,
    inputManifestContentHash: input.inputManifestContentHash,
  };
}

export function reservationLedgerFromSession(
  session: EconomicsSession,
  reservationIds: readonly string[],
): Array<{ reservationId: string; state: BudgetReservation["state"] | "missing" }> {
  return reservationIds.map((reservationId) => ({
    reservationId,
    state: session.reservations.get(reservationId)?.state ?? "missing",
  }));
}

export function releaseReservedGovernedExecutions(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  reservationIds: readonly string[];
  now: string;
}): Array<{ reservationId: string; state: BudgetReservation["state"] | "missing" }> {
  for (const reservationId of input.reservationIds) {
    const reservation = input.session.reservations.get(reservationId);
    if (!reservation || reservation.state !== "reserved") continue;
    releaseReservation({
      session: input.session,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      reservationId,
      idempotencyKey: reservation.idempotencyKey,
      now: input.now,
    });
  }
  return reservationLedgerFromSession(input.session, input.reservationIds);
}

type EconomicsSessionSnapshot = {
  remainingAiCostMicros: number;
  remainingToolCostMicros: number;
  releasedAiCostMicros: number;
  releasedToolCostMicros: number;
  reservations: Map<
    string,
    {
      state: BudgetReservation["state"];
      committed: ReservationCommit | undefined;
    }
  >;
  reservationsByIdempotency: Map<string, string>;
  commitsByIdempotency: Map<string, ReservationCommit>;
  releasesByIdempotency: Map<string, { reservationId: string; releasedAt: string }>;
};

function snapshotEconomicsSession(session: EconomicsSession): EconomicsSessionSnapshot {
  const reservations = new Map<string, { state: BudgetReservation["state"]; committed: ReservationCommit | undefined }>();
  for (const [id, reservation] of session.reservations) {
    reservations.set(id, {
      state: reservation.state,
      committed: reservation.committed ? { ...reservation.committed } : undefined,
    });
  }
  return {
    remainingAiCostMicros: session.remainingAiCostMicros,
    remainingToolCostMicros: session.remainingToolCostMicros,
    releasedAiCostMicros: session.releasedAiCostMicros,
    releasedToolCostMicros: session.releasedToolCostMicros,
    reservations,
    reservationsByIdempotency: new Map(session.reservationsByIdempotency),
    commitsByIdempotency: new Map(
      [...session.commitsByIdempotency.entries()].map(([key, commit]) => [key, { ...commit }]),
    ),
    releasesByIdempotency: new Map(
      [...session.releasesByIdempotency.entries()].map(([key, released]) => [key, { ...released }]),
    ),
  };
}

function restoreEconomicsSession(session: EconomicsSession, snapshot: EconomicsSessionSnapshot): void {
  session.remainingAiCostMicros = snapshot.remainingAiCostMicros;
  session.remainingToolCostMicros = snapshot.remainingToolCostMicros;
  session.releasedAiCostMicros = snapshot.releasedAiCostMicros;
  session.releasedToolCostMicros = snapshot.releasedToolCostMicros;
  for (const [id, current] of session.reservations) {
    const prior = snapshot.reservations.get(id);
    if (!prior) continue;
    current.state = prior.state;
    if (prior.committed) {
      current.committed = { ...prior.committed };
    } else {
      delete current.committed;
    }
  }
  session.reservationsByIdempotency.clear();
  for (const [key, value] of snapshot.reservationsByIdempotency) {
    session.reservationsByIdempotency.set(key, value);
  }
  session.commitsByIdempotency.clear();
  for (const [key, value] of snapshot.commitsByIdempotency) {
    session.commitsByIdempotency.set(key, { ...value });
  }
  session.releasesByIdempotency.clear();
  for (const [key, value] of snapshot.releasesByIdempotency) {
    session.releasesByIdempotency.set(key, { ...value });
  }
}

export type DeferredGovernedCommitResult = GovernorResult<Array<{ reservationId: string; commit: ReservationCommit }>> & {
  reservationLedger: Array<{ reservationId: string; state: BudgetReservation["state"] | "missing" }>;
};

/**
 * All-or-none in-process finalization. Snapshot/rollback is NOT a SQL transaction.
 * If any deferred commit fails, earlier mutations in this batch are restored so no
 * reservation remains committed unless it was already committed before this call.
 */
export function commitDeferredGovernedReservations(input: {
  session: EconomicsSession;
  organizationId: string;
  tenantId: string;
  now: string;
  pricing: CallerPricing;
  items: ReadonlyArray<{ reservation: BudgetReservation; observation: UsageObservation }>;
}): DeferredGovernedCommitResult {
  const reservationIds = input.items.map((item) => item.reservation.reservationId);
  const failures: string[] = [];
  for (const item of input.items) {
    const reservation = input.session.reservations.get(item.reservation.reservationId);
    if (!reservation) {
      failures.push(`Deferred commit is missing reservation ${item.reservation.reservationId}.`);
      continue;
    }
    if (reservation.organizationId !== input.organizationId || reservation.tenantId !== input.tenantId) {
      failures.push(`Deferred commit reservation ${reservation.reservationId} does not match the economics session.`);
    }
  }
  if (failures.length) {
    return {
      ok: false,
      failures,
      reservationLedger: reservationLedgerFromSession(input.session, reservationIds),
    };
  }

  const snapshot = snapshotEconomicsSession(input.session);
  const committed: Array<{ reservationId: string; commit: ReservationCommit }> = [];
  for (const item of input.items) {
    const result = commitReservation({
      session: input.session,
      organizationId: input.organizationId,
      tenantId: input.tenantId,
      reservationId: item.reservation.reservationId,
      idempotencyKey: item.reservation.idempotencyKey,
      observation: item.observation,
      pricing: input.pricing,
      now: input.now,
    });
    if (!result.ok) {
      restoreEconomicsSession(input.session, snapshot);
      const ledger = reservationLedgerFromSession(input.session, reservationIds);
      return {
        ok: false,
        failures: [
          ...result.failures,
          "Deferred reservation commit rolled back. No reservation in this batch remains newly committed.",
          `reservationLedger=${JSON.stringify(ledger)}`,
        ],
        reservationLedger: ledger,
      };
    }
    committed.push({ reservationId: item.reservation.reservationId, commit: result.value });
  }
  return {
    ok: true,
    value: committed,
    reservationLedger: reservationLedgerFromSession(input.session, reservationIds),
  };
}
