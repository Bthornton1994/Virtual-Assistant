import { describe, expect, it } from "vitest";
import {
  evaluateMemoryCapture,
  type MemoryCaptureProposal,
} from "@/lib/memory-capture";
import { planMemoryConsolidation } from "@/lib/memory-consolidation";
import {
  OPERATIONAL_MEMORY_SCHEMA_VERSION,
  createOperationalMemory,
  invalidateOperationalMemory,
  type OperationalMemory,
  type OperationalMemoryInput,
} from "@/lib/operational-memory";

const HASH = "d".repeat(64);

type MemoryOverrides = Partial<OperationalMemoryInput>;

function memory(overrides: MemoryOverrides = {}) {
  return {
    schemaVersion: OPERATIONAL_MEMORY_SCHEMA_VERSION,
    memoryId: "memory-001",
    kind: "operational" as const,
    status: "candidate" as const,
    subjectKey: "delivery.approval.policy",
    claim: "A delivery requires an approved next step.",
    value: { nextStepRequired: true },
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
          contentHash: HASH,
        },
      ],
      sourceRunId: null,
      sourceAssignmentId: null,
      observedAt: "2026-08-25T20:00:00Z",
      recordedAt: "2026-08-25T20:01:00Z",
      recordedBy: "owner-001",
      approverId: null,
    },
    reviewAfter: "2026-09-01T00:00:00Z",
    expiresAt: "2026-10-01T00:00:00Z",
    expiredAt: null,
    invalidatedAt: null,
    invalidationReason: null,
    conflictSetId: null,
    supersedesHash: null,
    ...overrides,
  };
}

function create(overrides: MemoryOverrides = {}): OperationalMemory {
  const result = createOperationalMemory(memory(overrides));
  if (!result.ok) throw new Error(result.failures.join("; "));
  return result.value;
}

function proposal(
  durability: MemoryCaptureProposal["durability"],
  overrides: Partial<MemoryCaptureProposal> = {},
): MemoryCaptureProposal {
  return {
    schemaVersion: "memory-capture/v1",
    proposalId: "proposal-001",
    durability,
    captureReason: "Approved by a bounded test fixture.",
    memory: memory(),
    ...overrides,
  };
}

describe("memory pipeline", () => {
  it("discards ephemeral material without creating a durable record", () => {
    const result = evaluateMemoryCapture(proposal("ephemeral"));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures.join("; "));
    expect(result.decision).toBe("discard");
    expect(result.candidate).toBeNull();
  });

  it("creates only an unapproved candidate for durable material", () => {
    const result = evaluateMemoryCapture(proposal("durable"));

    expect(result.ok).toBe(true);
    if (!result.ok || result.decision !== "candidate") {
      throw new Error("Expected a candidate capture.");
    }
    expect(result.candidate.status).toBe("candidate");
    expect(result.candidate.provenance.approverId).toBeNull();
  });

  it("does not silently downgrade a pre-approved memory proposal", () => {
    const result = evaluateMemoryCapture(
      proposal("durable", {
        memory: memory({
          status: "verified",
          provenance: {
            ...memory().provenance,
            approverId: "manager-001",
          },
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected pre-approved capture to require review.");
    expect(result.decision).toBe("review");
    expect(result.failures[0]).toContain("status candidate");
  });

  it("requires a finite deadline for expiring material", () => {
    const result = evaluateMemoryCapture(
      proposal("expiring", {
        memory: memory({
          expiresAt: null,
          retentionClass: "indefinite",
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing expiry to require review.");
    expect(result.failures[0]).toContain("expiresAt");
  });

  it("rejects executor-originated capture without a source run", () => {
    const result = evaluateMemoryCapture(
      proposal("durable", {
        memory: memory({
          provenance: {
            ...memory().provenance,
            sourceKind: "executor_output",
            sourceRunId: null,
          },
        }),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing run provenance to require review.");
    expect(result.failures.join(" ")).toContain("sourceRunId");
  });

  it("skips exact active duplicates deterministically", () => {
    const existing = create({ memoryId: "existing-memory" });
    const candidate = create({ memoryId: "new-memory" });
    const result = planMemoryConsolidation(candidate, [existing]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures.join("; "));
    expect(result.action).toBe("skip_duplicate");
    expect(result.matchedMemoryIds).toEqual(["existing-memory"]);
  });

  it("routes differing active values to explicit conflict review", () => {
    const existing = create({ memoryId: "existing-memory", value: { nextStepRequired: true } });
    const candidate = create({
      memoryId: "new-memory",
      value: { nextStepRequired: false },
    });
    const result = planMemoryConsolidation(candidate, [existing]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures.join("; "));
    expect(result.action).toBe("review_conflict");
    expect(result.matchedMemoryIds).toEqual(["existing-memory"]);
  });

  it("allows a new candidate after an old claim is invalidated", () => {
    const invalidated = invalidateOperationalMemory(
      create({ memoryId: "old-memory" }),
      "2026-08-26T00:00:00Z",
      "Owner correction.",
    );
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) throw new Error(invalidated.failures.join("; "));

    const candidate = create({ memoryId: "new-memory", value: { nextStepRequired: false } });
    const result = planMemoryConsolidation(candidate, [invalidated.value]);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures.join("; "));
    expect(result.action).toBe("insert_candidate");
  });
});
