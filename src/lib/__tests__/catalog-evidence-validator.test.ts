import { describe, expect, it } from "vitest";
import { hashCatalogEvidencePacket, canonicalJsonStringify } from "@/lib/catalog-evidence-hash";
import { catalogEvidencePacketV1Schema } from "@/lib/catalog-evidence-packet";
import {
  collectClaimIds,
  collectHighSeverityClaimIds,
  collectPacketClaims,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
  validateEvidenceUrl,
} from "@/lib/catalog-evidence-validator";
import {
  APPROVED_LIST_URL,
  MANUFACTURER_URL,
  RULEBOOK_URL,
  RUN_ID,
  USAPL_APPROVED_LIST_URL,
  USAPL_RULEBOOK_URL,
  ZERO_AUTHORITY,
  approvedListSource,
  manufacturerSource,
  packet,
  product,
  review,
  reviewContext,
  rulebookSource,
} from "@/lib/__tests__/catalog-evidence-fixtures";

function failuresMatching(result: { hardFailures: string[] }, pattern: RegExp) {
  return result.hardFailures.filter((failure) => pattern.test(failure));
}

describe("catalog evidence packet validator", () => {
  it("accepts a well-formed packet", () => {
    const result = validateCatalogEvidencePacket(packet());
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
    expect(result.metrics.productCount).toBe(1);
  });

  it("rejects structurally malformed input without throwing", () => {
    for (const bad of [null, undefined, 42, "not json", [], { schemaVersion: "wrong" }]) {
      const result = validateCatalogEvidencePacket(bad);
      expect(result.hardGatePass).toBe(false);
      expect(result.metrics.schemaViolationCount).toBeGreaterThan(0);
    }
  });

  it("flags missing, duplicate, and unexpected products", () => {
    const missing = validateCatalogEvidencePacket(packet(), { expectedProductIds: ["ks-sbd-7mm", "belt-sbd-13mm"] });
    expect(failuresMatching(missing, /Required product "belt-sbd-13mm" is missing/)).toHaveLength(1);

    const duplicated = validateCatalogEvidencePacket(packet({ products: [product(), product()] }));
    expect(failuresMatching(duplicated, /appears 2 times/)).not.toHaveLength(0);

    const unexpected = validateCatalogEvidencePacket(
      packet({ products: [product(), product({ productId: "belt-inzer-forever" })] }),
      { expectedProductIds: ["ks-sbd-7mm"] },
    );
    expect(failuresMatching(unexpected, /"belt-inzer-forever" is not in the expected product set/)).toHaveLength(1);
  });

  it("rejects duplicate claim IDs across the packet", () => {
    const shared = {
      claimId: "shared-claim",
      field: "thickness",
      catalogValue: "7mm",
      finding: "supported" as const,
      evidenceSupportedValue: "7mm",
      severity: "low" as const,
      sourceUrls: [MANUFACTURER_URL],
    };
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({ claimFindings: [shared] }),
          product({ productId: "belt-inzer-forever", claimFindings: [{ ...shared }] }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /Claim ID "shared-claim" appears 2 times/)).toHaveLength(1);
  });

  it("rejects duplicate claim IDs within a single product", () => {
    const claim = {
      claimId: "dup",
      field: "thickness",
      catalogValue: "7mm",
      finding: "supported" as const,
      evidenceSupportedValue: "7mm",
      severity: "low" as const,
      sourceUrls: [MANUFACTURER_URL],
    };
    const result = validateCatalogEvidencePacket(packet({ products: [product({ claimFindings: [claim, { ...claim }] })] }));
    expect(failuresMatching(result, /Claim ID "dup" appears 2 times/)).toHaveLength(1);
  });

  it("rejects Markdown and non-https URLs", () => {
    const markdown = validateCatalogEvidencePacket(
      packet({ products: [product({ primarySources: [manufacturerSource({ url: `[SBD](${MANUFACTURER_URL})` })] })] }),
    );
    expect(markdown.hardGatePass).toBe(false);
    expect(failuresMatching(markdown, /Markdown-formatted link/)).not.toHaveLength(0);

    for (const bad of ["http://example.com/x", "ftp://example.com/x", "example.com/x", "javascript:alert(1)"]) {
      const result = validateCatalogEvidencePacket(
        packet({ products: [product({ primarySources: [manufacturerSource({ url: bad })] })] }),
      );
      expect(result.hardGatePass, `expected ${bad} to be rejected`).toBe(false);
      expect(result.metrics.malformedUrlCount).toBeGreaterThan(0);
    }
  });

  it("requires a claimed accessed primary source to carry a real URL", () => {
    const result = validateCatalogEvidencePacket(
      packet({ products: [product({ primarySources: [manufacturerSource({ url: "not a url" })] })] }),
    );
    expect(failuresMatching(result, /claims accessedDuringRun=true but does not carry a valid URL/)).toHaveLength(1);
  });

  it("hard-fails any non-zero authority action", () => {
    for (const key of Object.keys(ZERO_AUTHORITY) as Array<keyof typeof ZERO_AUTHORITY>) {
      const result = validateCatalogEvidencePacket(packet({ authorityReport: { ...ZERO_AUTHORITY, [key]: 1 } }));
      expect(result.hardGatePass, `expected ${key}=1 to hard-fail`).toBe(false);
      expect(result.metrics.authorityIncidentCount).toBe(1);
    }
  });

  it("binds the packet to the run, executor, and market it was ingested for", () => {
    const wrongRun = validateCatalogEvidencePacket(packet(), { expectedRunId: "run-other" });
    expect(failuresMatching(wrongRun, /declares runId "run-3d-0001" but was ingested for run "run-other"/)).toHaveLength(1);

    const wrongExecutor = validateCatalogEvidencePacket(packet(), { expectedExecutorKey: "someone-else-v1" });
    expect(failuresMatching(wrongExecutor, /prepare phase is assigned to "someone-else-v1"/)).toHaveLength(1);

    const wrongMarket = validateCatalogEvidencePacket(packet(), { expectedMarket: "UK" });
    expect(failuresMatching(wrongMarket, /market "US" but the frozen input manifest specifies "UK"/)).toHaveLength(1);

    const correct = validateCatalogEvidencePacket(packet(), {
      expectedRunId: RUN_ID,
      expectedExecutorKey: "hermes-loadout-researcher-v1",
      expectedMarket: "US",
      expectedProductIds: ["ks-sbd-7mm"],
    });
    expect(correct.hardFailures).toEqual([]);
  });
});

describe("federation evidence binding", () => {
  it("accepts a conclusion cited to matching accessed primary evidence", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource(), approvedListSource()],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "Listed.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("refuses to let one federation's rulebook establish another federation's conclusion", () => {
    // The exact semantic failure seen in Hermes runs 1-3: IPF evidence carrying a USAPL claim.
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource({ federation: "IPF" })],
            federationEvidence: [
              { federation: "USAPL", status: "rule-compliant", scope: "exact-configuration", basis: "Within limit.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /evidence belonging to IPF/)).toHaveLength(1);
  });

  it("refuses to let one federation's approved list establish another federation's named approval", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [approvedListSource({ federation: "IPF" })],
            federationEvidence: [
              { federation: "USAPL", status: "approved-list", scope: "exact-configuration", basis: "On the IPF list.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /evidence belonging to IPF/)).toHaveLength(1);
  });

  it("accepts a cross-federation conclusion when the target federation's own source is cited", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              approvedListSource({ federation: "IPF" }),
              approvedListSource({ url: USAPL_APPROVED_LIST_URL, organization: "USAPL", federation: "USAPL" }),
            ],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "IPF list.", sourceUrls: [APPROVED_LIST_URL] },
              { federation: "USAPL", status: "approved-list", scope: "exact-configuration", basis: "USAPL publishes its own adoption.", sourceUrls: [USAPL_APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("accepts each federation's conclusion when each cites its own rulebook", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              rulebookSource({ federation: "IPF" }),
              rulebookSource({ url: USAPL_RULEBOOK_URL, organization: "USAPL", federation: "USAPL" }),
            ],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Within the IPF limit.", sourceUrls: [RULEBOOK_URL] },
              { federation: "USAPL", status: "rule-compliant", scope: "exact-configuration", basis: "Within the USAPL limit.", sourceUrls: [USAPL_RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("never lets a secondary source satisfy a federation gate", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource()],
            secondarySources: [
              { url: RULEBOOK_URL, organization: "Forum mirror", sourceType: "federation-rulebook mirror", factsSupported: ["limit"], reasonUsed: "Official site down." },
            ],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Mirror of the rulebook.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /federation conclusions require primary evidence/)).toHaveLength(1);
  });

  it("never lets un-accessed primary evidence satisfy a federation gate", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource({ accessedDuringRun: false })],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Assumed.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /was not accessed during the run/)).toHaveLength(1);
  });

  it("requires the cited URL to be a declared primary source on the same product", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource()],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Elsewhere.", sourceUrls: ["https://example.com/undeclared"] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /not a declared primary source on this product/)).toHaveLength(1);
  });

  it("requires the right document type for each conclusion", () => {
    const approvedFromRulebook = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource()],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "Rulebook only.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(failuresMatching(approvedFromRulebook, /without citing a federation-approved-list primary source/)).toHaveLength(1);

    const ruleFromList = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [approvedListSource()],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "List only.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(failuresMatching(ruleFromList, /without citing a federation-rulebook primary source/)).toHaveLength(1);

    const mfrFromRulebook = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource()],
            federationEvidence: [
              { federation: "IPF", status: "manufacturer-claimed-compliant", scope: "exact-configuration", basis: "Vendor copy.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(failuresMatching(mfrFromRulebook, /without citing a manufacturer primary source/)).toHaveLength(1);
  });

  it("requires federation documents to declare which federation they belong to", () => {
    const result = validateCatalogEvidencePacket(
      packet({ products: [product({ primarySources: [rulebookSource({ federation: undefined })] })] }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /does not declare which federation it belongs to/)).toHaveLength(1);
  });

  it("rejects a federation conclusion citing no source at all", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            federationEvidence: [{ federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Trust me.", sourceUrls: [] }],
          }),
        ],
      }),
    );
    expect(failuresMatching(result, /without citing any source/)).toHaveLength(1);
  });

  it("still only warns that family-scoped approval is not exact-configuration compliance", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [approvedListSource()],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "product-family", basis: "Family listed.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(true);
    expect(result.warnings.some((w) => /does not by itself establish exact-configuration compliance/.test(w))).toBe(true);
  });

  it("asserts nothing for unknown and not-applicable statuses", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            federationEvidence: [
              { federation: "IPF", status: "unknown", scope: "category", basis: "Not researched.", sourceUrls: [] },
              { federation: "USAPL", status: "not-applicable", scope: "category", basis: "Not a regulated item.", sourceUrls: [] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
  });
});

describe("price evidence model", () => {
  const unavailablePrice = {
    currentDisplayedPrice: null,
    regularOrCompareAtPrice: null,
    currency: "USD",
    priceType: "unavailable" as const,
    market: "US",
    variantScope: null,
    sourceUrl: null,
  };

  it("represents an unresolved manufacturer record without fabricating evidence", () => {
    // Sabo-style: the product exists, the price genuinely could not be resolved.
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            productId: "shoe-sabo-powerlift",
            identity: { status: "uncertain", reason: "Manufacturer storefront unreachable; model line ambiguous." },
            primarySources: [],
            claimFindings: [],
            priceEvidence: unavailablePrice,
            escalation: { required: true, reason: "No resolvable manufacturer record for this configuration." },
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("requires a source, price, and variant scope for any resolved price", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [product({ priceEvidence: { ...unavailablePrice, priceType: "regular" } })],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /no source URL/)).toHaveLength(1);
    expect(failuresMatching(result, /no displayed price/)).toHaveLength(1);
    expect(failuresMatching(result, /no variant scope/)).toHaveLength(1);
  });

  it("requires a sale to name the price it is discounted from, and to be a discount", () => {
    const missing = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            priceEvidence: { currentDisplayedPrice: 120, regularOrCompareAtPrice: null, currency: "USD", priceType: "sale", market: "US", variantScope: "all", sourceUrl: MANUFACTURER_URL },
          }),
        ],
      }),
    );
    expect(failuresMatching(missing, /without the regular or compare-at price/)).toHaveLength(1);

    const inverted = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            priceEvidence: { currentDisplayedPrice: 200, regularOrCompareAtPrice: 145, currency: "USD", priceType: "sale", market: "US", variantScope: "all", sourceUrl: MANUFACTURER_URL },
          }),
        ],
      }),
    );
    expect(failuresMatching(inverted, /sale price of 200 above its regular price of 145/)).toHaveLength(1);
  });

  it("warns on a market mismatch without failing", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        market: "US",
        products: [
          product({
            priceEvidence: { currentDisplayedPrice: 120, regularOrCompareAtPrice: 120, currency: "GBP", priceType: "regular", market: "UK", variantScope: "all", sourceUrl: MANUFACTURER_URL },
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(true);
    expect(result.warnings.some((w) => /differs from the evaluated market/.test(w))).toBe(true);
  });
});

describe("packet corrections, contradictions, and metrics", () => {
  it("rejects a correction citing evidence absent from the packet", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({ candidateCorrections: [{ field: "thickness", proposedValue: "6mm", confidence: "medium", sourceUrls: ["https://unrelated.example.com/page"] }] }),
        ],
      }),
    );
    expect(failuresMatching(result, /cites a source not otherwise declared in the packet/)).toHaveLength(1);
  });

  it("rejects a high-confidence non-null correction while identity is unresolved", () => {
    for (const status of ["uncertain", "mismatch"] as const) {
      const result = validateCatalogEvidencePacket(
        packet({
          products: [
            product({
              identity: { status, reason: "Could not confirm the exact configuration." },
              candidateCorrections: [{ field: "price", proposedValue: 129, confidence: "high", sourceUrls: [MANUFACTURER_URL] }],
            }),
          ],
        }),
      );
      expect(failuresMatching(result, /cannot carry a high-confidence, non-null correction/)).toHaveLength(1);
    }
  });

  it("allows a high-confidence nullifying correction while identity is uncertain", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            identity: { status: "uncertain", reason: "Configuration unconfirmed." },
            candidateCorrections: [{ field: "ipfApproved", proposedValue: null, confidence: "high", sourceUrls: [MANUFACTURER_URL] }],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
  });

  it("requires a high-severity contradiction to escalate or be corrected", () => {
    const contradicted = product({
      claimFindings: [
        { claimId: "ks-sbd-7mm:ipf", field: "ipfApproved", catalogValue: true, finding: "contradicted", evidenceSupportedValue: false, severity: "high", sourceUrls: [MANUFACTURER_URL] },
      ],
    });
    const unresolved = validateCatalogEvidencePacket(packet({ products: [contradicted] }));
    expect(failuresMatching(unresolved, /unresolved high-severity contradiction/)).toHaveLength(1);

    const escalated = validateCatalogEvidencePacket(
      packet({ products: [{ ...contradicted, escalation: { required: true, reason: "Conflicting evidence." } }] }),
    );
    expect(escalated.hardGatePass).toBe(true);
  });

  it("rejects a packet carrying its own batch aggregate counts", () => {
    const result = validateCatalogEvidencePacket({ ...packet(), productCount: 1, conflictCount: 0 });
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /Unrecognized key/)).not.toHaveLength(0);
  });

  it("computes metrics from the packet itself rather than trusting the executor", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            identity: { status: "uncertain", reason: "Unconfirmed." },
            secondarySources: [{ url: "https://reviews.example.com/sbd", organization: "Reviews", sourceType: "retailer", factsSupported: ["price"], reasonUsed: "No primary price page." }],
            claimFindings: [
              { claimId: "a", field: "thickness", catalogValue: "7mm", finding: "supported", evidenceSupportedValue: "7mm", severity: "low", sourceUrls: [MANUFACTURER_URL] },
              { claimId: "b", field: "material", catalogValue: "neoprene", finding: "unresolved", evidenceSupportedValue: null, severity: "medium", sourceUrls: [] },
              { claimId: "c", field: "weight", catalogValue: "500g", finding: "contradicted", evidenceSupportedValue: "480g", severity: "low", sourceUrls: [MANUFACTURER_URL] },
            ],
            candidateCorrections: [{ field: "weight", proposedValue: "480g", confidence: "medium", sourceUrls: [MANUFACTURER_URL] }],
            escalation: { required: true, reason: "Material unresolved." },
          }),
          product({ productId: "belt-inzer-forever", primarySources: [], claimFindings: [] }),
        ],
      }),
    );
    expect(result.metrics).toMatchObject({
      productCount: 2,
      exactIdentityCount: 1,
      uncertainIdentityCount: 1,
      conflictCount: 1,
      highSeverityConflictCount: 0,
      unsupportedOrUnresolvedCount: 1,
      correctionCount: 1,
      escalationCount: 1,
      primarySourceCount: 1,
      secondarySourceCount: 1,
      missingPrimarySourceCount: 1,
      authorityIncidentCount: 0,
      malformedUrlCount: 0,
    });
  });

  it("is deterministic across repeated calls", () => {
    const input = packet();
    const a = validateCatalogEvidencePacket(input, { expectedProductIds: ["ks-sbd-7mm"] });
    const b = validateCatalogEvidencePacket(input, { expectedProductIds: ["ks-sbd-7mm"] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("evidence URL rules", () => {
  it("accepts a plain https URL and rejects padded, wrapped, and Markdown forms", () => {
    expect(validateEvidenceUrl(MANUFACTURER_URL).ok).toBe(true);
    expect(validateEvidenceUrl(` ${MANUFACTURER_URL}`).ok).toBe(false);
    expect(validateEvidenceUrl(`<${MANUFACTURER_URL}>`).ok).toBe(false);
    expect(validateEvidenceUrl(`[link](${MANUFACTURER_URL})`).ok).toBe(false);
  });
});

describe("catalog evidence hashing", () => {
  it("is stable across key ordering and repeated hashing", () => {
    const a = packet();
    const reordered = JSON.parse(
      JSON.stringify({ authorityReport: a.authorityReport, products: a.products, market: a.market, generatedAt: a.generatedAt, executorKey: a.executorKey, runId: a.runId, schemaVersion: a.schemaVersion }),
    );
    expect(hashCatalogEvidencePacket(reordered)).toBe(hashCatalogEvidencePacket(a));
    expect(hashCatalogEvidencePacket(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any packet content changes", () => {
    const base = hashCatalogEvidencePacket(packet());
    expect(hashCatalogEvidencePacket(packet({ market: "UK" }))).not.toBe(base);
    expect(hashCatalogEvidencePacket(packet({ authorityReport: { ...ZERO_AUTHORITY, purchasesMade: 1 } }))).not.toBe(base);
  });

  it("canonicalizes nested objects and preserves array order", () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJsonStringify([2, 1])).not.toBe(canonicalJsonStringify([1, 2]));
  });
});

describe("catalog evidence review validator", () => {
  const frozen = packet();
  const frozenHash = hashCatalogEvidencePacket(frozen);
  const context = reviewContext(frozen, frozenHash);

  it("accepts a well-formed review of the frozen packet", () => {
    const result = validateCatalogEvidenceReview(review({ evidencePacketHash: frozenHash }), context);
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
    expect(result.metrics.acceptCount).toBe(1);
  });

  it("rejects a review referencing the wrong packet hash, run, or reviewer", () => {
    expect(validateCatalogEvidenceReview(review({ evidencePacketHash: "a".repeat(64) }), context).hardGatePass).toBe(false);

    const wrongRun = validateCatalogEvidenceReview(review({ evidencePacketHash: frozenHash, runId: "run-other" }), context);
    expect(failuresMatching(wrongRun, /declares runId "run-other"/)).toHaveLength(1);

    const wrongReviewer = validateCatalogEvidenceReview(
      review({ evidencePacketHash: frozenHash, reviewerExecutorKey: "impostor-v1" }),
      context,
    );
    expect(failuresMatching(wrongReviewer, /review phase is assigned to/)).toHaveLength(1);
  });

  it("rejects a fabricated claim ID", () => {
    const result = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        claimReviews: [
          { claimId: "fabricated:claim", verdict: "reject", independentVerificationPerformed: true, reason: "Invented.", independentSourceUrls: [MANUFACTURER_URL], severity: "high" },
        ],
      }),
      context,
    );
    expect(result.metrics.fabricatedClaimIdCount).toBe(1);
    expect(failuresMatching(result, /does not exist in the frozen Hermes packet/)).toHaveLength(1);
  });

  it("rejects duplicate reviews of the same claim", () => {
    const one = {
      claimId: "ks-sbd-7mm:thickness",
      verdict: "accept" as const,
      independentVerificationPerformed: true,
      reason: "Confirmed.",
      independentSourceUrls: [MANUFACTURER_URL],
      severity: "low" as const,
    };
    const result = validateCatalogEvidenceReview(
      review({ evidencePacketHash: frozenHash, claimReviews: [one, { ...one }] }),
      context,
    );
    expect(result.hardGatePass).toBe(false);
    expect(result.metrics.duplicateClaimReviewCount).toBe(1);
    expect(failuresMatching(result, /2 reviews for claim/)).toHaveLength(1);
  });

  it("requires a definite verdict to cite a valid independent source", () => {
    for (const verdict of ["accept", "reject"] as const) {
      const result = validateCatalogEvidenceReview(
        review({
          evidencePacketHash: frozenHash,
          claimReviews: [
            { claimId: "ks-sbd-7mm:thickness", verdict, independentVerificationPerformed: true, reason: "Because.", independentSourceUrls: [], severity: "low" },
          ],
        }),
        context,
      );
      expect(result.hardGatePass, `expected ${verdict} with no source to fail`).toBe(false);
      expect(failuresMatching(result, /without citing a single valid independent source/)).toHaveLength(1);
    }
  });

  it("allows a sourceless inconclusive only when the evidence gap names the claim", () => {
    const withoutGap = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:thickness", verdict: "inconclusive", independentVerificationPerformed: true, reason: "Site down.", independentSourceUrls: [], severity: "low" },
        ],
      }),
      context,
    );
    expect(failuresMatching(withoutGap, /no matching entry in evidenceGaps naming that claim/)).toHaveLength(1);

    const withGap = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:thickness", verdict: "inconclusive", independentVerificationPerformed: true, reason: "Site down.", independentSourceUrls: [], severity: "low" },
        ],
        evidenceGaps: ["ks-sbd-7mm:thickness could not be independently checked; manufacturer page was unreachable."],
      }),
      context,
    );
    expect(withGap.hardFailures).toEqual([]);
  });

  it("requires escalationRequired to carry a reason", () => {
    const result = validateCatalogEvidenceReview(
      review({ evidencePacketHash: frozenHash, escalationRequired: true, escalationReason: "  " }),
      context,
    );
    expect(failuresMatching(result, /records no escalation reason/)).toHaveLength(1);
  });

  describe("high-severity claims", () => {
    const highPacket = packet({
      products: [
        product({
          claimFindings: [
            { claimId: "ks-sbd-7mm:ipf", field: "ipfApproved", catalogValue: true, finding: "contradicted", evidenceSupportedValue: false, severity: "high", sourceUrls: [MANUFACTURER_URL] },
          ],
          escalation: { required: true, reason: "Conflicting federation evidence." },
        }),
      ],
    });
    const highHash = hashCatalogEvidencePacket(highPacket);
    const highContext = reviewContext(highPacket, highHash);

    it("requires every high-severity claim to be reviewed", () => {
      const result = validateCatalogEvidenceReview(review({ evidencePacketHash: highHash, claimReviews: [] }), highContext);
      expect(result.metrics.missingHighSeverityReviewCount).toBe(1);
      expect(failuresMatching(result, /did not receive an independent review/)).toHaveLength(1);
    });

    it("rejects a high-severity review that did not independently verify", () => {
      const result = validateCatalogEvidenceReview(
        review({
          evidencePacketHash: highHash,
          claimReviews: [
            { claimId: "ks-sbd-7mm:ipf", verdict: "accept", independentVerificationPerformed: false, reason: "Agrees with Hermes.", independentSourceUrls: [APPROVED_LIST_URL], severity: "high" },
          ],
        }),
        highContext,
      );
      expect(result.hardGatePass).toBe(false);
      expect(failuresMatching(result, /a restatement of the Hermes finding is not a review/)).toHaveLength(1);
    });

    it("accepts a properly independent high-severity review", () => {
      const result = validateCatalogEvidenceReview(
        review({
          evidencePacketHash: highHash,
          claimReviews: [
            { claimId: "ks-sbd-7mm:ipf", verdict: "accept", independentVerificationPerformed: true, reason: "Checked the approved list directly.", independentSourceUrls: [APPROVED_LIST_URL], severity: "high" },
          ],
        }),
        highContext,
      );
      expect(result.hardFailures).toEqual([]);
    });
  });

  it("rejects Markdown and non-https URLs in review sources", () => {
    const markdown = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:thickness", verdict: "accept", independentVerificationPerformed: true, reason: "Confirmed.", independentSourceUrls: [`[src](${MANUFACTURER_URL})`], severity: "low" },
        ],
      }),
      context,
    );
    expect(markdown.metrics.malformedUrlCount).toBe(1);

    const insecure = validateCatalogEvidenceReview(
      review({ evidencePacketHash: frozenHash, newFindings: [{ field: "price", finding: "Differs.", severity: "medium", sourceUrls: ["http://example.com/price"] }] }),
      context,
    );
    expect(insecure.metrics.malformedUrlCount).toBe(1);
  });

  it("hard-fails any non-zero reviewer authority action", () => {
    const result = validateCatalogEvidenceReview(
      review({ evidencePacketHash: frozenHash, authorityReport: { ...ZERO_AUTHORITY, repositoryChangesMade: 2 } }),
      context,
    );
    expect(result.hardGatePass).toBe(false);
    expect(result.metrics.authorityIncidentCount).toBe(2);
  });

  it("structurally cannot carry a replacement evidence packet", () => {
    const result = validateCatalogEvidenceReview({ ...review({ evidencePacketHash: frozenHash }), products: frozen.products }, context);
    expect(failuresMatching(result, /Unrecognized key/)).not.toHaveLength(0);
  });

  it("counts reviewer conclusions without treating them as structural failures", () => {
    // A reviewer that rejects a claim has produced a VALID review. Whether that
    // blocks verification is work-cell-policy's decision, not the validator's.
    const result = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:thickness", verdict: "reject", independentVerificationPerformed: true, reason: "Page states 5mm.", independentSourceUrls: [MANUFACTURER_URL], severity: "high" },
        ],
        escalationRequired: true,
        escalationReason: "Catalog and manufacturer disagree.",
        newFindings: [{ field: "material", finding: "Undisclosed material change.", severity: "high", sourceUrls: [MANUFACTURER_URL] }],
      }),
      context,
    );
    expect(result.hardGatePass).toBe(true);
    expect(result.metrics.rejectCount).toBe(1);
    expect(result.metrics.escalationRequiredCount).toBe(1);
    expect(result.metrics.highSeverityNewFindingCount).toBe(1);
  });
});

describe("claim collection helpers", () => {
  it("exposes claim severity for review context", () => {
    const claims = collectPacketClaims(packet());
    expect(claims).toEqual([{ claimId: "ks-sbd-7mm:thickness", productId: "ks-sbd-7mm", field: "thickness", severity: "low" }]);
    expect(collectClaimIds(packet())).toEqual(["ks-sbd-7mm:thickness"]);
    expect(collectHighSeverityClaimIds(packet())).toEqual([]);
  });
});

// Regression coverage for holes found by adversarial review of the Step 3D fixes.
describe("adversarial-review regressions", () => {
  it("does not let a claimFinding URL launder correction provenance", () => {
    // A blog URL parked in claimFindings used to count as "declared evidence",
    // so a high-confidence correction could cite it with no source declaration.
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource()],
            claimFindings: [
              { claimId: "c1", field: "weight", catalogValue: "500g", finding: "contradicted", evidenceSupportedValue: "480g", severity: "low", sourceUrls: ["https://liftingblog.example.com/post"] },
            ],
            candidateCorrections: [
              { field: "weight", proposedValue: "480g", confidence: "high", sourceUrls: ["https://liftingblog.example.com/post"] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /cites a source not otherwise declared in the packet/)).toHaveLength(1);
  });

  it("does not let a correction assert federation compliance around the binding rules", () => {
    // Asserting ipfApproved=true via candidateCorrections must clear the same
    // bar as asserting it via federationEvidence.
    const smuggled = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource()],
            secondarySources: [
              { url: "https://liftingblog.example.com/ipf-legal", organization: "Blog", sourceType: "blog", factsSupported: ["approval"], reasonUsed: "No primary page found." },
            ],
            candidateCorrections: [
              { field: "ipfApproved", proposedValue: true, confidence: "high", sourceUrls: ["https://liftingblog.example.com/ipf-legal"] },
            ],
          }),
        ],
      }),
    );
    expect(smuggled.hardGatePass).toBe(false);
    expect(failuresMatching(smuggled, /asserts IPF compliance, without a IPF federation evidence entry/)).toHaveLength(1);

    // The same correction is fine once a properly bound federation entry exists.
    const backed = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [manufacturerSource(), approvedListSource()],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "Listed.", sourceUrls: [APPROVED_LIST_URL] },
            ],
            candidateCorrections: [
              { field: "ipfApproved", proposedValue: true, confidence: "high", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(backed.hardFailures).toEqual([]);
  });

  it("still allows removing an unsupported federation claim", () => {
    // Nullifying or negating a compliance claim needs no federation backing:
    // withdrawing an unsupported assertion is always permitted.
    for (const proposedValue of [null, false]) {
      const result = validateCatalogEvidencePacket(
        packet({
          products: [
            product({
              primarySources: [manufacturerSource()],
              candidateCorrections: [{ field: "ipfApproved", proposedValue, confidence: "high", sourceUrls: [MANUFACTURER_URL] }],
            }),
          ],
        }),
      );
      expect(result.hardFailures, `proposedValue ${String(proposedValue)} should be allowed`).toEqual([]);
    }
  });

  it("does not let an unsourced decoy entry silence the family-scope warning", () => {
    // "unknown" skips every binding rule, so it must not count as exact-configuration backing.
    const withDecoy = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [approvedListSource()],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "category", basis: "Category listed.", sourceUrls: [APPROVED_LIST_URL] },
              { federation: "IPF", status: "unknown", scope: "exact-configuration", basis: "Not researched.", sourceUrls: [] },
            ],
          }),
        ],
      }),
    );
    expect(withDecoy.warnings.some((w) => /does not by itself establish exact-configuration compliance/.test(w))).toBe(true);
  });

  it("matches federation names case- and whitespace-insensitively", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [rulebookSource({ federation: " ipf " })],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Within limit.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
  });

  it("does not lose a source role when one URL is declared twice", () => {
    // primaryByUrl once kept only the last declaration, so a URL legitimately
    // declared as both a rulebook and an approved list lost one of its roles.
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              rulebookSource({ url: APPROVED_LIST_URL, federation: "IPF" }),
              approvedListSource({ url: APPROVED_LIST_URL, federation: "IPF" }),
            ],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "Rulebook role.", sourceUrls: [APPROVED_LIST_URL] },
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "List role.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
  });
});

describe("evidence-gap claim mentions", () => {
  it("does not let a gap about a longer claim ID excuse a prefix claim", () => {
    const hermes = packet({
      products: [
        product({
          claimFindings: [
            { claimId: "ks:thickness", field: "thickness", catalogValue: "7mm", finding: "supported", evidenceSupportedValue: "7mm", severity: "low", sourceUrls: [MANUFACTURER_URL] },
            { claimId: "ks:thickness-liner", field: "material", catalogValue: "neoprene", finding: "supported", evidenceSupportedValue: "neoprene", severity: "low", sourceUrls: [MANUFACTURER_URL] },
          ],
        }),
      ],
    });
    const hash = hashCatalogEvidencePacket(hermes);
    const result = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: hash,
        claimReviews: [
          { claimId: "ks:thickness", verdict: "inconclusive", independentVerificationPerformed: true, reason: "Unreachable.", independentSourceUrls: [], severity: "low" },
        ],
        // Names only the OTHER claim; must not excuse ks:thickness.
        evidenceGaps: ["ks:thickness-liner could not be checked."],
      }),
      reviewContext(hermes, hash),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /no matching entry in evidenceGaps naming that claim/)).toHaveLength(1);
  });

  it("accepts a gap that names the claim as a whole token", () => {
    const hermes = packet({
      products: [
        product({
          claimFindings: [
            { claimId: "ks:thickness", field: "thickness", catalogValue: "7mm", finding: "supported", evidenceSupportedValue: "7mm", severity: "low", sourceUrls: [MANUFACTURER_URL] },
            { claimId: "ks:thickness-liner", field: "material", catalogValue: "neoprene", finding: "supported", evidenceSupportedValue: "neoprene", severity: "low", sourceUrls: [MANUFACTURER_URL] },
          ],
        }),
      ],
    });
    const hash = hashCatalogEvidencePacket(hermes);
    const result = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: hash,
        claimReviews: [
          { claimId: "ks:thickness", verdict: "inconclusive", independentVerificationPerformed: true, reason: "Unreachable.", independentSourceUrls: [], severity: "low" },
        ],
        evidenceGaps: ["ks:thickness could not be independently checked; the page was unreachable."],
      }),
      reviewContext(hermes, hash),
    );
    expect(result.hardFailures).toEqual([]);
  });
});

describe("identifier normalization", () => {
  // nonEmptyString's .trim() is a transform, so a padded identifier used to parse
  // to a trimmed value while the stored artifact kept the padding. Since the
  // packet is stored and hashed verbatim, that made a padded claim ID
  // unmatchable: the review context read " ks:ipf " from the raw payload while
  // the reviewer's own " ks:ipf " parsed to "ks:ipf". The claim could never be
  // reviewed, so the attempt could never be verified — and the error said the
  // claim "does not exist" while sitting plainly in the packet.
  it("rejects a padded claim ID at the packet boundary", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            claimFindings: [
              { claimId: " ks:ipf ", field: "ipfApproved", catalogValue: true, finding: "contradicted", evidenceSupportedValue: false, severity: "high", sourceUrls: [MANUFACTURER_URL] },
            ],
            escalation: { required: true, reason: "Conflicting evidence." },
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /must not have leading or trailing whitespace/)).not.toHaveLength(0);
  });

  it("rejects padded product IDs, run IDs, and executor keys", () => {
    expect(validateCatalogEvidencePacket(packet({ products: [product({ productId: " ks-sbd-7mm " })] })).hardGatePass).toBe(false);
    expect(validateCatalogEvidencePacket(packet({ runId: " run-3d-0001 " })).hardGatePass).toBe(false);
    expect(validateCatalogEvidencePacket(packet({ executorKey: " hermes-loadout-researcher-v1 " })).hardGatePass).toBe(false);
  });

  it("rejects a padded claim ID in a review", () => {
    const frozen = packet();
    const hash = hashCatalogEvidencePacket(frozen);
    const result = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: hash,
        claimReviews: [
          { claimId: " ks-sbd-7mm:thickness ", verdict: "accept", independentVerificationPerformed: true, reason: "Confirmed.", independentSourceUrls: [MANUFACTURER_URL], severity: "low" },
        ],
      }),
      reviewContext(frozen, hash),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /must not have leading or trailing whitespace/)).not.toHaveLength(0);
  });

  it("keeps raw and parsed identifiers identical so claim matching is stable", () => {
    // The property the fix protects: what an executor sends is what is stored,
    // hashed, and matched on — no silent normalization in between.
    const raw = JSON.parse(JSON.stringify(packet())) as unknown;
    const parsed = catalogEvidencePacketV1Schema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(hashCatalogEvidencePacket(parsed.data)).toBe(hashCatalogEvidencePacket(raw as never));
      expect(collectPacketClaims(raw as never)).toEqual(collectPacketClaims(parsed.data));
    }
  });
});
