import { describe, expect, it } from "vitest";
import {
  ENGINEERING_WORKSPACE_SCHEMA_VERSION,
  abandonEngineeringWorkspace,
  activateEngineeringWorkspace,
  completeEngineeringWorkspaceCleanup,
  recordEngineeringWorkspaceVerification,
  requestEngineeringWorkspaceCleanup,
  submitEngineeringWorkspaceResult,
  validateEngineeringWorkspace,
  type EngineeringWorkspace,
} from "@/lib/engineering-workspace";

const BASE_SHA = "a".repeat(40);
const RESULT_SHA = "b".repeat(40);
const EVIDENCE = {
  artifactId: "verification-001",
  schemaVersion: "verification/v1",
  contentHash: "d".repeat(64),
};

function workspace(overrides: Partial<EngineeringWorkspace> = {}): EngineeringWorkspace {
  return {
    schemaVersion: ENGINEERING_WORKSPACE_SCHEMA_VERSION,
    workspaceId: "workspace-001",
    experimentId: "experiment-001",
    repository: "Bthornton1994/Virtual-Assistant",
    candidateKey: "candidate-a",
    baseSha: BASE_SHA,
    branchName: "agent/candidate-a",
    isolationKind: "worktree",
    workspaceRef: "worktree-001",
    executorConfigurationSnapshot: {
      executorKey: "hermes-v1",
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "executor-envelope/v1",
      modelId: "grok-4",
      configHash: null,
    },
    status: "provisioning",
    startedAt: "2026-08-25T20:00:00Z",
    resultSha: null,
    verificationEvidenceRefs: [],
    cleanup: {
      status: "not_requested",
      requestedAt: null,
      completedAt: null,
      failureReason: null,
    },
    mergeAuthorityGranted: false,
    ...overrides,
  };
}

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("engineering workspace lifecycle gates", () => {
  it("abandons an open workspace and refuses cleaned or already-abandoned rows", () => {
    const abandoned = abandonEngineeringWorkspace(workspace());
    expect(abandoned.ok).toBe(true);
    if (abandoned.ok) {
      expect(abandoned.value.status).toBe("abandoned");
      expect(abandoned.value.mergeAuthorityGranted).toBe(false);
      expect(abandoned.value.resultSha).toBeNull();
    }

    const alreadyAbandoned = abandonEngineeringWorkspace({
      ...workspace(),
      status: "abandoned",
    });
    expect(alreadyAbandoned.ok).toBe(false);
    expect(failuresOf(alreadyAbandoned)).toContain("abandoned");

    const cleaned = abandonEngineeringWorkspace({
      ...workspace(),
      status: "cleaned",
      cleanup: {
        status: "completed",
        requestedAt: "2026-08-25T21:00:00Z",
        completedAt: "2026-08-25T21:05:00Z",
        failureReason: null,
      },
    });
    expect(cleaned.ok).toBe(false);
    expect(failuresOf(cleaned)).toContain("cleaned");
  });

  it("keeps activate, submit, verify, and cleanup on their required prior status", () => {
    expect(activateEngineeringWorkspace(workspace({ status: "active" })).ok).toBe(false);
    expect(failuresOf(activateEngineeringWorkspace(workspace({ status: "active" })))).toContain(
      "provisioning",
    );

    expect(submitEngineeringWorkspaceResult(workspace(), RESULT_SHA).ok).toBe(false);
    expect(failuresOf(submitEngineeringWorkspaceResult(workspace(), RESULT_SHA))).toContain("active");

    const shortSha = submitEngineeringWorkspaceResult(
      { ...workspace(), status: "active" },
      "not-a-git-sha",
    );
    expect(shortSha.ok).toBe(false);
    expect(failuresOf(shortSha)).toMatch(/resultSha|40-character/i);

    expect(recordEngineeringWorkspaceVerification(workspace({ status: "active" }), [EVIDENCE]).ok).toBe(
      false,
    );
    expect(
      failuresOf(recordEngineeringWorkspaceVerification(workspace({ status: "active" }), [EVIDENCE])),
    ).toContain("submitted");

    const duplicates = recordEngineeringWorkspaceVerification(
      {
        ...workspace(),
        status: "submitted",
        resultSha: RESULT_SHA,
      },
      [EVIDENCE, { ...EVIDENCE }],
    );
    expect(duplicates.ok).toBe(false);
    expect(failuresOf(duplicates)).toContain("duplicate artifactId");

    expect(requestEngineeringWorkspaceCleanup(workspace({ status: "active" }), "2026-08-25T21:00:00Z").ok).toBe(
      false,
    );
    expect(
      failuresOf(requestEngineeringWorkspaceCleanup(workspace({ status: "active" }), "2026-08-25T21:00:00Z")),
    ).toMatch(/verification or abandonment/i);

    const verified = {
      ...workspace(),
      status: "verified" as const,
      resultSha: RESULT_SHA,
      verificationEvidenceRefs: [EVIDENCE],
    };
    expect(completeEngineeringWorkspaceCleanup(verified, "2026-08-25T21:05:00Z").ok).toBe(false);
    expect(failuresOf(completeEngineeringWorkspaceCleanup(verified, "2026-08-25T21:05:00Z"))).toContain(
      "requested",
    );
  });

  it("rejects extra keys, merge authority, and a result SHA before submit", () => {
    const extra = validateEngineeringWorkspace({ ...workspace(), ownerApprovedMerge: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const mergeGranted = validateEngineeringWorkspace({ ...workspace(), mergeAuthorityGranted: true });
    expect(mergeGranted.ok).toBe(false);
    expect(failuresOf(mergeGranted)).toMatch(/mergeAuthorityGranted|false/i);

    const earlySha = validateEngineeringWorkspace({ ...workspace(), resultSha: RESULT_SHA });
    expect(earlySha.ok).toBe(false);
    expect(failuresOf(earlySha)).toContain("resultSha");
  });
});
