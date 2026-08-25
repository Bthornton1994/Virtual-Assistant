import { z } from "zod";
import { artifactReferenceSchema } from "@/lib/executor-envelope";
import {
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
} from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";

export const MODEL_PROVIDER_SCHEMA_VERSION = "model-provider/v1" as const;

export const MODEL_REQUEST_STATUSES = ["completed", "failed", "blocked"] as const;
export const MODEL_PROVIDER_HEALTH = [
  "healthy",
  "degraded",
  "unavailable",
  "auth_expired",
  "rate_limited",
  "unknown",
] as const;
export const MODEL_DATA_POLICIES = ["public", "approved_private", "restricted"] as const;
export const MODEL_FALLBACK_MODES = [
  "none",
  "same_provider_different_model",
  "alternate_provider",
  "escalate_human",
  "fail_closed",
] as const;

const nonNegativeInteger = z.number().int().min(0);
const positiveInteger = z.number().int().min(1);
const nonNegativeFinite = z.number().finite().min(0);

export const modelConfigurationSchema = z
  .object({
    schemaVersion: z.literal(MODEL_PROVIDER_SCHEMA_VERSION),
    configurationKey: identifierString,
    providerKey: identifierString,
    providerVersion: identifierString,
    modelId: identifierString,
    protocolVersion: identifierString,
    dataPolicy: z.enum(MODEL_DATA_POLICIES),
    maxOutputTokens: positiveInteger,
    configHash: sha256HexSchema.nullable(),
  })
  .strict();

export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>;

export const modelFallbackPolicySchema = z
  .object({
    mode: z.enum(MODEL_FALLBACK_MODES),
    maxAttempts: positiveInteger.max(3),
    requiresHumanApproval: z.boolean(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.mode === "none" && policy.maxAttempts !== 1) {
      context.addIssue({
        code: "custom",
        path: ["maxAttempts"],
        message: "A no-fallback policy must allow exactly one attempt.",
      });
    }
  });

export type ModelFallbackPolicy = z.infer<typeof modelFallbackPolicySchema>;

export const inferenceRequestSchema = z
  .object({
    schemaVersion: z.literal(MODEL_PROVIDER_SCHEMA_VERSION),
    requestId: identifierString,
    capabilityKey: identifierString,
    modelConfiguration: modelConfigurationSchema,
    inputArtifactRefs: z.array(artifactReferenceSchema),
    dataPolicy: z.enum(MODEL_DATA_POLICIES),
    fallbackPolicy: modelFallbackPolicySchema,
    requestedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.dataPolicy !== request.modelConfiguration.dataPolicy) {
      context.addIssue({
        code: "custom",
        path: ["dataPolicy"],
        message: "Request dataPolicy must match the selected model configuration.",
      });
    }
  });

export type InferenceRequest = z.infer<typeof inferenceRequestSchema>;

export const modelUsageSchema = z
  .object({
    inputTokens: nonNegativeInteger,
    outputTokens: nonNegativeInteger,
    totalTokens: nonNegativeInteger,
  })
  .strict()
  .superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({
        code: "custom",
        path: ["totalTokens"],
        message: "totalTokens must equal inputTokens plus outputTokens.",
      });
    }
  });

export type ModelUsage = z.infer<typeof modelUsageSchema>;

export const modelCostSchema = z
  .object({
    currency: z.literal("USD"),
    aiCostMicros: nonNegativeInteger,
    toolCostMicros: nonNegativeInteger,
    totalCostMicros: nonNegativeInteger,
  })
  .strict()
  .superRefine((cost, context) => {
    if (cost.totalCostMicros !== cost.aiCostMicros + cost.toolCostMicros) {
      context.addIssue({
        code: "custom",
        path: ["totalCostMicros"],
        message: "totalCostMicros must equal AI cost plus tool cost.",
      });
    }
  });

export type ModelCost = z.infer<typeof modelCostSchema>;

export const modelLatencySchema = z
  .object({
    latencyMs: nonNegativeFinite,
    queueMs: nonNegativeFinite,
  })
  .strict();

export type ModelLatency = z.infer<typeof modelLatencySchema>;

export const inferenceResultSchema = z
  .object({
    schemaVersion: z.literal(MODEL_PROVIDER_SCHEMA_VERSION),
    requestId: identifierString,
    providerKey: identifierString,
    providerVersion: identifierString,
    configurationKey: identifierString,
    protocolVersion: identifierString,
    modelId: identifierString,
    configHash: sha256HexSchema.nullable(),
    status: z.enum(MODEL_REQUEST_STATUSES),
    outputArtifactRef: artifactReferenceSchema.nullable(),
    usage: modelUsageSchema,
    cost: modelCostSchema,
    latency: modelLatencySchema,
    dataPolicy: z.enum(MODEL_DATA_POLICIES),
    startedAt: isoDateTimeSchema,
    completedAt: isoDateTimeSchema.nullable(),
    failureCode: identifierString.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "completed") {
      if (!result.outputArtifactRef) {
        context.addIssue({
          code: "custom",
          path: ["outputArtifactRef"],
          message: "Completed inference must include an output artifact.",
        });
      }
      if (!result.completedAt) {
        context.addIssue({
          code: "custom",
          path: ["completedAt"],
          message: "Completed inference must include completedAt.",
        });
      }
      if (result.failureCode !== null) {
        context.addIssue({
          code: "custom",
          path: ["failureCode"],
          message: "Completed inference cannot include a failureCode.",
        });
      }
    } else {
      if (result.outputArtifactRef !== null) {
        context.addIssue({
          code: "custom",
          path: ["outputArtifactRef"],
          message: "Failed or blocked inference cannot include an output artifact.",
        });
      }
      if (result.failureCode === null) {
        context.addIssue({
          code: "custom",
          path: ["failureCode"],
          message: "Failed or blocked inference must include a failureCode.",
        });
      }
    }

    if (result.completedAt && Date.parse(result.completedAt) < Date.parse(result.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt must not precede startedAt.",
      });
    }
  });

export type InferenceResult = z.infer<typeof inferenceResultSchema>;

export const modelProviderHealthSchema = z
  .object({
    schemaVersion: z.literal(MODEL_PROVIDER_SCHEMA_VERSION),
    providerKey: identifierString,
    providerVersion: identifierString,
    health: z.enum(MODEL_PROVIDER_HEALTH),
    checkedAt: isoDateTimeSchema,
    message: nonEmptyString.nullable(),
  })
  .strict()
  .superRefine((health, context) => {
    if (health.health !== "healthy" && health.message === null) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "Non-healthy providers must explain their health state.",
      });
    }
  });

export type ModelProviderHealth = z.infer<typeof modelProviderHealthSchema>;

export interface ModelProvider {
  readonly providerKey: string;
  infer(request: InferenceRequest): Promise<InferenceResult>;
  health(): Promise<ModelProviderHealth>;
}

export type ModelProviderValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; failures: string[] };

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

/**
 * Validate a provider result against the exact request that produced it.
 *
 * This is deliberately a validator, not a router. It makes provider/model
 * identity, data policy, provenance, usage, cost, and latency auditable without
 * granting any provider authority over routing or lifecycle state.
 */
export function validateInferenceResult(
  resultInput: unknown,
  requestInput: unknown,
): ModelProviderValidationResult<InferenceResult> {
  const request = inferenceRequestSchema.safeParse(requestInput);
  const result = inferenceResultSchema.safeParse(resultInput);
  const failures: string[] = [];

  if (!request.success) failures.push(...issueMessages(request.error.issues, "Request "));
  if (!result.success) failures.push(...issueMessages(result.error.issues, "Result "));
  if (!request.success || !result.success) return { ok: false, failures };

  const requestData = request.data;
  const resultData = result.data;

  if (resultData.requestId !== requestData.requestId) {
    failures.push("Result requestId does not match request.");
  }
  if (resultData.providerKey !== requestData.modelConfiguration.providerKey) {
    failures.push("Result providerKey does not match request configuration.");
  }
  if (resultData.providerVersion !== requestData.modelConfiguration.providerVersion) {
    failures.push("Result providerVersion does not match request configuration.");
  }
  if (resultData.configurationKey !== requestData.modelConfiguration.configurationKey) {
    failures.push("Result configurationKey does not match request.");
  }
  if (resultData.protocolVersion !== requestData.modelConfiguration.protocolVersion) {
    failures.push("Result protocolVersion does not match request configuration.");
  }
  if (resultData.modelId !== requestData.modelConfiguration.modelId) {
    failures.push("Result modelId does not match request configuration.");
  }
  if (resultData.configHash !== requestData.modelConfiguration.configHash) {
    failures.push("Result configHash does not match request configuration.");
  }
  if (resultData.dataPolicy !== requestData.dataPolicy) {
    failures.push("Result dataPolicy does not match request.");
  }
  if (Date.parse(resultData.startedAt) < Date.parse(requestData.requestedAt)) {
    failures.push("Result startedAt precedes request requestedAt.");
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: resultData };
}
