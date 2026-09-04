import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_MEMORY_SCHEMA_VERSION,
  createOperationalMemory,
  expireOperationalMemory,
  invalidateOperationalMemory,
  promoteOperationalMemory,
  recordMemoryConflict,
  resolveMemoryConflict,
  validateOperationalMemory,
  type OperationalMemory,
  type OperationalMemoryInput,
} from "@/lib/operational-memory";

const HASH = "c".repeat(64);

type MemoryOverrides = Partial<OperationalMemoryInput>;

function memory(overrides: MemoryOverrides = {}) {
  return {
    schemaVersion: OPERATIONAL_MEMORY_SCHEMA_VERSION,
    memoryId: "memory-001",
    kind: "operational" as const,
    status: "candidate" as const,
    subjectKey: "crm.next-step.policy",
    claim: "The CRM next step is required before a request can be delivered.",
    value: { nextStepRequired: true, source: "approved playbook" },
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
  const created = createOperationalMemory(memory(overrides));
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.failures.join("; "));
  return created.value;
}

describe("operational memory v1", () => {
  it("creates and hash-binds a candidate memory", () => {
    const created = create();
    expect(created.status).toBe("candidate");
    expect(created.revision).toBe(1);
    expect(created.supersedesHash).toBeNull();
    expect(created.memoryHash).toHaveLength(64);
    expect(validateOperationalMemory(created).ok).toBe(true);
  });

  it("requires approval before promotion, preserves provenance, and appends lineage", () => {
    const candidate = create();
    const promoted = promoteOperationalMemory(candidate, "manager-001");
    expect(promoted.ok).toBe(true);
    if (promoted.ok) {
      expect(promoted.value.status).toBe("verified");
      expect(promoted.value.revision).toBe(2);
      expect(promoted.value.supersedesHash).toBe(candidate.memoryHash);
      expect(promoted.value.provenance.approverId).toBe("manager-001");
      expect(promoted.value.provenance.sourceKind).toBe("human_decision");
    }

    expect(candidate.status).toBe("candidate");
    const unapproved = validateOperationalMemory({
      ...candidate,
      status: "verified",
    });
    expect(unapproved.ok).toBe(false);
    expect(unapproved.ok ? [] : unapproved.failures.join(" ")).toContain("approver");
  });

  it("preserves competing facts as a conflict set instead of overwriting", () => {
    const left = create({ memoryId: "memory-left", value: { nextStepRequired: true } });
    const right = create({ memoryId: "memory-right", value: { nextStepRequired: false } });
    const conflict = recordMemoryConflict([left, right]);
    expect(conflict.ok).toBe(true);
    if (conflict.ok) {
      expect(conflict.value.memories).toHaveLength(2);
      expect(conflict.value.memories.every((item) => item.status === "conflicted")).toBe(true);
      expect(conflict.value.memories.every((item) => item.revision === 2)).toBe(true);
      expect(new Set(conflict.value.memories.map((item) => item.conflictSetId))).toEqual(
        new Set([conflict.value.conflictSetId]),
      );
      expect(conflict.value.memories.map((item) => item.value)).toEqual([
        { nextStepRequired: true },
        { nextStepRequired: false },
      ]);
      expect(promoteOperationalMemory(conflict.value.memories[0], "manager-001").ok).toBe(false);
    }
  });

  it("requires explicit conflict resolution and preserves the losing lineage", () => {
    const conflict = recordMemoryConflict([
      create({ memoryId: "memory-left", value: { nextStepRequired: true } }),
      create({ memoryId: "memory-right", value: { nextStepRequired: false } }),
    ]);
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) return;

    const resolved = resolveMemoryConflict(
      conflict.value.memories,
      "memory-left",
      "manager-001",
      "2026-09-02T00:00:00Z",
      "Owner confirmed the approved playbook remains authoritative.",
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.winner.status).toBe("verified");
      expect(resolved.value.winner.revision).toBe(3);
      expect(resolved.value.winner.provenance.approverId).toBe("manager-001");
      expect(resolved.value.winner.conflictSetId).toBeNull();
      expect(resolved.value.invalidatedAlternatives).toHaveLength(1);
      expect(resolved.value.invalidatedAlternatives[0].status).toBe("invalidated");
      expect(resolved.value.invalidatedAlternatives[0].invalidationReason).toContain("memory-left");
    }
  });

  it("rejects cross-organization, duplicate-id, and identical-value conflicts", () => {
    const left = create({ memoryId: "memory-left" });
    const right = create({
      memoryId: "memory-right",
      scope: { organizationId: "org-002", scopeKind: "organization", scopeKey: "org-002" },
    });
    const crossOrganization = recordMemoryConflict([left, right]);
    expect(crossOrganization.ok).toBe(false);
    expect(crossOrganization.ok ? [] : crossOrganization.failures.join(" ")).toContain("exact scope");

    const duplicateId = recordMemoryConflict([left, left]);
    expect(duplicateId.ok).toBe(false);
    expect(duplicateId.ok ? [] : duplicateId.failures.join(" ")).toContain("repeat a memoryId");

    const identicalValue = recordMemoryConflict([
      left,
      create({ memoryId: "memory-right", value: { nextStepRequired: true, source: "approved playbook" } }),
    ]);
    expect(identicalValue.ok).toBe(false);
    expect(identicalValue.ok ? [] : identicalValue.failures.join(" ")).toContain("different values");
  });

  it("rejects mismatched scoped provenance and mixed conflict claims", () => {
    const mismatched = createOperationalMemory({
      ...memory({
        scope: { organizationId: "org-001", scopeKind: "run", scopeKey: "run-001" },
        retentionClass: "run",
      }),
      provenance: {
        ...memory().provenance,
        sourceKind: "executor_output",
        sourceRunId: "run-002",
      },
    });
    expect(mismatched.ok).toBe(false);
    expect(mismatched.ok ? [] : mismatched.failures.join(" ")).toContain(
      "sourceRunId must match",
    );

    const conflict = recordMemoryConflict([
      create({ memoryId: "memory-left", value: { nextStepRequired: true } }),
      create({ memoryId: "memory-right", value: { nextStepRequired: false } }),
    ]);
    expect(conflict.ok).toBe(true);
    if (!conflict.ok) throw new Error(conflict.failures.join("; "));

    const original = conflict.value.memories[1];
    const { memoryHash: _memoryHash, ...body } = original;
    const forged = createOperationalMemory({
      ...body,
      claim: "A different claim is being smuggled into the conflict set.",
    });
    expect(forged.ok).toBe(true);
    if (!forged.ok) throw new Error(forged.failures.join("; "));

    const resolved = resolveMemoryConflict(
      [conflict.value.memories[0], forged.value],
      "memory-left",
      "manager-001",
      "2026-09-02T00:00:00Z",
      "Should not resolve mixed claims.",
    );
    expect(resolved.ok).toBe(false);
    expect(resolved.ok ? [] : resolved.failures.join(" ")).toContain(
      "same logical claim",
    );
  });

  it("only expires after the declared deadline and supports explicit invalidation", () => {
    const beforeDeadline = expireOperationalMemory(create(), "2026-09-30T00:00:00Z");
    expect(beforeDeadline.ok).toBe(false);
    expect(beforeDeadline.ok ? [] : beforeDeadline.failures.join(" ")).toContain("not reached");

    const expired = expireOperationalMemory(create(), "2026-10-01T00:00:00Z");
    expect(expired.ok).toBe(true);
    if (expired.ok) {
      expect(expired.value.status).toBe("expired");
      expect(expired.value.expiredAt).toBe("2026-10-01T00:00:00Z");
      expect(expired.value.revision).toBe(2);
    }

    const invalidated = invalidateOperationalMemory(
      create(),
      "2026-08-26T00:00:00Z",
      "Source was superseded by an owner correction.",
    );
    expect(invalidated.ok).toBe(true);
    if (invalidated.ok) {
      expect(invalidated.value.status).toBe("invalidated");
      expect(invalidated.value.invalidationReason).toContain("superseded");
    }
  });

  it("rejects impossible retention, scope, and chronology combinations", () => {
    const indefinite = createOperationalMemory(
      memory({ retentionClass: "indefinite", expiresAt: "2026-10-01T00:00:00Z" }),
    );
    expect(indefinite.ok).toBe(false);
    expect(indefinite.ok ? [] : indefinite.failures.join(" ")).toContain("indefinite");

    const workingOrganization = createOperationalMemory(
      memory({ kind: "working" }),
    );
    expect(workingOrganization.ok).toBe(false);
    expect(workingOrganization.ok ? [] : workingOrganization.failures.join(" ")).toContain(
      "working memory must be scoped",
    );

    const backwardsReview = createOperationalMemory(
      memory({ reviewAfter: "2026-08-25T19:00:00Z" }),
    );
    expect(backwardsReview.ok).toBe(false);
    expect(backwardsReview.ok ? [] : backwardsReview.failures.join(" ")).toContain(
      "reviewAfter must not precede",
    );
  });

  it("requires run provenance for executor output", () => {
    const invalid = createOperationalMemory({
      ...memory(),
      provenance: {
        ...memory().provenance,
        sourceKind: "executor_output",
        sourceRunId: null,
      },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? [] : invalid.failures.join(" ")).toContain("sourceRunId");
  });
});
