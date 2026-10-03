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

function failuresOf(result: ReturnType<typeof buildCapabilityPerformanceLedger>): string {
  return result.ok ? "" : result.failures.join(" ");
}

describe("capability performance ledger refuses repaired observations", () => {
  it("rejects extra keys instead of aggregating the rest of the row", () => {
    const result = buildCapabilityPerformanceLedger([{ ...observation(), authorityGranted: true }]);
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/authorityGranted|unrecognized/i);
  });

  it("rejects a padded identifier rather than matching the trimmed key", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({ capabilityKey: "evidence_research " }),
    ]);
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/whitespace|blank/i);
  });

  it("rejects an unknown status instead of treating it as incomplete", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({ status: "succeeded" as CapabilityPerformanceObservation["status"] }),
    ]);
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/status/i);
  });
});

describe("capability performance ledger accepted-outcome pairing", () => {
  it("counts an accepted outcome only when the run completed and the hard gate passed", () => {
    const result = buildCapabilityPerformanceLedger([
      observation({ runId: "completed-fail", hardGateResult: "fail" }),
      observation({ runId: "blocked-pass", status: "blocked", hardGateResult: "pass" }),
      observation({ runId: "failed-pass", status: "failed", hardGateResult: "pass" }),
      observation({ runId: "inconclusive", status: "inconclusive", hardGateResult: "not_run" }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({
      totalRuns: 4,
      completedRuns: 1,
      hardGatePasses: 2,
      acceptedOutcomes: 0,
      acceptedOutcomeRate: 0,
      averageCostPerAcceptedOutcomeMicros: null,
    });
  });

  it("returns an empty scorecard for an empty observation list rather than inventing a row", () => {
    const result = buildCapabilityPerformanceLedger([]);
    expect(result).toEqual({ ok: true, rows: [] });
  });
});
