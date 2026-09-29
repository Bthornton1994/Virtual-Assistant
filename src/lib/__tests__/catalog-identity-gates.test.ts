import { describe, expect, it } from "vitest";
import {
  canonicalJsonStringify,
  checkPayloadHash,
  hashCatalogEvidencePacket,
  hashCatalogEvidenceReview,
  sha256Hex,
  sha256Text,
} from "@/lib/catalog-evidence-hash";
import { packet, review } from "@/lib/__tests__/catalog-evidence-fixtures";
import { loadLoadoutProductsFromSource } from "@/lib/loadout-catalog-loader";

describe("catalog evidence identity", () => {
  it("strips undefined keys so a padded object cannot change the frozen hash", () => {
    const compact = { runId: "run-1", extra: undefined as string | undefined };
    const padded = { extra: undefined as string | undefined, runId: "run-1" };

    expect(canonicalJsonStringify(compact)).toBe('{"runId":"run-1"}');
    expect(canonicalJsonStringify(padded)).toBe(canonicalJsonStringify({ runId: "run-1" }));
    expect(sha256Hex(compact)).toBe(sha256Hex({ runId: "run-1" }));
    expect(checkPayloadHash(padded, sha256Hex({ runId: "run-1" }), "packet").tampered).toBe(false);
  });

  it("fingerprints raw executor text separately from canonical JSON", () => {
    expect(sha256Text("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Text("hello")).not.toBe(sha256Hex("hello"));
    expect(sha256Text("hello")).not.toBe(sha256Text("hello "));
  });

  it("binds a review to the exact frozen packet hash and stays stable under key reorder", () => {
    const hermes = packet();
    const packetHash = hashCatalogEvidencePacket(hermes);
    const accepted = review({ evidencePacketHash: packetHash });
    const reordered = {
      ...accepted,
      authorityReport: { ...accepted.authorityReport },
    };

    expect(hashCatalogEvidenceReview(accepted)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCatalogEvidenceReview(reordered)).toBe(hashCatalogEvidenceReview(accepted));
    expect(hashCatalogEvidenceReview(review({ evidencePacketHash: "a".repeat(64) }))).not.toBe(
      hashCatalogEvidenceReview(accepted),
    );
  });
});

describe("Loadout catalog freeze loader", () => {
  it("rejects sources that do not export a PRODUCTS array", () => {
    expect(() =>
      loadLoadoutProductsFromSource(`
export const CATALOG = [{ id: "ks-sbd-5mm" }];
`),
    ).toThrow(/PRODUCTS array/);

    expect(() =>
      loadLoadoutProductsFromSource(`
export const PRODUCTS = { id: "ks-sbd-5mm" };
`),
    ).toThrow(/PRODUCTS array/);

    expect(() =>
      loadLoadoutProductsFromSource(`
export const PRODUCTS = null;
`),
    ).toThrow(/PRODUCTS array/);
  });
});
