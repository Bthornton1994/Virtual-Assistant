import { describe, expect, it } from "vitest";
import {
  createOperationalMemory,
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

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("operational-memory leftover status and identity gates", () => {
  it("refuses a candidate that already carries an approval", () => {
    const approvedCandidate = createOperationalMemory(
      memory({
        provenance: {
          ...memory().provenance,
          approverId: "manager-001",
        },
      }),
    );
    expect(approvedCandidate.ok).toBe(false);
    expect(failuresOf(approvedCandidate)).toMatch(/candidate memory cannot carry an approval/);
  });

  it("binds conflict and invalidation metadata to the owning status only", () => {
    const conflictedOpen = createOperationalMemory(memory({ status: "conflicted", conflictSetId: null }));
    expect(conflictedOpen.ok).toBe(false);
    expect(failuresOf(conflictedOpen)).toMatch(/conflicted memory requires a conflictSetId/);

    const verifiedConflict = createOperationalMemory(
      memory({
        status: "verified",
        conflictSetId: "conflict-001",
        provenance: { ...memory().provenance, approverId: "manager-001" },
      }),
    );
    expect(verifiedConflict.ok).toBe(false);
    expect(failuresOf(verifiedConflict)).toMatch(/only conflicted memory may carry a conflictSetId/);

    const candidateInvalidation = createOperationalMemory(
      memory({
        invalidatedAt: "2026-08-26T00:00:00Z",
        invalidationReason: "Source was withdrawn.",
      }),
    );
    expect(candidateInvalidation.ok).toBe(false);
    expect(failuresOf(candidateInvalidation)).toMatch(/only invalidated memory may carry invalidation metadata/);

    const expiredOpen = createOperationalMemory(memory({ status: "expired", expiresAt: null, reviewAfter: null }));
    expect(expiredOpen.ok).toBe(false);
    expect(failuresOf(expiredOpen)).toMatch(/expired memory requires expiresAt/);
  });

  it("refuses padded identifiers and extra keys on nested scope", () => {
    const padded = createOperationalMemory(memory({ memoryId: " memory-001 " }));
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/must not have leading or trailing whitespace/);

    const extraScope = createOperationalMemory(
      memory({
        scope: {
          organizationId: "org-001",
          scopeKind: "organization",
          scopeKey: "org-001",
          tenantOverride: true,
        } as OperationalMemory["scope"] & { tenantOverride: boolean },
      }),
    );
    expect(extraScope.ok).toBe(false);
    expect(failuresOf(extraScope)).toMatch(/unrecognized|additional/i);
  });
});
