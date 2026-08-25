import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFINITIONS,
  CAPABILITY_KEYS,
  getCapabilityDefinition,
  hasQualifiedCapability,
  isCapabilityKey,
} from "@/lib/capability-registry";

describe("capability registry", () => {
  it("keeps the vocabulary unique and fully defined", () => {
    expect(new Set(CAPABILITY_KEYS).size).toBe(CAPABILITY_KEYS.length);
    expect(CAPABILITY_DEFINITIONS).toHaveLength(CAPABILITY_KEYS.length);

    for (const key of CAPABILITY_KEYS) {
      const definition = getCapabilityDefinition(key);
      expect(definition?.key).toBe(key);
      expect(isCapabilityKey(key)).toBe(true);
      expect(definition?.displayName).toBeTruthy();
      expect(definition?.verificationContract.implementation).toBeTruthy();
    }
  });

  it("does not treat pending or suspended implementations as qualified", () => {
    expect(
      hasQualifiedCapability(
        [
          { capabilityKey: "evidence_research", qualificationStatus: "pending" },
          { capabilityKey: "evidence_research", qualificationStatus: "suspended" },
        ],
        "evidence_research",
      ),
    ).toBe(false);

    expect(
      hasQualifiedCapability(
        [{ capabilityKey: "deterministic_catalog_validation", qualificationStatus: "qualified" }],
        "deterministic_catalog_validation",
      ),
    ).toBe(true);
  });
});
