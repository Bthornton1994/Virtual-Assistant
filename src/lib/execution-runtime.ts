import { sha256Hex } from "@/lib/catalog-evidence-hash";
import type { ActionClass } from "@/lib/domain";

/**
 * Execution Runtime v1 is the durable-control contract around a workstream.
 * It schedules bounded stages; it does not execute external side effects and it
 * does not replace the Delegation Spec, evidence, receipt, or Gauntlet layers.
 */
export const EXECUTION_RUNTIME_SCHEMA_VERSION = "execution-runtime/v1" as const;

export const EXECUTION_PLAN_STATUSES = [
  "proposed",
  "frozen",
  "running",
  "awaiting_approval",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ExecutionPlanStatus = (typeof EXECUTION_PLAN_STATUSES)[number];

export const EXECUTION_STEP_STATUSES = [
  "pending",
  "ready",
  "leased",
  "running",
  "awaiting_approval",
  "awaiting_verification",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
] as const;
export type ExecutionStepStatus = (typeof EXECUTION_STEP_STATUSES)[number];

export const EXECUTION_ATTEMPT_STATUSES = [
  "claimed",
  "running",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
] as const;
export type ExecutionAttemptStatus = (typeof EXECUTION_ATTEMPT_STATUSES)[number];

export const EXECUTION_DATA_SENSITIVITIES = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type ExecutionDataSensitivity = (typeof EXECUTION_DATA_SENSITIVITIES)[number];

export const EXECUTION_FAILURE_CLASSES = [
  "bad_input",
  "executor_failure",
  "evidence_failure",
  "qa_failure",
  "integration_failure",
  "source_ambiguity",
  "authority_limit",
  "policy_conflict",
  "business_strategy_failure",
  "cost_limit",
  "security_incident",
  "external_dependency",
  "unknown",
] as const;
export type ExecutionFailureClass = (typeof EXECUTION_FAILURE_CLASSES)[number];

export const EXECUTION_RETRY_DECISIONS = [
  "retry_same_executor",
  "retry_different_executor",
  "correct_inputs_then_retry",
  "escalate_human",
  "replan",
  "suspend_workstream",
  "no_retry",
] as const;
export type ExecutionRetryDecision = (typeof EXECUTION_RETRY_DECISIONS)[number];

const ACTION_CLASS_RANK: Record<ActionClass, number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

const ACTION_CLASSES = Object.keys(ACTION_CLASS_RANK) as ActionClass[];
const DATA_SENSITIVITIES = new Set<string>(EXECUTION_DATA_SENSITIVITIES);
const FAILURE_CLASS_SET = new Set<string>(EXECUTION_FAILURE_CLASSES);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|private[_-]?key)/i;

type JsonObject = Record<string, unknown>;

export type ExecutionPlanStep = {
  stepKey: string;
  sequence: number;
  title: string;
  capabilityKey: string;
  inputContractVersion: string | null;
  outputContractVersion: string | null;
  actionClass: ActionClass;
  dataSensitivity: ExecutionDataSensitivity;
  dependsOn: string[];
  requiresHumanApproval: boolean;
  externalSideEffect: boolean;
  mayOwnAuthoritativeState: false;
  maxAttempts: number;
  deadline: string;
};

export type ExecutionPlanInput = {
  schemaVersion?: typeof EXECUTION_RUNTIME_SCHEMA_VERSION;
  planId: string;
  runId: string;
  organizationId: string;
  delegationSpecId: string;
  planVersion: number;
  delegationSpecVersion: number;
  objective: string;
  authorityClass: ActionClass;
  dataPolicy: JsonObject;
  steps: readonly ExecutionPlanStep[];
  createdAt: string;
  mayOwnAuthoritativeState?: false;
  planHash?: string;
};

export type ExecutionPlan = Omit<ExecutionPlanInput, "schemaVersion" | "planHash" | "steps"> & {
  schemaVersion: typeof EXECUTION_RUNTIME_SCHEMA_VERSION;
  mayOwnAuthoritativeState: false;
  steps: ExecutionPlanStep[];
  planHash: string;
  status: "proposed";
};

export type PlanValidationResult =
  | { ok: true; value: ExecutionPlan }
  | { ok: false; failures: string[] };

export type ExecutionStepState = {
  stepKey: string;
  status: ExecutionStepStatus;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
};

export type ExecutionLease = {
  attemptId: string;
  stepKey: string;
  workerId: string;
  leaseTokenHash: string;
  leaseExpiresAt: string;
};

export type LeaseCheckResult = { ok: true } | { ok: false; reason: string };

export type RetryOutcome = {
  decision: ExecutionRetryDecision;
  shouldRetry: boolean;
  terminalStepStatus: Extract<ExecutionStepStatus, "failed" | "blocked"> | null;
  nextAvailableAt: string | null;
  reason: string;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isActionClass(value: unknown): value is ActionClass {
  return typeof value === "string" && ACTION_CLASSES.includes(value as ActionClass);
}

function isDataSensitivity(value: unknown): value is ExecutionDataSensitivity {
  return typeof value === "string" && DATA_SENSITIVITIES.has(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isFiniteDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBoundedPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maximum;
}

export function findSecretLikeKeys(value: unknown, path = "dataPolicy"): string[] {
  return secretLikeKeys(value, path);
}

function secretLikeKeys(value: unknown, path = "dataPolicy", depth = 0): string[] {
  if (depth > 8 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => secretLikeKeys(item, `${path}[${index}]`, depth + 1));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const nextPath = `${path}.${key}`;
    return SECRET_KEY_PATTERN.test(key)
      ? [nextPath]
      : secretLikeKeys(nested, nextPath, depth + 1);
  });
}

function canonicalStep(step: ExecutionPlanStep) {
  return {
    stepKey: step.stepKey,
    sequence: step.sequence,
    title: step.title,
    capabilityKey: step.capabilityKey,
    inputContractVersion: step.inputContractVersion,
    outputContractVersion: step.outputContractVersion,
    actionClass: step.actionClass,
    dataSensitivity: step.dataSensitivity,
    dependsOn: [...step.dependsOn].sort(),
    requiresHumanApproval: step.requiresHumanApproval,
    externalSideEffect: step.externalSideEffect,
    mayOwnAuthoritativeState: false,
    maxAttempts: step.maxAttempts,
    deadline: step.deadline,
  };
}

function canonicalPlan(plan: Omit<ExecutionPlan, "planHash" | "status">) {
  return {
    schemaVersion: EXECUTION_RUNTIME_SCHEMA_VERSION,
    planId: plan.planId,
    runId: plan.runId,
    organizationId: plan.organizationId,
    delegationSpecId: plan.delegationSpecId,
    planVersion: plan.planVersion,
    delegationSpecVersion: plan.delegationSpecVersion,
    objective: plan.objective,
    authorityClass: plan.authorityClass,
    dataPolicy: plan.dataPolicy,
    mayOwnAuthoritativeState: false,
    createdAt: plan.createdAt,
    steps: [...plan.steps]
      .sort((a, b) => a.sequence - b.sequence || a.stepKey.localeCompare(b.stepKey))
      .map(canonicalStep),
  };
}

export function hashExecutionPlan(plan: Omit<ExecutionPlan, "planHash" | "status">): string {
  return sha256Hex(canonicalPlan(plan));
}

function validateStep(step: unknown, index: number, failures: string[]): ExecutionPlanStep | null {
  if (!isObject(step)) {
    failures.push(`steps[${index}] must be an object.`);
    return null;
  }

  const stepKey = step.stepKey;
  const title = step.title;
  const capabilityKey = step.capabilityKey;
  const actionClass = step.actionClass;
  const dataSensitivity = step.dataSensitivity;
  const dependsOn = step.dependsOn;
  const inputContractVersion = step.inputContractVersion;
  const outputContractVersion = step.outputContractVersion;
  const requiresHumanApproval = step.requiresHumanApproval;
  const externalSideEffect = step.externalSideEffect;
  const maxAttempts = step.maxAttempts;
  const deadline = step.deadline;
  const sequence = step.sequence;

  if (!isIdentifier(stepKey)) failures.push(`steps[${index}].stepKey must be a bounded identifier.`);
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 240) {
    failures.push(`steps[${index}].title must be a non-empty string of at most 240 characters.`);
  }
  if (!isIdentifier(capabilityKey)) failures.push(`steps[${index}].capabilityKey must be a bounded identifier.`);
  if (!isActionClass(actionClass)) failures.push(`steps[${index}].actionClass is invalid.`);
  if (!isDataSensitivity(dataSensitivity)) failures.push(`steps[${index}].dataSensitivity is invalid.`);
  if (!Array.isArray(dependsOn) || dependsOn.some((value) => !isIdentifier(value))) {
    failures.push(`steps[${index}].dependsOn must be an array of bounded identifiers.`);
  }
  if (Array.isArray(dependsOn) && new Set(dependsOn).size !== dependsOn.length) {
    failures.push(`steps[${index}].dependsOn must not contain duplicates.`);
  }
  if (inputContractVersion !== null && !isIdentifier(inputContractVersion)) {
    failures.push(`steps[${index}].inputContractVersion must be null or a bounded identifier.`);
  }
  if (outputContractVersion !== null && !isIdentifier(outputContractVersion)) {
    failures.push(`steps[${index}].outputContractVersion must be null or a bounded identifier.`);
  }
  if (typeof requiresHumanApproval !== "boolean") failures.push(`steps[${index}].requiresHumanApproval must be boolean.`);
  if (typeof externalSideEffect !== "boolean") failures.push(`steps[${index}].externalSideEffect must be boolean.`);
  if (!isBoundedPositiveInteger(sequence, 10000)) {
    failures.push(`steps[${index}].sequence must be a positive integer.`);
  }
  if (!isBoundedPositiveInteger(maxAttempts, 10)) {
    failures.push(`steps[${index}].maxAttempts must be an integer from 1 through 10.`);
  }
  if (!isFiniteDate(deadline)) failures.push(`steps[${index}].deadline must be an ISO-compatible date.`);

  if (
    isActionClass(actionClass) &&
    (actionClass === "external_execution" || actionClass === "sensitive_execution") &&
    requiresHumanApproval !== true
  ) {
    failures.push(`steps[${index}] external and sensitive actions require human approval.`);
  }
  if (externalSideEffect === true && requiresHumanApproval !== true) {
    failures.push(`steps[${index}] external side effects require human approval.`);
  }

  if (
    !isIdentifier(stepKey) ||
    typeof title !== "string" ||
    !isIdentifier(capabilityKey) ||
    !isActionClass(actionClass) ||
    !isDataSensitivity(dataSensitivity) ||
    !Array.isArray(dependsOn) ||
    dependsOn.some((value) => !isIdentifier(value)) ||
    (inputContractVersion !== null && !isIdentifier(inputContractVersion)) ||
    (outputContractVersion !== null && !isIdentifier(outputContractVersion)) ||
    typeof requiresHumanApproval !== "boolean" ||
    typeof externalSideEffect !== "boolean" ||
    !isBoundedPositiveInteger(sequence, 10000) ||
    !isBoundedPositiveInteger(maxAttempts, 10) ||
    !isFiniteDate(deadline)
  ) {
    return null;
  }

  return {
    stepKey,
    sequence,
    title: title.trim(),
    capabilityKey,
    inputContractVersion,
    outputContractVersion,
    actionClass,
    dataSensitivity,
    dependsOn: [...dependsOn],
    requiresHumanApproval,
    externalSideEffect,
    mayOwnAuthoritativeState: false,
    maxAttempts,
    deadline,
  };
}

function hasDependencyCycle(steps: readonly ExecutionPlanStep[]): boolean {
  const dependencies = new Map(steps.map((step) => [step.stepKey, step.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  return steps.some((step) => visit(step.stepKey));
}

/**
 * Validates and hashes a proposed plan before it can be persisted or frozen.
 * The plan is deliberately incapable of owning authoritative state.
 */
export function validateExecutionPlan(input: unknown): PlanValidationResult {
  if (!isObject(input)) return { ok: false, failures: ["Execution plan must be an object."] };
  const failures: string[] = [];

  if (input.schemaVersion !== undefined && input.schemaVersion !== EXECUTION_RUNTIME_SCHEMA_VERSION) {
    failures.push(`schemaVersion must be ${EXECUTION_RUNTIME_SCHEMA_VERSION}.`);
  }
  for (const [key, value] of [
    ["planId", input.planId],
    ["runId", input.runId],
    ["organizationId", input.organizationId],
    ["delegationSpecId", input.delegationSpecId],
  ] as const) {
    if (!isIdentifier(value)) failures.push(`${key} must be a bounded identifier.`);
  }
  if (typeof input.objective !== "string" || input.objective.trim().length === 0 || input.objective.length > 1000) {
    failures.push("objective must be a non-empty string of at most 1000 characters.");
  }
  if (!isActionClass(input.authorityClass)) failures.push("authorityClass is invalid.");
  if (!isObject(input.dataPolicy)) failures.push("dataPolicy must be an object.");
  const secretPaths = secretLikeKeys(input.dataPolicy);
  if (secretPaths.length > 0) {
    failures.push(`dataPolicy must contain references and policy metadata, not secret material (${secretPaths.join(", ")}).`);
  }
  if (!isBoundedPositiveInteger(input.planVersion, 1000)) {
    failures.push("planVersion must be an integer from 1 through 1000.");
  }
  if (!isBoundedPositiveInteger(input.delegationSpecVersion)) {
    failures.push("delegationSpecVersion must be a positive integer.");
  }
  if (!isFiniteDate(input.createdAt)) failures.push("createdAt must be an ISO-compatible date.");
  if (input.mayOwnAuthoritativeState !== undefined && input.mayOwnAuthoritativeState !== false) {
    failures.push("mayOwnAuthoritativeState must be false.");
  }
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 100) {
    failures.push("steps must contain between 1 and 100 stages.");
  }

  const steps: ExecutionPlanStep[] = [];
  if (Array.isArray(input.steps)) {
    input.steps.forEach((step, index) => {
      const parsed = validateStep(step, index, failures);
      if (parsed) steps.push(parsed);
    });
  }

  const keys = new Set<string>();
  const sequences = new Set<number>();
  for (const step of steps) {
    if (keys.has(step.stepKey)) failures.push(`Duplicate stepKey: ${step.stepKey}.`);
    keys.add(step.stepKey);
    if (sequences.has(step.sequence)) failures.push(`Duplicate step sequence: ${step.sequence}.`);
    sequences.add(step.sequence);
    if (isActionClass(input.authorityClass) && ACTION_CLASS_RANK[step.actionClass] > ACTION_CLASS_RANK[input.authorityClass]) {
      failures.push(`Step ${step.stepKey} exceeds the plan authority class.`);
    }
    if (isFiniteDate(input.createdAt) && Date.parse(step.deadline) < Date.parse(input.createdAt)) {
      failures.push(`Step ${step.stepKey} deadline must not precede plan creation.`);
    }
    for (const dependency of step.dependsOn) {
      if (!keys.has(dependency) && !steps.some((candidate) => candidate.stepKey === dependency)) {
        failures.push(`Step ${step.stepKey} depends on unknown step ${dependency}.`);
      }
    }
  }
  if (steps.length > 0 && hasDependencyCycle(steps)) failures.push("Execution plan contains a dependency cycle.");

  if (failures.length > 0) return { ok: false, failures };

  const planWithoutHash = {
    schemaVersion: EXECUTION_RUNTIME_SCHEMA_VERSION,
    planId: input.planId as string,
    runId: input.runId as string,
    organizationId: input.organizationId as string,
    delegationSpecId: input.delegationSpecId as string,
    planVersion: input.planVersion as number,
    delegationSpecVersion: input.delegationSpecVersion as number,
    objective: (input.objective as string).trim(),
    authorityClass: input.authorityClass as ActionClass,
    dataPolicy: input.dataPolicy as JsonObject,
    steps,
    createdAt: input.createdAt as string,
    mayOwnAuthoritativeState: false as const,
  } satisfies Omit<ExecutionPlan, "planHash" | "status">;
  const planHash = hashExecutionPlan(planWithoutHash);

  if (input.planHash !== undefined && !isSha256(input.planHash)) {
    failures.push("planHash must be a lowercase SHA-256 hex string.");
  } else if (input.planHash !== undefined && input.planHash !== planHash) {
    failures.push("planHash does not match the canonical execution plan.");
  }
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    value: {
      ...planWithoutHash,
      planHash,
      status: "proposed",
    },
  };
}

const PLAN_TRANSITIONS: Record<ExecutionPlanStatus, readonly ExecutionPlanStatus[]> = {
  proposed: ["frozen", "cancelled"],
  frozen: ["running", "awaiting_approval", "blocked", "cancelled"],
  running: ["running", "awaiting_approval", "blocked", "completed", "failed", "cancelled"],
  awaiting_approval: ["running", "blocked", "cancelled"],
  blocked: ["running", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

const STEP_TRANSITIONS: Record<ExecutionStepStatus, readonly ExecutionStepStatus[]> = {
  pending: ["ready", "awaiting_approval", "blocked", "cancelled"],
  ready: ["leased", "running", "blocked", "cancelled"],
  leased: ["running", "ready", "failed", "cancelled"],
  running: ["awaiting_approval", "awaiting_verification", "succeeded", "ready", "failed", "blocked", "cancelled"],
  awaiting_approval: ["running", "blocked", "cancelled"],
  awaiting_verification: ["succeeded", "failed", "blocked", "cancelled"],
  succeeded: [],
  failed: [],
  blocked: ["ready", "cancelled"],
  cancelled: [],
};

export function canTransitionExecutionPlan(from: ExecutionPlanStatus, to: ExecutionPlanStatus): boolean {
  return PLAN_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionExecutionStep(from: ExecutionStepStatus, to: ExecutionStepStatus): boolean {
  return STEP_TRANSITIONS[from]?.includes(to) ?? false;
}

export function dependencyState(
  step: Pick<ExecutionPlanStep, "dependsOn">,
  statuses: Readonly<Record<string, ExecutionStepStatus>>,
): "ready" | "waiting" | "blocked" {
  if (step.dependsOn.some((dependency) => ["failed", "blocked", "cancelled"].includes(statuses[dependency]))) {
    return "blocked";
  }
  if (step.dependsOn.every((dependency) => statuses[dependency] === "succeeded")) return "ready";
  return "waiting";
}

export function readyStepKeys(
  steps: readonly ExecutionPlanStep[],
  statuses: Readonly<Record<string, ExecutionStepStatus>>,
): string[] {
  return steps
    .filter((step) => (statuses[step.stepKey] ?? "pending") === "pending")
    .filter((step) => dependencyState(step, statuses) === "ready")
    .sort((a, b) => a.sequence - b.sequence || a.stepKey.localeCompare(b.stepKey))
    .map((step) => step.stepKey);
}

export function blockedStepKeys(
  steps: readonly ExecutionPlanStep[],
  statuses: Readonly<Record<string, ExecutionStepStatus>>,
): string[] {
  return steps
    .filter((step) => (statuses[step.stepKey] ?? "pending") === "pending")
    .filter((step) => dependencyState(step, statuses) === "blocked")
    .sort((a, b) => a.sequence - b.sequence || a.stepKey.localeCompare(b.stepKey))
    .map((step) => step.stepKey);
}

export function deriveExecutionPlanStatus(
  steps: readonly Pick<ExecutionStepState, "status">[],
): Exclude<ExecutionPlanStatus, "proposed"> {
  const statuses = steps.map((step) => step.status);
  if (statuses.length > 0 && statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "blocked" || status === "cancelled")) return "blocked";
  if (statuses.every((status) => status === "succeeded")) return "completed";
  if (statuses.some((status) => status === "awaiting_approval")) return "awaiting_approval";
  if (statuses.some((status) => ["ready", "leased", "running", "awaiting_verification"].includes(status))) {
    return "running";
  }
  return "frozen";
}

export function checkExecutionLease(
  lease: ExecutionLease,
  input: Pick<ExecutionLease, "attemptId" | "stepKey" | "workerId" | "leaseTokenHash">,
  now: string,
): LeaseCheckResult {
  if (!isIdentifier(input.attemptId)) return { ok: false, reason: "invalid_attempt_id" };
  if (!isIdentifier(input.stepKey)) return { ok: false, reason: "invalid_step_key" };
  if (!isIdentifier(input.workerId)) return { ok: false, reason: "invalid_worker_id" };
  if (!isSha256(input.leaseTokenHash)) return { ok: false, reason: "invalid_lease_token_hash" };
  if (lease.attemptId !== input.attemptId || lease.stepKey !== input.stepKey) {
    return { ok: false, reason: "lease_identity_mismatch" };
  }
  if (lease.workerId !== input.workerId || lease.leaseTokenHash !== input.leaseTokenHash) {
    return { ok: false, reason: "lease_credential_mismatch" };
  }
  if (!isFiniteDate(now) || !isFiniteDate(lease.leaseExpiresAt) || Date.parse(lease.leaseExpiresAt) <= Date.parse(now)) {
    return { ok: false, reason: "lease_expired" };
  }
  return { ok: true };
}

export function retryDelayMs(attemptNumber: number, baseDelayMs = 1000, maxDelayMs = 900_000): number {
  if (!Number.isInteger(attemptNumber) || attemptNumber < 1) throw new Error("attemptNumber must be a positive integer");
  if (!Number.isInteger(baseDelayMs) || baseDelayMs < 0) throw new Error("baseDelayMs must be a non-negative integer");
  if (!Number.isInteger(maxDelayMs) || maxDelayMs < baseDelayMs) throw new Error("maxDelayMs must be >= baseDelayMs");
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attemptNumber - 1, 20));
}

function retryable(
  decision: ExecutionRetryDecision,
  attemptNumber: number,
  maxAttempts: number,
  now: string,
): RetryOutcome {
  if (attemptNumber < maxAttempts) {
    return {
      decision,
      shouldRetry: true,
      terminalStepStatus: null,
      nextAvailableAt: new Date(Date.parse(now) + retryDelayMs(attemptNumber)).toISOString(),
      reason: `${decision} is allowed while attempts remain.`,
    };
  }
  return {
    decision: "no_retry",
    shouldRetry: false,
    terminalStepStatus: "failed",
    nextAvailableAt: null,
    reason: "Maximum attempts reached; the step is terminally failed rather than retried indefinitely.",
  };
}

/**
 * Converts failure evidence into a bounded retry action. Security, authority,
 * ambiguity, and strategy failures stop or escalate instead of being brute-force
 * retried. This is policy, not an executor's recommendation.
 */
export function decideExecutionRetry(input: {
  failureClass: ExecutionFailureClass;
  attemptNumber: number;
  maxAttempts: number;
  now?: string;
}): RetryOutcome {
  if (!FAILURE_CLASS_SET.has(input.failureClass)) {
    return {
      decision: "escalate_human",
      shouldRetry: false,
      terminalStepStatus: "blocked",
      nextAvailableAt: null,
      reason: "Unknown failure classes are blocked until an accountable human classifies them.",
    };
  }
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1) throw new Error("attemptNumber must be positive");
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error("maxAttempts must be positive");

  const now = input.now ?? new Date().toISOString();
  if (!isFiniteDate(now)) throw new Error("now must be an ISO-compatible date");

  switch (input.failureClass) {
    case "security_incident":
      return {
        decision: "suspend_workstream",
        shouldRetry: false,
        terminalStepStatus: "blocked",
        nextAvailableAt: null,
        reason: "Security incidents suspend the workstream; retries could repeat the harm.",
      };
    case "authority_limit":
    case "policy_conflict":
    case "source_ambiguity":
    case "cost_limit":
      return {
        decision: "escalate_human",
        shouldRetry: false,
        terminalStepStatus: "blocked",
        nextAvailableAt: null,
        reason: `${input.failureClass} requires a human decision before execution can continue.`,
      };
    case "business_strategy_failure":
      return {
        decision: "replan",
        shouldRetry: false,
        terminalStepStatus: "blocked",
        nextAvailableAt: null,
        reason: "A strategy failure changes the plan; repeating the same stage is not a correction.",
      };
    case "bad_input":
      return input.attemptNumber < input.maxAttempts
        ? retryable("correct_inputs_then_retry", input.attemptNumber, input.maxAttempts, now)
        : {
            decision: "escalate_human",
            shouldRetry: false,
            terminalStepStatus: "blocked",
            nextAvailableAt: null,
            reason: "Input correction was not completed within the attempt budget.",
          };
    case "qa_failure":
    case "evidence_failure":
      return retryable("retry_different_executor", input.attemptNumber, input.maxAttempts, now);
    case "executor_failure":
    case "integration_failure":
    case "external_dependency":
      return retryable("retry_same_executor", input.attemptNumber, input.maxAttempts, now);
    case "unknown":
    default:
      return {
        decision: "escalate_human",
        shouldRetry: false,
        terminalStepStatus: "blocked",
        nextAvailableAt: null,
        reason: "Unknown failures are blocked until an accountable human classifies them.",
      };
  }
}
