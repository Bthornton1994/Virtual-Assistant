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

// Non-empty, non-whitespace-only string. Used for anything that must carry real content.
export const nonEmptyString = z.string().trim().min(1);

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
