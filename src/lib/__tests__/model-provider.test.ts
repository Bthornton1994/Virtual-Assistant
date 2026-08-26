import { describe, expect, it } from "vitest";
import {
  MODEL_PROVIDER_SCHEMA_VERSION,
  inferenceRequestSchema,
  modelProviderHealthSchema,
  type InferenceRequest,
  type InferenceResult,
  type ModelConfiguration,
  validateInferenceResult,
} from "@/lib/model-provider";

const HASH = "f".repeat(64);

function configuration(overrides: Partial<ModelConfiguration> = {}): ModelConfiguration {
  return {
    schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
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
    schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
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
    schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
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
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    },
    cost: {
      currency: "USD",
      aiCostMicros: 250,
      toolCostMicros: 10,
      totalCostMicros: 260,
    },
    latency: {
      latencyMs: 1200,
      queueMs: 100,
    },
    dataPolicy: "public",
    startedAt: "2026-08-25T20:00:01Z",
    completedAt: "2026-08-25T20:00:15Z",
    failureCode: null,
    ...overrides,
  };
}

describe("model provider v1", () => {
  it("accepts a result with attributable provenance, usage, cost, and latency", () => {
    const check = validateInferenceResult(result(), request());
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.value.providerKey).toBe("openrouter");
      expect(check.value.modelId).toBe("x-ai/grok-4.1-fast");
      expect(check.value.usage.totalTokens).toBe(150);
      expect(check.value.cost.totalCostMicros).toBe(260);
      expect(check.value.latency.latencyMs).toBe(1200);
    }
  });

  it("rejects arithmetic drift and incomplete completed results", () => {
    const arithmetic = validateInferenceResult(
      { ...result(), usage: { inputTokens: 100, outputTokens: 50, totalTokens: 149 } },
      request(),
    );
    expect(arithmetic.ok).toBe(false);
    expect(arithmetic.ok ? [] : arithmetic.failures.join(" ")).toContain("totalTokens");

    const incomplete = validateInferenceResult(
      { ...result(), outputArtifactRef: null },
      request(),
    );
    expect(incomplete.ok).toBe(false);
    expect(incomplete.ok ? [] : incomplete.failures.join(" ")).toContain("output artifact");
  });

  it("rejects provider, configuration, and data-policy drift", () => {
    const check = validateInferenceResult(
      {
        ...result(),
        providerKey: "direct-provider",
        configurationKey: "direct-model-v1",
        dataPolicy: "approved_private",
      },
      request(),
    );
    expect(check.ok).toBe(false);
    const failures = check.ok ? [] : check.failures.join(" ");
    expect(failures).toContain("providerKey");
    expect(failures).toContain("configurationKey");
    expect(failures).toContain("dataPolicy");
  });

  it("requires a failure code and no output for failed or blocked results", () => {
    const check = validateInferenceResult(
      {
        ...result(),
        status: "failed",
        outputArtifactRef: null,
        failureCode: null,
      },
      request(),
    );
    expect(check.ok).toBe(false);
    expect(check.ok ? [] : check.failures.join(" ")).toContain("failureCode");
  });

  it("keeps fallback declarative and rejects an invalid no-fallback attempt count", () => {
    const parsed = inferenceRequestSchema.safeParse({
      ...request(),
      fallbackPolicy: {
        mode: "none",
        maxAttempts: 2,
        requiresHumanApproval: false,
      },
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      "exactly one attempt",
    );
  });

  it("requires an explanation for degraded provider health", () => {
    const parsed = modelProviderHealthSchema.safeParse({
      schemaVersion: MODEL_PROVIDER_SCHEMA_VERSION,
      providerKey: "openrouter",
      providerVersion: "openrouter-adapter-v1",
      health: "degraded",
      checkedAt: "2026-08-25T20:00:00Z",
      message: null,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join(" ")).toContain(
      "explain",
    );
  });
});
