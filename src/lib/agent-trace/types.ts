/**
 * Provider-neutral agent tracing contract (agent-trace/v1).
 *
 * This is a Delegation Cloud-owned observability contract. It is not an
 * OpenTelemetry implementation and does not claim OTel compatibility.
 */

export const AGENT_TRACE_SCHEMA_VERSION = "agent-trace/v1" as const;

export const AGENT_TRACE_KINDS = [
  "request",
  "run",
  "execution_step",
  "capability_invocation",
  "evidence_read",
  "approval",
  "verification",
  "delivery",
  "terminal_outcome",
] as const;

export type AgentTraceKind = (typeof AGENT_TRACE_KINDS)[number];

export const AGENT_TRACE_STATUSES = ["started", "ok", "error", "blocked", "skipped"] as const;
export type AgentTraceStatus = (typeof AGENT_TRACE_STATUSES)[number];

export type AgentTraceMetrics = {
  /** Present only when a caller supplied the value. Never invented. */
  tokensIn: number | null;
  tokensOut: number | null;
  costMicros: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  itlMs: number | null;
};

export type AgentTraceProviderMeta = {
  provider: string | null;
  modelId: string | null;
  protocolVersion: string | null;
};

export type AgentTraceEvent = {
  schemaVersion: typeof AGENT_TRACE_SCHEMA_VERSION;
  traceId: string;
  eventId: string;
  kind: AgentTraceKind;
  runId: string | null;
  stepId: string | null;
  organizationIdHash: string | null;
  actorIdHash: string | null;
  actorRole: string | null;
  capability: string | null;
  actionClass: string | null;
  status: AgentTraceStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  policyDecision: string | null;
  approvalState: string | null;
  evidenceHashes: string[];
  sourceHashes: string[];
  providerMeta: AgentTraceProviderMeta;
  metrics: AgentTraceMetrics;
  /** Short, non-sensitive labels only. Never prompts or chain-of-thought. */
  labels: Record<string, string>;
};

export type AgentTraceSink = {
  record(event: AgentTraceEvent): void;
  list(): readonly AgentTraceEvent[];
  clear(): void;
};

export function emptyTraceMetrics(): AgentTraceMetrics {
  return {
    tokensIn: null,
    tokensOut: null,
    costMicros: null,
    latencyMs: null,
    ttftMs: null,
    itlMs: null,
  };
}

export function emptyProviderMeta(): AgentTraceProviderMeta {
  return {
    provider: null,
    modelId: null,
    protocolVersion: null,
  };
}
