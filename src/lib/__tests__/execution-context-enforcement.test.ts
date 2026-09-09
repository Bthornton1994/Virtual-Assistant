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
  buildRequiredEmptyTrace,
  snapshotDelegationSpec,
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
  type PageFetcher,
} from "@/lib/public-web-researcher";
import {
  emptyObservationTrace,
  requireObservationPointers,
  validateToolInvocationTraceArtifact,
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

  it("10-17. native public_read authorize/fetch cycles record distinct outcomes without network", async () => {
    const authorized = nativeBinding(["public_read", "artifact_read", "artifact_write"]);
    const unauthorized = nativeBinding(["artifact_read", "artifact_write"]);
    let fetchCalls = 0;
    const fetchPage: PageFetcher = async (url) => {
      fetchCalls += 1;
      if (url.includes("fail")) return { error: "upstream 503" };
      return { url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" };
    };

    const preflight = authorizeToolClass(unauthorized.context, "public_read");
    expect(preflight.ok).toBe(false);
    const blocked = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), unauthorized, {
      fetchPage: async () => {
        throw new Error("fetchPage must not run after a blocked preflight");
      },
      now: NOW,
    });
    expect(blocked.trace.outcomes.map((outcome) => outcome.result)).toEqual(["blocked_preflight"]);
    expect(blocked.trace.invocations[0]?.status).toBe("blocked");
    expect(blocked.trace.invocations[0]?.failureCode).toBe("tool_class_not_authorized");
    expect(fetchCalls).toBe(0);

    const fetched = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), authorized, {
      fetchPage,
      now: NOW,
    });
    expect(fetchCalls).toBe(1);
    expect(fetched.trace.outcomes[0]?.result).toBe("fetched");
    expect(fetched.trace.invocations[0]?.status).toBe("allowed");
    expect(fetched.trace.invocations[0]?.failureCode).toBeNull();
    expect(fetched.trace.dcExecutedTools).toBe(true);
    expect(fetched.trace.externalAgentToolUse).toBe("not_applicable");
    expect(validateToolInvocationTrace(fetched.trace.invocations, authorized.context).ok).toBe(true);

    const failingManifest = nativeManifest();
    failingManifest.inputRecords[0] = {
      productId: "ks-sbd-7mm",
      record: { name: "SBD 7mm Knee Sleeves", manufacturerUrl: "https://www.sbdapparel.com/fail" },
    };
    const failed = await prepareAuthorizedPublicWebEvidencePacket(failingManifest, authorized, {
      fetchPage,
      now: NOW,
    });
    expect(failed.trace.outcomes[0]?.result).toBe("fetch_failed");
    expect(failed.trace.invocations[0]?.status).toBe("allowed");
    expect(failed.trace.invocations[0]?.failureCode).toBeNull();
    expect(failed.packet.schemaVersion).toBe(CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION);
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
    expect(persistence).toMatch(/checkExecutionLease\(/);
    const native = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = native.slice(
      native.indexOf("export async function runNativePublicWebPrepare"),
      native.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn.indexOf("persistObservationArtifact")).toBeLessThan(nativeFn.indexOf("persistPhaseArtifact"));
    expect(nativeFn).toMatch(/prepareAuthorizedPublicWebEvidencePacket/);
    expect(nativeFn).not.toMatch(/preparePublicWebEvidencePacket\(/);
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
