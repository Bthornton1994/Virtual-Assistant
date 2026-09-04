import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  validateOperationalMemory,
  type OperationalMemory,
} from "@/lib/operational-memory";

export const MEMORY_CONSOLIDATION_SCHEMA_VERSION = "memory-consolidation/v1" as const;
export const MEMORY_CONSOLIDATION_ACTIONS = [
  "insert_candidate",
  "skip_duplicate",
  "review_conflict",
] as const;

export type MemoryConsolidationAction =
  (typeof MEMORY_CONSOLIDATION_ACTIONS)[number];

export type MemoryConsolidationResult =
  | {
      ok: true;
      schemaVersion: typeof MEMORY_CONSOLIDATION_SCHEMA_VERSION;
      action: MemoryConsolidationAction;
      candidate: OperationalMemory;
      matchedMemoryIds: string[];
      reason: string;
    }
  | {
      ok: false;
      action: "review_conflict";
      candidate: null;
      matchedMemoryIds: string[];
      failures: string[];
    };

function logicalClaimKey(memory: OperationalMemory): string {
  return [
    memory.scope.organizationId,
    memory.kind,
    memory.subjectKey,
    memory.claim,
    memory.scope.scopeKind,
    memory.scope.scopeKey,
  ].join("\u001f");
}

function issueFor(index: number, failures: readonly string[]): string[] {
  return failures.map((failure) => "Memory " + index + " " + failure);
}

/**
 * Plans consolidation without silently rewriting facts. Exact duplicates can
 * be skipped idempotently. Differing active values become a reviewable
 * conflict. Fuzzy similarity is intentionally not an authority signal.
 */
export function planMemoryConsolidation(
  candidateInput: unknown,
  existingInputs: readonly unknown[],
): MemoryConsolidationResult {
  const checkedCandidate = validateOperationalMemory(candidateInput);
  if (!checkedCandidate.ok) {
    return {
      ok: false,
      action: "review_conflict",
      candidate: null,
      matchedMemoryIds: [],
      failures: checkedCandidate.failures.map((failure) => "Candidate " + failure),
    };
  }

  const candidate = checkedCandidate.value;
  if (candidate.status !== "candidate") {
    return {
      ok: false,
      action: "review_conflict",
      candidate: null,
      matchedMemoryIds: [],
      failures: ["Candidate must have status candidate before consolidation."],
    };
  }

  const existing: OperationalMemory[] = [];
  const failures: string[] = [];
  for (const [index, input] of existingInputs.entries()) {
    const checked = validateOperationalMemory(input);
    if (!checked.ok) {
      failures.push(...issueFor(index, checked.failures));
      continue;
    }
    existing.push(checked.value);
  }
  if (failures.length > 0) {
    return {
      ok: false,
      action: "review_conflict",
      candidate: null,
      matchedMemoryIds: [],
      failures,
    };
  }

  const candidateKey = logicalClaimKey(candidate);
  const candidateValueHash = sha256Hex(candidate.value);
  const sameIdentity = existing.filter(
    (memory) => memory.memoryId === candidate.memoryId,
  );
  const sameClaim = existing.filter(
    (memory) => logicalClaimKey(memory) === candidateKey,
  );
  const matched = [...new Set([...sameIdentity, ...sameClaim].map((memory) => memory.memoryId))].sort();

  const unresolvedConflicts = [...sameIdentity, ...sameClaim].filter(
    (memory) => memory.status === "conflicted",
  );
  if (unresolvedConflicts.length > 0) {
    return {
      ok: true,
      schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
      action: "review_conflict",
      candidate,
      matchedMemoryIds: matched,
      reason: "An unresolved conflict set already covers this logical claim.",
    };
  }

  if (sameIdentity.some((memory) => memory.memoryHash === candidate.memoryHash)) {
    return {
      ok: true,
      schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
      action: "skip_duplicate",
      candidate,
      matchedMemoryIds: matched,
      reason: "The exact memory revision is already present.",
    };
  }

  if (
    sameClaim.some(
      (memory) =>
        ["candidate", "verified", "conflicted"].includes(memory.status) &&
        sha256Hex(memory.value) === candidateValueHash,
    )
  ) {
    return {
      ok: true,
      schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
      action: "skip_duplicate",
      candidate,
      matchedMemoryIds: matched,
      reason: "An active memory with the same logical claim and value is already present.",
    };
  }

  if (
    sameIdentity.length > 0 ||
    sameClaim.some((memory) =>
      ["candidate", "verified", "conflicted"].includes(memory.status),
    )
  ) {
    return {
      ok: true,
      schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
      action: "review_conflict",
      candidate,
      matchedMemoryIds: matched,
      reason: "An active memory shares the identity or logical claim with a different value.",
    };
  }

  return {
    ok: true,
    schemaVersion: MEMORY_CONSOLIDATION_SCHEMA_VERSION,
    action: "insert_candidate",
    candidate,
    matchedMemoryIds: matched,
    reason: "No active memory shares the candidate logical claim.",
  };
}
