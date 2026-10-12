import { describe, expect, it } from "vitest";
import {
  reviewCapabilityPerformance,
  validateCapabilityPerformanceReview,
  type CapabilityPerformanceReviewPolicy,
} from "@/lib/capability-performance-review";
import {
  CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
  type CapabilityPerformanceObservation,
} from "@/lib/capability-performance-ledger";

const HASH = "c".repeat(64);

function observation(
  overrides: Partial<CapabilityPerformanceObservation> = {},
): CapabilityPerformanceObservation {
  return {
    schemaVersion: CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
    runId: "run-default",
    assignmentId: "assignment-default",
    capabilityKey: "evidence_research",
    executorKey: "hermes-v1",
    contractVersion: "catalog-evidence-packet/v1",
    status: "completed",
    hardGateResult: "pass",
    benchmarkTruth: "accept",
    authorityIncident: false,
    evidenceComplete: true,
    correctionRequired: false,
    rollbackOrRetry: false,
    humanInterventionMinutes: 1,
    aiCostMicros: 100,
    toolCostMicros: 10,
    latencyMs: 1000,
    outcomeSource: "deterministic_validator",
    sourceArtifactHash: HASH,
    recordedAt: "2026-08-28T07:00:00Z",
    ...overrides,
  };
}

function policy(overrides: Partial<CapabilityPerformanceReviewPolicy> = {}): CapabilityPerformanceReviewPolicy {
  return {
    policyKey: "evidence-research-comparison",
    policyVersion: "evidence-research-comparison/v1",
    minimumImplementations: 2,
    minimumTotalRunsPerImplementation: 1,
    minimumAcceptedOutcomesPerImplementation: 0,
    minimumBenchmarkEvaluatedRunsPerImplementation: 1,
    minimumHardGatePassRateBps: 0,
    maximumAuthorityIncidents: 0,
    maximumFalseAcceptanceRateBps: 10_000,
    maximumFalseRejectionRateBps: 10_000,
    maximumCorrectionRateBps: 10_000,
    maximumRollbackOrRetryRateBps: 10_000,
    requireEvidenceCompleteness: false,
    ...overrides,
  };
}

function review(observations: CapabilityPerformanceObservation[], policyOverrides: Partial<CapabilityPerformanceReviewPolicy> = {}) {
  return reviewCapabilityPerformance({
    capabilityKey: "evidence_research",
    contractVersion: "catalog-evidence-packet/v1",
    policy: policy(policyOverrides),
    observations,
  });
}

describe("reviewCapabilityPerformance refuses unknown or unbound inputs", () => {
  it("rejects an unknown capability before aggregating observations", () => {
    const result = reviewCapabilityPerformance({
      capabilityKey: "winner_picker",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy(),
      observations: [observation()],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toMatch(/Capability/);
  });

  it("rejects a padded contract version instead of trimming it", () => {
    const result = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: " catalog-evidence-packet/v1 ",
      policy: policy(),
      observations: [observation()],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toMatch(/Contract/);
  });

  it("rejects a policy with extra keys or inverted minimums", () => {
    const extra = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: { ...policy(), winner: "hermes-v1" },
      observations: [observation()],
    });
    expect(extra.ok).toBe(false);

    const invertedAccepted = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy({ minimumTotalRunsPerImplementation: 1, minimumAcceptedOutcomesPerImplementation: 2 }),
      observations: [observation()],
    });
    expect(invertedAccepted.ok).toBe(false);
    expect(invertedAccepted.ok ? [] : invertedAccepted.failures.join(" ")).toContain(
      "cannot exceed minimumTotalRunsPerImplementation",
    );

    const invertedBenchmark = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy({
        minimumTotalRunsPerImplementation: 1,
        minimumBenchmarkEvaluatedRunsPerImplementation: 2,
      }),
      observations: [observation()],
    });
    expect(invertedBenchmark.ok).toBe(false);
    expect(invertedBenchmark.ok ? [] : invertedBenchmark.failures.join(" ")).toContain(
      "cannot exceed minimumTotalRunsPerImplementation",
    );
  });

  it("rejects a malformed observation instead of dropping it", () => {
    const result = review([{ ...observation(), extra: true } as never]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toMatch(/Observation 0/);
  });

  it("rejects observations bound to a different capability or contract", () => {
    const capability = review([
      observation({ capabilityKey: "supplier_sourcing", runId: "foreign-cap", assignmentId: "foreign-cap-a" }),
    ]);
    expect(capability.ok).toBe(false);
    expect(capability.ok ? [] : capability.failures).toContain(
      "Observation capabilityKey does not match the reviewed capability.",
    );

    const contract = review([
      observation({
        contractVersion: "other-contract/v1",
        runId: "foreign-contract",
        assignmentId: "foreign-contract-a",
      }),
    ]);
    expect(contract.ok).toBe(false);
    expect(contract.ok ? [] : contract.failures).toContain(
      "Observation contractVersion does not match the reviewed contract.",
    );
  });
});

describe("rate and completeness failures stay collect_more_evidence, never a winner", () => {
  it("marks a false acceptance against the policy ceiling", () => {
    const result = review([observation({ benchmarkTruth: "reject", hardGateResult: "pass" })], {
      maximumFalseAcceptanceRateBps: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.disposition).toBe("collect_more_evidence");
    expect(result.value.failures).toContain("false_acceptance_rate_exceeded");
    expect(result.value.implementationReviews[0]?.eligible).toBe(false);
    expect(result.value.authorityGranted).toBe(false);
  });

  it("marks a false rejection against the policy ceiling", () => {
    const result = review([observation({ benchmarkTruth: "accept", hardGateResult: "fail", status: "failed" })], {
      maximumFalseRejectionRateBps: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failures).toContain("false_rejection_rate_exceeded");
    expect(result.value.disposition).toBe("collect_more_evidence");
  });

  it("marks correction and rollback rates, incomplete evidence, and a hard-gate miss", () => {
    const correction = review([observation({ correctionRequired: true })], { maximumCorrectionRateBps: 0 });
    expect(correction.ok && correction.value.failures).toContain("correction_rate_exceeded");

    const rollback = review([observation({ rollbackOrRetry: true })], { maximumRollbackOrRetryRateBps: 0 });
    expect(rollback.ok && rollback.value.failures).toContain("rollback_or_retry_rate_exceeded");

    const incomplete = review([observation({ evidenceComplete: false })], { requireEvidenceCompleteness: true });
    expect(incomplete.ok && incomplete.value.failures).toContain("evidence_completeness_below_minimum");

    const hardGate = review([observation({ hardGateResult: "fail", status: "failed" })], {
      minimumHardGatePassRateBps: 5_000,
    });
    expect(hardGate.ok && hardGate.value.failures).toContain("hard_gate_pass_rate_below_minimum");

    const accepted = review([observation({ status: "failed", hardGateResult: "fail" })], {
      minimumAcceptedOutcomesPerImplementation: 1,
    });
    expect(accepted.ok && accepted.value.failures).toContain("insufficient_accepted_outcomes");
  });
});

describe("a stored review cannot grant authority or carry extra keys", () => {
  it("refuses authorityGranted true, a missing manager flag, and an extra field", () => {
    const generated = review([observation()]);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;

    expect(validateCapabilityPerformanceReview({ ...generated.value, authorityGranted: true }).ok).toBe(false);
    expect(validateCapabilityPerformanceReview({ ...generated.value, requiresManagerApproval: false }).ok).toBe(false);
    expect(validateCapabilityPerformanceReview({ ...generated.value, recommendedExecutorKey: "hermes-v1" }).ok).toBe(
      false,
    );
    expect(generated.value.authorityGranted).toBe(false);
    expect(generated.value.requiresManagerApproval).toBe(true);
    expect("winner" in generated.value).toBe(false);
  });
});
