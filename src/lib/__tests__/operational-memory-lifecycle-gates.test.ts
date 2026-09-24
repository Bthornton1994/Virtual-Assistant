import { describe, expect, it } from "vitest";
import {
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
    schemaVersion: "operational-memory/v1" as const,
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

describe("operational memory lifecycle fail-closed", () => {
  it("refuses to expire memory that has no deadline or is already closed", () => {
    const noDeadline = expireOperationalMemory(create({ expiresAt: null, reviewAfter: null }), "2026-10-01T00:00:00Z");
    expect(noDeadline.ok).toBe(false);
    expect(noDeadline.ok ? "" : noDeadline.failures.join(" ")).toMatch(/no expiresAt/);

    const invalidated = invalidateOperationalMemory(
      create(),
      "2026-08-26T00:00:00Z",
      "Owner withdrew the source decision.",
    );
    expect(invalidated.ok).toBe(true);
    if (!invalidated.ok) throw new Error(invalidated.failures.join("; "));
    const expireInvalidated = expireOperationalMemory(invalidated.value, "2026-10-01T00:00:00Z");
    expect(expireInvalidated.ok).toBe(false);
    expect(expireInvalidated.ok ? "" : expireInvalidated.failures.join(" ")).toMatch(/cannot expire/);

    const archived = createOperationalMemory(memory({ status: "archived", expiresAt: "2026-10-01T00:00:00Z" }));
    expect(archived.ok).toBe(true);
    if (!archived.ok) throw new Error(archived.failures.join("; "));
    expect(expireOperationalMemory(archived.value, "2026-10-02T00:00:00Z").ok).toBe(false);
    expect(invalidateOperationalMemory(archived.value, "2026-10-02T00:00:00Z", "late wipe").ok).toBe(false);
  });

  it("promotes only candidate memory and rejects a padded approver id", () => {
    const verified = promoteOperationalMemory(create(), "manager-001");
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error(verified.failures.join("; "));
    const again = promoteOperationalMemory(verified.value, "manager-002");
    expect(again.ok).toBe(false);
    expect(again.ok ? "" : again.failures.join(" ")).toMatch(/Only candidate memory/);

    const padded = promoteOperationalMemory(create(), " manager-001 ");
    expect(padded.ok).toBe(false);
    expect(padded.ok ? "" : padded.failures.join(" ")).toMatch(/whitespace|approverId/);
  });

  it("requires two same-scope memories before opening a conflict set", () => {
    const only = recordMemoryConflict([create()]);
    expect(only.ok).toBe(false);
    expect(only.ok ? "" : only.failures.join(" ")).toMatch(/At least two memories/);

    const kindDrift = recordMemoryConflict([
      create({ memoryId: "memory-left" }),
      create({ memoryId: "memory-right", kind: "preference" }),
    ]);
    expect(kindDrift.ok).toBe(false);
    expect(kindDrift.ok ? "" : kindDrift.failures.join(" ")).toMatch(/share kind/);

    const subjectDrift = recordMemoryConflict([
      create({ memoryId: "memory-left" }),
      create({ memoryId: "memory-right", subjectKey: "crm.other.policy" }),
    ]);
    expect(subjectDrift.ok).toBe(false);
    expect(subjectDrift.ok ? "" : subjectDrift.failures.join(" ")).toMatch(/share subjectKey/);
  });

  it("keeps invalidated memory out of a later conflict set", () => {
    const left = create({ memoryId: "memory-left" });
    const right = invalidateOperationalMemory(
      create({ memoryId: "memory-right" }),
      "2026-08-26T00:00:00Z",
      "Source was withdrawn.",
    );
    expect(right.ok).toBe(true);
    if (!right.ok) throw new Error(right.failures.join("; "));
    const conflict = recordMemoryConflict([left, right.value]);
    expect(conflict.ok).toBe(false);
    expect(conflict.ok ? "" : conflict.failures.join(" ")).toMatch(/after invalidation or archival/);
  });

  it("rejects blank invalidation reasons and inverted provenance timestamps", () => {
    const blank = invalidateOperationalMemory(create(), "2026-08-26T00:00:00Z", "   ");
    expect(blank.ok).toBe(false);
    expect(blank.ok ? "" : blank.failures.join(" ")).toMatch(/invalidationReason|blank|whitespace/);

    const inverted = createOperationalMemory(
      memory({
        provenance: {
          ...memory().provenance,
          observedAt: "2026-08-25T20:02:00Z",
          recordedAt: "2026-08-25T20:01:00Z",
        },
      }),
    );
    expect(inverted.ok).toBe(false);
    expect(inverted.ok ? "" : inverted.failures.join(" ")).toMatch(/recordedAt must not precede observedAt/);
  });

  it("rejects extra keys and a review window after expiry so the hash body stays frozen", () => {
    const extraBody: unknown = { ...memory(), smuggledReplacement: { nextStepRequired: false } };
    expect(validateOperationalMemory(extraBody).ok).toBe(false);

    const lateReview = createOperationalMemory(
      memory({
        reviewAfter: "2026-11-01T00:00:00Z",
        expiresAt: "2026-10-01T00:00:00Z",
      }),
    );
    expect(lateReview.ok).toBe(false);
    expect(lateReview.ok ? "" : lateReview.failures.join(" ")).toMatch(/reviewAfter must not be later than expiresAt/);

    const duplicateRefs = createOperationalMemory(
      memory({
        provenance: {
          ...memory().provenance,
          sourceArtifactRefs: [
            { artifactId: "decision-001", schemaVersion: "decision/v1", contentHash: HASH },
            { artifactId: "decision-001", schemaVersion: "decision/v1", contentHash: HASH },
          ],
        },
      }),
    );
    expect(duplicateRefs.ok).toBe(false);
    expect(duplicateRefs.ok ? "" : duplicateRefs.failures.join(" ")).toMatch(/unique/);

    expect(validateOperationalMemory({ ...create(), extra: true }).ok).toBe(false);
  });
});
