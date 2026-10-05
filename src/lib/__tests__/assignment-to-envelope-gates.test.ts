import { describe, expect, it } from "vitest";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import {
  assignmentToEnvelope,
  executionStepAssignmentToEnvelope,
  stableExecutionStepAssignmentId,
  stableWorkCellAssignmentId,
  type AssignmentToEnvelopeAssignment,
} from "@/lib/assignment-to-envelope";
import type { DelegationSpecSnapshot } from "@/lib/execution-context";
import type { ExecutorEnvelopeV1 } from "@/lib/executor-envelope";

const HASH = "a".repeat(64);

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

function validatorSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
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
  assignment: unknown = prepareAssignment(),
  specSnapshot: unknown = spec(),
  refs: unknown = inputRefs(),
): string {
  const result = assignmentToEnvelope(assignment, specSnapshot, refs);
  return result.ok ? "" : result.failures.join(" ");
}

function stepAssignment(overrides: Record<string, unknown> = {}) {
  return {
    ...prepareAssignment(),
    planHash: HASH,
    stepKey: "research",
    ...overrides,
  };
}

describe("assignment identity leftover padding and shape gates", () => {
  it("throws on padded work-cell identity fields so a repaired id cannot hash as the original", () => {
    const base = {
      organizationId: "org-1",
      runId: "run-001",
      phase: "prepare" as const,
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      inputManifestContentHash: HASH,
    };

    expect(() => stableWorkCellAssignmentId({ ...base, organizationId: " org-1 " })).toThrow(
      /whitespace|organizationId/,
    );
    expect(() => stableWorkCellAssignmentId({ ...base, runId: "run-001 " })).toThrow(/whitespace|runId/);
    expect(() => stableWorkCellAssignmentId({ ...base, executorKey: ` ${base.executorKey}` })).toThrow(
      /whitespace|executorKey/,
    );
  });

  it("throws on a padded execution-step key and a digest that is not 64 hex characters", () => {
    const base = {
      organizationId: "org-1",
      runId: "run-001",
      planHash: HASH,
      stepKey: "research",
      capabilityKey: "evidence_research",
    };

    expect(() => stableExecutionStepAssignmentId({ ...base, stepKey: "research " })).toThrow(
      /whitespace|stepKey/,
    );
    expect(() => stableExecutionStepAssignmentId({ ...base, planHash: "not-a-digest" })).toThrow(
      /64-character|planHash/,
    );
    expect(() => stableExecutionStepAssignmentId({ ...base, planHash: HASH.slice(0, 63) })).toThrow(
      /64-character|planHash/,
    );
  });
});

describe("assignmentToEnvelope leftover authority and input gates", () => {
  it("refuses a top-level mayOwnAuthoritativeState flag even when the nested envelope is false", () => {
    expect(
      failuresOf(
        prepareAssignment({
          profileAuthoritySnapshot: hermesSnapshot({ mayOwnAuthoritativeState: true }),
        }),
      ),
    ).toMatch(/authoritative state/);
  });

  it("refuses a top-level profile action class that exceeds the Delegation Spec ceiling", () => {
    expect(
      failuresOf(
        prepareAssignment({
          profileAuthoritySnapshot: hermesSnapshot({ actionClass: "sensitive_execution" }),
        }),
      ),
    ).toMatch(/exceeds Delegation Spec prepare_only/);
  });

  it("refuses a deadline that precedes createdAt instead of hashing a time-travelled envelope", () => {
    expect(
      failuresOf(
        prepareAssignment({
          createdAt: "2026-08-25T21:00:00Z",
          deadline: "2026-08-25T20:00:00Z",
        }),
      ),
    ).toMatch(/deadline/);
  });

  it("refuses extra spec keys, overlapping tools, and an unknown assignment phase", () => {
    const extra = assignmentToEnvelope(prepareAssignment(), { ...spec(), trustedByDefault: true }, inputRefs());
    expect(extra.ok).toBe(false);
    expect(extra.ok ? "" : extra.failures.join(" ")).toMatch(/unrecognized|additional/i);

    const overlap = assignmentToEnvelope(
      prepareAssignment(),
      spec({
        allowedToolClasses: ["public_read", "artifact_read"],
        forbiddenToolClasses: ["public_read"],
      }),
      inputRefs(),
    );
    expect(overlap.ok).toBe(false);
    expect(overlap.ok ? "" : overlap.failures.join(" ")).toMatch(/cannot also be forbidden/);

    expect(failuresOf({ ...prepareAssignment(), phase: "publish" })).toMatch(/phase/);
  });

  it("refuses padded, extra-key, and wrong-length input artifact refs", () => {
    expect(
      failuresOf(prepareAssignment(), spec(), [
        { artifactId: " input-manifest ", schemaVersion: "catalog-evidence-input/v1", contentHash: HASH },
      ]),
    ).toMatch(/whitespace|artifactId/);

    expect(
      failuresOf(prepareAssignment(), spec(), [
        {
          artifactId: "input-manifest",
          schemaVersion: "catalog-evidence-input/v1",
          contentHash: HASH,
          trustedByDefault: true,
        },
      ]),
    ).toMatch(/unrecognized|additional/i);

    expect(
      failuresOf(prepareAssignment(), spec(), [
        { artifactId: "input-manifest", schemaVersion: "catalog-evidence-input/v1", contentHash: "abc" },
      ]),
    ).toMatch(/64-character|contentHash/);
  });
});

describe("execution-step envelope leftover gates", () => {
  it("refuses an agent-owned validate step and a snapshot whose executor identity does not match", () => {
    const agentValidate = executionStepAssignmentToEnvelope(
      {
        ...validateAssignment({
          executorKind: "agent",
          profileAuthoritySnapshot: validatorSnapshot(),
        }),
        planHash: HASH,
        stepKey: "validate",
      },
      spec(),
      [{ artifactId: "packet-001", schemaVersion: "catalog-evidence-packet/v1", contentHash: HASH }],
    );
    expect(agentValidate.ok).toBe(false);
    expect(agentValidate.ok ? "" : agentValidate.failures.join(" ")).toMatch(/deterministic/);

    const mismatchedKey = executionStepAssignmentToEnvelope(
      stepAssignment({
        profileAuthoritySnapshot: hermesSnapshot({
          executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
        }),
      }),
      spec(),
      inputRefs(),
    );
    expect(mismatchedKey.ok).toBe(false);
    expect(mismatchedKey.ok ? "" : mismatchedKey.failures.join(" ")).toMatch(/executorKey does not match/);
  });

  it("still refuses a padded step key on the leased execution-step path", () => {
    const padded = executionStepAssignmentToEnvelope(stepAssignment({ stepKey: " research" }), spec(), inputRefs());
    expect(padded.ok).toBe(false);
    expect(padded.ok ? "" : padded.failures.join(" ")).toMatch(/whitespace|stepKey/);
  });
});
