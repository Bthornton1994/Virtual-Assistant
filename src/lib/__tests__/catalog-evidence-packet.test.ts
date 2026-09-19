import { describe, expect, it } from "vitest";
import { parseCatalogEvidencePacketV1 } from "@/lib/catalog-evidence-packet";
import {
  catalogFieldCorrection,
  federationStatusCorrection,
  packet,
  product,
} from "@/lib/__tests__/catalog-evidence-fixtures";

describe("CatalogEvidencePacketV1 parse boundary", () => {
  it("accepts a complete packet fixture", () => {
    const parsed = parseCatalogEvidencePacketV1(packet());
    expect(parsed.success).toBe(true);
  });

  it("rejects extra top-level keys so a packet cannot smuggle a replacement catalog", () => {
    const parsed = parseCatalogEvidencePacketV1({
      ...packet(),
      authoritativeCatalogPatch: [{ productId: "ks-sbd-7mm", price: 1 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a padded runId instead of trimming it into a different identity", () => {
    expect(parseCatalogEvidencePacketV1(packet({ runId: " run-3d-0001 " })).success).toBe(false);
  });

  it("requires federation-status corrections to name a federation and catalog-field corrections to omit one", () => {
    const missingFederation = parseCatalogEvidencePacketV1(
      packet({
        products: [
          product({
            candidateCorrections: [{ ...federationStatusCorrection(), federation: "" }],
          }),
        ],
      }),
    );
    expect(missingFederation.success).toBe(false);

    const catalogFieldWithFederation = parseCatalogEvidencePacketV1(
      packet({
        products: [
          product({
            candidateCorrections: [{ ...catalogFieldCorrection(), federation: "IPF" as never }],
          }),
        ],
      }),
    );
    expect(catalogFieldWithFederation.success).toBe(false);

    const okFederation = parseCatalogEvidencePacketV1(
      packet({
        products: [product({ candidateCorrections: [federationStatusCorrection()] })],
      }),
    );
    expect(okFederation.success).toBe(true);
  });

  it("rejects an unknown correctionKind instead of treating it as a catalog-field change", () => {
    const parsed = parseCatalogEvidencePacketV1(
      packet({
        products: [
          product({
            candidateCorrections: [
              {
                correctionKind: "price-override",
                field: "price",
                proposedValue: 1,
                federation: null,
                confidence: "high",
                sourceUrls: [],
                relatedClaimId: null,
              },
            ],
          }),
        ],
      }),
    );
    expect(parsed.success).toBe(false);
  });
});
