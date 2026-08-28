import { describe, expect, it } from "vitest";
import {
  reviewCapabilityPerformance,
  type CapabilityPerformanceReviewPolicy,
} from "@/lib/capability-performance-review";
import {
  CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
  type CapabilityPerformanceObservation,
} from "@/lib/capability-performance-ledger";

const HASH = "a".repeat(64);

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
    benchmarkTruth: null,
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

function policy(
  overrides: Partial<CapabilityPerformanceReviewPolicy> = {},
): CapabilityPerformanceReviewPolicy {
  return {
    policyKey: "evidence-research-comparison",
    policyVersion: "evidence-research-comparison/v1",
    minimumImplementations: 2,
    minimumTotalRunsPerImplementation: 2,
    minimumAcceptedOutcomesPerImplementation: 1,
    minimumBenchmarkEvaluatedRunsPerImplementation: 2,
    minimumHardGatePassRateBps: 5_000,
    maximumAuthorityIncidents: 0,
    maximumFalseAcceptanceRateBps: 0,
    maximumFalseRejectionRateBps: 0,
    maximumCorrectionRateBps: 0,
    maximumRollbackOrRetryRateBps: 0,
    requireEvidenceCompleteness: true,
    ...overrides,
  };
}

function cleanComparisonObservations(): CapabilityPerformanceObservation[] {
  return [
    observation({
      runId: "hermes-accept",
      assignmentId: "hermes-accept-assignment",
      executorKey: "hermes-v1",
      benchmarkTruth: "accept",
    }),
    observation({
      runId: "hermes-reject",
      assignmentId: "hermes-reject-assignment",
      executorKey: "hermes-v1",
      status: "failed",
      hardGateResult: "fail",
      benchmarkTruth: "reject",
    }),
    observation({
      runId: "grok-accept",
      assignmentId: "grok-accept-assignment",
      executorKey: "grok-v1",
      benchmarkTruth: "accept",
    }),
    observation({
      runId: "grok-reject",
      assignmentId: "grok-reject-assignment",
      executorKey: "grok-v1",
      status: "failed",
      hardGateResult: "fail",
      benchmarkTruth: "reject",
    }),
  ];
}

describe("capability performance review v1", () => {
  it("declares comparison readiness without selecting a winner", () => {
    const result = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy(),
      observations: cleanComparisonObservations(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.disposition).toBe("comparison_ready");
    expect(result.value.comparedImplementationKeys).toEqual(["grok-v1", "hermes-v1"]);
    expect(result.value.implementationReviews.every((review) => review.eligible)).toBe(true);
    expect("winner" in result.value).toBe(false);
    expect("recommendedExecutorKey" in result.value).toBe(false);
    expect(result.value.requiresManagerApproval).toBe(true);
    expect(result.value.authorityGranted).toBe(false);
    expect(result.value.reviewHash).toHaveLength(64);
  });

  it("keeps incomplete evidence visible instead of treating it as ready", () => {
    const result = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy(),
      observations: [
        observation({
          runId: "only-run",
          assignmentId: "only-assignment",
          benchmarkTruth: null,
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.disposition).toBe("collect_more_evidence");
    expect(result.value.failures).toEqual(
      expect.arrayContaining([
        "insufficient_implementations",
        "insufficient_total_runs",
        "insufficient_accepted_outcomes",
        "benchmark_evidence_incomplete",
      ]),
    );
    expect(result.value.implementationReviews[0].eligible).toBe(false);
  });

  it("escalates conflicting benchmark truth across implementations", () => {
    const result = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy({
        minimumTotalRunsPerImplementation: 1,
        minimumAcceptedOutcomesPerImplementation: 0,
        minimumBenchmarkEvaluatedRunsPerImplementation: 1,
      }),
      observations: [
        observation({
          runId: "shared-run",
          assignmentId: "hermes-shared-assignment",
          executorKey: "hermes-v1",
          benchmarkTruth: "accept",
        }),
        observation({
          runId: "shared-run",
          assignmentId: "grok-shared-assignment",
          executorKey: "grok-v1",
          benchmarkTruth: "reject",
          hardGateResult: "fail",
          status: "failed",
        }),
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.disposition).toBe("escalate_human_review");
    expect(result.value.conflicts).toEqual(["conflicting_benchmark_truth:shared-run"]);
    expect(result.value.failures).toContain("conflicting_benchmark_truth");
  });

  it("rejects duplicate run and implementation observations before aggregation", () => {
    const duplicate = observation({
      runId: "duplicate-run",
      assignmentId: "duplicate-assignment",
    });
    const result = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy(),
      observations: [duplicate, duplicate],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures).toContain(
      "Duplicate run/implementation observation identity detected.",
    );
  });

  it("escalates any authority incident even when other thresholds pass", () => {
    const result = reviewCapabilityPerformance({
      capabilityKey: "evidence_research",
      contractVersion: "catalog-evidence-packet/v1",
      policy: policy(),
      observations: cleanComparisonObservations().map((item) =>
        item.executorKey === "grok-v1" && item.runId === "grok-accept"
          ? { ...item, authorityIncident: true }
          : item,
      ),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.disposition).toBe("escalate_human_review");
    expect(result.value.failures).toContain("authority_incidents_exceeded");
  });
});
