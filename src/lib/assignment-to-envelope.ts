import {
  ACTION_CLASSES,
  EXECUTOR_ENVELOPE_SCHEMA_VERSION,
  EXECUTOR_KINDS,
  EXECUTOR_PHASES,
  artifactReferenceSchema,
  economicLimitSchema,
  evidenceRequirementsSchema,
  hashExecutorEnvelope,
  outputContractSchema,
  validateExecutorEnvelope,
  type ExecutorEnvelopeV1,
} from "@/lib/executor-envelope";
import {
  createExecutionContext,
  delegationSpecSnapshotSchema,
  type DelegationSpecSnapshot,
  type ExecutionContext,
} from "@/lib/execution-context";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { identifierString, isoDateTimeSchema } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import { z } from "zod";

/**
 * CS-3 assignment-to-envelope translation.
 *
 * Pure projection: a frozen assignment plus a Delegation Spec snapshot become
 * ExecutorEnvelopeV1 and Execution Context hashes. This module does not route,
 * select a provider, write to a store, or grant authority. The Delegation Spec
 * remains the authority ceiling. The envelope is provenance binding.
 */
export const WORK_CELL_ASSIGNMENT_IDENTITY_SCHEMA_VERSION = "work-cell-assignment-identity/v1" as const;
export const EXECUTION_STEP_ASSIGNMENT_IDENTITY_SCHEMA_VERSION =
  "execution-step-assignment-identity/v1" as const;
export const AUTHORITY_SNAPSHOT_CONTRACT_VERSION = "authority-snapshot/v1" as const;

export type AssignmentTranslationResult =
  | {
      ok: true;
      value: {
        assignmentId: string;
        envelope: ExecutorEnvelopeV1;
        envelopeHash: string;
        context: ExecutionContext;
        contextHash: string;
      };
    }
  | { ok: false; failures: string[] };

const ACTION_CLASS_RANK: Record<(typeof ACTION_CLASSES)[number], number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

const workCellAssignmentIdentitySchema = z
  .object({
    organizationId: identifierString,
    runId: identifierString,
    phase: z.enum(EXECUTOR_PHASES),
    executorKey: identifierString,
    inputManifestContentHash: sha256HexSchema,
  })
  .strip();

const executionStepAssignmentIdentitySchema = z
  .object({
    organizationId: identifierString,
    runId: identifierString,
    planHash: sha256HexSchema,
    stepKey: identifierString,
    capabilityKey: identifierString,
  })
  .strip();

export type WorkCellAssignmentIdentityInputs = z.input<typeof workCellAssignmentIdentitySchema>;
export type ExecutionStepAssignmentIdentityInputs = z.input<typeof executionStepAssignmentIdentitySchema>;

const assignmentToEnvelopeInputSchema = z
  .object({
    organizationId: identifierString,
    runId: identifierString,
    phase: z.enum(EXECUTOR_PHASES),
    capabilityKey: identifierString,
    executorKey: identifierString,
    executorKind: z.enum(EXECUTOR_KINDS),
    provider: identifierString,
    protocolVersion: identifierString,
    modelId: identifierString.nullable(),
    configHash: sha256HexSchema.nullable(),
    objective: identifierString,
    createdAt: isoDateTimeSchema,
    deadline: isoDateTimeSchema,
    outputContract: outputContractSchema,
    evidenceRequirements: evidenceRequirementsSchema,
    economicLimit: economicLimitSchema,
    inputManifestContentHash: sha256HexSchema,
    profileAuthoritySnapshot: z.record(z.string(), z.unknown()),
    persistenceAssignmentId: identifierString.optional(),
    id: identifierString.optional(),
    attemptId: identifierString.optional(),
    attemptNumber: z.number().int().positive().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strip();

export type AssignmentToEnvelopeAssignment = z.input<typeof assignmentToEnvelopeInputSchema>;

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function isActionClass(value: unknown): value is (typeof ACTION_CLASSES)[number] {
  return typeof value === "string" && (ACTION_CLASSES as readonly string[]).includes(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mayFlagToAction(flag: string): string {
  const withoutMay = flag.startsWith("may") ? flag.slice(3) : flag;
  return withoutMay.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function deriveAllowedActions(snapshot: Record<string, unknown>): string[] {
  const explicit = stringArray(snapshot.allowedActions);
  if (explicit.length > 0) return explicit;

  const envelope =
    snapshot.authorityEnvelope && typeof snapshot.authorityEnvelope === "object" && !Array.isArray(snapshot.authorityEnvelope)
      ? (snapshot.authorityEnvelope as Record<string, unknown>)
      : snapshot;

  const derived: string[] = [];
  for (const key of Object.keys(envelope).sort()) {
    if (envelope[key] !== true) continue;
    if (!key.startsWith("may")) continue;
    if (key === "mayOwnAuthoritativeState" || key === "mayDecideVerified") continue;
    derived.push(mayFlagToAction(key));
  }
  return derived;
}

function profileOwnsAuthoritativeState(snapshot: Record<string, unknown>): boolean {
  if (snapshot.mayOwnAuthoritativeState === true) return true;
  const envelope = snapshot.authorityEnvelope;
  if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
    return (envelope as Record<string, unknown>).mayOwnAuthoritativeState === true;
  }
  return false;
}

function profileActionClass(snapshot: Record<string, unknown>): (typeof ACTION_CLASSES)[number] | null {
  if (isActionClass(snapshot.actionClass)) return snapshot.actionClass;
  const envelope = snapshot.authorityEnvelope;
  if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
    const value = (envelope as Record<string, unknown>).actionClass;
    if (isActionClass(value)) return value;
  }
  return null;
}

/**
 * Deterministic work-cell assignment identity. Ignores persistence UUIDs,
 * attempt ids, retry counters, timestamps, and mutable metadata.
 */
export function stableWorkCellAssignmentId(identityInputs: WorkCellAssignmentIdentityInputs): string {
  const parsed = workCellAssignmentIdentitySchema.safeParse(identityInputs);
  if (!parsed.success) {
    throw new Error(issueMessages(parsed.error.issues, "Work-cell assignment identity ").join(" "));
  }
  return sha256Hex({
    schemaVersion: WORK_CELL_ASSIGNMENT_IDENTITY_SCHEMA_VERSION,
    organizationId: parsed.data.organizationId,
    runId: parsed.data.runId,
    phase: parsed.data.phase,
    executorKey: parsed.data.executorKey,
    inputManifestContentHash: parsed.data.inputManifestContentHash,
  });
}

/**
 * Deterministic execution-step assignment identity. Uses the frozen plan hash
 * and step key, never attempt ids or plan row UUIDs.
 */
export function stableExecutionStepAssignmentId(identityInputs: ExecutionStepAssignmentIdentityInputs): string {
  const parsed = executionStepAssignmentIdentitySchema.safeParse(identityInputs);
  if (!parsed.success) {
    throw new Error(issueMessages(parsed.error.issues, "Execution-step assignment identity ").join(" "));
  }
  return sha256Hex({
    schemaVersion: EXECUTION_STEP_ASSIGNMENT_IDENTITY_SCHEMA_VERSION,
    organizationId: parsed.data.organizationId,
    runId: parsed.data.runId,
    planHash: parsed.data.planHash,
    stepKey: parsed.data.stepKey,
    capabilityKey: parsed.data.capabilityKey,
  });
}

function mapAuthoritySnapshot(
  snapshot: Record<string, unknown>,
  spec: DelegationSpecSnapshot,
): { ok: true; value: ExecutorEnvelopeV1["authoritySnapshot"] } | { ok: false; failures: string[] } {
  const failures: string[] = [];
  if (profileOwnsAuthoritativeState(snapshot)) {
    failures.push("Assignment may not own authoritative state.");
  }
  if (spec.mayOwnAuthoritativeState !== false) {
    failures.push("Delegation Spec may not own authoritative state.");
  }

  const recordedClass = profileActionClass(snapshot);
  if (recordedClass && ACTION_CLASS_RANK[recordedClass] > ACTION_CLASS_RANK[spec.actionClass]) {
    failures.push(
      "Profile authority snapshot action class " + recordedClass + " exceeds Delegation Spec " + spec.actionClass + ".",
    );
  }

  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    value: {
      contractVersion: AUTHORITY_SNAPSHOT_CONTRACT_VERSION,
      actionClass: spec.actionClass,
      allowedActions: deriveAllowedActions(snapshot),
      forbiddenActions: stringArray(snapshot.forbiddenActions),
      mayOwnAuthoritativeState: false,
    },
  };
}

/**
 * Translates a frozen assignment into ExecutorEnvelopeV1 and Execution Context.
 * Copies executor and capability keys. Does not route or persist.
 */
export function assignmentToEnvelope(
  assignmentInput: unknown,
  specSnapshotInput: unknown,
  inputArtifactRefsInput: unknown,
): AssignmentTranslationResult {
  const assignmentParsed = assignmentToEnvelopeInputSchema.safeParse(assignmentInput);
  const specParsed = delegationSpecSnapshotSchema.safeParse(specSnapshotInput);
  const refsParsed = z.array(artifactReferenceSchema).safeParse(inputArtifactRefsInput);
  const failures: string[] = [];

  if (!assignmentParsed.success) failures.push(...issueMessages(assignmentParsed.error.issues, "Assignment "));
  if (!specParsed.success) failures.push(...issueMessages(specParsed.error.issues, "Delegation Spec "));
  if (!refsParsed.success) failures.push(...issueMessages(refsParsed.error.issues, "Input artifact refs "));
  if (!assignmentParsed.success || !specParsed.success || !refsParsed.success) {
    return { ok: false, failures };
  }

  const assignment = assignmentParsed.data;
  const spec = specParsed.data;
  const inputArtifactRefs = refsParsed.data;

  if (assignment.phase === "validate" && assignment.executorKind !== "deterministic") {
    failures.push("Validate assignments require a deterministic executor.");
  }

  const snapshot = assignment.profileAuthoritySnapshot;
  if (typeof snapshot.executorKey === "string" && snapshot.executorKey !== assignment.executorKey) {
    failures.push("Profile authority snapshot executorKey does not match the frozen assignment executor key.");
  }
  if (typeof snapshot.executorKind === "string" && snapshot.executorKind !== assignment.executorKind) {
    failures.push("Profile authority snapshot executorKind does not match the frozen assignment executor kind.");
  }

  const authority = mapAuthoritySnapshot(snapshot, spec);
  if (!authority.ok) {
    return { ok: false, failures: [...failures, ...authority.failures] };
  }
  if (failures.length > 0) return { ok: false, failures };

  const assignmentId = stableWorkCellAssignmentId({
    organizationId: assignment.organizationId,
    runId: assignment.runId,
    phase: assignment.phase,
    executorKey: assignment.executorKey,
    inputManifestContentHash: assignment.inputManifestContentHash,
  });

  const envelopeCandidate: ExecutorEnvelopeV1 = {
    schemaVersion: EXECUTOR_ENVELOPE_SCHEMA_VERSION,
    runId: assignment.runId,
    assignmentId,
    capabilityKey: assignment.capabilityKey,
    phase: assignment.phase,
    objective: assignment.objective,
    inputArtifactRefs,
    authoritySnapshot: authority.value,
    allowedToolClasses: [...spec.allowedToolClasses],
    outputContract: assignment.outputContract,
    evidenceRequirements: assignment.evidenceRequirements,
    economicLimit: assignment.economicLimit,
    createdAt: assignment.createdAt,
    deadline: assignment.deadline,
    executorConfigurationSnapshot: {
      executorKey: assignment.executorKey,
      executorKind: assignment.executorKind,
      provider: assignment.provider,
      protocolVersion: assignment.protocolVersion,
      modelId: assignment.modelId,
      configHash: assignment.configHash,
    },
  };

  const envelopeCheck = validateExecutorEnvelope(envelopeCandidate);
  if (!envelopeCheck.ok) {
    return { ok: false, failures: envelopeCheck.failures };
  }

  const contextCheck = createExecutionContext(spec, {
    runId: assignment.runId,
    assignmentId,
    capabilityKey: assignment.capabilityKey,
    executorKey: assignment.executorKey,
    inputArtifactRefs,
    outputContract: assignment.outputContract,
    executorConfigurationSnapshot: envelopeCheck.value.executorConfigurationSnapshot,
    createdAt: assignment.createdAt,
    deadline: assignment.deadline,
  });
  if (!contextCheck.ok) {
    return { ok: false, failures: contextCheck.failures };
  }

  return {
    ok: true,
    value: {
      assignmentId,
      envelope: envelopeCheck.value,
      envelopeHash: hashExecutorEnvelope(envelopeCheck.value),
      context: contextCheck.value,
      contextHash: contextCheck.value.contextHash,
    },
  };
}
