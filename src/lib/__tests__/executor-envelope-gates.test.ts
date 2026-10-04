import { describe, expect, it } from "vitest";
import {
  EXECUTOR_ENVELOPE_SCHEMA_VERSION,
  EXECUTOR_RESULT_SCHEMA_VERSION,
  validateExecutorEnvelope,
  validateExecutorResult,
  type ExecutorEnvelopeV1,
  type ExecutorResultV1,
} from "@/lib/executor-envelope";

const HASH = "a".repeat(64);

function authorityReport() {
  return {
    externalMessagesSent: 0,
    purchasesMade: 0,
    accountsCreated: 0,
    repositoryChangesMade: 0,
    catalogRecordsModified: 0,
    permissionsChanged: 0,
    skillsCreatedOrModified: 0,
    routinesCreatedOrModified: 0,
    otherExternalActions: 0,
  };
}

function envelope(overrides: Partial<ExecutorEnvelopeV1> = {}): ExecutorEnvelopeV1 {
  return {
    schemaVersion: EXECUTOR_ENVELOPE_SCHEMA_VERSION,
    runId: "run-001",
    assignmentId: "assignment-001",
    capabilityKey: "evidence_research",
    phase: "prepare",
    objective: "Prepare source-backed candidate evidence.",
    inputArtifactRefs: [
      { artifactId: "input-001", schemaVersion: "catalog-evidence-input/v1", contentHash: HASH },
    ],
    authoritySnapshot: {
      contractVersion: "authority-snapshot/v1",
      actionClass: "prepare_only",
      allowedActions: ["read_frozen_input"],
      forbiddenActions: ["publish", "modify_catalog"],
      mayOwnAuthoritativeState: false,
    },
    allowedToolClasses: ["public_read"],
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
    createdAt: "2026-08-25T20:00:00Z",
    deadline: "2026-08-25T21:00:00Z",
    executorConfigurationSnapshot: {
      executorKey: "hermes-loadout-researcher-v1",
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "loadout/v1",
      modelId: "free",
      configHash: null,
    },
    ...overrides,
  };
}

function result(overrides: Partial<ExecutorResultV1> = {}): ExecutorResultV1 {
  return {
    schemaVersion: EXECUTOR_RESULT_SCHEMA_VERSION,
    runId: "run-001",
    assignmentId: "assignment-001",
    capabilityKey: "evidence_research",
    status: "completed",
    outputArtifactRef: {
      artifactId: "packet-001",
      schemaVersion: "catalog-evidence-packet/v1",
      contentHash: HASH,
    },
    candidatePayload: { products: [] },
    evidenceRefs: [
      { artifactId: "source-001", schemaVersion: "source-evidence/v1", contentHash: HASH },
    ],
    escalation: { required: false, reason: "" },
    authorityReport: authorityReport(),
    economics: { humanMinutes: 2, aiCostMicros: 1, toolCostMicros: 1 },
    failure: null,
    executionProvenance: {
      executorKey: "hermes-loadout-researcher-v1",
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "loadout/v1",
      modelId: "free",
      configHash: null,
      startedAt: "2026-08-25T20:01:00Z",
      completedAt: "2026-08-25T20:05:00Z",
    },
    ...overrides,
  };
}

function failuresOf(check: { ok: boolean; failures?: string[] }) {
  return check.ok ? "" : check.failures!.join(" ");
}

describe("executor envelope leftover identity and contract gates", () => {
  it("refuses extra keys and padded identifiers so a repaired payload cannot hash as the original", () => {
    const extra = validateExecutorEnvelope({ ...envelope(), trustedByDefault: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const paddedRun = validateExecutorEnvelope(envelope({ runId: " run-001 " }));
    expect(paddedRun.ok).toBe(false);
    expect(failuresOf(paddedRun)).toMatch(/whitespace|runId/);

    const paddedCapability = validateExecutorEnvelope(envelope({ capabilityKey: "evidence_research " }));
    expect(paddedCapability.ok).toBe(false);
    expect(failuresOf(paddedCapability)).toMatch(/whitespace|capabilityKey/);
  });

  it("refuses an unregistered capability, an undeclared input contract, and a duplicate input artifact", () => {
    const unknown = validateExecutorEnvelope(envelope({ capabilityKey: "not_a_registered_capability" }));
    expect(unknown.ok).toBe(false);
    expect(failuresOf(unknown)).toContain("not registered");

    const undeclaredInput = validateExecutorEnvelope(
      envelope({
        inputArtifactRefs: [
          { artifactId: "input-001", schemaVersion: "unexpected-input/v1", contentHash: HASH },
        ],
      }),
    );
    expect(undeclaredInput.ok).toBe(false);
    expect(failuresOf(undeclaredInput)).toContain("not declared by the capability");

    const duplicate = validateExecutorEnvelope(
      envelope({
        inputArtifactRefs: [
          { artifactId: "input-001", schemaVersion: "catalog-evidence-input/v1", contentHash: HASH },
          { artifactId: "input-001", schemaVersion: "catalog-evidence-input/v1", contentHash: "b".repeat(64) },
        ],
      }),
    );
    expect(duplicate.ok).toBe(false);
    expect(failuresOf(duplicate)).toContain("duplicate artifactId");
  });

  it("refuses a deadline that precedes createdAt", () => {
    const inverted = validateExecutorEnvelope(
      envelope({
        createdAt: "2026-08-25T21:00:00Z",
        deadline: "2026-08-25T20:00:00Z",
      }),
    );
    expect(inverted.ok).toBe(false);
    expect(failuresOf(inverted)).toContain("deadline must not precede createdAt");
  });
});

describe("executor result leftover binding and limit gates", () => {
  it("binds assignment, capability, and every provenance field to the governing envelope", () => {
    const assignment = validateExecutorResult(result({ assignmentId: "assignment-other" }), envelope());
    expect(assignment.ok).toBe(false);
    expect(failuresOf(assignment)).toContain("assignmentId");

    const capability = validateExecutorResult(result({ capabilityKey: "independent_evidence_review" }), envelope());
    expect(capability.ok).toBe(false);
    expect(failuresOf(capability)).toContain("capabilityKey");

    const provenance = result().executionProvenance;
    const mismatches = [
      [{ ...provenance, executorKey: "other-executor" }, "executorKey"],
      [{ ...provenance, executorKind: "deterministic" as const }, "executorKind"],
      [{ ...provenance, provider: "other-provider" }, "provider"],
      [{ ...provenance, protocolVersion: "other/v1" }, "protocolVersion"],
      [{ ...provenance, modelId: "other-model" }, "modelId"],
      [{ ...provenance, configHash: "c".repeat(64) }, "configHash"],
    ] as const;

    for (const [executionProvenance, field] of mismatches) {
      const check = validateExecutorResult(result({ executionProvenance }), envelope());
      expect(check.ok, `expected ${field} mismatch to fail`).toBe(false);
      expect(failuresOf(check)).toContain(field);
    }
  });

  it("refuses a completed result with no output, a mismatched output contract, and duplicate evidence", () => {
    const emptyCompleted = validateExecutorResult(
      result({ outputArtifactRef: null, candidatePayload: null }),
      envelope(),
    );
    expect(emptyCompleted.ok).toBe(false);
    expect(failuresOf(emptyCompleted)).toContain("outputArtifactRef or candidatePayload");

    const wrongOutput = validateExecutorResult(
      result({
        outputArtifactRef: {
          artifactId: "packet-001",
          schemaVersion: "catalog-evidence-review/v1",
          contentHash: HASH,
        },
      }),
      envelope(),
    );
    expect(wrongOutput.ok).toBe(false);
    expect(failuresOf(wrongOutput)).toContain("outputArtifactRef.schemaVersion");

    const duplicateEvidence = validateExecutorResult(
      result({
        evidenceRefs: [
          { artifactId: "source-001", schemaVersion: "source-evidence/v1", contentHash: HASH },
          { artifactId: "source-001", schemaVersion: "source-evidence/v1", contentHash: "b".repeat(64) },
        ],
      }),
      envelope(),
    );
    expect(duplicateEvidence.ok).toBe(false);
    expect(failuresOf(duplicateEvidence)).toContain("duplicate artifactId");
  });

  it("enforces remaining economic limits and refuses a completion after the envelope deadline", () => {
    const aiCost = validateExecutorResult(
      result({ economics: { humanMinutes: 2, aiCostMicros: 500001, toolCostMicros: 1 } }),
      envelope(),
    );
    expect(aiCost.ok).toBe(false);
    expect(failuresOf(aiCost)).toContain("aiCostMicros");

    const toolCost = validateExecutorResult(
      result({ economics: { humanMinutes: 2, aiCostMicros: 1, toolCostMicros: 500001 } }),
      envelope(),
    );
    expect(toolCost.ok).toBe(false);
    expect(failuresOf(toolCost)).toContain("toolCostMicros");

    const late = validateExecutorResult(
      result({
        executionProvenance: {
          ...result().executionProvenance,
          completedAt: "2026-08-25T21:00:01Z",
        },
      }),
      envelope(),
    );
    expect(late.ok).toBe(false);
    expect(failuresOf(late)).toContain("exceeds the envelope deadline");
  });

  it("prefixes a governing-envelope failure and still requires a reason for a failed result", () => {
    const governing = validateExecutorResult(result(), envelope({ capabilityKey: "not_a_registered_capability" }));
    expect(governing.ok).toBe(false);
    expect(failuresOf(governing)).toMatch(/^Governing /);
    expect(failuresOf(governing)).toContain("not registered");

    const failed = validateExecutorResult(
      result({
        status: "failed",
        failure: null,
        escalation: { required: false, reason: "" },
      }),
      envelope(),
    );
    expect(failed.ok).toBe(false);
    expect(failuresOf(failed)).toContain("required escalation");
  });

  it("refuses extra keys on a result so a repaired payload cannot bind to the envelope", () => {
    const extra = validateExecutorResult({ ...result(), repaired: true }, envelope());
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);
  });
});
