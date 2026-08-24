import { z } from "zod";
import {
  authorityReportSchema,
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
  severityLevelSchema,
  urlFieldSchema,
} from "@/lib/catalog-evidence-shared";

// CatalogEvidenceReviewV1 — the typed, versioned contract an independent reviewer
// executor (e.g. Grok) returns after challenging a frozen CatalogEvidencePacketV1.
// A review never edits the packet it reviews; it is a separate immutable artifact
// that references the packet only by its content hash (catalog-evidence-hash.ts).

export const CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION = "catalog-evidence-review/v1" as const;

export const CLAIM_VERDICTS = ["accept", "reject", "inconclusive"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

// A 64-character lowercase hex SHA-256 digest, as produced by hashCatalogEvidencePacket.
export const sha256HexSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/, "must be a 64-character lowercase hex SHA-256 digest");

const claimReviewSchema = z
  .object({
    claimId: identifierString,
    verdict: z.enum(CLAIM_VERDICTS),
    independentVerificationPerformed: z.boolean(),
    reason: nonEmptyString,
    independentSourceUrls: z.array(urlFieldSchema),
    severity: severityLevelSchema,
  })
  .strict();
export type ClaimReview = z.infer<typeof claimReviewSchema>;

const newFindingSchema = z
  .object({
    // A new finding must be attached to a specific product from the frozen
    // batch: a five-product review must never contain an unattached generic
    // finding that no later stage can trace back to what it is actually about.
    productId: identifierString,
    // Deterministic reference for this finding, distinct from productId so two
    // findings on the same product remain individually addressable.
    findingId: identifierString,
    field: nonEmptyString,
    finding: nonEmptyString,
    severity: severityLevelSchema,
    sourceUrls: z.array(urlFieldSchema),
  })
  .strict();
export type NewFinding = z.infer<typeof newFindingSchema>;

export const catalogEvidenceReviewV1Schema = z
  .object({
    schemaVersion: z.literal(CATALOG_EVIDENCE_REVIEW_SCHEMA_VERSION),
    runId: identifierString,
    evidencePacketHash: sha256HexSchema,
    reviewerExecutorKey: identifierString,
    reviewedAt: isoDateTimeSchema,
    claimReviews: z.array(claimReviewSchema),
    newFindings: z.array(newFindingSchema),
    evidenceGaps: z.array(nonEmptyString),
    challengedAssumptions: z.array(nonEmptyString),
    escalationRequired: z.boolean(),
    escalationReason: z.string(),
    authorityReport: authorityReportSchema,
  })
  .strict();

export type CatalogEvidenceReviewV1 = z.infer<typeof catalogEvidenceReviewV1Schema>;

export function parseCatalogEvidenceReviewV1(input: unknown) {
  return catalogEvidenceReviewV1Schema.safeParse(input);
}
