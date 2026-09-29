import { describe, expect, it } from "vitest";
import { packet, product } from "@/lib/__tests__/catalog-evidence-fixtures";
import { classifyCatalogDecisions, recommendCorrectiveAction } from "@/lib/work-cell-operator";

// The allowed Hermes retry path. Identity mismatch is already pinned as
// never-retry; this holds the exact-identity escalation that may retry the
// same frozen IDs and still must not write Loadout.

describe("exact-identity Hermes escalation may retry the same executor", () => {
  it("sets retry_same_executor when the only decision is an exact-identity escalation", () => {
    const hermes = packet({
      products: [
        product({
          escalation: { required: true, reason: "Manufacturer page needs a second read for thickness evidence." },
        }),
      ],
    });
    const report = classifyCatalogDecisions({ packet: hermes });
    expect(report.hermesRetryUseful).toBe(true);
    expect(report.loadoutWrite).toBe(false);
    expect(report.decisions).toEqual([
      expect.objectContaining({ kind: "escalation", hermesRetryUseful: true, loadoutWrite: false }),
    ]);

    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("retry_same_executor");
    expect(action.classification).toBe("evidence_failure");
    expect(action.hermesRetryUseful).toBe(true);
    expect(action.loadoutWrite).toBe(false);
    expect(action.nextProductIds).toEqual(["ks-sbd-7mm"]);
    expect(action.droppedProductIds).toEqual([]);
  });

  it("does not treat an exact-identity escalation as retryable when a catalog-side decision remains", () => {
    const hermes = packet({
      products: [
        product({
          escalation: { required: true, reason: "Needs depth." },
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
    expect(report.hermesRetryUseful).toBe(true);
    const action = recommendCorrectiveAction({ packet: hermes, report });
    expect(action.retryDecision).toBe("escalate_human");
    expect(action.hermesRetryUseful).toBe(false);
    expect(action.loadoutWrite).toBe(false);
  });
});
