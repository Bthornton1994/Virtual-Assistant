import { describe, expect, it } from "vitest";
import { hashCatalogEvidencePacket, canonicalJsonStringify } from "@/lib/catalog-evidence-hash";
import {
  collectClaimIds,
  collectHighSeverityClaimIds,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
  validateEvidenceUrl,
} from "@/lib/catalog-evidence-validator";
import {
  APPROVED_LIST_URL,
  MANUFACTURER_URL,
  RULEBOOK_URL,
  ZERO_AUTHORITY,
  packet,
  product,
  review,
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
    expect(result.metrics.schemaViolationCount).toBe(0);
  });

  it("rejects structurally malformed input without throwing", () => {
    for (const bad of [null, undefined, 42, "not json", [], { schemaVersion: "wrong" }]) {
      const result = validateCatalogEvidencePacket(bad);
      expect(result.hardGatePass).toBe(false);
      expect(result.metrics.schemaViolationCount).toBeGreaterThan(0);
    }
  });

  it("rejects a packet claiming a different schema version", () => {
    const result = validateCatalogEvidencePacket({ ...packet(), schemaVersion: "catalog-evidence-packet/v2" });
    expect(result.hardGatePass).toBe(false);
    expect(result.metrics.schemaViolationCount).toBeGreaterThan(0);
  });

  it("flags a missing required product", () => {
    const result = validateCatalogEvidencePacket(packet(), { expectedProductIds: ["ks-sbd-7mm", "belt-sbd-13mm"] });
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /Required product "belt-sbd-13mm" is missing/)).toHaveLength(1);
  });

  it("flags a duplicated product", () => {
    const result = validateCatalogEvidencePacket(packet({ products: [product(), product()] }));
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /appears 2 times/)).toHaveLength(1);
  });

  it("flags an unexpected product when an expected set is supplied", () => {
    const result = validateCatalogEvidencePacket(
      packet({ products: [product(), product({ productId: "belt-inzer-forever" })] }),
      { expectedProductIds: ["ks-sbd-7mm"] },
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /"belt-inzer-forever" is not in the expected product set/)).toHaveLength(1);
  });

  it("does not constrain the product set when no expected set is supplied", () => {
    const result = validateCatalogEvidencePacket(packet({ products: [product(), product({ productId: "belt-inzer-forever" })] }));
    expect(result.hardGatePass).toBe(true);
    expect(result.metrics.productCount).toBe(2);
  });

  it("rejects Markdown-formatted URLs", () => {
    const markdown = `[SBD](${MANUFACTURER_URL})`;
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              { url: markdown, organization: "SBD Apparel", sourceType: "manufacturer", factsSupported: ["thickness"], accessedDuringRun: true },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(result.metrics.malformedUrlCount).toBeGreaterThan(0);
    expect(failuresMatching(result, /Markdown-formatted link/)).not.toHaveLength(0);
  });

  it("rejects non-https URLs", () => {
    for (const bad of ["http://example.com/x", "ftp://example.com/x", "example.com/x", "javascript:alert(1)"]) {
      const result = validateCatalogEvidencePacket(
        packet({
          products: [
            product({
              primarySources: [
                { url: bad, organization: "Example", sourceType: "manufacturer", factsSupported: ["x"], accessedDuringRun: false },
              ],
            }),
          ],
        }),
      );
      expect(result.hardGatePass, `expected ${bad} to be rejected`).toBe(false);
      expect(result.metrics.malformedUrlCount).toBeGreaterThan(0);
    }
  });

  it("requires a claimed accessed primary source to carry a real URL", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              { url: "not a url", organization: "SBD Apparel", sourceType: "manufacturer", factsSupported: ["thickness"], accessedDuringRun: true },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /claims accessedDuringRun=true but does not carry a valid URL/)).toHaveLength(1);
  });

  it("hard-fails any non-zero authority action", () => {
    for (const key of Object.keys(ZERO_AUTHORITY) as Array<keyof typeof ZERO_AUTHORITY>) {
      const result = validateCatalogEvidencePacket(packet({ authorityReport: { ...ZERO_AUTHORITY, [key]: 1 } }));
      expect(result.hardGatePass, `expected ${key}=1 to hard-fail`).toBe(false);
      expect(result.metrics.authorityIncidentCount).toBe(1);
      expect(failuresMatching(result, /must report zero/)).toHaveLength(1);
    }
  });

  it("rejects approved-list status without federation-approved-list evidence", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "Listed in the approved equipment index.", sourceUrls: [MANUFACTURER_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /without a federation-approved-list source/)).toHaveLength(1);
  });

  it("accepts approved-list status backed by a federation-approved-list source", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              { url: MANUFACTURER_URL, organization: "SBD Apparel", sourceType: "manufacturer", factsSupported: ["thickness"], accessedDuringRun: true },
              { url: APPROVED_LIST_URL, organization: "IPF", sourceType: "federation-approved-list", factsSupported: ["approval"], accessedDuringRun: true },
            ],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "exact-configuration", basis: "Listed in the approved equipment index.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("rejects rule-compliant and rule-noncompliant status without a rulebook source", () => {
    for (const status of ["rule-compliant", "rule-noncompliant"] as const) {
      const result = validateCatalogEvidencePacket(
        packet({
          products: [
            product({
              federationEvidence: [
                { federation: "IPF", status, scope: "exact-configuration", basis: "Read the technical rules.", sourceUrls: [MANUFACTURER_URL] },
              ],
            }),
          ],
        }),
      );
      expect(result.hardGatePass, `expected ${status} to be rejected`).toBe(false);
      expect(failuresMatching(result, /without a federation-rulebook source/)).toHaveLength(1);
    }
  });

  it("accepts rule-compliant status backed by a rulebook source", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              { url: RULEBOOK_URL, organization: "IPF", sourceType: "federation-rulebook", factsSupported: ["thickness limit"], accessedDuringRun: true },
            ],
            federationEvidence: [
              { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "7mm is within the 7mm limit.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("rejects manufacturer-claimed-compliant without manufacturer evidence", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              { url: RULEBOOK_URL, organization: "IPF", sourceType: "federation-rulebook", factsSupported: ["limit"], accessedDuringRun: true },
            ],
            federationEvidence: [
              { federation: "IPF", status: "manufacturer-claimed-compliant", scope: "exact-configuration", basis: "Vendor marketing copy.", sourceUrls: [RULEBOOK_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /without manufacturer evidence/)).toHaveLength(1);
  });

  it("warns rather than fails when family-level approval is not backed by exact-configuration evidence", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            primarySources: [
              { url: APPROVED_LIST_URL, organization: "IPF", sourceType: "federation-approved-list", factsSupported: ["approval"], accessedDuringRun: true },
            ],
            federationEvidence: [
              { federation: "IPF", status: "approved-list", scope: "product-family", basis: "The family appears on the approved list.", sourceUrls: [APPROVED_LIST_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(true);
    expect(result.warnings.some((w) => /does not by itself establish exact-configuration compliance/.test(w))).toBe(true);
  });

  it("rejects a correction citing evidence absent from the packet", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            candidateCorrections: [
              { field: "thickness", proposedValue: "6mm", confidence: "medium", sourceUrls: ["https://unrelated.example.com/page"] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /cites a source not otherwise declared in the packet/)).toHaveLength(1);
  });

  it("rejects a high-confidence non-null correction while identity is uncertain or mismatched", () => {
    for (const status of ["uncertain", "mismatch"] as const) {
      const result = validateCatalogEvidencePacket(
        packet({
          products: [
            product({
              identity: { status, reason: "Could not confirm the exact model configuration." },
              candidateCorrections: [
                { field: "price", proposedValue: 129, confidence: "high", sourceUrls: [MANUFACTURER_URL] },
              ],
            }),
          ],
        }),
      );
      expect(result.hardGatePass, `expected identity ${status} to block a high-confidence correction`).toBe(false);
      expect(failuresMatching(result, /cannot carry a high-confidence, non-null correction/)).toHaveLength(1);
    }
  });

  it("allows a high-confidence nullifying correction while identity is uncertain", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            identity: { status: "uncertain", reason: "Could not confirm the exact model configuration." },
            candidateCorrections: [
              { field: "ipfApproved", proposedValue: null, confidence: "high", sourceUrls: [MANUFACTURER_URL] },
            ],
          }),
        ],
      }),
    );
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
  });

  it("requires a high-severity contradiction to produce an escalation or a correction", () => {
    const contradicted = product({
      claimFindings: [
        {
          claimId: "ks-sbd-7mm:ipf",
          field: "ipfApproved",
          catalogValue: true,
          finding: "contradicted",
          evidenceSupportedValue: false,
          severity: "high",
          sourceUrls: [MANUFACTURER_URL],
        },
      ],
    });

    const unresolved = validateCatalogEvidencePacket(packet({ products: [contradicted] }));
    expect(unresolved.hardGatePass).toBe(false);
    expect(failuresMatching(unresolved, /unresolved high-severity contradiction/)).toHaveLength(1);
    expect(unresolved.metrics.highSeverityConflictCount).toBe(1);

    const escalated = validateCatalogEvidencePacket(
      packet({ products: [{ ...contradicted, escalation: { required: true, reason: "Conflicting federation and vendor claims." } }] }),
    );
    expect(escalated.hardGatePass).toBe(true);

    const corrected = validateCatalogEvidencePacket(
      packet({
        products: [
          {
            ...contradicted,
            candidateCorrections: [
              { field: "ipfApproved", proposedValue: null, confidence: "medium", sourceUrls: [MANUFACTURER_URL] },
            ],
          },
        ],
      }),
    );
    expect(corrected.hardGatePass).toBe(true);
  });

  it("rejects a packet that carries its own batch aggregate counts", () => {
    const result = validateCatalogEvidencePacket({ ...packet(), productCount: 1, conflictCount: 0 });
    expect(result.hardGatePass).toBe(false);
    expect(result.metrics.schemaViolationCount).toBeGreaterThan(0);
    expect(failuresMatching(result, /Unrecognized key/)).not.toHaveLength(0);
  });

  it("warns when price evidence comes from a different market than the one evaluated", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        market: "US",
        products: [
          product({
            priceEvidence: {
              currentDisplayedPrice: 120,
              regularOrCompareAtPrice: 120,
              currency: "GBP",
              priceType: "regular",
              market: "UK",
              variantScope: "all sizes",
              sourceUrl: MANUFACTURER_URL,
            },
          }),
        ],
      }),
    );
    expect(result.hardGatePass).toBe(true);
    expect(result.warnings.some((w) => /differs from the evaluated market/.test(w))).toBe(true);
  });

  it("computes metrics from the packet itself rather than trusting the executor", () => {
    const result = validateCatalogEvidencePacket(
      packet({
        products: [
          product({
            identity: { status: "uncertain", reason: "Model configuration unconfirmed." },
            secondarySources: [
              { url: "https://reviews.example.com/sbd", organization: "Reviews", sourceType: "retailer", factsSupported: ["price"], reasonUsed: "No primary price page." },
            ],
            claimFindings: [
              { claimId: "a", field: "thickness", catalogValue: "7mm", finding: "supported", evidenceSupportedValue: "7mm", severity: "low", sourceUrls: [MANUFACTURER_URL] },
              { claimId: "b", field: "material", catalogValue: "neoprene", finding: "unresolved", evidenceSupportedValue: null, severity: "medium", sourceUrls: [] },
              { claimId: "c", field: "weight", catalogValue: "500g", finding: "contradicted", evidenceSupportedValue: "480g", severity: "low", sourceUrls: [MANUFACTURER_URL] },
            ],
            candidateCorrections: [
              { field: "weight", proposedValue: "480g", confidence: "medium", sourceUrls: [MANUFACTURER_URL] },
            ],
            escalation: { required: true, reason: "Material could not be resolved from any primary source." },
          }),
          product({ productId: "belt-inzer-forever", primarySources: [], claimFindings: [] }),
        ],
      }),
    );

    expect(result.metrics).toMatchObject({
      productCount: 2,
      exactIdentityCount: 1,
      uncertainIdentityCount: 1,
      mismatchIdentityCount: 0,
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
      schemaViolationCount: 0,
    });
  });

  it("is deterministic across repeated calls", () => {
    const input = packet();
    const first = validateCatalogEvidencePacket(input, { expectedProductIds: ["ks-sbd-7mm"] });
    const second = validateCatalogEvidencePacket(input, { expectedProductIds: ["ks-sbd-7mm"] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("evidence URL rules", () => {
  it("accepts a plain https URL", () => {
    expect(validateEvidenceUrl(MANUFACTURER_URL).ok).toBe(true);
  });

  it("rejects whitespace-padded, wrapped, and Markdown URLs", () => {
    expect(validateEvidenceUrl(` ${MANUFACTURER_URL}`).ok).toBe(false);
    expect(validateEvidenceUrl(`<${MANUFACTURER_URL}>`).ok).toBe(false);
    expect(validateEvidenceUrl(`[link](${MANUFACTURER_URL})`).ok).toBe(false);
  });
});

describe("catalog evidence hashing", () => {
  it("is stable across key ordering", () => {
    const a = packet();
    const b = JSON.parse(JSON.stringify({ authorityReport: a.authorityReport, products: a.products, market: a.market, generatedAt: a.generatedAt, executorKey: a.executorKey, runId: a.runId, schemaVersion: a.schemaVersion }));
    expect(hashCatalogEvidencePacket(b)).toBe(hashCatalogEvidencePacket(a));
  });

  it("is stable across repeated hashing of the same packet", () => {
    const a = packet();
    expect(hashCatalogEvidencePacket(a)).toBe(hashCatalogEvidencePacket(a));
    expect(hashCatalogEvidencePacket(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any packet content changes", () => {
    const base = hashCatalogEvidencePacket(packet());
    expect(hashCatalogEvidencePacket(packet({ market: "UK" }))).not.toBe(base);
    expect(hashCatalogEvidencePacket(packet({ products: [product({ identity: { status: "uncertain", reason: "Unconfirmed." } })] }))).not.toBe(base);
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
  const context = {
    expectedPacketHash: frozenHash,
    allClaimIds: collectClaimIds(frozen),
    highSeverityClaimIds: collectHighSeverityClaimIds(frozen),
  };

  it("accepts a well-formed review of the frozen packet", () => {
    const result = validateCatalogEvidenceReview(review({ evidencePacketHash: frozenHash }), context);
    expect(result.hardFailures).toEqual([]);
    expect(result.hardGatePass).toBe(true);
    expect(result.metrics.claimsReviewedCount).toBe(1);
    expect(result.metrics.acceptCount).toBe(1);
    expect(result.metrics.independentVerificationCount).toBe(1);
  });

  it("rejects a review referencing the wrong Hermes packet hash", () => {
    const result = validateCatalogEvidenceReview(review({ evidencePacketHash: "a".repeat(64) }), context);
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /does not match the frozen Hermes packet hash/)).toHaveLength(1);
  });

  it("rejects a review referencing a nonexistent claim", () => {
    const result = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        claimReviews: [
          { claimId: "fabricated:claim", verdict: "reject", independentVerificationPerformed: true, reason: "Invented.", independentSourceUrls: [], severity: "high" },
        ],
      }),
      context,
    );
    expect(result.hardGatePass).toBe(false);
    expect(result.metrics.fabricatedClaimIdCount).toBe(1);
    expect(failuresMatching(result, /does not exist in the frozen Hermes packet/)).toHaveLength(1);
  });

  it("requires every high-severity Hermes claim to receive an independent review", () => {
    const highSeverityPacket = packet({
      products: [
        product({
          claimFindings: [
            { claimId: "ks-sbd-7mm:ipf", field: "ipfApproved", catalogValue: true, finding: "contradicted", evidenceSupportedValue: false, severity: "high", sourceUrls: [MANUFACTURER_URL] },
          ],
          escalation: { required: true, reason: "Conflicting federation evidence." },
        }),
      ],
    });
    const highContext = {
      expectedPacketHash: hashCatalogEvidencePacket(highSeverityPacket),
      allClaimIds: collectClaimIds(highSeverityPacket),
      highSeverityClaimIds: collectHighSeverityClaimIds(highSeverityPacket),
    };

    const missing = validateCatalogEvidenceReview(
      review({ evidencePacketHash: highContext.expectedPacketHash, claimReviews: [] }),
      highContext,
    );
    expect(missing.hardGatePass).toBe(false);
    expect(missing.metrics.missingHighSeverityReviewCount).toBe(1);
    expect(failuresMatching(missing, /did not receive an independent review/)).toHaveLength(1);

    const covered = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: highContext.expectedPacketHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:ipf", verdict: "reject", independentVerificationPerformed: true, reason: "Federation list does not include this configuration.", independentSourceUrls: [APPROVED_LIST_URL], severity: "high" },
        ],
      }),
      highContext,
    );
    expect(covered.hardFailures).toEqual([]);
    expect(covered.hardGatePass).toBe(true);
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
    expect(markdown.hardGatePass).toBe(false);
    expect(markdown.metrics.malformedUrlCount).toBe(1);

    const insecure = validateCatalogEvidenceReview(
      review({
        evidencePacketHash: frozenHash,
        newFindings: [{ field: "price", finding: "Displayed price differs.", severity: "medium", sourceUrls: ["http://example.com/price"] }],
      }),
      context,
    );
    expect(insecure.hardGatePass).toBe(false);
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

  it("rejects a malformed review without throwing", () => {
    for (const bad of [null, 7, "text", [], { schemaVersion: "catalog-evidence-review/v1" }]) {
      const result = validateCatalogEvidenceReview(bad, context);
      expect(result.hardGatePass).toBe(false);
      expect(result.metrics.schemaViolationCount).toBeGreaterThan(0);
    }
  });

  it("structurally cannot carry a replacement evidence packet", () => {
    const result = validateCatalogEvidenceReview({ ...review({ evidencePacketHash: frozenHash }), products: frozen.products }, context);
    expect(result.hardGatePass).toBe(false);
    expect(failuresMatching(result, /Unrecognized key/)).not.toHaveLength(0);
  });
});

describe("full Hermes -> Grok -> deterministic flow", () => {
  it("passes end to end when every stage is clean", () => {
    const hermes = packet({
      products: [
        product({
          primarySources: [
            { url: MANUFACTURER_URL, organization: "SBD Apparel", sourceType: "manufacturer", factsSupported: ["thickness"], accessedDuringRun: true },
            { url: RULEBOOK_URL, organization: "IPF", sourceType: "federation-rulebook", factsSupported: ["thickness limit"], accessedDuringRun: true },
          ],
          claimFindings: [
            { claimId: "ks-sbd-7mm:thickness", field: "thickness", catalogValue: "7mm", finding: "supported", evidenceSupportedValue: "7mm", severity: "low", sourceUrls: [MANUFACTURER_URL] },
            { claimId: "ks-sbd-7mm:ipf", field: "ipfApproved", catalogValue: true, finding: "contradicted", evidenceSupportedValue: false, severity: "high", sourceUrls: [RULEBOOK_URL] },
          ],
          federationEvidence: [
            { federation: "IPF", status: "rule-compliant", scope: "exact-configuration", basis: "7mm is within the stated limit.", sourceUrls: [RULEBOOK_URL] },
          ],
          escalation: { required: true, reason: "Approval status conflicts with the catalog claim." },
        }),
      ],
    });

    const packetResult = validateCatalogEvidencePacket(hermes, { expectedProductIds: ["ks-sbd-7mm"] });
    expect(packetResult.hardFailures).toEqual([]);
    expect(packetResult.hardGatePass).toBe(true);

    const frozenHash = hashCatalogEvidencePacket(hermes);
    const grok = review({
      evidencePacketHash: frozenHash,
      claimReviews: [
        { claimId: "ks-sbd-7mm:thickness", verdict: "accept", independentVerificationPerformed: true, reason: "Re-read the manufacturer page.", independentSourceUrls: [MANUFACTURER_URL], severity: "low" },
        { claimId: "ks-sbd-7mm:ipf", verdict: "accept", independentVerificationPerformed: true, reason: "The approved list does not contain this configuration.", independentSourceUrls: [APPROVED_LIST_URL], severity: "high" },
      ],
      challengedAssumptions: ["Rulebook compliance was treated as equivalent to approved-list status."],
    });

    const reviewResult = validateCatalogEvidenceReview(grok, {
      expectedPacketHash: frozenHash,
      allClaimIds: collectClaimIds(hermes),
      highSeverityClaimIds: collectHighSeverityClaimIds(hermes),
    });
    expect(reviewResult.hardFailures).toEqual([]);
    expect(reviewResult.hardGatePass).toBe(true);
    expect(reviewResult.metrics.claimsReviewedCount).toBe(2);
  });

  it("keeps the review bound to the exact packet that was frozen", () => {
    const hermes = packet();
    const frozenHash = hashCatalogEvidencePacket(hermes);
    const tampered = packet({ market: "UK" });

    const grok = review({ evidencePacketHash: frozenHash });
    const againstTampered = validateCatalogEvidenceReview(grok, {
      expectedPacketHash: hashCatalogEvidencePacket(tampered),
      allClaimIds: collectClaimIds(tampered),
      highSeverityClaimIds: collectHighSeverityClaimIds(tampered),
    });
    expect(againstTampered.hardGatePass).toBe(false);
  });
});
