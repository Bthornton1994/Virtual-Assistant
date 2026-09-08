import { redactLabels } from "./redact.ts";
import type { AgentTraceEvent, AgentTraceSink } from "./types.ts";
import { AGENT_TRACE_SCHEMA_VERSION } from "./types.ts";

/**
 * In-memory / test sink. Default production behavior is no persistence:
 * a null active sink means emit is a no-op.
 */
export class MemoryTraceSink implements AgentTraceSink {
  private events: AgentTraceEvent[] = [];

  record(event: AgentTraceEvent): void {
    this.events.push(sanitizeTraceEvent(event));
  }

  list(): readonly AgentTraceEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }
}

let activeSink: AgentTraceSink | null = null;

export function setAgentTraceSink(sink: AgentTraceSink | null): void {
  activeSink = sink;
}

export function getAgentTraceSink(): AgentTraceSink | null {
  return activeSink;
}

export function sanitizeTraceEvent(event: AgentTraceEvent): AgentTraceEvent {
  return {
    ...event,
    schemaVersion: AGENT_TRACE_SCHEMA_VERSION,
    labels: redactLabels(event.labels),
    // Never allow prompt / CoT keys to sneak in via labels after redact.
    evidenceHashes: [...event.evidenceHashes],
    sourceHashes: [...event.sourceHashes],
    providerMeta: { ...event.providerMeta },
    metrics: { ...event.metrics },
  };
}

/**
 * Emit a trace event to the active sink, if any.
 * Safe no-op when no sink is configured. Does not write to a database.
 */
export function emitAgentTrace(event: AgentTraceEvent): void {
  activeSink?.record(event);
}
