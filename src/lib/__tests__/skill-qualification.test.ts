import { describe, expect, it } from "vitest";
import {
  SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
  SKILL_QUALIFICATION_SCHEMA_VERSION,
  evaluateSkillQualification,
  type SkillQualificationCandidate,
  type SkillQualificationObservation,
} from "@/lib/skill-qualification";

const PROCEDURE_HASH = "a".repeat(64);
const EVIDENCE_HASH = "b".repeat(64);

function candidate(
  overrides: Partial<SkillQualificationCandidate> = {},
): SkillQualificationCandidate {
  return {
    schemaVersion: SKILL_QUALIFICATION_SCHEMA_VERSION,
    candidateKey: "catalog-integrity-research",
    candidateVersion: "catalog-integrity-research/v1",
    capabilityKey: "evidence_research",
    procedureArtifactRef: {
      artifactId: "procedure-001",
      schemaVersion: "procedure/v1",
      contentHash: PROCEDURE_HASH,
    },
    inputContractVersions: ["catalog-evidence-input/v1"],
    outputContractVersions: ["catalog-evidence-packet/v1"],
    requiredToolClasses: ["public_read", "artifact_read", "artifact_write"],
    authorityCeiling: "prepare_only",
    mayOwnAuthoritativeState: false,
    knownFailureClasses: ["evidence_failure", "unsupported_certainty", "wrong_model_acceptance"],
    currentState: "shadow",
    qualificationSuite: {
      suiteKey: "catalog-integrity-skill-suite",
      suiteVersion: "catalog-integrity-skill-suite/v1",
      acceptedOutcomeReceiptSchemaVersion: "outcome-receipt/v1",
      minimumDistinctRuns: 2,
      minimumAcceptedOutcomes: 2,
      minimumHardGatePasses: 2,
      minimumHardGatePassRateBps: 10_000,
      maximumAuthorityIncidents: 0,
      maximumHighSeverityUnsupportedClaimsAccepted: 0,
      maximumWrongModelAcceptances: 0,
      maximumReviewerCorrections: 1,
      maximumUnresolvedEscalations: 0,
      requireIndependentReview: true,
      requireDeterministicValidation: true,
      requireMeasuredHumanMinutes: true,
      requireMeasuredOwnerMinutes: true,
      requireMeasuredAiCost: true,
      requireMeasuredToolCost: true,
    },
    ...overrides,
  };
}

function observation(
  runId: string,
  overrides: Partial<SkillQualificationObservation> = {},
): SkillQualificationObservation {
  return {
    schemaVersion: SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
    observationId: `observation-${runId}`,
    candidateKey: "catalog-integrity-research",
    candidateVersion: "catalog-integrity-research/v1",
    capabilityKey: "evidence_research",
    procedureHash: PROCEDURE_HASH,
    suiteKey: "catalog-integrity-skill-suite",
    suiteVersion: "catalog-integrity-skill-suite/v1",
    runId,
    executorConfigurationSnapshot: {
      executorKey: "hermes-loadout-researcher-v1",
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "loadout/v1",
      modelId: "free",
      configHash: null,
    },
    observedAt: "2026-08-25T20:00:00Z",
    evidenceArtifactRefs: [
      {
        artifactId: `evidence-${runId}`,
        schemaVersion: "catalog-evidence-packet/v1",
        contentHash: EVIDENCE_HASH,
      },
    ],
    acceptedOutcomeReceiptRef: {
      artifactId: `receipt-${runId}`,
      schemaVersion: "outcome-receipt/v1",
      contentHash: EVIDENCE_HASH,
    },
    hardGatePassed: true,
    independentReviewPerformed: true,
    deterministicValidationPerformed: true,
    authorityIncidentCount: 0,
    highSeverityUnsupportedClaimsAccepted: 0,
    wrongModelAcceptanceCount: 0,
    reviewerCorrectionCount: 0,
    unresolvedEscalationCount: 0,
    humanMinutes: 12,
    ownerMinutes: 2,
    aiCostMicros: 25_000,
    toolCostMicros: 0,
    ...overrides,
  };
}

describe("Step 3E Skill qualification v1", () => {
  it("recommends qualification only after repeated accepted, measured outcomes", () => {
    const result = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002"),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe("qualify");
      expect(result.value.requiresManagerApproval).toBe(true);
      expect(result.value.authorityGranted).toBe(false);
      expect(result.value.decisionHash).toHaveLength(64);
      expect(result.value.metrics.acceptedOutcomeCount).toBe(2);
    }
  });

  it("keeps failed hard gates and rejected outcomes in shadow", () => {
    const result = evaluateSkillQualification(candidate(), [
      observation("run-004", {
        acceptedOutcomeReceiptRef: null,
        hardGatePassed: false,
        reviewerCorrectionCount: 1,
        unresolvedEscalationCount: 1,
      }),
      observation("run-005", {
        acceptedOutcomeReceiptRef: null,
        hardGatePassed: false,
        reviewerCorrectionCount: 1,
        unresolvedEscalationCount: 1,
      }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe("remain_shadow");
      expect(result.value.failures).toContain("insufficient_accepted_outcomes");
      expect(result.value.failures).toContain("insufficient_hard_gate_passes");
      expect(result.value.authorityGranted).toBe(false);
    }
  });

  it("does not turn missing economics into zero-cost evidence", () => {
    const result = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", {
        humanMinutes: null,
        ownerMinutes: null,
        aiCostMicros: null,
        toolCostMicros: null,
      }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe("remain_shadow");
      expect(result.value.failures).toEqual(
        expect.arrayContaining([
          "human_minutes_unmeasured",
          "owner_minutes_unmeasured",
          "ai_cost_unmeasured",
          "tool_cost_unmeasured",
        ]),
      );
    }
  });

  it("recommends suspension after any authority incident", () => {
    const result = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { authorityIncidentCount: 1 }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision).toBe("suspend");
      expect(result.value.failures).toContain("authority_incident_limit_exceeded");
      expect(result.value.authorityGranted).toBe(false);
    }
  });

  it("rejects duplicate runs and stale procedure bindings", () => {
    const duplicate = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-001", { observationId: "observation-other" }),
    ]);
    expect(duplicate.ok).toBe(false);
    expect(duplicate.ok ? [] : duplicate.failures.join(" ")).toContain("runId values must be unique");

    const stale = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { procedureHash: "c".repeat(64) }),
    ]);
    expect(stale.ok).toBe(false);
    expect(stale.ok ? [] : stale.failures.join(" ")).toContain("frozen procedure artifact");
  });

  it("rejects an outcome receipt from the wrong contract", () => {
    const result = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", {
        acceptedOutcomeReceiptRef: {
          artifactId: "receipt-run-002",
          schemaVersion: "untrusted-receipt/v1",
          contentHash: EVIDENCE_HASH,
        },
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("Outcome Receipt schema");
  });
});
