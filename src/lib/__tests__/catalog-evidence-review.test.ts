import { describe, expect, it } from "vitest";
import { parseCatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";
import { review } from "@/lib/__tests__/catalog-evidence-fixtures";

describe("CatalogEvidenceReviewV1 parse boundary", () => {
  it("accepts a complete review fixture", () => {
    const parsed = parseCatalogEvidenceReviewV1(review());
    expect(parsed.success).toBe(true);
  });

  it("normalizes an uppercase packet hash to lowercase hex", () => {
    const parsed = parseCatalogEvidenceReviewV1(review({ evidencePacketHash: "A".repeat(64) }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data.evidencePacketHash).toBe("a".repeat(64));
  });

  it("rejects extra top-level keys so a review cannot smuggle a replacement packet", () => {
    const parsed = parseCatalogEvidenceReviewV1({
      ...review(),
      products: [{ productId: "ks-sbd-7mm" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a packet hash that is not a 64-character hex digest", () => {
    const parsed = parseCatalogEvidenceReviewV1(review({ evidencePacketHash: "a".repeat(63) }));
    expect(parsed.success).toBe(false);
  });

  it("parses escalationRequired with an empty reason as structurally valid", () => {
    const parsed = parseCatalogEvidenceReviewV1(
      review({ escalationRequired: true, escalationReason: "" }),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data.escalationRequired).toBe(true);
    expect(parsed.data.escalationReason).toBe("");
  });
});
