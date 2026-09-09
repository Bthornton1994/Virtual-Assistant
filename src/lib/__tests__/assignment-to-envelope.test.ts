import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import {
  AUTHORITY_SNAPSHOT_CONTRACT_VERSION,
  EXECUTION_STEP_ASSIGNMENT_IDENTITY_SCHEMA_VERSION,
  WORK_CELL_ASSIGNMENT_IDENTITY_SCHEMA_VERSION,
  assignmentToEnvelope,
  executionStepAssignmentToEnvelope,
  stableExecutionStepAssignmentId,
  stableWorkCellAssignmentId,
  type AssignmentToEnvelopeAssignment,
} from "@/lib/assignment-to-envelope";
import type { DelegationSpecSnapshot } from "@/lib/execution-context";
import type { ExecutorEnvelopeV1 } from "@/lib/executor-envelope";

const HASH = "a".repeat(64);
const PERSISTENCE_UUID = "c5e40001-0000-4000-8000-000000000001";

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

function hermesSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    executorKind: "agent",
    executorRole: "researcher",
    profileStatus: "shadow",
    authorityEnvelope: {
      actionClass: "prepare_only",
      mayReadSuppliedCatalogRecords: true,
      mayResearchPublicSources: true,
      mayReturnTypedEvidence: "catalog-evidence-packet/v1",
      mayDecideVerified: false,
      mayOwnAuthoritativeState: false,
    },
    forbiddenActions: ["repository changes", "catalog changes", "external messages"],
    configurationMetadata: {
      protocolVersion: "hermes-catalog-evidence-prepare/v1",
      modelId: "free",
    },
    ...overrides,
  };
}

function grokSnapshot(): Record<string, unknown> {
  return {
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
    executorKind: "agent",
    executorRole: "reviewer",
    profileStatus: "shadow",
    authorityEnvelope: {
      actionClass: "prepare_only",
      mayReceiveFrozenPacket: true,
      mayResearchPublicSources: true,
      mayReturnTypedEvidence: "catalog-evidence-review/v1",
      mayModifyReviewedPacket: false,
      mayTreatPeerOutputAsAuthoritative: false,
      mayDecideVerified: false,
      mayOwnAuthoritativeState: false,
    },
    forbiddenActions: ["modifying the Hermes evidence packet"],
    configurationMetadata: { protocolVersion: "grok-catalog-evidence-review/v1" },
  };
}

function validatorSnapshot(): Record<string, unknown> {
  return {
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
    executorKind: "deterministic",
    executorRole: "validator",
    profileStatus: "active",
    authorityEnvelope: {
      actionClass: "prepare_only",
      ownsHardGate: true,
      ownsComputedMetrics: true,
      deterministic: true,
      mayOwnAuthoritativeState: false,
    },
    forbiddenActions: ["network access", "LLM inference"],
    configurationMetadata: { protocolVersion: "catalog-evidence-validator/v1" },
  };
}

function prepareAssignment(
  overrides: Partial<AssignmentToEnvelopeAssignment> = {},
): AssignmentToEnvelopeAssignment {
  return {
    organizationId: "org-loadout-internal-qa",
    runId: "run-001",
    phase: "prepare",
    capabilityKey: "evidence_research",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    executorKind: "agent",
    provider: "hermes",
    protocolVersion: "hermes-catalog-evidence-prepare/v1",
    modelId: "free",
    configHash: null,
    objective: "Prepare source-backed candidate evidence.",
    createdAt: "2026-08-25T20:00:00Z",
    deadline: "2026-08-25T21:00:00Z",
    outputContract: {
      schemaVersion: "catalog-evidence-packet/v1",
      artifactKind: "candidate_evidence",
    },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: ["catalog-evidence-packet/v1"],
      requiredSourceProvenance: ["sourceUrl", "accessedAt"],
      independentReviewRequired: true,
    },
    economicLimit: {
      currency: "USD",
      maxHumanMinutes: 30,
      maxAiCostMicros: 500000,
      maxToolCostMicros: 500000,
    },
    inputManifestContentHash: HASH,
    profileAuthoritySnapshot: hermesSnapshot(),
    ...overrides,
  };
}

function reviewAssignment(): AssignmentToEnvelopeAssignment {
  return {
    ...prepareAssignment(),
    phase: "review",
    capabilityKey: "independent_evidence_review",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
    executorKind: "agent",
    provider: "grok",
    protocolVersion: "grok-catalog-evidence-review/v1",
    outputContract: {
      schemaVersion: "catalog-evidence-review/v1",
      artifactKind: "independent_review",
    },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: ["catalog-evidence-review/v1"],
      requiredSourceProvenance: ["sourceUrl"],
      independentReviewRequired: false,
    },
    profileAuthoritySnapshot: grokSnapshot(),
  };
}

function validateAssignment(
  overrides: Partial<AssignmentToEnvelopeAssignment> = {},
): AssignmentToEnvelopeAssignment {
  return {
    ...prepareAssignment(),
    phase: "validate",
    capabilityKey: "deterministic_catalog_validation",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
    executorKind: "deterministic",
    provider: "delegation-cloud",
    protocolVersion: "catalog-evidence-validator/v1",
    modelId: null,
    outputContract: {
      schemaVersion: "catalog-evidence-validation/v1",
      artifactKind: "test",
    },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: ["catalog-evidence-validation/v1"],
      requiredSourceProvenance: [],
      independentReviewRequired: false,
    },
    profileAuthoritySnapshot: validatorSnapshot(),
    ...overrides,
  };
}

function inputRefs(): ExecutorEnvelopeV1["inputArtifactRefs"] {
  return [{ artifactId: "input-manifest", schemaVersion: "catalog-evidence-input/v1", contentHash: HASH }];
}

function failuresOf(
  assignment: AssignmentToEnvelopeAssignment = prepareAssignment(),
  specSnapshot: DelegationSpecSnapshot = spec(),
  refs: ExecutorEnvelopeV1["inputArtifactRefs"] = inputRefs(),
): string {
  const result = assignmentToEnvelope(assignment, specSnapshot, refs);
  return result.ok ? "" : result.failures.join(" ");
}

describe("stable assignment identity", () => {
  it("hashes work-cell identity with an explicit schema and omits persistence fields", () => {
    const freeze = {
      organizationId: "org-1",
      runId: "run-001",
      phase: "prepare" as const,
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      inputManifestContentHash: HASH,
    };
    const ingest = {
      ...freeze,
      persistenceAssignmentId: PERSISTENCE_UUID,
      attemptId: "attempt-9",
      attemptNumber: 3,
      createdAt: "2026-09-09T00:00:00Z",
      metadata: { operator: "alice" },
    };
    const frozenId = stableWorkCellAssignmentId(freeze);
    const ingestId = stableWorkCellAssignmentId(ingest);
    expect(frozenId).toHaveLength(64);
    expect(frozenId).toMatch(/^[0-9a-f]{64}$/);
    expect(ingestId).toBe(frozenId);
  });

  it("changes when the run changes and stays stable for the same frozen inputs", () => {
    const base = {
      organizationId: "org-1",
      runId: "run-001",
      phase: "prepare" as const,
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      inputManifestContentHash: HASH,
    };
    expect(stableWorkCellAssignmentId(base)).toBe(stableWorkCellAssignmentId({ ...base }));
    expect(stableWorkCellAssignmentId({ ...base, runId: "run-002" })).not.toBe(stableWorkCellAssignmentId(base));
  });

  it("hashes execution-step identity from plan hash and step key, not attempt ids", () => {
    const step = {
      organizationId: "org-1",
      runId: "run-001",
      planHash: HASH,
      stepKey: "research",
      capabilityKey: "evidence_research",
    };
    const first = stableExecutionStepAssignmentId(step);
    const retry = stableExecutionStepAssignmentId({
      ...step,
      attemptId: "attempt-2",
      attemptNumber: 2,
      planId: PERSISTENCE_UUID,
    } as typeof step & { attemptId: string; attemptNumber: number; planId: string });
    expect(first).toHaveLength(64);
    expect(retry).toBe(first);
    expect(first).not.toBe(stableExecutionStepAssignmentId({ ...step, stepKey: "review" }));
    expect(EXECUTION_STEP_ASSIGNMENT_IDENTITY_SCHEMA_VERSION).toBe("execution-step-assignment-identity/v1");
    expect(WORK_CELL_ASSIGNMENT_IDENTITY_SCHEMA_VERSION).toBe("work-cell-assignment-identity/v1");
  });
});

describe("assignmentToEnvelope", () => {
  it("preserves the frozen prepare executor and capability keys", () => {
    const result = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.envelope.executorConfigurationSnapshot.executorKey).toBe(
      FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    );
    expect(result.value.envelope.capabilityKey).toBe("evidence_research");
    expect(result.value.envelope.phase).toBe("prepare");
    expect(result.value.envelope.authoritySnapshot.contractVersion).toBe(AUTHORITY_SNAPSHOT_CONTRACT_VERSION);
    expect(result.value.envelope.authoritySnapshot.actionClass).toBe("prepare_only");
    expect(result.value.envelope.authoritySnapshot.mayOwnAuthoritativeState).toBe(false);
    expect(result.value.envelope.authoritySnapshot.allowedActions).toEqual([
      "read_supplied_catalog_records",
      "research_public_sources",
    ]);
    expect(result.value.context.assignmentSnapshot.executorKey).toBe(FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare);
  });

  it("preserves the frozen review executor key", () => {
    const result = assignmentToEnvelope(reviewAssignment(), spec(), inputRefs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.envelope.executorConfigurationSnapshot.executorKey).toBe(
      FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
    );
    expect(result.value.envelope.capabilityKey).toBe("independent_evidence_review");
    expect(result.value.envelope.phase).toBe("review");
  });

  it("accepts a deterministic validate assignment", () => {
    const result = assignmentToEnvelope(validateAssignment(), spec(), [
      { artifactId: "packet-001", schemaVersion: "catalog-evidence-packet/v1", contentHash: HASH },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.envelope.executorConfigurationSnapshot.executorKind).toBe("deterministic");
    expect(result.value.envelope.executorConfigurationSnapshot.executorKey).toBe(
      FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
    );
    expect(result.value.envelope.capabilityKey).toBe("deterministic_catalog_validation");
  });

  it("rejects an agent-owned validate assignment", () => {
    expect(
      failuresOf(
        validateAssignment({
          executorKind: "agent",
          profileAuthoritySnapshot: validatorSnapshot(),
        }),
      ),
    ).toMatch(/deterministic/);
  });

  it("rejects authoritative-state ownership", () => {
    expect(
      failuresOf(
        prepareAssignment({
          profileAuthoritySnapshot: hermesSnapshot({
            authorityEnvelope: {
              actionClass: "prepare_only",
              mayReadSuppliedCatalogRecords: true,
              mayOwnAuthoritativeState: true,
            },
          }),
        }),
      ),
    ).toMatch(/authoritative state/);
  });

  it("uses the same assignment id at freeze and ingest, ignoring the persistence UUID", () => {
    const freeze = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    const ingest = assignmentToEnvelope(
      prepareAssignment({
        persistenceAssignmentId: PERSISTENCE_UUID,
        id: PERSISTENCE_UUID,
        attemptId: "attempt-1",
        attemptNumber: 1,
        metadata: { pastedBy: "operator" },
      }),
      spec(),
      inputRefs(),
    );
    expect(freeze.ok).toBe(true);
    expect(ingest.ok).toBe(true);
    if (!freeze.ok || !ingest.ok) return;
    expect(ingest.value.assignmentId).toBe(freeze.value.assignmentId);
    expect(ingest.value.envelope.assignmentId).toBe(freeze.value.assignmentId);
    expect(ingest.value.envelope.assignmentId).not.toBe(PERSISTENCE_UUID);
    expect(ingest.value.envelopeHash).toBe(freeze.value.envelopeHash);
    expect(ingest.value.contextHash).toBe(freeze.value.contextHash);
  });

  it("produces a new identity for a new run", () => {
    const first = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    const nextRun = assignmentToEnvelope(prepareAssignment({ runId: "run-002" }), spec(), inputRefs());
    expect(first.ok && nextRun.ok).toBe(true);
    if (!first.ok || !nextRun.ok) return;
    expect(nextRun.value.assignmentId).not.toBe(first.value.assignmentId);
    expect(nextRun.value.envelopeHash).not.toBe(first.value.envelopeHash);
    expect(nextRun.value.contextHash).not.toBe(first.value.contextHash);
  });

  it("changes both hashes when the executor key changes", () => {
    const hermes = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    const swapped = assignmentToEnvelope(
      prepareAssignment({
        executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
        profileAuthoritySnapshot: hermesSnapshot({ executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review }),
      }),
      spec(),
      inputRefs(),
    );
    expect(hermes.ok && swapped.ok).toBe(true);
    if (!hermes.ok || !swapped.ok) return;
    expect(swapped.value.envelopeHash).not.toBe(hermes.value.envelopeHash);
    expect(swapped.value.contextHash).not.toBe(hermes.value.contextHash);
    expect(swapped.value.assignmentId).not.toBe(hermes.value.assignmentId);
  });

  it("changes the context hash when the action class or allowed tools change", () => {
    const prepareOnly = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    const extraTools = assignmentToEnvelope(
      prepareAssignment(),
      spec({
        allowedToolClasses: [
          "public_read",
          "artifact_read",
          "artifact_write",
          "external_message_draft",
          "repository_read",
        ],
      }),
      inputRefs(),
    );
    expect(prepareOnly.ok && extraTools.ok).toBe(true);
    if (!prepareOnly.ok || !extraTools.ok) return;
    expect(extraTools.value.contextHash).not.toBe(prepareOnly.value.contextHash);

    const lowRisk = assignmentToEnvelope(
      prepareAssignment(),
      spec({ actionClass: "low_risk_execution" }),
      inputRefs(),
    );
    expect(lowRisk.ok).toBe(true);
    if (!lowRisk.ok) return;
    expect(lowRisk.value.contextHash).not.toBe(prepareOnly.value.contextHash);
  });

  it("rejects unknown or inactive capabilities", () => {
    expect(failuresOf(prepareAssignment({ capabilityKey: "not_a_capability" }))).toMatch(/not registered/);
    expect(failuresOf(prepareAssignment({ capabilityKey: "software_repository_read" }))).toMatch(/not active/);
  });

  it("produces identical envelope and context hashes for identical inputs", () => {
    const first = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    const second = assignmentToEnvelope(prepareAssignment(), spec(), inputRefs());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.assignmentId).toBe(first.value.assignmentId);
    expect(second.value.envelopeHash).toBe(first.value.envelopeHash);
    expect(second.value.contextHash).toBe(first.value.contextHash);
    expect(second.value.envelope).toEqual(first.value.envelope);
    expect(second.value.context).toEqual(first.value.context);
  });

  it("uses stableExecutionStepAssignmentId for leased execution-step envelopes", () => {
    const stepAssignment = {
      ...prepareAssignment(),
      planHash: HASH,
      stepKey: "research",
    };
    const result = executionStepAssignmentToEnvelope(stepAssignment, spec(), inputRefs());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assignmentId).toBe(
      stableExecutionStepAssignmentId({
        organizationId: stepAssignment.organizationId,
        runId: stepAssignment.runId,
        planHash: HASH,
        stepKey: "research",
        capabilityKey: stepAssignment.capabilityKey,
      }),
    );
    expect(result.value.assignmentId).not.toBe(
      stableWorkCellAssignmentId({
        organizationId: stepAssignment.organizationId,
        runId: stepAssignment.runId,
        phase: "prepare",
        executorKey: stepAssignment.executorKey,
        inputManifestContentHash: HASH,
      }),
    );
  });

  it("does not import persistence, the capability router, Supabase, or fetch", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/assignment-to-envelope.ts"), "utf8");
    expect(source).not.toMatch(/capability-router/);
    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/from ["']@\/lib\/work-cell["']/);
    expect(source).not.toMatch(/execution-runtime-persistence/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/loadCapabilityRoster/);
    expect(source).not.toMatch(/routeCapability/);
  });
});
