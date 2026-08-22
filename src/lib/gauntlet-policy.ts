export const GAUNTLET_STAGES = [
  "observing",
  "executing",
  "verification",
  "corrective_action",
  "impact_review",
  "autonomy_review",
  "closed",
  "suspended",
] as const;

export type GauntletStage = (typeof GAUNTLET_STAGES)[number];

export const FAILURE_CLASSIFICATIONS = [
  "bad_input",
  "executor_failure",
  "evidence_failure",
  "qa_failure",
  "integration_failure",
  "source_ambiguity",
  "authority_limit",
  "policy_conflict",
  "business_strategy_failure",
  "cost_limit",
  "security_incident",
  "external_dependency",
  "unknown",
] as const;

export type FailureClassification = (typeof FAILURE_CLASSIFICATIONS)[number];

export const RETRY_DECISIONS = [
  "retry_same_executor",
  "retry_different_executor",
  "correct_inputs_then_retry",
  "escalate_human",
  "replan",
  "suspend_workstream",
  "no_retry",
] as const;

export type RetryDecision = (typeof RETRY_DECISIONS)[number];

export const IMPACT_DIRECTIONS = ["improved", "neutral", "regressed", "inconclusive"] as const;
export type ImpactDirection = (typeof IMPACT_DIRECTIONS)[number];

export const AUTONOMY_DECISIONS = ["promote", "hold", "demote", "suspend"] as const;
export type AutonomyDecisionKind = (typeof AUTONOMY_DECISIONS)[number];
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;
export type AutonomyProfileState = "active" | "suspended";

export type AutonomyPolicy = {
  minimumVerifiedRunsForPromotion: number | null;
  minimumQaScore: number | null;
  maximumFailureRate: number | null;
  maximumExceptionRate: number | null;
  maximumOwnerMinutesPerRun: number | null;
  requireImprovedImpactForPromotion: boolean;
  allowAutomaticPromotion: boolean;
  promotionRequiresApproval: boolean;
  autoDemoteOnHardGateFailure: boolean;
  autoDemoteOnRegression: boolean;
  autoSuspendOnAuthorityIncident: boolean;
};

export const DEFAULT_AUTONOMY_POLICY: AutonomyPolicy = {
  minimumVerifiedRunsForPromotion: null,
  minimumQaScore: null,
  maximumFailureRate: null,
  maximumExceptionRate: null,
  maximumOwnerMinutesPerRun: null,
  requireImprovedImpactForPromotion: true,
  allowAutomaticPromotion: false,
  promotionRequiresApproval: true,
  autoDemoteOnHardGateFailure: true,
  autoDemoteOnRegression: true,
  autoSuspendOnAuthorityIncident: true,
};

export type AutonomyMetrics = {
  verifiedRuns: number;
  failedRuns: number;
  averageQaScore: number | null;
  exceptionRate: number;
  failureRate: number;
  averageOwnerMinutes: number | null;
  authorityIncidents: number;
  latestHardGatePass: boolean | null;
  latestImpact: ImpactDirection | null;
};

export type AutonomyEvaluation = {
  decision: AutonomyDecisionKind;
  toLevel: AutonomyLevel;
  requiresApproval: boolean;
  applyImmediately: boolean;
  reasons: string[];
};

const TRANSITIONS: Record<GauntletStage, readonly GauntletStage[]> = {
  observing: ["executing", "suspended"],
  executing: ["verification", "corrective_action", "suspended"],
  verification: ["impact_review", "corrective_action", "suspended"],
  corrective_action: ["executing", "suspended"],
  impact_review: ["autonomy_review", "corrective_action", "suspended"],
  autonomy_review: ["closed", "corrective_action", "suspended"],
  closed: [],
  suspended: [],
};

export function canTransitionGauntletStage(from: GauntletStage, to: GauntletStage) {
  return from === to || TRANSITIONS[from].includes(to);
}

export function defaultRetryDecision(
  classification: FailureClassification,
  severity: "low" | "medium" | "high" | "critical",
): RetryDecision {
  if (classification === "security_incident" || severity === "critical") return "suspend_workstream";
  if (classification === "authority_limit" || classification === "policy_conflict") return "escalate_human";
  if (classification === "source_ambiguity") return "escalate_human";
  if (classification === "bad_input") return "correct_inputs_then_retry";
  if (classification === "executor_failure") return "retry_different_executor";
  if (classification === "business_strategy_failure") return "replan";
  if (classification === "external_dependency") return "retry_same_executor";
  if (classification === "cost_limit") return "replan";
  return "retry_same_executor";
}

export function validateAutonomyPolicy(policy: AutonomyPolicy): string[] {
  const errors: string[] = [];
  if (
    policy.minimumVerifiedRunsForPromotion !== null &&
    (!Number.isInteger(policy.minimumVerifiedRunsForPromotion) || policy.minimumVerifiedRunsForPromotion < 1)
  ) {
    errors.push("Minimum verified runs must be an integer of at least 1.");
  }
  if (policy.minimumQaScore !== null && (policy.minimumQaScore < 0 || policy.minimumQaScore > 100)) {
    errors.push("Minimum QA score must be between 0 and 100.");
  }
  if (policy.maximumFailureRate !== null && (policy.maximumFailureRate < 0 || policy.maximumFailureRate > 1)) {
    errors.push("Maximum failure rate must be between 0 and 1.");
  }
  if (policy.maximumExceptionRate !== null && (policy.maximumExceptionRate < 0 || policy.maximumExceptionRate > 1)) {
    errors.push("Maximum exception rate must be between 0 and 1.");
  }
  if (policy.maximumOwnerMinutesPerRun !== null && policy.maximumOwnerMinutesPerRun < 0) {
    errors.push("Maximum owner minutes per run must be zero or greater.");
  }
  if (policy.allowAutomaticPromotion && policy.promotionRequiresApproval) {
    errors.push("Automatic promotion cannot be enabled while promotion still requires approval.");
  }
  return errors;
}

export function assertAutonomyPolicy(policy: AutonomyPolicy) {
  const errors = validateAutonomyPolicy(policy);
  if (errors.length) throw new Error(errors.join(" "));
}

function boundedLevel(value: number): AutonomyLevel {
  return Math.max(0, Math.min(4, Math.round(value))) as AutonomyLevel;
}

function promotionThresholdsConfigured(policy: AutonomyPolicy) {
  return (
    policy.minimumVerifiedRunsForPromotion !== null &&
    policy.minimumQaScore !== null &&
    policy.maximumFailureRate !== null &&
    policy.maximumExceptionRate !== null
  );
}

export function evaluateAutonomy(
  profile: { currentLevel: AutonomyLevel; maxLevel: AutonomyLevel; state: AutonomyProfileState },
  metrics: AutonomyMetrics,
  policy: AutonomyPolicy,
): AutonomyEvaluation {
  const hold = (...reasons: string[]): AutonomyEvaluation => ({
    decision: "hold",
    toLevel: profile.currentLevel,
    requiresApproval: false,
    applyImmediately: true,
    reasons,
  });

  if (metrics.authorityIncidents > 0 && policy.autoSuspendOnAuthorityIncident) {
    return {
      decision: "suspend",
      toLevel: profile.currentLevel,
      requiresApproval: false,
      applyImmediately: true,
      reasons: ["One or more authority incidents were recorded. Autonomy is suspended automatically."],
    };
  }

  if (profile.state === "suspended") {
    return hold("The workstream autonomy profile is suspended and requires explicit human recovery.");
  }

  if (metrics.latestHardGatePass === false && policy.autoDemoteOnHardGateFailure) {
    if (profile.currentLevel === 0) return hold("The latest adversarial hard gate failed; autonomy cannot fall below level 0.");
    return {
      decision: "demote",
      toLevel: boundedLevel(profile.currentLevel - 1),
      requiresApproval: false,
      applyImmediately: true,
      reasons: ["The latest adversarial hard gate failed."],
    };
  }

  if (metrics.latestImpact === "regressed" && policy.autoDemoteOnRegression) {
    if (profile.currentLevel === 0) return hold("The latest business-impact assessment regressed; autonomy cannot fall below level 0.");
    return {
      decision: "demote",
      toLevel: boundedLevel(profile.currentLevel - 1),
      requiresApproval: false,
      applyImmediately: true,
      reasons: ["The latest business-impact assessment showed regression."],
    };
  }

  if (policy.requireImprovedImpactForPromotion && metrics.latestImpact !== "improved") {
    return hold(`Promotion requires improved business impact; latest impact is ${metrics.latestImpact ?? "not measured"}.`);
  }

  if (!promotionThresholdsConfigured(policy)) {
    return hold("Promotion thresholds are not configured for this workstream. Global thresholds are intentionally not assumed.");
  }

  const reasons: string[] = [];
  if (metrics.verifiedRuns < (policy.minimumVerifiedRunsForPromotion ?? Infinity)) {
    reasons.push(`Verified runs ${metrics.verifiedRuns} are below the configured minimum.`);
  }
  if (metrics.averageQaScore === null || metrics.averageQaScore < (policy.minimumQaScore ?? Infinity)) {
    reasons.push("Average QA score is below the configured minimum or not yet measurable.");
  }
  if (metrics.failureRate > (policy.maximumFailureRate ?? -1)) reasons.push("Failure rate exceeds the configured maximum.");
  if (metrics.exceptionRate > (policy.maximumExceptionRate ?? -1)) reasons.push("Exception rate exceeds the configured maximum.");
  if (
    policy.maximumOwnerMinutesPerRun !== null &&
    (metrics.averageOwnerMinutes === null || metrics.averageOwnerMinutes > policy.maximumOwnerMinutesPerRun)
  ) {
    reasons.push("Owner minutes per run exceed the configured maximum or are not yet measurable.");
  }

  if (reasons.length) return hold(...reasons);
  if (profile.currentLevel >= profile.maxLevel) return hold("The workstream is already at its configured maximum autonomy level.");

  const requiresApproval = policy.promotionRequiresApproval || !policy.allowAutomaticPromotion;
  return {
    decision: "promote",
    toLevel: boundedLevel(profile.currentLevel + 1),
    requiresApproval,
    applyImmediately: !requiresApproval,
    reasons: ["Configured promotion evidence is satisfied and the latest measured business impact improved."],
  };
}
