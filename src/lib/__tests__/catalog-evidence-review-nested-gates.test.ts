import { describe, expect, it } from "vitest";
import { parseCatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";
import { PRODUCT_ID, review } from "@/lib/__tests__/catalog-evidence-fixtures";

describe("CatalogEvidenceReviewV1 nested leftover fail-closed gates", () => {
  it("rejects extra keys on claim reviews and new findings so a review cannot smuggle a replacement packet", () => {
    const base = review();

    expect(
      parseCatalogEvidenceReviewV1({
        ...base,
        claimReviews: [{ ...base.claimReviews[0], replacementPacket: { products: [] } }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidenceReviewV1({
        ...base,
        newFindings: [
          {
            productId: PRODUCT_ID,
            findingId: "nf-1",
            field: "thickness",
            finding: "Serious.",
            severity: "high",
            sourceUrls: ["https://www.sbdapparel.com/products/7mm-knee-sleeves"],
            liveCatalogPatch: { thickness: "5mm" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects padded run, reviewer, claim, product, and finding identifiers instead of trimming them", () => {
    expect(parseCatalogEvidenceReviewV1(review({ runId: " run-3d-0001" })).success).toBe(false);
    expect(parseCatalogEvidenceReviewV1(review({ runId: "run-3d-0001 " })).success).toBe(false);
    expect(
      parseCatalogEvidenceReviewV1(review({ reviewerExecutorKey: " grok-loadout-reviewer-v1" })).success,
    ).toBe(false);
    expect(
      parseCatalogEvidenceReviewV1(review({ reviewerExecutorKey: "grok-loadout-reviewer-v1 " })).success,
    ).toBe(false);

    const base = review();
    expect(
      parseCatalogEvidenceReviewV1({
        ...base,
        claimReviews: [{ ...base.claimReviews[0], claimId: " ks-sbd-7mm:thickness" }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidenceReviewV1({
        ...base,
        newFindings: [
          {
            productId: " ks-sbd-7mm",
            findingId: "nf-1",
            field: "thickness",
            finding: "Serious.",
            severity: "high",
            sourceUrls: ["https://www.sbdapparel.com/products/7mm-knee-sleeves"],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidenceReviewV1({
        ...base,
        newFindings: [
          {
            productId: PRODUCT_ID,
            findingId: "nf-1 ",
            field: "thickness",
            finding: "Serious.",
            severity: "high",
            sourceUrls: ["https://www.sbdapparel.com/products/7mm-knee-sleeves"],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown claim verdict instead of treating it as accept", () => {
    const base = review();
    expect(
      parseCatalogEvidenceReviewV1({
        ...base,
        claimReviews: [{ ...base.claimReviews[0], verdict: "approve" }],
      }).success,
    ).toBe(false);
  });
});
