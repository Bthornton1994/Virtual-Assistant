import { describe, expect, it } from "vitest";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import { PRODUCT_ID, packet, product, review } from "@/lib/__tests__/catalog-evidence-fixtures";
import { loadLoadoutProductsFromSource } from "@/lib/loadout-catalog-loader";
import {
  CURRENT_LOADOUT_BATCH_PRODUCT_IDS,
  buildFrozenInputRecords,
  catalogDecisionUi,
  classifyCatalogDecisions,
  correctiveActionFromPacket,
  draftWorkCellReceipt,
  firstNonempty,
  freezeRecordsForNextBatch,
  receiptFormDefaults,
  recommendCorrectiveAction,
  suggestCatalogReplacements,
  workCellSubmitDefaults,
} from "@/lib/work-cell-operator";

describe("work-cell operator toolchain", () => {
  it("uses the three-product freeze batch after phantom SKUs were dropped", () => {
    expect([...CURRENT_LOADOUT_BATCH_PRODUCT_IDS]).toEqual(["ks-sbd-5mm", "shoe-do-win", "suit-inzer-champion"]);
    expect(CURRENT_LOADOUT_BATCH_PRODUCT_IDS).not.toContain("ww-a7-coneface");
    expect(CURRENT_LOADOUT_BATCH_PRODUCT_IDS).not.toContain("belt-averte");
  });

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
    const form = receiptFormDefaults(draft);
    expect(form.definitionOfDoneMet).toBe(false);
    expect(form.verificationStatus).toBe("failed");
    expect(form.summary).toMatch(/No catalog write/);
    expect(form.exceptions).toContain("rejected");
  });

  it("returns the first nonempty string without mixing ?? and ||", () => {
    expect(firstNonempty(undefined, "", "escalate_human")).toBe("escalate_human");
    expect(firstNonempty("source_ambiguity", "unknown")).toBe("source_ambiguity");
    expect(firstNonempty(null, undefined, "")).toBe("");
  });

  it("prefills submit economics and executor keys from work-cell assignments", () => {
    const defaults = workCellSubmitDefaults({
      assignments: [
        {
          phase: "prepare",
          humanMinutes: 12,
          aiCostMicros: 1_500_000,
          toolCostMicros: 250_000,
          profile: { key: "hermes-loadout-researcher-v1" },
        },
        {
          phase: "review",
          humanMinutes: 8,
          aiCostMicros: 900_000,
          toolCostMicros: 0,
          profile: { key: "grok-loadout-reviewer-v1" },
        },
      ],
      notes: "Identity unresolved for ww-a7-coneface. Do not retry Hermes.",
    });
    expect(defaults.humanMinutes).toBe("20");
    expect(defaults.ownerMinutes).toBe("0");
    expect(defaults.aiCostUsd).toBe("2.4000");
    expect(defaults.toolCostUsd).toBe("0.2500");
    expect(JSON.parse(defaults.executorSummary)).toEqual({
      prepare: "hermes-loadout-researcher-v1",
      review: "grok-loadout-reviewer-v1",
      validate: "catalog-evidence-validator-v1",
    });
    expect(defaults.notes).toMatch(/Do not retry Hermes/);
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
    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.classification).toBe("source_ambiguity");
    expect(action.retryDecision).toBe("escalate_human");
    expect(action.droppedProductIds).toEqual(["ww-a7-coneface"]);
    expect(action.nextProductIds).toEqual([]);
    expect(action.loadoutWrite).toBe(false);
  });

  it("keeps exact-identity SKUs as a later freeze and still escalates when any ID mismatches", () => {
    const hermes = packet({
      products: [
        product(),
        product({
          productId: "belt-averte",
          identity: { status: "mismatch", reason: "No manufacturer listing for Averte." },
          claimFindings: [],
          candidateCorrections: [],
          escalation: { required: true, reason: "No manufacturer listing." },
        }),
      ],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("escalate_human");
    expect(action.droppedProductIds).toEqual(["belt-averte"]);
    expect(action.nextProductIds).toEqual(["ks-sbd-7mm"]);
    const next = freezeRecordsForNextBatch(
      [
        { id: "ks-sbd-7mm", name: "SBD 7mm" },
        { id: "belt-averte", name: "Averte" },
      ],
      action,
    );
    expect(Object.keys(next.records)).toEqual(["ks-sbd-7mm"]);
    expect(next.missing).toEqual([]);
    expect(correctiveActionFromPacket({ packet: hermes }).retryDecision).toBe("escalate_human");
  });

  it("suggests same-brand same-category replacements and never writes Loadout", () => {
    const suggestions = suggestCatalogReplacements({
      droppedProductIds: ["ww-a7-coneface", "belt-averte"],
      frozenRecords: {
        "ww-a7-coneface": { id: "ww-a7-coneface", brand: "A7", category: "wrist-wraps", name: "Coneface" },
        "belt-averte": { id: "belt-averte", brand: "Averte", category: "belt", name: "Averte Dual Prong" },
      },
      catalog: [
        { id: "ww-a7-coneface", brand: "A7", category: "wrist-wraps", name: "Coneface" },
        { id: "ww-a7-zebra", brand: "A7", category: "wrist-wraps", name: "Zebra" },
        { id: "ks-a7-conical", brand: "A7", category: "knee-sleeves", name: "Conical" },
        { id: "belt-averte", brand: "Averte", category: "belt", name: "Averte Dual Prong" },
        { id: "belt-sbd-13mm", brand: "SBD", category: "belt", name: "SBD 13mm" },
      ],
    });
    expect(suggestions[0]?.candidates.map((item) => item.id)).toEqual(["ww-a7-zebra"]);
    expect(suggestions[1]?.candidates).toEqual([]);
    expect(suggestions.every((item) => item.loadoutWrite === false)).toBe(true);
  });
});
