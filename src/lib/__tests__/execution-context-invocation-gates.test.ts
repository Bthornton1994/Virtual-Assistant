import { describe, expect, it } from "vitest";
import {
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  authorizeToolClass,
  createExecutionContext,
  validateToolInvocation,
  validateToolInvocationTrace,
  type AssignmentSnapshot,
  type DelegationSpecSnapshot,
  type ExecutionContext,
} from "@/lib/execution-context";

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

function context(): ExecutionContext {
  const built = createExecutionContext(spec(), assignment());
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.failures.join("; "));
  return built.value;
}

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
    invocationId: "invocation-001",
    contextHash: context().contextHash,
    toolClass: "public_read",
    toolKey: "public-http-fetch",
    status: "allowed",
    invokedAt: "2026-08-25T20:01:00Z",
    completedAt: "2026-08-25T20:01:10Z",
    failureCode: null,
    ...overrides,
  };
}

describe("execution context invocation fail-closed", () => {
  it("rejects an allowed invocation that still carries a failure code", () => {
    const checked = validateToolInvocation(
      invocation({ failureCode: "tool_class_not_authorized" }),
      context(),
    );
    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.failures.join(" ")).toMatch(/cannot include a failureCode/);
  });

  it("rejects a blocked invocation without the reserved unauthorized failure code", () => {
    const missing = validateToolInvocation(
      invocation({
        toolClass: "external_message_send",
        status: "blocked",
        failureCode: null,
      }),
      context(),
    );
    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.failures.join(" ")).toMatch(/require a failureCode/);

    const authorizedBlocked = validateToolInvocation(
      invocation({
        toolClass: "public_read",
        status: "blocked",
        failureCode: "tool_class_not_authorized",
      }),
      context(),
    );
    expect(authorizedBlocked.ok).toBe(false);
    expect(authorizedBlocked.ok ? "" : authorizedBlocked.failures.join(" ")).toMatch(
      /cannot be recorded as blocked/,
    );
  });

  it("rejects a completedAt that precedes invokedAt", () => {
    const inverted = validateToolInvocation(
      invocation({
        invokedAt: "2026-08-25T20:02:00Z",
        completedAt: "2026-08-25T20:01:00Z",
      }),
      context(),
    );
    expect(inverted.ok).toBe(false);
    expect(inverted.ok ? "" : inverted.failures.join(" ")).toMatch(/completedAt must not precede invokedAt/);
  });

  it("validates a trace as a whole and fails closed on one bad row", () => {
    const current = context();
    const okRow = invocation({ invocationId: "invocation-ok" });
    const blockedRow = invocation({
      invocationId: "invocation-blocked",
      toolClass: "external_message_send",
      status: "blocked",
      failureCode: "tool_class_not_authorized",
    });
    const good = validateToolInvocationTrace([okRow, blockedRow], current);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toHaveLength(2);

    const bad = validateToolInvocationTrace(
      [
        okRow,
        invocation({
          invocationId: "invocation-send",
          toolClass: "external_message_send",
          status: "allowed",
        }),
      ],
      current,
    );
    expect(bad.ok).toBe(false);
    expect(bad.ok ? "" : bad.failures.join(" ")).toMatch(/outside the execution context envelope/);
  });

  it("rejects an unknown tool class at preflight", () => {
    const unknown = authorizeToolClass(context(), "computer_run_command");
    expect(unknown.ok).toBe(false);
    expect(unknown.ok ? "" : unknown.failures.join(" ")).toMatch(/not a registered execution-context tool class/);
  });
});
