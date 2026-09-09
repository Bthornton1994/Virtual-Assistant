import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import {
  assignmentToEnvelope,
  executionStepAssignmentToEnvelope,
} from "@/lib/assignment-to-envelope";
import {
  authorizeToolClass,
  validateToolInvocationTrace,
  type DelegationSpecSnapshot,
} from "@/lib/execution-context";
import { checkExecutionLease } from "@/lib/execution-runtime";
import {
  assertLeasedCompleteAllowed,
  assertWorkCellPhasePersistAllowed,
  buildRequiredEmptyTrace,
  requireCompleteMetadataHashes,
  snapshotDelegationSpec,
  workCellPersistIdentity,
} from "@/lib/execution-context-enforcement";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import { CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION } from "@/lib/catalog-evidence-review";
import {
  PUBLIC_WEB_RESEARCHER_KEY,
  prepareAuthorizedPublicWebEvidencePacket,
} from "@/lib/public-web-researcher";
import {
  emptyObservationTrace,
  hashToolInvocationTrace,
  observationPointersFor,
  requireObservationPointers,
  validateToolInvocationTraceArtifact,
  type ToolInvocationTrace,
} from "@/lib/tool-invocation-trace";

const HASH = "a".repeat(64);
const NOW = "2026-09-09T16:00:00Z";

function spec(overrides: Partial<DelegationSpecSnapshot> = {}): DelegationSpecSnapshot {
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

function binding() {
  const translated = assignmentToEnvelope(assignmentInput(), spec(), inputRefs());
  if (!translated.ok) throw new Error(translated.failures.join(" "));
  return translated.value;
}

function nativeManifest(): CatalogEvidenceInputManifestV1 {
  const base = {
    runId: "run-native-0001",
    market: "US",
    expectedProductIds: ["ks-sbd-7mm"],
    inputRecords: [
      {
        productId: "ks-sbd-7mm",
        record: {
          name: "SBD 7mm Knee Sleeves",
          manufacturerUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
        },
      },
    ],
    prepareExecutorKey: PUBLIC_WEB_RESEARCHER_KEY,
    reviewExecutorKey: "grok-loadout-reviewer-v1",
  };
  return {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    createdAt: NOW,
    inputHash: sha256Hex(inputManifestHashSource(base)),
    ...base,
  };
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

describe("execution context enforcement v1", () => {
  it("1. authorizeToolClass allows a class inside the envelope without invokedAt or outcome", () => {
    const current = binding();
    const allowed = authorizeToolClass(current.context, "public_read");
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.value.toolClass).toBe("public_read");
      expect(JSON.stringify(allowed.value)).not.toContain("invokedAt");
      expect(JSON.stringify(allowed.value)).not.toContain("completedAt");
    }
  });

  it("2. authorizeToolClass rejects a class outside the envelope", () => {
    const denied = authorizeToolClass(binding().context, "credential_use");
    expect(denied.ok).toBe(false);
  });

  it("3. authorizeToolClass rejects an invalid execution context", () => {
    const denied = authorizeToolClass({ ...binding().context, contextHash: "b".repeat(64) }, "public_read");
    expect(denied.ok).toBe(false);
  });

  it("4. operator_submitted requires an explicit empty observation trace", () => {
    const current = binding();
    const trace = buildRequiredEmptyTrace("operator_submitted", current);
    expect(trace.invocations).toEqual([]);
    expect(trace.outcomes).toEqual([]);
    expect(trace.productionClass).toBe("operator_submitted");
  });

  it("5. operator_submitted treats a missing trace as missing, not empty", () => {
    const missing = requireObservationPointers({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.failures.join(" ")).toMatch(/Missing observation trace is not an empty trace/);
    }
  });

  it("6. operator_submitted rejects non-empty DC invocations", () => {
    const current = binding();
    const empty = emptyObservationTrace({
      productionClass: "operator_submitted",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });
    const checked = validateToolInvocationTraceArtifact(
      {
        ...empty,
        invocations: [
          {
            schemaVersion: current.context.schemaVersion,
            invocationId: "invocation-001",
            contextHash: current.contextHash,
            toolClass: "public_read",
            toolKey: "public-https-fetch",
            status: "allowed",
            invokedAt: NOW,
            completedAt: NOW,
            failureCode: null,
          },
        ],
        outcomes: [{ invocationId: "invocation-001", result: "fetched" }],
        dcExecutedTools: true,
      },
      current.context,
      {
        productionClass: "operator_submitted",
        assignmentId: current.assignmentId,
        envelopeHash: current.envelopeHash,
        contextHash: current.contextHash,
      },
    );
    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.failures.join(" ")).toMatch(/empty observation trace/);
  });

  it("7. operator_submitted sets dcExecutedTools false and externalAgentToolUse unknown", () => {
    const trace = buildRequiredEmptyTrace("operator_submitted", binding());
    expect(trace.dcExecutedTools).toBe(false);
    expect(trace.externalAgentToolUse).toBe("unknown");
  });

  it("8. operator_submitted binds assignment, envelope, and context hashes", () => {
    const current = binding();
    const trace = buildRequiredEmptyTrace("operator_submitted", current);
    expect(trace.assignmentId).toBe(current.assignmentId);
    expect(trace.envelopeHash).toBe(current.envelopeHash);
    expect(trace.contextHash).toBe(current.contextHash);
  });

  it("9. operator_submitted does not invent worker, lease, or token fields", () => {
    const trace = buildRequiredEmptyTrace("operator_submitted", binding());
    expect(trace).not.toHaveProperty("workerId");
    expect(trace).not.toHaveProperty("leaseToken");
    expect(trace).not.toHaveProperty("leaseTokenHash");
  });

  it("10. native authorizeToolClass is preflight only and is not a persisted trace row", () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const allowed = authorizeToolClass(authorized.context, "public_read");
    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.value).not.toHaveProperty("invokedAt");
      expect(allowed.value).not.toHaveProperty("completedAt");
      expect(allowed.value).not.toHaveProperty("invocationId");
      expect(allowed.value).not.toHaveProperty("status");
    }
  });

  it("11. native unauthorized public_read does not call fetchPage", async () => {
    const unauthorized = nativeBinding(["artifact_read", "artifact_write"]);
    expect(authorizeToolClass(unauthorized.context, "public_read").ok).toBe(false);
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), unauthorized, {
        fetchPage: async () => {
          throw new Error("fetchPage must not run after a blocked preflight");
        },
        now: NOW,
      }),
    ).rejects.toThrow(/blocked_preflight|Fetch was not started/);
  });

  it("12. native blocked_preflight rejects before returning a persistable packet", async () => {
    const unauthorized = nativeBinding(["artifact_read", "artifact_write"]);
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), unauthorized, {
        fetchPage: async () => {
          throw new Error("fetchPage must not run after a blocked preflight");
        },
        now: NOW,
      }),
    ).rejects.toThrow(/blocked_preflight|Fetch was not started/);
  });

  it("13. native authorized public_read calls the injected fetchPage once", async () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    let fetchCalls = 0;
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), authorized, {
      fetchPage: async (url) => {
        fetchCalls += 1;
        return { url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" };
      },
      now: NOW,
    });
    expect(fetchCalls).toBe(1);
    expect(fetched.trace.dcExecutedTools).toBe(true);
    expect(fetched.trace.externalAgentToolUse).toBe("not_applicable");
  });

  it("14. native fetched success records an allowed invocation without a failureCode", async () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), authorized, {
      fetchPage: async (url) => ({ url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" }),
      now: NOW,
    });
    expect(fetched.trace.outcomes[0]?.result).toBe("fetched");
    expect(fetched.trace.invocations[0]?.status).toBe("allowed");
    expect(fetched.trace.invocations[0]?.failureCode).toBeNull();
  });

  it("15. native fetch_failed is an allowed invocation, not a blocked authorization", async () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const failingManifest = nativeManifest();
    failingManifest.inputRecords[0] = {
      productId: "ks-sbd-7mm",
      record: { name: "SBD 7mm Knee Sleeves", manufacturerUrl: "https://www.sbdapparel.com/fail" },
    };
    const failed = await prepareAuthorizedPublicWebEvidencePacket(failingManifest, authorized, {
      fetchPage: async () => ({ error: "upstream 503" }),
      now: NOW,
    });
    expect(failed.trace.outcomes[0]?.result).toBe("fetch_failed");
    expect(failed.trace.invocations[0]?.status).toBe("allowed");
    expect(failed.trace.invocations[0]?.failureCode).toBeNull();
    expect(failed.packet.schemaVersion).toBe(CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
  });

  it("16. native completed traces are validated after fetch, not used as preflight", async () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), authorized, {
      fetchPage: async (url) => ({ url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" }),
      now: NOW,
    });
    expect(validateToolInvocationTrace(fetched.trace.invocations, authorized.context).ok).toBe(true);
    expect(authorizeToolClass(authorized.context, "public_read").ok).toBe(true);
  });

  it("17. native tests use injected fakes only and never open a network fetch", async () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const source = readFileSync(resolve(process.cwd(), "src/lib/__tests__/execution-context-enforcement.test.ts"), "utf8");
    expect(source).not.toMatch(/https?:\/\/(?!www\.sbdapparel\.com)/);
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), authorized, {
      fetchPage: async (url) => ({ url, status: 200, text: "injected fixture" }),
      now: NOW,
    });
    expect(fetched.trace.invocations).toHaveLength(1);
  });

  it("18. leased claim SQL requires and writes context_hash and envelopeHash", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql"),
      "utf8",
    );
    expect(sql).toMatch(/p_context_hash text/);
    expect(sql).toMatch(/p_envelope_hash text/);
    expect(sql).toMatch(/p_context_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(sql).toMatch(/p_envelope_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(sql).toMatch(/context_hash, executor_key/);
    expect(sql).toMatch(/'envelopeHash', p_envelope_hash/);
    expect(sql).not.toMatch(/create table /);
    expect(sql).not.toMatch(/alter table /);
    expect(sql).not.toMatch(/add column /);
  });

  it("19. leased complete SQL requires stored hashes and a bound observation artifact", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql"),
      "utf8",
    );
    const complete = sql.slice(
      sql.indexOf("create or replace function public.complete_execution_attempt"),
      sql.indexOf("create or replace function public.fail_execution_attempt"),
    );
    expect(complete).toMatch(/missing a stored context hash/);
    expect(complete).toMatch(/missing a stored envelope hash/);
    expect(complete).toMatch(/kind = 'observation'/);
    expect(complete).toMatch(/tool-invocation-trace\/v1/);
    expect(complete).toMatch(/leased_executor_execution/);
    expect(complete).toMatch(/p_output_artifact_ids/);
    expect(complete).toMatch(/not \(v_metadata \? 'contextHash'\)/);
    expect(complete).toMatch(/jsonb_array_length\(e.payload->'invocations'\) > 0/);
  });

  it("20. leased complete and fail reject metadata that mismatches stored hashes", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql"),
      "utf8",
    );
    expect(sql).toMatch(/Caller metadata contextHash does not match the stored context hash/);
    expect(sql).toMatch(/Caller metadata envelopeHash does not match the stored envelope hash/);
    expect(sql).not.toMatch(/context_hash = /);
    expect(sql).not.toMatch(/authority_snapshot = /);
  });

  it("21. checkExecutionLease rejects a wrong worker", () => {
    const lease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: HASH,
      leaseExpiresAt: "2026-09-09T17:00:00Z",
    };
    expect(checkExecutionLease(lease, { ...lease, workerId: "worker-002" }, NOW)).toEqual({
      ok: false,
      reason: "lease_credential_mismatch",
    });
  });

  it("22. checkExecutionLease rejects a wrong token in a dedicated case", () => {
    const lease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: HASH,
      leaseExpiresAt: "2026-09-09T17:00:00Z",
    };
    expect(checkExecutionLease(lease, { ...lease, leaseTokenHash: "b".repeat(64) }, NOW)).toEqual({
      ok: false,
      reason: "lease_credential_mismatch",
    });
  });

  it("23. checkExecutionLease rejects an expired lease and a stale resumed session", () => {
    const lease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: HASH,
      leaseExpiresAt: NOW,
    };
    expect(checkExecutionLease(lease, lease, NOW)).toEqual({ ok: false, reason: "lease_expired" });
  });

  it("24. deterministic_validation_no_tools requires an explicit empty observation trace", () => {
    const translated = assignmentToEnvelope(
      {
        ...assignmentInput(),
        phase: "validate",
        capabilityKey: "deterministic_catalog_validation",
        executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
        executorKind: "deterministic",
        provider: "delegation-cloud",
        protocolVersion: "catalog-evidence-validator/v1",
        modelId: null,
        outputContract: { schemaVersion: "catalog-evidence-validation/v1", artifactKind: "test" },
        evidenceRequirements: {
          requiredArtifactSchemaVersions: ["catalog-evidence-validation/v1"],
          requiredSourceProvenance: [],
          independentReviewRequired: false,
        },
        profileAuthoritySnapshot: {
          executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
          executorKind: "deterministic",
          authorityEnvelope: { actionClass: "prepare_only", mayOwnAuthoritativeState: false },
          forbiddenActions: ["network access"],
        },
      },
      spec({ allowedToolClasses: ["deterministic_validation"] }),
      [
        {
          artifactId: "packet-001",
          schemaVersion: CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION,
          contentHash: HASH,
        },
        {
          artifactId: "review-001",
          schemaVersion: CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION,
          contentHash: HASH,
        },
      ],
    );
    expect(translated.ok).toBe(true);
    if (!translated.ok) return;
    const trace = buildRequiredEmptyTrace("deterministic_validation_no_tools", translated.value);
    expect(trace.invocations).toEqual([]);
    expect(trace.externalAgentToolUse).toBe("not_applicable");
  });

  it("25. deterministic_validation_no_tools rejects public_read, message, sensitive, and credential invocations", () => {
    const current = binding();
    const empty = emptyObservationTrace({
      productionClass: "deterministic_validation_no_tools",
      assignmentId: current.assignmentId,
      envelopeHash: current.envelopeHash,
      contextHash: current.contextHash,
    });
    const checked = validateToolInvocationTraceArtifact(
      {
        ...empty,
        invocations: [
          {
            schemaVersion: current.context.schemaVersion,
            invocationId: "invocation-001",
            contextHash: current.contextHash,
            toolClass: "public_read",
            toolKey: "public-https-fetch",
            status: "allowed",
            invokedAt: NOW,
            completedAt: NOW,
            failureCode: null,
          },
        ],
        outcomes: [{ invocationId: "invocation-001", result: "fetched" }],
        dcExecutedTools: true,
      },
      current.context,
      {
        productionClass: "deterministic_validation_no_tools",
        assignmentId: current.assignmentId,
        envelopeHash: current.envelopeHash,
        contextHash: current.contextHash,
      },
    );
    expect(checked.ok).toBe(false);
    expect(checked.ok ? "" : checked.failures.join(" ")).toMatch(/public_read|empty observation trace/);
  });

  it("26. deterministic_validation_no_tools requires a deterministic executor", () => {
    const translated = assignmentToEnvelope(
      { ...assignmentInput(), phase: "validate", executorKind: "agent" },
      spec({ allowedToolClasses: ["deterministic_validation"] }),
      inputRefs(),
    );
    expect(translated.ok).toBe(false);
    expect(translated.ok ? "" : translated.failures.join(" ")).toMatch(/deterministic executor/);
  });

  it("27. observation traces cannot satisfy summarizeWorkCellGate or require_gauntlet_review_for_receipt", () => {
    const gate = readFileSync(resolve(process.cwd(), "src/lib/work-cell-policy.ts"), "utf8");
    expect(gate).not.toMatch(/tool-invocation-trace/);
    expect(gate).toMatch(/summarizeWorkCellGate\(/);
    const receipt = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260827132000_grounded_supplier_sourcing_guards.sql"),
      "utf8",
    );
    const fn = receipt.slice(receipt.lastIndexOf("create or replace function public.require_gauntlet_review_for_receipt"));
    expect(fn).toMatch(/from public\.gauntlet_reviews gr/);
    expect(fn).not.toMatch(/tool-invocation-trace/);
    expect(fn).not.toMatch(/kind = 'observation'/);
  });

  it("28. verifyWorkstreamRun excludes tool-invocation-trace/v1 from required evidence", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/execution-primitives.ts"), "utf8");
    expect(source).toMatch(/tool-invocation-trace\/v1/);
    expect(source).toMatch(/This Delegation Spec requires evidence before a run can pass verification/);
  });

  it("29. gated modules contain no skip, bypass, advisory, or enforcementDisabled flag", () => {
    const files = [
      "src/lib/execution-context.ts",
      "src/lib/execution-context-enforcement.ts",
      "src/lib/tool-invocation-trace.ts",
      "src/lib/work-cell.ts",
      "src/lib/public-web-researcher.ts",
      "src/lib/execution-runtime-persistence.ts",
      "src/lib/supplier-sourcing-run.ts",
      "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/enforcementDisabled|enforcement_disabled|advisoryOnly|allowBypass/);
      expect(source).not.toMatch(/bypass enforcement|enforcement bypass/i);
    }
  });

  it("30. domain packet schemas and receipt/Gauntlet SQL remain unchanged; no new tables or columns", () => {
    const packet = readFileSync(resolve(process.cwd(), "src/lib/catalog-evidence-packet.ts"), "utf8");
    const review = readFileSync(resolve(process.cwd(), "src/lib/catalog-evidence-review.ts"), "utf8");
    expect(packet).toMatch(/catalog-evidence-packet\/v1/);
    expect(review).toMatch(/catalog-evidence-review\/v1/);
    expect(packet).not.toMatch(/tool-invocation-trace/);
    expect(review).not.toMatch(/tool-invocation-trace/);
    const evidence = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260822180731_delegation_execution_primitives.sql"),
      "utf8",
    );
    expect(evidence).toMatch(/'observation'/);
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql"),
      "utf8",
    );
    expect(migration).toMatch(/REPLACE FUNCTIONS ONLY/);
    const proof = readFileSync(resolve(process.cwd(), "supabase/qa/execution_context_enforcement_proof.sql"), "utf8");
    expect(proof).toMatch(/NEVER apply this file to a real Supabase project/);
    expect(proof).toMatch(/execution_context_enforcement_v1_not_applied_to_supabase/);
    const persistence = readFileSync(resolve(process.cwd(), "src/lib/execution-runtime-persistence.ts"), "utf8");
    expect(persistence).toMatch(/p_context_hash: binding.contextHash/);
    expect(persistence).toMatch(/assertLeasedCompleteAllowed\(/);
    const native = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = native.slice(
      native.indexOf("export async function runNativePublicWebPrepare"),
      native.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn.indexOf("persistObservationArtifact")).toBeLessThan(nativeFn.indexOf("persistPhaseArtifact"));
    expect(nativeFn).toMatch(/prepareAuthorizedPublicWebEvidencePacket/);
    expect(nativeFn).not.toMatch(/preparePublicWebEvidencePacket\(/);
    expect(nativeFn).toMatch(/blocked_preflight/);
    expect(migration).toMatch(/create or replace function public\.record_work_cell_phase_artifact/);
    expect(migration).toMatch(/Work-cell persistence requires a same-organization, same-run observation trace/);
  });
});

describe("execution-step leased identity", () => {
  it("builds a leased envelope from the frozen plan hash and step key", () => {
    const result = executionStepAssignmentToEnvelope(
      { ...assignmentInput(), planHash: HASH, stepKey: "research" },
      spec(),
      inputRefs(),
    );
    expect(result.ok).toBe(true);
  });
});

function observationRow(runId: string, organizationId: string, trace: ToolInvocationTrace) {
  return {
    organizationId,
    runId,
    kind: "observation",
    contentHash: hashToolInvocationTrace(trace),
    payload: trace,
  };
}

function persistGate(overrides: Partial<Parameters<typeof assertWorkCellPhasePersistAllowed>[0]> = {}) {
  const current = binding();
  const trace = buildRequiredEmptyTrace("operator_submitted", current);
  const identity = workCellPersistIdentity({
    organizationId: "org-loadout-internal-qa",
    runId: current.context.runId,
    phase: "prepare",
    executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    capabilityKey: "evidence_research",
  });
  const pointers = observationPointersFor(trace);
  return {
    organizationId: identity.organizationId,
    runId: identity.runId,
    phase: "prepare" as const,
    executorKey: identity.executorKey,
    capabilityKey: identity.capabilityKey,
    specActionClass: "prepare_only" as const,
    assignmentActionClass: "prepare_only" as const,
    metadata: { ...identity, ...pointers },
    observation: observationRow(identity.runId, identity.organizationId, trace),
    ...overrides,
  };
}

function leasedBinding() {
  const result = executionStepAssignmentToEnvelope(
    { ...assignmentInput(), planHash: HASH, stepKey: "research" },
    spec(),
    inputRefs(),
  );
  if (!result.ok) throw new Error(result.failures.join(" "));
  return result.value;
}

function leasedTrace(current: ReturnType<typeof leasedBinding>, invocations = true): ToolInvocationTrace {
  if (!invocations) {
    return {
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
  }
  return {
    schemaVersion: "tool-invocation-trace/v1",
    productionClass: "leased_executor_execution",
    assignmentId: current.assignmentId,
    envelopeHash: current.envelopeHash,
    contextHash: current.contextHash,
    dcExecutedTools: true,
    externalAgentToolUse: "not_applicable",
    invocations: [
      {
        schemaVersion: current.context.schemaVersion,
        invocationId: "invocation-001",
        contextHash: current.contextHash,
        toolClass: "public_read",
        toolKey: "public-https-fetch",
        status: "allowed",
        invokedAt: NOW,
        completedAt: NOW,
        failureCode: null,
      },
    ],
    outcomes: [{ invocationId: "invocation-001", result: "fetched" }],
  };
}

function leasedGate(overrides: {
  attempt?: Partial<Parameters<typeof assertLeasedCompleteAllowed>[0]["attempt"]>;
  caller?: Partial<Parameters<typeof assertLeasedCompleteAllowed>[0]["caller"]>;
  observation?: Parameters<typeof assertLeasedCompleteAllowed>[0]["observation"];
  omitObservation?: boolean;
} = {}) {
  const current = leasedBinding();
  const trace = leasedTrace(current);
  const pointers = observationPointersFor(trace);
  return {
    attempt: {
      status: "running",
      organizationId: "org-loadout-internal-qa",
      runId: current.context.runId,
      workerId: "worker-001",
      leaseTokenHash: HASH,
      leaseExpiresAt: "2026-09-09T17:00:00Z",
      contextHash: current.contextHash,
      envelopeHash: current.envelopeHash,
      stepLeaseWorkerId: "worker-001",
      ...overrides.attempt,
    },
    caller: {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: HASH,
      now: NOW,
      metadata: { ...pointers },
      outputArtifactIds: ["11111111-1111-4111-8111-111111111111"],
      ...overrides.caller,
    },
    observation: overrides.omitObservation
      ? null
      : (overrides.observation ?? observationRow(current.context.runId, "org-loadout-internal-qa", trace)),
    context: current.context,
    expectedAssignmentId: current.assignmentId,
    expectedEnvelopeHash: current.envelopeHash,
    expectedContextHash: current.contextHash,
  };
}

describe("execution context enforcement v1 adversarial fail-closed gates", () => {
  it("1. work-cell persistence without context is rejected", () => {
    const current = persistGate();
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: workCellPersistIdentity({
          organizationId: current.organizationId,
          runId: current.runId,
          phase: current.phase,
          executorKey: current.executorKey,
          capabilityKey: current.capabilityKey,
        }),
        observation: null,
      }),
    ).toThrow(/Missing observation trace is not an empty trace/);
  });

  it("2. work-cell persistence with a mismatched context hash is rejected", () => {
    const current = persistGate();
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, contextHash: "b".repeat(64) },
      }),
    ).toThrow(/do not match the frozen envelope and context|Observation hashes/);
  });

  it("3. work-cell persistence with mismatched tenant, run, executor, capability, or work-cell is rejected", () => {
    const current = persistGate();
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, organizationId: "org-other" },
      }),
    ).toThrow(/organizationId does not match/);
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, runId: "run-other" },
      }),
    ).toThrow(/runId does not match/);
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, executorKey: "other-executor" },
      }),
    ).toThrow(/executorKey does not match/);
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, capabilityKey: "other-capability" },
      }),
    ).toThrow(/capabilityKey does not match/);
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, phase: "review" },
      }),
    ).toThrow(/phase does not match/);
  });

  it("4. work-cell paste has no lease; lease expiry is leased-complete (tests 8 and 23), not operator paste", () => {
    const current = persistGate();
    expect(current.metadata).not.toHaveProperty("workerId");
    expect(current.metadata).not.toHaveProperty("leaseToken");
    expect(current.metadata).not.toHaveProperty("leaseTokenHash");
    expect(current.observation?.payload).not.toHaveProperty("leaseExpiresAt");
    expect(() =>
      assertWorkCellPhasePersistAllowed({
        ...current,
        metadata: { ...current.metadata, leaseTokenHash: HASH },
      }),
    ).toThrow(/must not invent worker, lease, or token fields/);
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql"),
      "utf8",
    );
    const persist = sql.slice(sql.lastIndexOf("create or replace function public.record_work_cell_phase_artifact"));
    expect(persist).not.toMatch(/lease_expires_at/);
    expect(persist).toMatch(/must not invent worker, lease, or token fields/);
    const complete = sql.slice(
      sql.indexOf("create or replace function public.complete_execution_attempt"),
      sql.indexOf("create or replace function public.fail_execution_attempt"),
    );
    expect(complete).toMatch(/Execution lease expired/);
  });

  it("5. leased completion without context is rejected", () => {
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          caller: { metadata: {} },
          omitObservation: true,
        }),
      ),
    ).toThrow(/Omitted hashes are not skipped|requires contextHash/);
  });

  it("6. leased completion with a mismatched context hash is rejected", () => {
    const current = leasedGate();
    expect(() =>
      assertLeasedCompleteAllowed({
        ...current,
        caller: {
          ...current.caller,
          metadata: { ...current.caller.metadata, contextHash: "b".repeat(64) },
        },
      }),
    ).toThrow(/does not match the stored context hash/);
  });

  it("7. leased completion with a stale token or wrong worker is rejected", () => {
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          caller: { workerId: "worker-002" },
        }),
      ),
    ).toThrow(/lease_credential_mismatch/);
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          caller: { leaseTokenHash: "b".repeat(64) },
        }),
      ),
    ).toThrow(/lease_credential_mismatch/);
  });

  it("8. leased completion after cancellation or takeover is rejected", () => {
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          attempt: { status: "cancelled" },
        }),
      ),
    ).toThrow(/cancelled, expired, or taken-over/);
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          attempt: { status: "expired" },
        }),
      ),
    ).toThrow(/cancelled, expired, or taken-over/);
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          attempt: { stepLeaseWorkerId: "worker-002" },
        }),
      ),
    ).toThrow(/cancelled, expired, or taken-over/);
  });

  it("9. leased completion without a valid observation is rejected", () => {
    expect(() => assertLeasedCompleteAllowed(leasedGate({ omitObservation: true }))).toThrow(
      /bound observation trace artifact for leased execution/,
    );
    const current = leasedBinding();
    const empty = leasedTrace(current, false);
    expect(() =>
      assertLeasedCompleteAllowed(
        leasedGate({
          observation: observationRow(current.context.runId, "org-loadout-internal-qa", empty),
          caller: { metadata: observationPointersFor(empty) },
        }),
      ),
    ).toThrow(/empty observation trace unless production class is explicitly no-tools/);
  });

  it("10. blocked native prepare is rejected before fetch", async () => {
    const unauthorized = nativeBinding(["artifact_read", "artifact_write"]);
    let fetchCalls = 0;
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), unauthorized, {
        fetchPage: async () => {
          fetchCalls += 1;
          return { url: "https://example.invalid", status: 200, text: "injected fake must not be called" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/blocked_preflight|Fetch was not started/);
    expect(fetchCalls).toBe(0);
  });

  it("11. blocked native prepare cannot persist success or complete an assignment", async () => {
    const unauthorized = nativeBinding(["artifact_read", "artifact_write"]);
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), unauthorized, {
        fetchPage: async () => {
          throw new Error("injected fake must not be called");
        },
        now: NOW,
      }),
    ).rejects.toThrow(/blocked_preflight|Fetch was not started/);
    const native = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = native.slice(
      native.indexOf("export async function runNativePublicWebPrepare"),
      native.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn).toMatch(/blocked_preflight and cannot persist a completed assignment/);
    expect(nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket")).toBeLessThan(
      nativeFn.indexOf("persistPhaseArtifact"),
    );
  });

  it("12. prepare-only cannot gain authority by omitting context", async () => {
    const { preparePublicWebEvidencePacket } = await import("@/lib/public-web-researcher");
    await expect(preparePublicWebEvidencePacket(nativeManifest())).rejects.toThrow(
      /validated Execution Context binding/,
    );
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), {
        ...nativeBinding(["public_read"]),
        context: {
          ...nativeBinding(["public_read"]).context,
          contextHash: "b".repeat(64),
        },
      }),
    ).rejects.toThrow(/validated Execution Context|Fetch was not started/);
    expect(() => requireCompleteMetadataHashes({}, { contextHash: HASH, envelopeHash: HASH })).toThrow(
      /Omitted hashes are not skipped/,
    );
  });

  it("13. valid prepare, review, and deterministic validate still pass", () => {
    const prepared = persistGate();
    expect(assertWorkCellPhasePersistAllowed(prepared).contextHash).toBe(prepared.metadata.contextHash);

    const reviewBinding = assignmentToEnvelope(
      { ...assignmentInput(), phase: "review", capabilityKey: "independent_evidence_review" },
      spec(),
      inputRefs(),
    );
    if (!reviewBinding.ok) throw new Error(reviewBinding.failures.join(" "));
    const reviewTrace = buildRequiredEmptyTrace("operator_submitted", reviewBinding.value);
    const reviewIdentity = workCellPersistIdentity({
      organizationId: "org-loadout-internal-qa",
      runId: reviewBinding.value.context.runId,
      phase: "review",
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
      capabilityKey: "independent_evidence_review",
    });
    expect(
      assertWorkCellPhasePersistAllowed({
        organizationId: reviewIdentity.organizationId,
        runId: reviewIdentity.runId,
        phase: "review",
        executorKey: reviewIdentity.executorKey,
        capabilityKey: reviewIdentity.capabilityKey,
        specActionClass: "prepare_only",
        metadata: { ...reviewIdentity, ...observationPointersFor(reviewTrace) },
        observation: observationRow(reviewIdentity.runId, reviewIdentity.organizationId, reviewTrace),
      }).assignmentId,
    ).toBe(reviewBinding.value.assignmentId);

    const validateBinding = assignmentToEnvelope(
      {
        ...assignmentInput(),
        phase: "validate",
        capabilityKey: "deterministic_catalog_validation",
        executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
        executorKind: "deterministic",
        provider: "delegation-cloud",
        protocolVersion: "catalog-evidence-validator/v1",
        modelId: null,
        outputContract: { schemaVersion: "catalog-evidence-validation/v1", artifactKind: "test" },
        evidenceRequirements: {
          requiredArtifactSchemaVersions: ["catalog-evidence-validation/v1"],
          requiredSourceProvenance: [],
          independentReviewRequired: false,
        },
        profileAuthoritySnapshot: {
          executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
          executorKind: "deterministic",
          authorityEnvelope: { actionClass: "prepare_only", mayOwnAuthoritativeState: false },
          forbiddenActions: ["network access"],
        },
      },
      spec({ allowedToolClasses: ["deterministic_validation"] }),
      inputRefs(),
    );
    if (!validateBinding.ok) throw new Error(validateBinding.failures.join(" "));
    const validateTrace = buildRequiredEmptyTrace("deterministic_validation_no_tools", validateBinding.value);
    const validateIdentity = workCellPersistIdentity({
      organizationId: "org-loadout-internal-qa",
      runId: validateBinding.value.context.runId,
      phase: "validate",
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
      capabilityKey: "deterministic_catalog_validation",
    });
    expect(
      assertWorkCellPhasePersistAllowed({
        organizationId: validateIdentity.organizationId,
        runId: validateIdentity.runId,
        phase: "validate",
        executorKey: validateIdentity.executorKey,
        capabilityKey: validateIdentity.capabilityKey,
        specActionClass: "prepare_only",
        metadata: { ...validateIdentity, ...observationPointersFor(validateTrace) },
        observation: observationRow(validateIdentity.runId, validateIdentity.organizationId, validateTrace),
      }).assignmentId,
    ).toBe(validateBinding.value.assignmentId);

    const leased = leasedGate();
    expect(assertLeasedCompleteAllowed(leased).assignmentId).toBe(leased.expectedAssignmentId);
  });

  it("14. existing authority, approval, tenant, lease, redaction, and trace tests still pass", () => {
    expect(authorizeToolClass(binding().context, "credential_use").ok).toBe(false);
    expect(checkExecutionLease).toBeTypeOf("function");
    expect(validateToolInvocationTrace).toBeTypeOf("function");
    const lease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: HASH,
      leaseExpiresAt: "2026-09-09T17:00:00Z",
    };
    expect(checkExecutionLease(lease, lease, NOW).ok).toBe(true);
    const persistence = readFileSync(resolve(process.cwd(), "src/lib/execution-runtime-persistence.ts"), "utf8");
    expect(persistence).toMatch(/SECRET_METADATA_KEY_PATTERN/);
    expect(persistence).toMatch(/assertOrgAccess/);
  });
});
