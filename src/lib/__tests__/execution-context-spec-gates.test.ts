import { describe, expect, it } from "vitest";
import {
  authorizeToolClass,
  createExecutionContext,
  validateExecutionContext,
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
  if (!built.ok) throw new Error(built.failures.join("; "));
  return built.value;
}

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("execution context spec and identity gates", () => {
  it("refuses overlapping tools, action-class overreach, and unapproved external envelopes", () => {
    const overlap = createExecutionContext(
      spec({
        allowedToolClasses: ["public_read", "external_message_send"],
        forbiddenToolClasses: ["external_message_send"],
      }),
      assignment(),
    );
    expect(overlap.ok).toBe(false);
    expect(failuresOf(overlap)).toMatch(/cannot also be forbidden/i);

    const overreach = createExecutionContext(
      spec({
        allowedToolClasses: ["public_read", "external_message_send"],
        forbiddenToolClasses: ["sensitive_action"],
      }),
      assignment(),
    );
    expect(overreach.ok).toBe(false);
    expect(failuresOf(overreach)).toMatch(/exceeds the Delegation Spec action class/i);

    const unapprovedExternal = createExecutionContext(
      spec({
        actionClass: "external_execution",
        allowedToolClasses: ["public_read", "external_message_send"],
        forbiddenToolClasses: ["sensitive_action"],
        requiresHumanApproval: false,
      }),
      assignment(),
    );
    expect(unapprovedExternal.ok).toBe(false);
    expect(failuresOf(unapprovedExternal)).toMatch(/require human approval/i);
  });

  it("rejects authoritative-state ownership, inverted deadlines, and extra keys", () => {
    const ownsState = createExecutionContext(spec({ mayOwnAuthoritativeState: true as false }), assignment());
    expect(ownsState.ok).toBe(false);
    expect(failuresOf(ownsState)).toMatch(/mayOwnAuthoritativeState|false/i);

    const inverted = createExecutionContext(
      spec(),
      assignment({ createdAt: "2026-08-25T21:00:00Z", deadline: "2026-08-25T20:00:00Z" }),
    );
    expect(inverted.ok).toBe(false);
    expect(failuresOf(inverted)).toMatch(/deadline/i);

    const extraSpec = createExecutionContext({ ...spec(), autoApprove: true }, assignment());
    expect(extraSpec.ok).toBe(false);
    expect(failuresOf(extraSpec)).toMatch(/unrecognized|additional/i);

    const extraAssignment = createExecutionContext(spec(), { ...assignment(), ownerOverride: true });
    expect(extraAssignment.ok).toBe(false);
    expect(failuresOf(extraAssignment)).toMatch(/unrecognized|additional/i);
  });

  it("binds context identity to the assignment and rejects duplicate credentials or unknown tools", () => {
    const current = context();

    const runMismatch = validateExecutionContext({ ...current, runId: "run-other" });
    expect(runMismatch.ok).toBe(false);
    expect(failuresOf(runMismatch)).toMatch(/runId/i);

    const createdMismatch = validateExecutionContext({ ...current, createdAt: "2026-08-25T20:30:00Z" });
    expect(createdMismatch.ok).toBe(false);
    expect(failuresOf(createdMismatch)).toMatch(/createdAt/i);

    const credential = {
      credentialKey: "shared-secret",
      scope: ["public_read"],
      secretMaterialIncluded: false as const,
    };
    const duplicates = validateExecutionContext({
      ...current,
      credentialRefs: [credential, { ...credential }],
    });
    expect(duplicates.ok).toBe(false);
    expect(failuresOf(duplicates)).toMatch(/credentialKey/i);

    const unknownTool = authorizeToolClass(current, "browser_takeover");
    expect(unknownTool.ok).toBe(false);
    expect(failuresOf(unknownTool)).toMatch(/registered execution-context tool class/i);
  });
});
