import { describe, expect, it } from "vitest";
import {
  assertCheaperRouteDoesNotWeakenAuthority,
  assertExecutionLimits,
  assertRedactedEconomicsTelemetry,
  createEconomicsSession,
  evaluateAndReserve,
  governModelUsage,
  pricingIsStale,
  readRuntimeEconomicsReservationId,
  routeExecutorTier,
  type AuthorityFreeze,
  type CallerPricing,
  type EconomicsSession,
  type ReserveInput,
  type RoutingDecision,
} from "@/lib/outcome-economics-governor";

const ORG = "org_northline";
const TENANT = "tenant_northline";
const NOW = "2026-09-10T12:00:00.000Z";
const EXPIRES = "2026-09-10T12:05:00.000Z";
const HASH = "a".repeat(64);
const PRICING: CallerPricing = {
  currency: "USD",
  inputMicrosPerToken: 2,
  outputMicrosPerToken: 4,
  toolCallMicros: 10,
};
const ENVELOPE = { maxAiCostMicros: 1_000, maxToolCostMicros: 500 };

function failuresOf(result: { ok: true } | { ok: false; failures: string[] }): string {
  return result.ok ? "" : result.failures.join(" ");
}

function session(): EconomicsSession {
  const created = createEconomicsSession({
    organizationId: ORG,
    tenantId: TENANT,
    economicEnvelope: ENVELOPE,
  });
  if (!created.ok) throw new Error(created.failures.join("; "));
  return created.value;
}

function cheapRouting(): RoutingDecision {
  const routed = routeExecutorTier({
    availableTiers: ["cheap"],
    requestedTier: "cheap",
  });
  if (!routed.ok) throw new Error(routed.failures.join("; "));
  return routed.value;
}

function reserveInput(
  economics: EconomicsSession,
  overrides: Partial<ReserveInput> = {},
): ReserveInput {
  return {
    session: economics,
    organizationId: ORG,
    tenantId: TENANT,
    runId: "run-001",
    executionAttemptId: "attempt-001",
    assignmentId: "assignment-001",
    capabilityKey: "evidence_research",
    executorKey: "executor-cheap",
    executorTier: "cheap",
    toolKeys: ["public_read"],
    stepKey: "research",
    estimatedAiCostMicros: 100,
    estimatedToolCostMicros: 20,
    estimatedCostMicros: 120,
    unknownPricing: false,
    usageUnavailable: false,
    idempotencyKey: "reserve-1",
    now: NOW,
    expiresAt: EXPIRES,
    routing: cheapRouting(),
    ...overrides,
  };
}

const FROZEN: AuthorityFreeze = {
  actionClass: "prepare_only",
  requiresHumanApproval: true,
  mayOwnAuthoritativeState: false,
  independentReviewRequired: true,
  requiredArtifactSchemaVersions: ["catalog-evidence-packet/v1"],
};

describe("outcome economics leftover identifier and bypass gates", () => {
  it("rejects padded session identifiers and remaining executor bypass instructions", () => {
    const paddedOrg = createEconomicsSession({
      organizationId: " org_northline",
      tenantId: TENANT,
      economicEnvelope: ENVELOPE,
    });
    const paddedTenant = createEconomicsSession({
      organizationId: ORG,
      tenantId: "tenant_northline ",
      economicEnvelope: ENVELOPE,
    });
    const envelopeBypass = createEconomicsSession({
      organizationId: ORG,
      tenantId: TENANT,
      economicEnvelope: { ...ENVELOPE, bypassGovernor: true },
    });
    expect(paddedOrg.ok).toBe(false);
    expect(paddedTenant.ok).toBe(false);
    expect(envelopeBypass.ok).toBe(false);
    expect(failuresOf(paddedOrg)).toMatch(/non-empty trimmed identifier/);
    expect(failuresOf(paddedTenant)).toMatch(/non-empty trimmed identifier/);
    expect(failuresOf(envelopeBypass)).toMatch(/ignore limits/);

    const economics = session();
    const paddedRun = evaluateAndReserve(reserveInput(economics, { runId: "run-001 " }));
    expect(paddedRun.ok).toBe(false);
    expect(failuresOf(paddedRun)).toMatch(/non-empty trimmed identifier/);

    for (const key of ["bypassGovernor", "ignoreLimits", "ignoreBudget", "enforcementDisabled"]) {
      const bypass = assertRedactedEconomicsTelemetry({ [key]: true });
      expect(bypass.ok, key).toBe(false);
      expect(failuresOf(bypass), key).toMatch(/ignore limits/);
    }

    for (const instruction of [
      "bypass the outcome economics governor",
      "unlimited tokens",
      "enforcement disabled",
      "ignore the economic limits",
    ]) {
      const injected = assertRedactedEconomicsTelemetry({ note: instruction });
      expect(injected.ok, instruction).toBe(false);
      expect(failuresOf(injected), instruction).toMatch(/ignore limits/);
    }

    expect(assertRedactedEconomicsTelemetry("not-json").ok).toBe(false);
    expect(failuresOf(assertRedactedEconomicsTelemetry(12))).toMatch(/JSON object/);
    const nestedArray = assertRedactedEconomicsTelemetry([{ prompt: "secret" }]);
    expect(nestedArray.ok).toBe(false);
    expect(failuresOf(nestedArray)).toMatch(/prompt/);
  });
});

describe("outcome economics leftover routing and authority gates", () => {
  it("refuses empty tiers, an unavailable expensive pin, and a cheaper route that raises authority", () => {
    const empty = routeExecutorTier({ availableTiers: [], requestedTier: "cheap" });
    expect(empty.ok).toBe(false);
    expect(failuresOf(empty)).toMatch(/No executor tiers are available/);

    const missing = routeExecutorTier({
      availableTiers: ["cheap"],
      requestedTier: "expensive",
      escalationReason: "capability_requires_expensive_tier",
    });
    expect(missing.ok).toBe(false);
    expect(failuresOf(missing)).toMatch(/not available/);

    const bypassReason = routeExecutorTier({
      availableTiers: ["cheap", "expensive"],
      requestedTier: "expensive",
      escalationReason: "ignoreLimits" as "cheap_failed_with_progress",
    });
    expect(bypassReason.ok).toBe(false);
    expect(failuresOf(bypassReason)).toMatch(/ignore limits/);

    const raised = assertCheaperRouteDoesNotWeakenAuthority({
      frozen: FROZEN,
      proposed: { ...FROZEN, actionClass: "external_execution" },
    });
    expect(raised.ok).toBe(false);
    expect(failuresOf(raised)).toMatch(/action class/);

    const grantsState = assertCheaperRouteDoesNotWeakenAuthority({
      frozen: FROZEN,
      proposed: { ...FROZEN, mayOwnAuthoritativeState: true },
    });
    expect(grantsState.ok).toBe(false);
    expect(failuresOf(grantsState)).toMatch(/authoritative state ownership/);

    const frozenOwnsState = assertCheaperRouteDoesNotWeakenAuthority({
      frozen: { ...FROZEN, mayOwnAuthoritativeState: true },
      proposed: FROZEN,
    });
    expect(frozenOwnsState.ok).toBe(false);
    expect(failuresOf(frozenOwnsState)).toMatch(/executor-owned authoritative state/);
  });
});

describe("outcome economics leftover limit, pricing, and usage gates", () => {
  it("rejects leftover execution-limit, future-dated pricing, and inconsistent usage shapes", () => {
    const zeroAttempt = assertExecutionLimits(
      {
        attemptNumber: 0,
        maxAttempts: 2,
        deadlineAt: EXPIRES,
        workCellPhaseAlreadyRecorded: false,
      },
      Date.parse(NOW),
    );
    const overMax = assertExecutionLimits(
      {
        attemptNumber: 1,
        maxAttempts: 11,
        deadlineAt: EXPIRES,
        workCellPhaseAlreadyRecorded: false,
      },
      Date.parse(NOW),
    );
    expect(zeroAttempt.ok).toBe(false);
    expect(overMax.ok).toBe(false);
    expect(failuresOf(zeroAttempt)).toMatch(/attemptNumber must be a positive integer/);
    expect(failuresOf(overMax)).toMatch(/maxAttempts must be an integer from 1 through 10/);

    const nowMs = Date.parse(NOW);
    expect(
      pricingIsStale({ ...PRICING, quotedAt: "2026-09-10T12:01:00.000Z", maxAgeMs: 60_000 }, nowMs),
    ).toBe(true);
    expect(pricingIsStale({ ...PRICING, quotedAt: "not-a-clock" }, nowMs)).toBe(true);

    const mismatched = governModelUsage(
      { inputTokens: 10, outputTokens: 4, totalTokens: 13 },
      "cheap",
    );
    expect(mismatched.ok).toBe(false);
    expect(failuresOf(mismatched)).toMatch(/inconsistent/);

    expect(readRuntimeEconomicsReservationId(undefined)).toBeNull();
    expect(readRuntimeEconomicsReservationId({ economicReservationId: HASH.toUpperCase() })).toBeNull();
    expect(readRuntimeEconomicsReservationId({ economicReservationId: ` ${HASH}` })).toBeNull();
    expect(readRuntimeEconomicsReservationId({ economicReservationId: HASH, extra: true })).toBe(HASH);
  });
});
