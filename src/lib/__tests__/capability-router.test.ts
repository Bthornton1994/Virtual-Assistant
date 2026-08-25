import { describe, expect, it } from "vitest";
import {
  CAPABILITY_ROUTER_SCHEMA_VERSION,
  routeCapability,
  type CapabilityRouterRequest,
  type RouterImplementation,
} from "@/lib/capability-router";

const HASHLESS: RouterImplementation = {
  executorKey: "hermes-v1",
  capabilityKey: "evidence_research",
  capabilityStatus: "active",
  qualificationStatus: "qualified",
  suspendedAt: null,
  inputContractVersions: ["catalog-evidence-input/v1"],
  outputContractVersions: ["catalog-evidence-packet/v1"],
  maxAuthorityClass: "prepare_only",
  maxDataSensitivity: "public",
  health: "healthy",
  estimatedCostMicros: 100,
  estimatedLatencyMs: 1000,
};

function request(overrides: Partial<CapabilityRouterRequest> = {}): CapabilityRouterRequest {
  return {
    capabilityKey: "evidence_research",
    authorityClass: "prepare_only",
    dataSensitivity: "public",
    inputContractVersion: "catalog-evidence-input/v1",
    outputContractVersion: "catalog-evidence-packet/v1",
    costCeilingMicros: 1000,
    latencySlaMs: 5000,
    implementations: [HASHLESS],
    manualExecutorKey: null,
    ...overrides,
  };
}

describe("capability router v1", () => {
  it("selects deterministically by cost, latency, then executor key", () => {
    const decision = routeCapability(
      request({
        implementations: [
          { ...HASHLESS, executorKey: "zeta-v1", estimatedCostMicros: 100 },
          { ...HASHLESS, executorKey: "alpha-v1", estimatedCostMicros: 100 },
          { ...HASHLESS, executorKey: "cheap-v1", estimatedCostMicros: 50, estimatedLatencyMs: 2000 },
        ],
      }),
    );
    expect(decision).toMatchObject({
      schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
      status: "selected",
      selectionMode: "deterministic",
      selectedExecutorKey: "cheap-v1",
      reason: "deterministic_cost_latency_key_order",
    });
  });

  it("rejects unqualified, incompatible, unhealthy, and over-limit implementations", () => {
    const decision = routeCapability(
      request({
        implementations: [
          { ...HASHLESS, executorKey: "pending-v1", qualificationStatus: "pending" },
          {
            ...HASHLESS,
            executorKey: "wrong-contract-v1",
            inputContractVersions: ["other/v1"],
          },
          { ...HASHLESS, executorKey: "suspended-v1", suspendedAt: "2026-08-25T00:00:00Z" },
          { ...HASHLESS, executorKey: "slow-v1", estimatedLatencyMs: 6000 },
          { ...HASHLESS, executorKey: "sick-v1", health: "degraded" },
        ],
      }),
    );
    expect(decision.status).toBe("blocked");
    expect(decision.reason).toBe("no_eligible_implementation");
    expect(decision.rejected).toHaveLength(5);
    expect(decision.rejected.flatMap((entry) => entry.reasons)).toEqual(
      expect.arrayContaining(["not_qualified", "input_contract_incompatible", "suspended", "latency_sla", "unhealthy"]),
    );
  });

  it("accepts an eligible manual pin without cost-based substitution", () => {
    const decision = routeCapability(
      request({
        manualExecutorKey: "expensive-v1",
        implementations: [
          { ...HASHLESS, executorKey: "cheap-v1", estimatedCostMicros: 1 },
          { ...HASHLESS, executorKey: "expensive-v1", estimatedCostMicros: 900 },
        ],
      }),
    );
    expect(decision).toMatchObject({
      status: "selected",
      selectionMode: "manual",
      selectedExecutorKey: "expensive-v1",
      reason: "manual_pin_accepted",
    });
  });

  it("blocks an invalid manual pin instead of silently falling back", () => {
    const decision = routeCapability(
      request({
        manualExecutorKey: "pending-v1",
        implementations: [
          { ...HASHLESS, executorKey: "pending-v1", qualificationStatus: "pending" },
          { ...HASHLESS, executorKey: "healthy-v1", estimatedCostMicros: 1 },
        ],
      }),
    );
    expect(decision.status).toBe("blocked");
    expect(decision.selectedExecutorKey).toBeNull();
    expect(decision.reason).toBe("manual_pin_ineligible");
    expect(decision.eligibleExecutorKeys).toEqual(["healthy-v1"]);
  });

  it("blocks unknown capabilities and records the rejection artifact", () => {
    const decision = routeCapability(request({ capabilityKey: "unknown_capability" }));
    expect(decision).toMatchObject({
      schemaVersion: CAPABILITY_ROUTER_SCHEMA_VERSION,
      status: "blocked",
      reason: "capability_not_registered",
      selectedExecutorKey: null,
    });
  });

  it("uses a stable tie-break when the same candidates are presented in another order", () => {
    const a = routeCapability(
      request({
        implementations: [
          { ...HASHLESS, executorKey: "beta-v1", estimatedCostMicros: 50, estimatedLatencyMs: 500 },
          { ...HASHLESS, executorKey: "alpha-v1", estimatedCostMicros: 50, estimatedLatencyMs: 500 },
        ],
      }),
    );
    const b = routeCapability(
      request({
        implementations: [
          { ...HASHLESS, executorKey: "alpha-v1", estimatedCostMicros: 50, estimatedLatencyMs: 500 },
          { ...HASHLESS, executorKey: "beta-v1", estimatedCostMicros: 50, estimatedLatencyMs: 500 },
        ],
      }),
    );
    expect(a).toEqual(b);
  });
});
