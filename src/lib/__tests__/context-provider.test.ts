import { describe, expect, it } from "vitest";
import {
  CONTEXT_PROVIDER_SCHEMA_VERSION,
  buildContextProviderScorecard,
  type ContextProviderObservation,
  type ContextBenchmarkTask,
} from "@/lib/context-provider";

const HASH = "c".repeat(64);

const task: ContextBenchmarkTask = {
  taskId: "task-001",
  taskVersion: "v1",
  repositorySnapshotHash: HASH,
  objective: "Locate the request boundary and its callers",
  expectedFiles: ["src/app/request.ts"],
  expectedSymbols: ["handleRequest"],
  operations: ["findSymbol", "findCallers"],
  unseen: true,
};

function observation(overrides: Partial<ContextProviderObservation> = {}): ContextProviderObservation {
  return {
    schemaVersion: CONTEXT_PROVIDER_SCHEMA_VERSION,
    taskId: task.taskId,
    taskVersion: task.taskVersion,
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

describe("context provider bakeoff v1", () => {
  it("aggregates comparable metrics by condition, provider, and operation", () => {
    const result = buildContextProviderScorecard({
      tasks: [task],
      observations: [
        observation(),
        observation({
          condition: "graft",
          providerKey: "graft-v1",
          operation: "findCallers",
          correctOutcome: false,
          affectedFileRecall: 0.5,
          falseStructuralConclusions: 2,
          tokenCount: 2000,
          toolCallCount: 8,
          wallTimeMs: 3000,
          setupMinutes: 5,
          maintenanceMinutes: 2,
          staleContextIncident: true,
          privacyIncident: true,
          privacyHandling: "redacted",
        }),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      condition: "cold_agent",
      providerKey: "native-cold",
      operation: "findSymbol",
      correctOutcomeRate: 1,
      averageAffectedFileRecall: 1,
      falseStructuralConclusions: 0,
      averageTokenCount: 1000,
      averageToolCallCount: 4,
      medianWallTimeMs: 1000,
      p95WallTimeMs: 1000,
      setupMinutes: 0,
      maintenanceMinutes: 1,
      staleContextIncidents: 0,
      privacyIncidents: 0,
      approvedPrivacyRuns: 1,
    });
    expect(result.rows[1]).toMatchObject({
      condition: "graft",
      providerKey: "graft-v1",
      operation: "findCallers",
      correctOutcomeRate: 0,
      averageAffectedFileRecall: 0.5,
      falseStructuralConclusions: 2,
      averageTokenCount: 2000,
      averageToolCallCount: 8,
      medianWallTimeMs: 3000,
      p95WallTimeMs: 3000,
      setupMinutes: 5,
      maintenanceMinutes: 2,
      staleContextIncidents: 1,
      privacyIncidents: 1,
      redactedPrivacyRuns: 1,
    });
  });

  it("rejects observations that use a different repository snapshot", () => {
    const result = buildContextProviderScorecard({
      tasks: [task],
      observations: [observation({ repositorySnapshotHash: "e".repeat(64) })],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("repositorySnapshotHash");
  });

  it("rejects failed observations that claim a correct outcome", () => {
    const result = buildContextProviderScorecard({
      tasks: [task],
      observations: [observation({ status: "failed", correctOutcome: true })],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("correctOutcome");
  });

  it("rejects reused or unknown benchmark tasks instead of repairing them", () => {
    const result = buildContextProviderScorecard({
      tasks: [{ ...task, unseen: false } as unknown],
      observations: [],
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("unseen");
  });
});
