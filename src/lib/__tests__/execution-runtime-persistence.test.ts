import { describe, expect, it, vi } from "vitest";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => null,
}));

import {
  cancelExecutionPlan,
  claimExecutionStep,
  completeExecutionAttempt,
  createExecutionPlan,
  decideExecutionApproval,
  failExecutionAttempt,
  heartbeatExecutionAttempt,
  reapExecutionLeases,
} from "@/lib/execution-runtime-persistence";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_TOKEN = "a".repeat(32);
const WORKER_ID = "worker-001";

const demoOperator: Actor = {
  id: "usr_op",
  email: "op@delegation.cloud",
  name: "Op",
  role: "operator",
  organizationId: null,
  operatorId: "op_1",
  source: "demo",
};

const persistentOperator: Actor = {
  ...demoOperator,
  source: "supabase",
};

const persistentManager: Actor = {
  id: "usr_mgr",
  email: "manager@delegation.cloud",
  name: "Manager",
  role: "ops_manager",
  organizationId: null,
  operatorId: "op_mgr",
  source: "supabase",
};

const persistentClient: Actor = {
  id: "usr_founder",
  email: "founder@northline.demo",
  name: "Elena",
  role: "client_admin",
  organizationId: "org_northline",
  operatorId: null,
  source: "supabase",
};

function completeInput(overrides: Partial<Parameters<typeof completeExecutionAttempt>[0]> = {}) {
  return {
    attemptId: ATTEMPT_ID,
    workerId: WORKER_ID,
    leaseToken: LEASE_TOKEN,
    ...overrides,
  };
}

function failInput(overrides: Partial<Parameters<typeof failExecutionAttempt>[0]> = {}) {
  return {
    attemptId: ATTEMPT_ID,
    workerId: WORKER_ID,
    leaseToken: LEASE_TOKEN,
    failureClass: "executor_failure" as const,
    failureSummary: "The leased worker could not complete the step.",
    ...overrides,
  };
}

describe("execution runtime persistence pre-RPC fail-closed gates", () => {
  it("refuses demo actors and non-ops roles before opening the service-role client", async () => {
    await expect(createExecutionPlan(demoOperator, {} as never)).rejects.toBeInstanceOf(DomainError);
    await expect(createExecutionPlan(demoOperator, {} as never)).rejects.toThrow(
      /unavailable in demo mode/,
    );
    await expect(createExecutionPlan(persistentClient, {} as never)).rejects.toBeInstanceOf(AuthzError);
    await expect(cancelExecutionPlan(persistentOperator, PLAN_ID)).rejects.toBeInstanceOf(AuthzError);
    await expect(
      decideExecutionApproval(persistentOperator, ATTEMPT_ID, "approved"),
    ).rejects.toBeInstanceOf(AuthzError);
  });

  it("rejects an invalid execution plan before any database call", async () => {
    await expect(createExecutionPlan(persistentOperator, {} as never)).rejects.toThrow(
      /Invalid execution plan/,
    );
  });

  it("rejects malformed complete identities, artifact ids, costs, and lease tokens before RPC", async () => {
    await expect(completeExecutionAttempt(completeInput({ attemptId: "not-a-uuid" }))).rejects.toThrow(
      /attemptId must be a UUID/,
    );
    await expect(completeExecutionAttempt(completeInput({ leaseToken: "short" }))).rejects.toThrow(
      /Lease tokens must be 32 to 512 characters/,
    );
    await expect(
      completeExecutionAttempt(completeInput({ outputArtifactIds: ["not-a-uuid"] })),
    ).rejects.toThrow(/outputArtifactIds must contain UUIDs only/);
    await expect(
      completeExecutionAttempt(completeInput({ outputArtifactIds: [ATTEMPT_ID, ATTEMPT_ID] })),
    ).rejects.toThrow(/must not contain duplicates/);
    await expect(completeExecutionAttempt(completeInput({ humanMinutes: -1 }))).rejects.toThrow(
      /humanMinutes must be finite and non-negative/,
    );
    await expect(completeExecutionAttempt(completeInput({ aiCostMicros: Number.NaN }))).rejects.toThrow(
      /aiCostMicros must be finite and non-negative/,
    );
    await expect(
      completeExecutionAttempt(completeInput({ toolCostMicros: Number.POSITIVE_INFINITY })),
    ).rejects.toThrow(/toolCostMicros must be finite and non-negative/);
  });

  it("rejects complete metadata that is not a JSON object, is oversized, or is not serializable", async () => {
    await expect(
      completeExecutionAttempt(completeInput({ metadata: ["array"] as never })),
    ).rejects.toThrow(/metadata must be a JSON object/);
    await expect(
      completeExecutionAttempt(completeInput({ metadata: { blob: "x".repeat(64_001) } })),
    ).rejects.toThrow(/metadata must be at most 64 KB/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(completeExecutionAttempt(completeInput({ metadata: cyclic }))).rejects.toThrow(
      /metadata must be JSON serializable/,
    );
  });

  it("rejects secret-bearing and unredacted economics metadata on complete and fail", async () => {
    await expect(
      completeExecutionAttempt(
        completeInput({ metadata: { nested: { authorization: "Bearer leaked" } } }),
      ),
    ).rejects.toThrow(/cannot contain secret-bearing field metadata.nested.authorization/);
    await expect(
      completeExecutionAttempt(completeInput({ metadata: { api_key: "sk-test" } })),
    ).rejects.toThrow(/secret-bearing field/);
    await expect(
      failExecutionAttempt(failInput({ metadata: { prompt: "raw model prompt" } })),
    ).rejects.toThrow(/Telemetry cannot contain metadata.prompt/);
  });

  it("rejects failure summaries, codes, and lease bounds before RPC", async () => {
    await expect(failExecutionAttempt(failInput({ failureSummary: "   " }))).rejects.toThrow(
      /failureSummary is required/,
    );
    await expect(failExecutionAttempt(failInput({ failureSummary: "x".repeat(2001) }))).rejects.toThrow(
      /failureSummary must be at most 2000 characters/,
    );
    await expect(failExecutionAttempt(failInput({ failureCode: "bad code" }))).rejects.toThrow(
      /failureCode is not a valid bounded identifier/,
    );
    await expect(
      heartbeatExecutionAttempt({
        attemptId: ATTEMPT_ID,
        workerId: WORKER_ID,
        leaseToken: LEASE_TOKEN,
        leaseSeconds: 10,
      }),
    ).rejects.toThrow(/Lease duration must be an integer from 30 through 3600 seconds/);
    await expect(
      claimExecutionStep({
        workerId: WORKER_ID,
        capabilityKey: "evidence_research",
        leaseToken: "too-short",
      }),
    ).rejects.toThrow(/Lease tokens must be 32 to 512 characters/);
  });

  it("rejects out-of-range lease reap limits and oversized approval notes before RPC", async () => {
    await expect(reapExecutionLeases(0)).rejects.toThrow(/Reap limit must be an integer from 1 through 1000/);
    await expect(reapExecutionLeases(1001)).rejects.toThrow(/Reap limit must be an integer from 1 through 1000/);
    await expect(reapExecutionLeases(1.5)).rejects.toThrow(/Reap limit must be an integer from 1 through 1000/);
    await expect(
      decideExecutionApproval(persistentManager, "not-a-uuid", "approved"),
    ).rejects.toThrow(/approvalId must be a UUID/);
    await expect(
      decideExecutionApproval(persistentManager, ATTEMPT_ID, "rejected", "x".repeat(2001)),
    ).rejects.toThrow(/decisionNote must be at most 2000 characters/);
  });

  it("does not reach a missing service-role client when pre-RPC validation fails", async () => {
    await expect(completeExecutionAttempt(completeInput({ metadata: { token: "secret" } }))).rejects.toThrow(
      /secret-bearing field/,
    );
    await expect(completeExecutionAttempt(completeInput({ metadata: { token: "secret" } }))).rejects.not.toThrow(
      /service-role client/,
    );
  });
});
