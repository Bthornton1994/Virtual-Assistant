import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { identifierString } from "@/lib/catalog-evidence-shared";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import {
  authorizeToolClass,
  toolInvocationSchema,
  validateExecutionContext,
  validateToolInvocationTrace,
  type ExecutionContext,
  type ExecutionContextValidationResult,
  type ToolInvocation,
} from "@/lib/execution-context";

export const TOOL_INVOCATION_TRACE_SCHEMA_VERSION = "tool-invocation-trace/v1" as const;

export const PRODUCTION_CLASSES = [
  "operator_submitted",
  "native_tool_execution",
  "leased_executor_execution",
  "deterministic_validation_no_tools",
] as const;
export type ProductionClass = (typeof PRODUCTION_CLASSES)[number];

export const TRACE_OUTCOME_RESULTS = [
  "fetched",
  "fetch_failed",
  "blocked_preflight",
  "not_applicable",
] as const;
export type TraceOutcomeResult = (typeof TRACE_OUTCOME_RESULTS)[number];

export const EXTERNAL_AGENT_TOOL_USE = ["unknown", "not_applicable"] as const;
export type ExternalAgentToolUse = (typeof EXTERNAL_AGENT_TOOL_USE)[number];

const FORBIDDEN_VALIDATION_TOOL_CLASSES = new Set([
  "public_read",
  "external_message_draft",
  "external_message_send",
  "sensitive_action",
  "credential_use",
]);

export const traceOutcomeSchema = z
  .object({
    invocationId: identifierString,
    result: z.enum(TRACE_OUTCOME_RESULTS),
  })
  .strict();

export type TraceOutcome = z.infer<typeof traceOutcomeSchema>;

export const toolInvocationTraceSchema = z
  .object({
    schemaVersion: z.literal(TOOL_INVOCATION_TRACE_SCHEMA_VERSION),
    productionClass: z.enum(PRODUCTION_CLASSES),
    assignmentId: identifierString,
    envelopeHash: sha256HexSchema,
    contextHash: sha256HexSchema,
    dcExecutedTools: z.boolean(),
    externalAgentToolUse: z.enum(EXTERNAL_AGENT_TOOL_USE),
    invocations: z.array(toolInvocationSchema),
    outcomes: z.array(traceOutcomeSchema),
  })
  .strict();

export type ToolInvocationTrace = z.infer<typeof toolInvocationTraceSchema>;

export type ObservationPointers = {
  assignmentId: string;
  envelopeHash: string;
  contextHash: string;
  traceContentHash: string;
};

function issueMessages(issues: readonly z.ZodIssue[], prefix: string): string[] {
  return issues.map((issue) => prefix + issue.path.join(".") + ": " + issue.message);
}

function hasWorkerLeaseToken(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return ["workerId", "leaseToken", "leaseTokenHash", "tokenHash"].some((key) => key in value);
}

export function hashToolInvocationTrace(trace: ToolInvocationTrace): string {
  return sha256Hex(trace);
}

export function emptyObservationTrace(input: {
  productionClass: Extract<ProductionClass, "operator_submitted" | "deterministic_validation_no_tools">;
  assignmentId: string;
  envelopeHash: string;
  contextHash: string;
}): ToolInvocationTrace {
  return {
    schemaVersion: TOOL_INVOCATION_TRACE_SCHEMA_VERSION,
    productionClass: input.productionClass,
    assignmentId: input.assignmentId,
    envelopeHash: input.envelopeHash,
    contextHash: input.contextHash,
    dcExecutedTools: false,
    externalAgentToolUse: input.productionClass === "operator_submitted" ? "unknown" : "not_applicable",
    invocations: [],
    outcomes: [],
  };
}

export function validateToolInvocationTraceArtifact(
  input: unknown,
  contextInput: unknown,
  expected: {
    productionClass: ProductionClass;
    assignmentId: string;
    envelopeHash: string;
    contextHash: string;
  },
): ExecutionContextValidationResult<ToolInvocationTrace> {
  const context = validateExecutionContext(contextInput);
  if (!context.ok) return context;

  const parsed = toolInvocationTraceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, failures: issueMessages(parsed.error.issues, "Observation ") };
  }

  const trace = parsed.data;
  const failures: string[] = [];
  if (trace.productionClass !== expected.productionClass) {
    failures.push("Observation productionClass does not match the gated path.");
  }
  if (trace.assignmentId !== expected.assignmentId) {
    failures.push("Observation assignmentId does not match the frozen assignment identity.");
  }
  if (trace.envelopeHash !== expected.envelopeHash) {
    failures.push("Observation envelopeHash does not match the frozen envelope.");
  }
  if (trace.contextHash !== expected.contextHash || trace.contextHash !== context.value.contextHash) {
    failures.push("Observation contextHash does not match the frozen execution context.");
  }
  if (hasWorkerLeaseToken(trace)) {
    failures.push("Observation traces must not invent worker, lease, or token fields.");
  }

  const invocationCheck = validateToolInvocationTrace(trace.invocations, context.value);
  if (!invocationCheck.ok) failures.push(...invocationCheck.failures);

  const invocationIds = new Set(trace.invocations.map((invocation) => invocation.invocationId));
  if (invocationIds.size !== trace.invocations.length) {
    failures.push("Observation invocations must have unique invocationId values.");
  }
  if (trace.outcomes.length !== trace.invocations.length) {
    failures.push("Observation outcomes must contain exactly one row per invocation.");
  }
  const outcomeIds = new Set<string>();
  for (const outcome of trace.outcomes) {
    if (outcomeIds.has(outcome.invocationId)) {
      failures.push("Observation outcomes must have unique invocationId values.");
    }
    outcomeIds.add(outcome.invocationId);
    if (!invocationIds.has(outcome.invocationId)) {
      failures.push("Observation outcome invocationId is not present in invocations.");
    }
  }

  if (
    trace.productionClass === "operator_submitted" ||
    trace.productionClass === "deterministic_validation_no_tools"
  ) {
    if (trace.invocations.length > 0) {
      failures.push("This production class requires an explicit empty observation trace.");
    }
    if (trace.dcExecutedTools) {
      failures.push("This production class cannot claim Delegation Cloud executed tools.");
    }
  }

  if (trace.productionClass === "operator_submitted" && trace.externalAgentToolUse !== "unknown") {
    failures.push("operator_submitted traces must record externalAgentToolUse as unknown.");
  }
  if (
    trace.productionClass === "deterministic_validation_no_tools" &&
    trace.externalAgentToolUse !== "not_applicable"
  ) {
    failures.push("deterministic_validation_no_tools traces must record externalAgentToolUse as not_applicable.");
  }

  if (trace.productionClass === "deterministic_validation_no_tools") {
    for (const invocation of trace.invocations) {
      if (FORBIDDEN_VALIDATION_TOOL_CLASSES.has(invocation.toolClass)) {
        failures.push(
          "Deterministic validation cannot record a " + invocation.toolClass + " tool invocation.",
        );
      }
    }
  }

  const allowedCount = trace.invocations.filter((invocation) => invocation.status === "allowed").length;
  if (trace.dcExecutedTools !== allowedCount > 0) {
    failures.push("dcExecutedTools must be true only when Delegation Cloud recorded an allowed invocation.");
  }

  for (const invocation of trace.invocations) {
    const outcome = trace.outcomes.find((item) => item.invocationId === invocation.invocationId);
    if (!outcome) continue;
    if (invocation.status === "blocked") {
      if (outcome.result !== "blocked_preflight") {
        failures.push("A blocked invocation must use outcome blocked_preflight.");
      }
      if (invocation.failureCode !== "tool_class_not_authorized") {
        failures.push("A blocked invocation must use failureCode tool_class_not_authorized.");
      }
    }
    if (invocation.status === "allowed" && (outcome.result === "blocked_preflight" || outcome.result === "not_applicable")) {
      failures.push("An allowed invocation cannot use a blocked or not_applicable outcome.");
    }
    if (outcome.result === "fetch_failed" && invocation.status !== "allowed") {
      failures.push("fetch_failed is an allowed invocation outcome, not an authorization failure.");
    }
  }

  return failures.length > 0 ? { ok: false, failures } : { ok: true, value: trace };
}

export function observationPointersFor(trace: ToolInvocationTrace): ObservationPointers {
  return {
    assignmentId: trace.assignmentId,
    envelopeHash: trace.envelopeHash,
    contextHash: trace.contextHash,
    traceContentHash: hashToolInvocationTrace(trace),
  };
}

export function requireObservationPointers(
  metadata: Record<string, unknown>,
): ExecutionContextValidationResult<ObservationPointers> {
  const assignmentId = metadata.assignmentId;
  const envelopeHash = metadata.envelopeHash;
  const contextHash = metadata.contextHash;
  const traceContentHash = metadata.traceContentHash;
  if (
    typeof assignmentId !== "string" ||
    typeof envelopeHash !== "string" ||
    typeof contextHash !== "string" ||
    typeof traceContentHash !== "string"
  ) {
    return {
      ok: false,
      failures: ["Missing observation trace is not an empty trace. Phase persistence requires a bound observation."],
    };
  }
  const parsed = z
    .object({
      assignmentId: identifierString,
      envelopeHash: sha256HexSchema,
      contextHash: sha256HexSchema,
      traceContentHash: sha256HexSchema,
    })
    .safeParse({ assignmentId, envelopeHash, contextHash, traceContentHash });
  if (!parsed.success) {
    return { ok: false, failures: issueMessages(parsed.error.issues, "Observation pointers ") };
  }
  return { ok: true, value: parsed.data };
}

export function recordNativePublicReadCycle(input: {
  context: ExecutionContext;
  invocationId: string;
  toolKey: string;
  invokedAt: string;
  completedAt: string;
  fetchResult: "fetched" | "fetch_failed" | "blocked_preflight";
}): ExecutionContextValidationResult<{ invocation: ToolInvocation; outcome: TraceOutcome }> {
  const preflight = authorizeToolClass(input.context, "public_read");
  if (!preflight.ok) {
    if (input.fetchResult !== "blocked_preflight") {
      return { ok: false, failures: preflight.failures };
    }
    const blocked = toolInvocationSchema.safeParse({
      schemaVersion: input.context.schemaVersion,
      invocationId: input.invocationId,
      contextHash: input.context.contextHash,
      toolClass: "public_read",
      toolKey: input.toolKey,
      status: "blocked",
      invokedAt: input.invokedAt,
      completedAt: input.completedAt,
      failureCode: "tool_class_not_authorized",
    });
    if (!blocked.success) {
      return { ok: false, failures: issueMessages(blocked.error.issues, "Invocation ") };
    }
    return {
      ok: true,
      value: {
        invocation: blocked.data,
        outcome: { invocationId: input.invocationId, result: "blocked_preflight" },
      },
    };
  }

  if (input.fetchResult === "blocked_preflight") {
    return { ok: false, failures: ["An authorized public_read cannot be recorded as blocked_preflight."] };
  }

  const allowed = toolInvocationSchema.safeParse({
    schemaVersion: input.context.schemaVersion,
    invocationId: input.invocationId,
    contextHash: input.context.contextHash,
    toolClass: "public_read",
    toolKey: input.toolKey,
    status: "allowed",
    invokedAt: input.invokedAt,
    completedAt: input.completedAt,
    failureCode: null,
  });
  if (!allowed.success) {
    return { ok: false, failures: issueMessages(allowed.error.issues, "Invocation ") };
  }
  return {
    ok: true,
    value: {
      invocation: allowed.data,
      outcome: { invocationId: input.invocationId, result: input.fetchResult },
    },
  };
}

export function buildNativeToolTrace(input: {
  assignmentId: string;
  envelopeHash: string;
  contextHash: string;
  invocations: ToolInvocation[];
  outcomes: TraceOutcome[];
}): ToolInvocationTrace {
  return {
    schemaVersion: TOOL_INVOCATION_TRACE_SCHEMA_VERSION,
    productionClass: "native_tool_execution",
    assignmentId: input.assignmentId,
    envelopeHash: input.envelopeHash,
    contextHash: input.contextHash,
    dcExecutedTools: input.invocations.some((invocation) => invocation.status === "allowed"),
    externalAgentToolUse: "not_applicable",
    invocations: input.invocations,
    outcomes: input.outcomes,
  };
}
