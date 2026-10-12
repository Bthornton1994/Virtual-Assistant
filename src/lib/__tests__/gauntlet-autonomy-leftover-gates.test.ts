import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY_POLICY,
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

describe("Gauntlet leftover autonomy regression gates", () => {
  it("still demotes on measured regression when the latest hard-gate result is unknown", () => {
    const unknownAndImproved = evaluateAutonomy(
      { currentLevel: 3, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: null, latestImpact: "improved" },
      configuredPolicy,
    );
    expect(unknownAndImproved.decision).not.toBe("demote");
    expect(unknownAndImproved.reasons.join(" ")).not.toMatch(/hard gate failed|regression/i);

    const unknownAndRegressed = evaluateAutonomy(
      { currentLevel: 3, maxLevel: 4, state: "active" },
      { ...cleanMetrics, latestHardGatePass: null, latestImpact: "regressed" },
      configuredPolicy,
    );
    expect(unknownAndRegressed.decision).toBe("demote");
    expect(unknownAndRegressed.toLevel).toBe(2);
    expect(unknownAndRegressed.reasons.join(" ")).toMatch(/regression/i);
    expect(unknownAndRegressed.reasons.join(" ")).not.toMatch(/hard gate failed/);
  });
});
