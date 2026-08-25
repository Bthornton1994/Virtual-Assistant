import { z } from "zod";
import { identifierString, isoDateTimeSchema } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";

export const CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION = "capability-performance-ledger/v1" as const;
export const LEDGER_OUTCOME_STATUSES = ["completed", "failed", "blocked", "inconclusive"] as const;
export const LEDGER_HARD_GATE_RESULTS = ["pass", "fail", "not_run"] as const;
export const LEDGER_BENCHMARK_TRUTH = ["accept", "reject"] as const;
export const LEDGER_OUTCOME_SOURCES = ["deterministic_validator", "human_qa"] as const;

export type LedgerOutcomeStatus = (typeof LEDGER_OUTCOME_STATUSES)[number];
export type LedgerHardGateResult = (typeof LEDGER_HARD_GATE_RESULTS)[number];
export type LedgerBenchmarkTruth = (typeof LEDGER_BENCHMARK_TRUTH)[number];
export type LedgerOutcomeSource = (typeof LEDGER_OUTCOME_SOURCES)[number];

const nonNegativeFinite = z.number().finite().min(0);
const nonNegativeInteger = z.number().int().min(0);

export const performanceObservationSchema = z
  .object({
    schemaVersion: z.literal(CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION),
    runId: identifierString,
    assignmentId: identifierString,
    capabilityKey: identifierString,
    executorKey: identifierString,
    contractVersion: identifierString,
    status: z.enum(LEDGER_OUTCOME_STATUSES),
    hardGateResult: z.enum(LEDGER_HARD_GATE_RESULTS),
    benchmarkTruth: z.enum(LEDGER_BENCHMARK_TRUTH).nullable(),
    authorityIncident: z.boolean(),
    evidenceComplete: z.boolean(),
    correctionRequired: z.boolean(),
    rollbackOrRetry: z.boolean(),
    humanInterventionMinutes: nonNegativeFinite,
    aiCostMicros: nonNegativeInteger,
    toolCostMicros: nonNegativeInteger,
    latencyMs: nonNegativeFinite,
    outcomeSource: z.enum(LEDGER_OUTCOME_SOURCES),
    sourceArtifactHash: sha256HexSchema,
    recordedAt: isoDateTimeSchema,
  })
  .strict();

export type CapabilityPerformanceObservation = z.infer<typeof performanceObservationSchema>;

type MutableLedgerRow = {
  capabilityKey: string;
  executorKey: string;
  contractVersion: string;
  totalRuns: number;
  completedRuns: number;
  hardGatePasses: number;
  acceptedOutcomes: number;
  benchmarkEvaluatedRuns: number;
  benchmarkAcceptedRuns: number;
  benchmarkRejectedRuns: number;
  falseAcceptances: number;
  falseRejections: number;
  authorityIncidents: number;
  evidenceCompleteRuns: number;
  correctionRequiredRuns: number;
  rollbackOrRetryRuns: number;
  humanInterventionMinutes: number;
  aiCostMicros: number;
  toolCostMicros: number;
  latencyMs: number[];
};

export type CapabilityPerformanceLedgerRow = {
  schemaVersion: typeof CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION;
  capabilityKey: string;
  executorKey: string;
  contractVersion: string;
  totalRuns: number;
  completedRuns: number;
  hardGatePasses: number;
  acceptedOutcomes: number;
  hardGatePassRate: number;
  acceptedOutcomeRate: number;
  benchmarkEvaluatedRuns: number;
  falseAcceptances: number;
  falseAcceptanceRate: number | null;
  falseRejections: number;
  falseRejectionRate: number | null;
  authorityIncidents: number;
  authorityIncidentRate: number;
  evidenceCompletenessRate: number;
  correctionRate: number;
  rollbackOrRetryRate: number;
  humanInterventionMinutes: number;
  aiCostMicros: number;
  toolCostMicros: number;
  totalCostMicros: number;
  averageCostPerAcceptedOutcomeMicros: number | null;
  medianLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type PerformanceLedgerResult =
  | { ok: true; rows: CapabilityPerformanceLedgerRow[] }
  | { ok: false; failures: string[] };

function ledgerKey(observation: CapabilityPerformanceObservation): string {
  return [observation.capabilityKey, observation.executorKey, observation.contractVersion].join("\u001f");
}

function percentile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (probability === 0.5 && sorted.length % 2 === 0) {
    const upper = sorted.length / 2;
    return (sorted[upper - 1] + sorted[upper]) / 2;
  }
  const rank = Math.max(1, Math.ceil(probability * sorted.length));
  return sorted[rank - 1];
}

function emptyRow(observation: CapabilityPerformanceObservation): MutableLedgerRow {
  return {
    capabilityKey: observation.capabilityKey,
    executorKey: observation.executorKey,
    contractVersion: observation.contractVersion,
    totalRuns: 0,
    completedRuns: 0,
    hardGatePasses: 0,
    acceptedOutcomes: 0,
    benchmarkEvaluatedRuns: 0,
    benchmarkAcceptedRuns: 0,
    benchmarkRejectedRuns: 0,
    falseAcceptances: 0,
    falseRejections: 0,
    authorityIncidents: 0,
    evidenceCompleteRuns: 0,
    correctionRequiredRuns: 0,
    rollbackOrRetryRuns: 0,
    humanInterventionMinutes: 0,
    aiCostMicros: 0,
    toolCostMicros: 0,
    latencyMs: [],
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function materialize(row: MutableLedgerRow): CapabilityPerformanceLedgerRow {
  const totalCostMicros = row.aiCostMicros + row.toolCostMicros;
  return {
    schemaVersion: CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
    capabilityKey: row.capabilityKey,
    executorKey: row.executorKey,
    contractVersion: row.contractVersion,
    totalRuns: row.totalRuns,
    completedRuns: row.completedRuns,
    hardGatePasses: row.hardGatePasses,
    acceptedOutcomes: row.acceptedOutcomes,
    hardGatePassRate: ratio(row.hardGatePasses, row.totalRuns),
    acceptedOutcomeRate: ratio(row.acceptedOutcomes, row.totalRuns),
    benchmarkEvaluatedRuns: row.benchmarkEvaluatedRuns,
    falseAcceptances: row.falseAcceptances,
    falseAcceptanceRate:
      row.benchmarkRejectedRuns === 0 ? null : row.falseAcceptances / row.benchmarkRejectedRuns,
    falseRejections: row.falseRejections,
    falseRejectionRate:
      row.benchmarkAcceptedRuns === 0 ? null : row.falseRejections / row.benchmarkAcceptedRuns,
    authorityIncidents: row.authorityIncidents,
    authorityIncidentRate: ratio(row.authorityIncidents, row.totalRuns),
    evidenceCompletenessRate: ratio(row.evidenceCompleteRuns, row.totalRuns),
    correctionRate: ratio(row.correctionRequiredRuns, row.totalRuns),
    rollbackOrRetryRate: ratio(row.rollbackOrRetryRuns, row.totalRuns),
    humanInterventionMinutes: row.humanInterventionMinutes,
    aiCostMicros: row.aiCostMicros,
    toolCostMicros: row.toolCostMicros,
    totalCostMicros,
    averageCostPerAcceptedOutcomeMicros:
      row.acceptedOutcomes === 0 ? null : totalCostMicros / row.acceptedOutcomes,
    medianLatencyMs: percentile(row.latencyMs, 0.5),
    p95LatencyMs: percentile(row.latencyMs, 0.95),
  };
}

function addObservation(row: MutableLedgerRow, observation: CapabilityPerformanceObservation): void {
  row.totalRuns += 1;
  if (observation.status === "completed") row.completedRuns += 1;
  if (observation.hardGateResult === "pass") row.hardGatePasses += 1;
  if (observation.status === "completed" && observation.hardGateResult === "pass") {
    row.acceptedOutcomes += 1;
  }
  if (observation.benchmarkTruth !== null) {
    row.benchmarkEvaluatedRuns += 1;
    if (observation.benchmarkTruth === "accept") {
      row.benchmarkAcceptedRuns += 1;
      if (observation.hardGateResult === "fail") row.falseRejections += 1;
    } else {
      row.benchmarkRejectedRuns += 1;
      if (observation.hardGateResult === "pass") row.falseAcceptances += 1;
    }
  }
  if (observation.authorityIncident) row.authorityIncidents += 1;
  if (observation.evidenceComplete) row.evidenceCompleteRuns += 1;
  if (observation.correctionRequired) row.correctionRequiredRuns += 1;
  if (observation.rollbackOrRetry) row.rollbackOrRetryRuns += 1;
  row.humanInterventionMinutes += observation.humanInterventionMinutes;
  row.aiCostMicros += observation.aiCostMicros;
  row.toolCostMicros += observation.toolCostMicros;
  row.latencyMs.push(observation.latencyMs);
}

function rowSort(a: CapabilityPerformanceLedgerRow, b: CapabilityPerformanceLedgerRow): number {
  return (
    (a.capabilityKey < b.capabilityKey ? -1 : a.capabilityKey > b.capabilityKey ? 1 : 0) ||
    (a.contractVersion < b.contractVersion ? -1 : a.contractVersion > b.contractVersion ? 1 : 0) ||
    (a.executorKey < b.executorKey ? -1 : a.executorKey > b.executorKey ? 1 : 0)
  );
}

/**
 * Aggregates only supplied, already-attributed outcome evidence. It does not
 * promote an executor, write a score, or treat missing benchmark truth as zero
 * error. Invalid artifacts are rejected rather than repaired.
 */
export function buildCapabilityPerformanceLedger(input: readonly unknown[]): PerformanceLedgerResult {
  const observations: CapabilityPerformanceObservation[] = [];
  const failures: string[] = [];

  input.forEach((candidate, index) => {
    const parsed = performanceObservationSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        failures.push("Observation " + index + " " + issue.path.join(".") + ": " + issue.message);
      }
      return;
    }
    observations.push(parsed.data);
  });

  if (failures.length > 0) return { ok: false, failures };

  const rows = new Map<string, MutableLedgerRow>();
  for (const observation of observations) {
    const key = ledgerKey(observation);
    const row = rows.get(key) ?? emptyRow(observation);
    addObservation(row, observation);
    rows.set(key, row);
  }

  return {
    ok: true,
    rows: [...rows.values()].map(materialize).sort(rowSort),
  };
}
