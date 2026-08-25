import { describe, expect, it } from "vitest";
import {
  ENGINEERING_WORKSPACE_SCHEMA_VERSION,
  activateEngineeringWorkspace,
  compareEngineeringWorkspaces,
  completeEngineeringWorkspaceCleanup,
  recordEngineeringWorkspaceVerification,
  requestEngineeringWorkspaceCleanup,
  submitEngineeringWorkspaceResult,
  type EngineeringWorkspace,
} from "@/lib/engineering-workspace";

const BASE_SHA = "a".repeat(40);
const RESULT_A = "b".repeat(40);
const RESULT_B = "c".repeat(40);
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

describe("engineering workspace isolation v1", () => {
  it("keeps the lifecycle explicit from provisioning through cleanup", () => {
    const active = activateEngineeringWorkspace(workspace());
    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const submitted = submitEngineeringWorkspaceResult(active.value, RESULT_A);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const verified = recordEngineeringWorkspaceVerification(submitted.value, [EVIDENCE]);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const requested = requestEngineeringWorkspaceCleanup(verified.value, "2026-08-25T21:00:00Z");
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    const cleaned = completeEngineeringWorkspaceCleanup(requested.value, "2026-08-25T21:05:00Z");
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.value.status).toBe("cleaned");
    expect(cleaned.value.cleanup.status).toBe("completed");
    expect(cleaned.value.mergeAuthorityGranted).toBe(false);
  });

  it("compares only isolated, verified candidates with the same frozen base", () => {
    const candidates = [RESULT_A, RESULT_B].map((resultSha, index) => {
      const active = activateEngineeringWorkspace(
        workspace({
          workspaceId: "workspace-" + (index + 1),
          candidateKey: "candidate-" + (index === 0 ? "a" : "b"),
          branchName: "agent/candidate-" + (index === 0 ? "a" : "b"),
          workspaceRef: "worktree-" + (index + 1),
        }),
      );
      if (!active.ok) throw new Error(active.failures.join(" "));
      const submitted = submitEngineeringWorkspaceResult(active.value, resultSha);
      if (!submitted.ok) throw new Error(submitted.failures.join(" "));
      const verified = recordEngineeringWorkspaceVerification(submitted.value, [
        { ...EVIDENCE, artifactId: "verification-" + (index + 1) },
      ]);
      if (!verified.ok) throw new Error(verified.failures.join(" "));
      return verified.value;
    });

    const comparison = compareEngineeringWorkspaces(candidates);
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) return;
    expect(comparison.value.candidates.map((candidate) => candidate.candidateKey)).toEqual([
      "candidate-a",
      "candidate-b",
    ]);
    expect(comparison.value.mergeAuthorityGranted).toBe(false);
  });

  it("rejects shared mutable workspace references", () => {
    const first = workspace({
      status: "verified",
      resultSha: RESULT_A,
      verificationEvidenceRefs: [EVIDENCE],
    });
    const second = workspace({
      workspaceId: "workspace-002",
      candidateKey: "candidate-b",
      branchName: "agent/candidate-b",
      resultSha: RESULT_B,
      verificationEvidenceRefs: [EVIDENCE],
    });
    const comparison = compareEngineeringWorkspaces([first, second]);
    expect(comparison.ok).toBe(false);
    expect(comparison.ok ? [] : comparison.failures.join(" ")).toContain("mutable workspaceRef");
  });

  it("allows an abandoned workspace to be cleaned without a result", () => {
    const abandoned = {
      ...workspace(),
      status: "abandoned" as const,
    };
    const requested = requestEngineeringWorkspaceCleanup(abandoned, "2026-08-25T21:00:00Z");
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    const cleaned = completeEngineeringWorkspaceCleanup(requested.value, "2026-08-25T21:05:00Z");
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.value.status).toBe("cleaned");
    expect(cleaned.value.resultSha).toBeNull();
  });

  it("requires verification evidence before a verified state", () => {
    const invalid = workspace({
      status: "verified",
      resultSha: RESULT_A,
      verificationEvidenceRefs: [],
    });
    const comparison = compareEngineeringWorkspaces([invalid, invalid]);
    expect(comparison.ok).toBe(false);
    expect(comparison.ok ? [] : comparison.failures.join(" ")).toContain("verification evidence");
  });
});
