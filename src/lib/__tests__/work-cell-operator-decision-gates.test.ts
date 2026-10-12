import { describe, expect, it } from "vitest";
import { catalogFieldCorrection, packet, product, review } from "@/lib/__tests__/catalog-evidence-fixtures";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import {
  catalogDecisionUi,
  classifyCatalogDecisions,
  recommendCorrectiveAction,
  suggestCatalogReplacements,
  workCellSubmitDefaults,
} from "@/lib/work-cell-operator";

// Remaining catalog-side gates. The operator suite pins mismatch and the
// retry-gates suite pins exact-identity Hermes retry. Losing any of these
// would let Loadout be written or Hermes retried on a catalog decision.

describe("identity-uncertain is a human catalog decision, not a Hermes retry", () => {
  it("drops the uncertain SKU, keeps exact siblings, and never writes Loadout", () => {
    const hermes = packet({
      products: [
        product(),
        product({
          productId: "ww-a7-coneface",
          identity: { status: "uncertain", reason: "Manufacturer page lists two wrap models." },
          claimFindings: [],
          candidateCorrections: [],
        }),
      ],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.loadoutWrite).toBe(false);
    expect(report.hermesRetryUseful).toBe(false);
    expect(report.decisions).toEqual([
      expect.objectContaining({
        productId: "ww-a7-coneface",
        kind: "identity-uncertain",
        action: "human-catalog-decision",
        hermesRetryUseful: false,
        loadoutWrite: false,
      }),
    ]);

    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("escalate_human");
    expect(action.classification).toBe("source_ambiguity");
    expect(action.droppedProductIds).toEqual(["ww-a7-coneface"]);
    expect(action.nextProductIds).toEqual(["ks-sbd-7mm"]);
    expect(action.hermesRetryUseful).toBe(false);
    expect(action.loadoutWrite).toBe(false);
  });
});

describe("catalog-side decisions never retry Hermes", () => {
  it("treats a proposed correction as a human catalog decision", () => {
    const hermes = packet({
      products: [product({ candidateCorrections: [catalogFieldCorrection()] })],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.decisions).toEqual([
      expect.objectContaining({ kind: "proposed-correction", action: "human-catalog-decision", loadoutWrite: false }),
    ]);
    expect(report.hermesRetryUseful).toBe(false);

    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("escalate_human");
    expect(action.classification).toBe("evidence_failure");
    expect(action.hermesRetryUseful).toBe(false);
    expect(action.loadoutWrite).toBe(false);
  });

  it("treats a contradicted claim as a catalog decision even without a review", () => {
    const hermes = packet({
      products: [
        product({
          claimFindings: [
            {
              claimId: "ks-sbd-7mm:thickness",
              field: "thickness",
              catalogValue: "7mm",
              finding: "contradicted",
              evidenceSupportedValue: "5mm",
              severity: "high",
              sourceUrls: ["https://www.sbdapparel.com/products/7mm-knee-sleeves"],
            },
          ],
        }),
      ],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.decisions).toEqual([
      expect.objectContaining({ kind: "claim-contradicted", action: "human-catalog-decision", loadoutWrite: false }),
    ]);
    expect(recommendCorrectiveAction({ packet: hermes, report }).retryDecision).toBe("escalate_human");
  });

  it("treats a reviewer reject as contradicted even when the packet called the claim supported", () => {
    const hermes = packet();
    const report = classifyCatalogDecisions({
      packet: hermes,
      review: review({
        claimReviews: [
          {
            claimId: "ks-sbd-7mm:thickness",
            verdict: "reject",
            independentVerificationPerformed: true,
            reason: "Manufacturer page lists a different thickness.",
            independentSourceUrls: ["https://www.sbdapparel.com/products/7mm-knee-sleeves"],
            severity: "low",
          },
        ],
      }),
    });
    expect(report.decisions).toEqual([
      expect.objectContaining({ kind: "claim-contradicted", hermesRetryUseful: false, loadoutWrite: false }),
    ]);
    expect(recommendCorrectiveAction({ packet: hermes, report }).hermesRetryUseful).toBe(false);
  });
});

describe("price evidence cannot become a list price or a Hermes retry", () => {
  it("flags a sale even when no frozen catalog price is present", () => {
    const hermes = packet({
      products: [
        product({
          priceEvidence: {
            currentDisplayedPrice: 99,
            regularOrCompareAtPrice: 145,
            currency: "USD",
            priceType: "sale",
            market: "US",
            variantScope: "all sizes",
            sourceUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
          },
        }),
      ],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.decisions).toEqual([
      expect.objectContaining({
        kind: "price-disagreement",
        action: "human-price-decision",
        summary: expect.stringMatching(/sale/),
        loadoutWrite: false,
      }),
    ]);
    expect(recommendCorrectiveAction({ packet: hermes, report }).retryDecision).toBe("escalate_human");
  });

  it("flags a frozen catalog price that disagrees with displayed evidence", () => {
    const hermes = packet();
    const report = classifyCatalogDecisions({
      packet: hermes,
      frozenRecords: { "ks-sbd-7mm": { id: "ks-sbd-7mm", price: 89.99 } },
    });
    expect(report.decisions).toEqual([
      expect.objectContaining({
        kind: "price-disagreement",
        summary: expect.stringContaining("89.99"),
        loadoutWrite: false,
      }),
    ]);
    expect(recommendCorrectiveAction({ packet: hermes, report }).loadoutWrite).toBe(false);
  });
});

describe("a clean packet does not invent a retry or a Loadout write", () => {
  it("returns no_retry when there are no catalog decisions", () => {
    const hermes = packet();
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.decisions).toEqual([]);
    expect(report.hermesRetryUseful).toBe(false);
    expect(report.loadoutWrite).toBe(false);
    expect(report.summary).toBe("No catalog decisions from this packet.");

    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("no_retry");
    expect(action.classification).toBe("unknown");
    expect(action.nextProductIds).toEqual(["ks-sbd-7mm"]);
    expect(action.droppedProductIds).toEqual([]);
    expect(action.loadoutWrite).toBe(false);
  });
});

describe("one identity mismatch blocks Hermes retry for the whole batch", () => {
  it("does not retry when a sibling SKU is an exact-identity escalation", () => {
    const hermes = packet({
      products: [
        product({
          escalation: { required: true, reason: "Manufacturer page needs a second read." },
        }),
        product({
          productId: "belt-averte",
          identity: { status: "mismatch", reason: "No manufacturer listing for Averte." },
          claimFindings: [],
          candidateCorrections: [],
        }),
      ],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.decisions.some((item) => item.kind === "escalation" && item.hermesRetryUseful)).toBe(true);
    expect(report.hermesRetryUseful).toBe(false);
    expect(report.loadoutWrite).toBe(false);
    expect(report.summary).toMatch(/Do not retry Hermes/);

    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("escalate_human");
    expect(action.hermesRetryUseful).toBe(false);
    expect(action.droppedProductIds).toEqual(["belt-averte"]);
    expect(action.nextProductIds).toEqual(["ks-sbd-7mm"]);
  });
});

describe("replacement suggestions stay catalog-side", () => {
  it("returns no candidates when brand or category is missing, and never writes Loadout", () => {
    const suggestions = suggestCatalogReplacements({
      droppedProductIds: ["ww-a7-coneface"],
      frozenRecords: { "ww-a7-coneface": { id: "ww-a7-coneface", name: "Coneface" } },
      catalog: [{ id: "ww-a7-zebra", brand: "A7", category: "wrist-wraps", name: "Zebra" }],
    });
    expect(suggestions).toEqual([
      { mismatchedProductId: "ww-a7-coneface", brand: "", category: "", candidates: [], loadoutWrite: false },
    ]);
  });
});

describe("submit defaults and UI stay on the frozen executor keys", () => {
  it("fills missing assignment profiles from the caller keys and always stamps validate", () => {
    const defaults = workCellSubmitDefaults({
      assignments: [
        { phase: "prepare", humanMinutes: 1, aiCostMicros: 0, toolCostMicros: 0, profile: null },
      ],
      prepareExecutorKey: "hermes-loadout-researcher-v1",
      reviewExecutorKey: "grok-loadout-reviewer-v1",
    });
    expect(JSON.parse(defaults.executorSummary)).toEqual({
      prepare: "hermes-loadout-researcher-v1",
      review: "grok-loadout-reviewer-v1",
      validate: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
    });
  });

  it("counts non-identity decisions separately so a price flag is not hidden as identity", () => {
    const report = classifyCatalogDecisions({
      packet: packet({
        products: [
          product({
            identity: { status: "uncertain", reason: "Two models share the SKU." },
            priceEvidence: {
              currentDisplayedPrice: 99,
              regularOrCompareAtPrice: 145,
              currency: "USD",
              priceType: "sale",
              market: "US",
              variantScope: "all sizes",
              sourceUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
            },
          }),
        ],
      }),
    });
    const ui = catalogDecisionUi(report);
    expect(ui.loadoutWrite).toBe(false);
    expect(ui.identitySummaries).toHaveLength(1);
    expect(ui.otherDecisionCount).toBe(1);
  });
});
