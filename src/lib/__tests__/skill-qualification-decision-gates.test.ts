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

describe("skill qualification decision gates", () => {
  it("refuses retired Skills, extra keys, and tools above the authority ceiling", () => {
    const retired = evaluateSkillQualification(candidate({ currentState: "retired" }), [
      observation("run-001"),
      observation("run-002"),
    ]);
    expect(retired.ok).toBe(false);
    expect(failuresOf(retired)).toMatch(/retired/i);

    const extra = evaluateSkillQualification({ ...candidate(), autoQualify: true }, [
      observation("run-001"),
      observation("run-002"),
    ]);
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const ownsState = evaluateSkillQualification(
      candidate({ mayOwnAuthoritativeState: true as false }),
      [observation("run-001"), observation("run-002")],
    );
    expect(ownsState.ok).toBe(false);
    expect(failuresOf(ownsState)).toMatch(/mayOwnAuthoritativeState|false/i);

    const overreach = evaluateSkillQualification(
      candidate({ requiredToolClasses: ["public_read", "external_message_send"] }),
      [observation("run-001"), observation("run-002")],
    );
    expect(overreach.ok).toBe(false);
    expect(failuresOf(overreach)).toMatch(/authority ceiling/i);
  });

  it("keeps missing review, unsupported claims, and wrong-model accepts in shadow without granting authority", () => {
    const missingReview = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { independentReviewPerformed: false, deterministicValidationPerformed: false }),
    ]);
    expect(missingReview.ok).toBe(true);
    if (missingReview.ok) {
      expect(missingReview.value.decision).toBe("remain_shadow");
      expect(missingReview.value.authorityGranted).toBe(false);
      expect(missingReview.value.requiresManagerApproval).toBe(true);
      expect(missingReview.value.failures).toEqual(
        expect.arrayContaining(["independent_review_missing", "deterministic_validation_missing"]),
      );
    }

    const unsupported = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { highSeverityUnsupportedClaimsAccepted: 1, wrongModelAcceptanceCount: 1 }),
    ]);
    expect(unsupported.ok).toBe(true);
    if (unsupported.ok) {
      expect(unsupported.value.decision).toBe("remain_shadow");
      expect(unsupported.value.authorityGranted).toBe(false);
      expect(unsupported.value.failures).toEqual(
        expect.arrayContaining([
          "high_severity_unsupported_claim_limit_exceeded",
          "wrong_model_acceptance_limit_exceeded",
        ]),
      );
    }
  });

  it("rejects a receipt after a failed hard gate, a foreign observation binding, and a forged decision hash", () => {
    const acceptedAfterFail = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { hardGatePassed: false }),
    ]);
    expect(acceptedAfterFail.ok).toBe(false);
    expect(failuresOf(acceptedAfterFail)).toMatch(/hard gate failed/i);

    const foreign = evaluateSkillQualification(candidate(), [
      observation("run-001"),
      observation("run-002", { candidateKey: "other-skill" }),
    ]);
    expect(foreign.ok).toBe(false);
    expect(failuresOf(foreign)).toMatch(/candidateKey/i);

    const qualified = evaluateSkillQualification(candidate(), [observation("run-001"), observation("run-002")]);
    expect(qualified.ok).toBe(true);
    if (!qualified.ok) return;

    const forgedHash = validateSkillQualificationDecision({
      ...qualified.value,
      decisionHash: "c".repeat(64),
    });
    expect(forgedHash.ok).toBe(false);
    expect(failuresOf(forgedHash)).toMatch(/decisionHash/i);

    const granted = validateSkillQualificationDecision({
      ...qualified.value,
      schemaVersion: SKILL_QUALIFICATION_DECISION_SCHEMA_VERSION,
      authorityGranted: true,
    });
    expect(granted.ok).toBe(false);
    expect(failuresOf(granted)).toMatch(/authorityGranted|false/i);
  });
});
