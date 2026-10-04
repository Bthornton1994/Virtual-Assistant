import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY_POLICY,
  canTransitionGauntletStage,
  defaultRetryDecision,
  evaluateAutonomy,
  validateAutonomyPolicy,
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

describe("Gauntlet leftover stage and retry gates", () => {
  it("allows only the remaining legal hops and keeps same-stage identity", () => {
    expect(canTransitionGauntletStage("observing", "suspended")).toBe(true);
    expect(canTransitionGauntletStage("executing", "verification")).toBe(true);
    expect(canTransitionGauntletStage("executing", "impact_review")).toBe(false);
    expect(canTransitionGauntletStage("verification", "impact_review")).toBe(true);
    expect(canTransitionGauntletStage("verification", "closed")).toBe(false);
    expect(canTransitionGauntletStage("impact_review", "autonomy_review")).toBe(true);
    expect(canTransitionGauntletStage("autonomy_review", "closed")).toBe(true);
    expect(canTransitionGauntletStage("autonomy_review", "observing")).toBe(false);
    expect(canTransitionGauntletStage("closed", "suspended")).toBe(false);
    expect(canTransitionGauntletStage("verification", "verification")).toBe(true);
  });

  it("pins the remaining failure-class retry decisions so a renamed class cannot silently retry", () => {
    expect(defaultRetryDecision("policy_conflict", "low")).toBe("escalate_human");
    expect(defaultRetryDecision("executor_failure", "medium")).toBe("retry_different_executor");
    expect(defaultRetryDecision("business_strategy_failure", "medium")).toBe("replan");
    expect(defaultRetryDecision("cost_limit", "high")).toBe("replan");
    expect(defaultRetryDecision("external_dependency", "medium")).toBe("retry_same_executor");
    expect(defaultRetryDecision("evidence_failure", "low")).toBe("retry_same_executor");
    expect(defaultRetryDecision("qa_failure", "medium")).toBe("retry_same_executor");
    expect(defaultRetryDecision("integration_failure", "low")).toBe("retry_same_executor");
    expect(defaultRetryDecision("unknown", "medium")).toBe("retry_same_executor");
  });
});

describe("Gauntlet leftover autonomy hold and floor gates", () => {
  it("holds a suspended profile and will not demote below level 0", () => {
    const suspended = evaluateAutonomy(
      { currentLevel: 2, maxLevel: 4, state: "suspended" },
      cleanMetrics,
      configuredPolicy,
    );
    expect(suspended.decision).toBe("hold");
    expect(suspended.toLevel).toBe(2);
    expect(suspended.reasons.join(" ")).toContain("suspended");

    const hardGateFloor = evaluateAutonomy(
      { currentLevel: 0, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: false },
      configuredPolicy,
    );
    expect(hardGateFloor.decision).toBe("hold");
    expect(hardGateFloor.toLevel).toBe(0);
    expect(hardGateFloor.reasons.join(" ")).toContain("cannot fall below level 0");

    const regressionFloor = evaluateAutonomy(
      { currentLevel: 0, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestImpact: "regressed" },
      configuredPolicy,
    );
    expect(regressionFloor.decision).toBe("hold");
    expect(regressionFloor.toLevel).toBe(0);
    expect(regressionFloor.reasons.join(" ")).toContain("cannot fall below level 0");
  });

  it("holds when improved impact is missing, neutral, or inconclusive", () => {
    for (const latestImpact of [null, "neutral", "inconclusive"] as const) {
      const result = evaluateAutonomy(
        { currentLevel: 1, maxLevel: 4, state: "active" },
        { ...cleanMetrics, latestImpact },
        configuredPolicy,
      );
      expect(result.decision, `expected ${String(latestImpact)} impact to hold`).toBe("hold");
      expect(result.reasons.join(" ")).toMatch(/improved business impact/);
    }
  });

  it("holds on each remaining configured threshold, including unmeasured owner minutes", () => {
    const verified = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      { ...cleanMetrics, verifiedRuns: 2 },
      configuredPolicy,
    );
    expect(verified.decision).toBe("hold");
    expect(verified.reasons.join(" ")).toContain("Verified runs");

    const failures = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      { ...cleanMetrics, failureRate: 0.06 },
      configuredPolicy,
    );
    expect(failures.decision).toBe("hold");
    expect(failures.reasons.join(" ")).toContain("Failure rate");

    const exceptions = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      { ...cleanMetrics, exceptionRate: 0.11 },
      configuredPolicy,
    );
    expect(exceptions.decision).toBe("hold");
    expect(exceptions.reasons.join(" ")).toContain("Exception rate");

    const ownerMinutes = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      { ...cleanMetrics, averageOwnerMinutes: 11 },
      configuredPolicy,
    );
    expect(ownerMinutes.decision).toBe("hold");
    expect(ownerMinutes.reasons.join(" ")).toContain("Owner minutes");

    const unmeasuredOwner = evaluateAutonomy(
      { currentLevel: 1, maxLevel: 4, state: "active" },
      { ...cleanMetrics, averageOwnerMinutes: null },
      configuredPolicy,
    );
    expect(unmeasuredOwner.decision).toBe("hold");
    expect(unmeasuredOwner.reasons.join(" ")).toContain("not yet measurable");
  });

  it("holds at the configured maximum and leaves auto-flags off as explicit no-ops", () => {
    const atMax = evaluateAutonomy(
      { currentLevel: 4, maxLevel: 4, state: "active" },
      cleanMetrics,
      configuredPolicy,
    );
    expect(atMax.decision).toBe("hold");
    expect(atMax.reasons.join(" ")).toContain("maximum autonomy level");

    const incidentWithoutAuto = evaluateAutonomy(
      { currentLevel: 2, maxLevel: 4, state: "active" },
      { ...cleanMetrics, authorityIncidents: 1 },
      { ...configuredPolicy, autoSuspendOnAuthorityIncident: false },
    );
    expect(incidentWithoutAuto.decision).not.toBe("suspend");

    const hardGateWithoutAuto = evaluateAutonomy(
      { currentLevel: 3, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: false },
      { ...configuredPolicy, autoDemoteOnHardGateFailure: false },
    );
    expect(hardGateWithoutAuto.decision).not.toBe("demote");

    const regressionWithoutAuto = evaluateAutonomy(
      { currentLevel: 2, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestImpact: "regressed" },
      { ...configuredPolicy, autoDemoteOnRegression: false, requireImprovedImpactForPromotion: false },
    );
    expect(regressionWithoutAuto.decision).not.toBe("demote");
  });

  it("still refuses a non-integer verified-run threshold", () => {
    const errors = validateAutonomyPolicy({
      ...configuredPolicy,
      minimumVerifiedRunsForPromotion: 1.5,
    });
    expect(errors.join(" ")).toContain("integer of at least 1");
  });
});
