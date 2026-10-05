import { describe, expect, it } from "vitest";
import {
  NATIVE_SKILL_SCHEMA_VERSION,
  SKILL_PROCEDURE_SCHEMA_VERSION,
  createNativeSkill,
  createSkillProcedure,
  moveNativeSkillToShadow,
  projectNativeSkill,
  qualifyNativeSkill,
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

function failuresOf(result: { ok: boolean; failures?: string[] }): string {
  return result.ok ? "" : result.failures!.join(" ");
}

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

function qualifyDecision(skill: NativeSkill) {
  const evaluated = evaluateSkillQualification(qualificationCandidate(skill), [
    observation(skill, "run-one"),
    observation(skill, "run-two"),
  ]);
  expect(evaluated.ok).toBe(true);
  if (!evaluated.ok) throw new Error(evaluated.failures.join("; "));
  return evaluated.value;
}

function buildQualifiedSkill(): NativeSkill {
  const skill = buildShadowSkill();
  const decision = qualifyDecision(skill);
  const qualified = qualifyNativeSkill(
    skill,
    decision,
    {
      artifactId: "qualification-decision-001",
      schemaVersion: "skill-qualification-decision/v1",
      contentHash: decision.decisionHash,
    },
    "manager-001",
    "2026-08-26T04:30:00Z",
  );
  expect(qualified.ok).toBe(true);
  if (!qualified.ok) throw new Error(qualified.failures.join("; "));
  return qualified.value;
}

describe("native skill leftover schema and identity gates", () => {
  it("refuses extra keys and padded identifiers so a repaired Skill cannot hash as the original", () => {
    const skill = buildShadowSkill();
    const extra = validateNativeSkill({ ...skill, trustedByDefault: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const paddedKey = validateNativeSkill({ ...skill, skillKey: " evidence-research-procedure" });
    expect(paddedKey.ok).toBe(false);
    expect(failuresOf(paddedKey)).toMatch(/whitespace|skillKey/);

    const paddedVersion = validateNativeSkill({ ...skill, skillVersion: "evidence-research-procedure/v1 " });
    expect(paddedVersion.ok).toBe(false);
    expect(failuresOf(paddedVersion)).toMatch(/whitespace|skillVersion/);
  });

  it("refuses duplicate lists that would otherwise look like a larger qualification surface", () => {
    const skill = buildShadowSkill();
    const duplicateInputs = validateNativeSkill({
      ...skill,
      requiredInputs: ["Frozen input manifest", "Frozen input manifest"],
    });
    expect(duplicateInputs.ok).toBe(false);
    expect(failuresOf(duplicateInputs)).toContain("must not contain duplicates");

    const duplicateTools = validateNativeSkill({
      ...skill,
      requiredToolClasses: ["public_read", "artifact_read", "public_read"],
    });
    expect(duplicateTools.ok).toBe(false);
    expect(failuresOf(duplicateTools)).toContain("must not contain duplicates");
  });

  it("refuses a candidate or shadow Skill that already carries qualification approval", () => {
    const skill = buildShadowSkill();
    const premature = validateNativeSkill({
      ...skill,
      approval: {
        approvedBy: "manager-001",
        approvedAt: "2026-08-26T04:30:00Z",
        qualificationDecisionHash: HASH,
      },
    });
    expect(premature.ok).toBe(false);
    expect(failuresOf(premature)).toContain("cannot carry qualification approval");
  });

  it("refuses empty procedure steps and extra procedure keys", () => {
    const empty = createSkillProcedure({
      artifactId: "procedure-research-v1",
      schemaVersion: SKILL_PROCEDURE_SCHEMA_VERSION,
      objective: "Prepare source-backed evidence from a frozen input manifest.",
      steps: [],
      escalationRules: ["Escalate when product identity cannot be established."],
      stopConditions: ["Stop before any external publication or catalog write."],
    });
    expect(empty.ok).toBe(false);
    expect(failuresOf(empty)).toMatch(/steps/);

    const extra = createSkillProcedure({
      artifactId: "procedure-research-v1",
      schemaVersion: SKILL_PROCEDURE_SCHEMA_VERSION,
      objective: "Prepare source-backed evidence from a frozen input manifest.",
      steps: ["Read only the frozen inputs."],
      escalationRules: ["Escalate when product identity cannot be established."],
      stopConditions: ["Stop before any external publication or catalog write."],
      trustedByDefault: true,
    } as never);
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);
  });
});

describe("native skill leftover qualification and projection gates", () => {
  it("refuses a hash-valid remain_shadow decision and remaining identity mismatches", () => {
    const skill = buildShadowSkill();
    const qualify = qualifyDecision(skill);
    const { decisionHash: _decisionHash, ...body } = qualify;
    const remain = {
      ...body,
      decision: "remain_shadow" as const,
    };
    const remainHashed = { ...remain, decisionHash: hashSkillQualificationDecision(remain) };
    const remainResult = qualifyNativeSkill(
      skill,
      remainHashed,
      {
        artifactId: "qualification-decision-001",
        schemaVersion: "skill-qualification-decision/v1",
        contentHash: remainHashed.decisionHash,
      },
      "manager-001",
      "2026-08-26T04:30:00Z",
    );
    expect(remainResult.ok).toBe(false);
    expect(failuresOf(remainResult)).toContain("qualify decision");

    const { decisionHash: _qualifyHash, ...qualifyBody } = qualify;
    const versionBody = { ...qualifyBody, candidateVersion: "other-skill/v1" };
    const versionHashed = { ...versionBody, decisionHash: hashSkillQualificationDecision(versionBody) };
    const version = qualifyNativeSkill(
      skill,
      versionHashed,
      {
        artifactId: "qualification-decision-001",
        schemaVersion: "skill-qualification-decision/v1",
        contentHash: versionHashed.decisionHash,
      },
      "manager-001",
      "2026-08-26T04:30:00Z",
    );
    expect(version.ok).toBe(false);
    expect(failuresOf(version)).toContain("candidateVersion");

    const capabilityBody = { ...qualifyBody, capabilityKey: "independent_evidence_review" as const };
    const capabilityHashed = {
      ...capabilityBody,
      decisionHash: hashSkillQualificationDecision(capabilityBody),
    };
    const capability = qualifyNativeSkill(
      skill,
      capabilityHashed,
      {
        artifactId: "qualification-decision-001",
        schemaVersion: "skill-qualification-decision/v1",
        contentHash: capabilityHashed.decisionHash,
      },
      "manager-001",
      "2026-08-26T04:30:00Z",
    );
    expect(capability.ok).toBe(false);
    expect(failuresOf(capability)).toContain("capabilityKey");
  });

  it("refuses a padded manager id and a non-ISO approval time", () => {
    const skill = buildShadowSkill();
    const decision = qualifyDecision(skill);
    const artifact = {
      artifactId: "qualification-decision-001",
      schemaVersion: "skill-qualification-decision/v1",
      contentHash: decision.decisionHash,
    };

    const paddedManager = qualifyNativeSkill(skill, decision, artifact, " manager-001 ", "2026-08-26T04:30:00Z");
    expect(paddedManager.ok).toBe(false);
    expect(failuresOf(paddedManager)).toMatch(/whitespace|Manager/);

    const badTime = qualifyNativeSkill(skill, decision, artifact, "manager-001", "2026-08-26");
    expect(badTime.ok).toBe(false);
    expect(failuresOf(badTime)).toMatch(/Approval time|ISO|datetime/i);
  });

  it("refuses to project a retired Skill, a suspended Skill, or an unknown runtime", () => {
    const skill = buildQualifiedSkill();
    const retired = validateNativeSkill({ ...skill, status: "retired" });
    expect(retired.ok).toBe(true);
    if (!retired.ok) return;
    const retiredProjection = projectNativeSkill(retired.value, "hermes_markdown");
    expect(retiredProjection.ok).toBe(false);
    expect(failuresOf(retiredProjection)).toContain("approved qualified Skill");

    const suspended = validateNativeSkill({ ...skill, status: "suspended" });
    expect(suspended.ok).toBe(true);
    if (!suspended.ok) return;
    const suspendedProjection = projectNativeSkill(suspended.value, "hermes_markdown");
    expect(suspendedProjection.ok).toBe(false);
    expect(failuresOf(suspendedProjection)).toContain("approved qualified Skill");

    const unknown = projectNativeSkill(skill, "claude_markdown");
    expect(unknown.ok).toBe(false);
    expect(failuresOf(unknown)).toMatch(/Projection target|Invalid enum/);
  });

  it("binds remaining qualification-history fields to the Skill and refuses a procedure-hash mismatch", () => {
    const skill = buildQualifiedSkill();
    const entry = skill.qualificationHistory[0];
    const { decisionHash: _historyHash, ...historyBody } = entry.decision;
    const versionBody = { ...historyBody, candidateVersion: "other-skill/v1" };
    const versionHashed = { ...versionBody, decisionHash: hashSkillQualificationDecision(versionBody) };
    const version = validateNativeSkill({
      ...skill,
      qualificationHistory: [{
        ...entry,
        decision: versionHashed,
        decisionArtifactRef: {
          ...entry.decisionArtifactRef,
          contentHash: versionHashed.decisionHash,
        },
      }],
      approval: {
        ...skill.approval!,
        qualificationDecisionHash: versionHashed.decisionHash,
      },
    });
    expect(version.ok).toBe(false);
    expect(failuresOf(version)).toContain("candidateVersion");

    const suiteBody = { ...historyBody, suiteKey: "other-suite" };
    const suiteHashed = { ...suiteBody, decisionHash: hashSkillQualificationDecision(suiteBody) };
    const suite = validateNativeSkill({
      ...skill,
      qualificationHistory: [{
        ...entry,
        decision: suiteHashed,
        decisionArtifactRef: {
          ...entry.decisionArtifactRef,
          contentHash: suiteHashed.decisionHash,
        },
      }],
      approval: {
        ...skill.approval!,
        qualificationDecisionHash: suiteHashed.decisionHash,
      },
    });
    expect(suite.ok).toBe(false);
    expect(failuresOf(suite)).toMatch(/qualification suite/);

    const procedure = validateNativeSkill({
      ...skill,
      procedureArtifact: { ...skill.procedureArtifact, contentHash: "e".repeat(64) },
    });
    expect(procedure.ok).toBe(false);
    expect(failuresOf(procedure)).toContain("procedureArtifact.contentHash");
  });
});
