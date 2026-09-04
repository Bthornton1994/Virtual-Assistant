import { z } from "zod";
import { artifactReferenceSchema } from "@/lib/executor-envelope";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
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
export const MEMORY_SENSITIVITIES = ["public", "internal", "confidential", "restricted"] as const;
export const MEMORY_RETENTION_CLASSES = ["run", "short", "standard", "long", "indefinite"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];
export type MemoryRetentionClass = (typeof MEMORY_RETENTION_CLASSES)[number];

const memoryValueSchema = z.union([
  z.string().max(20_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const memoryClaimSchema = nonEmptyString.max(2_000);
const memoryReasonSchema = nonEmptyString.max(2_000);

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

    if (
      (provenance.sourceKind === "executor_output" || provenance.sourceKind === "historical_run") &&
      provenance.sourceRunId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceRunId"],
        message: `${provenance.sourceKind} provenance requires sourceRunId.`,
      });
    }
  });

export type MemoryProvenance = z.infer<typeof memoryProvenanceSchema>;

const memoryBodySchema = z
  .object({
    schemaVersion: z.literal(OPERATIONAL_MEMORY_SCHEMA_VERSION),
    memoryId: identifierString,
    revision: z.number().int().min(1).default(1),
    kind: z.enum(MEMORY_KINDS),
    status: z.enum(MEMORY_STATUSES),
    subjectKey: identifierString,
    claim: memoryClaimSchema,
    value: memoryValueSchema,
    scope: memoryScopeSchema,
    sensitivity: z.enum(MEMORY_SENSITIVITIES).default("internal"),
    retentionClass: z.enum(MEMORY_RETENTION_CLASSES).default("standard"),
    provenance: memoryProvenanceSchema,
    reviewAfter: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
    expiredAt: isoDateTimeSchema.nullable().default(null),
    invalidatedAt: isoDateTimeSchema.nullable(),
    invalidationReason: memoryReasonSchema.nullable(),
    conflictSetId: identifierString.nullable(),
    supersedesHash: sha256HexSchema.nullable().default(null),
  })
  .strict();

export type OperationalMemoryInput = z.input<typeof memoryBodySchema>;
export type OperationalMemoryBody = z.output<typeof memoryBodySchema>;

export const operationalMemorySchema = memoryBodySchema
  .extend({
    memoryHash: sha256HexSchema,
  })
  .strict()
  .superRefine((memory, context) => {
    const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });
    const recordedAt = Date.parse(memory.provenance.recordedAt);

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

    if (memory.status === "expired") {
      if (memory.expiresAt === null) issue(["expiresAt"], "expired memory requires expiresAt");
      if (memory.expiredAt === null) issue(["expiredAt"], "expired memory requires expiredAt");
    } else if (memory.expiredAt !== null) {
      issue([], "only expired memory may carry expiredAt");
    }

    if (
      memory.reviewAfter !== null &&
      memory.expiresAt !== null &&
      Date.parse(memory.reviewAfter) > Date.parse(memory.expiresAt)
    ) {
      issue(["reviewAfter"], "reviewAfter must not be later than expiresAt");
    }
    if (memory.reviewAfter !== null && Date.parse(memory.reviewAfter) < recordedAt) {
      issue(["reviewAfter"], "reviewAfter must not precede recordedAt");
    }
    if (memory.expiresAt !== null && Date.parse(memory.expiresAt) < recordedAt) {
      issue(["expiresAt"], "expiresAt must not precede recordedAt");
    }
    if (memory.invalidatedAt !== null && Date.parse(memory.invalidatedAt) < recordedAt) {
      issue(["invalidatedAt"], "invalidatedAt must not precede recordedAt");
    }
    if (
      memory.expiredAt !== null &&
      memory.expiresAt !== null &&
      Date.parse(memory.expiredAt) < Date.parse(memory.expiresAt)
    ) {
      issue(["expiredAt"], "expiredAt must not precede expiresAt");
    }

    if (memory.retentionClass === "indefinite" && memory.expiresAt !== null) {
      issue(["expiresAt"], "indefinite memory cannot carry an expiresAt deadline");
    }
    if (memory.retentionClass !== "indefinite" && memory.expiresAt === null) {
      issue(["expiresAt"], "non-indefinite memory requires an expiresAt deadline");
    }
    if (memory.retentionClass === "run" && !["run", "assignment"].includes(memory.scope.scopeKind)) {
      issue(["scope", "scopeKind"], "run-retained memory must be scoped to a run or assignment");
    }
    if (memory.kind === "working" && !["run", "assignment"].includes(memory.scope.scopeKind)) {
      issue(["scope", "scopeKind"], "working memory must be scoped to a run or assignment");
    }

    if (memory.revision === 1 && memory.supersedesHash !== null) {
      issue(["supersedesHash"], "revision 1 cannot supersede another memory revision");
    }
    if (memory.revision > 1 && memory.supersedesHash === null) {
      issue(["supersedesHash"], "revisions after 1 require supersedesHash lineage");
    }
    if (memory.supersedesHash === memory.memoryHash) {
      issue(["supersedesHash"], "a memory revision cannot supersede itself");
    }

    if (hasDuplicates(memory.provenance.sourceArtifactRefs.map((ref) => ref.artifactId))) {
      issue(["provenance", "sourceArtifactRefs"], "source artifact IDs must be unique");
    }

    try {
      const serializedValue = canonicalJsonStringify(memory.value);
      if (serializedValue.length > 50_000) {
        issue(["value"], "memory value exceeds the 50,000-character limit");
      }
    } catch {
      issue(["value"], "memory value must be canonicalizable JSON");
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

type TransitionPatch = Partial<
  Pick<
    OperationalMemory,
    "status" | "provenance" | "expiredAt" | "invalidatedAt" | "invalidationReason" | "conflictSetId"
  >
>;

function transitionMemory(current: OperationalMemory, patch: TransitionPatch): OperationalMemoryResult<OperationalMemory> {
  return createOperationalMemory({
    ...withoutHash(current),
    ...patch,
    revision: current.revision + 1,
    supersedesHash: current.memoryHash,
  });
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

export function createOperationalMemory(input: OperationalMemoryInput): OperationalMemoryResult<OperationalMemory> {
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

  return transitionMemory(current.value, {
    status: "verified",
    provenance: {
      ...current.value.provenance,
      approverId: approver.data,
    },
    conflictSetId: null,
    expiredAt: null,
    invalidatedAt: null,
    invalidationReason: null,
  });
}

export function invalidateOperationalMemory(
  input: unknown,
  invalidatedAt: string,
  reason: string,
): OperationalMemoryResult<OperationalMemory> {
  const current = validateOperationalMemory(input);
  if (!current.ok) return current;
  if (["archived", "expired", "invalidated"].includes(current.value.status)) {
    return { ok: false, failures: ["Archived, expired, or invalidated memory cannot be invalidated."] };
  }
  if (current.value.status === "conflicted") {
    return { ok: false, failures: ["Resolve a conflict set before invalidating a conflicted memory."] };
  }

  const timestamp = isoDateTimeSchema.safeParse(invalidatedAt);
  const parsedReason = memoryReasonSchema.safeParse(reason);
  const failures: string[] = [];
  if (!timestamp.success) failures.push("invalidatedAt: " + timestamp.error.issues[0].message);
  if (!parsedReason.success) failures.push("invalidationReason: " + parsedReason.error.issues[0].message);
  if (!timestamp.success || !parsedReason.success) return { ok: false, failures };
  if (Date.parse(timestamp.data) < Date.parse(current.value.provenance.recordedAt)) {
    return { ok: false, failures: ["invalidatedAt must not precede recordedAt."] };
  }

  return transitionMemory(current.value, {
    status: "invalidated",
    invalidatedAt: timestamp.data,
    invalidationReason: parsedReason.data,
    conflictSetId: null,
    expiredAt: null,
  });
}

export function expireOperationalMemory(
  input: unknown,
  expiredAt: string,
): OperationalMemoryResult<OperationalMemory> {
  const current = validateOperationalMemory(input);
  if (!current.ok) return current;
  if (["archived", "invalidated", "expired"].includes(current.value.status)) {
    return { ok: false, failures: ["Archived, invalidated, or expired memory cannot expire."] };
  }
  if (current.value.status === "conflicted") {
    return { ok: false, failures: ["Resolve a conflict set before expiring conflicted memory."] };
  }
  if (current.value.expiresAt === null) {
    return { ok: false, failures: ["Memory has no expiresAt deadline."] };
  }

  const timestamp = isoDateTimeSchema.safeParse(expiredAt);
  if (!timestamp.success) return { ok: false, failures: ["expiredAt: " + timestamp.error.issues[0].message] };
  if (Date.parse(current.value.expiresAt) > Date.parse(timestamp.data)) {
    return { ok: false, failures: ["Memory has not reached its expiresAt deadline."] };
  }

  return transitionMemory(current.value, {
    status: "expired",
    expiredAt: timestamp.data,
    conflictSetId: null,
    invalidatedAt: null,
    invalidationReason: null,
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
  const seenIds = new Set<string>();

  inputs.forEach((input, index) => {
    const checked = validateOperationalMemory(input);
    if (!checked.ok) {
      failures.push(...checked.failures.map((failure) => "Memory " + index + " " + failure));
      return;
    }
    if (seenIds.has(checked.value.memoryId)) {
      failures.push("Conflict inputs must not repeat a memoryId.");
      return;
    }
    seenIds.add(checked.value.memoryId);
    if (!["candidate", "verified"].includes(checked.value.status)) {
      failures.push("Only candidate or verified memories can enter a new conflict.");
      return;
    }
    memories.push(checked.value);
  });
  if (failures.length > 0) return { ok: false, failures };

  const first = memories[0];
  const firstValueHash = sha256Hex(first.value);
  for (const memory of memories.slice(1)) {
    if (memory.kind !== first.kind) failures.push("Conflicting memories must share kind.");
    if (memory.subjectKey !== first.subjectKey) failures.push("Conflicting memories must share subjectKey.");
    if (memory.claim !== first.claim) failures.push("Conflicting memories must share claim.");
    if (
      memory.scope.organizationId !== first.scope.organizationId ||
      memory.scope.scopeKind !== first.scope.scopeKind ||
      memory.scope.scopeKey !== first.scope.scopeKey
    ) {
      failures.push("Conflicting memories must share an exact scope.");
    }
    if (sha256Hex(memory.value) === firstValueHash) {
      failures.push("Conflicting memories must contain different values.");
    }
  }
  if (failures.length > 0) return { ok: false, failures };

  const conflictSetId = sha256Hex({
    memoryIds: memories.map((memory) => memory.memoryId).sort(),
    kind: first.kind,
    subjectKey: first.subjectKey,
    scope: first.scope,
  });

  const conflicted: OperationalMemory[] = [];
  for (const memory of memories) {
    const transitioned = transitionMemory(memory, {
      status: "conflicted",
      conflictSetId,
      expiredAt: null,
      invalidatedAt: null,
      invalidationReason: null,
    });
    if (!transitioned.ok) return transitioned;
    conflicted.push(transitioned.value);
  }

  return { ok: true, value: { conflictSetId, memories: conflicted } };
}

export type MemoryConflictResolution = {
  conflictSetId: string;
  winner: OperationalMemory;
  invalidatedAlternatives: OperationalMemory[];
  resolvedBy: string;
  resolvedAt: string;
  reason: string;
};

export function resolveMemoryConflict(
  inputs: readonly unknown[],
  winnerMemoryId: string,
  approverId: string,
  resolvedAt: string,
  reason: string,
): OperationalMemoryResult<MemoryConflictResolution> {
  if (inputs.length < 2) return { ok: false, failures: ["At least two memories are required for a conflict resolution."] };

  const memories: OperationalMemory[] = [];
  const failures: string[] = [];
  const seenIds = new Set<string>();

  for (const [index, input] of inputs.entries()) {
    const checked = validateOperationalMemory(input);
    if (!checked.ok) {
      failures.push(...checked.failures.map((failure) => "Memory " + index + " " + failure));
      continue;
    }
    if (seenIds.has(checked.value.memoryId)) failures.push("Conflict inputs must not repeat a memoryId.");
    seenIds.add(checked.value.memoryId);
    if (checked.value.status !== "conflicted" || checked.value.conflictSetId === null) {
      failures.push("Only conflicted memories with a conflictSetId can be resolved.");
    }
    memories.push(checked.value);
  }
  if (failures.length > 0) return { ok: false, failures };

  const first = memories[0];
  if (memories.some((memory) => memory.conflictSetId !== first.conflictSetId)) {
    return { ok: false, failures: ["All memories must belong to the same conflict set."] };
  }

  const winner = memories.find((memory) => memory.memoryId === winnerMemoryId);
  if (!winner) return { ok: false, failures: ["winnerMemoryId is not in the conflict set."] };

  const approver = identifierString.safeParse(approverId);
  const timestamp = isoDateTimeSchema.safeParse(resolvedAt);
  const parsedReason = memoryReasonSchema.safeParse(reason);
  if (!approver.success || !timestamp.success || !parsedReason.success) {
    const invalid: string[] = [];
    if (!approver.success) invalid.push("approverId: " + approver.error.issues[0].message);
    if (!timestamp.success) invalid.push("resolvedAt: " + timestamp.error.issues[0].message);
    if (!parsedReason.success) invalid.push("reason: " + parsedReason.error.issues[0].message);
    return { ok: false, failures: invalid };
  }

  const promoted = transitionMemory(winner, {
    status: "verified",
    provenance: {
      ...winner.provenance,
      approverId: approver.data,
    },
    conflictSetId: null,
    expiredAt: null,
    invalidatedAt: null,
    invalidationReason: null,
  });
  if (!promoted.ok) return promoted;

  const invalidatedAlternatives: OperationalMemory[] = [];
  for (const memory of memories.filter((item) => item.memoryId !== winnerMemoryId)) {
    const invalidated = transitionMemory(memory, {
      status: "invalidated",
      invalidatedAt: timestamp.data,
      invalidationReason: `Conflict set ${first.conflictSetId} resolved in favor of ${winnerMemoryId}: ${parsedReason.data}`,
      conflictSetId: null,
      expiredAt: null,
    });
    if (!invalidated.ok) return invalidated;
    invalidatedAlternatives.push(invalidated.value);
  }

  return {
    ok: true,
    value: {
      conflictSetId: first.conflictSetId as string,
      winner: promoted.value,
      invalidatedAlternatives,
      resolvedBy: approver.data,
      resolvedAt: timestamp.data,
      reason: parsedReason.data,
    },
  };
}
