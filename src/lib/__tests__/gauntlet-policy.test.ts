import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY_POLICY,
  canTransitionGauntletStage,
  defaultRetryDecision,
  evaluateAutonomy,
  type AutonomyMetrics,
  type AutonomyPolicy,
} from "@/lib/gauntlet-policy";

const cleanMetrics: AutonomyMetrics = {
  verifiedRuns: 5,
  failedRuns: 0,
  averageQaScore: 99,
  exceptionRate: 0,
  failureRate: 0,
  averageOwnerMinutes: 2,
  authorityIncidents: 0,
  latestHardGatePass: true,
  latestImpact: "improved",
};

const configuredPolicy: AutonomyPolicy = {
  ...DEFAULT_AUTONOMY_POLICY,
  minimumVerifiedRunsForPromotion: 3,
  minimumQaScore: 95,
  maximumFailureRate: 0.05,
  maximumExceptionRate: 0.1,
  maximumOwnerMinutesPerRun: 10,
};

describe("Gauntlet stage policy", () => {
  it("prevents skipping from observation directly to verification", () => {
    expect(canTransitionGauntletStage("observing", "verification")).toBe(false);
    expect(canTransitionGauntletStage("observing", "executing")).toBe(true);
  });

  it("routes failed verification through corrective action", () => {
    expect(canTransitionGauntletStage("verification", "corrective_action")).toBe(true);
    expect(canTransitionGauntletStage("corrective_action", "executing")).toBe(true);
  });

  it("does not reopen closed or suspended cycles", () => {
    expect(canTransitionGauntletStage("closed", "observing")).toBe(false);
    expect(canTransitionGauntletStage("suspended", "observing")).toBe(false);
  });
});

describe("failure retry policy", () => {
  it("suspends critical and security failures", () => {
    expect(defaultRetryDecision("security_incident", "high")).toBe("suspend_workstream");
    expect(defaultRetryDecision("executor_failure", "critical")).toBe("suspend_workstream");
  });

  it("does not blindly retry authority or source ambiguity", () => {
    expect(defaultRetryDecision("authority_limit", "medium")).toBe("escalate_human");
    expect(defaultRetryDecision("source_ambiguity", "low")).toBe("escalate_human");
  });

  it("requires input correction before retrying bad inputs", () => {
    expect(defaultRetryDecision("bad_input", "medium")).toBe("correct_inputs_then_retry");
  });
});

describe("earned autonomy controller", () => {
  it("holds when promotion thresholds are not explicitly configured", () => {
    const result = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      cleanMetrics,
      DEFAULT_AUTONOMY_POLICY,
    );
    expect(result.decision).toBe("hold");
    expect(result.applyImmediately).toBe(true);
    expect(result.reasons.join(" ")).toContain("not configured");
  });

  it("automatically suspends on an authority incident", () => {
    const result = evaluateAutonomy(
      { currentLevel: 2, maxLevel: 4, state: "active" },
      { ...cleanMetrics, authorityIncidents: 1 },
      configuredPolicy,
    );
    expect(result.decision).toBe("suspend");
    expect(result.toLevel).toBe(2);
    expect(result.applyImmediately).toBe(true);
  });

  it("automatically demotes after a hard-gate failure", () => {
    const result = evaluateAutonomy(
      { currentLevel: 3, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: false },
      configuredPolicy,
    );
    expect(result.decision).toBe("demote");
    expect(result.toLevel).toBe(2);
  });

  it("automatically demotes after measured business regression", () => {
    const result = evaluateAutonomy(
      { currentLevel: 2, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestImpact: "regressed" },
      configuredPolicy,
    );
    expect(result.decision).toBe("demote");
    expect(result.toLevel).toBe(1);
  });

  it("proposes rather than silently applies promotion by default", () => {
    const result = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      cleanMetrics,
      configuredPolicy,
    );
    expect(result.decision).toBe("promote");
    expect(result.toLevel).toBe(2);
    expect(result.requiresApproval).toBe(true);
    expect(result.applyImmediately).toBe(false);
  });

  it("can auto-promote only when the workstream policy explicitly allows it", () => {
    const result = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      cleanMetrics,
      { ...configuredPolicy, promotionRequiresApproval: false, allowAutomaticPromotion: true },
    );
    expect(result.decision).toBe("promote");
    expect(result.applyImmediately).toBe(true);
  });

  it("holds when quality thresholds are not met", () => {
    const result = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      { ...cleanMetrics, averageQaScore: 88 },
      configuredPolicy,
    );
    expect(result.decision).toBe("hold");
    expect(result.reasons.join(" ")).toContain("QA");
  });
});
