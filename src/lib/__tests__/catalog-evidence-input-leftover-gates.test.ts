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

function failuresOf(input: unknown): string {
  const result = validateInputManifest(input, sha256Hex);
  return result.ok ? "" : result.failures.join(" ");
}

describe("catalog evidence input leftover fail-closed gates", () => {
  it("rejects padded product and executor identifiers instead of trimming them into a different batch", () => {
    expect(validateInputManifest(manifest({ expectedProductIds: [" ks-sbd-7mm", "belt-sbd-13mm"] }), sha256Hex).ok).toBe(
      false,
    );
    expect(validateInputManifest(manifest({ expectedProductIds: ["ks-sbd-7mm ", "belt-sbd-13mm"] }), sha256Hex).ok).toBe(
      false,
    );
    expect(
      validateInputManifest(
        manifest({
          inputRecords: [
            { productId: " ks-sbd-7mm", record: { thickness: "7mm" } },
            defaultInputRecords()[1],
          ],
        }),
        sha256Hex,
      ).ok,
    ).toBe(false);
    expect(validateInputManifest(manifest({ prepareExecutorKey: " hermes-loadout-researcher-v1" }), sha256Hex).ok).toBe(
      false,
    );
    expect(validateInputManifest(manifest({ reviewExecutorKey: "grok-loadout-reviewer-v1 " }), sha256Hex).ok).toBe(false);
  });

  it("rejects extra keys on a frozen input record so a second product cannot ride the wrapper", () => {
    const planted = {
      ...manifest(),
      inputRecords: [
        { ...defaultInputRecords()[0], substituteProductId: "other-product" },
        defaultInputRecords()[1],
      ],
    };
    expect(validateInputManifest(planted, sha256Hex).ok).toBe(false);
    expect(failuresOf(planted)).toMatch(/Input manifest/i);
  });

  it("fails a frozen hash when run or executor identity changes after the batch is sealed", () => {
    const original = manifest();
    expect(validateInputManifest({ ...original, runId: "run-3d-0002" }, sha256Hex).ok).toBe(false);
    expect(failuresOf({ ...original, runId: "run-3d-0002" })).toMatch(/does not match the hash recomputed/);
    expect(
      validateInputManifest({ ...original, prepareExecutorKey: "other-prepare-executor-v1" }, sha256Hex).ok,
    ).toBe(false);
    expect(
      validateInputManifest({ ...original, reviewExecutorKey: "other-review-executor-v1" }, sha256Hex).ok,
    ).toBe(false);
  });
});
