import { describe, expect, it } from "vitest";
import { parseCatalogEvidencePacketV1 } from "@/lib/catalog-evidence-packet";
import {
  catalogFieldCorrection,
  federationStatusCorrection,
  packet,
  product,
} from "@/lib/__tests__/catalog-evidence-fixtures";

describe("CatalogEvidencePacketV1 nested leftover fail-closed gates", () => {
  it("rejects extra keys on nested product objects so a packet cannot smuggle a replacement catalog", () => {
    const base = packet();
    const first = base.products[0];

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, identity: { ...first.identity, authoritativeMatch: true } }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [
          {
            ...first,
            primarySources: [{ ...first.primarySources[0], credential: "sk-live" }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, priceEvidence: { ...first.priceEvidence, overridePrice: 1 } }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [
          {
            ...first,
            claimFindings: [{ ...first.claimFindings[0], catalogPatch: { thickness: "5mm" } }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [
          {
            ...first,
            candidateCorrections: [{ ...catalogFieldCorrection(), applyNow: true }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [
          {
            ...first,
            candidateCorrections: [{ ...federationStatusCorrection(), applyNow: true }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, escalation: { ...first.escalation, skipReview: true } }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, liveCatalogRow: { id: "ks-sbd-7mm" } }],
      }).success,
    ).toBe(false);
  });

  it("rejects padded product, claim, and executor identifiers instead of trimming them into a different identity", () => {
    expect(parseCatalogEvidencePacketV1(packet({ executorKey: " hermes-loadout-researcher-v1" })).success).toBe(false);
    expect(parseCatalogEvidencePacketV1(packet({ executorKey: "hermes-loadout-researcher-v1 " })).success).toBe(false);
    expect(
      parseCatalogEvidencePacketV1(packet({ products: [product({ productId: " ks-sbd-7mm" })] })).success,
    ).toBe(false);

    const base = packet();
    const first = base.products[0];
    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [
          {
            ...first,
            claimFindings: [{ ...first.claimFindings[0], claimId: "ks-sbd-7mm:thickness " }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown identity, price, and claim finding values instead of coercing them", () => {
    const base = packet();
    const first = base.products[0];

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, identity: { ...first.identity, status: "close-enough" } }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, priceEvidence: { ...first.priceEvidence, priceType: "clearance" } }],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [
          {
            ...first,
            claimFindings: [{ ...first.claimFindings[0], finding: "mostly-supported" }],
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      parseCatalogEvidencePacketV1({
        ...base,
        products: [{ ...first, priceEvidence: { ...first.priceEvidence, currentDisplayedPrice: -1 } }],
      }).success,
    ).toBe(false);
  });
});
