import { z } from "zod";
import {
  authorityReportSchema,
  claimValueSchema,
  confidenceLevelSchema,
  isoDateTimeSchema,
  nonEmptyString,
  severityLevelSchema,
  urlFieldSchema,
} from "@/lib/catalog-evidence-shared";

// CatalogEvidencePacketV1 — the typed, versioned contract a research executor
// (e.g. Hermes) returns instead of a prose report. It is prepare-only evidence:
// it never becomes an authoritative catalog change by itself, and it carries its
// own authority report so a deterministic gate can prove nothing outside the
// research/prepare envelope was attempted.
//
// Field-by-field shape follows the Step 3D specification exactly. Interpretive
// choices (documented in docs/STEP-3D-WORK-CELL.md) were made only where the
// spec left a type genuinely open, and are called out inline below.

export const CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION = "catalog-evidence-packet/v1" as const;

export const IDENTITY_STATUSES = ["exact", "uncertain", "mismatch"] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const PRIMARY_SOURCE_TYPES = [
  "manufacturer",
  "federation-rulebook",
  "federation-approved-list",
  "other-primary",
] as const;
export type PrimarySourceType = (typeof PRIMARY_SOURCE_TYPES)[number];

export const PRICE_TYPES = ["regular", "sale", "variant-specific", "unavailable"] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const CLAIM_FINDING_VALUES = ["supported", "contradicted", "unresolved"] as const;
export type ClaimFindingValue = (typeof CLAIM_FINDING_VALUES)[number];

export const FEDERATION_STATUSES = [
  "approved-list",
  "rule-compliant",
  "manufacturer-claimed-compliant",
  "rule-noncompliant",
  "unknown",
  "not-applicable",
] as const;
export type FederationStatus = (typeof FEDERATION_STATUSES)[number];

export const FEDERATION_SCOPES = ["exact-configuration", "product-family", "category"] as const;
export type FederationScope = (typeof FEDERATION_SCOPES)[number];

const identitySchema = z
  .object({
    status: z.enum(IDENTITY_STATUSES),
    reason: nonEmptyString,
  })
  .strict();

const primarySourceSchema = z
  .object({
    url: urlFieldSchema,
    organization: nonEmptyString,
    // Unlike primary sources, the spec leaves secondary-source sourceType open-ended
    // (no enumerated list was given), so it is typed as free text there. Primary
    // sources are the ones the federation hard gates reason about, so that
    // enumeration is load-bearing and kept closed here.
    sourceType: z.enum(PRIMARY_SOURCE_TYPES),
    // Which federation this document actually belongs to. Required by the
    // validator for federation-rulebook and federation-approved-list sources,
    // because a conclusion about USAPL cannot be carried by an IPF document.
    federation: z.string().trim().optional(),
    factsSupported: z.array(nonEmptyString),
    accessedDuringRun: z.boolean(),
  })
  .strict();
export type PrimarySource = z.infer<typeof primarySourceSchema>;

const secondarySourceSchema = z
  .object({
    url: urlFieldSchema,
    organization: nonEmptyString,
    sourceType: nonEmptyString,
    factsSupported: z.array(nonEmptyString),
    reasonUsed: nonEmptyString,
  })
  .strict();
export type SecondarySource = z.infer<typeof secondarySourceSchema>;

// A product whose price genuinely could not be resolved must be representable
// without fabricating a price or a source. When priceType is "unavailable" the
// price, comparison price, variant scope, and source URL may all be null; for
// every other price type the validator requires them.
const priceEvidenceSchema = z
  .object({
    currentDisplayedPrice: z.number().nonnegative().nullable(),
    regularOrCompareAtPrice: z.number().nonnegative().nullable(),
    currency: nonEmptyString,
    priceType: z.enum(PRICE_TYPES),
    market: nonEmptyString,
    variantScope: nonEmptyString.nullable(),
    sourceUrl: urlFieldSchema.nullable(),
  })
  .strict();
export type PriceEvidence = z.infer<typeof priceEvidenceSchema>;

const claimFindingSchema = z
  .object({
    claimId: nonEmptyString,
    field: nonEmptyString,
    catalogValue: claimValueSchema,
    finding: z.enum(CLAIM_FINDING_VALUES),
    evidenceSupportedValue: claimValueSchema,
    severity: severityLevelSchema,
    sourceUrls: z.array(urlFieldSchema),
  })
  .strict();
export type ClaimFinding = z.infer<typeof claimFindingSchema>;

const federationEvidenceSchema = z
  .object({
    federation: nonEmptyString,
    status: z.enum(FEDERATION_STATUSES),
    scope: z.enum(FEDERATION_SCOPES),
    basis: nonEmptyString,
    sourceUrls: z.array(urlFieldSchema),
  })
  .strict();
export type FederationEvidence = z.infer<typeof federationEvidenceSchema>;

const candidateCorrectionSchema = z
  .object({
    field: nonEmptyString,
    proposedValue: claimValueSchema,
    confidence: confidenceLevelSchema,
    sourceUrls: z.array(urlFieldSchema),
  })
  .strict();
export type CandidateCorrection = z.infer<typeof candidateCorrectionSchema>;

const escalationSchema = z
  .object({
    required: z.boolean(),
    reason: z.string(),
  })
  .strict();

const catalogProductSchema = z
  .object({
    productId: nonEmptyString,
    identity: identitySchema,
    primarySources: z.array(primarySourceSchema),
    secondarySources: z.array(secondarySourceSchema),
    priceEvidence: priceEvidenceSchema,
    claimFindings: z.array(claimFindingSchema),
    federationEvidence: z.array(federationEvidenceSchema),
    candidateCorrections: z.array(candidateCorrectionSchema),
    escalation: escalationSchema,
  })
  .strict();
export type CatalogEvidenceProduct = z.infer<typeof catalogProductSchema>;

export const catalogEvidencePacketV1Schema = z
  .object({
    schemaVersion: z.literal(CATALOG_EVIDENCE_PACKET_SCHEMA_VERSION),
    runId: nonEmptyString,
    executorKey: nonEmptyString,
    generatedAt: isoDateTimeSchema,
    market: nonEmptyString,
    products: z.array(catalogProductSchema),
    authorityReport: authorityReportSchema,
  })
  .strict();

export type CatalogEvidencePacketV1 = z.infer<typeof catalogEvidencePacketV1Schema>;

export function parseCatalogEvidencePacketV1(input: unknown) {
  return catalogEvidencePacketV1Schema.safeParse(input);
}
