import { z } from "zod";
import {
  CAPABILITY_DEFINITIONS,
  CAPABILITY_KEYS,
  getCapabilityDefinition,
  type CapabilityKey,
} from "@/lib/capability-registry";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { authorityReportSchema, identifierString, isoDateTimeSchema } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";

export const EXECUTOR_ENVELOPE_SCHEMA_VERSION = "executor-envelope/v1" as const;
export const EXECUTOR_RESULT_SCHEMA_VERSION = "executor-result/v1" as const;

export const EXECUTOR_PHASES = ["prepare", "review", "validate"] as const;
export const EXECUTOR_RESULT_STATUSES = ["completed", "failed", "blocked", "inconclusive"] as const;
export const EXECUTOR_KINDS = ["agent", "deterministic", "human"] as const;
export const ACTION_CLASSES = [
  "prepare_only",
  "low_risk_execution",
  "external_execution",
  "sensitive_execution",
] as const;

const nonNegativeFinite = z.number().finite().min(0);
const nonNegativeInteger = z.number().int().min(0);

export const artifactReferenceSchema = z
  .object({
    artifactId: identifierString,
    schemaVersion: identifierString,
    contentHash: sha256HexSchema,
  })
  .strict();

export const authoritySnapshotSchema = z
  .object({
    contractVersion: identifierString,
    actionClass: z.enum(ACTION_CLASSES),
    allowedActions: z.array(identifierString),
    forbiddenActions: z.array(identifierString),
    mayOwnAuthoritativeState: z.literal(false),
  })
  .strict();

export const outputContractSchema = z
  .object({
    schemaVersion: identifierString,
    artifactKind: identifierString,
  })
  .strict();

export const evidenceRequirementsSchema = z
  .object({
    requiredArtifactSchemaVersions: z.array(identifierString),
    requiredSourceProvenance: z.array(identifierString),
    independentReviewRequired: z.boolean(),
  })
  .strict();

export const economicLimitSchema = z
  .object({
    currency: z.literal("USD"),
    maxHumanMinutes: nonNegativeFinite,
    maxAiCostMicros: nonNegativeInteger,
    maxToolCostMicros: nonNegativeInteger,
  })
  .strict();

export const executorConfigurationSnapshotSchema = z
  .object({
    executorKey: identifierString,
    executorKind: z.enum(EXECUTOR_KINDS),
    provider: identifierString,
    protocolVersion: identifierString,
    modelId: identifierString.nullable(),
    configHash: sha256HexSchema.nullable(),
  })
  .strict();

export const executorEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(EXECUTOR_ENVELOPE_SCHEMA_VERSION),
    runId: identifierString,
    assignmentId: identifierString,
    capabilityKey: identifierString,
    phase: z.enum(EXECUTOR_PHASES),
    objective: identifierString,
    inputArtifactRefs: z.array(artifactReferenceSchema),
    authoritySnapshot: authoritySnapshotSchema,
    allowedToolClasses: z.array(identifierString),
    outputContract: outputContractSchema,
    evidenceRequirements: evidenceRequirementsSchema,
    economicLimit: economicLimitSchema,
    createdAt: isoDateTimeSchema,
    deadline: isoDateTimeSchema,
    executorConfigurationSnapshot: executorConfigurationSnapshotSchema,
  })
  .strict();

export type ExecutorEnvelopeV1 = z.infer<typeof executorEnvelopeV1Schema>;

const escalationSchema = z
  .object({
    required: z.boolean(),
    reason: z.string(),
  })
  .strict();

const economicsSchema = z
  .object({
    humanMinutes: nonNegativeFinite,
    aiCostMicros: nonNegativeInteger,
    toolCostMicros: nonNegativeInteger,
  })
  .strict();

const executionProvenanceSchema = z
  .object({
    executorKey: identifierString,
    executorKind: z.enum(EXECUTOR_KINDS),
    provider: identifierString,
    protocolVersion: identifierString,
    modelId: identifierString.nullable(),
    configHash: sha256HexSchema.nullable(),
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const executorResultV1Schema = z
  .object({
    schemaVersion: z.literal(EXECUTOR_RESULT_SCHEMA_VERSION),
    runId: identifierString,
    assignmentId: identifierString,
    capabilityKey: identifierString,
    status: z.enum(EXECUTOR_RESULT_STATUSES),
    outputArtifactRef: artifactReferenceSchema.nullable(),
    candidatePayload: z.record(z.string(), z.unknown()).nullable(),
    evidenceRefs: z.array(artifactReferenceSchema),
    escalation: escalationSchema,
    authorityReport: authorityReportSchema,
    economics: economicsSchema,
    failure: z
      .object({
        code: identifierString,
        message: identifierString,
      })
      .strict()
      .nullable(),
    executionProvenance: executionProvenanceSchema,
  })
  .strict();

export type ExecutorResultV1 = z.infer<typeof executorResultV1Schema>;

export type EnvelopeValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function duplicateIds(refs: readonly { artifactId: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ref of refs) {
    if (seen.has(ref.artifactId)) duplicates.add(ref.artifactId);
    seen.add(ref.artifactId);
  }
  return [...duplicates].sort();
}

function dateValue(value: string): number {
  return Date.parse(value);
}

export function validateExecutorEnvelope(input: unknown): EnvelopeValidationResult<ExecutorEnvelopeV1> {
  const parsed = executorEnvelopeV1Schema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Envelope ") };

  const envelope = parsed.data;
  const failures: string[] = [];
  const definition = getCapabilityDefinition(envelope.capabilityKey);
  if (!definition || !CAPABILITY_KEYS.includes(envelope.capabilityKey as CapabilityKey)) {
    failures.push("Envelope capabilityKey is not registered.");
  } else {
    if (definition.status !== "active") {
      failures.push("Envelope capabilityKey is not active.");
    }
    if (!definition.outputContractVersions.includes(envelope.outputContract.schemaVersion)) {
      failures.push("Envelope outputContract.schemaVersion is not declared by the capability.");
    }
    for (const artifact of envelope.inputArtifactRefs) {
      if (
        definition.inputContractVersions.length > 0 &&
        !definition.inputContractVersions.includes(artifact.schemaVersion)
      ) {
        failures.push(
          "Envelope input artifact schemaVersion is not declared by the capability: " + artifact.schemaVersion,
        );
      }
    }
  }

  if (envelope.phase === "validate" && envelope.executorConfigurationSnapshot.executorKind !== "deterministic") {
    failures.push("Envelope validate phase requires a deterministic executor.");
  }
  if (envelope.authoritySnapshot.actionClass === "prepare_only" && envelope.authoritySnapshot.mayOwnAuthoritativeState) {
    failures.push("Envelope prepare_only action cannot own authoritative state.");
  }
  if (duplicateIds(envelope.inputArtifactRefs).length > 0) {
    failures.push("Envelope inputArtifactRefs contains duplicate artifactId values.");
  }
  if (dateValue(envelope.deadline) < dateValue(envelope.createdAt)) {
    failures.push("Envelope deadline must not precede createdAt.");
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: envelope };
}

export function validateExecutorResult(
  input: unknown,
  governingEnvelope: unknown,
): EnvelopeValidationResult<ExecutorResultV1> {
  const envelopeCheck = validateExecutorEnvelope(governingEnvelope);
  if (!envelopeCheck.ok) return { ok: false, failures: envelopeCheck.failures.map((failure) => "Governing " + failure) };

  const parsed = executorResultV1Schema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Result ") };

  const result = parsed.data;
  const envelope = envelopeCheck.value;
  const failures: string[] = [];
  const config = envelope.executorConfigurationSnapshot;
  const provenance = result.executionProvenance;

  if (result.runId !== envelope.runId) failures.push("Result runId does not match envelope.");
  if (result.assignmentId !== envelope.assignmentId) failures.push("Result assignmentId does not match envelope.");
  if (result.capabilityKey !== envelope.capabilityKey) failures.push("Result capabilityKey does not match envelope.");
  if (provenance.executorKey !== config.executorKey) failures.push("Result provenance executorKey does not match envelope.");
  if (provenance.executorKind !== config.executorKind) failures.push("Result provenance executorKind does not match envelope.");
  if (provenance.provider !== config.provider) failures.push("Result provenance provider does not match envelope.");
  if (provenance.protocolVersion !== config.protocolVersion) failures.push("Result provenance protocolVersion does not match envelope.");
  if (provenance.modelId !== config.modelId) failures.push("Result provenance modelId does not match envelope.");
  if (provenance.configHash !== config.configHash) failures.push("Result provenance configHash does not match envelope.");
  if (result.outputArtifactRef && result.outputArtifactRef.schemaVersion !== envelope.outputContract.schemaVersion) {
    failures.push("Result outputArtifactRef.schemaVersion does not match envelope outputContract.");
  }
  if (duplicateIds(result.evidenceRefs).length > 0) {
    failures.push("Result evidenceRefs contains duplicate artifactId values.");
  }
  if (result.status === "completed" && !result.outputArtifactRef && !result.candidatePayload) {
    failures.push("Completed result must include outputArtifactRef or candidatePayload.");
  }
  if (result.status !== "completed" && !result.failure && !result.escalation.required) {
    failures.push("Non-completed result must include failure or required escalation.");
  }
  if (envelope.authoritySnapshot.actionClass === "prepare_only" &&
      Object.values(result.authorityReport).some((count) => count !== 0)) {
    failures.push("Prepare-only result reports an external authority action.");
  }
  if (result.economics.humanMinutes > envelope.economicLimit.maxHumanMinutes) {
    failures.push("Result humanMinutes exceed the envelope limit.");
  }
  if (result.economics.aiCostMicros > envelope.economicLimit.maxAiCostMicros) {
    failures.push("Result aiCostMicros exceed the envelope limit.");
  }
  if (result.economics.toolCostMicros > envelope.economicLimit.maxToolCostMicros) {
    failures.push("Result toolCostMicros exceed the envelope limit.");
  }
  if (provenance.completedAt && dateValue(provenance.completedAt) < dateValue(provenance.startedAt)) {
    failures.push("Result completedAt must not precede startedAt.");
  }
  if (provenance.completedAt && dateValue(provenance.completedAt) > dateValue(envelope.deadline)) {
    failures.push("Result completedAt exceeds the envelope deadline.");
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: result };
}

export function canonicalExecutorJson(value: unknown): string {
  return canonicalJsonStringify(value);
}

export function hashExecutorEnvelope(envelope: ExecutorEnvelopeV1): string {
  return sha256Hex(envelope);
}

export function hashExecutorResult(result: ExecutorResultV1): string {
  return sha256Hex(result);
}

export function isCapabilityKeyForEnvelope(value: string): value is CapabilityKey {
  return CAPABILITY_DEFINITIONS.some((definition) => definition.key === value);
}
