import { describe, expect, it } from "vitest";
import {
  CONTEXT_PROVIDER_SCHEMA_VERSION,
  buildContextProviderScorecard,
  type ContextBenchmarkTask,
  type ContextProviderObservation,
} from "@/lib/context-provider";

const HASH = "c".repeat(64);

function task(overrides: Partial<ContextBenchmarkTask> = {}): ContextBenchmarkTask {
  return {
    taskId: "task-001",
    taskVersion: "v1",
    repositorySnapshotHash: HASH,
    objective: "Locate the request boundary and its callers",
    expectedFiles: ["src/app/request.ts"],
    expectedSymbols: ["handleRequest"],
    operations: ["findSymbol", "findCallers"],
    unseen: true,
    ...overrides,
  };
}

function observation(overrides: Partial<ContextProviderObservation> = {}): ContextProviderObservation {
  return {
    schemaVersion: CONTEXT_PROVIDER_SCHEMA_VERSION,
    taskId: "task-001",
    taskVersion: "v1",
    repositorySnapshotHash: HASH,
    condition: "cold_agent",
    providerKey: "native-cold",
    operation: "findSymbol",
    status: "completed",
    correctOutcome: true,
    affectedFileRecall: 1,
    falseStructuralConclusions: 0,
    tokenCount: 1000,
    toolCallCount: 4,
    wallTimeMs: 1000,
    setupMinutes: 0,
    maintenanceMinutes: 1,
    staleContextIncident: false,
    privacyIncident: false,
    privacyHandling: "approved",
    sourceArtifactHash: "d".repeat(64),
    recordedAt: "2026-08-25T20:00:00Z",
    ...overrides,
  };
}

function failuresOf(result: ReturnType<typeof buildContextProviderScorecard>): string {
  return result.ok ? "" : result.failures.join(" ");
}

describe("context-provider bakeoff refuses unbound or repaired artifacts", () => {
  it("rejects extra keys on a task or observation instead of stripping them", () => {
    const extraTask = buildContextProviderScorecard({
      tasks: [{ ...task(), winner: "native-cold" }],
      observations: [observation()],
    });
    expect(extraTask.ok).toBe(false);
    expect(failuresOf(extraTask)).toMatch(/winner|unrecognized/i);

    const extraObservation = buildContextProviderScorecard({
      tasks: [task()],
      observations: [{ ...observation(), authorityGranted: true }],
    });
    expect(extraObservation.ok).toBe(false);
    expect(failuresOf(extraObservation)).toMatch(/authorityGranted|unrecognized/i);
  });

  it("rejects a padded identifier rather than trimming it into a match", () => {
    const paddedTask = buildContextProviderScorecard({
      tasks: [{ ...task(), taskId: " task-001" }],
      observations: [observation()],
    });
    expect(paddedTask.ok).toBe(false);
    expect(failuresOf(paddedTask)).toMatch(/whitespace|blank/i);

    const paddedObservation = buildContextProviderScorecard({
      tasks: [task()],
      observations: [observation({ providerKey: "native-cold " })],
    });
    expect(paddedObservation.ok).toBe(false);
    expect(failuresOf(paddedObservation)).toMatch(/whitespace|blank/i);
  });

  it("rejects a duplicate unseen task instead of keeping the last copy", () => {
    const result = buildContextProviderScorecard({
      tasks: [task(), task({ expectedFiles: ["src/other.ts"] })],
      observations: [observation()],
    });
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/duplicates/i);
  });

  it("rejects an observation that names an unknown task", () => {
    const result = buildContextProviderScorecard({
      tasks: [task()],
      observations: [observation({ taskId: "task-other", taskVersion: "v1" })],
    });
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/unknown task/i);
  });

  it("rejects an operation the named task did not declare", () => {
    const result = buildContextProviderScorecard({
      tasks: [task()],
      observations: [observation({ operation: "search" })],
    });
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/not declared/i);
  });

  it("rejects a task that repeats an operation instead of uniquing it", () => {
    const result = buildContextProviderScorecard({
      tasks: [{ ...task(), operations: ["findSymbol", "findSymbol"] }],
      observations: [observation()],
    });
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/repeat/i);
  });

  it("requires at least one unseen task even when no observations are supplied", () => {
    const result = buildContextProviderScorecard({ tasks: [], observations: [] });
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/At least one unseen benchmark task/i);
  });
});

describe("context-provider bakeoff still accepts a failed incorrect run", () => {
  it("keeps a failed observation that does not claim a correct outcome", () => {
    const result = buildContextProviderScorecard({
      tasks: [task()],
      observations: [
        observation({
          status: "failed",
          correctOutcome: false,
          wallTimeMs: 2000,
        }),
        observation({
          operation: "findCallers",
          wallTimeMs: 4000,
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const failed = result.rows.find((row) => row.operation === "findSymbol");
    expect(failed).toMatchObject({
      totalRuns: 1,
      completedRuns: 0,
      failedRuns: 1,
      correctOutcomes: 0,
      correctOutcomeRate: 0,
    });
  });
});
