import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY_POLICY,
  assertAutonomyPolicy,
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

describe("Gauntlet leftover autonomy and retry gates", () => {
  it("throws the concatenated autonomy-policy errors", () => {
    expect(() => assertAutonomyPolicy(configuredPolicy)).not.toThrow();

    expect(() =>
      assertAutonomyPolicy({
        ...configuredPolicy,
        minimumVerifiedRunsForPromotion: 0,
        minimumQaScore: 101,
        allowAutomaticPromotion: true,
        promotionRequiresApproval: true,
      }),
    ).toThrow(/Minimum verified runs[\s\S]*Minimum QA score[\s\S]*Automatic promotion/);
  });

  it("lets a critical severity win over a bad_input retry class", () => {
    expect(defaultRetryDecision("bad_input", "medium")).toBe("correct_inputs_then_retry");
    expect(defaultRetryDecision("bad_input", "critical")).toBe("suspend_workstream");
    expect(defaultRetryDecision("executor_failure", "critical")).toBe("suspend_workstream");
  });

  it("does not auto-demote when the latest hard-gate result is still unknown", () => {
    const unknown = evaluateAutonomy(
      { currentLevel: 3, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: null },
      configuredPolicy,
    );
    expect(unknown.decision).not.toBe("demote");
    expect(unknown.reasons.join(" ")).not.toMatch(/hard gate failed/);

    const failed = evaluateAutonomy(
      { currentLevel: 3, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: false },
      configuredPolicy,
    );
    expect(failed.decision).toBe("demote");
    expect(failed.toLevel).toBe(2);
  });
});
