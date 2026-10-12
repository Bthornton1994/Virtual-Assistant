import { describe, expect, it } from "vitest";
import {
  frozenWorkCellExecutorKeys,
  getCapabilityDefinition,
  hasQualifiedCapability,
  isCapabilityKey,
  qualifiedImplementationsForCapability,
  supplierSourcingExecutorKeys,
  type CapabilityImplementation,
} from "@/lib/capability-registry";

function implementation(
  overrides: Partial<CapabilityImplementation> = {},
): CapabilityImplementation {
  return {
    capabilityKey: "evidence_research",
    capabilityStatus: "active",
    executorKey: "hermes-loadout-researcher-v1",
    executorKind: "agent",
    profileStatus: "active",
    qualificationStatus: "qualified",
    qualificationVersion: "v1",
    evidenceSummary: "qualified mapping",
    suspendedAt: null,
    ...overrides,
  };
}

describe("capability registry leftover fail-closed gates", () => {
  it("does not treat expired, retired, suspended, or unknown mappings as qualified", () => {
    expect(
      hasQualifiedCapability(
        [{ capabilityKey: "evidence_research", qualificationStatus: "expired" }],
        "evidence_research",
      ),
    ).toBe(false);
    expect(hasQualifiedCapability([], "evidence_research")).toBe(false);
    expect(isCapabilityKey("not_a_capability")).toBe(false);
    expect(isCapabilityKey("evidence_research ")).toBe(false);
    expect(getCapabilityDefinition("evidence_research ")).toBeUndefined();
    expect(getCapabilityDefinition("not_a_capability")).toBeUndefined();

    expect(
      qualifiedImplementationsForCapability(
        [implementation({ qualificationStatus: "expired" })],
        "evidence_research",
      ),
    ).toEqual([]);
    expect(
      qualifiedImplementationsForCapability(
        [implementation({ capabilityStatus: "retired" })],
        "evidence_research",
      ),
    ).toEqual([]);
    expect(
      qualifiedImplementationsForCapability(
        [implementation({ capabilityStatus: "suspended" })],
        "evidence_research",
      ),
    ).toEqual([]);
    expect(
      qualifiedImplementationsForCapability(
        [implementation({ suspendedAt: "2026-01-01T00:00:00.000Z" })],
        "evidence_research",
      ),
    ).toEqual([]);
  });

  it("keeps the Grounded supplier-sourcing freeze off the historical Loadout work-cell keys", () => {
    const workCell = frozenWorkCellExecutorKeys();
    const supplier = supplierSourcingExecutorKeys();

    expect(workCell).toEqual({
      prepare: "hermes-loadout-researcher-v1",
      review: "grok-loadout-reviewer-v1",
      validate: "catalog-evidence-validator-v1",
    });
    expect(supplier).toEqual({
      prepare: "grok-grounded-supplier-researcher-v1",
      review: "grok-grounded-supplier-reviewer-v1",
      validate: "supplier-sourcing-validator-v1",
    });
    expect(new Set(Object.values(supplier)).size).toBe(3);
    for (const key of Object.values(supplier)) {
      expect(Object.values(workCell)).not.toContain(key);
    }
  });

  it("returns only the matching active qualified mapping and ignores a foreign capability row", () => {
    const rows = [
      implementation(),
      implementation({
        capabilityKey: "independent_evidence_review",
        executorKey: "grok-loadout-reviewer-v1",
      }),
      implementation({ capabilityKey: "evidence_research", executorKey: "padded-key ", qualificationStatus: "pending" }),
    ];
    expect(qualifiedImplementationsForCapability(rows, "evidence_research").map((row) => row.executorKey)).toEqual([
      "hermes-loadout-researcher-v1",
    ]);
    expect(qualifiedImplementationsForCapability(rows, "independent_evidence_review").map((row) => row.executorKey)).toEqual([
      "grok-loadout-reviewer-v1",
    ]);
  });
});
