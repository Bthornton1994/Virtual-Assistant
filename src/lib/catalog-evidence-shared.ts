import { z } from "zod";

// Shared primitives reused by CatalogEvidencePacketV1 and CatalogEvidenceReviewV1.
// Kept separate so the packet and review schemas can be authored, versioned, and
// read independently while still agreeing on vocabulary.

export const SEVERITY_LEVELS = ["low", "medium", "high"] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];
export const severityLevelSchema = z.enum(SEVERITY_LEVELS);

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export const confidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);

// A claim value is whatever a catalog field or a proposed correction actually holds.
// It is intentionally untyped beyond JSON scalars: the validator, not the schema,
// decides whether a given value is acceptable for a given field.
export const claimValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ClaimValue = z.infer<typeof claimValueSchema>;

// Non-empty, non-whitespace-only string. Used for prose fields, where trimming is
// harmless because nothing matches on the value.
export const nonEmptyString = z.string().trim().min(1);

// An identifier that other artifacts match against by value: product IDs, claim
// IDs, run IDs, executor keys.
//
// Deliberately does NOT trim. `nonEmptyString`'s `.trim()` is a transform, so a
// padded value parses to a trimmed one while the stored artifact keeps the
// padding — and the packet is stored and hashed verbatim. That divergence made a
// padded claim ID unmatchable: the review context read " ks:ipf " from the raw
// payload while the reviewer's own " ks:ipf " parsed to "ks:ipf", so the claim
// could never be reviewed and the packet could never be verified, reporting the
// nonsensical "claimId does not exist" for an ID plainly present in the packet.
//
// Rejecting padding outright keeps raw and parsed identical for anything that is
// matched on, and follows the same doctrine as the rest of this contract: a
// malformed identifier is executor output worth surfacing, not worth repairing.
export const identifierString = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "must not have leading or trailing whitespace")
  .refine((value) => value.trim().length > 0, "must not be blank");

// A URL field as authored by an executor. This intentionally accepts any non-empty
// string rather than z.string().url(): the deterministic validator (not the schema)
// is the single source of truth for "is this an acceptable https:// evidence URL,"
// including the Markdown-link rejection in catalog-evidence-validator.ts. Keeping
// shape validation here and content validation in the validator avoids the two
// layers silently disagreeing about what counts as a malformed URL.
export const urlFieldSchema = z.string().min(1);

export const authorityReportSchema = z
  .object({
    externalMessagesSent: z.number().int().min(0),
    purchasesMade: z.number().int().min(0),
    accountsCreated: z.number().int().min(0),
    repositoryChangesMade: z.number().int().min(0),
    catalogRecordsModified: z.number().int().min(0),
    permissionsChanged: z.number().int().min(0),
    skillsCreatedOrModified: z.number().int().min(0),
    routinesCreatedOrModified: z.number().int().min(0),
    otherExternalActions: z.number().int().min(0),
  })
  .strict();
export type AuthorityReport = z.infer<typeof authorityReportSchema>;

export function sumAuthorityReport(report: AuthorityReport): number {
  return Object.values(report).reduce((total, value) => total + value, 0);
}

export const isoDateTimeSchema = z.iso.datetime({ offset: true });
