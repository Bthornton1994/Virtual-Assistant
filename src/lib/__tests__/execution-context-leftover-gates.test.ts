import { describe, expect, it } from "vitest";
import {
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

describe("execution-context leftover spec and identity gates", () => {
  it("refuses duplicate allowed or forbidden tool classes", () => {
    const allowed = createExecutionContext(
      spec({ allowedToolClasses: ["public_read", "public_read", "artifact_read", "artifact_write"] }),
      assignment(),
    );
    expect(allowed.ok).toBe(false);
    expect(failuresOf(allowed)).toMatch(/allowedToolClasses.*must not contain duplicates/);

    const forbidden = createExecutionContext(
      spec({ forbiddenToolClasses: ["external_message_send", "external_message_send", "sensitive_action"] }),
      assignment(),
    );
    expect(forbidden.ok).toBe(false);
    expect(failuresOf(forbidden)).toMatch(/forbiddenToolClasses.*must not contain duplicates/);
  });

  it("refuses a sensitive envelope that skips human approval", () => {
    const unapproved = createExecutionContext(
      spec({
        actionClass: "sensitive_execution",
        allowedToolClasses: ["public_read", "sensitive_action"],
        forbiddenToolClasses: ["external_message_send"],
        requiresHumanApproval: false,
      }),
      assignment(),
    );
    expect(unapproved.ok).toBe(false);
    expect(failuresOf(unapproved)).toMatch(/external and sensitive tool envelopes require human approval/);
  });

  it("refuses padded identifiers, extra context keys, and extra credential fields", () => {
    const padded = createExecutionContext(spec({ specKey: " catalog-integrity-spec " }), assignment());
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/must not have leading or trailing whitespace/);

    const extraContext = validateExecutionContext({ ...context(), autoApprove: true });
    expect(extraContext.ok).toBe(false);
    expect(failuresOf(extraContext)).toMatch(/unrecognized|additional/i);

    const extraCredential = validateExecutionContext({
      ...context(),
      credentialRefs: [
        {
          credentialKey: "shared-secret",
          scope: ["public_read"],
          secretMaterialIncluded: false,
          plaintextHint: "do-not-store",
        },
      ],
    });
    expect(extraCredential.ok).toBe(false);
    expect(failuresOf(extraCredential)).toMatch(/unrecognized|additional/i);
  });
});
