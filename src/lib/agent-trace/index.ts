export {
  AGENT_TRACE_SCHEMA_VERSION,
  AGENT_TRACE_KINDS,
  AGENT_TRACE_STATUSES,
  emptyTraceMetrics,
  emptyProviderMeta,
  type AgentTraceKind,
  type AgentTraceStatus,
  type AgentTraceMetrics,
  type AgentTraceProviderMeta,
  type AgentTraceEvent,
  type AgentTraceSink,
} from "./types.ts";

export {
  MemoryTraceSink,
  setAgentTraceSink,
  getAgentTraceSink,
  emitAgentTrace,
  sanitizeTraceEvent,
} from "./sink.ts";

export { redactLabels, redactSecretLikeString, isSecretLikeKey, isSensitiveContentKey, isSafeTraceLabelKey, minimizeIdentifier, SAFE_TRACE_LABEL_KEYS } from "./redact.ts";

export { traceToolInvocationBoundary } from "./boundaries.ts";

