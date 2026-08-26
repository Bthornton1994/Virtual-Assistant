import { describe, expect, it } from "vitest";
import {
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  createExecutionContext,
  validateExecutionContext,
  validateToolInvocation,
  type AssignmentSnapshot,
  type DelegationSpecSnapshot,
  type ExecutionContext,
} from "@/lib/execution-context";

const HASH = "a".repeat(64);

function spec(overrides: Partial<DelegationSpecSnapshot> = {}): DelegationSpecSnapshot {
  return {
    specKey: "catalog-integrity-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "prepare_only",
    allowedToolClasses: ["public_read", "artifact_read", "artifact_write", "external_message_draft"],
    forbiddenToolClasses: ["external_message_send", "sensitive_action", "credential_use"],
    requiresHumanApproval: false,
    mayOwnAuthoritativeState: false,
    ...overrides,
  };
}

function assignment(overrides: Partial<AssignmentSnapshot> = {}): AssignmentSnapshot {
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
    ...overrides,
  };
}

function context(): ExecutionContext {
  const built = createExecutionContext(spec(), assignment());
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.failures.join("; "));
  return built.value;
}

function invocation(overrides: Partial<Parameters<typeof validateToolInvocation>[0]> = {}) {
  return {
    schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
    invocationId: "invocation-001",
    contextHash: context().contextHash,
    toolClass: "public_read" as const,
    toolKey: "public-http-fetch",
    status: "allowed" as const,
    invokedAt: "2026-08-25T20:01:00Z",
    completedAt: "2026-08-25T20:01:10Z",
    failureCode: null,
    ...overrides,
  };
}

describe("execution context v1", () => {
  it("derives a hash-bound context from the spec and assignment", () => {
    const built = createExecutionContext(spec(), assignment());
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value.authorizedToolClasses).toEqual(spec().allowedToolClasses);
      expect(validateExecutionContext(built.value).ok).toBe(true);
      expect(built.value.contextHash).toHaveLength(64);
      expect(built.value.secretMaterialIncluded).toBe(false);
    }
  });

  it("rejects a changed tool snapshot or a stale context hash", () => {
    const current = context();
    const tampered = {
      ...current,
      authorizedToolClasses: ["external_message_send"],
    };
    const checked = validateExecutionContext(tampered);
    expect(checked.ok).toBe(false);
    expect(checked.ok ? [] : checked.failures.join(" ")).toContain("authorizedToolClasses");

    const stale = { ...current, contextHash: "b".repeat(64) };
    const staleCheck = validateExecutionContext(stale);
    expect(staleCheck.ok).toBe(false);
    expect(staleCheck.ok ? [] : staleCheck.failures.join(" ")).toContain("contextHash");
  });

  it("allows an invocation inside the envelope", () => {
    const checked = validateToolInvocation(invocation(), context());
    expect(checked.ok).toBe(true);
  });

  it("detects an attempt outside the envelope and refuses an unearned blocked label", () => {
    const outside = validateToolInvocation(
      invocation({
        toolClass: "external_message_send",
        status: "allowed",
      }),
      context(),
    );
    expect(outside.ok).toBe(false);
    expect(outside.ok ? [] : outside.failures.join(" ")).toContain("outside the execution context envelope");

    const mislabeled = validateToolInvocation(
      invocation({
        toolClass: "external_message_send",
        status: "blocked",
        failureCode: "some_other_code",
      }),
      context(),
    );
    expect(mislabeled.ok).toBe(false);
    expect(mislabeled.ok ? [] : mislabeled.failures.join(" ")).toContain("tool_class_not_authorized");
  });

  it("does not allow secrets to be declared as embedded prompt material", () => {
    const parsed = validateExecutionContext({
      ...context(),
      secretMaterialIncluded: true,
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.failures.join(" ")).toContain("false");
  });
});
