/**
 * Provider-neutral execution tracing contract for Delegation Cloud agent reliability.
 *
 * This is a repository-owned observability contract and in-memory/test sink.
 * It does not claim OpenTelemetry compatibility, does not persist to a database,
 * and does not store raw prompts, chain-of-thought, or credentials.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { ACTION_CLASSES, ROLES, type ActionClass, type Role } from "./domain.ts";
import { identifierString, isoDateTimeSchema } from "./catalog-evidence-shared.ts";
import { sha256Hex } from "./catalog-evidence-hash.ts";

export const AGENT_RELIABILITY_TRACE_SCHEMA_VERSION = "agent-reliability-trace/v1" as const;
export const AGENT_RELIABILITY_TRACE_POLICY_VERSION = "agent-reliability-trace-policy/v1" as const;

export const TRACE_EVENT_KINDS = [
  "request",
  "run",
  "execution_step",
  "capability_invocation",
  "evidence_read",
  "approval",
  "verification",
  "delivery_or_terminal",
] as const;
export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number];

export const TRACE_STATUSES = ["started", "ok", "error", "blocked", "unknown"] as const;
export type TraceStatus = (typeof TRACE_STATUSES)[number];

export const TRACE_POLICY_DECISIONS = ["allow", "deny", "require_approval", "unknown"] as const;
export type TracePolicyDecision = (typeof TRACE_POLICY_DECISIONS)[number];

export const TRACE_APPROVAL_STATES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
  "missing",
  "unknown",
] as const;
export type TraceApprovalState = (typeof TRACE_APPROVAL_STATES)[number];

const SECRET_KEY_PATTERN =
  /(secret|password|token|api[_-]?key|private[_-]?key|authorization|cookie|credential|bearer)/i;

const SECRET_VALUE_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/i;

const REDACTED = "[REDACTED]";

const sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "must be a lowercase sha256 hex digest");

const optionalIdentifier = identifierString.nullable().optional();

export const traceProviderMetadataSchema = z
  .object({
    provider: z.string().min(1).max(64).nullable().optional(),
    model: z.string().min(1).max(128).nullable().optional(),
  })
  .strict();

export const traceMetricsSchema = z
  .object({
    tokens: z.number().int().nonnegative().nullable().optional(),
    costMicros: z.number().int().nonnegative().nullable().optional(),
    latencyMs: z.number().nonnegative().nullable().optional(),
    ttftMs: z.number().nonnegative().nullable().optional(),
    itlMs: z.number().nonnegative().nullable().optional(),
  })
  .strict();

export const agentReliabilityTraceEventSchema = z
  .object({
    schemaVersion: z.literal(AGENT_RELIABILITY_TRACE_SCHEMA_VERSION),
    eventId: identifierString,
    kind: z.enum(TRACE_EVENT_KINDS),
    traceId: identifierString,
    runId: optionalIdentifier,
    stepId: optionalIdentifier,
    capability: optionalIdentifier,
    actionClass: z.enum(ACTION_CLASSES).nullable().optional(),
    actorRole: z.enum(ROLES).nullable().optional(),
    /** Minimized organization identifier (sha256 hex). Never store raw org IDs in sinks by default. */
    organizationIdHash: sha256HexSchema.nullable().optional(),
    /** Minimized actor identifier (sha256 hex). */
    actorIdHash: sha256HexSchema.nullable().optional(),
    status: z.enum(TRACE_STATUSES),
    startedAt: isoDateTimeSchema.nullable().optional(),
    endedAt: isoDateTimeSchema.nullable().optional(),
    durationMs: z.number().nonnegative().nullable().optional(),
    errorCode: optionalIdentifier,
    policyDecision: z.enum(TRACE_POLICY_DECISIONS).nullable().optional(),
    approvalState: z.enum(TRACE_APPROVAL_STATES).nullable().optional(),
    evidenceHashes: z.array(sha256HexSchema).max(64).optional(),
    sourceHashes: z.array(sha256HexSchema).max(64).optional(),
    providerMetadata: traceProviderMetadataSchema.nullable().optional(),
    /** Only populate fields that were actually measured. Absent fields mean unmeasured, not zero. */
    metrics: traceMetricsSchema.nullable().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.startedAt && event.endedAt && Date.parse(event.endedAt) < Date.parse(event.startedAt)) {
      context.addIssue({
        code: "custom",
        path: ["endedAt"],
        message: "endedAt must not precede startedAt",
      });
    }
    if (
      event.durationMs != null &&
      event.startedAt &&
      event.endedAt &&
      Number.isFinite(Date.parse(event.endedAt) - Date.parse(event.startedAt))
    ) {
      const derived = Date.parse(event.endedAt) - Date.parse(event.startedAt);
      if (Math.abs(derived - event.durationMs) > 1) {
        context.addIssue({
          code: "custom",
          path: ["durationMs"],
          message: "durationMs must match startedAt/endedAt when both are present",
        });
      }
    }
  });

export type AgentReliabilityTraceEvent = z.infer<typeof agentReliabilityTraceEventSchema>;

export type TraceValidationResult =
  | { ok: true; value: AgentReliabilityTraceEvent }
  | { ok: false; failures: string[] };

export function hashTraceIdentifier(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function redactSecretLikeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value)) return REDACTED;
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecretLikeValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecretLikeValue(nested);
    }
    return out;
  }
  return value;
}

export function validateAgentReliabilityTraceEvent(input: unknown): TraceValidationResult {
  const redacted = redactSecretLikeValue(input);
  const parsed = agentReliabilityTraceEventSchema.safeParse(redacted);
  if (!parsed.success) {
    return {
      ok: false,
      failures: parsed.error.issues.map((issue) => `${issue.path.join(".") || "event"}: ${issue.message}`),
    };
  }
  return { ok: true, value: parsed.data };
}

export type TraceSink = {
  readonly name: string;
  emit(event: unknown): TraceValidationResult;
  list(): readonly AgentReliabilityTraceEvent[];
  clear(): void;
};

/**
 * In-memory sink for tests and local harness runs. Not durable. Not a production store.
 */
export function createInMemoryTraceSink(name = "in-memory"): TraceSink {
  const events: AgentReliabilityTraceEvent[] = [];
  return {
    name,
    emit(event) {
      const validated = validateAgentReliabilityTraceEvent(event);
      if (!validated.ok) return validated;
      events.push(validated.value);
      return validated;
    },
    list() {
      return events.slice();
    },
    clear() {
      events.length = 0;
    },
  };
}

export type StartTraceEventInput = {
  kind: TraceEventKind;
  traceId: string;
  eventId: string;
  runId?: string | null;
  stepId?: string | null;
  capability?: string | null;
  actionClass?: ActionClass | null;
  actorRole?: Role | null;
  organizationId?: string | null;
  actorId?: string | null;
  status?: TraceStatus;
  startedAt?: string;
  errorCode?: string | null;
  policyDecision?: TracePolicyDecision | null;
  approvalState?: TraceApprovalState | null;
  evidenceHashes?: string[];
  sourceHashes?: string[];
  providerMetadata?: { provider?: string | null; model?: string | null } | null;
  metrics?: {
    tokens?: number | null;
    costMicros?: number | null;
    latencyMs?: number | null;
    ttftMs?: number | null;
    itlMs?: number | null;
  } | null;
};

export function buildTraceEvent(input: StartTraceEventInput): AgentReliabilityTraceEvent {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const candidate = {
    schemaVersion: AGENT_RELIABILITY_TRACE_SCHEMA_VERSION,
    eventId: input.eventId,
    kind: input.kind,
    traceId: input.traceId,
    runId: input.runId ?? null,
    stepId: input.stepId ?? null,
    capability: input.capability ?? null,
    actionClass: input.actionClass ?? null,
    actorRole: input.actorRole ?? null,
    organizationIdHash: input.organizationId ? hashTraceIdentifier(input.organizationId) : null,
    actorIdHash: input.actorId ? hashTraceIdentifier(input.actorId) : null,
    status: input.status ?? "started",
    startedAt,
    endedAt: null,
    durationMs: null,
    errorCode: input.errorCode ?? null,
    policyDecision: input.policyDecision ?? null,
    approvalState: input.approvalState ?? null,
    evidenceHashes: input.evidenceHashes ?? [],
    sourceHashes: input.sourceHashes ?? [],
    providerMetadata: input.providerMetadata ?? null,
    metrics: input.metrics ?? null,
  };
  const validated = validateAgentReliabilityTraceEvent(candidate);
  if (!validated.ok) {
    throw new Error(`Invalid trace event: ${validated.failures.join("; ")}`);
  }
  return validated.value;
}

export function completeTraceEvent(
  event: AgentReliabilityTraceEvent,
  input: {
    status: Exclude<TraceStatus, "started">;
    endedAt?: string;
    errorCode?: string | null;
    policyDecision?: TracePolicyDecision | null;
    approvalState?: TraceApprovalState | null;
    metrics?: AgentReliabilityTraceEvent["metrics"];
  },
): AgentReliabilityTraceEvent {
  const endedAt = input.endedAt ?? new Date().toISOString();
  const startedMs = event.startedAt ? Date.parse(event.startedAt) : Number.NaN;
  const endedMs = Date.parse(endedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : null;

  const candidate: AgentReliabilityTraceEvent = {
    ...event,
    status: input.status,
    endedAt,
    durationMs,
    errorCode: input.errorCode ?? event.errorCode ?? null,
    policyDecision: input.policyDecision ?? event.policyDecision ?? null,
    approvalState: input.approvalState ?? event.approvalState ?? null,
    metrics: input.metrics ?? event.metrics ?? null,
  };
  const validated = validateAgentReliabilityTraceEvent(candidate);
  if (!validated.ok) {
    throw new Error(`Invalid completed trace event: ${validated.failures.join("; ")}`);
  }
  return validated.value;
}

export function hashTraceEvent(event: AgentReliabilityTraceEvent): string {
  return sha256Hex(event);
}

/** Stable boundary helpers for integrating at existing control-plane edges without a rewrite. */
export function emitBoundaryTrace(
  sink: TraceSink,
  input: StartTraceEventInput,
): TraceValidationResult {
  return sink.emit(buildTraceEvent(input));
}
