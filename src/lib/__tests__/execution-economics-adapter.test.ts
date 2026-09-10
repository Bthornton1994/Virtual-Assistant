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
  reportedToolUsage,
  reservationExpiresAt,
  runGovernedExecution,
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
    canonicalPlanHash: HASH,
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
    specVersion: frozen.specVersion,
    canonicalPlanHash: frozen.canonicalPlanHash,
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
      canonicalPlanHash: HASH,
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
      canonicalPlanHash: HASH,
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
    expect(native.indexOf("runGovernedExecution")).toBeLessThan(native.indexOf("execute: () => fetchPage(url)"));
    expect(native).not.toMatch(/openai|@anthropic|generateText/);
    const persistence = readFileSync(resolve(process.cwd(), "src/lib/execution-runtime-persistence.ts"), "utf8");
    expect(persistence).toMatch(/assertSuccessfulCompletionMayProceed/);
    expect(persistence).toMatch(/economicsSession/);
    const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = workCell.slice(
      workCell.indexOf("export async function runNativePublicWebPrepare"),
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn).toMatch(/bindNativePublicWebEconomics/);
    expect(nativeFn.indexOf("bindNativePublicWebEconomics")).toBeLessThan(
      nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"),
    );
  });
});
