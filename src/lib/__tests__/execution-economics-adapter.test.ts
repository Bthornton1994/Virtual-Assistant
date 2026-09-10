import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assignmentToEnvelope, type AssignmentToEnvelopeAssignment } from "@/lib/assignment-to-envelope";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";
import { CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION } from "@/lib/catalog-evidence-packet";
import {
  assertSuccessfulCompletionMayProceed,
  attachEconomicsReservationIds,
  attachEconomicsReservationMetadata,
  bindFrozenAuthorityFromTrustedContracts,
  bindNativePublicWebEconomics,
  commitDeferredGovernedReservations,
  createMemoryWorkCellPhaseClaim,
  deriveGovernedIdempotencyKey,
  expireStaleRunningWorkCellPhaseClaim,
  failWorkCellPhaseClaim,
  findAttemptReservations,
  releaseAttemptBoundReservation,
  reportedToolUsage,
  reservationExpiresAt,
  runGovernedExecution,
  WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
  workCellPhaseAlreadyRecordedFromAssignment,
  type GovernedExecutionInput,
  type TrustedGovernedBinding,
} from "@/lib/execution-economics-adapter";
import {
  createPersistedWorkCellProjectionForTests,
  mintTrustedGovernedBinding,
} from "@/lib/execution-economics-binding-internal";
import { snapshotDelegationSpec } from "@/lib/execution-context-enforcement";
import type { DelegationSpecSnapshot } from "@/lib/execution-context";
import {
  ECONOMICS_RESERVATION_IDS_METADATA_KEY,
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
  claimThenPrepareAuthorizedPublicWebEvidencePacket,
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

function nativeAssignment(): AssignmentToEnvelopeAssignment {
  return {
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
  };
}

function nativeBinding() {
  const translated = assignmentToEnvelope(nativeAssignment(), spec(), [
    { artifactId: "input-manifest", schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION, contentHash: HASH },
  ]);
  if (!translated.ok) throw new Error(translated.failures.join(" "));
  return translated.value;
}

function nativeProjection(binding = nativeBinding()) {
  return createPersistedWorkCellProjectionForTests(binding, HASH);
}

function bindNativeEconomics(
  binding = nativeBinding(),
  overrides: {
    session?: EconomicsSession;
    now?: string;
    deadlineAt?: string;
    projection?: ReturnType<typeof nativeProjection>;
    executionAttemptId?: string;
    attemptNumber?: number;
    maxAttempts?: number;
    cancelled?: boolean;
    workCellPhaseAlreadyRecorded?: boolean;
    pricing?: CallerPricing;
  } = {},
) {
  const { session: economicsSession, now, deadlineAt, projection, ...rest } = overrides;
  return bindNativePublicWebEconomics({
    session: economicsSession ?? session(),
    projection: projection ?? nativeProjection(binding),
    organizationId: ORG,
    tenantId: TENANT,
    now: now ?? NOW,
    deadlineAt: deadlineAt ?? DEADLINE,
    ...rest,
  });
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

function mintBinding(
  overrides: {
    session?: EconomicsSession;
    now?: string;
    deadlineAt?: string;
    executionAttemptId?: string;
    attemptNumber?: number;
    maxAttempts?: number;
    cancelled?: boolean;
    workCellPhaseAlreadyRecorded?: boolean;
    lease?: TrustedGovernedBinding["runtime"]["lease"];
    expectedLease?: TrustedGovernedBinding["runtime"]["expectedLease"];
    identityKind?: "work_cell_assignment" | "execution_step_assignment";
    requestedTier?: TrustedGovernedBinding["requestedTier"];
    availableTiers?: TrustedGovernedBinding["availableTiers"];
    escalationReason?: TrustedGovernedBinding["escalationReason"];
    pricing?: CallerPricing;
  } = {},
): TrustedGovernedBinding {
  const identityKind = overrides.identityKind ?? "work_cell_assignment";
  const assignment =
    identityKind === "execution_step_assignment"
      ? { ...nativeAssignment(), planHash: HASH, stepKey: "research" }
      : nativeAssignment();
  const minted = mintTrustedGovernedBinding({
    session: overrides.session ?? session(),
    organizationId: ORG,
    tenantId: TENANT,
    now: overrides.now ?? NOW,
    deadlineAt: overrides.deadlineAt ?? DEADLINE,
    identityKind,
    assignment,
    spec: spec(),
    inputArtifactRefs: [
      { artifactId: "input-manifest", schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION, contentHash: HASH },
    ],
    executionAttemptId: overrides.executionAttemptId ?? "attempt-001",
    attemptNumber: overrides.attemptNumber ?? 1,
    maxAttempts: overrides.maxAttempts ?? 3,
    cancelled: overrides.cancelled,
    workCellPhaseAlreadyRecorded: overrides.workCellPhaseAlreadyRecorded,
    lease: overrides.lease,
    expectedLease: overrides.expectedLease,
    requestedTier: overrides.requestedTier ?? "cheap",
    availableTiers: overrides.availableTiers ?? ["cheap"],
    escalationReason: overrides.escalationReason ?? null,
    pricing: overrides.pricing ?? PRICING,
  });
  if (!minted.ok) throw new Error(minted.failures.join(" "));
  return minted.value;
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

function usageFor(trusted: TrustedGovernedBinding, stepKey = "model-call-1") {
  return reportedToolUsage({
    runtime: trusted.runtime,
    executorTier: "cheap",
    toolKeys: ["model"],
    stepKey,
    idempotencyKey: deriveGovernedIdempotencyKey({
      organizationId: trusted.runtime.organizationId,
      tenantId: trusted.runtime.tenantId,
      runId: trusted.runtime.runId,
      executionAttemptId: trusted.runtime.executionAttemptId,
      assignmentId: trusted.runtime.assignmentId,
      specVersion: trusted.frozenAuthority.specVersion,
      canonicalPlanHash: trusted.frozenAuthority.canonicalPlanHash,
      inputManifestContentHash: trusted.frozenAuthority.inputManifestContentHash,
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
  overrides: Partial<GovernedExecutionInput<T>> & {
    usageOnSuccess?: (result: T) => ReturnType<typeof reportedToolUsage>;
    runtime?: Partial<TrustedGovernedBinding["runtime"]>;
    frozenAuthority?: TrustedGovernedBinding["frozenAuthority"];
    envelope?: TrustedGovernedBinding["envelope"];
    expectedEnvelopeHash?: string;
    context?: TrustedGovernedBinding["context"];
    session?: EconomicsSession;
    pricing?: CallerPricing;
  } = {},
): GovernedExecutionInput<T> {
  const trusted =
    overrides.trustedBinding ??
    mintBinding({
      session: overrides.session,
      requestedTier: overrides.requestedTier,
      availableTiers: overrides.availableTiers,
      escalationReason: overrides.escalationReason,
      pricing: overrides.pricing,
    });
  if (overrides.runtime) Object.assign(trusted.runtime, overrides.runtime);
  if (overrides.frozenAuthority) Object.assign(trusted, { frozenAuthority: overrides.frozenAuthority });
  if (overrides.envelope) Object.assign(trusted, { envelope: overrides.envelope });
  if (overrides.expectedEnvelopeHash !== undefined) Object.assign(trusted, { envelopeHash: overrides.expectedEnvelopeHash });
  if (overrides.context) Object.assign(trusted, { context: overrides.context });
  const stepKey = overrides.stepKey ?? "model-call-1";
  const base: GovernedExecutionInput<T> = {
    trustedBinding: trusted,
    proposedAuthority: trusted.proposedAuthority,
    requestedTier: trusted.requestedTier,
    availableTiers: trusted.availableTiers,
    callKind: "model",
    toolKeys: ["model"],
    stepKey,
    estimatedAiCostMicros: 100,
    estimatedToolCostMicros: 20,
    estimatedCostMicros: 120,
    reservationExpiresAt: reservationExpiresAt(NOW, 60_000),
    execute,
    usageOnSuccess: () => usageFor(trusted, stepKey),
  };
  return { ...base, ...overrides, trustedBinding: trusted, execute: overrides.execute ?? execute };
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

function twoUrlManifest(): CatalogEvidenceInputManifestV1 {
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
          notes: "also https://www.powerlifting.sport/rules/technical-rules",
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
      remainingAtCall.push(request.trustedBinding.session.remainingAiCostMicros);
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
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          runtime: { evaluationClock: "2026-09-10T14:00:00.000Z" },
        },
      ),
    );
    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/Expired Execution Context deadline/);
  });

  it("expired leases block execution", async () => {
    let called = false;
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          runtime: {
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
          },
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
        { runtime: { attemptNumber: 4, maxAttempts: 3 } },
      ),
    );
    const pastDeadline = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        { runtime: { deadlineAt: "2026-09-10T11:00:00.000Z" } },
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
    const observation = request.usageOnSuccess!({ ok: true });
    expect(observation.inputTokens).toBe(10);
    expect(observation.outputTokens).toBe(5);
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commit?.consumedAiCostMicros).toBe(
        (observation.inputTokens ?? 0) * PRICING.inputMicrosPerToken! +
          (observation.outputTokens ?? 0) * PRICING.outputMicrosPerToken!,
      );
      expect(result.commit?.consumedToolCostMicros).toBe(10);
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
    const request = inputFor(async () => ({ ok: true }));
    const result = await runGovernedExecution({
      ...request,
      usageOnSuccess: () => ({
        ...usageFor(request.trustedBinding),
        inputTokens: Number.NaN,
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(true);
      expect(result.failures.join(" ")).toMatch(new RegExp(INVALID_USAGE_FAILURE));
      expect(result.reservation?.state).toBe("reserved");
      const completion = assertSuccessfulCompletionMayProceed({
        session: request.trustedBinding.session,
        organizationId: ORG,
        tenantId: TENANT,
        executionAttemptId: request.trustedBinding.runtime.executionAttemptId,
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
      session: request.trustedBinding.session,
      organizationId: ORG,
      tenantId: TENANT,
      reservationId: result.reservation.reservationId,
      idempotencyKey: result.reservation.idempotencyKey,
      observation: usageFor(request.trustedBinding, "idempotent-1"),
      pricing: PRICING,
      now: NOW,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.committedAt).toBe(result.commit?.committedAt);

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
        session: releaseRequest.trustedBinding.session,
        organizationId: ORG,
        tenantId: TENANT,
        reservationId: released.reservation.reservationId,
        idempotencyKey: released.reservation.idempotencyKey,
        now: NOW,
      });
      const second = releaseReservation({
        session: releaseRequest.trustedBinding.session,
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
    const cases = [
      { runtime: { tenantId: "tenant-other" } },
      { runtime: { runId: "run-other" } },
      { runtime: { workCellPhase: "review" as const } },
      { runtime: { workCellPhaseAlreadyRecorded: true } },
      { runtime: { executorKey: "other-executor" } },
      { runtime: { capabilityKey: "other_capability" } },
      {
        runtime: {
          lease: {
            attemptId: "attempt-other",
            stepKey: "research",
            workerId: "worker-001",
            leaseTokenHash: HASH,
            leaseExpiresAt: DEADLINE,
          },
        },
      },
      { runtime: { cancelled: true } },
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
    const attachedMany = attachEconomicsReservationIds({ phase: "prepare" }, [HASH, "b".repeat(64)]);
    expect(attachedMany[ECONOMICS_RESERVATION_IDS_METADATA_KEY]).toEqual([HASH, "b".repeat(64)]);
    expect(attachedMany[ECONOMICS_RESERVATION_METADATA_KEY]).toBe("b".repeat(64));
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
    const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
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
    ).toBe("reserved");
    const committed = commitDeferredGovernedReservations({
      session: economics.value.session,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      pricing: economics.value.pricing,
      items: fetched.pendingCommits,
    });
    expect(committed.ok).toBe(true);
    expect(
      economics.value.session.reservations.get(fetched.economicReservationIds[0])?.state,
    ).toBe("committed");
  });

  it("native rejected economics never calls fetchPage", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, { cancelled: true });
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
    expect(native.indexOf("runGovernedExecution")).toBeLessThan(native.indexOf("fetchPage(entry.url)"));
    expect(native).toMatch(/toolClass: "public_read"/);
    expect(native).toMatch(/mode: "reserve_only"/);
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
    expect(nativeFn).toMatch(/sealPersistedWorkCellProjectionFromWorkCellLoader/);
    expect(nativeFn).toMatch(/getAssignment/);
    expect(nativeFn).toMatch(/claimWorkCellPhase/);
    expect(nativeFn).toMatch(/failWorkCellPhaseClaim/);
    expect(nativeFn).toMatch(/completeWorkCellPhaseClaim/);
    expect(nativeFn).toMatch(/claimFailureAllowedAfterPrepareOutcome/);
    expect(nativeFn).toMatch(/acceptedCatalogPacketPersisted/);
    expect(nativeFn).toMatch(/workCellPhaseAlreadyRecordedFromAssignment/);
    expect(nativeFn).toMatch(/inputManifestContentHash: frozen.contentHash/);
    expect(nativeFn).not.toMatch(/canonicalPlanHash: frozen.contentHash/);
    expect(nativeFn.indexOf("getAssignment")).toBeLessThan(nativeFn.indexOf("bindWorkCellPhase"));
    expect(nativeFn.indexOf("bindWorkCellPhase")).toBeLessThan(nativeFn.indexOf("claimWorkCellPhase"));
    expect(nativeFn.indexOf("claimWorkCellPhase")).toBeLessThan(nativeFn.indexOf("bindNativePublicWebEconomics"));
    expect(nativeFn.indexOf("claimWorkCellPhase")).toBeLessThan(nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"));
    expect(nativeFn.indexOf("getAssignment")).toBeLessThan(nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"));
    expect(nativeFn.indexOf("CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION")).toBeLessThan(
      nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"),
    );
    expect(nativeFn.indexOf("bindNativePublicWebEconomics")).toBeLessThan(
      nativeFn.indexOf("prepareAuthorizedPublicWebEvidencePacket"),
    );
    expect(nativeFn.indexOf("sealPersistedWorkCellProjectionFromWorkCellLoader")).toBeLessThan(
      nativeFn.indexOf("bindNativePublicWebEconomics"),
    );
    expect(nativeFn.lastIndexOf("persistPhaseArtifact")).toBeLessThan(
      nativeFn.lastIndexOf("commitDeferredGovernedReservations"),
    );
    expect(nativeFn.lastIndexOf("commitDeferredGovernedReservations")).toBeLessThan(
      nativeFn.lastIndexOf("completeWorkCellPhaseClaim"),
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
    const economics = bindNativeEconomics(binding, {
      projection: createPersistedWorkCellProjectionForTests(mutated, HASH),
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
    const result = await runGovernedExecution(
      inputFor(
        async () => {
          called = true;
          return { ok: true };
        },
        {
          runtime: {
            lease: {
              attemptId: "attempt-001",
              stepKey: "research",
              workerId: "worker-001",
              leaseTokenHash: HASH,
              leaseExpiresAt: DEADLINE,
            },
          },
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
          { runtime: { lease: presented, expectedLease } },
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
    const economics = session();
    const requestA = inputFor(async () => ({ ok: true }), {
      session: economics,
      runtime: { executionAttemptId: "attempt-A" },
      stepKey: "step-a",
    });
    const requestB = inputFor(async () => ({ ok: true }), {
      session: economics,
      runtime: { executionAttemptId: "attempt-B" },
      stepKey: "step-b",
    });
    const reservedA = await runGovernedExecution({
      ...requestA,
      usageOnSuccess: () => ({ ...usageFor(requestA.trustedBinding, "step-a"), inputTokens: Number.NaN }),
    });
    const reservedB = await runGovernedExecution({
      ...requestB,
      usageOnSuccess: () => ({ ...usageFor(requestB.trustedBinding, "step-b"), inputTokens: Number.NaN }),
    });
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
    const economics = bindNativeEconomics(binding, { workCellPhaseAlreadyRecorded: true });
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
      runtime: mintBinding().runtime,
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
      runtime: mintBinding().runtime,
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
    const remainingAfterReserveWouldBe = request.trustedBinding.session.remainingAiCostMicros - 100;
    const result = await runGovernedExecution({
      ...request,
      usageOnSuccess: () =>
        reportedToolUsage({
          runtime: request.trustedBinding.runtime,
          executorTier: "cheap",
          toolKeys: ["model"],
          stepKey: "omit-tokens-call",
          idempotencyKey: deriveGovernedIdempotencyKey({
            organizationId: request.trustedBinding.runtime.organizationId,
            tenantId: request.trustedBinding.runtime.tenantId,
            runId: request.trustedBinding.runtime.runId,
            executionAttemptId: request.trustedBinding.runtime.executionAttemptId,
            assignmentId: request.trustedBinding.runtime.assignmentId,
            specVersion: request.trustedBinding.frozenAuthority.specVersion,
            canonicalPlanHash: request.trustedBinding.frozenAuthority.canonicalPlanHash,
            inputManifestContentHash: request.trustedBinding.frozenAuthority.inputManifestContentHash,
            callKind: "model",
            stepKey: "omit-tokens-call",
          }),
          toolCallCount: 1,
          recordedAt: NOW,
        }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commit?.unusedAiCostMicros).toBe(0);
      expect(result.reservation.state).toBe("committed");
      expect(request.trustedBinding.session.remainingAiCostMicros).toBe(remainingAfterReserveWouldBe);
    }
  });

  it("releases on native HTTP and timeout fetch failures without committing", async () => {
    const binding = nativeBinding();
    const httpSession = session();
    const httpEconomics = bindNativeEconomics(binding, {
      session: httpSession,
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
    expect(httpFailed.economicReservationIds).toHaveLength(1);
    expect(httpFailed.reservationLedger[0]?.state).toBe("released");
    expect([...httpSession.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(true);
    expect([...httpSession.reservations.values()].some((reservation) => reservation.state === "released")).toBe(true);

    const timeoutSession = session();
    const timeoutEconomics = bindNativeEconomics(binding, {
      session: timeoutSession,
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
    expect(timedOut.economicReservationIds).toHaveLength(1);
    expect(timedOut.reservationLedger[0]?.state).toBe("released");
    expect([...timeoutSession.reservations.values()].some((reservation) => reservation.state === "released")).toBe(true);
    expect([...timeoutSession.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(true);
  });

  it("releases when usage observation throws before commit", async () => {
    const request = inputFor(async () => ({ ok: true }), {
      usageOnSuccess: () => {
        throw new Error("observer crashed");
      },
    });
    const remainingBefore = request.trustedBinding.session.remainingAiCostMicros;
    const result = await runGovernedExecution(request);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.executed).toBe(true);
      expect(result.reservation?.state).toBe("released");
      expect(result.failures.join(" ")).toMatch(/could not be observed/);
      expect(request.trustedBinding.session.remainingAiCostMicros).toBe(remainingBefore);
    }
  });

  it("native catalog path binds an input-manifest content hash, not a plan hash", () => {
    const frozen = frozenFor();
    expect(frozen.canonicalPlanHash).toBeNull();
    expect(frozen.inputManifestContentHash).toBe(HASH);
    const runtime = mintBinding().runtime;
    expect(runtime.canonicalPlanHash).toBeNull();
    expect(runtime.inputManifestContentHash).toBe(HASH);
    const adapter = readFileSync(resolve(process.cwd(), "src/lib/execution-economics-adapter.ts"), "utf8");
    expect(adapter).not.toMatch(/checkExecutionLease\(runtime\.lease, runtime\.lease/);
  });

  it("concurrent same-run prepares: one claim, one fetch, loser fails before fetch", async () => {
    let arrivals = 0;
    let releaseBarrier: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const store = createMemoryWorkCellPhaseClaim({
      beforeInsert: async () => {
        arrivals += 1;
        if (arrivals === 2) releaseBarrier();
        await barrier;
      },
    });
    const binding = nativeBinding();
    const claimInput = {
      organizationId: ORG,
      tenantId: TENANT,
      runId: binding.context.runId,
      phase: "prepare" as const,
      assignmentId: binding.assignmentId,
      executorKey: PUBLIC_WEB_RESEARCHER_KEY,
      capabilityKey: "public_web_retrieval",
      inputManifestContentHash: HASH,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
      now: NOW,
    };
    let fetchCalls = 0;
    const runOne = () =>
      claimThenPrepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        claimPhase: store.claim,
        failPhase: store.fail,
        claimInput,
        mintEconomics: () => {
          const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
          if (!economics.ok) throw new Error(economics.failures.join(" "));
          return economics.value;
        },
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" };
        },
        now: NOW,
      });
    const results = await Promise.allSettled([runOne(), runOne()]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fetchCalls).toBe(1);
    expect(store.records.size).toBe(1);
    expect(String(rejected[0] && rejected[0].status === "rejected" ? rejected[0].reason : "")).toMatch(
      /already has a recorded attempt|Fetch was not started/,
    );
  });

  it("multi-URL: URL1 success and URL2 fetch error keeps URL1 reserved and represents both ids", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(twoUrlManifest(), binding, {
      economics: economics.value,
      fetchPage: async (url) => {
        if (url.includes("powerlifting.sport")) return { error: "HTTP 503" };
        return { url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" };
      },
      now: NOW,
    });
    expect(fetched.packet.products).toHaveLength(1);
    expect(fetched.economicReservationIds).toHaveLength(2);
    expect(fetched.reservationLedger.map((entry) => entry.state).sort()).toEqual(["released", "reserved"]);
    expect(fetched.pendingCommits).toHaveLength(1);
    expect(fetched.trace.outcomes.some((outcome) => outcome.result === "fetch_failed")).toBe(true);
    expect([...economics.value.session.reservations.values()].some((reservation) => reservation.state === "committed")).toBe(
      false,
    );
  });

  it("multi-URL: URL2 reservation reject releases URL1 and never fetches", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, {
      attemptNumber: 1,
      maxAttempts: 3,
      pricing: { ...PRICING, toolCallMicros: 300 },
    });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    let fetchCalls = 0;
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(twoUrlManifest(), binding, {
        economics: economics.value,
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/Fetch was not started|Outcome Economics Governor/);
    expect(fetchCalls).toBe(0);
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(
      true,
    );
    expect([...economics.value.session.reservations.values()].some((reservation) => reservation.state === "released")).toBe(
      true,
    );
  });

  it("multi-URL: URL2 usage throw releases reserved work and does not commit", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(twoUrlManifest(), binding, {
        economics: economics.value,
        fetchPage: async (url) => ({ url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" }),
        beforeUsageObservation: (stepKey) => {
          if (stepKey === "public-read-2") throw new Error("observer crashed");
        },
        now: NOW,
      }),
    ).rejects.toThrow(/could not be observed|observer crashed/);
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(
      true,
    );
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state === "released")).toBe(
      true,
    );
  });

  it("multi-URL: postflight throw releases reserved URLs without committing", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    await expect(
      prepareAuthorizedPublicWebEvidencePacket(twoUrlManifest(), binding, {
        economics: economics.value,
        fetchPage: async (url) => ({ url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" }),
        beforePostflight: () => {
          throw new Error("trace exploded");
        },
        now: NOW,
      }),
    ).rejects.toThrow(/trace exploded/);
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(
      true,
    );
  });

  it("multi-URL: packet validation/persist failure paths keep all reservation ids and do not commit-and-lose", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(twoUrlManifest(), binding, {
      economics: economics.value,
      fetchPage: async (url) => ({ url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" }),
      now: NOW,
    });
    expect(fetched.economicReservationIds).toHaveLength(2);
    expect(fetched.pendingCommits).toHaveLength(2);
    expect(fetched.reservationLedger.every((entry) => entry.state === "reserved")).toBe(true);
    const attached = attachEconomicsReservationIds({}, fetched.economicReservationIds);
    expect(attached[ECONOMICS_RESERVATION_IDS_METADATA_KEY]).toEqual(fetched.economicReservationIds);
    const { releaseReservedGovernedExecutions } = await import("@/lib/execution-economics-adapter");
    releaseReservedGovernedExecutions({
      session: economics.value.session,
      organizationId: ORG,
      tenantId: TENANT,
      reservationIds: fetched.economicReservationIds,
      now: NOW,
    });
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state === "released")).toBe(
      true,
    );
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(
      true,
    );
    const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const nativeFn = workCell.slice(
      workCell.indexOf("export async function runNativePublicWebPrepare"),
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
    );
    expect(nativeFn.lastIndexOf("persistPhaseArtifact")).toBeLessThan(
      nativeFn.lastIndexOf("commitDeferredGovernedReservations"),
    );
    expect(nativeFn.lastIndexOf("commitDeferredGovernedReservations")).toBeLessThan(
      nativeFn.lastIndexOf("completeWorkCellPhaseClaim"),
    );
    expect(nativeFn).toMatch(/releaseEconomics\(prepared\.economicReservationIds\)/);
  });

  it("forged generic bindings are rejected and factory-minted bindings are accepted", async () => {
    let called = false;
    const minted = mintBinding();
    const forged = {
      ...minted,
      envelopeHash: minted.envelopeHash,
      frozenAuthority: minted.frozenAuthority,
    };
    const rejected = await runGovernedExecution({
      trustedBinding: forged,
      callKind: "model",
      toolKeys: ["model"],
      stepKey: "forged",
      estimatedAiCostMicros: 100,
      estimatedToolCostMicros: 20,
      estimatedCostMicros: 120,
      execute: async () => {
        called = true;
        return { ok: true };
      },
      usageOnSuccess: () => usageFor(minted, "forged"),
    });
    expect(called).toBe(false);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.executed).toBe(false);
      expect(rejected.failures.join(" ")).toMatch(/factory-minted trusted binding/);
    }
    const accepted = await runGovernedExecution(inputFor(async () => ({ ok: true })));
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.reservation.state).toBe("committed");
  });

  it("draft SQL replaces record_work_cell_phase_artifact in place without new tables", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260910193000_work_cell_phase_prefetch_claim_v1.sql"),
      "utf8",
    );
    expect(sql).toMatch(/REPLACE FUNCTION ONLY/);
    expect(sql).toMatch(/SQL_VERIFICATION_NOT_AVAILABLE/);
    expect(sql).toMatch(/create or replace function public\.record_work_cell_phase_artifact/);
    expect(sql).toMatch(/work-cell-phase-prefetch-claim\/v1/);
    expect(sql).toMatch(/for update/);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).toMatch(/No new tables or columns/);
    const failSql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260910204500_work_cell_phase_claim_fail_reclaim_v1.sql"),
      "utf8",
    );
    expect(failSql).toMatch(/SQL_VERIFICATION_NOT_AVAILABLE/);
    expect(failSql).toMatch(/fail_work_cell_phase_claim/);
    expect(failSql).toMatch(/complete_work_cell_phase_claim/);
    expect(failSql).toMatch(/running -> failed/);
    expect(failSql).not.toMatch(/create table/i);
    const safetySql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260910233000_work_cell_phase_claim_economics_safety_v1.sql"),
      "utf8",
    );
    expect(safetySql).toMatch(/SQL_VERIFICATION_NOT_AVAILABLE/);
    expect(safetySql).toMatch(/fail_work_cell_phase_claim/);
    expect(safetySql).toMatch(/complete_work_cell_phase_claim/);
    expect(safetySql).toMatch(/e\.id = p_output_artifact_id/);
    expect(safetySql).toMatch(/unbound or unrelated catalog evidence packet/);
    expect(safetySql).not.toMatch(/create table/i);
  });

  it("self-constructed structurally valid source cannot execute through the exported generic path", async () => {
    const adapter = await import("@/lib/execution-economics-adapter");
    expect(Object.prototype.hasOwnProperty.call(adapter, "mintTrustedGovernedBinding")).toBe(false);
    expect(adapter).not.toHaveProperty("mintTrustedGovernedBinding");
    const adapterSource = readFileSync(resolve(process.cwd(), "src/lib/execution-economics-adapter.ts"), "utf8");
    expect(adapterSource).not.toMatch(/export function mintTrustedGovernedBinding/);
    expect(adapterSource).not.toMatch(/export \{[^}]*mintTrustedGovernedBinding/);

    let called = false;
    const binding = nativeBinding();
    const homemade = {
      session: session(),
      organizationId: ORG,
      tenantId: TENANT,
      context: binding.context,
      envelope: binding.envelope,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
      runtime: mintBinding().runtime,
      frozenAuthority: frozenFor(binding),
      proposedAuthority: frozenFor(binding).authority,
      requestedTier: "cheap" as const,
      availableTiers: ["cheap"] as const,
      escalationReason: null,
      pricing: PRICING,
      reservationTtlMs: 60_000,
    };
    const rejected = await adapter.runGovernedExecution({
      trustedBinding: homemade,
      callKind: "model",
      toolKeys: ["model"],
      stepKey: "self-construct",
      estimatedAiCostMicros: 100,
      estimatedToolCostMicros: 20,
      estimatedCostMicros: 120,
      execute: async () => {
        called = true;
        return { ok: true };
      },
      usageOnSuccess: () => usageFor(mintBinding(), "self-construct"),
    });
    expect(called).toBe(false);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.executed).toBe(false);
      expect(rejected.failures.join(" ")).toMatch(/factory-minted trusted binding|persistence-backed loader/);
    }

    const lookalikeProjection = {
      ...binding,
      inputManifestContentHash: HASH,
    };
    const native = adapter.bindNativePublicWebEconomics({
      session: session(),
      projection: lookalikeProjection,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      deadlineAt: DEADLINE,
    });
    expect(native.ok).toBe(false);
    if (!native.ok) {
      expect(native.failures.join(" ")).toMatch(/persistence-backed work-cell projection/);
    }
  });

  it("handled failure after claim marks the assignment failed and blocks a second fetch", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    const binding = nativeBinding();
    const claimInput = {
      organizationId: ORG,
      tenantId: TENANT,
      runId: binding.context.runId,
      phase: "prepare" as const,
      assignmentId: binding.assignmentId,
      executorKey: PUBLIC_WEB_RESEARCHER_KEY,
      capabilityKey: "public_web_retrieval",
      inputManifestContentHash: HASH,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
      now: NOW,
    };
    let fetchCalls = 0;
    await expect(
      claimThenPrepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        claimPhase: store.claim,
        failPhase: store.fail,
        claimInput,
        mintEconomics: () => {
          const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
          if (!economics.ok) throw new Error(economics.failures.join(" "));
          return economics.value;
        },
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" };
        },
        beforePostflight: () => {
          throw new Error("postflight exploded after claim");
        },
        now: NOW,
      }),
    ).rejects.toThrow(/postflight exploded/);
    expect(fetchCalls).toBe(1);
    expect([...store.records.values()][0]?.status).toBe("failed");

    let secondFetches = 0;
    await expect(
      claimThenPrepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        claimPhase: store.claim,
        failPhase: store.fail,
        claimInput,
        mintEconomics: () => {
          throw new Error("must not mint economics on a stranded retry");
        },
        fetchPage: async (url) => {
          secondFetches += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/already has a recorded attempt|Fetch was not started/);
    expect(secondFetches).toBe(0);
    expect([...store.records.values()][0]?.status).toBe("failed");
  });

  it("crash-left running claims block fetch and reclaim to failed without a second fetch", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    const binding = nativeBinding();
    const claimInput = {
      organizationId: ORG,
      tenantId: TENANT,
      runId: binding.context.runId,
      phase: "prepare" as const,
      assignmentId: binding.assignmentId,
      executorKey: PUBLIC_WEB_RESEARCHER_KEY,
      capabilityKey: "public_web_retrieval",
      inputManifestContentHash: HASH,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
      now: NOW,
    };
    const claimed = await store.claim(claimInput);
    expect(claimed.ok).toBe(true);
    expect([...store.records.values()][0]?.status).toBe("running");

    let fetchCalls = 0;
    await expect(
      claimThenPrepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        claimPhase: store.claim,
        failPhase: store.fail,
        claimInput,
        mintEconomics: () => {
          throw new Error("must not mint economics against a live running claim");
        },
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: NOW,
      }),
    ).rejects.toThrow(/already has a recorded attempt|Fetch was not started/);
    expect(fetchCalls).toBe(0);
    expect([...store.records.values()][0]?.status).toBe("running");

    const tooSoon = await expireStaleRunningWorkCellPhaseClaim(store.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: NOW,
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(tooSoon.ok).toBe(true);
    if (tooSoon.ok) expect(tooSoon.value).toBeNull();
    expect([...store.records.values()][0]?.status).toBe("running");

    const reclaimed = await expireStaleRunningWorkCellPhaseClaim(store.expireStale, {
      runId: claimInput.runId,
      phase: "prepare",
      now: "2026-09-10T12:03:00.000Z",
      ttlMs: WORK_CELL_PHASE_CLAIM_RECLAIM_TTL_MS,
    });
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok) expect(reclaimed.value?.status).toBe("failed");
    expect([...store.records.values()][0]?.status).toBe("failed");

    await expect(
      claimThenPrepareAuthorizedPublicWebEvidencePacket(nativeManifest(), binding, {
        claimPhase: store.claim,
        failPhase: store.fail,
        claimInput,
        mintEconomics: () => {
          throw new Error("must not mint economics after reclaim");
        },
        fetchPage: async (url) => {
          fetchCalls += 1;
          return { url, status: 200, text: "must not fetch" };
        },
        now: "2026-09-10T12:03:00.000Z",
      }),
    ).rejects.toThrow(/already has a recorded attempt|Fetch was not started/);
    expect(fetchCalls).toBe(0);
    expect(store.records.size).toBe(1);
  });

  it("failWorkCellPhaseClaim does not overwrite a completed assignment", async () => {
    const store = createMemoryWorkCellPhaseClaim();
    const binding = nativeBinding();
    const claimInput = {
      organizationId: ORG,
      tenantId: TENANT,
      runId: binding.context.runId,
      phase: "prepare" as const,
      assignmentId: binding.assignmentId,
      executorKey: PUBLIC_WEB_RESEARCHER_KEY,
      capabilityKey: "public_web_retrieval",
      inputManifestContentHash: HASH,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
      now: NOW,
    };
    expect((await store.claim(claimInput)).ok).toBe(true);
    store.recordAcceptedPacket(claimInput.runId, "prepare", "artifact-completed-0001");
    expect(
      (
        await store.complete({
          ...claimInput,
          outputArtifactId: "artifact-completed-0001",
          economicsCommitConfirmed: true,
        })
      ).ok,
    ).toBe(true);
    const failed = await failWorkCellPhaseClaim(store.fail, {
      ...claimInput,
      reason: "must not overwrite completed",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failures.join(" ")).toMatch(/completed/);
    expect([...store.records.values()][0]?.status).toBe("completed");
  });

  it("rolls back the first deferred commit when the second commit fails", async () => {
    const binding = nativeBinding();
    const economics = bindNativeEconomics(binding, { attemptNumber: 1, maxAttempts: 3 });
    if (!economics.ok) throw new Error(economics.failures.join(" "));
    const fetched = await prepareAuthorizedPublicWebEvidencePacket(twoUrlManifest(), binding, {
      economics: economics.value,
      fetchPage: async (url) => ({ url, status: 200, text: "SBD 7mm Knee Sleeves official product page $89.00" }),
      now: NOW,
    });
    expect(fetched.pendingCommits).toHaveLength(2);
    const remainingBefore = economics.value.session.remainingAiCostMicros;
    const remainingToolBefore = economics.value.session.remainingToolCostMicros;
    const releasedAiBefore = economics.value.session.releasedAiCostMicros;
    const releasedToolBefore = economics.value.session.releasedToolCostMicros;
    const commitMapSizeBefore = economics.value.session.commitsByIdempotency.size;
    const firstWouldSucceed = fetched.pendingCommits[0]!;
    const secondFails = {
      ...fetched.pendingCommits[1]!,
      observation: {
        ...fetched.pendingCommits[1]!.observation,
        inputTokens: Number.NaN,
      },
    };

    const committed = commitDeferredGovernedReservations({
      session: economics.value.session,
      organizationId: ORG,
      tenantId: TENANT,
      now: NOW,
      pricing: economics.value.pricing,
      items: [firstWouldSucceed, secondFails],
    });
    expect(committed.ok).toBe(false);
    if (!committed.ok) {
      expect(committed.failures.join(" ")).toMatch(/rolled back|Malformed or non-finite usage/);
    }
    const states = fetched.economicReservationIds.map(
      (id) => economics.value.session.reservations.get(id)?.state ?? "missing",
    );
    expect(states).toEqual(["reserved", "reserved"]);
    expect(economics.value.session.remainingAiCostMicros).toBe(remainingBefore);
    expect(economics.value.session.remainingToolCostMicros).toBe(remainingToolBefore);
    expect(economics.value.session.releasedAiCostMicros).toBe(releasedAiBefore);
    expect(economics.value.session.releasedToolCostMicros).toBe(releasedToolBefore);
    expect(economics.value.session.commitsByIdempotency.size).toBe(commitMapSizeBefore);
    expect(committed.reservationLedger).toEqual([
      { reservationId: fetched.economicReservationIds[0], state: "reserved" },
      { reservationId: fetched.economicReservationIds[1], state: "reserved" },
    ]);
    expect([...economics.value.session.reservations.values()].every((reservation) => reservation.state !== "committed")).toBe(
      true,
    );
  });
});
