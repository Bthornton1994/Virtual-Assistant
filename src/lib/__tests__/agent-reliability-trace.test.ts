import { describe, expect, it } from "vitest";
import {
  AGENT_RELIABILITY_TRACE_SCHEMA_VERSION,
  buildTraceEvent,
  completeTraceEvent,
  createInMemoryTraceSink,
  emitBoundaryTrace,
  hashTraceIdentifier,
  redactSecretLikeValue,
  validateAgentReliabilityTraceEvent,
} from "@/lib/agent-reliability-trace";

describe("agent reliability trace contract", () => {
  it("builds and validates a minimized boundary event", () => {
    const event = buildTraceEvent({
      kind: "capability_invocation",
      traceId: "trace-1",
      eventId: "event-1",
      runId: "run-1",
      stepId: "step-1",
      capability: "software_change_prepare",
      actionClass: "prepare_only",
      actorRole: "operator",
      organizationId: "org-secret-name",
      actorId: "actor-secret-name",
      status: "started",
      startedAt: "2026-09-08T16:00:00.000Z",
      policyDecision: "allow",
      approvalState: "not_required",
      evidenceHashes: ["a".repeat(64)],
    });

    expect(event.schemaVersion).toBe(AGENT_RELIABILITY_TRACE_SCHEMA_VERSION);
    expect(event.organizationIdHash).toBe(hashTraceIdentifier("org-secret-name"));
    expect(event.actorIdHash).toBe(hashTraceIdentifier("actor-secret-name"));
    expect(event).not.toHaveProperty("organizationId");
    expect(JSON.stringify(event)).not.toContain("org-secret-name");
  });

  it("completes an event with duration", () => {
    const started = buildTraceEvent({
      kind: "verification",
      traceId: "trace-2",
      eventId: "event-2",
      startedAt: "2026-09-08T16:00:00.000Z",
      status: "started",
    });
    const completed = completeTraceEvent(started, {
      status: "ok",
      endedAt: "2026-09-08T16:00:00.250Z",
      metrics: { latencyMs: 250 },
    });
    expect(completed.durationMs).toBe(250);
    expect(completed.status).toBe("ok");
  });

  it("redacts secret-like keys and bearer tokens", () => {
    const redacted = redactSecretLikeValue({
      apiKey: "super-secret",
      nested: { authorization: "Bearer abc.def.ghi" },
      safe: "ok",
      tokenValue: "sk-abcdefghijklmnopqrstuvwxyz",
    }) as Record<string, unknown>;

    expect(redacted.apiKey).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect(redacted.safe).toBe("ok");
    expect(redacted.tokenValue).toBe("[REDACTED]");
  });

  it("rejects invalid events fail-closed", () => {
    const result = validateAgentReliabilityTraceEvent({
      schemaVersion: AGENT_RELIABILITY_TRACE_SCHEMA_VERSION,
      eventId: "e1",
      kind: "run",
      traceId: "t1",
      status: "ok",
      startedAt: "2026-09-08T16:00:01.000Z",
      endedAt: "2026-09-08T16:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("stores only validated events in the in-memory sink", () => {
    const sink = createInMemoryTraceSink();
    const ok = emitBoundaryTrace(sink, {
      kind: "approval",
      traceId: "trace-3",
      eventId: "event-3",
      status: "ok",
      approvalState: "approved",
      actorRole: "client_admin",
      startedAt: "2026-09-08T16:00:00.000Z",
    });
    expect(ok.ok).toBe(true);
    expect(sink.list()).toHaveLength(1);

    const bad = sink.emit({ schemaVersion: "nope" });
    expect(bad.ok).toBe(false);
    expect(sink.list()).toHaveLength(1);
  });
});
