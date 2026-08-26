import { z } from "zod";
import { artifactReferenceSchema } from "@/lib/executor-envelope";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";

export const OPERATIONAL_MEMORY_SCHEMA_VERSION = "operational-memory/v1" as const;

export const MEMORY_KINDS = [
  "working",
  "operational",
  "entity",
  "procedural",
  "preference",
  "historical",
] as const;
export const MEMORY_STATUSES = [
  "candidate",
  "verified",
  "conflicted",
  "expired",
  "invalidated",
  "archived",
] as const;
export const MEMORY_SCOPE_KINDS = [
  "run",
  "assignment",
  "organization",
  "entity",
  "workstream",
  "global",
] as const;
export const MEMORY_SOURCE_KINDS = [
  "executor_output",
  "human_decision",
  "deterministic_validation",
  "historical_run",
  "system_import",
] as const;

const memoryValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const memoryScopeSchema = z
  .object({
    organizationId: identifierString,
    scopeKind: z.enum(MEMORY_SCOPE_KINDS),
    scopeKey: identifierString,
  })
  .strict();

export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryProvenanceSchema = z
  .object({
    sourceKind: z.enum(MEMORY_SOURCE_KINDS),
    sourceArtifactRefs: z.array(artifactReferenceSchema).min(1).max(100),
    sourceRunId: identifierString.nullable(),
    sourceAssignmentId: identifierString.nullable(),
    observedAt: isoDateTimeSchema,
    recordedAt: isoDateTimeSchema,
    recordedBy: identifierString,
    approverId: identifierString.nullable(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (Date.parse(provenance.recordedAt) < Date.parse(provenance.observedAt)) {
      context.addIssue({
        code: "custom",
        path: ["recordedAt"],
        message: "recordedAt must not precede observedAt.",
      });
    }
  });

export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;

const memoryBodySchema = z
  .object({
    schemaVersion: z.literal(OPERATIONAL_MEMORY_SCHEMA_VERSION),
    memoryId: identifierString,
    kind: z.enum(MEMORY_KINDS),
    status: z.enum(MEMORY_STATUSES),
    subjectKey: identifierString,
    value: memoryValueSchema,
    scope: memoryScopeSchema,
    provenance: memoryProvenanceSchema,
    reviewAfter: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
    invalidatedAt: isoDateTimeSchema.nullable(),
    invalidationReason: nonEmptyString.nullable(),
    conflictSetId: identifierString.nullable(),
  })
  .strict();

export const operationalMemorySchema = memoryBodySchema
  .extend({
    memoryHash: sha256HexSchema,
  })
  .strict()
  .superRefine((memory, context) => {
    const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });

    if (memory.status === "verified" && memory.provenance.approverId === null) {
      issue(["provenance", "approverId"], "verified memory requires an approver");
    }
    if (memory.status === "candidate" && memory.provenance.approverId !== null) {
      issue(["provenance", "approverId"], "candidate memory cannot carry an approval");
    }
    if (memory.status === "conflicted" && memory.conflictSetId === null) {
      issue(["conflictSetId"], "conflicted memory requires a conflictSetId");
    }
    if (memory.status !== "conflicted" && memory.conflictSetId !== null) {
      issue(["conflictSetId"], "only conflicted memory may carry a conflictSetId");
    }
    if (memory.status === "invalidated") {
      if (memory.invalidatedAt === null) issue(["invalidatedAt"], "invalidated memory requires invalidatedAt");
      if (memory.invalidationReason === null) {
        issue(["invalidationReason"], "invalidated memory requires an invalidationReason");
      }
    } else if (memory.invalidatedAt !== null || memory.invalidationReason !== null) {
      issue([], "only invalidated memory may carry invalidation metadata");
    }
    if (memory.status === "expired" && memory.expiresAt === null) {
      issue(["expiresAt"], "expired memory requires expiresAt");
    }
    if (
      memory.reviewAfter !== null &&
      memory.expiresAt !== null &&
      Date.parse(memory.reviewAfter) > Date.parse(memory.expiresAt)
    ) {
      issue(["reviewAfter"], "reviewAfter must not be later than expiresAt");
    }
    if (hasDuplicates(memory.provenance.sourceArtifactRefs.map((ref) => ref.artifactId))) {
      issue(["provenance", "sourceArtifactRefs"], "source artifact IDs must be unique");
    }
  });

export type OperationalMemory = z.infer<typeof operationalMemorySchema>;

export type OperationalMemoryResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function withoutHash(memory: OperationalMemory): Omit<OperationalMemory, "memoryHash"> {
  const { memoryHash: _memoryHash, ...rest } = memory;
  return rest;
}

export function hashOperationalMemory(memory: OperationalMemory): string {
  return sha256Hex(withoutHash(memory));
}

export function validateOperationalMemory(input: unknown): OperationalMemoryResult<OperationalMemory> {
  const parsed = operationalMemorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Memory ") };

  if (hashOperationalMemory(parsed.data) !== parsed.data.memoryHash) {
    return {
      ok: false,
      failures: ["Memory memoryHash does not match the canonical memory body."],
    };
  }

  return { ok: true, value: parsed.data };
}

export function createOperationalMemory(
  input: Omit<OperationalMemory, "memoryHash">,
): OperationalMemoryResult<OperationalMemory> {
  const parsed = memoryBodySchema.safeParse(input);
  if (!parsed.success) return { ok: false, failures: issueMessages(parsed.error.issues, "Memory ") };

  const candidate = {
    ...parsed.data,
    memoryHash: sha256Hex(parsed.data),
  };
  return validateOperationalMemory(candidate);
}

export function promoteOperationalMemory(
  input: unknown,
  approverId: string,
): OperationalMemoryResult<OperationalMemory> {
  const current = validateOperationalMemory(input);
  if (!current.ok) return current;
  if (current.value.status !== "candidate") {
    return { ok: false, failures: ["Only candidate memory can be promoted."] };
  }
  const approver = identifierString.safeParse(approverId);
  if (!approver.success) return { ok: false, failures: ["approverId: " + approver.error.issues[0].message] };

  const promotedBody = {
    ...withoutHash(current.value),
    status: "verified" as const,
    provenance: {
      ...current.value.provenance,
      approverId: approver.data,
    },
  };
  return createOperationalMemory(promotedBody);
}

export function invalidateOperationalMemory(
  input: unknown,
  invalidatedAt: string,
  reason: string,
): OperationalMemoryResult<OperationalMemory> {
  const current = validateOperationalMemory(input);
  if (!current.ok) return current;
  if (current.value.status === "archived") {
    return { ok: false, failures: ["Archived memory cannot be invalidated."] };
  }
  const timestamp = isoDateTimeSchema.safeParse(invalidatedAt);
  const parsedReason = nonEmptyString.safeParse(reason);
  const failures: string[] = [];
  if (!timestamp.success) failures.push("invalidatedAt: " + timestamp.error.issues[0].message);
  if (!parsedReason.success) failures.push("invalidationReason: " + parsedReason.error.issues[0].message);
  if (!timestamp.success || !parsedReason.success) return { ok: false, failures };

  return createOperationalMemory({
    ...withoutHash(current.value),
    status: "invalidated",
    invalidatedAt: timestamp.data,
    invalidationReason: parsedReason.data,
    conflictSetId: null,
  });
}

export function expireOperationalMemory(
  input: unknown,
  expiredAt: string,
): OperationalMemoryResult<OperationalMemory> {
  const current = validateOperationalMemory(input);
  if (!current.ok) return current;
  if (current.value.status === "archived" || current.value.status === "invalidated") {
    return { ok: false, failures: ["Archived or invalidated memory cannot expire."] };
  }
  if (current.value.expiresAt === null) {
    return { ok: false, failures: ["Memory has no expiresAt deadline."] };
  }
  const timestamp = isoDateTimeSchema.safeParse(expiredAt);
  if (!timestamp.success) return { ok: false, failures: ["expiredAt: " + timestamp.error.issues[0].message] };
  if (Date.parse(current.value.expiresAt) > Date.parse(timestamp.data)) {
    return { ok: false, failures: ["Memory has not reached its expiresAt deadline."] };
  }

  return createOperationalMemory({
    ...withoutHash(current.value),
    status: "expired",
    conflictSetId: null,
  });
}

export type MemoryConflict = {
  conflictSetId: string;
  memories: OperationalMemory[];
};

export function recordMemoryConflict(
  inputs: readonly unknown[],
): OperationalMemoryResult<MemoryConflict> {
  if (inputs.length < 2) return { ok: false, failures: ["At least two memories are required for a conflict."] };

  const memories: OperationalMemory[] = [];
  const failures: string[] = [];
  inputs.forEach((input, index) => {
    const checked = validateOperationalMemory(input);
    if (!checked.ok) {
      failures.push(...checked.failures.map((failure) => "Memory " + index + " " + failure));
      return;
    }
    if (checked.value.status === "invalidated" || checked.value.status === "archived") {
      failures.push("Memory " + index + " cannot enter a conflict after invalidation or archival.");
      return;
    }
    memories.push(checked.value);
  });
  if (failures.length > 0) return { ok: false, failures };

  const first = memories[0];
  for (const memory of memories.slice(1)) {
    if (memory.kind !== first.kind) failures.push("Conflicting memories must share kind.");
    if (memory.subjectKey !== first.subjectKey) failures.push("Conflicting memories must share subjectKey.");
    if (
      memory.scope.organizationId !== first.scope.organizationId ||
      memory.scope.scopeKind !== first.scope.scopeKind ||
      memory.scope.scopeKey !== first.scope.scopeKey
    ) {
      failures.push("Conflicting memories must share an exact scope.");
    }
  }
  if (failures.length > 0) return { ok: false, failures };

  const conflictSetId = sha256Hex({
    memoryIds: memories.map((memory) => memory.memoryId).sort(),
    organizationId: first.scope.organizationId,
    subjectKey: first.subjectKey,
  });

  const conflicted = memories.map((memory) => ({
    ...withoutHash(memory),
    status: "conflicted" as const,
    conflictSetId,
  }));
  const checkedConflicted: OperationalMemory[] = [];
  for (const memory of conflicted) {
    const checked = createOperationalMemory(memory);
    if (!checked.ok) return checked;
    checkedConflicted.push(checked.value);
  }

  return { ok: true, value: { conflictSetId, memories: checkedConflicted } };
}
