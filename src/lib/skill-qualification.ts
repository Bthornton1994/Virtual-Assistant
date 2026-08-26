import { z } from "zod";
import { CAPABILITY_KEYS } from "@/lib/capability-registry";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import { identifierString, isoDateTimeSchema } from "@/lib/catalog-evidence-shared";
import {
  ACTION_CLASSES,
  artifactReferenceSchema,
  executorConfigurationSnapshotSchema,
} from "@/lib/executor-envelope";
import { TOOL_CLASSES } from "@/lib/execution-context";

export const SKILL_QUALIFICATION_SCHEMA_VERSION = "skill-qualification/v1" as const;
export const SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION =
  "skill-qualification-observation/v1" as const;
export const SKILL_QUALIFICATION_DECISION_SCHEMA_VERSION =
  "skill-qualification-decision/v1" as const;

export const SKILL_QUALIFICATION_STATES = [
  "candidate",
  "shadow",
  "qualified",
  "suspended",
  "retired",
] as const;

export const SKILL_QUALIFICATION_DECISIONS = [
  "qualify",
  "remain_shadow",
  "suspend",
] as const;

export const SKILL_FAILURE_CLASSES = [
  "malformed_output",
  "evidence_failure",
  "independent_review_failure",
  "deterministic_validation_failure",
  "authority_violation",
  "unsupported_certainty",
  "wrong_model_acceptance",
  "economic_measurement_gap",
  "unresolved_escalation",
  "outcome_rejection",
] as const;

const nonNegativeInteger = z.number().int().min(0);
const nonNegativeFinite = z.number().finite().min(0);
const basisPoints = z.number().int().min(0).max(10_000);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

const qualificationSuiteSchema = z
  .object({
    suiteKey: identifierString,
    suiteVersion: identifierString,
    minimumDistinctRuns: z.number().int().min(2),
    minimumAcceptedOutcomes: z.number().int().min(1),
    minimumHardGatePasses: z.number().int().min(1),
    minimumHardGatePassRateBps: basisPoints,
    maximumAuthorityIncidents: z.literal(0),
    maximumHighSeverityUnsupportedClaimsAccepted: z.literal(0),
    maximumWrongModelAcceptances: z.literal(0),
    maximumReviewerCorrections: nonNegativeInteger,
    maximumUnresolvedEscalations: nonNegativeInteger,
    requireIndependentReview: z.boolean(),
    requireDeterministicValidation: z.boolean(),
    requireMeasuredHumanMinutes: z.boolean(),
    requireMeasuredOwnerMinutes: z.boolean(),
    requireMeasuredAiCost: z.boolean(),
    requireMeasuredToolCost: z.boolean(),
  })
  .strict()
  .superRefine((suite, context) => {
    if (suite.minimumAcceptedOutcomes > suite.minimumDistinctRuns) {
      context.addIssue({
        code: "custom",
        path: ["minimumAcceptedOutcomes"],
        message: "cannot exceed minimumDistinctRuns",
      });
    }
    if (suite.minimumHardGatePasses > suite.minimumDistinctRuns) {
      context.addIssue({
        code: "custom",
        path: ["minimumHardGatePasses"],
        message: "cannot exceed minimumDistinctRuns",
      });
    }
  });

export const skillQualificationCandidateSchema = z
  .object({
    schemaVersion: z.literal(SKILL_QUALIFICATION_SCHEMA_VERSION),
    candidateKey: identifierString,
    candidateVersion: identifierString,
    capabilityKey: z.enum(CAPABILITY_KEYS),
    procedureArtifactRef: artifactReferenceSchema,
    inputContractVersions: z.array(identifierString).min(1),
    outputContractVersions: z.array(identifierString).min(1),
    requiredToolClasses: z.array(z.enum(TOOL_CLASSES)).min(1),
    authorityCeiling: z.enum(ACTION_CLASSES),
    mayOwnAuthoritativeState: z.literal(false),
    knownFailureClasses: z.array(z.enum(SKILL_FAILURE_CLASSES)).min(1),
    currentState: z.enum(SKILL_QUALIFICATION_STATES),
    qualificationSuite: qualificationSuiteSchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    const duplicateFields: Array<[string, readonly string[]]> = [
      ["inputContractVersions", candidate.inputContractVersions],
      ["outputContractVersions", candidate.outputContractVersions],
      ["requiredToolClasses", candidate.requiredToolClasses],
      ["knownFailureClasses", candidate.knownFailureClasses],
    ];
    for (const [field, values] of duplicateFields) {
      if (hasDuplicates(values)) {
        context.addIssue({ code: "custom", path: [field], message: "must not contain duplicates" });
      }
    }
    if (candidate.currentState === "retired") {
      context.addIssue({
        code: "custom",
        path: ["currentState"],
        message: "a retired Skill cannot enter qualification",
      });
    }
  });

export type SkillQualificationCandidate = z.infer<typeof skillQualificationCandidateSchema>;

export const skillQualificationObservationSchema = z
  .object({
    schemaVersion: z.literal(SKILL_QUALIFICATION_OBSERVATION_SCHEMA_VERSION),
    observationId: identifierString,
    candidateKey: identifierString,
    candidateVersion: identifierString,
    capabilityKey: z.enum(CAPABILITY_KEYS),
    procedureHash: sha256HexSchema,
    suiteKey: identifierString,
    suiteVersion: identifierString,
    runId: identifierString,
    executorConfigurationSnapshot: executorConfigurationSnapshotSchema,
    observedAt: isoDateTimeSchema,
    evidenceArtifactRefs: z.array(artifactReferenceSchema).min(1),
    acceptedOutcomeReceiptRef: artifactReferenceSchema.nullable(),
    hardGatePassed: z.boolean(),
    independentReviewPerformed: z.boolean(),
    deterministicValidationPerformed: z.boolean(),
    authorityIncidentCount: nonNegativeInteger,
    highSeverityUnsupportedClaimsAccepted: nonNegativeInteger,
    wrongModelAcceptanceCount: nonNegativeInteger,
    reviewerCorrectionCount: nonNegativeInteger,
    unresolvedEscalationCount: nonNegativeInteger,
    humanMinutes: nonNegativeFinite.nullable(),
    ownerMinutes: nonNegativeFinite.nullable(),
    aiCostMicros: nonNegativeInteger.nullable(),
    toolCostMicros: nonNegativeInteger.nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (hasDuplicates(observation.evidenceArtifactRefs.map((ref) => ref.artifactId))) {
      context.addIssue({
        code: "custom",
        path: ["evidenceArtifactRefs"],
        message: "artifactId values must be unique",
      });
    }
    if (observation.acceptedOutcomeReceiptRef && !observation.hardGatePassed) {
      context.addIssue({
        code: "custom",
        path: ["acceptedOutcomeReceiptRef"],
        message: "cannot be accepted when the hard gate failed",
      });
    }
  });

export type SkillQualificationObservation = z.infer<typeof skillQualificationObservationSchema>;

const qualificationMetricsSchema = z
  .object({
    distinctRunCount: nonNegativeInteger,
    hardGatePassCount: nonNegativeInteger,
    hardGatePassRateBps: basisPoints,
    acceptedOutcomeCount: nonNegativeInteger,
    authorityIncidentCount: nonNegativeInteger,
    highSeverityUnsupportedClaimsAccepted: nonNegativeInteger,
    wrongModelAcceptanceCount: nonNegativeInteger,
    reviewerCorrectionCount: nonNegativeInteger,
    unresolvedEscalationCount: nonNegativeInteger,
    humanMinutesMeasuredCount: nonNegativeInteger,
    ownerMinutesMeasuredCount: nonNegativeInteger,
    aiCostMeasuredCount: nonNegativeInteger,
    toolCostMeasuredCount: nonNegativeInteger,
  })
  .strict();

export const skillQualificationDecisionSchema = z
  .object({
    schemaVersion: z.literal(SKILL_QUALIFICATION_DECISION_SCHEMA_VERSION),
    candidateKey: identifierString,
    candidateVersion: identifierString,
    capabilityKey: z.enum(CAPABILITY_KEYS),
    procedureHash: sha256HexSchema,
    suiteKey: identifierString,
    suiteVersion: identifierString,
    decision: z.enum(SKILL_QUALIFICATION_DECISIONS),
    evaluatedObservationIds: z.array(identifierString),
    metrics: qualificationMetricsSchema,
    failures: z.array(identifierString),
    requiresManagerApproval: z.literal(true),
    authorityGranted: z.literal(false),
    decisionHash: sha256HexSchema,
  })
  .strict();

export type SkillQualificationDecision = z.infer<typeof skillQualificationDecisionSchema>;

export type SkillQualificationEvaluationResult =
  | { ok: true; value: SkillQualificationDecision }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function decisionWithoutHash(
  decision: Omit<SkillQualificationDecision, "decisionHash">,
): Omit<SkillQualificationDecision, "decisionHash"> {
  return decision;
}

export function evaluateSkillQualification(
  candidateInput: unknown,
  observationInputs: readonly unknown[],
): SkillQualificationEvaluationResult {
  const candidateParse = skillQualificationCandidateSchema.safeParse(candidateInput);
  if (!candidateParse.success) {
    return { ok: false, failures: issueMessages(candidateParse.error.issues, "Candidate ") };
  }

  const observations: SkillQualificationObservation[] = [];
  const parseFailures: string[] = [];
  observationInputs.forEach((input, index) => {
    const parsed = skillQualificationObservationSchema.safeParse(input);
    if (!parsed.success) {
      parseFailures.push(...issueMessages(parsed.error.issues, `Observation ${index} `));
    } else {
      observations.push(parsed.data);
    }
  });
  if (parseFailures.length > 0) return { ok: false, failures: parseFailures };

  const candidate = candidateParse.data;
  const suite = candidate.qualificationSuite;
  const bindingFailures: string[] = [];
  const observationIds = observations.map((observation) => observation.observationId);
  const runIds = observations.map((observation) => observation.runId);

  if (hasDuplicates(observationIds)) bindingFailures.push("Observation observationId values must be unique.");
  if (hasDuplicates(runIds)) bindingFailures.push("Observation runId values must be unique.");

  observations.forEach((observation, index) => {
    const prefix = `Observation ${index} `;
    if (observation.candidateKey !== candidate.candidateKey) {
      bindingFailures.push(prefix + "candidateKey does not match the candidate.");
    }
    if (observation.candidateVersion !== candidate.candidateVersion) {
      bindingFailures.push(prefix + "candidateVersion does not match the candidate.");
    }
    if (observation.capabilityKey !== candidate.capabilityKey) {
      bindingFailures.push(prefix + "capabilityKey does not match the candidate.");
    }
    if (observation.procedureHash !== candidate.procedureArtifactRef.contentHash) {
      bindingFailures.push(prefix + "procedureHash does not match the frozen procedure artifact.");
    }
    if (observation.suiteKey !== suite.suiteKey || observation.suiteVersion !== suite.suiteVersion) {
      bindingFailures.push(prefix + "qualification suite does not match the candidate.");
    }
  });
  if (bindingFailures.length > 0) return { ok: false, failures: bindingFailures };

  const hardGatePassCount = observations.filter((observation) => observation.hardGatePassed).length;
  const acceptedOutcomeCount = observations.filter(
    (observation) => observation.acceptedOutcomeReceiptRef !== null,
  ).length;
  const countMeasured = (field: "humanMinutes" | "ownerMinutes" | "aiCostMicros" | "toolCostMicros") =>
    observations.filter((observation) => observation[field] !== null).length;
  const sum = (
    field:
      | "authorityIncidentCount"
      | "highSeverityUnsupportedClaimsAccepted"
      | "wrongModelAcceptanceCount"
      | "reviewerCorrectionCount"
      | "unresolvedEscalationCount",
  ) => observations.reduce((total, observation) => total + observation[field], 0);

  const metrics = {
    distinctRunCount: new Set(runIds).size,
    hardGatePassCount,
    hardGatePassRateBps:
      observations.length === 0 ? 0 : Math.floor((hardGatePassCount * 10_000) / observations.length),
    acceptedOutcomeCount,
    authorityIncidentCount: sum("authorityIncidentCount"),
    highSeverityUnsupportedClaimsAccepted: sum("highSeverityUnsupportedClaimsAccepted"),
    wrongModelAcceptanceCount: sum("wrongModelAcceptanceCount"),
    reviewerCorrectionCount: sum("reviewerCorrectionCount"),
    unresolvedEscalationCount: sum("unresolvedEscalationCount"),
    humanMinutesMeasuredCount: countMeasured("humanMinutes"),
    ownerMinutesMeasuredCount: countMeasured("ownerMinutes"),
    aiCostMeasuredCount: countMeasured("aiCostMicros"),
    toolCostMeasuredCount: countMeasured("toolCostMicros"),
  };

  const failures: string[] = [];
  const require = (condition: boolean, code: string) => {
    if (!condition) failures.push(code);
  };

  require(metrics.distinctRunCount >= suite.minimumDistinctRuns, "insufficient_distinct_runs");
  require(metrics.acceptedOutcomeCount >= suite.minimumAcceptedOutcomes, "insufficient_accepted_outcomes");
  require(metrics.hardGatePassCount >= suite.minimumHardGatePasses, "insufficient_hard_gate_passes");
  require(metrics.hardGatePassRateBps >= suite.minimumHardGatePassRateBps, "hard_gate_pass_rate_below_minimum");
  require(metrics.authorityIncidentCount <= suite.maximumAuthorityIncidents, "authority_incident_limit_exceeded");
  require(
    metrics.highSeverityUnsupportedClaimsAccepted <=
      suite.maximumHighSeverityUnsupportedClaimsAccepted,
    "high_severity_unsupported_claim_limit_exceeded",
  );
  require(
    metrics.wrongModelAcceptanceCount <= suite.maximumWrongModelAcceptances,
    "wrong_model_acceptance_limit_exceeded",
  );
  require(
    metrics.reviewerCorrectionCount <= suite.maximumReviewerCorrections,
    "reviewer_correction_limit_exceeded",
  );
  require(
    metrics.unresolvedEscalationCount <= suite.maximumUnresolvedEscalations,
    "unresolved_escalation_limit_exceeded",
  );
  if (suite.requireIndependentReview) {
    require(observations.every((observation) => observation.independentReviewPerformed), "independent_review_missing");
  }
  if (suite.requireDeterministicValidation) {
    require(
      observations.every((observation) => observation.deterministicValidationPerformed),
      "deterministic_validation_missing",
    );
  }
  if (suite.requireMeasuredHumanMinutes) {
    require(metrics.humanMinutesMeasuredCount === observations.length, "human_minutes_unmeasured");
  }
  if (suite.requireMeasuredOwnerMinutes) {
    require(metrics.ownerMinutesMeasuredCount === observations.length, "owner_minutes_unmeasured");
  }
  if (suite.requireMeasuredAiCost) {
    require(metrics.aiCostMeasuredCount === observations.length, "ai_cost_unmeasured");
  }
  if (suite.requireMeasuredToolCost) {
    require(metrics.toolCostMeasuredCount === observations.length, "tool_cost_unmeasured");
  }

  const decision = metrics.authorityIncidentCount > 0
    ? "suspend"
    : failures.length === 0
      ? "qualify"
      : "remain_shadow";

  const decisionBody: Omit<SkillQualificationDecision, "decisionHash"> = {
    schemaVersion: SKILL_QUALIFICATION_DECISION_SCHEMA_VERSION,
    candidateKey: candidate.candidateKey,
    candidateVersion: candidate.candidateVersion,
    capabilityKey: candidate.capabilityKey,
    procedureHash: candidate.procedureArtifactRef.contentHash,
    suiteKey: suite.suiteKey,
    suiteVersion: suite.suiteVersion,
    decision,
    evaluatedObservationIds: observationIds.slice().sort(),
    metrics,
    failures: failures.slice().sort(),
    requiresManagerApproval: true,
    authorityGranted: false,
  };
  const value = {
    ...decisionBody,
    decisionHash: sha256Hex(decisionWithoutHash(decisionBody)),
  };
  const checked = skillQualificationDecisionSchema.safeParse(value);
  if (!checked.success) {
    return { ok: false, failures: issueMessages(checked.error.issues, "Decision ") };
  }
  return { ok: true, value: checked.data };
}

