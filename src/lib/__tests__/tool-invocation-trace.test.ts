import { describe, expect, it } from "vitest";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import {
  assignmentToEnvelope,
  executionStepAssignmentToEnvelope,
} from "@/lib/assignment-to-envelope";
import { CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION } from "@/lib/catalog-evidence-input";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import type { DelegationSpecSnapshot, ToolInvocation } from "@/lib/execution-context";
import { snapshotDelegationSpec } from "@/lib/execution-context-enforcement";
import { PUBLIC_WEB_RESEARCHER_KEY } from "@/lib/public-web-researcher";
import {
  buildNativeToolTrace,
  emptyObservationTrace,
  hashToolInvocationTrace,
  observationPointersFor,
  recordNativePublicReadCycle,
  requireObservationPointers,
  validateToolInvocationTraceArtifact,
  type ToolInvocationTrace,
} from "@/lib/tool-invocation-trace";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const NOW = "2026-09-09T16:00:00Z";

function spec(overrides: Partial<DelegationSpecSnapshot> = {}) {
  return snapshotDelegationSpec({
    specKey: "catalog-integrity-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "prepare_only",
    allowedToolClasses: ["public_read", "artifact_read", "artifact_write", "external_message_draft"],
    ...overrides,
  });
}

function assignmentInput() {
  return {
    organizationId: "org-loadout-internal-qa",
    runId: "run-001",
    phase: "prepare" as const,
    capabilityKey: "evidence_research",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    executorKind: "agent" as const,
    provider: "hermes",
    protocolVersion: "hermes-catalog-evidence-prepare/v1",
    modelId: "free",
    configHash: null,
    objective: "Prepare source-backed candidate evidence.",
    createdAt: NOW,
    deadline: NOW,
    outputContract: {
      schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
      artifactKind: "candidate_evidence",
    },
    evidenceRequirements: {
      requiredArtifactSchemaVersions: [CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION],
      requiredSourceProvenance: ["sourceUrl"],
      independentReviewRequired: true,
    },
    economicLimit: { currency: "USD" as const, maxHumanMinutes: 0, maxAiCostMicros: 0, maxToolCostMicros: 0 },
    inputManifestContentHash: HASH,
    profileAuthoritySnapshot: {
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      executorKind: "agent",
      authorityEnvelope: { actionClass: "prepare_only", mayOwnAuthoritativeState: false },
      forbiddenActions: [],
    },
  };
}

function inputRefs() {
  return [{ artifactId: "input-manifest", schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION, contentHash: HASH }];
}

function operatorBinding() {
  const translated = assignmentToEnvelope(assignmentInput(), spec(), inputRefs());
  if (!translated.ok) throw new Error(translated.failures.join(" "));
  return translated.value;
}

function nativeBinding(allowed: DelegationSpecSnapshot["allowedToolClasses"]) {
  const translated = assignmentToEnvelope(
    {
      ...assignmentInput(),
      runId: "run-native-0001",
      capabilityKey: "public_web_retrieval",
      executorKey: PUBLIC_WEB_RESEARCHER_KEY,
      provider: "delegation-cloud",
      protocolVersion: "delegation-cloud-public-web-prepare/v1",
      modelId: null,
      profileAuthoritySnapshot: {
        executorKey: PUBLIC_WEB_RESEARCHER_KEY,
        executorKind: "agent",
        authorityEnvelope: { actionClass: "prepare_only", mayOwnAuthoritativeState: false },
        forbiddenActions: [],
      },
    },
    spec({ allowedToolClasses: allowed }),
    inputRefs(),
  );
  if (!translated.ok) throw new Error(translated.failures.join(" "));
  return translated.value;
}

function leasedBinding() {
  const translated = executionStepAssignmentToEnvelope(
    { ...assignmentInput(), planHash: HASH, stepKey: "research" },
    spec(),
    inputRefs(),
  );
  if (!translated.ok) throw new Error(translated.failures.join(" "));
  return translated.value;
}

function expectedFor(
  current: { assignmentId: string; envelopeHash: string; contextHash: string },
  productionClass: ToolInvocationTrace["productionClass"],
) {
  return {
    productionClass,
    assignmentId: current.assignmentId,
    envelopeHash: current.envelopeHash,
    contextHash: current.contextHash,
  };
}

function allowedInvocation(current: ReturnType<typeof nativeBinding>, invocationId = "invocation-001"): ToolInvocation {
  return {
    schemaVersion: current.context.schemaVersion,
    invocationId,
    contextHash: current.contextHash,
    toolClass: "public_read",
    toolKey: "public-https-fetch",
    status: "allowed",
    invokedAt: NOW,
    completedAt: NOW,
    failureCode: null,
  };
}

function blockedInvocation(current: ReturnType<typeof nativeBinding>, invocationId = "invocation-001"): ToolInvocation {
  return {
    schemaVersion: current.context.schemaVersion,
    invocationId,
    contextHash: current.contextHash,
    toolClass: "public_read",
    toolKey: "public-https-fetch",
    status: "blocked",
    invokedAt: NOW,
    completedAt: NOW,
    failureCode: "tool_class_not_authorized",
  };
}

function failuresOf(result: { ok: boolean; failures?: string[] }): string {
  return result.ok ? "" : (result.failures ?? []).join(" ");
}

describe("tool invocation trace identity gates", () => {
  it("rejects a productionClass that does not match the gated path", () => {
    const current = operatorBinding();
    const empty = emptyObservationTrace({
      productionClass: "operator_submitted",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });
    const checked = validateToolInvocationTraceArtifact(empty, current.context, {
      ...expectedFor(current, "native_tool_execution"),
    });
    expect(checked.ok).toBe(false);
    expect(failuresOf(checked)).toMatch(/productionClass does not match the gated path/);
  });

  it("rejects assignment, envelope, and context identity mismatches", () => {
    const current = operatorBinding();
    const empty = emptyObservationTrace({
      productionClass: "operator_submitted",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });

    const assignment = validateToolInvocationTraceArtifact(empty, current.context, {
      ...expectedFor(current, "operator_submitted"),
      assignmentId: "assignment-other",
    });
    expect(assignment.ok).toBe(false);
    expect(failuresOf(assignment)).toMatch(/assignmentId does not match the frozen assignment identity/);

    const envelope = validateToolInvocationTraceArtifact(empty, current.context, {
      ...expectedFor(current, "operator_submitted"),
      envelopeHash: OTHER_HASH,
    });
    expect(envelope.ok).toBe(false);
    expect(failuresOf(envelope)).toMatch(/envelopeHash does not match the frozen envelope/);

    const contextHash = validateToolInvocationTraceArtifact(empty, current.context, {
      ...expectedFor(current, "operator_submitted"),
      contextHash: OTHER_HASH,
    });
    expect(contextHash.ok).toBe(false);
    expect(failuresOf(contextHash)).toMatch(/contextHash does not match the frozen execution context/);
  });

  it("rejects worker, lease, or token fields on the observation", () => {
    const current = operatorBinding();
    const empty = emptyObservationTrace({
      productionClass: "operator_submitted",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });
    const checked = validateToolInvocationTraceArtifact(
      { ...empty, leaseTokenHash: HASH },
      current.context,
      expectedFor(current, "operator_submitted"),
    );
    expect(checked.ok).toBe(false);
    expect(failuresOf(checked)).toMatch(/Observation /);
  });
});

describe("tool invocation trace consistency", () => {
  it("rejects leased completion with an empty observation unless the class is explicitly no-tools", () => {
    const current = leasedBinding();
    const empty: ToolInvocationTrace = {
      schemaVersion: "tool-invocation-trace/v1",
      productionClass: "leased_executor_execution",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
      dcExecutedTools: false,
      externalAgentToolUse: "not_applicable",
      invocations: [],
      outcomes: [],
    };
    const checked = validateToolInvocationTraceArtifact(
      empty,
      current.context,
      expectedFor(current, "leased_executor_execution"),
    );
    expect(checked.ok).toBe(false);
    expect(failuresOf(checked)).toMatch(/empty observation trace unless production class is explicitly no-tools/);
  });

  it("rejects duplicate invocation IDs and orphan outcomes", () => {
    const current = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const invocation = allowedInvocation(current);
    const duplicate = validateToolInvocationTraceArtifact(
      buildNativeToolTrace({
        assignmentId: current.assignmentId,
        envelopeHash: current.envelopeHash,
        contextHash: current.contextHash,
        invocations: [invocation, { ...invocation }],
        outcomes: [
          { invocationId: invocation.invocationId, result: "fetched" },
          { invocationId: invocation.invocationId, result: "fetched" },
        ],
      }),
      current.context,
      expectedFor(current, "native_tool_execution"),
    );
    expect(duplicate.ok).toBe(false);
    expect(failuresOf(duplicate)).toMatch(/unique invocationId/);

    const orphan = validateToolInvocationTraceArtifact(
      buildNativeToolTrace({
        assignmentId: current.assignmentId,
        envelopeHash: current.envelopeHash,
        contextHash: current.contextHash,
        invocations: [invocation],
        outcomes: [{ invocationId: "invocation-missing", result: "fetched" }],
      }),
      current.context,
      expectedFor(current, "native_tool_execution"),
    );
    expect(orphan.ok).toBe(false);
    expect(failuresOf(orphan)).toMatch(/not present in invocations|exactly one row per invocation/);
  });

  it("requires dcExecutedTools only when an allowed invocation was recorded", () => {
    const current = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const invocation = allowedInvocation(current);
    const claimed = validateToolInvocationTraceArtifact(
      {
        ...buildNativeToolTrace({
          assignmentId: current.assignmentId,
          envelopeHash: current.envelopeHash,
          contextHash: current.contextHash,
          invocations: [invocation],
          outcomes: [{ invocationId: invocation.invocationId, result: "fetched" }],
        }),
        dcExecutedTools: false,
      },
      current.context,
      expectedFor(current, "native_tool_execution"),
    );
    expect(claimed.ok).toBe(false);
    expect(failuresOf(claimed)).toMatch(/dcExecutedTools must be true only when Delegation Cloud recorded an allowed invocation/);
  });

  it("pairs blocked and allowed invocations with the matching outcome", () => {
    const current = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const blocked = blockedInvocation(current);
    const wrongOutcome = validateToolInvocationTraceArtifact(
      {
        ...buildNativeToolTrace({
          assignmentId: current.assignmentId,
          envelopeHash: current.envelopeHash,
          contextHash: current.contextHash,
          invocations: [blocked],
          outcomes: [{ invocationId: blocked.invocationId, result: "fetched" }],
        }),
        dcExecutedTools: false,
      },
      current.context,
      expectedFor(current, "native_tool_execution"),
    );
    expect(wrongOutcome.ok).toBe(false);
    expect(failuresOf(wrongOutcome)).toMatch(/blocked_preflight/);

    const allowed = allowedInvocation(current);
    const blockedAllowed = validateToolInvocationTraceArtifact(
      buildNativeToolTrace({
        assignmentId: current.assignmentId,
        envelopeHash: current.envelopeHash,
        contextHash: current.contextHash,
        invocations: [allowed],
        outcomes: [{ invocationId: allowed.invocationId, result: "blocked_preflight" }],
      }),
      current.context,
      expectedFor(current, "native_tool_execution"),
    );
    expect(blockedAllowed.ok).toBe(false);
    expect(failuresOf(blockedAllowed)).toMatch(/allowed invocation cannot use a blocked or not_applicable outcome/);
  });

  it("treats fetch_failed as an allowed-invocation outcome, not an authorization failure", () => {
    const current = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const blocked = blockedInvocation(current);
    const checked = validateToolInvocationTraceArtifact(
      {
        ...buildNativeToolTrace({
          assignmentId: current.assignmentId,
          envelopeHash: current.envelopeHash,
          contextHash: current.contextHash,
          invocations: [blocked],
          outcomes: [{ invocationId: blocked.invocationId, result: "fetch_failed" }],
        }),
        dcExecutedTools: false,
      },
      current.context,
      expectedFor(current, "native_tool_execution"),
    );
    expect(checked.ok).toBe(false);
    expect(failuresOf(checked)).toMatch(/fetch_failed is an allowed invocation outcome/);
  });

  it("rejects operator_submitted traces that claim a known external-agent tool state", () => {
    const current = operatorBinding();
    const empty = emptyObservationTrace({
      productionClass: "operator_submitted",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });
    const checked = validateToolInvocationTraceArtifact(
      { ...empty, externalAgentToolUse: "not_applicable" },
      current.context,
      expectedFor(current, "operator_submitted"),
    );
    expect(checked.ok).toBe(false);
    expect(failuresOf(checked)).toMatch(/externalAgentToolUse as unknown/);
  });
});

describe("native public_read cycle recording", () => {
  it("records blocked_preflight only when public_read is unauthorized", () => {
    const unauthorized = nativeBinding(["artifact_read", "artifact_write"]);
    const blocked = recordNativePublicReadCycle({
      context: unauthorized.context,
      invocationId: "public-read-1",
      toolKey: "public-https-fetch",
      invokedAt: NOW,
      completedAt: NOW,
      fetchResult: "blocked_preflight",
    });
    expect(blocked.ok).toBe(true);
    if (blocked.ok) {
      expect(blocked.value.invocation.status).toBe("blocked");
      expect(blocked.value.invocation.failureCode).toBe("tool_class_not_authorized");
      expect(blocked.value.outcome.result).toBe("blocked_preflight");
    }

    const fetchedWhileBlocked = recordNativePublicReadCycle({
      context: unauthorized.context,
      invocationId: "public-read-2",
      toolKey: "public-https-fetch",
      invokedAt: NOW,
      completedAt: NOW,
      fetchResult: "fetched",
    });
    expect(fetchedWhileBlocked.ok).toBe(false);
  });

  it("refuses to record blocked_preflight after public_read was authorized", () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const blocked = recordNativePublicReadCycle({
      context: authorized.context,
      invocationId: "public-read-1",
      toolKey: "public-https-fetch",
      invokedAt: NOW,
      completedAt: NOW,
      fetchResult: "blocked_preflight",
    });
    expect(blocked.ok).toBe(false);
    expect(failuresOf(blocked)).toMatch(/cannot be recorded as blocked_preflight/);

    const fetched = recordNativePublicReadCycle({
      context: authorized.context,
      invocationId: "public-read-2",
      toolKey: "public-https-fetch",
      invokedAt: NOW,
      completedAt: NOW,
      fetchResult: "fetched",
    });
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(fetched.value.invocation.status).toBe("allowed");
      expect(fetched.value.invocation.failureCode).toBeNull();
      expect(fetched.value.outcome.result).toBe("fetched");
    }

    const failed = recordNativePublicReadCycle({
      context: authorized.context,
      invocationId: "public-read-3",
      toolKey: "public-https-fetch",
      invokedAt: NOW,
      completedAt: NOW,
      fetchResult: "fetch_failed",
    });
    expect(failed.ok).toBe(true);
    if (failed.ok) {
      expect(failed.value.invocation.status).toBe("allowed");
      expect(failed.value.outcome.result).toBe("fetch_failed");
    }
  });

  it("sets dcExecutedTools from allowed invocations when building a native trace", () => {
    const current = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const allowed = allowedInvocation(current);
    const withAllowed = buildNativeToolTrace({
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
      invocations: [allowed],
      outcomes: [{ invocationId: allowed.invocationId, result: "fetched" }],
    });
    expect(withAllowed.dcExecutedTools).toBe(true);
    expect(withAllowed.productionClass).toBe("native_tool_execution");
    expect(withAllowed.externalAgentToolUse).toBe("not_applicable");

    const blocked = blockedInvocation(current);
    const withBlocked = buildNativeToolTrace({
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
      invocations: [blocked],
      outcomes: [{ invocationId: blocked.invocationId, result: "blocked_preflight" }],
    });
    expect(withBlocked.dcExecutedTools).toBe(false);
  });
});

describe("observation pointers", () => {
  it("fails closed when pointers are missing or not 64-character hex hashes", () => {
    expect(requireObservationPointers({}).ok).toBe(false);
    expect(failuresOf(requireObservationPointers({}))).toMatch(/Missing observation trace is not an empty trace/);

    const current = operatorBinding();
    const empty = emptyObservationTrace({
      productionClass: "operator_submitted",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });
    const pointers = observationPointersFor(empty);
    expect(pointers.traceContentHash).toBe(hashToolInvocationTrace(empty));
    expect(requireObservationPointers(pointers).ok).toBe(true);

    const malformed = requireObservationPointers({
      ...pointers,
      envelopeHash: "not-a-hash",
    });
    expect(malformed.ok).toBe(false);
    expect(failuresOf(malformed)).toMatch(/Observation pointers /);
  });
});
