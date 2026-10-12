import { describe, expect, it } from "vitest";
import {
  NATIVE_SKILL_SCHEMA_VERSION,
  SKILL_PROCEDURE_SCHEMA_VERSION,
  createNativeSkill,
  createSkillProcedure,
  moveNativeSkillToShadow,
  projectNativeSkill,
  qualifyNativeSkill,
  qualifiedNativeSkills,
  registeredNativeSkills,
  validateNativeSkill,
  type NativeSkill,
} from "@/lib/native-skill-registry";
import {
  SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
  SKILL_QUALIFICATION_SCHEMA_VERSION,
  evaluateSkillQualification,
  hashSkillQualificationDecision,
  type SkillQualificationCandidate,
  type SkillQualificationObservation,
} from "@/lib/skill-qualification";

const HASH = "d".repeat(64);

function buildProcedure() {
  const built = createSkillProcedure({
    artifactId: "procedure-research-v1",
    schemaVersion: SKILL_PROCEDURE_SCHEMA_VERSION,
    objective: "Prepare source-backed evidence from a frozen input manifest.",
    steps: ["Read only the frozen inputs.", "Collect claim-bound primary-source evidence."],
    escalationRules: ["Escalate when product identity cannot be established."],
    stopConditions: ["Stop before any external publication or catalog write."],
  });
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.failures.join("; "));
  return built.value;
}

function buildShadowSkill(): NativeSkill {
  const procedure = buildProcedure();
  const created = createNativeSkill({
    schemaVersion: NATIVE_SKILL_SCHEMA_VERSION,
    skillKey: "evidence-research-procedure",
    skillVersion: "evidence-research-procedure/v1",
    displayName: "Evidence research procedure",
    description: "Prepare bounded evidence without acting externally.",
    capabilityKey: "evidence_research",
    applicabilityConditions: ["A frozen input manifest is available."],
    requiredInputs: ["Frozen input manifest"],
    procedureArtifact: procedure,
    requiredToolClasses: ["public_read", "artifact_read", "artifact_write"],
    authorityCeiling: "prepare_only",
    mayOwnAuthoritativeState: false,
    inputContractVersions: ["catalog-evidence-input/v1"],
    outputContractVersions: ["catalog-evidence-packet/v1"],
    evidenceRequirements: ["Claim-bound source URL", "Access timestamp", "Raw artifact hash"],
    verificationContract: {
      kind: "deterministic",
      implementation: "catalog-evidence-validator/v1",
      requiredEvidence: ["catalog-evidence-review/v1", "catalog-evidence-validation/v1"],
    },
    qualificationSuite: {
      suiteKey: "evidence-research-skill-suite",
      suiteVersion: "evidence-research-skill-suite/v1",
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
    economicProfile: {
      currency: "USD",
      expectedHumanMinutes: null,
      expectedOwnerMinutes: null,
      expectedAiCostMicros: null,
      expectedToolCostMicros: null,
      evidenceSummary: "No accepted production-equivalent qualification history yet.",
    },
    knownFailureClasses: ["evidence_failure", "unsupported_certainty", "wrong_model_acceptance"],
    provenance: {
      createdBy: "manager-001",
      createdAt: "2026-08-26T04:00:00Z",
      sourceArtifactRefs: [{
        artifactId: "procedure-source-001",
        schemaVersion: "procedure-source/v1",
        contentHash: HASH,
      }],
    },
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error(created.failures.join("; "));
  const shadow = moveNativeSkillToShadow(created.value);
  expect(shadow.ok).toBe(true);
  if (!shadow.ok) throw new Error(shadow.failures.join("; "));
  return shadow.value;
}

function observation(skill: NativeSkill, runId: string): SkillQualificationObservation {
  return {
    schemaVersion: SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION,
    observationId: `observation-${runId}`,
    candidateKey: skill.skillKey,
    candidateVersion: skill.skillVersion,
    capabilityKey: skill.capabilityKey,
    procedureHash: skill.procedureArtifact.contentHash,
    suiteKey: skill.qualificationSuite.suiteKey,
    suiteVersion: skill.qualificationSuite.suiteVersion,
    runId,
    executorConfigurationSnapshot: {
      executorKey: "replaceable-researcher",
      executorKind: "agent",
      provider: "test-provider",
      protocolVersion: "executor/v1",
      modelId: "test-model",
      configHash: null,
    },
    observedAt: "2026-08-26T04:10:00Z",
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
    humanMinutes: 10,
    ownerMinutes: 1,
    aiCostMicros: 20_000,
    toolCostMicros: 0,
  };
}

function qualificationCandidate(skill: NativeSkill): SkillQualificationCandidate {
  return {
    schemaVersion: SKILL_QUALIFICATION_SCHEMA_VERSION,
    candidateKey: skill.skillKey,
    candidateVersion: skill.skillVersion,
    capabilityKey: skill.capabilityKey,
    procedureArtifactRef: {
      artifactId: skill.procedureArtifact.artifactId,
      schemaVersion: skill.procedureArtifact.schemaVersion,
      contentHash: skill.procedureArtifact.contentHash,
    },
    inputContractVersions: skill.inputContractVersions,
    outputContractVersions: skill.outputContractVersions,
    requiredToolClasses: skill.requiredToolClasses,
    authorityCeiling: skill.authorityCeiling,
    mayOwnAuthoritativeState: false,
    knownFailureClasses: skill.knownFailureClasses,
    currentState: "shadow",
    qualificationSuite: skill.qualificationSuite,
  };
}

function buildQualifiedSkill(): NativeSkill {
  const skill = buildShadowSkill();
  const evaluated = evaluateSkillQualification(qualificationCandidate(skill), [
    observation(skill, "run-one"),
    observation(skill, "run-two"),
  ]);
  expect(evaluated.ok).toBe(true);
  if (!evaluated.ok) throw new Error(evaluated.failures.join("; "));
  const qualified = qualifyNativeSkill(
    skill,
    evaluated.value,
    {
      artifactId: "qualification-decision-001",
      schemaVersion: "skill-qualification-decision/v1",
      contentHash: evaluated.value.decisionHash,
    },
    "manager-001",
    "2026-08-26T04:30:00Z",
  );
  expect(qualified.ok).toBe(true);
  if (!qualified.ok) throw new Error(qualified.failures.join("; "));
  return qualified.value;
}

describe("Native Skill Registry v1", () => {
  it("hash-binds an immutable canonical procedure and definition", () => {
    const skill = buildShadowSkill();
    expect(skill.status).toBe("shadow");
    expect(skill.procedureArtifact.contentHash).toHaveLength(64);
    expect(skill.definitionHash).toHaveLength(64);
    expect(validateNativeSkill(skill).ok).toBe(true);

    const tampered = validateNativeSkill({
      ...skill,
      description: "Silently changed procedure meaning.",
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.ok ? [] : tampered.failures.join(" ")).toContain("definitionHash");
  });

  it("requires a hash-valid qualification decision and manager approval", () => {
    const skill = buildShadowSkill();
    const evaluated = evaluateSkillQualification(qualificationCandidate(skill), [
      observation(skill, "run-one"),
      observation(skill, "run-two"),
    ]);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;

    const tampered = qualifyNativeSkill(
      skill,
      { ...evaluated.value, decision: "remain_shadow" },
      {
        artifactId: "qualification-decision-001",
        schemaVersion: "skill-qualification-decision/v1",
        contentHash: evaluated.value.decisionHash,
      },
      "manager-001",
      "2026-08-26T04:30:00Z",
    );
    expect(tampered.ok).toBe(false);
    expect(tampered.ok ? [] : tampered.failures.join(" ")).toContain("decisionHash");
  });

  it("rejects a forged qualification history artifact", () => {
    const skill = buildQualifiedSkill();
    const forged = validateNativeSkill({
      ...skill,
      qualificationHistory: skill.qualificationHistory.map((entry) => ({
        ...entry,
        decisionArtifactRef: {
          ...entry.decisionArtifactRef,
          contentHash: "f".repeat(64),
        },
      })),
    });
    expect(forged.ok).toBe(false);
    expect(forged.ok ? [] : forged.failures.join(" ")).toContain("artifact hash");
  });

  it("rejects a hash-valid qualification decision belonging to another Skill", () => {
    const skill = buildQualifiedSkill();
    const original = skill.qualificationHistory[0].decision;
    const { decisionHash: _decisionHash, ...originalBody } = original;
    const foreignBody = { ...originalBody, candidateKey: "different-skill" };
    const foreignDecision = {
      ...foreignBody,
      decisionHash: hashSkillQualificationDecision(foreignBody),
    };
    const forged = validateNativeSkill({
      ...skill,
      qualificationHistory: [{
        ...skill.qualificationHistory[0],
        decision: foreignDecision,
        decisionArtifactRef: {
          ...skill.qualificationHistory[0].decisionArtifactRef,
          contentHash: foreignDecision.decisionHash,
        },
      }],
      approval: {
        ...skill.approval,
        qualificationDecisionHash: foreignDecision.decisionHash,
      },
    });
    expect(forged.ok).toBe(false);
    expect(forged.ok ? [] : forged.failures.join(" ")).toContain("candidateKey");
  });

  it("regenerates replaceable runtime instructions from one qualified Skill", () => {
    const skill = buildQualifiedSkill();
    const hermes = projectNativeSkill(skill, "hermes_markdown");
    const grok = projectNativeSkill(skill, "grok_markdown");
    const generic = projectNativeSkill(skill, "generic_json");
    expect(hermes.ok && grok.ok && generic.ok).toBe(true);
    if (hermes.ok && grok.ok && generic.ok) {
      expect(hermes.value.sourceDefinitionHash).toBe(skill.definitionHash);
      expect(grok.value.sourceDefinitionHash).toBe(skill.definitionHash);
      expect(generic.value.sourceProcedureHash).toBe(skill.procedureArtifact.contentHash);
      expect(hermes.value.generatedInstructions).toContain("Collect claim-bound primary-source evidence.");
      expect(grok.value.generatedInstructions).toContain("Collect claim-bound primary-source evidence.");
      expect(hermes.value.generatedInstructions).toContain("May own authoritative state: false");
      expect(hermes.value.authorityGranted).toBe(false);
      expect(projectNativeSkill(skill, "hermes_markdown")).toEqual(hermes);
    }
  });

  it("refuses to project a candidate or shadow Skill", () => {
    const projected = projectNativeSkill(buildShadowSkill(), "hermes_markdown");
    expect(projected.ok).toBe(false);
    expect(projected.ok ? [] : projected.failures.join(" ")).toContain("approved qualified Skill");
  });

  it("starts with no falsely promoted Run 4-5 Skill", () => {
    expect(registeredNativeSkills()).toEqual([]);
    expect(qualifiedNativeSkills()).toEqual([]);
  });

  it("will not move a non-candidate Skill into shadow or qualify a non-shadow Skill", () => {
    const shadow = buildShadowSkill();
    const movedAgain = moveNativeSkillToShadow(shadow);
    expect(movedAgain.ok).toBe(false);
    expect(movedAgain.ok ? "" : movedAgain.failures.join(" ")).toContain("Only a candidate Skill can enter shadow qualification.");

    const evaluated = evaluateSkillQualification(qualificationCandidate(shadow), [
      observation(shadow, "run-one"),
      observation(shadow, "run-two"),
    ]);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    const qualified = buildQualifiedSkill();
    const requalified = qualifyNativeSkill(
      qualified,
      evaluated.value,
      {
        artifactId: "qualification-decision-002",
        schemaVersion: "skill-qualification-decision/v1",
        contentHash: evaluated.value.decisionHash,
      },
      "manager-001",
      "2026-08-26T04:45:00Z",
    );
    expect(requalified.ok).toBe(false);
    expect(requalified.ok ? "" : requalified.failures.join(" ")).toContain("Only a shadow Skill can be qualified.");
  });
});
