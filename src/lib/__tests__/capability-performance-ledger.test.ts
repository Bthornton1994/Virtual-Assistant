import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
  buildCapabilityPerformanceLedger,
  type CapabilityPerformanceObservation,
} from "@/lib/capability-performance-ledger";

const HASH = "b".repeat(64);

function observation(overrides: Partial<CapabilityPerformanceObservation> = {}): CapabilityPerformanceObservation {
  return {
    schemaVersion: CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
    runId: "run-001",
    assignmentId: "assignment-001",
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
    humanInterventionMinutes: 2,
    aiCostMicros: 100,
    toolCostMicros: 40,
    latencyMs: 1000,
    outcomeSource: "deterministic_validator",
    sourceArtifactHash: HASH,
    recordedAt: "2026-08-25T20:00:00Z",
    ...overrides,
  };
}

describe("capability performance ledger v1", () => {
  it("aggregates by capability, executor, and contract and includes tool cost", () => {
    const result = buildCapabilityPerformanceLedger([
      observation(),
      observation({
        runId: "run-002",
        assignmentId: "assignment-002",
        aiCostMicros: 50,
        toolCostMicros: 10,
        latencyMs: 3000,
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      totalRuns: 2,
      completedRuns: 2,
      hardGatePasses: 2,
      acceptedOutcomes: 2,
      hardGatePassRate: 1,
      acceptedOutcomeRate: 1,
      evidenceCompletenessRate: 1,
      totalCostMicros: 200,
      toolCostMicros: 50,
      averageCostPerAcceptedOutcomeMicros: 100,
      medianLatencyMs: 2000,
      p95LatencyMs: 3000,
    });
  });

  it("calculates benchmark error rates only when benchmark truth exists", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({ runId: "run-accept", benchmarkTruth: "accept", hardGateResult: "fail" }),
      observation({ runId: "run-reject", benchmarkTruth: "reject", hardGateResult: "pass" }),
      observation({ runId: "run-unknown", benchmarkTruth: null, hardGateResult: "not_run" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      benchmarkEvaluatedRuns: 2,
      falseAcceptances: 1,
      falseAcceptanceRate: 1,
      falseRejections: 1,
      falseRejectionRate: 1,
      hardGatePassRate: 1 / 3,
      acceptedOutcomes: 1,
      acceptedOutcomeRate: 1 / 3,
    });
  });

  it("returns null benchmark error rates when no benchmark truth is available", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({ benchmarkTruth: null }),
      observation({ runId: "run-002", benchmarkTruth: null }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].falseAcceptanceRate).toBeNull();
    expect(result.rows[0].falseRejectionRate).toBeNull();
  });

  it("keeps implementation rows separate and sorts them deterministically", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({ executorKey: "zeta-v1", contractVersion: "contract/v2" }),
      observation({ executorKey: "alpha-v1", contractVersion: "contract/v1" }),
      observation({ executorKey: "beta-v1", contractVersion: "contract/v1" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => [row.contractVersion, row.executorKey])).toEqual([
      ["contract/v1", "alpha-v1"],
      ["contract/v1", "beta-v1"],
      ["contract/v2", "zeta-v1"],
    ]);
  });

  it("rejects malformed or non-hashed observations without repairing them", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({
        sourceArtifactHash: "not-a-sha",
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("sourceArtifactHash");
  });


  it("rejects fractional micro-costs", () => {
    const result = buildCapabilityPerformanceLedger([observation({ aiCostMicros: 0.5 })]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("aiCostMicros");
  });

  it("records authority, correction, and retry rates from evidence", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({
        authorityIncident: true,
        correctionRequired: true,
        rollbackOrRetry: true,
        humanInterventionMinutes: 10,
      }),
      observation({ runId: "run-002" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      authorityIncidents: 1,
      authorityIncidentRate: 0.5,
      correctionRate: 0.5,
      rollbackOrRetryRate: 0.5,
      humanInterventionMinutes: 12,
    });
  });
});
