import { describe, expect, it } from "vitest";
import {
  EXECUTOR_ENVELOPE_SCHEMA_VERSION,
  EXECUTOR_RESULT_SCHEMA_VERSION,
  hashExecutorEnvelope,
  hashExecutorResult,
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

describe("executor envelope v1", () => {
  it("accepts a valid envelope", () => {
    const check = validateExecutorEnvelope(envelope());
    expect(check.ok).toBe(true);
  });

  it("rejects proposed capabilities and non-deterministic validation", () => {
    const proposed = validateExecutorEnvelope(
      envelope({ capabilityKey: "software_repository_read" }),
    );
    expect(proposed.ok).toBe(false);
    expect(proposed.ok ? [] : proposed.failures.join(" ")).toContain("not active");

    const nonDeterministic = validateExecutorEnvelope(
      envelope({
        phase: "validate",
        executorConfigurationSnapshot: {
          ...envelope().executorConfigurationSnapshot,
          executorKind: "agent",
        },
      }),
    );
    expect(nonDeterministic.ok).toBe(false);
    expect(nonDeterministic.ok ? [] : nonDeterministic.failures.join(" ")).toContain("deterministic");
  });

  it("rejects output contracts not declared by the capability", () => {
    const check = validateExecutorEnvelope(
      envelope({
        outputContract: {
          schemaVersion: "catalog-evidence-review/v1",
          artifactKind: "wrong",
        },
      }),
    );
    expect(check.ok).toBe(false);
    expect(check.ok ? [] : check.failures.join(" ")).toContain("not declared");
  });

  it("accepts a matching result and hashes deterministically", () => {
    const input = envelope();
    const output = result();
    const check = validateExecutorResult(output, input);
    expect(check.ok).toBe(true);
    expect(hashExecutorEnvelope(input)).toBe(hashExecutorEnvelope({ ...input }));
    expect(hashExecutorResult(output)).toBe(hashExecutorResult({ ...output }));
  });

  it("rejects result identity drift and reported authority incidents", () => {
    const check = validateExecutorResult(
      result({
        runId: "other-run",
        authorityReport: { ...authorityReport(), externalMessagesSent: 1 },
      }),
      envelope(),
    );
    expect(check.ok).toBe(false);
    const failures = check.ok ? [] : check.failures.join(" ");
    expect(failures).toContain("runId");
    expect(failures).toContain("external authority action");
  });

  it("rejects a result that completes before it starts", () => {
    const check = validateExecutorResult(
      result({
        executionProvenance: {
          ...result().executionProvenance,
          completedAt: "2026-08-25T20:00:30Z",
        },
      }),
      envelope(),
    );
    expect(check.ok).toBe(false);
    expect(check.ok ? [] : check.failures.join(" ")).toContain("precede startedAt");
  });

  it("requires a reason for blocked results and enforces economic limits", () => {
    const check = validateExecutorResult(
      result({
        status: "blocked",
        failure: null,
        escalation: { required: false, reason: "" },
        economics: { humanMinutes: 31, aiCostMicros: 1, toolCostMicros: 1 },
      }),
      envelope(),
    );
    expect(check.ok).toBe(false);
    const failures = check.ok ? [] : check.failures.join(" ");
    expect(failures).toContain("required escalation");
    expect(failures).toContain("humanMinutes");
  });
});
