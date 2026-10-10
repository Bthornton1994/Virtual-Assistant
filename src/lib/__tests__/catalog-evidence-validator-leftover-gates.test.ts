import { describe, expect, it } from "vitest";
import { claimValueSchema } from "@/lib/catalog-evidence-shared";
import {
  mentionsClaimId,
  validateCatalogEvidencePacket,
} from "@/lib/catalog-evidence-validator";
import {
  MANUFACTURER_URL,
  RULEBOOK_URL,
  catalogFieldCorrection,
  manufacturerSource,
  packet,
  product,
  rulebookSource,
} from "@/lib/__tests__/catalog-evidence-fixtures";

function failuresMatching(result: { hardFailures: string[] }, pattern: RegExp) {
  return result.hardFailures.filter((failure) => pattern.test(failure));
}

const BAD_HTTP = "http://example.com/evidence";

describe("catalog evidence leftover validator gates", () => {
  it("hard-fails a malformed URL on every non-primary packet surface", () => {
    const surfaces: Array<[string, ReturnType<typeof product>]> = [
      [
        "secondarySources[0].url",
        product({
          secondarySources: [
            {
              url: BAD_HTTP,
              organization: "Reviews",
              sourceType: "retailer",
              factsSupported: ["price"],
              reasonUsed: "Price mirror.",
            },
          ],
        }),
      ],
      [
        "claimFindings[0].sourceUrls[0]",
        product({
          claimFindings: [
            {
              claimId: "ks-sbd-7mm:thickness",
              field: "thickness",
              catalogValue: "7mm",
              finding: "supported",
              evidenceSupportedValue: "7mm",
              severity: "low",
              sourceUrls: [BAD_HTTP],
            },
          ],
        }),
      ],
      [
        "federationEvidence[0].sourceUrls[0]",
        product({
          federationEvidence: [
            {
              federation: "IPF",
              status: "rule-compliant",
              scope: "exact-configuration",
              basis: "Rulebook.",
              sourceUrls: [BAD_HTTP],
            },
          ],
        }),
      ],
      [
        "candidateCorrections[0].sourceUrls[0]",
        product({
          candidateCorrections: [catalogFieldCorrection({ field: "weight", proposedValue: "480g", sourceUrls: [BAD_HTTP] })],
        }),
      ],
      [
        "priceEvidence.sourceUrl",
        product({
          priceEvidence: {
            currentDisplayedPrice: 145,
            regularOrCompareAtPrice: 145,
            currency: "USD",
            priceType: "regular",
            market: "US",
            variantScope: "all sizes",
            sourceUrl: BAD_HTTP,
          },
        }),
      ],
    ];

    for (const [label, next] of surfaces) {
      const result = validateCatalogEvidencePacket(packet({ products: [next] }));
      expect(result.hardGatePass, label).toBe(false);
      expect(failuresMatching(result, new RegExp(label.replace(/[.[\]()]/g, "\\$&"))), label).not.toHaveLength(0);
      expect(failuresMatching(result, /uses protocol "http:"/), label).not.toHaveLength(0);
    }
  });

  it("still URL-gates a junk source on an unavailable price", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            priceEvidence: {
              currentDisplayedPrice: null,
              regularOrCompareAtPrice: null,
              currency: "USD",
              priceType: "unavailable",
              market: "US",
              variantScope: null,
              sourceUrl: BAD_HTTP,
            },
          }),
        ],
      }),
    );

    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /priceEvidence\.sourceUrl/)).toHaveLength(1);
    expect(result.metrics.malformedUrlCount).toBe(1);
  });

  it("binds rule-noncompliant to a federation-rulebook primary, not a manufacturer page", () => {
    const unbound = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource()],
            federationEvidence: [
              {
                federation: "IPF",
                status: "rule-noncompliant",
                scope: "exact-configuration",
                basis: "Vendor copy is not a rulebook.",
                sourceUrls: [MANUFACTURER_URL],
              },
            ],
          }),
        ],
      }),
    );
    expect(unbound.hardGatePass).toBe(false);
    expect(failuresMatching(unbound, /without citing a federation-rulebook primary source/)).toHaveLength(1);

    const bound = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource(), rulebookSource()],
            federationEvidence: [
              {
                federation: "IPF",
                status: "rule-noncompliant",
                scope: "exact-configuration",
                basis: "Thickness exceeds the IPF limit.",
                sourceUrls: [RULEBOOK_URL],
              },
            ],
          }),
        ],
      }),
    );
    expect(bound.hardFailures).toEqual([]);
    expect(bound.hardGatePass).toBe(true);
  });

  it("treats a whitespace-only federation attribution as undeclared", () => {
    const result = validateCatalogEvidencePacket(
      packet({ products: [product({ primarySources: [rulebookSource({ federation: "   " })] })] }),
    );

    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /does not declare which federation it belongs to/)).toHaveLength(1);
  });

  it("warns that family-scoped rule-compliant evidence is not exact-configuration compliance", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource()],
            federationEvidence: [
              {
                federation: "IPF",
                status: "rule-compliant",
                scope: "product-family",
                basis: "Family listed in the rulebook.",
                sourceUrls: [RULEBOOK_URL],
              },
            ],
          }),
        ],
      }),
    );

    expect(result.hardGatePass).toBe(true);
    expect(result.warnings.some((warning) => /does not by itself establish exact-configuration compliance/.test(warning))).toBe(
      true,
    );
  });

  it("clears a high-severity contradiction when a same-field correction is present", () => {
    const result = validateCatalogEvidencePacket(
      packet({
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
                sourceUrls: [MANUFACTURER_URL],
              },
            ],
            candidateCorrections: [
              catalogFieldCorrection({
                field: "thickness",
                proposedValue: "5mm",
                sourceUrls: [MANUFACTURER_URL],
              }),
            ],
          }),
        ],
      }),
    );

    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
    expect(result.metrics.highSeverityConflictCount).toBe(1);
  });

  it("matches claim IDs on token boundaries only", () => {
    expect(mentionsClaimId("ks:thickness could not be checked.", "ks:thickness")).toBe(true);
    expect(mentionsClaimId("ks:thickness-liner could not be checked.", "ks:thickness")).toBe(false);
    expect(mentionsClaimId("see (ks:thickness).", "ks:thickness")).toBe(true);
    expect(mentionsClaimId("", "ks:thickness")).toBe(false);
  });

  it("refuses object and array claim values at the shared schema", () => {
    expect(claimValueSchema.safeParse("7mm").success).toBe(true);
    expect(claimValueSchema.safeParse(145).success).toBe(true);
    expect(claimValueSchema.safeParse(true).success).toBe(true);
    expect(claimValueSchema.safeParse(null).success).toBe(true);
    expect(claimValueSchema.safeParse({}).success).toBe(false);
    expect(claimValueSchema.safeParse([]).success).toBe(false);
    expect(claimValueSchema.safeParse([{ field: "approvals" }]).success).toBe(false);
  });
});
