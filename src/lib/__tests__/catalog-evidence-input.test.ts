import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  validateInputManifest,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";

function manifest(overrides: Partial<CatalogEvidenceInputManifestV1> = {}): CatalogEvidenceInputManifestV1 {
  const base = {
    runId: "run-3d-0001",
    market: "US",
    expectedProductIds: ["ks-sbd-7mm", "belt-sbd-13mm"],
    prepareExecutorKey: "hermes-loadout-researcher-v1",
    reviewExecutorKey: "grok-loadout-reviewer-v1",
    ...overrides,
  } as {
    runId: string;
    market: string;
    expectedProductIds: string[];
    prepareExecutorKey: string;
    reviewExecutorKey: string;
  };
  return {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    createdAt: "2026-08-24T09:00:00Z",
    inputHash: sha256Hex(inputManifestHashSource(base)),
    ...base,
    ...overrides,
  } as CatalogEvidenceInputManifestV1;
}

describe("frozen input manifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateInputManifest(manifest(), sha256Hex);
    expect(result.ok).toBe(true);
  });

  it("rejects a manifest whose batch was edited after freezing", () => {
    const tampered = { ...manifest(), expectedProductIds: ["ks-sbd-7mm", "something-else"] };
    const result = validateInputManifest(tampered, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/does not match the hash recomputed/);
  });

  it("rejects a manifest whose market was edited after freezing", () => {
    const tampered = { ...manifest(), market: "UK" };
    const result = validateInputManifest(tampered, sha256Hex);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate product IDs", () => {
    const base = { runId: "run-3d-0001", market: "US", expectedProductIds: ["a", "a"], prepareExecutorKey: "p", reviewExecutorKey: "r" };
    const dupe = {
      schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
      createdAt: "2026-08-24T09:00:00Z",
      inputHash: sha256Hex(inputManifestHashSource(base)),
      ...base,
    };
    const result = validateInputManifest(dupe, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/duplicate product IDs/);
  });

  it("requires at least one expected product", () => {
    const base = { runId: "run-3d-0001", market: "US", expectedProductIds: [] as string[], prepareExecutorKey: "p", reviewExecutorKey: "r" };
    const empty = {
      schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
      createdAt: "2026-08-24T09:00:00Z",
      inputHash: sha256Hex(inputManifestHashSource(base)),
      ...base,
    };
    expect(validateInputManifest(empty, sha256Hex).ok).toBe(false);
  });

  it("identifies the batch as a set, not as the order it was typed", () => {
    const shared = { runId: "r", market: "US", prepareExecutorKey: "p", reviewExecutorKey: "v" };
    const a = inputManifestHashSource({ ...shared, expectedProductIds: ["b", "a"] });
    const b = inputManifestHashSource({ ...shared, expectedProductIds: ["a", "b"] });
    expect(sha256Hex(a)).toBe(sha256Hex(b));
  });

  it("does not fold the freeze timestamp into the batch identity", () => {
    const early = manifest({ createdAt: "2026-08-24T09:00:00Z" });
    const late = manifest({ createdAt: "2026-08-24T18:30:00Z" });
    expect(early.inputHash).toBe(late.inputHash);
    expect(validateInputManifest(late, sha256Hex).ok).toBe(true);
  });

  it("rejects structurally malformed input", () => {
    for (const bad of [null, 7, "text", [], {}, { schemaVersion: "catalog-evidence-input/v2" }]) {
      expect(validateInputManifest(bad, sha256Hex).ok).toBe(false);
    }
  });
});

describe("manifest self-review guard", () => {
  it("rejects a manifest naming one executor for both phases", () => {
    // Enforced at read time, not only at freeze time, so a manifest written by
    // any other path is still held to it.
    const base = {
      runId: "run-3d-0001",
      market: "US",
      expectedProductIds: ["easy-product-1"],
      prepareExecutorKey: "hermes-loadout-researcher-v1",
      reviewExecutorKey: "hermes-loadout-researcher-v1",
    };
    const planted = {
      schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
      ...base,
      createdAt: "2026-08-24T09:00:00Z",
      inputHash: sha256Hex(inputManifestHashSource(base)),
    };
    const result = validateInputManifest(planted, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/cannot independently review its own output/);
  });

  it("accepts distinct prepare and review executors", () => {
    expect(validateInputManifest(manifest(), sha256Hex).ok).toBe(true);
  });
});
