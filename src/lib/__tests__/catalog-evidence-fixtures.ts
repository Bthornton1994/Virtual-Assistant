import type { CandidateCorrection, CatalogEvidencePacketV1, CatalogEvidenceProduct } from "@/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";
import type { AuthorityReport } from "@/lib/catalog-evidence-shared";
import { collectPacketClaims } from "@/lib/catalog-evidence-validator";

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
export const USAPL_RULEBOOK_URL = "https://www.usapowerlifting.com/rules/technical";
export const USAPL_APPROVED_LIST_URL = "https://www.usapowerlifting.com/rules/approved-gear";

type PrimarySourceFixture = CatalogEvidenceProduct["primarySources"][number];

export function manufacturerSource(overrides: Partial<PrimarySourceFixture> = {}): PrimarySourceFixture {
  return {
    url: MANUFACTURER_URL,
    organization: "SBD Apparel",
    sourceType: "manufacturer",
    factsSupported: ["thickness"],
    accessedDuringRun: true,
    ...overrides,
  };
}

export function rulebookSource(overrides: Partial<PrimarySourceFixture> = {}): PrimarySourceFixture {
  return {
    url: RULEBOOK_URL,
    organization: "IPF",
    sourceType: "federation-rulebook",
    federation: "IPF",
    factsSupported: ["thickness limit"],
    accessedDuringRun: true,
    ...overrides,
  };
}

export function approvedListSource(overrides: Partial<PrimarySourceFixture> = {}): PrimarySourceFixture {
  return {
    url: APPROVED_LIST_URL,
    organization: "IPF",
    sourceType: "federation-approved-list",
    federation: "IPF",
    factsSupported: ["approval"],
    accessedDuringRun: true,
    ...overrides,
  };
}

export function catalogFieldCorrection(overrides: Partial<Extract<CandidateCorrection, { correctionKind: "catalog-field" }>> = {}) {
  return {
    correctionKind: "catalog-field" as const,
    field: "weight",
    proposedValue: "480g",
    federation: null,
    confidence: "medium" as const,
    sourceUrls: [] as string[],
    relatedClaimId: null,
    ...overrides,
  };
}

export function federationStatusCorrection(
  overrides: Partial<Extract<CandidateCorrection, { correctionKind: "federation-status" }>> = {},
) {
  return {
    correctionKind: "federation-status" as const,
    field: "approvals",
    federation: "IPF",
    proposedValue: true,
    confidence: "high" as const,
    sourceUrls: [] as string[],
    relatedClaimId: null,
    ...overrides,
  };
}

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

export const RUN_ID = "run-3d-0001";
export const MARKET = "US";
export const PRODUCT_ID = "ks-sbd-7mm";

/** Context matching the default `packet()` fixture, for review validation. */
export function reviewContext(hermes: CatalogEvidencePacketV1, packetHash: string) {
  return {
    expectedPacketHash: packetHash,
    claims: collectPacketClaims(hermes),
    packetProductIds: hermes.products.map((product) => product.productId),
    expectedRunId: RUN_ID,
    expectedReviewerKey: "grok-loadout-reviewer-v1",
  };
}

export function review(overrides: Partial<CatalogEvidenceReviewV1> = {}): CatalogEvidenceReviewV1 {
  return {
    schemaVersion: "catalog-evidence-review/v1",
    runId: RUN_ID,
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
