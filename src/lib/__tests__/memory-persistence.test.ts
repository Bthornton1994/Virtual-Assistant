import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { memoryPersistenceEnvelope } from "@/lib/memory-persistence";

const MEMORY_HASH = "f".repeat(64);

function candidateMemory() {
  return {
    schemaVersion: "operational-memory/v1" as const,
    memoryId: "memory-persistence-001",
    revision: 1,
    kind: "operational" as const,
    status: "candidate" as const,
    subjectKey: "delivery.policy",
    claim: "A delivery requires a reviewed next step.",
    value: { nextStepRequired: true, source: "human" },
    scope: {
      organizationId: "org-001",
      scopeKind: "organization" as const,
      scopeKey: "org-001",
    },
    sensitivity: "internal" as const,
    retentionClass: "standard" as const,
    provenance: {
      sourceKind: "human_decision" as const,
      sourceArtifactRefs: [
        {
          artifactId: "decision-001",
          schemaVersion: "decision/v1",
          contentHash: MEMORY_HASH,
        },
      ],
      sourceRunId: null,
      sourceAssignmentId: null,
      observedAt: "2026-08-25T20:00:00Z",
      recordedAt: "2026-08-25T20:01:00Z",
      recordedBy: "owner-001",
      approverId: null,
    },
    reviewAfter: "2026-09-15T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
    expiredAt: null,
    invalidatedAt: null,
    invalidationReason: null,
    conflictSetId: null,
    supersedesHash: null,
  };
}

describe("memory persistence boundary", () => {
  it("produces canonical hash-excluded bytes for the database verifier", () => {
    const input = candidateMemory();
    const result = memoryPersistenceEnvelope(input);

    expect(result.memory.memoryHash).toBe(sha256Hex(JSON.parse(result.canonicalBody)));
    expect(result.canonicalBody).not.toContain("memoryHash");
    expect(JSON.parse(result.canonicalBody)).toEqual(
      Object.fromEntries(Object.entries(result.memory).filter(([key]) => key !== "memoryHash")),
    );
  });

  it("rejects a caller-supplied memory hash that does not match the body", () => {
    expect(() =>
      memoryPersistenceEnvelope({
        ...candidateMemory(),
        memoryHash: "0".repeat(64),
      }),
    ).toThrow("memoryHash");
  });
});
