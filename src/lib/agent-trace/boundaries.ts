import { emitAgentTrace, emptyProviderMeta, emptyTraceMetrics } from "./index.ts";
import type { AgentTraceStatus } from "./index.ts";

/**
 * Optional observability hook for the execution-context tool-invocation boundary.
 * Records a capability_invocation span only when an agent-trace sink is active.
 * Never persists prompts, credentials, or chain-of-thought.
 */
export function traceToolInvocationBoundary(input: {
  traceId: string;
  runId: string | null;
  stepId: string | null;
  organizationIdHash: string | null;
  actorIdHash: string | null;
  actorRole: string | null;
  capability: string | null;
  actionClass: string | null;
  toolClass: string;
  toolKey: string;
  allowed: boolean;
  failureCode: string | null;
  contextHash: string;
  startedAt: string;
  endedAt: string;
}): void {
  const status: AgentTraceStatus = input.allowed ? "ok" : "blocked";
  const started = Date.parse(input.startedAt);
  const ended = Date.parse(input.endedAt);
  const durationMs =
    Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null;

  emitAgentTrace({
    schemaVersion: "agent-trace/v1",
    traceId: input.traceId,
    eventId: `tool-${input.toolKey}-${input.startedAt}`,
    kind: "capability_invocation",
    runId: input.runId,
    stepId: input.stepId,
    organizationIdHash: input.organizationIdHash,
    actorIdHash: input.actorIdHash,
    actorRole: input.actorRole,
    capability: input.capability,
    actionClass: input.actionClass,
    status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs,
    errorCode: input.failureCode,
    policyDecision: input.allowed ? "tool_class_authorized" : "tool_class_not_authorized",
    approvalState: null,
    evidenceHashes: [],
    sourceHashes: [input.contextHash],
    providerMeta: emptyProviderMeta(),
    metrics: emptyTraceMetrics(),
    labels: {
      toolClass: input.toolClass,
      toolKey: input.toolKey,
    },
  });
}
