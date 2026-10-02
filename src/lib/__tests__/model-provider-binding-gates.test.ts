import { describe, expect, it } from "vitest";
import {
  inferenceRequestSchema,
  inferenceResultSchema,
  type InferenceRequest,
  type InferenceResult,
  type ModelConfiguration,
  validateInferenceResult,
} from "@/lib/model-provider";

const HASH = "d".repeat(64);

function configuration(overrides: Partial<ModelConfiguration> = {}): ModelConfiguration {
  return {
    schemaVersion: "model-provider/v1",
    configurationKey: "openrouter-grok-free-v1",
    providerKey: "openrouter",
    providerVersion: "openrouter-adapter-v1",
    modelId: "x-ai/grok-4.1-fast",
    protocolVersion: "model-provider/v1",
    dataPolicy: "public",
    maxOutputTokens: 1000,
    configHash: HASH,
    ...overrides,
  };
}

function request(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    schemaVersion: "model-provider/v1",
    requestId: "request-001",
    capabilityKey: "evidence_research",
    modelConfiguration: configuration(),
    inputArtifactRefs: [],
    dataPolicy: "public",
    fallbackPolicy: {
      mode: "fail_closed",
      maxAttempts: 1,
      requiresHumanApproval: false,
    },
    requestedAt: "2026-08-25T20:00:00Z",
    ...overrides,
  };
}

function result(overrides: Partial<InferenceResult> = {}): InferenceResult {
  return {
    schemaVersion: "model-provider/v1",
    requestId: "request-001",
    providerKey: "openrouter",
    providerVersion: "openrouter-adapter-v1",
    configurationKey: "openrouter-grok-free-v1",
    protocolVersion: "model-provider/v1",
    modelId: "x-ai/grok-4.1-fast",
    configHash: HASH,
    status: "completed",
    outputArtifactRef: {
      artifactId: "output-001",
      schemaVersion: "model-output/v1",
      contentHash: HASH,
    },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    cost: { currency: "USD", aiCostMicros: 250, toolCostMicros: 10, totalCostMicros: 260 },
    latency: { latencyMs: 1200, queueMs: 100 },
    dataPolicy: "public",
    startedAt: "2026-08-25T20:00:01Z",
    completedAt: "2026-08-25T20:00:15Z",
    failureCode: null,
    ...overrides,
  };
}

function failuresOf(resultInput: unknown, requestInput: unknown = request()): string {
  const check = validateInferenceResult(resultInput, requestInput);
  return check.ok ? "" : check.failures.join(" ");
}

describe("validateInferenceResult binds the result to the exact request", () => {
  it("rejects a result that names a different request, version, model, or config hash", () => {
    expect(failuresOf(result({ requestId: "request-other" }))).toContain("requestId");
    expect(failuresOf(result({ providerVersion: "openrouter-adapter-v2" }))).toContain("providerVersion");
    expect(failuresOf(result({ protocolVersion: "model-provider/v0" }))).toContain("protocolVersion");
    expect(failuresOf(result({ modelId: "other-model" }))).toContain("modelId");
    expect(failuresOf(result({ configHash: "e".repeat(64) }))).toContain("configHash");
  });

  it("rejects a result that started before the request was issued", () => {
    expect(failuresOf(result({ startedAt: "2026-08-25T19:59:59Z" }))).toContain("startedAt");
  });

  it("rejects extra keys on the request or the result instead of ignoring them", () => {
    expect(inferenceRequestSchema.safeParse({ ...request(), winner: "hermes" }).success).toBe(false);
    expect(inferenceResultSchema.safeParse({ ...result(), recommendedExecutorKey: "hermes" }).success).toBe(false);
    expect(failuresOf({ ...result(), extra: true }, request())).toMatch(/Result /);
  });

  it("rejects a request whose data policy does not match its model configuration", () => {
    const parsed = inferenceRequestSchema.safeParse({
      ...request(),
      dataPolicy: "approved_private",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      "must match the selected model configuration",
    );
  });
});

describe("inference status cannot carry the other status's payload", () => {
  it("rejects a completed result that is missing completedAt or carries a failure code", () => {
    expect(inferenceResultSchema.safeParse(result({ completedAt: null })).success).toBe(false);
    expect(inferenceResultSchema.safeParse(result({ failureCode: "timeout" })).success).toBe(false);
  });

  it("rejects a completedAt that precedes startedAt", () => {
    const parsed = inferenceResultSchema.safeParse(
      result({ startedAt: "2026-08-25T20:00:15Z", completedAt: "2026-08-25T20:00:01Z" }),
    );
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      "completedAt must not precede startedAt",
    );
  });

  it("rejects a failed or blocked result that still carries an output artifact", () => {
    const failed = inferenceResultSchema.safeParse(
      result({ status: "failed", failureCode: "provider_error", outputArtifactRef: result().outputArtifactRef }),
    );
    expect(failed.success).toBe(false);

    const blocked = inferenceResultSchema.safeParse(
      result({ status: "blocked", failureCode: "policy_block", outputArtifactRef: result().outputArtifactRef }),
    );
    expect(blocked.success).toBe(false);
  });
});
