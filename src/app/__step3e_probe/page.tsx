import {
  SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
  SKILL_QUALIFICATION_SCHEMA_VERSION,
  evaluateSkillQualification,
  type SkillQualificationCandidate,
  type SkillQualificationObservation,
} from "@/lib/skill-qualification";

const PROCEDURE_HASH = "a".repeat(64);
const ARTIFACT_HASH = "b".repeat(64);

function candidate(): SkillQualificationCandidate {
  return {
    schemaVersion: SKILL_QUALIFICATION_SCHEMA_VERSION,
    candidateKey: "qualification-build-probe",
    candidateVersion: "qualification-build-probe/v1",
    capabilityKey: "evidence_research",
    procedureArtifactRef: {
      artifactId: "procedure-build-probe",
      schemaVersion: "procedure/v1",
      contentHash: PROCEDURE_HASH,
    },
    inputContractVersions: ["catalog-evidence-input/v1"],
    outputContractVersions: ["catalog-evidence-packet/v1"],
    requiredToolClasses: ["public_read", "artifact_read"],
    authorityCeiling: "prepare_only",
    mayOwnAuthoritativeState: false,
    knownFailureClasses: ["evidence_failure"],
    currentState: "shadow",
    qualificationSuite: {
      suiteKey: "build-probe-suite",
      suiteVersion: "build-probe-suite/v1",
      acceptedOutcomeReceiptSchemaVersion: "outcome-receipt/v1",
      minimumDistinctRuns: 2,
      minimumAcceptedOutcomes: 2,
      minimumHardGatePasses: 2,
      minimumHardGatePassRateBps: 10_000,
      maximumAuthorityIncidents: 0,
      maximumHighSeverityUnsupportedClaimsAccepted: 0,
      maximumWrongModelAcceptances: 0,
      maximumReviewerCorrections: 0,
      maximumUnresolvedEscalations: 0,
      requireIndependentReview: true,
      requireDeterministicValidation: true,
      requireMeasuredHumanMinutes: true,
      requireMeasuredOwnerMinutes: true,
      requireMeasuredAiCost: true,
      requireMeasuredToolCost: true,
    },
  };
}

function observation(
  runId: string,
  overrides: Partial<SkillQualificationObservation> = {},
): SkillQualificationObservation {
  return {
    schemaVersion: SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
    observationId: `probe-${runId}`,
    candidateKey: "qualification-build-probe",
    candidateVersion: "qualification-build-probe/v1",
    capabilityKey: "evidence_research",
    procedureHash: PROCEDURE_HASH,
    suiteKey: "build-probe-suite",
    suiteVersion: "build-probe-suite/v1",
    runId,
    executorConfigurationSnapshot: {
      executorKey: "probe-executor",
      executorKind: "agent",
      provider: "probe-provider",
      protocolVersion: "probe/v1",
      modelId: "probe-model",
      configHash: null,
    },
    observedAt: "2026-08-25T20:00:00Z",
    evidenceArtifactRefs: [{
      artifactId: `evidence-${runId}`,
      schemaVersion: "catalog-evidence-packet/v1",
      contentHash: ARTIFACT_HASH,
    }],
    acceptedOutcomeReceiptRef: {
      artifactId: `receipt-${runId}`,
      schemaVersion: "outcome-receipt/v1",
      contentHash: ARTIFACT_HASH,
    },
    hardGatePassed: true,
    independentReviewPerformed: true,
    deterministicValidationPerformed: true,
    authorityIncidentCount: 0,
    highSeverityUnsupportedClaimsAccepted: 0,
    wrongModelAcceptanceCount: 0,
    reviewerCorrectionCount: 0,
    unresolvedEscalationCount: 0,
    humanMinutes: 1,
    ownerMinutes: 1,
    aiCostMicros: 1,
    toolCostMicros: 0,
    ...overrides,
  };
}

function requireProbe(condition: boolean, message: string): void {
  if (!condition) throw new Error("Step 3E build probe failed: " + message);
}

function runProbe(): void {
  const clean = evaluateSkillQualification(candidate(), [observation("one"), observation("two")]);
  requireProbe(clean.ok && clean.value.decision === "qualify", "clean repeated outcomes did not qualify");
  requireProbe(clean.ok && !clean.value.authorityGranted, "qualification granted authority");

  const shadow = evaluateSkillQualification(candidate(), [
    observation("three"),
    observation("four", { acceptedOutcomeReceiptRef: null, hardGatePassed: false }),
  ]);
  requireProbe(shadow.ok && shadow.value.decision === "remain_shadow", "failed outcome escaped shadow");

  const unmeasured = evaluateSkillQualification(candidate(), [
    observation("five"),
    observation("six", { aiCostMicros: null }),
  ]);
  requireProbe(
    unmeasured.ok && unmeasured.value.failures.includes("ai_cost_unmeasured"),
    "missing cost became measured",
  );

  const incident = evaluateSkillQualification(candidate(), [
    observation("seven"),
    observation("eight", { authorityIncidentCount: 1 }),
  ]);
  requireProbe(incident.ok && incident.value.decision === "suspend", "authority incident did not suspend");

  const duplicate = evaluateSkillQualification(candidate(), [
    observation("nine"),
    observation("nine", { observationId: "probe-nine-other" }),
  ]);
  requireProbe(!duplicate.ok, "duplicate run was accepted");

  const wrongReceipt = evaluateSkillQualification(candidate(), [
    observation("ten"),
    observation("eleven", {
      acceptedOutcomeReceiptRef: {
        artifactId: "receipt-eleven",
        schemaVersion: "untrusted-receipt/v1",
        contentHash: ARTIFACT_HASH,
      },
    }),
  ]);
  requireProbe(!wrongReceipt.ok, "wrong receipt contract was accepted");
}

runProbe();

export const dynamic = "force-static";

export default function Step3eBuildProbe() {
  return <main>Step 3E build probe passed.</main>;
}

