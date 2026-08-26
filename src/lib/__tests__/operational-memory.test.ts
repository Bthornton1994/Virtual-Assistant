import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_MEMORY_SCHEMA_VERSION,
  createOperationalMemory,
  expireOperationalMemory,
  invalidateOperationalMemory,
  promoteOperationalMemory,
  recordMemoryConflict,
  validateOperationalMemory,
  type OperationalMemory,
} from "@/lib/operational-memory";

const HASH = "c".repeat(64);

function memory(overrides: Partial<Omit<OperationalMemory, "memoryHash">> = {}) {
  return {
    schemaVersion: OPERATIONAL_MEMORY_SCHEMA_VERSION,
    memoryId: "memory-001",
    kind: "operational" as const,
    status: "candidate" as const,
    subjectKey: "crm.next-step.policy",
    value: { nextStepRequired: true, source: "approved playbook" },
    scope: {
      organizationId: "org-001",
      scopeKind: "organization" as const,
      scopeKey: "org-001",
    },
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
    invalidatedAt: null,
    invalidationReason: null,
    conflictSetId: null,
    ...overrides,
  };
}

function create(overrides: Partial<Omit<OperationalMemory, "memoryHash">> = {}): OperationalMemory {
  const created = createOperationalMemory(memory(overrides));
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.failures.join("; "));
  return created.value;
}

describe("operational memory v1", () => {
  it("creates and hash-binds a candidate memory", () => {
    const created = create();
    expect(created.status).toBe("candidate");
    expect(created.memoryHash).toHaveLength(64);
    expect(validateOperationalMemory(created).ok).toBe(true);
  });

  it("requires approval before promotion and preserves provenance", () => {
    const promoted = promoteOperationalMemory(create(), "manager-001");
    expect(promoted.ok).toBe(true);
    if (promoted.ok) {
      expect(promoted.value.status).toBe("verified");
      expect(promoted.value.provenance.approverId).toBe("manager-001");
      expect(promoted.value.provenance.sourceKind).toBe("human_decision");
    }

    const unapproved = validateOperationalMemory({
      ...create(),
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
      expect(new Set(conflict.value.memories.map((item) => item.status))).toEqual(new Set(["conflicted"]));
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

  it("rejects cross-organization conflicts and tampered bodies", () => {
    const left = create({ memoryId: "memory-left" });
    const right = create({
      memoryId: "memory-right",
      scope: { organizationId: "org-002", scopeKind: "organization", scopeKey: "org-002" },
    });
    const conflict = recordMemoryConflict([left, right]);
    expect(conflict.ok).toBe(false);
    expect(conflict.ok ? [] : conflict.failures.join(" ")).toContain("exact scope");

    const tampered = validateOperationalMemory({ ...left, value: { nextStepRequired: false } });
    expect(tampered.ok).toBe(false);
    expect(tampered.ok ? [] : tampered.failures.join(" ")).toContain("memoryHash");
  });

  it("only expires after the declared deadline and supports explicit invalidation", () => {
    const beforeDeadline = expireOperationalMemory(create(), "2026-09-30T00:00:00Z");
    expect(beforeDeadline.ok).toBe(false);
    expect(beforeDeadline.ok ? [] : beforeDeadline.failures.join(" ")).toContain("not reached");

    const expired = expireOperationalMemory(create(), "2026-10-01T00:00:00Z");
    expect(expired.ok).toBe(true);
    if (expired.ok) expect(expired.value.status).toBe("expired");

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
});
