import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assignmentToEnvelope } from "@/lib/assignment-to-envelope";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import {
  assertSuccessfulCompletionMayProceed,
  attachEconomicsReservationMetadata,
  bindFrozenAuthorityFromTrustedContracts,
  bindNativePublicWebEconomics,
  deriveGovernedIdempotencyKey,
  findAttemptReservations,
  releaseAttemptBoundReservation,
  reportedToolUsage,
  reservationExpiresAt,
  runGovernedExecution,
  workCellPhaseAlreadyRecordedFromAssignment,
  type GovernedExecutionInput,
  type TrustedExecutionRuntimeState,
} from "@/lib/execution-economics-adapter";
import { snapshotDelegationSpec } from "@/lib/execution-context-enforcement";
import type { DelegationSpecSnapshot } from "@/lib/execution-context";
import {
  ECONOMICS_RESERVATION_METADATA_KEY,
  INVALID_USAGE_FAILURE,
  commitReservation,
  createEconomicsSession,
  releaseReservation,
  type AuthorityFreeze,
  type CallerPricing,
  type EconomicsSession,
} from "@/lib/outcome-economics-governor";
import {
  PUBLIC_WEB_RESEARCHER_KEY,
  prepareAuthorizedPublicWebEvidencePacket,
} from "@/lib/public-web-researcher";

const ORG = "org-loadout-internal-qa";
const TENANT = "org-loadout-internal-qa";
const HASH = "a".repeat(64);
const NOW = "2026-09-10T12:00:00.000Z";
const DEADLINE = "2026-09-10T13:00:00.000Z";
const CREATED = "2026-09-10T11:00:00.000Z";

const PRICING: CallerPricing = {
  currency: "USD",
  inputMicrosPerToken: 2,
  outputMicrosPerToken: 4,
  toolCallMicros: 10,
};

function spec(overrides: Partial<DelegationSpecSnapshot> = {}): DelegationSpecSnapshot {
  return snapshotDelegationSpec({
    specKey: "catalog-integrity-spec",
    specVersion: "delegation-spec/v1",
    actionClass: "prepare_only",
    allowedToolClasses: ["public_read", "artifact_read", "artifact_write"],
    ...overrides,
  });
}

function nativeBinding() {
  const translated = assignmentToEnvelope(
    {
      organizationId: ORG,
      runId: "run-native-0001",
      phase: "prepare" as const,
      capabilityKey: "public_web_retrieval",
      executorKey: PUBLIC_WEB_RESEARCHER_KEY,
      executorKind: "agent" as const,
      provider: "delegation-cloud",
      protocolVersion: "delegation-cloud-public-web-prepare/v1",
      modelId: null,
      configHash: null,
      objective: "Prepare source-backed candidate evidence.",
      createdAt: CREATED,
      deadline: DEADLINE,
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
        executorKey: PUBLIC_WEB_RESEARCHER_KEY,
        executorKind: "agent",
        authorityEnvelope: { actionClass: "prepare_only", mayOwnAuthoritativeState: false },
        forbiddenActions: [],
      },
    },
    spec(),
    [{ artifactId: "input-manifest", schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION, contentHash: HASH }],
  );
  if (!translated.ok) throw new Error(translated.failures.join(" "));
  return translated.value;
}

function session(): EconomicsSession {
  const created = createEconomicsSession({
    organizationId: ORG,
    tenantId: TENANT,
    economicEnvelope: { maxAiCostMicros: 1_000, maxToolCostMicros: 500 },
  });
  if (!created.ok) throw new Error(created.failures.join("; "));
  return created.value;
}

function frozenFor(binding = nativeBinding()) {
  const frozen = bindFrozenAuthorityFromTrustedContracts({
    context: binding.context,
    envelope: binding.envelope,
    inputManifestContentHash: HASH,
  });
  if (!frozen.ok) throw new Error(frozen.failures.join(" "));
  return frozen.value;
}

function runtimeFor(binding = nativeBinding(), overrides: Partial<TrustedExecutionRuntimeState> = {}): TrustedExecutionRuntimeState {
  const frozen = frozenFor(binding);
  return {
    organizationId: ORG,
    tenantId: TENANT,
    runId: binding.context.runId,
    executionAttemptId: "attempt-001",
    assignmentId: binding.assignmentId,
    capabilityKey: binding.context.assignmentSnapshot.capabilityKey,
    executorKey: binding.context.assignmentSnapshot.executorKey,
    workCellPhase: binding.envelope.phase,
    workCellPhaseAlreadyRecorded: false,
    attemptNumber: 1,
    maxAttempts: 3,
    deadlineAt: DEADLINE,
    cancelled: false,
    lease: null,
    expectedLease: null,
    specVersion: frozen.specVersion,
    canonicalPlanHash: frozen.canonicalPlanHash,
    inputManifestContentHash: frozen.inputManifestContentHash,
    evaluationClock: NOW,
    ...overrides,
  };
}

function usageFor(
  binding = nativeBinding(),
  runtime = runtimeFor(binding),
  stepKey = "model-call-1",
) {
  const frozen = frozenFor(binding);
  return reportedToolUsage({
    runtime,
    executorTier: "cheap",
    toolKeys: ["model"],
    stepKey,
    idempotencyKey: deriveGovernedIdempotencyKey({
      organizationId: runtime.organizationId,
      tenantId: runtime.tenantId,
      runId: runtime.runId,
      executionAttemptId: runtime.executionAttemptId,
      assignmentId: runtime.assignmentId,
      specVersion: frozen.specVersion,
      canonicalPlanHash: frozen.canonicalPlanHash,
      inputManifestContentHash: frozen.inputManifestContentHash,
      callKind: "model",
      stepKey,
    }),
    toolCallCount: 1,
    recordedAt: NOW,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  });
}

function inputFor<T>(
  execute: () => Promise<T>,
  overrides: Partial<GovernedExecutionInput<T>> & { usageOnSuccess?: (result: T) => ReturnType<typeof reportedToolUsage> } = {},
): GovernedExecutionInput<T> {
  const binding = nativeBinding();
  const economics = session();
  const runtime = runtimeFor(binding);
  const frozen = frozenFor(binding);
  const stepKey = overrides.stepKey ?? "model-call-1";
  const base: GovernedExecutionInput<T> = {
    session: economics,
    context: binding.context,
    envelope: binding.envelope,
    expectedEnvelopeHash: binding.envelopeHash,
    runtime,
    frozenAuthority: frozen,
    proposedAuthority: frozen.authority,
    requestedTier: "cheap",
    availableTiers: ["cheap"],
    callKind: "model",
    toolKeys: ["model"],
    stepKey,
    estimatedAiCostMicros: 100,
    estimatedToolCostMicros: 20,
    estimatedCostMicros: 120,
    pricing: PRICING,
    reservationExpiresAt: reservationExpiresAt(NOW, 60_000),
    execute,
    usageOnSuccess: () => usageFor(binding, runtime, stepKey),
  };
  return { ...base, ...overrides, session: overrides.session ?? economics, runtime: overrides.runtime ?? runtime };
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
    createdAt: CREATED,
    inputHash: sha256Hex(inputManifestHashSource(base)),
    ...base,
  };
}

describe("execution economics adapter v1", () => {
  it("reserves before the underlying model, tool, or executor call", async () => {
    const events: string[] = [];
    const remainingAtCall: number[] = [];
    const request = inputFor(async () => {
      events.push("execute");
      remainingAtCall.push(request.session.remainingAiCostMicros);
      return { ok: true };
    });
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(true);
    expect(events).toEqual(["execute"]);
    expect(remainingAtCall[0]).toBe(900);
    if (result.ok) expect(result.reservation.state).toBe("committed");
  });

  it("rejected reservations prevent the underlying call", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { estimatedAiCostMicros: 5_000, estimatedCostMicros: 5_020 },
      ),
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    if (!result.ok) expect(result.executed).toBe(false);
  });

  it("held reservations prevent the underlying call", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          requestedTier: "expensive",
          availableTiers: ["cheap", "expensive"],
          escalationReason: "cheap_failed_with_progress",
          usageIncomplete: true,
          estimatedAiCostMicros: 100,
        },
      ),
    );
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
    if (!result.ok) {
      expect(result.decision).toBe("hold");
      expect(result.executed).toBe(false);
    }
  });

  it("expired Execution Context deadlines block execution", async () => {
    let called = false;
    const binding = nativeBinding();
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          context: binding.context,
          envelope: binding.envelope,
          runtime: runtimeFor(binding, { evaluationClock: "2026-09-10T14:00:00.000Z" }),
        },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/Expired Execution Context deadline/);
  });

  it("expired leases block execution", async () => {
    let called = false;
    const binding = nativeBinding();
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          runtime: runtimeFor(binding, {
            lease: {
              attemptId: "attempt-001",
              stepKey: "research",
              workerId: "worker-001",
              leaseTokenHash: HASH,
              leaseExpiresAt: "2026-09-10T11:00:00.000Z",
            },
            expectedLease: {
              attemptId: "attempt-001",
              stepKey: "research",
              workerId: "worker-001",
              leaseTokenHash: HASH,
              leaseExpiresAt: "2026-09-10T11:00:00.000Z",
            },
          }),
        },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/lease_expired/);
  });

  it("attempt and deadline limits are enforced from trusted runtime state", async () => {
    let called = false;
    const overAttempt = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { runtime: runtimeFor(nativeBinding(), { attemptNumber: 4, maxAttempts: 3 }) },
      ),
    );
    const pastDeadline = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { runtime: runtimeFor(nativeBinding(), { deadlineAt: "2026-09-10T11:00:00.000Z" }) },
      ),
    );
    expect(called).toBe(false);
    expect(overAttempt.ok).toBe(false);
    expect(pastDeadline.ok).toBe(false);
    if (!overAttempt.ok) expect(overAttempt.failures.join(" ")).toMatch(/Attempt budget is exhausted/);
    if (!pastDeadline.ok) expect(pastDeadline.failures.join(" ")).toMatch(/deadline/);
  });

  it("weakened authority is rejected before the call", async () => {
    let called = false;
    const frozen = frozenFor();
    const weakened: AuthorityFreeze = { ...frozen.authority, mayOwnAuthoritativeState: true };
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { proposedAuthority: weakened },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/authoritative state/);
  });

  it("cheaper routing cannot drop evidence or approval", async () => {
    let called = false;
    const frozen = frozenFor();
    const dropped: AuthorityFreeze = {
      ...frozen.authority,
      requiresHumanApproval: false,
      independentReviewRequired: false,
      requiredArtifactSchemaVersions: [],
    };
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { proposedAuthority: dropped, requestedTier: "cheap", availableTiers: ["cheap"] },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.join(" ")).toMatch(/independent review|evidence artifact schemas/);
    }
  });

  it("expensive escalation without an explicit reason is rejected", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { requestedTier: "expensive", availableTiers: ["cheap", "expensive"] },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/explainable escalation reason/);
  });

  it("valid usage commits after a successful call", async () => {
    const request = inputFor(async () => ({ ok: true }));
    const observation = request.usageOnSuccess({ ok: true });
    expect(observation.inputTokens).toBe(10);
    expect(observation.outputTokens).toBe(5);
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commit.consumedAiCostMicros).toBe(
        (observation.inputTokens ?? 0) * PRICING.inputMicrosPerToken! +
          (observation.outputTokens ?? 0) * PRICING.outputMicrosPerToken!,
      );
      expect(result.commit.consumedToolCostMicros).toBe(10);
      expect(result.reservation.state).toBe("committed");
    }
  });

  it("failures and cancellations release safely", async () => {
    const failed = await runGovernedExecution(
      inputFor(async () => {
        throw new Error("executor crashed");
      }),
    );
    const cancelled = await runGovernedExecution(
      inputFor(async () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }),
    );
    expect(failed.ok).toBe(false);
    expect(cancelled.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.executed).toBe(true);
      expect(failed.reservation?.state).toBe("released");
    }
    if (!cancelled.ok) {
      expect(cancelled.executed).toBe(true);
      expect(cancelled.reservation?.state).toBe("released");
      expect(cancelled.failures.join(" ")).toMatch(/aborted|timed out|cancelled/);
    }
  });

  it("malformed usage cannot commit and success cannot complete while reserved", async () => {
    const request = inputFor(async () => ({ ok: true }), {
      usageOnSuccess: () => ({
        ...usageFor(nativeBinding()),
        inputTokens: Number.NaN,
      }),
    });
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(true);
      expect(result.failures.join(" ")).toMatch(new RegExp(INVALID_USAGE_FAILURE));
      expect(result.reservation?.state).toBe("reserved");
      const completion = assertSuccessfulCompletionMayProceed({
        session: request.session,
        organizationId: ORG,
        tenantId: TENANT,
        executionAttemptId: request.runtime.executionAttemptId,
        reservationId: result.reservation?.reservationId,
      });
      expect(completion.ok).toBe(false);
      if (!completion.ok) {
        expect(completion.failures.join(" ")).toMatch(/remains reserved/);
      }
    }
  });

  it("duplicate commit and release are idempotent", async () => {
    const request = inputFor(async () => ({ ok: true }), { stepKey: "idempotent-1" });
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failures.join(" "));
    const again = commitReservation({
      session: request.session,
      organizationId: ORG,
      tenantId: TENANT,
      reservationId: result.reservation.reservationId,
      idempotencyKey: result.reservation.idempotencyKey,
      observation: usageFor(nativeBinding(), request.runtime, "idempotent-1"),
      pricing: PRICING,
      now: NOW,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.committedAt).toBe(result.commit.committedAt);

    const releaseRequest = inputFor(
      async () => {
        throw new Error("cancelled");
      },
      { stepKey: "idempotent-release" },
    );
    const released = await runGovernedExecution(releaseRequest);
    expect(released.ok).toBe(false);
    if (!released.ok && released.reservation) {
      const first = releaseReservation({
        session: releaseRequest.session,
        organizationId: ORG,
        tenantId: TENANT,
        reservationId: released.reservation.reservationId,
        idempotencyKey: released.reservation.idempotencyKey,
        now: NOW,
      });
      const second = releaseReservation({
        session: releaseRequest.session,
        organizationId: ORG,
        tenantId: TENANT,
        reservationId: released.reservation.reservationId,
        idempotencyKey: released.reservation.idempotencyKey,
        now: NOW,
      });
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    }
  });

  it("tenant, run, phase, work-cell, executor, capability, attempt, and lease mismatches fail closed", async () => {
    let called = 0;
    const execute = async () => {
      called += 1;
      return { ok: true };
    };
    const binding = nativeBinding();
    const cases = [
      { runtime: runtimeFor(binding, { tenantId: "tenant-other" }) },
      { runtime: runtimeFor(binding, { runId: "run-other" }) },
      { runtime: runtimeFor(binding, { workCellPhase: "review" }) },
      { runtime: runtimeFor(binding, { workCellPhaseAlreadyRecorded: true }) },
      { runtime: runtimeFor(binding, { executorKey: "other-executor" }) },
      { runtime: runtimeFor(binding, { capabilityKey: "other_capability" }) },
      {
        runtime: runtimeFor(binding, {
          lease: {
            attemptId: "attempt-other",
            stepKey: "research",
            workerId: "worker-001",
            leaseTokenHash: HASH,
            leaseExpiresAt: DEADLINE,
          },
        }),
      },
      { runtime: runtimeFor(binding, { cancelled: true }) },
    ];
    for (const overrides of cases) {
      const result = await runGovernedExecution(inputFor(execute, overrides));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.executed).toBe(false);
    }
    expect(called).toBe(0);
  });

  it("redaction remains enforced and prompts never enter telemetry", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { telemetry: { prompt: "do not store", chainOfThought: "hidden" } },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/Telemetry cannot contain/);
    expect(() =>
      attachEconomicsReservationMetadata({ prompt: "secret" }, HASH),
    ).toThrow(/Telemetry cannot contain/);
    const attached = attachEconomicsReservationMetadata({ phase: "prepare" }, HASH);
    expect(attached[ECONOMICS_RESERVATION_METADATA_KEY]).toBe(HASH);
  });

  it("omitted economics binding prevents native fetchPage", async () => {
    let fetchCalls = 0;
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), nativeBinding(), {
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/governed economics binding|Fetch was not started/);
    expect(fetchCalls).toBe(0);
  });

  it("native fetchPage is surrounded by the governor and commits valid tool usage", async () => {
    const binding = nativeBinding();
    const economics = bindNativePublicWebEconomics({
      session: session(),
      binding,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      inputManifestContentHash: HASH,
      deadlineAt: DEADLINE,
      attemptNumber: 1,
      maxAttempts: 3,
    });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    let fetchCalls = 0;
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
      economics: economics.value,
      fetchPage: async (url) => {
        fetchCalls += 1;
        expect(findAttemptReservations(economics.value.session, economics.value.runtime.executionAttemptId).length).toBeGreaterThan(0);
        return { url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" };
      },
      now: NOW,
    });
    expect(fetchCalls).toBe(1);
    expect(fetched.economicReservationIds).toHaveLength(1);
    expect(
      economics.value.session.reservations.get(fetched.economicReservationIds[0])?.state,
    ).toBe("committed");
  });

  it("native rejected economics never calls fetchPage", async () => {
    const binding = nativeBinding();
    const economics = bindNativePublicWebEconomics({
      session: session(),
      binding,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      inputManifestContentHash: HASH,
      deadlineAt: DEADLINE,
      cancelled: true,
    });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    let fetchCalls = 0;
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        economics: economics.value,
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/Fetch was not started|Cancelled execution/);
    expect(fetchCalls).toBe(0);
  });

  it("does not issue Outcome Receipts or mark runs verified", () => {
    const adapter = readFileSync(resolve(process.cwd(), "src/lib/execution-economics-adapter.ts"), "utf8");
    const native = readFileSync(resolve(process.cwd(), "src/lib/public-web-researcher.ts"), "utf8");
    expect(adapter).not.toMatch(/verifyWorkstreamRun|issueOutcomeReceipt|outcome_receipts/);
    expect(native.indexOf("runGovernedExecution")).toBeLessThan(native.indexOf("execute: async () =>"));
    expect(native).toMatch(/toolClass: "public_read"/);
    expect(native).toMatch(/expectedEnvelopeHash: binding.envelopeHash/);
    expect(native).not.toMatch(/openai|@anthropic|generateText/);
    const persistence = readFileSync(resolve(process.cwd(), "src/lib/execution-runtime-persistence.ts"), "utf8");
    expect(persistence).toMatch(/assertSuccessfulCompletionMayProceed/);
    expect(persistence).toMatch(/releaseAttemptBoundReservation/);
    expect(persistence).toMatch(/economicsSession/);
    const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = workCell.slice(
      workCell.indexOf("export async function runNativePublicWebPrepare"),
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn).toMatch(/bindNativePublicWebEconomics/);
    expect(nativeFn).toMatch(/getAssignment/);
    expect(nativeFn).toMatch(/workCellPhaseAlreadyRecordedFromAssignment/);
    expect(nativeFn).toMatch(/inputManifestContentHash: frozen.contentHash/);
    expect(nativeFn).not.toMatch(/canonicalPlanHash: frozen.contentHash/);
    expect(nativeFn.indexOf("getAssignment")).toBeLessThan(nativeFn.indexOf("bindWorkCellPhase"));
    expect(nativeFn.indexOf("getAssignment")).toBeLessThan(nativeFn.indexOf("bindNativePublicWebEconomics"));
    expect(nativeFn.indexOf("getAssignment")).toBeLessThan(nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"));
    expect(nativeFn.indexOf("CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION")).toBeLessThan(
      nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"),
    );
    expect(nativeFn.indexOf("bindNativePublicWebEconomics")).toBeLessThan(
      nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"),
    );
  });

  it("rejects envelope mutation against the trusted expected hash before execute", async () => {
    let called = false;
    const binding = nativeBinding();
    const mutatedEnvelope = {
      ...binding.envelope,
      economicLimit: { ...binding.envelope.economicLimit, maxAiCostMicros: 9_999_999 },
      deadline: "2026-09-10T23:59:59.000Z",
      allowedToolClasses: [...binding.envelope.allowedToolClasses],
    };
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { envelope: mutatedEnvelope, expectedEnvelopeHash: binding.envelopeHash },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/trusted expected envelope hash/);
    }
  });

  it("generic callers without a trusted expected envelope hash fail closed", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { expectedEnvelopeHash: "" },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.executed).toBe(false);
  });

  it("native bind rejects envelope mutation before freezing authority", () => {
    const binding = nativeBinding();
    const mutated = {
      ...binding,
      envelope: {
        ...binding.envelope,
        economicLimit: { ...binding.envelope.economicLimit, maxToolCostMicros: 50_000 },
      },
    };
    const economics = bindNativePublicWebEconomics({
      session: session(),
      binding: mutated,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      inputManifestContentHash: HASH,
      deadlineAt: DEADLINE,
    });
    expect(economics.ok).toBe(false);
    if (!economics.ok) expect(economics.failures.join(" ")).toMatch(/trusted expected envelope hash/);
  });

  it("rejects caller-supplied frozen and proposed authority that both drop approval, review, and evidence", async () => {
    let called = false;
    const frozen = frozenFor();
    const weakened: AuthorityFreeze = {
      ...frozen.authority,
      requiresHumanApproval: false,
      independentReviewRequired: false,
      requiredArtifactSchemaVersions: [],
    };
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          frozenAuthority: { ...frozen, authority: weakened },
          proposedAuthority: weakened,
        },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/re-derived from trusted contracts/);
    }
  });

  it("does not authorize tool work from toolKeys and rejects credential_use before execute", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { callKind: "tool", toolClass: "credential_use", toolKeys: ["credential_use"] },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/credential_use|outside the execution context envelope/);
    }
  });

  it("rejects tool calls that omit an explicit tool class", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { callKind: "tool", toolKeys: ["public_read"] },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/explicit ToolClass/);
    }
  });

  it("rejects executor_process without an explicit authorized tool class", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { callKind: "executor_process", toolKeys: ["process"] },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/not authorized by economics presence alone/);
    }
  });

  it("rejects a non-null lease without a separate trusted expected lease", async () => {
    let called = false;
    const binding = nativeBinding();
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          runtime: runtimeFor(binding, {
            lease: {
              attemptId: "attempt-001",
              stepKey: "research",
              workerId: "worker-001",
              leaseTokenHash: HASH,
              leaseExpiresAt: DEADLINE,
            },
          }),
        },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/trusted expected lease/);
    }
  });

  it("rejects forged leases that match attemptId but not step, worker, or token", async () => {
    const binding = nativeBinding();
    const expectedLease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: HASH,
      leaseExpiresAt: DEADLINE,
    };
    const forgeries = [
      { ...expectedLease, stepKey: "other-step" },
      { ...expectedLease, workerId: "worker-002" },
      { ...expectedLease, leaseTokenHash: "b".repeat(64) },
    ];
    for (const presented of forgeries) {
      let called = false;
      const result = await runGovernedExecution(
        inputFor(
          async () => {
            called = true;
            return { ok: true };
          },
          { runtime: runtimeFor(binding, { lease: presented, expectedLease }) },
        ),
      );
      expect(called).toBe(false);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.executed).toBe(false);
        expect(result.failures.join(" ")).toMatch(/lease_identity_mismatch|lease_credential_mismatch/);
      }
    }
  });

  it("does not release another attempt's reservation on the fail path", async () => {
    const binding = nativeBinding();
    const economics = session();
    const failUsage = (attemptId: string, stepKey: string) => ({
      ...usageFor(binding, runtimeFor(binding, { executionAttemptId: attemptId }), stepKey),
      inputTokens: Number.NaN,
    });
    const reservedA = await runGovernedExecution(
      inputFor(async () => ({ ok: true }), {
        session: economics,
        runtime: runtimeFor(binding, { executionAttemptId: "attempt-A" }),
        stepKey: "step-a",
        usageOnSuccess: () => failUsage("attempt-A", "step-a"),
      }),
    );
    const reservedB = await runGovernedExecution(
      inputFor(async () => ({ ok: true }), {
        session: economics,
        runtime: runtimeFor(binding, { executionAttemptId: "attempt-B" }),
        stepKey: "step-b",
        usageOnSuccess: () => failUsage("attempt-B", "step-b"),
      }),
    );
    expect(reservedA.ok).toBe(false);
    expect(reservedB.ok).toBe(false);
    if (reservedA.ok || reservedB.ok || !reservedA.reservation || !reservedB.reservation) {
      throw new Error("expected both attempts to remain reserved after malformed usage");
    }
    const remainingBefore = economics.remainingAiCostMicros;
    const crossed = releaseAttemptBoundReservation({
      session: economics,
      organizationId: ORG,
      tenantId: TENANT,
      reservationId: reservedB.reservation.reservationId,
      attemptId: "attempt-A",
      now: NOW,
    });
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.failures.join(" ")).toMatch(/does not match the failing attempt/);
    expect(economics.reservations.get(reservedB.reservation.reservationId)?.state).toBe("reserved");
    expect(economics.reservations.get(reservedA.reservation.reservationId)?.state).toBe("reserved");
    expect(economics.remainingAiCostMicros).toBe(remainingBefore);

    const first = releaseAttemptBoundReservation({
      session: economics,
      organizationId: ORG,
      tenantId: TENANT,
      reservationId: reservedA.reservation.reservationId,
      attemptId: "attempt-A",
      now: NOW,
    });
    const second = releaseAttemptBoundReservation({
      session: economics,
      organizationId: ORG,
      tenantId: TENANT,
      reservationId: reservedA.reservation.reservationId,
      attemptId: "attempt-A",
      now: NOW,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(economics.reservations.get(reservedA.reservation.reservationId)?.state).toBe("released");
    expect(economics.reservations.get(reservedB.reservation.reservationId)?.state).toBe("reserved");
  });

  it("derives work-cell phase-already-recorded from a persisted assignment", () => {
    expect(workCellPhaseAlreadyRecordedFromAssignment(null)).toBe(false);
    expect(workCellPhaseAlreadyRecordedFromAssignment(undefined)).toBe(false);
    expect(workCellPhaseAlreadyRecordedFromAssignment({ status: "failed" })).toBe(true);
    expect(workCellPhaseAlreadyRecordedFromAssignment({ status: "completed" })).toBe(true);
    expect(workCellPhaseAlreadyRecordedFromAssignment({ status: "blocked" })).toBe(true);
    expect(workCellPhaseAlreadyRecordedFromAssignment({ status: "planned" })).toBe(true);
  });

  it("existing recorded prepare assignment blocks native fetch before economics execute", async () => {
    const binding = nativeBinding();
    const economics = bindNativePublicWebEconomics({
      session: session(),
      binding,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      inputManifestContentHash: HASH,
      deadlineAt: DEADLINE,
      workCellPhaseAlreadyRecorded: true,
    });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    let fetchCalls = 0;
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        economics: economics.value,
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/already has a recorded attempt|Fetch was not started/);
    expect(fetchCalls).toBe(0);
  });

  it("omitted token usage stays null and does not refund a cheap reservation", async () => {
    const omitted = reportedToolUsage({
      runtime: runtimeFor(),
      executorTier: "cheap",
      toolKeys: ["model"],
      stepKey: "omit-tokens",
      idempotencyKey: "omit-tokens",
      toolCallCount: 1,
      recordedAt: NOW,
    });
    expect(omitted.inputTokens).toBeNull();
    expect(omitted.outputTokens).toBeNull();
    expect(omitted.totalTokens).toBeNull();
    const explicitZero = reportedToolUsage({
      runtime: runtimeFor(),
      executorTier: "cheap",
      toolKeys: ["model"],
      stepKey: "zero-tokens",
      idempotencyKey: "zero-tokens",
      toolCallCount: 1,
      recordedAt: NOW,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    expect(explicitZero.inputTokens).toBe(0);
    expect(explicitZero.outputTokens).toBe(0);

    const request = inputFor(async () => ({ ok: true }), { stepKey: "omit-tokens-call" });
    const remainingAfterReserveWouldBe = request.session.remainingAiCostMicros - 100;
    const result = await runGovernedExecution({
      ...request,
      usageOnSuccess: () =>
        reportedToolUsage({
          runtime: request.runtime,
          executorTier: "cheap",
          toolKeys: ["model"],
          stepKey: "omit-tokens-call",
          idempotencyKey: deriveGovernedIdempotencyKey({
            organizationId: request.runtime.organizationId,
            tenantId: request.runtime.tenantId,
            runId: request.runtime.runId,
            executionAttemptId: request.runtime.executionAttemptId,
            assignmentId: request.runtime.assignmentId,
            specVersion: request.frozenAuthority.specVersion,
            canonicalPlanHash: request.frozenAuthority.canonicalPlanHash,
            inputManifestContentHash: request.frozenAuthority.inputManifestContentHash,
            callKind: "model",
            stepKey: "omit-tokens-call",
          }),
          toolCallCount: 1,
          recordedAt: NOW,
        }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commit.unusedAiCostMicros).toBe(0);
      expect(result.reservation.state).toBe("committed");
      expect(request.session.remainingAiCostMicros).toBe(remainingAfterReserveWouldBe);
    }
  });

  it("releases on native HTTP and timeout fetch failures without committing", async () => {
    const binding = nativeBinding();
    const httpSession = session();
    const httpEconomics = bindNativePublicWebEconomics({
      session: httpSession,
      binding,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      inputManifestContentHash: HASH,
      deadlineAt: DEADLINE,
      attemptNumber: 1,
      maxAttempts: 3,
    });
    if (!httpEconomics.ok) throw new Error(httpEconomics.failures.join(" "));
    let httpFetches = 0;
    const httpFailed = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
      economics: httpEconomics.value,
      fetchPage: async () => {
        httpFetches += 1;
        return { error: "HTTP 503" };
      },
      now: NOW,
    });
    expect(httpFetches).toBe(1);
    expect(httpFailed.trace.outcomes[0]?.result).toBe("fetch_failed");
    expect(httpFailed.economicReservationIds).toHaveLength(0);
    expect([...httpSession.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(true);
    expect([...httpSession.reservations.values()].some((reservation) => reservation.state === "released")).toBe(true);

    const timeoutSession = session();
    const timeoutEconomics = bindNativePublicWebEconomics({
      session: timeoutSession,
      binding,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      inputManifestContentHash: HASH,
      deadlineAt: DEADLINE,
      attemptNumber: 1,
      maxAttempts: 3,
    });
    if (!timeoutEconomics.ok) throw new Error(timeoutEconomics.failures.join(" "));
    const timedOut = await prepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
      economics: timeoutEconomics.value,
      fetchPage: async () => ({ error: "The operation was aborted" }),
      now: NOW,
    });
    expect(timedOut.trace.outcomes[0]?.result).toBe("fetch_failed");
    expect(timedOut.economicReservationIds).toHaveLength(0);
    expect([...timeoutSession.reservations.values()].some((reservation) => reservation.state === "released")).toBe(true);
    expect([...timeoutSession.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(true);
  });

  it("releases when usage observation throws before commit", async () => {
    const request = inputFor(async () => ({ ok: true }), {
      usageOnSuccess: () => {
        throw new Error("observer crashed");
      },
    });
    const remainingBefore = request.session.remainingAiCostMicros;
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(true);
      expect(result.reservation?.state).toBe("released");
      expect(result.failures.join(" ")).toMatch(/could not be observed/);
      expect(request.session.remainingAiCostMicros).toBe(remainingBefore);
    }
  });

  it("native catalog path binds an input-manifest content hash, not a plan hash", () => {
    const frozen = frozenFor();
    expect(frozen.canonicalPlanHash).toBeNull();
    expect(frozen.inputManifestContentHash).toBe(HASH);
    const runtime = runtimeFor();
    expect(runtime.canonicalPlanHash).toBeNull();
    expect(runtime.inputManifestContentHash).toBe(HASH);
    const adapter = readFileSync(resolve(process.cwd(), "src/lib/execution-economics-adapter.ts"), "utf8");
    expect(adapter).not.toMatch(/checkExecutionLease\(runtime\.lease, runtime\.lease/);
  });
});
