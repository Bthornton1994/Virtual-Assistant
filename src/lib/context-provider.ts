import { z } from "zod";
import { identifierString, isoDateTimeSchema, nonEmptyString } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";

export const CONTEXT_PROVIDER_SCHEMA_VERSION = "context-provider-bakeoff/v1" as const;
export const CONTEXT_PROVIDER_OPERATIONS = [
  "build",
  "refresh",
  "architecture",
  "findSymbol",
  "findCallers",
  "impactAnalysis",
  "search",
  "health",
] as const;
export const CONTEXT_BENCHMARK_CONDITIONS = [
  "cold_agent",
  "graft",
  "codebase_memory",
  "native_future",
] as const;
export const CONTEXT_RUN_STATUSES = ["completed", "failed"] as const;
export const CONTEXT_DATA_POLICIES = ["public_repository", "approved_private_repository"] as const;
export const CONTEXT_PRIVACY_HANDLING = ["approved", "redacted", "blocked"] as const;

export type ContextProviderOperation = (typeof CONTEXT_PROVIDER_OPERATIONS)[number];
export type ContextBenchmarkCondition = (typeof CONTEXT_BENCHMARK_CONDITIONS)[number];
export type ContextRunStatus = (typeof CONTEXT_RUN_STATUSES)[number];
export type ContextDataPolicy = (typeof CONTEXT_DATA_POLICIES)[number];
export type ContextPrivacyHandling = (typeof CONTEXT_PRIVACY_HANDLING)[number];

const nonNegativeFinite = z.number().finite().min(0);
const nonNegativeInteger = z.number().int().min(0);
const proportion = z.number().finite().min(0).max(1);

export const contextProviderOperationSchema = z.enum(CONTEXT_PROVIDER_OPERATIONS);
export const contextBenchmarkConditionSchema = z.enum(CONTEXT_BENCHMARK_CONDITIONS);

export const contextProviderRequestSchema = z
  .object({
    operation: contextProviderOperationSchema,
    repositorySnapshotHash: sha256HexSchema,
    path: nonEmptyString.nullable(),
    symbol: nonEmptyString.nullable(),
    query: nonEmptyString.nullable(),
    dataPolicy: z.enum(CONTEXT_DATA_POLICIES),
  })
  .strict();

export type ContextProviderRequest = z.infer<typeof contextProviderRequestSchema>;
export type ContextProviderRequestFor<TOperation extends ContextProviderOperation> = Omit<
  ContextProviderRequest,
  "operation"
> & {
  operation: TOperation;
};

export const contextProviderResponseSchema = z
  .object({
    schemaVersion: z.literal(CONTEXT_PROVIDER_SCHEMA_VERSION),
    providerKey: identifierString,
    operation: contextProviderOperationSchema,
    repositorySnapshotHash: sha256HexSchema,
    sourceArtifactHash: sha256HexSchema,
    sourcePaths: z.array(nonEmptyString).max(500),
    symbols: z.array(nonEmptyString).max(500),
    stale: z.boolean(),
    privacyHandling: z.enum(CONTEXT_PRIVACY_HANDLING),
    generatedAt: isoDateTimeSchema,
  })
  .strict();

export type ContextProviderResponse = z.infer<typeof contextProviderResponseSchema>;

/**
 * A provider is an implementation behind a Delegation Cloud-owned boundary.
 * It may build or refresh a derived cache, but it cannot change repository
 * source, benchmark truth, policy, or the authoritative work record.
 */
export interface ContextProvider {
  readonly providerKey: string;
  build(request: ContextProviderRequestFor<"build">): Promise<ContextProviderResponse>;
  refresh(request: ContextProviderRequestFor<"refresh">): Promise<ContextProviderResponse>;
  architecture(request: ContextProviderRequestFor<"architecture">): Promise<ContextProviderResponse>;
  findSymbol(request: ContextProviderRequestFor<"findSymbol">): Promise<ContextProviderResponse>;
  findCallers(request: ContextProviderRequestFor<"findCallers">): Promise<ContextProviderResponse>;
  impactAnalysis(request: ContextProviderRequestFor<"impactAnalysis">): Promise<ContextProviderResponse>;
  search(request: ContextProviderRequestFor<"search">): Promise<ContextProviderResponse>;
  health(request: ContextProviderRequestFor<"health">): Promise<ContextProviderResponse>;
}

export const contextBenchmarkTaskSchema = z
  .object({
    taskId: identifierString,
    taskVersion: identifierString,
    repositorySnapshotHash: sha256HexSchema,
    objective: nonEmptyString,
    expectedFiles: z.array(nonEmptyString).min(1).max(256),
    expectedSymbols: z.array(nonEmptyString).max(256),
    operations: z
      .array(contextProviderOperationSchema)
      .min(1)
      .max(CONTEXT_PROVIDER_OPERATIONS.length)
      .refine((operations) => new Set(operations).size === operations.length, "must not repeat operations"),
    unseen: z.literal(true),
  })
  .strict();

export type ContextBenchmarkTask = z.infer<typeof contextBenchmarkTaskSchema>;

export const contextProviderObservationSchema = z
  .object({
    schemaVersion: z.literal(CONTEXT_PROVIDER_SCHEMA_VERSION),
    taskId: identifierString,
    taskVersion: identifierString,
    repositorySnapshotHash: sha256HexSchema,
    condition: contextBenchmarkConditionSchema,
    providerKey: identifierString,
    operation: contextProviderOperationSchema,
    status: z.enum(CONTEXT_RUN_STATUSES),
    correctOutcome: z.boolean(),
    affectedFileRecall: proportion,
    falseStructuralConclusions: nonNegativeInteger,
    tokenCount: nonNegativeInteger,
    toolCallCount: nonNegativeInteger,
    wallTimeMs: nonNegativeFinite,
    setupMinutes: nonNegativeFinite,
    maintenanceMinutes: nonNegativeFinite,
    staleContextIncident: z.boolean(),
    privacyIncident: z.boolean(),
    privacyHandling: z.enum(CONTEXT_PRIVACY_HANDLING),
    sourceArtifactHash: sha256HexSchema,
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.status === "failed" && observation.correctOutcome) {
      context.addIssue({
        code: "custom",
        path: ["correctOutcome"],
        message: "failed observations cannot be marked correct",
      });
    }
  });

export type ContextProviderObservation = z.infer<typeof contextProviderObservationSchema>;

type MutableScorecardRow = {
  condition: ContextBenchmarkCondition;
  providerKey: string;
  operation: ContextProviderOperation;
  totalRuns: number;
  completedRuns: number;
  correctOutcomes: number;
  affectedFileRecall: number;
  falseStructuralConclusions: number;
  tokenCount: number;
  toolCallCount: number;
  wallTimeMs: number[];
  setupMinutes: number;
  maintenanceMinutes: number;
  staleContextIncidents: number;
  privacyIncidents: number;
  approvedPrivacyRuns: number;
  redactedPrivacyRuns: number;
  blockedPrivacyRuns: number;
};

export type ContextProviderScorecardRow = {
  schemaVersion: typeof CONTEXT_PROVIDER_SCHEMA_VERSION;
  condition: ContextBenchmarkCondition;
  providerKey: string;
  operation: ContextProviderOperation;
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  correctOutcomes: number;
  correctOutcomeRate: number;
  averageAffectedFileRecall: number;
  falseStructuralConclusions: number;
  averageFalseStructuralConclusions: number;
  tokenCount: number;
  averageTokenCount: number;
  toolCallCount: number;
  averageToolCallCount: number;
  medianWallTimeMs: number | null;
  p95WallTimeMs: number | null;
  setupMinutes: number;
  averageSetupMinutes: number;
  maintenanceMinutes: number;
  averageMaintenanceMinutes: number;
  staleContextIncidents: number;
  staleContextIncidentRate: number;
  privacyIncidents: number;
  privacyIncidentRate: number;
  approvedPrivacyRuns: number;
  redactedPrivacyRuns: number;
  blockedPrivacyRuns: number;
};

export type ContextProviderScorecardResult =
  | { ok: true; rows: ContextProviderScorecardRow[] }
  | { ok: false; failures: string[] };

export type ContextProviderBenchmarkInput = {
  tasks: readonly unknown[];
  observations: readonly unknown[];
};

function taskKey(taskId: string, taskVersion: string): string {
  return taskId + "\u001f" + taskVersion;
}

function scorecardKey(observation: ContextProviderObservation): string {
  return [observation.condition, observation.providerKey, observation.operation].join("\u001f");
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

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function emptyRow(observation: ContextProviderObservation): MutableScorecardRow {
  return {
    condition: observation.condition,
    providerKey: observation.providerKey,
    operation: observation.operation,
    totalRuns: 0,
    completedRuns: 0,
    correctOutcomes: 0,
    affectedFileRecall: 0,
    falseStructuralConclusions: 0,
    tokenCount: 0,
    toolCallCount: 0,
    wallTimeMs: [],
    setupMinutes: 0,
    maintenanceMinutes: 0,
    staleContextIncidents: 0,
    privacyIncidents: 0,
    approvedPrivacyRuns: 0,
    redactedPrivacyRuns: 0,
    blockedPrivacyRuns: 0,
  };
}

function addObservation(row: MutableScorecardRow, observation: ContextProviderObservation): void {
  row.totalRuns += 1;
  if (observation.status === "completed") row.completedRuns += 1;
  if (observation.correctOutcome) row.correctOutcomes += 1;
  row.affectedFileRecall += observation.affectedFileRecall;
  row.falseStructuralConclusions += observation.falseStructuralConclusions;
  row.tokenCount += observation.tokenCount;
  row.toolCallCount += observation.toolCallCount;
  row.wallTimeMs.push(observation.wallTimeMs);
  row.setupMinutes += observation.setupMinutes;
  row.maintenanceMinutes += observation.maintenanceMinutes;
  if (observation.staleContextIncident) row.staleContextIncidents += 1;
  if (observation.privacyIncident) row.privacyIncidents += 1;
  if (observation.privacyHandling === "approved") row.approvedPrivacyRuns += 1;
  if (observation.privacyHandling === "redacted") row.redactedPrivacyRuns += 1;
  if (observation.privacyHandling === "blocked") row.blockedPrivacyRuns += 1;
}

function materialize(row: MutableScorecardRow): ContextProviderScorecardRow {
  return {
    schemaVersion: CONTEXT_PROVIDER_SCHEMA_VERSION,
    condition: row.condition,
    providerKey: row.providerKey,
    operation: row.operation,
    totalRuns: row.totalRuns,
    completedRuns: row.completedRuns,
    failedRuns: row.totalRuns - row.completedRuns,
    correctOutcomes: row.correctOutcomes,
    correctOutcomeRate: ratio(row.correctOutcomes, row.totalRuns),
    averageAffectedFileRecall: ratio(row.affectedFileRecall, row.totalRuns),
    falseStructuralConclusions: row.falseStructuralConclusions,
    averageFalseStructuralConclusions: ratio(row.falseStructuralConclusions, row.totalRuns),
    tokenCount: row.tokenCount,
    averageTokenCount: ratio(row.tokenCount, row.totalRuns),
    toolCallCount: row.toolCallCount,
    averageToolCallCount: ratio(row.toolCallCount, row.totalRuns),
    medianWallTimeMs: percentile(row.wallTimeMs, 0.5),
    p95WallTimeMs: percentile(row.wallTimeMs, 0.95),
    setupMinutes: row.setupMinutes,
    averageSetupMinutes: ratio(row.setupMinutes, row.totalRuns),
    maintenanceMinutes: row.maintenanceMinutes,
    averageMaintenanceMinutes: ratio(row.maintenanceMinutes, row.totalRuns),
    staleContextIncidents: row.staleContextIncidents,
    staleContextIncidentRate: ratio(row.staleContextIncidents, row.totalRuns),
    privacyIncidents: row.privacyIncidents,
    privacyIncidentRate: ratio(row.privacyIncidents, row.totalRuns),
    approvedPrivacyRuns: row.approvedPrivacyRuns,
    redactedPrivacyRuns: row.redactedPrivacyRuns,
    blockedPrivacyRuns: row.blockedPrivacyRuns,
  };
}

function rowSort(a: ContextProviderScorecardRow, b: ContextProviderScorecardRow): number {
  return (
    (a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : 0) ||
    (a.providerKey < b.providerKey ? -1 : a.providerKey > b.providerKey ? 1 : 0) ||
    (a.operation < b.operation ? -1 : a.operation > b.operation ? 1 : 0)
  );
}

/**
 * Builds a scorecard only from the supplied tasks and attributed observations.
 * Every observation must point at an unseen task and its exact repository snapshot.
 * Invalid artifacts are rejected rather than repaired.
 */
export function buildContextProviderScorecard(
  input: ContextProviderBenchmarkInput,
): ContextProviderScorecardResult {
  const failures: string[] = [];
  const tasks = new Map<string, ContextBenchmarkTask>();

  input.tasks.forEach((candidate, index) => {
    const parsed = contextBenchmarkTaskSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        failures.push("Task " + index + " " + issue.path.join(".") + ": " + issue.message);
      }
      return;
    }
    const key = taskKey(parsed.data.taskId, parsed.data.taskVersion);
    if (tasks.has(key)) {
      failures.push("Task " + index + " duplicates " + parsed.data.taskId + "/" + parsed.data.taskVersion);
      return;
    }
    tasks.set(key, parsed.data);
  });

  if (tasks.size === 0) failures.push("At least one unseen benchmark task is required");

  const observations: ContextProviderObservation[] = [];
  input.observations.forEach((candidate, index) => {
    const parsed = contextProviderObservationSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        failures.push("Observation " + index + " " + issue.path.join(".") + ": " + issue.message);
      }
      return;
    }
    const task = tasks.get(taskKey(parsed.data.taskId, parsed.data.taskVersion));
    if (!task) {
      failures.push(
        "Observation " + index + " references unknown task " + parsed.data.taskId + "/" + parsed.data.taskVersion,
      );
      return;
    }
    if (parsed.data.repositorySnapshotHash !== task.repositorySnapshotHash) {
      failures.push(
        "Observation " +
          index +
          " repositorySnapshotHash does not match task " +
          parsed.data.taskId +
          "/" +
          parsed.data.taskVersion,
      );
      return;
    }
    if (!task.operations.includes(parsed.data.operation)) {
      failures.push(
        "Observation " +
          index +
          " operation " +
          parsed.data.operation +
          " is not declared by task " +
          parsed.data.taskId +
          "/" +
          parsed.data.taskVersion,
      );
      return;
    }
    observations.push(parsed.data);
  });

  if (failures.length > 0) return { ok: false, failures };

  const rows = new Map<string, MutableScorecardRow>();
  for (const observation of observations) {
    const key = scorecardKey(observation);
    const row = rows.get(key) ?? emptyRow(observation);
    addObservation(row, observation);
    rows.set(key, row);
  }

  return {
    ok: true,
    rows: [...rows.values()].map(materialize).sort(rowSort),
  };
}
