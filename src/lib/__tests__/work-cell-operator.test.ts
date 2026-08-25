import { describe, expect, it } from "vitest";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import { PRODUCT_ID, packet, product, review } from "@/lib/__tests__/catalog-evidence-fixtures";
import { loadLoadoutProductsFromSource } from "@/lib/loadout-catalog-loader";
import {
  buildFrozenInputRecords,
  catalogDecisionUi,
  classifyCatalogDecisions,
  draftWorkCellReceipt,
} from "@/lib/work-cell-operator";

describe("work-cell operator toolchain", () => {
  it("builds freeze records in the requested product order and reports missing IDs", () => {
    const { records, missing } = buildFrozenInputRecords(
      [
        { id: "b", name: "B" },
        { id: "a", name: "A" },
      ],
      ["a", "missing", "b"],
    );
    expect(Object.keys(records)).toEqual(["a", "b"]);
    expect(records.a.name).toBe("A");
    expect(missing).toEqual(["missing"]);
  });

  it("drafts a failing receipt when the reviewer rejects a claim", () => {
    const hermes = packet();
    const packetHash = hashCatalogEvidencePacket(hermes);
    const grok = review({
      evidencePacketHash: packetHash,
      claimReviews: [
        {
          claimId: "ks-sbd-7mm:thickness",
          verdict: "reject",
          independentVerificationPerformed: true,
          reason: "Price snapshot is promotional.",
          independentSourceUrls: ["https://us.sbdapparel.com/products/7mm-knee-sleeves"],
          severity: "low",
        },
      ],
    });
    const draft = draftWorkCellReceipt({
      packet: hermes,
      review: grok,
      expectedProductIds: [PRODUCT_ID],
    });
    expect(draft.verificationStatus).toBe("failed");
    expect(draft.definitionOfDoneMet).toBe(false);
    expect(draft.packetHash).toBe(packetHash);
    expect(draft.exceptions.some((item) => item.includes("rejected"))).toBe(true);
    expect(draft.summary).toMatch(/No catalog write/);
    expect(draft.definitionOfDoneMet).toBe(false);
  });

  it("loads Loadout PRODUCTS from a type-imported TypeScript source", () => {
    const products = loadLoadoutProductsFromSource(`
import type { Product } from "@/types/product";
export const PRODUCTS: Product[] = [
  { id: "ks-sbd-5mm", name: "SBD 5mm Knee Sleeves", price: 89.99 },
  { id: "belt-averte", name: "Averte Lever Belt", price: 129.99 },
];
`);
    expect(products.map((item) => item.id)).toEqual(["ks-sbd-5mm", "belt-averte"]);
    expect(products[0]?.price).toBe(89.99);
  });

  it("refuses Loadout sources that import runtime modules", () => {
    expect(() =>
      loadLoadoutProductsFromSource(`
import { readFileSync } from "node:fs";
export const PRODUCTS = [{ id: "x" }];
`),
    ).toThrow(/runtime imports/);
  });

  it("does not recommend a Hermes retry when a frozen SKU is an identity mismatch", () => {
    const hermes = packet({
      products: [
        product({
          productId: "ww-a7-coneface",
          identity: { status: "mismatch", reason: "Manufacturer page is a different wrap model." },
          priceEvidence: {
            currentDisplayedPrice: 39.99,
            regularOrCompareAtPrice: 39.99,
            currency: "USD",
            priceType: "regular",
            market: "US",
            variantScope: "all sizes",
            sourceUrl: "https://a7.com/products/other",
          },
        }),
      ],
    });
    const report = classifyCatalogDecisions({
      packet: hermes,
      frozenRecords: { "ww-a7-coneface": { id: "ww-a7-coneface", name: "A7 Coneface Wrist Wraps 24\"", price: 34.99 } },
    });
    expect(report.hermesRetryUseful).toBe(false);
    expect(report.loadoutWrite).toBe(false);
    expect(report.decisions.some((item) => item.kind === "identity-mismatch")).toBe(true);
    expect(report.summary).toMatch(/Do not retry Hermes/);
    const ui = catalogDecisionUi(report);
    expect(ui.hermesRetryUseful).toBe(false);
    expect(ui.identitySummaries.length).toBeGreaterThan(0);
  });
});
