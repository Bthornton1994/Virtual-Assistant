import { describe, expect, it } from "vitest";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import { assignmentToEnvelope } from "@/lib/assignment-to-envelope";
import {
  createExecutionContext,
  validateExecutionContext,
  type AssignmentSnapshot,
  type DelegationSpecSnapshot,
  type ExecutionContext,
} from "@/lib/execution-context";
import {
  assertWorkCellPhasePersistAllowed,
  buildRequiredEmptyTrace,
  snapshotDelegationSpec,
  workCellPersistIdentity,
} from "@/lib/execution-context-enforcement";
import {
  compareEngineeringWorkspaces,
  ENGINEERING_WORKSPACE_SCHEMA_VERSION,
  type EngineeringWorkspace,
} from "@/lib/engineering-workspace";
import {
  ROLE_CONTRACT_SCHEMA_VERSION,
  validateRoleContractLibrary,
  type RoleContract,
} from "@/lib/role-contract";
import { hashToolInvocationTrace, observationPointersFor } from "@/lib/tool-invocation-trace";

const HASH = "a".repeat(64);
const NOW = "2026-09-09T16:00:00Z";
const BASE_SHA = "a".repeat(40);

function spec(overrides: Partial<DelegationSpecSnapshot> = {}): DelegationSpecSnapshot {
  return {
    specKey: "catalog-integrity-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "prepare_only",
    allowedToolClasses: ["public_read", "artifact_read", "artifact_write", "external_message_draft"],
    forbiddenToolClasses: ["external_message_send", "sensitive_action", "credential_use"],
    requiresHumanApproval: false,
    mayOwnAuthoritativeState: false,
    ...overrides,
  };
}

function assignment(overrides: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
  return {
    runId: "run-001",
    assignmentId: "assignment-001",
    capabilityKey: "evidence_research",
    executorKey: "hermes-loadout-researcher-v1",
    inputArtifactRefs: [
      {
        artifactId: "input-001",
        schemaVersion: "catalog-input/v1",
        contentHash: HASH,
      },
    ],
    outputContract: {
      schemaVersion: "catalog-evidence-packet/v1",
      artifactKind: "candidate_evidence",
    },
    executorConfigurationSnapshot: {
      executorKey: "hermes-loadout-researcher-v1",
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "loadout/v1",
      modelId: "free",
      configHash: null,
    },
    createdAt: "2026-08-25T20:00:00Z",
    deadline: "2026-08-25T21:00:00Z",
    ...overrides,
  };
}

function context(): ExecutionContext {
  const built = createExecutionContext(spec(), assignment());
  if (!built.ok) throw new Error(built.failures.join("; "));
  return built.value;
}

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

function role(overrides: Partial<RoleContract> = {}): RoleContract {
  return {
    schemaVersion: ROLE_CONTRACT_SCHEMA_VERSION,
    key: "evidence_researcher",
    mission: "Prepare source-backed evidence from frozen inputs",
    requiredCapabilities: ["evidence_research"],
    inputContracts: [{ schemaVersion: "catalog-evidence-input/v1", purpose: "frozen research inputs" }],
    outputContracts: [{ schemaVersion: "catalog-evidence-packet/v1", purpose: "candidate evidence packet" }],
    allowedAuthorityClass: "prepare_only",
    mayOwnAuthoritativeState: false,
    forbiddenActions: ["send_external_message", "modify_authoritative_record"],
    knownFailureModes: [
      {
        code: "source_gap",
        description: "A required source cannot be verified",
        observableSignal: "required source field is missing",
      },
    ],
    fallbackPolicy: {
      mode: "escalate_human",
      triggerCodes: ["source_gap"],
      requiresHumanApproval: true,
    },
    evaluationSuite: {
      suiteKey: "catalog-evidence-v1",
      suiteVersion: "v1",
      requiredEvidence: ["source-artifact-hash", "independent-review"],
      successCriteria: ["Every accepted claim has source provenance"],
    },
    ...overrides,
  };
}

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
    status: "verified",
    startedAt: "2026-08-25T20:00:00Z",
    resultSha: "b".repeat(40),
    verificationEvidenceRefs: [
      {
        artifactId: "verification-001",
        schemaVersion: "verification/v1",
        contentHash: "d".repeat(64),
      },
    ],
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

function persistAssignment() {
  return {
    organizationId: "org-loadout-internal-qa",
    runId: "run-001",
    phase: "prepare" as const,
    capabilityKey: "evidence_research",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    executorKind: "agent" as const,
    provider: "hermes",
    protocolVersion: "hermes-catalog-evidence-prepare/v1",
    modelId: "free",
    configHash: null,
    objective: "Prepare source-backed candidate evidence.",
    createdAt: NOW,
    deadline: NOW,
    outputContract: {
      schemaVersion: "catalog-evidence-packet/v1",
      artifactKind: "candidate_evidence",
    },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: ["catalog-evidence-packet/v1"],
      requiredSourceProvenance: ["sourceUrl"],
      independentReviewRequired: true,
    },
    economicLimit: { currency: "USD" as const, maxHumanMinutes: 0, maxAiCostMicros: 0, maxToolCostMicros: 0 },
    inputManifestContentHash: HASH,
    profileAuthoritySnapshot: {
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      executorKind: "agent" as const,
      authorityEnvelope: { actionClass: "prepare_only", mayOwnAuthoritativeState: false },
      forbiddenActions: [],
    },
  };
}

describe("execution-context leftover identity gates", () => {
  it("refuses a top-level assignmentId that does not match the snapshot", () => {
    const current = context();
    const tampered = validateExecutionContext({ ...current, assignmentId: "assignment-tampered" });
    expect(tampered.ok).toBe(false);
    expect(failuresOf(tampered)).toMatch(/must match assignmentSnapshot.assignmentId/);
  });

  it("refuses duplicate credential scope entries on one reference", () => {
    const current = context();
    const duplicates = validateExecutionContext({
      ...current,
      credentialRefs: [
        {
          credentialKey: "shared-secret",
          scope: ["public_read", "public_read"],
          secretMaterialIncluded: false,
        },
      ],
    });
    expect(duplicates.ok).toBe(false);
    expect(failuresOf(duplicates)).toMatch(/scope.*must not contain duplicates/i);
  });

  it("refuses a prepare persist whose observation production class is validation-only", () => {
    const translated = assignmentToEnvelope(
      persistAssignment(),
      snapshotDelegationSpec({
        specKey: "catalog-integrity-spec",
        specVersion: "delegation-spec/v1",
        actionClass: "prepare_only",
        allowedToolClasses: ["public_read", "artifact_read", "artifact_write", "external_message_draft"],
      }),
      [{ artifactId: "input-manifest", schemaVersion: "catalog-evidence-input/v1", contentHash: HASH }],
    );
    if (!translated.ok) throw new Error(translated.failures.join(" "));

    const trace = buildRequiredEmptyTrace("deterministic_validation_no_tools", translated.value);
    const identity = workCellPersistIdentity({
      organizationId: "org-loadout-internal-qa",
      runId: translated.value.context.runId,
      phase: "prepare",
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      capabilityKey: "evidence_research",
    });
    const pointers = observationPointersFor(trace);

    expect(() =>
      assertWorkCellPhasePersistAllowed({
        organizationId: identity.organizationId,
        runId: identity.runId,
        phase: "prepare",
        executorKey: identity.executorKey,
        capabilityKey: identity.capabilityKey,
        specActionClass: "prepare_only",
        assignmentActionClass: "prepare_only",
        metadata: { ...identity, ...pointers },
        observation: {
          organizationId: identity.organizationId,
          runId: identity.runId,
          kind: "observation",
          contentHash: hashToolInvocationTrace(trace),
          payload: trace,
        },
      }),
    ).toThrow(/production class is not valid for this work-cell phase/);
  });
});

describe("role-contract leftover trigger gates", () => {
  it("refuses duplicate fallback trigger codes", () => {
    const duplicates = validateRoleContractLibrary([
      role({
        fallbackPolicy: {
          mode: "escalate_human",
          triggerCodes: ["source_gap", "source_gap"],
          requiresHumanApproval: true,
        },
      }),
    ]);
    expect(duplicates.ok).toBe(false);
    expect(failuresOf(duplicates)).toMatch(/triggerCodes.*must not contain duplicates/i);
  });
});

describe("engineering-workspace leftover candidate gates", () => {
  it("refuses two verified workspaces that share a candidate key", () => {
    const first = workspace();
    const second = workspace({
      workspaceId: "workspace-002",
      candidateKey: "candidate-a",
      branchName: "agent/candidate-b",
      workspaceRef: "worktree-002",
      resultSha: "c".repeat(40),
      verificationEvidenceRefs: [
        {
          artifactId: "verification-002",
          schemaVersion: "verification/v1",
          contentHash: "e".repeat(64),
        },
      ],
    });

    const comparison = compareEngineeringWorkspaces([first, second]);
    expect(comparison.ok).toBe(false);
    expect(failuresOf(comparison)).toMatch(/Candidate keys must be unique/);
  });
});
