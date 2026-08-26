import {
  NATIVE_SKILL_SCHEMA_VERSION,
  SKILL_PROCEDURE_SCHEMA_VERSION,
  createNativeSkill,
  createSkillProcedure,
  moveNativeSkillToShadow,
  projectNativeSkill,
  qualifyNativeSkill,
  registeredNativeSkills,
  validateNativeSkill,
} from "@/lib/native-skill-registry";
import {
  SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
  SKILL_QUALIFICATION_SCHEMA_VERSION,
  evaluateSkillQualification,
  hashSkillQualificationDecision,
} from "@/lib/skill-qualification";

const HASH = "e".repeat(64);

function requireProbe(condition: boolean, message: string): void {
  if (!condition) throw new Error("CS-12 build probe failed: " + message);
}

function runProbe(): void {
  const procedure = createSkillProcedure({
    artifactId: "probe-procedure",
    schemaVersion: SKILL_PROCEDURE_SCHEMA_VERSION,
    objective: "Prepare bounded evidence.",
    steps: ["Read frozen inputs.", "Return source-bound claims."],
    escalationRules: ["Escalate identity ambiguity."],
    stopConditions: ["Stop before external action."],
  });
  requireProbe(procedure.ok, "procedure creation failed");
  if (!procedure.ok) return;

  const suite = {
    suiteKey: "probe-suite",
    suiteVersion: "probe-suite/v1",
    acceptedOutcomeReceiptSchemaVersion: "outcome-receipt/v1",
    minimumDistinctRuns: 2,
    minimumAcceptedOutcomes: 2,
    minimumHardGatePasses: 2,
    minimumHardGatePassRateBps: 10_000,
    maximumAuthorityIncidents: 0 as const,
    maximumHighSeverityUnsupportedClaimsAccepted: 0 as const,
    maximumWrongModelAcceptances: 0 as const,
    maximumReviewerCorrections: 0,
    maximumUnresolvedEscalations: 0,
    requireIndependentReview: true,
    requireDeterministicValidation: true,
    requireMeasuredHumanMinutes: true,
    requireMeasuredOwnerMinutes: true,
    requireMeasuredAiCost: true,
    requireMeasuredToolCost: true,
  };
  const created = createNativeSkill({
    schemaVersion: NATIVE_SKILL_SCHEMA_VERSION,
    skillKey: "probe-skill",
    skillVersion: "probe-skill/v1",
    displayName: "Probe Skill",
    description: "Build-time verification only.",
    capabilityKey: "evidence_research",
    applicabilityConditions: ["Frozen inputs exist."],
    requiredInputs: ["Frozen input manifest"],
    procedureArtifact: procedure.value,
    requiredToolClasses: ["public_read", "artifact_read"],
    authorityCeiling: "prepare_only",
    mayOwnAuthoritativeState: false,
    inputContractVersions: ["catalog-evidence-input/v1"],
    outputContractVersions: ["catalog-evidence-packet/v1"],
    evidenceRequirements: ["Source URL"],
    verificationContract: {
      kind: "deterministic",
      implementation: "probe-validator/v1",
      requiredEvidence: ["probe-review/v1"],
    },
    qualificationSuite: suite,
    economicProfile: {
      currency: "USD",
      expectedHumanMinutes: null,
      expectedOwnerMinutes: null,
      expectedAiCostMicros: null,
      expectedToolCostMicros: null,
      evidenceSummary: "Unknown until qualification.",
    },
    knownFailureClasses: ["evidence_failure"],
    provenance: {
      createdBy: "probe-manager",
      createdAt: "2026-08-26T05:00:00Z",
      sourceArtifactRefs: [{
        artifactId: "probe-source",
        schemaVersion: "probe-source/v1",
        contentHash: HASH,
      }],
    },
  });
  requireProbe(created.ok, "Skill creation failed");
  if (!created.ok) return;
  const shadow = moveNativeSkillToShadow(created.value);
  requireProbe(shadow.ok, "candidate did not enter shadow");
  if (!shadow.ok) return;
  requireProbe(!projectNativeSkill(shadow.value, "hermes_markdown").ok, "shadow Skill was projected");
  requireProbe(
    !validateNativeSkill({ ...shadow.value, description: "tampered" }).ok,
    "definition tampering was accepted",
  );

  const candidate = {
    schemaVersion: SKILL_QUALIFICATION_SCHEMA_VERSION,
    candidateKey: shadow.value.skillKey,
    candidateVersion: shadow.value.skillVersion,
    capabilityKey: shadow.value.capabilityKey,
    procedureArtifactRef: {
      artifactId: shadow.value.procedureArtifact.artifactId,
      schemaVersion: shadow.value.procedureArtifact.schemaVersion,
      contentHash: shadow.value.procedureArtifact.contentHash,
    },
    inputContractVersions: shadow.value.inputContractVersions,
    outputContractVersions: shadow.value.outputContractVersions,
    requiredToolClasses: shadow.value.requiredToolClasses,
    authorityCeiling: shadow.value.authorityCeiling,
    mayOwnAuthoritativeState: false as const,
    knownFailureClasses: shadow.value.knownFailureClasses,
    currentState: "shadow" as const,
    qualificationSuite: suite,
  };
  const observation = (runId: string) => ({
    schemaVersion: SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
    observationId: `probe-${runId}`,
    candidateKey: shadow.value.skillKey,
    candidateVersion: shadow.value.skillVersion,
    capabilityKey: shadow.value.capabilityKey,
    procedureHash: shadow.value.procedureArtifact.contentHash,
    suiteKey: suite.suiteKey,
    suiteVersion: suite.suiteVersion,
    runId,
    executorConfigurationSnapshot: {
      executorKey: "probe-executor",
      executorKind: "agent" as const,
      provider: "probe-provider",
      protocolVersion: "probe/v1",
      modelId: "probe-model",
      configHash: null,
    },
    observedAt: "2026-08-26T05:10:00Z",
    evidenceArtifactRefs: [{
      artifactId: `evidence-${runId}`,
      schemaVersion: "catalog-evidence-packet/v1",
      contentHash: HASH,
    }],
    acceptedOutcomeReceiptRef: {
      artifactId: `receipt-${runId}`,
      schemaVersion: "outcome-receipt/v1",
      contentHash: HASH,
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
  });
  const evaluated = evaluateSkillQualification(candidate, [observation("one"), observation("two")]);
  requireProbe(evaluated.ok && evaluated.value.decision === "qualify", "clean evidence did not qualify");
  if (!evaluated.ok) return;
  const qualified = qualifyNativeSkill(
    shadow.value,
    evaluated.value,
    {
      artifactId: "probe-decision",
      schemaVersion: "skill-qualification-decision/v1",
      contentHash: evaluated.value.decisionHash,
    },
    "probe-manager",
    "2026-08-26T05:30:00Z",
  );
  requireProbe(qualified.ok, "manager-bound qualification failed");
  if (!qualified.ok) return;
  const originalDecision = qualified.value.qualificationHistory[0].decision;
  const { decisionHash: _decisionHash, ...originalDecisionBody } = originalDecision;
  const foreignDecisionBody = { ...originalDecisionBody, candidateKey: "foreign-skill" };
  const foreignDecision = {
    ...foreignDecisionBody,
    decisionHash: hashSkillQualificationDecision(foreignDecisionBody),
  };
  requireProbe(
    !validateNativeSkill({
      ...qualified.value,
      qualificationHistory: [{
        ...qualified.value.qualificationHistory[0],
        decision: foreignDecision,
        decisionArtifactRef: {
          ...qualified.value.qualificationHistory[0].decisionArtifactRef,
          contentHash: foreignDecision.decisionHash,
        },
      }],
      approval: {
        ...qualified.value.approval,
        qualificationDecisionHash: foreignDecision.decisionHash,
      },
    }).ok,
    "foreign Skill qualification decision was accepted",
  );
  const hermes = projectNativeSkill(qualified.value, "hermes_markdown");
  const grok = projectNativeSkill(qualified.value, "grok_markdown");
  const generic = projectNativeSkill(qualified.value, "generic_json");
  requireProbe(hermes.ok && grok.ok && generic.ok, "runtime projection failed");
  requireProbe(
    hermes.ok && grok.ok && hermes.value.sourceDefinitionHash === grok.value.sourceDefinitionHash,
    "runtime projections drifted from the canonical Skill",
  );
  requireProbe(registeredNativeSkills().length === 0, "a real Skill was seeded without evidence");
}

runProbe();

export const dynamic = "force-static";

export default function Cs12BuildProbe() {
  return <main>CS-12 build probe passed.</main>;
}

