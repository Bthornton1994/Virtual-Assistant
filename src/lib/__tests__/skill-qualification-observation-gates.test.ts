import { describe, expect, it } from "vitest";
import {
  SKILL_QUALIFICATION_DECISION_SCHEMA_VERSION,
  SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
  SKILL_QUALIFICATION_SCHEMA_VERSION,
  evaluateSkillQualification,
  validateSkillQualificationDecision,
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

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("skill qualification leftover observation gates", () => {
  it("refuses extra keys, padded identifiers, and duplicate evidence artifact IDs", () => {
    const extra = evaluateSkillQualification(candidate(), [
      { ...observation("run-001"), autoCount: true },
      observation("run-002"),
    ]);
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = evaluateSkillQualification(candidate(), [
      observation("run-001", { observationId: " observation-run-001 " }),
      observation("run-002"),
    ]);
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|observationId/i);

    const duplicateEvidence = evaluateSkillQualification(candidate(), [
      observation("run-001", {
        evidenceArtifactRefs: [
          { artifactId: "evidence-shared", schemaVersion: "catalog-evidence-packet/v1", contentHash: EVIDENCE_HASH },
          { artifactId: "evidence-shared", schemaVersion: "catalog-evidence-packet/v1", contentHash: EVIDENCE_HASH },
        ],
      }),
      observation("run-002"),
    ]);
    expect(duplicateEvidence.ok).toBe(false);
    expect(failuresOf(duplicateEvidence)).toMatch(/artifactId values must be unique/i);
  });

  it("refuses duplicate observation IDs or run IDs instead of counting them twice", () => {
    const duplicateObservation = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { observationId: "observation-run-001" }),
    ]);
    expect(duplicateObservation.ok).toBe(false);
    expect(failuresOf(duplicateObservation)).toMatch(/observationId values must be unique/i);

    const duplicateRun = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { runId: "run-001" }),
    ]);
    expect(duplicateRun.ok).toBe(false);
    expect(failuresOf(duplicateRun)).toMatch(/runId values must be unique/i);
  });
});

describe("skill qualification leftover binding and suite gates", () => {
  it("binds capability, procedure, suite, and receipt schema to the candidate", () => {
    const capability = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { capabilityKey: "independent_evidence_review" }),
    ]);
    expect(capability.ok).toBe(false);
    expect(failuresOf(capability)).toMatch(/capabilityKey does not match/i);

    const procedure = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { procedureHash: "c".repeat(64) }),
    ]);
    expect(procedure.ok).toBe(false);
    expect(failuresOf(procedure)).toMatch(/procedureHash does not match/i);

    const suite = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { suiteKey: "other-suite" }),
    ]);
    expect(suite.ok).toBe(false);
    expect(failuresOf(suite)).toMatch(/qualification suite does not match/i);

    const receiptSchema = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", {
        acceptedOutcomeReceiptRef: {
          artifactId: "receipt-run-002",
          schemaVersion: "other-receipt/v1",
          contentHash: EVIDENCE_HASH,
        },
      }),
    ]);
    expect(receiptSchema.ok).toBe(false);
    expect(failuresOf(receiptSchema)).toMatch(/Outcome Receipt schema does not match/i);
  });

  it("refuses inverted suite minima, duplicate contracts, and extra suite keys", () => {
    const inverted = evaluateSkillQualification(
      candidate({
        qualificationSuite: {
          ...candidate().qualificationSuite,
          minimumDistinctRuns: 2,
          minimumAcceptedOutcomes: 3,
        },
      }),
      [observation("run-001"), observation("run-002")],
    );
    expect(inverted.ok).toBe(false);
    expect(failuresOf(inverted)).toMatch(/cannot exceed minimumDistinctRuns/i);

    const duplicates = evaluateSkillQualification(
      candidate({
        inputContractVersions: ["catalog-evidence-input/v1", "catalog-evidence-input/v1"],
      }),
      [observation("run-001"), observation("run-002")],
    );
    expect(duplicates.ok).toBe(false);
    expect(failuresOf(duplicates)).toMatch(/must not contain duplicates/i);

    const extraSuite = evaluateSkillQualification(
      candidate({
        qualificationSuite: {
          ...candidate().qualificationSuite,
          autoQualifyAt: "2026-08-25T20:00:00Z",
        } as SkillQualificationCandidate["qualificationSuite"],
      }),
      [observation("run-001"), observation("run-002")],
    );
    expect(extraSuite.ok).toBe(false);
    expect(failuresOf(extraSuite)).toMatch(/unrecognized|additional/i);
  });

  it("keeps remaining measurement and correction ceilings in shadow without granting authority", () => {
    const unmeasured = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { humanMinutes: null, ownerMinutes: null, aiCostMicros: null, toolCostMicros: null }),
    ]);
    expect(unmeasured.ok).toBe(true);
    if (unmeasured.ok) {
      expect(unmeasured.value.decision).toBe("remain_shadow");
      expect(unmeasured.value.authorityGranted).toBe(false);
      expect(unmeasured.value.failures).toEqual(
        expect.arrayContaining([
          "human_minutes_unmeasured",
          "owner_minutes_unmeasured",
          "ai_cost_unmeasured",
          "tool_cost_unmeasured",
        ]),
      );
    }

    const corrections = evaluateSkillQualification(candidate(), [
      observation("run-001", { reviewerCorrectionCount: 1 }),
      observation("run-002", { reviewerCorrectionCount: 1 }),
    ]);
    expect(corrections.ok).toBe(true);
    if (corrections.ok) {
      expect(corrections.value.decision).toBe("remain_shadow");
      expect(corrections.value.failures).toContain("reviewer_correction_limit_exceeded");
    }

    const escalations = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { unresolvedEscalationCount: 1 }),
    ]);
    expect(escalations.ok).toBe(true);
    if (escalations.ok) {
      expect(escalations.value.decision).toBe("remain_shadow");
      expect(escalations.value.failures).toContain("unresolved_escalation_limit_exceeded");
    }
  });

  it("refuses extra keys on a stored decision", () => {
    const qualified = evaluateSkillQualification(candidate(), [observation("run-001"), observation("run-002")]);
    expect(qualified.ok).toBe(true);
    if (!qualified.ok) throw new Error(qualified.failures.join(" "));

    const extra = validateSkillQualificationDecision({
      ...qualified.value,
      autoPromote: true,
    });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = validateSkillQualificationDecision({
      ...qualified.value,
      schemaVersion: SKILL_QUALIFICATION_DECISION_SCHEMA_VERSION,
      candidateKey: " catalog-integrity-research ",
    });
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|candidateKey/i);
  });
});
