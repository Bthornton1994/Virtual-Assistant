import type { CatalogEvidencePacketV1, CatalogEvidenceProduct } from "@/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";
import type { AuthorityReport } from "@/lib/catalog-evidence-shared";

export const ZERO_AUTHORITY: AuthorityReport = {
  externalMessagesSent: 0,
  purchasesMade: 0,
  accountsCreated: 0,
  repositoryChangesMade: 0,
  catalogRecordsModified: 0,
  permissionsChanged: 0,
  skillsCreatedOrModified: 0,
  routinesCreatedOrModified: 0,
  otherExternalActions: 0,
};

export const MANUFACTURER_URL = "https://www.sbdapparel.com/products/7mm-knee-sleeves";
export const RULEBOOK_URL = "https://www.powerlifting.sport/rules/technical-rules";
export const APPROVED_LIST_URL = "https://www.powerlifting.sport/rules/approved-list";

export function product(overrides: Partial<CatalogEvidenceProduct> = {}): CatalogEvidenceProduct {
  return {
    productId: "ks-sbd-7mm",
    identity: { status: "exact", reason: "Exact model matched against the manufacturer product page." },
    primarySources: [
      {
        url: MANUFACTURER_URL,
        organization: "SBD Apparel",
        sourceType: "manufacturer",
        factsSupported: ["thickness", "material"],
        accessedDuringRun: true,
      },
    ],
    secondarySources: [],
    priceEvidence: {
      currentDisplayedPrice: 145,
      regularOrCompareAtPrice: 145,
      currency: "USD",
      priceType: "regular",
      market: "US",
      variantScope: "all sizes",
      sourceUrl: MANUFACTURER_URL,
    },
    claimFindings: [
      {
        claimId: "ks-sbd-7mm:thickness",
        field: "thickness",
        catalogValue: "7mm",
        finding: "supported",
        evidenceSupportedValue: "7mm",
        severity: "low",
        sourceUrls: [MANUFACTURER_URL],
      },
    ],
    federationEvidence: [],
    candidateCorrections: [],
    escalation: { required: false, reason: "" },
    ...overrides,
  };
}

export function packet(overrides: Partial<CatalogEvidencePacketV1> = {}): CatalogEvidencePacketV1 {
  return {
    schemaVersion: "catalog-evidence-packet/v1",
    runId: "run-3d-0001",
    executorKey: "hermes-loadout-researcher-v1",
    generatedAt: "2026-08-23T12:00:00Z",
    market: "US",
    products: [product()],
    authorityReport: { ...ZERO_AUTHORITY },
    ...overrides,
  };
}

export function review(overrides: Partial<CatalogEvidenceReviewV1> = {}): CatalogEvidenceReviewV1 {
  return {
    schemaVersion: "catalog-evidence-review/v1",
    runId: "run-3d-0001",
    evidencePacketHash: "0".repeat(64),
    reviewerExecutorKey: "grok-loadout-reviewer-v1",
    reviewedAt: "2026-08-23T13:00:00Z",
    claimReviews: [
      {
        claimId: "ks-sbd-7mm:thickness",
        verdict: "accept",
        independentVerificationPerformed: true,
        reason: "Independently re-read the manufacturer specification page.",
        independentSourceUrls: [MANUFACTURER_URL],
        severity: "low",
      },
    ],
    newFindings: [],
    evidenceGaps: [],
    challengedAssumptions: [],
    escalationRequired: false,
    escalationReason: "",
    authorityReport: { ...ZERO_AUTHORITY },
    ...overrides,
  };
}
