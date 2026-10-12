import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  validateInputManifest,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";

function defaultInputRecords() {
  return [
    { productId: "ks-sbd-7mm", record: { thickness: "7mm", material: "neoprene" } },
    { productId: "belt-sbd-13mm", record: { width: "4in" } },
  ];
}

function manifest(overrides: Partial<CatalogEvidenceInputManifestV1> = {}): CatalogEvidenceInputManifestV1 {
  const base = {
    runId: "run-3d-0001",
    market: "US",
    expectedProductIds: ["ks-sbd-7mm", "belt-sbd-13mm"],
    inputRecords: defaultInputRecords(),
    prepareExecutorKey: "hermes-loadout-researcher-v1",
    reviewExecutorKey: "grok-loadout-reviewer-v1",
    ...overrides,
  } as {
    runId: string;
    market: string;
    expectedProductIds: string[];
    inputRecords: Array<{ productId: string; record: Record<string, unknown> }>;
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
    const original = manifest();
    // Extend both arrays consistently (so record-shape validation still
    // passes) — the ORIGINAL inputHash was computed over the smaller batch, so
    // this must fail on the hash check specifically, not on record coverage.
    const tampered = {
      ...original,
      expectedProductIds: [...original.expectedProductIds, "something-else"],
      inputRecords: [...original.inputRecords, { productId: "something-else", record: {} }],
    };
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
    const base = {
      runId: "run-3d-0001",
      market: "US",
      expectedProductIds: ["a", "a"],
      inputRecords: [{ productId: "a", record: {} }],
      prepareExecutorKey: "p",
      reviewExecutorKey: "r",
    };
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
    const base = {
      runId: "run-3d-0001",
      market: "US",
      expectedProductIds: [] as string[],
      inputRecords: [] as Array<{ productId: string; record: Record<string, unknown> }>,
      prepareExecutorKey: "p",
      reviewExecutorKey: "r",
    };
    const empty = {
      schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
      createdAt: "2026-08-24T09:00:00Z",
      inputHash: sha256Hex(inputManifestHashSource(base)),
      ...base,
    };
    expect(validateInputManifest(empty, sha256Hex).ok).toBe(false);
  });

  it("identifies the batch as a set, not as the order it was typed", () => {
    const shared = { runId: "r", market: "US", inputRecords: defaultInputRecords(), prepareExecutorKey: "p", reviewExecutorKey: "v" };
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

  it("rejects extra top-level keys so a manifest cannot smuggle a second batch", () => {
    const result = validateInputManifest({ ...manifest(), replacementBatch: ["other-product"] }, sha256Hex);
    expect(result.ok).toBe(false);
  });

  it("rejects a padded runId instead of trimming it into a different identity", () => {
    const result = validateInputManifest(manifest({ runId: " run-3d-0001 " }), sha256Hex);
    expect(result.ok).toBe(false);
  });
});

describe("frozen input records (P1-1)", () => {
  it("rejects a manifest missing a frozen record for an expected product", () => {
    const missing = manifest({ inputRecords: [defaultInputRecords()[0]] });
    const result = validateInputManifest(missing, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/missing a frozen input record for expected product/);
  });

  it("rejects a manifest carrying an input record for a product not in the expected batch", () => {
    const extra = manifest({
      inputRecords: [...defaultInputRecords(), { productId: "unexpected-product", record: {} }],
    });
    const result = validateInputManifest(extra, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/not in the expected batch/);
  });

  it("rejects duplicate input records for the same product", () => {
    const records = defaultInputRecords();
    const duped = manifest({ inputRecords: [...records, { ...records[0] }] });
    const result = validateInputManifest(duped, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/duplicate input records/);
  });

  it("rejects a record whose own embedded productId disagrees with the array key it is frozen under", () => {
    const conflicting = manifest({
      inputRecords: [
        { productId: "ks-sbd-7mm", record: { productId: "some-other-id", thickness: "7mm" } },
        defaultInputRecords()[1],
      ],
    });
    const result = validateInputManifest(conflicting, sha256Hex);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.join(" ")).toMatch(/declares a conflicting productId/);
  });

  it("allows a record whose embedded productId agrees with the array key", () => {
    const consistent = manifest({
      inputRecords: [{ productId: "ks-sbd-7mm", record: { productId: "ks-sbd-7mm", thickness: "7mm" } }, defaultInputRecords()[1]],
    });
    expect(validateInputManifest(consistent, sha256Hex).ok).toBe(true);
  });

  // Explicit QA requirement: Hermes and Grok cannot be handed different actual
  // input snapshots while both truthfully citing the same frozen inputHash.
  // Freezing only expectedProductIds left exactly this gap open: the hash
  // covered the ID list, not the record content, so a manifest with the SAME
  // IDs but DIFFERENT catalog data hashed identically.
  it("changes the inputHash when a frozen record's content changes, even with identical product IDs", () => {
    const shared = { runId: "r", market: "US", expectedProductIds: ["ks-sbd-7mm"], prepareExecutorKey: "p", reviewExecutorKey: "v" };
    const snapshotHermesSaw = inputManifestHashSource({
      ...shared,
      inputRecords: [{ productId: "ks-sbd-7mm", record: { thickness: "7mm" } }],
    });
    const snapshotGrokWasHandedInstead = inputManifestHashSource({
      ...shared,
      inputRecords: [{ productId: "ks-sbd-7mm", record: { thickness: "5mm" } }],
    });
    expect(sha256Hex(snapshotHermesSaw)).not.toBe(sha256Hex(snapshotGrokWasHandedInstead));
  });

  it("does not identify the record set by the order it was typed", () => {
    const shared = { runId: "r", market: "US", expectedProductIds: ["a", "b"], prepareExecutorKey: "p", reviewExecutorKey: "v" };
    const forward = inputManifestHashSource({
      ...shared,
      inputRecords: [
        { productId: "a", record: { x: 1 } },
        { productId: "b", record: { y: 2 } },
      ],
    });
    const reversed = inputManifestHashSource({
      ...shared,
      inputRecords: [
        { productId: "b", record: { y: 2 } },
        { productId: "a", record: { x: 1 } },
      ],
    });
    expect(sha256Hex(forward)).toBe(sha256Hex(reversed));
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
      inputRecords: [{ productId: "easy-product-1", record: {} }],
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
