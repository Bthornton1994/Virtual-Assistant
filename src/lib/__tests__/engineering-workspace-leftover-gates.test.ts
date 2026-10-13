import { describe, expect, it } from "vitest";
import {
  ENGINEERING_WORKSPACE_SCHEMA_VERSION,
  compareEngineeringWorkspaces,
  validateEngineeringWorkspace,
  type EngineeringWorkspace,
} from "@/lib/engineering-workspace";

const BASE_SHA = "a".repeat(40);
const RESULT_SHA = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);
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

describe("engineering-workspace leftover cleanup and comparison gates", () => {
  it("refuses leftover cleanup timestamps, failed cleanup without a reason, and completed cleanup off cleaned", () => {
    const earlyRequest = validateEngineeringWorkspace(
      workspace({
        cleanup: {
          status: "not_requested",
          requestedAt: "2026-08-25T21:00:00Z",
          completedAt: null,
          failureReason: null,
        },
      }),
    );
    expect(earlyRequest.ok).toBe(false);
    expect(failuresOf(earlyRequest)).toMatch(/requestedAt.*must be null before cleanup is requested/);

    const requestedOpen = validateEngineeringWorkspace(
      workspace({
        status: "verified",
        resultSha: RESULT_SHA,
        verificationEvidenceRefs: [EVIDENCE],
        cleanup: {
          status: "requested",
          requestedAt: null,
          completedAt: null,
          failureReason: null,
        },
      }),
    );
    expect(requestedOpen.ok).toBe(false);
    expect(failuresOf(requestedOpen)).toMatch(/requestedAt.*is required when cleanup is requested/);

    const failedOpen = validateEngineeringWorkspace(
      workspace({
        status: "abandoned",
        cleanup: {
          status: "failed",
          requestedAt: "2026-08-25T21:00:00Z",
          completedAt: null,
          failureReason: null,
        },
      }),
    );
    expect(failedOpen.ok).toBe(false);
    expect(failuresOf(failedOpen)).toMatch(/failureReason.*is required after failed cleanup/);

    const completedOffCleaned = validateEngineeringWorkspace(
      workspace({
        status: "active",
        cleanup: {
          status: "completed",
          requestedAt: "2026-08-25T21:00:00Z",
          completedAt: "2026-08-25T21:05:00Z",
          failureReason: null,
        },
      }),
    );
    expect(completedOffCleaned.ok).toBe(false);
    expect(failuresOf(completedOffCleaned)).toMatch(/only cleaned workspaces may have completed cleanup/);
  });

  it("refuses cleaned rows that keep a result SHA without verification evidence", () => {
    const mixed = validateEngineeringWorkspace(
      workspace({
        status: "cleaned",
        resultSha: RESULT_SHA,
        verificationEvidenceRefs: [],
        cleanup: {
          status: "completed",
          requestedAt: "2026-08-25T21:00:00Z",
          completedAt: "2026-08-25T21:05:00Z",
          failureReason: null,
        },
      }),
    );
    expect(mixed.ok).toBe(false);
    expect(failuresOf(mixed)).toMatch(
      /cleaned candidates must retain both result SHA and verification evidence, or neither/,
    );
  });

  it("refuses padded identity, uppercase SHAs, extra cleanup keys, and comparison base drift", () => {
    const padded = validateEngineeringWorkspace(workspace({ workspaceId: " workspace-001 " }));
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/must not have leading or trailing whitespace/);

    const uppercaseSha = validateEngineeringWorkspace(workspace({ baseSha: "A".repeat(40) }));
    expect(uppercaseSha.ok).toBe(false);
    expect(failuresOf(uppercaseSha)).toMatch(/must be a 40-character lowercase Git commit SHA/);

    const extraCleanup = validateEngineeringWorkspace(
      workspace({
        cleanup: {
          status: "not_requested",
          requestedAt: null,
          completedAt: null,
          failureReason: null,
          operatorBypass: true,
        } as EngineeringWorkspace["cleanup"] & { operatorBypass: boolean },
      }),
    );
    expect(extraCleanup.ok).toBe(false);
    expect(failuresOf(extraCleanup)).toMatch(/unrecognized|additional/i);

    const first = workspace({
      status: "verified",
      resultSha: RESULT_SHA,
      verificationEvidenceRefs: [EVIDENCE],
    });
    const experimentDrift = compareEngineeringWorkspaces([
      first,
      workspace({
        workspaceId: "workspace-002",
        experimentId: "experiment-002",
        candidateKey: "candidate-b",
        branchName: "agent/candidate-b",
        workspaceRef: "worktree-002",
        status: "verified",
        resultSha: OTHER_SHA,
        verificationEvidenceRefs: [{ ...EVIDENCE, artifactId: "verification-002" }],
      }),
    ]);
    expect(experimentDrift.ok).toBe(false);
    expect(failuresOf(experimentDrift)).toMatch(/Candidates must share experimentId/);

    const baseDrift = compareEngineeringWorkspaces([
      first,
      workspace({
        workspaceId: "workspace-002",
        candidateKey: "candidate-b",
        branchName: "agent/candidate-b",
        workspaceRef: "worktree-002",
        baseSha: OTHER_SHA,
        status: "verified",
        resultSha: OTHER_SHA,
        verificationEvidenceRefs: [{ ...EVIDENCE, artifactId: "verification-002" }],
      }),
    ]);
    expect(baseDrift.ok).toBe(false);
    expect(failuresOf(baseDrift)).toMatch(/Candidates must share frozen baseSha/);
  });
});
