import { afterEach, describe, expect, it } from "vitest";
import {
  createExecutionContext,
  validateToolInvocation,
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  type AssignmentSnapshot,
  type DelegationSpecSnapshot,
} from "@/lib/execution-context";
import {
  MemoryTraceSink,
  redactLabels,
  redactSecretLikeString,
  setAgentTraceSink,
  emptyProviderMeta,
  emptyTraceMetrics,
  sanitizeTraceEvent,
  type AgentTraceEvent,
} from "@/lib/agent-trace";

const HASH = "a".repeat(64);

function spec(): DelegationSpecSnapshot {
  return {
    specKey: "catalog-integrity-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "prepare_only",
    allowedToolClasses: ["public_read", "artifact_read", "artifact_write", "external_message_draft"],
    forbiddenToolClasses: ["external_message_send", "sensitive_action", "credential_use"],
    requiresHumanApproval: false,
    mayOwnAuthoritativeState: false,
  };
}

function assignment(): AssignmentSnapshot {
  return {
    runId: "run-001",
    assignmentId: "assignment-001",
    capabilityKey: "evidence_research",
    executorKey: "hermes-loadout-researcher-v1",
    inputArtifactRefs: [
      {
        artifactId: "input-001",
        schemaVersion: "catalog-input/v1",
        contentHash: HASH,
      },
    ],
    outputContract: {
      schemaVersion: "catalog-evidence-packet/v1",
      artifactKind: "candidate_evidence",
    },
    executorConfigurationSnapshot: {
      executorKey: "hermes-loadout-researcher-v1",
      executorKind: "agent",
      provider: "hermes",
      protocolVersion: "loadout/v1",
      modelId: "free",
      configHash: null,
    },
    createdAt: "2026-08-25T20:00:00Z",
    deadline: "2026-08-25T21:00:00Z",
  };
}

describe("agent-trace contract", () => {
  afterEach(() => {
    setAgentTraceSink(null);
  });

  it("redacts secret-like labels and values", () => {
    expect(redactSecretLikeString("Authorization Bearer abc.def.ghi")).toContain("[REDACTED]");
    expect(redactLabels({ api_key: "secret", note: "ok" })).toEqual({
      api_key: "[REDACTED]",
      note: "ok",
    });
  });

  it("sanitizes events and stores them only in the memory sink", () => {
    const sink = new MemoryTraceSink();
    const event: AgentTraceEvent = {
      schemaVersion: "agent-trace/v1",
      traceId: "trace-1",
      eventId: "evt-1",
      kind: "approval",
      runId: "run-1",
      stepId: "step-1",
      organizationIdHash: "abcd",
      actorIdHash: "efgh",
      actorRole: "client_admin",
      capability: null,
      actionClass: "sensitive_execution",
      status: "ok",
      startedAt: "2026-09-08T16:00:00.000Z",
      endedAt: "2026-09-08T16:00:01.000Z",
      durationMs: 1000,
      errorCode: null,
      policyDecision: "approved",
      approvalState: "approved",
      evidenceHashes: [HASH],
      sourceHashes: [],
      providerMeta: emptyProviderMeta(),
      metrics: emptyTraceMetrics(),
      labels: { password: "should-not-persist", caseId: "eval.demo" },
    };
    sink.record(event);
    expect(sink.list()[0].labels.password).toBe("[REDACTED]");
    expect(sanitizeTraceEvent(event).metrics.tokensIn).toBeNull();
  });

  it("records tool invocation decisions at the execution-context boundary when a sink is set", () => {
    const sink = new MemoryTraceSink();
    setAgentTraceSink(sink);
    const built = createExecutionContext(spec(), assignment());
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.failures.join("; "));

    const allowed = validateToolInvocation(
      {
        schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
        invocationId: "invocation-001",
        contextHash: built.value.contextHash,
        toolClass: "public_read",
        toolKey: "public-http-fetch",
        status: "allowed",
        invokedAt: "2026-08-25T20:01:00Z",
        completedAt: "2026-08-25T20:01:10Z",
        failureCode: null,
      },
      built.value,
    );
    expect(allowed.ok).toBe(true);
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].kind).toBe("capability_invocation");
    expect(sink.list()[0].policyDecision).toBe("tool_class_authorized");

    setAgentTraceSink(null);
    validateToolInvocation(
      {
        schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
        invocationId: "invocation-002",
        contextHash: built.value.contextHash,
        toolClass: "public_read",
        toolKey: "public-http-fetch",
        status: "allowed",
        invokedAt: "2026-08-25T20:02:00Z",
        completedAt: "2026-08-25T20:02:10Z",
        failureCode: null,
      },
      built.value,
    );
    expect(sink.list()).toHaveLength(1);
  });
});
