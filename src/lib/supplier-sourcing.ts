import { z } from "zod";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import {
  authorityReportSchema,
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
  severityLevelSchema,
  sumAuthorityReport,
  urlFieldSchema,
  type AuthorityReport,
} from "@/lib/catalog-evidence-shared";
import { validateEvidenceUrl } from "@/lib/catalog-evidence-validator";

export const SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION = "supplier-sourcing-input/v1" as const;
export const SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION = "supplier-sourcing-packet/v1" as const;
export const SUPPLIER_SOURCING_REVIEW_SCHEMA_VERSION = "supplier-sourcing-review/v1" as const;
export const SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION = "supplier-sourcing-validation/v1" as const;
export const SUPPLIER_SOURCING_REJECTION_SCHEMA_VERSION = "supplier-sourcing-rejection/v1" as const;

export const SUPPLIER_FULFILLMENT_MODES = ["supplier-direct", "partner-fulfilled"] as const;
export type SupplierFulfillmentMode = (typeof SUPPLIER_FULFILLMENT_MODES)[number];

export const SUPPLIER_CANDIDATE_STATUSES = [
  "candidate",
  "not-found",
  "disqualified",
  "needs-review",
] as const;
export type SupplierCandidateStatus = (typeof SUPPLIER_CANDIDATE_STATUSES)[number];

export const SUPPLIER_IDENTITY_STATUSES = ["exact", "partial", "mismatch", "unresolved"] as const;
export const SUPPLIER_EVIDENCE_FINDINGS = ["supported", "contradicted", "unresolved"] as const;
export const SUPPLIER_SOURCE_TYPES = [
  "manufacturer",
  "authorized-distributor",
  "fulfillment-provider",
  "brand-program",
  "policy",
  "other-primary",
] as const;
export const SUPPLIER_TYPES = [
  "manufacturer",
  "authorized-distributor",
  "fulfillment-provider",
  "other",
  "unknown",
] as const;
export const PUBLIC_CONTACT_CHANNELS = ["email", "web-form", "phone", "other"] as const;
export const REVIEW_VERDICTS = ["accept", "reject", "inconclusive"] as const;
export const COMMUNICATION_DISPOSITIONS = [
  "draft-only",
  "needs-human-approval",
  "not-ready",
] as const;

const findingSchema = z
  .object({
    status: z.enum(SUPPLIER_EVIDENCE_FINDINGS),
    basis: nonEmptyString,
    sourceUrls: z.array(urlFieldSchema),
    sourceArtifactHashes: z.array(sha256HexSchema),
  })
  .strict();
export type SupplierEvidenceFinding = z.infer<typeof findingSchema>;

const sourceArtifactSchema = z
  .object({
    url: urlFieldSchema,
    title: nonEmptyString,
    organization: nonEmptyString,
    sourceType: z.enum(SUPPLIER_SOURCE_TYPES),
    accessedAt: isoDateTimeSchema,
    validUntil: isoDateTimeSchema.nullable(),
    rawArtifactHash: sha256HexSchema,
    facts: z.array(nonEmptyString),
  })
  .strict();
export type SupplierSourceArtifact = z.infer<typeof sourceArtifactSchema>;

const supplierProductInputSchema = z
  .object({
    candidateId: identifierString,
    productId: identifierString.nullable(),
    productName: nonEmptyString,
    brand: nonEmptyString.nullable(),
    modelOrVariant: nonEmptyString.nullable(),
    category: nonEmptyString,
    desiredFulfillmentModes: z.array(z.enum(SUPPLIER_FULFILLMENT_MODES)).min(1),
    kitAssemblyRequired: z.boolean(),
    knownSourceUrls: z.array(urlFieldSchema),
    constraints: z.array(nonEmptyString),
  })
  .strict();
export type SupplierProductInput = z.infer<typeof supplierProductInputSchema>;

export const supplierSourcingInputManifestV1Schema = z
  .object({
    schemaVersion: z.literal(SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION),
    runId: identifierString,
    objective: nonEmptyString,
    market: nonEmptyString,
    catalogRepository: nonEmptyString.nullable(),
    catalogRepositorySha: z.string().regex(/^[0-9a-f]{40}$/i).nullable(),
    candidates: z.array(supplierProductInputSchema).min(1),
    prepareExecutorKey: identifierString,
    reviewExecutorKey: identifierString,
    createdAt: isoDateTimeSchema,
    inputHash: sha256HexSchema,
  })
  .strict();

export type SupplierSourcingInputManifestV1 = z.infer<typeof supplierSourcingInputManifestV1Schema>;

export function supplierSourcingInputHashSource(
  input: Pick<
    SupplierSourcingInputManifestV1,
    | "runId"
    | "objective"
    | "market"
    | "catalogRepository"
    | "catalogRepositorySha"
    | "candidates"
    | "prepareExecutorKey"
    | "reviewExecutorKey"
  >,
) {
  return {
    schemaVersion: SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION,
    runId: input.runId,
    objective: input.objective,
    market: input.market,
    catalogRepository: input.catalogRepository,
    catalogRepositorySha: input.catalogRepositorySha,
    candidates: [...input.candidates].sort((a, b) => (a.candidateId < b.candidateId ? -1 : 1)),
    prepareExecutorKey: input.prepareExecutorKey,
    reviewExecutorKey: input.reviewExecutorKey,
  };
}

export function hashSupplierSourcingInput(
  input: Pick<
    SupplierSourcingInputManifestV1,
    | "runId"
    | "objective"
    | "market"
    | "catalogRepository"
    | "catalogRepositorySha"
    | "candidates"
    | "prepareExecutorKey"
    | "reviewExecutorKey"
  >,
): string {
  return sha256Hex(supplierSourcingInputHashSource(input));
}

export function validateSupplierSourcingInputManifest(
  input: unknown,
): { ok: true; value: SupplierSourcingInputManifestV1 } | { ok: false; failures: string[] } {
  const parsed = supplierSourcingInputManifestV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      failures: parsed.error.issues.map(
        (issue) => "Supplier sourcing input " + (issue.path.join(".") || "(root)") + ": " + issue.message,
      ),
    };
  }

  const manifest = parsed.data;
  const candidateIds = manifest.candidates.map((candidate) => candidate.candidateId);
  const duplicates = candidateIds.filter((id, index) => candidateIds.indexOf(id) !== index);
  const failures: string[] = [];

  if (duplicates.length) {
    failures.push("Supplier sourcing input contains duplicate candidate IDs: " + [...new Set(duplicates)].join(", "));
  }
  if (manifest.prepareExecutorKey === manifest.reviewExecutorKey) {
    failures.push("Supplier sourcing prepare and review executors must be different.");
  }
  if (hashSupplierSourcingInput(manifest) !== manifest.inputHash) {
    failures.push("Supplier sourcing inputHash does not match the frozen brief.");
  }

  return failures.length ? { ok: false, failures } : { ok: true, value: manifest };
}

const outreachDraftSchema = z
  .object({
    status: z.enum(["draft", "not-prepared"]),
    channel: z.enum(PUBLIC_CONTACT_CHANNELS).nullable(),
    destination: nonEmptyString.nullable(),
    subject: nonEmptyString.nullable(),
    body: nonEmptyString.nullable(),
    factsUsedSourceUrls: z.array(urlFieldSchema),
    sent: z.literal(false),
    sentAt: z.null(),
  })
  .strict()
  .superRefine((draft, context) => {
    if (draft.status === "draft") {
      for (const key of ["channel", "destination", "subject", "body"] as const) {
        if (draft[key] === null) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "A draft outreach record requires " + key + ".",
          });
        }
      }
      if (!draft.factsUsedSourceUrls.length) {
        context.addIssue({
          code: "custom",
          path: ["factsUsedSourceUrls"],
          message: "A draft outreach record must cite the facts it uses.",
        });
      }
    } else if (
      draft.channel !== null ||
      draft.destination !== null ||
      draft.subject !== null ||
      draft.body !== null ||
      draft.factsUsedSourceUrls.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A not-prepared outreach record cannot contain draft content.",
      });
    }
  });
export type SupplierOutreachDraft = z.infer<typeof outreachDraftSchema>;

const supplierIdentitySchema = z
  .object({
    status: z.enum(SUPPLIER_IDENTITY_STATUSES),
    tradingName: nonEmptyString.nullable(),
    legalName: nonEmptyString.nullable(),
    websiteUrl: urlFieldSchema.nullable(),
    supplierType: z.enum(SUPPLIER_TYPES),
    sourceUrls: z.array(urlFieldSchema),
    reason: nonEmptyString,
  })
  .strict();
export type SupplierIdentityEvidence = z.infer<typeof supplierIdentitySchema>;

const productFitSchema = z
  .object({
    status: z.enum(["exact", "partial", "mismatch", "unresolved"]),
    basis: nonEmptyString,
    sourceUrls: z.array(urlFieldSchema),
  })
  .strict();

const sellerOfRecordSchema = z
  .object({
    value: z.enum(["supplier", "partner", "grounded", "unknown"]),
    evidence: findingSchema,
  })
  .strict();

const supplierCandidateSchema = z
  .object({
    candidateId: identifierString,
    productId: identifierString.nullable(),
    status: z.enum(SUPPLIER_CANDIDATE_STATUSES),
    supplierIdentity: supplierIdentitySchema,
    productFit: productFitSchema,
    fulfillment: z
      .object({
        supplierDirect: findingSchema,
        partnerFulfilled: findingSchema,
        kitAssembly: findingSchema,
        inventoryModel: z.enum(["supplier-direct", "partner-fulfilled", "owned-inventory", "unknown"]),
        shipping: findingSchema,
        returns: findingSchema,
        availability: findingSchema,
        compliance: findingSchema,
        sellerOfRecord: sellerOfRecordSchema,
      })
      .strict(),
    commercialTerms: z
      .object({
        pricing: findingSchema,
        minimumOrderQuantity: findingSchema,
        dropshipFees: findingSchema,
        kitAssemblyFees: findingSchema,
      })
      .strict(),
    publicContactChannels: z.array(
      z
        .object({
          channel: z.enum(PUBLIC_CONTACT_CHANNELS),
          value: nonEmptyString,
          sourceUrl: urlFieldSchema,
        })
        .strict(),
    ),
    sourceArtifacts: z.array(sourceArtifactSchema),
    outreachDraft: outreachDraftSchema,
    escalation: z
      .object({
        required: z.boolean(),
        reason: z.string(),
      })
      .strict(),
  })
  .strict();
export type SupplierCandidate = z.infer<typeof supplierCandidateSchema>;

const zeroAuthorityReport: AuthorityReport = {
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

export const supplierSourcingPacketV1Schema = z
  .object({
    schemaVersion: z.literal(SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION),
    runId: identifierString,
    inputHash: sha256HexSchema,
    executorKey: identifierString,
    generatedAt: isoDateTimeSchema,
    market: nonEmptyString,
    candidates: z.array(supplierCandidateSchema).min(1),
    authorityReport: authorityReportSchema,
  })
  .strict();

export type SupplierSourcingPacketV1 = z.infer<typeof supplierSourcingPacketV1Schema>;

export const supplierSourcingReviewV1Schema = z
  .object({
    schemaVersion: z.literal(SUPPLIER_SOURCING_REVIEW_SCHEMA_VERSION),
    runId: identifierString,
    evidencePacketHash: sha256HexSchema,
    reviewerExecutorKey: identifierString,
    reviewedAt: isoDateTimeSchema,
    candidateReviews: z.array(
      z
        .object({
          candidateId: identifierString,
          verdict: z.enum(REVIEW_VERDICTS),
          reason: nonEmptyString,
          independentSourceUrls: z.array(urlFieldSchema),
          evidenceGaps: z.array(nonEmptyString),
          severity: severityLevelSchema,
        })
        .strict(),
    ),
    communicationDisposition: z.enum(COMMUNICATION_DISPOSITIONS),
    escalationRequired: z.boolean(),
    escalationReason: z.string(),
    authorityReport: authorityReportSchema,
  })
  .strict();

export type SupplierSourcingReviewV1 = z.infer<typeof supplierSourcingReviewV1Schema>;

export type SupplierSourcingValidationMetrics = {
  candidateCount: number;
  exactSupplierCount: number;
  supplierDirectSupportedCount: number;
  partnerFulfilledSupportedCount: number;
  kitAssemblySupportedCount: number;
  unresolvedCandidateCount: number;
  disqualifiedCandidateCount: number;
  sourceArtifactCount: number;
  outreachDraftCount: number;
  authorityIncidentCount: number;
  malformedUrlCount: number;
  schemaViolationCount: number;
};

export type SupplierSourcingValidationResult = {
  schemaVersion: typeof SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION;
  hardGatePass: boolean;
  hardFailures: string[];
  warnings: string[];
  metrics: SupplierSourcingValidationMetrics;
};

function emptyMetrics(): SupplierSourcingValidationMetrics {
  return {
    candidateCount: 0,
    exactSupplierCount: 0,
    supplierDirectSupportedCount: 0,
    partnerFulfilledSupportedCount: 0,
    kitAssemblySupportedCount: 0,
    unresolvedCandidateCount: 0,
    disqualifiedCandidateCount: 0,
    sourceArtifactCount: 0,
    outreachDraftCount: 0,
    authorityIncidentCount: 0,
    malformedUrlCount: 0,
    schemaViolationCount: 0,
  };
}

function urlsInCandidate(candidate: SupplierCandidate): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string" && value.startsWith("http")) urls.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(visit);
  };
  visit(candidate);
  return [...urls];
}

function validUrl(url: string): boolean {
  return validateEvidenceUrl(url).ok && /^https:\/\//i.test(url);
}

export function hashSupplierSourcingPacket(packet: SupplierSourcingPacketV1): string {
  return sha256Hex(packet);
}

export function hashSupplierSourcingReview(review: SupplierSourcingReviewV1): string {
  return sha256Hex(review);
}

export function validateSupplierSourcingPacket(
  input: unknown,
  expected: {
    manifest: SupplierSourcingInputManifestV1;
    expectedExecutorKey?: string;
  },
): SupplierSourcingValidationResult {
  const metrics = emptyMetrics();
  const parsed = supplierSourcingPacketV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      schemaVersion: SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
      hardGatePass: false,
      hardFailures: parsed.error.issues.map(
        (issue) => "Supplier sourcing packet " + (issue.path.join(".") || "(root)") + ": " + issue.message,
      ),
      warnings: [],
      metrics: { ...metrics, schemaViolationCount: parsed.error.issues.length },
    };
  }

  const packet = parsed.data;
  metrics.candidateCount = packet.candidates.length;
  metrics.exactSupplierCount = packet.candidates.filter(
    (candidate) => candidate.supplierIdentity.status === "exact",
  ).length;
  metrics.supplierDirectSupportedCount = packet.candidates.filter(
    (candidate) => candidate.fulfillment.supplierDirect.status === "supported",
  ).length;
  metrics.partnerFulfilledSupportedCount = packet.candidates.filter(
    (candidate) => candidate.fulfillment.partnerFulfilled.status === "supported",
  ).length;
  metrics.kitAssemblySupportedCount = packet.candidates.filter(
    (candidate) => candidate.fulfillment.kitAssembly.status === "supported",
  ).length;
  metrics.unresolvedCandidateCount = packet.candidates.filter(
    (candidate) => candidate.status === "needs-review" || candidate.status === "not-found",
  ).length;
  metrics.disqualifiedCandidateCount = packet.candidates.filter(
    (candidate) => candidate.status === "disqualified",
  ).length;
  metrics.sourceArtifactCount = packet.candidates.reduce(
    (total, candidate) => total + candidate.sourceArtifacts.length,
    0,
  );
  metrics.outreachDraftCount = packet.candidates.filter(
    (candidate) => candidate.outreachDraft.status === "draft",
  ).length;
  metrics.authorityIncidentCount = sumAuthorityReport(packet.authorityReport);

  const failures: string[] = [];
  const warnings: string[] = [];
  const expectedCandidates = new Map(expected.manifest.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seenCandidateIds = new Set<string>();
  const sourceHashes = new Set<string>();
  const sourceUrls = new Set<string>();

  if (packet.runId !== expected.manifest.runId) failures.push("Supplier sourcing packet runId does not match the frozen input.");
  if (packet.inputHash !== expected.manifest.inputHash) failures.push("Supplier sourcing packet inputHash does not match the frozen input.");
  if (packet.market !== expected.manifest.market) failures.push("Supplier sourcing packet market does not match the frozen input.");
  if (expected.expectedExecutorKey && packet.executorKey !== expected.expectedExecutorKey) {
    failures.push("Supplier sourcing packet executorKey does not match the frozen prepare executor.");
  }
  if (metrics.authorityIncidentCount > 0) failures.push("Supplier sourcing packet reports a forbidden authority action.");
  if (packet.candidates.length !== expectedCandidates.size) {
    failures.push("Supplier sourcing packet candidate count does not match the frozen brief.");
  }

  for (const candidate of packet.candidates) {
    if (seenCandidateIds.has(candidate.candidateId)) {
      failures.push("Supplier sourcing packet contains duplicate candidate ID " + candidate.candidateId + ".");
    }
    seenCandidateIds.add(candidate.candidateId);

    const expectedCandidate = expectedCandidates.get(candidate.candidateId);
    if (!expectedCandidate) {
      failures.push("Supplier sourcing packet contains unexpected candidate " + candidate.candidateId + ".");
      continue;
    }
    if (candidate.productId !== expectedCandidate.productId) {
      failures.push("Supplier sourcing candidate " + candidate.candidateId + " productId does not match the frozen brief.");
    }

    for (const artifact of candidate.sourceArtifacts) {
      sourceHashes.add(artifact.rawArtifactHash);
      sourceUrls.add(artifact.url);
      if (!validUrl(artifact.url)) {
        metrics.malformedUrlCount += 1;
        failures.push("Supplier sourcing source artifact URL is not a plain public HTTPS URL: " + artifact.url);
      }
      if (artifact.validUntil && Date.parse(artifact.validUntil) < Date.parse(artifact.accessedAt)) {
        failures.push("Supplier sourcing source artifact validUntil precedes accessedAt for " + artifact.url + ".");
      }
    }

    for (const url of urlsInCandidate(candidate)) {
      if (!validUrl(url)) {
        metrics.malformedUrlCount += 1;
        failures.push("Supplier sourcing candidate contains a non-public HTTPS URL: " + url);
      }
    }

    const findings = [
      candidate.fulfillment.supplierDirect,
      candidate.fulfillment.partnerFulfilled,
      candidate.fulfillment.kitAssembly,
      candidate.fulfillment.shipping,
      candidate.fulfillment.returns,
      candidate.fulfillment.availability,
      candidate.fulfillment.compliance,
      candidate.fulfillment.sellerOfRecord.evidence,
      candidate.commercialTerms.pricing,
      candidate.commercialTerms.minimumOrderQuantity,
      candidate.commercialTerms.dropshipFees,
      candidate.commercialTerms.kitAssemblyFees,
    ];
    for (const finding of findings) {
      if (finding.status === "supported" && (!finding.sourceUrls.length || !finding.sourceArtifactHashes.length)) {
        failures.push("A supported supplier sourcing finding must cite source URLs and raw artifact hashes for " + candidate.candidateId + ".");
      }
      for (const hash of finding.sourceArtifactHashes) {
        if (!sourceHashes.has(hash)) warnings.push("Finding on " + candidate.candidateId + " references an artifact hash not yet visited.");
      }
    }

    if (candidate.fulfillment.inventoryModel === "owned-inventory") {
      failures.push("Supplier sourcing packet proposes owned inventory, which is outside the Grounded operating constraint.");
    }
    if (candidate.fulfillment.sellerOfRecord.value === "grounded") {
      failures.push("Supplier sourcing packet implies Grounded is seller of record; a human commercial decision is required and no owned-inventory assumption is allowed.");
    }
    if (candidate.outreachDraft.sent || candidate.outreachDraft.sentAt !== null) {
      failures.push("Supplier sourcing packet contains a sent outreach claim; this contract is draft-only.");
    }
    if (candidate.outreachDraft.status === "draft") {
      warnings.push("Supplier outreach draft for " + candidate.candidateId + " requires explicit human approval before transmission.");
    }
    if (candidate.status === "candidate" && candidate.supplierIdentity.status !== "exact") {
      warnings.push("Candidate " + candidate.candidateId + " is not an exact supplier identity match.");
    }
    if (candidate.supplierIdentity.status === "exact" && !candidate.supplierIdentity.sourceUrls.length) {
      failures.push("An exact supplier identity must cite at least one source URL.");
    }
  }

  for (const expectedCandidate of expected.manifest.candidates) {
    if (!seenCandidateIds.has(expectedCandidate.candidateId)) {
      failures.push("Supplier sourcing packet is missing frozen candidate " + expectedCandidate.candidateId + ".");
    }
  }

  return {
    schemaVersion: SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
    hardGatePass: failures.length === 0,
    hardFailures: failures,
    warnings,
    metrics,
  };
}

export type SupplierSourcingReviewValidationResult = {
  hardGatePass: boolean;
  hardFailures: string[];
  warnings: string[];
};

export function validateSupplierSourcingReview(
  input: unknown,
  expected: {
    manifest: SupplierSourcingInputManifestV1;
    packetHash: string;
    expectedReviewerKey?: string;
  },
): SupplierSourcingReviewValidationResult {
  const parsed = supplierSourcingReviewV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      hardGatePass: false,
      hardFailures: parsed.error.issues.map(
        (issue) => "Supplier sourcing review " + (issue.path.join(".") || "(root)") + ": " + issue.message,
      ),
      warnings: [],
    };
  }

  const review = parsed.data;
  const failures: string[] = [];
  const warnings: string[] = [];
  const expectedIds = new Set(expected.manifest.candidates.map((candidate) => candidate.candidateId));
  const seen = new Set<string>();

  if (review.runId !== expected.manifest.runId) failures.push("Supplier sourcing review runId does not match the frozen input.");
  if (review.evidencePacketHash !== expected.packetHash) failures.push("Supplier sourcing review is not bound to the exact supplier packet hash.");
  if (expected.expectedReviewerKey && review.reviewerExecutorKey !== expected.expectedReviewerKey) {
    failures.push("Supplier sourcing review reviewerExecutorKey does not match the frozen reviewer.");
  }
  if (sumAuthorityReport(review.authorityReport) > 0) failures.push("Supplier sourcing review reports a forbidden authority action.");
  if (review.communicationDisposition === "needs-human-approval") {
    warnings.push("Supplier communication remains blocked until a human approves the exact draft, recipient, and source facts.");
  }

  for (const candidateReview of review.candidateReviews) {
    if (seen.has(candidateReview.candidateId)) {
      failures.push("Supplier sourcing review contains duplicate candidate review " + candidateReview.candidateId + ".");
    }
    seen.add(candidateReview.candidateId);
    if (!expectedIds.has(candidateReview.candidateId)) {
      failures.push("Supplier sourcing review contains an unexpected candidate " + candidateReview.candidateId + ".");
    }
    for (const url of candidateReview.independentSourceUrls) {
      if (!validUrl(url)) {
        failures.push("Supplier sourcing review contains a non-public HTTPS URL: " + url);
      }
    }
  }

  for (const expectedId of expectedIds) {
    if (!seen.has(expectedId)) failures.push("Supplier sourcing review is missing candidate " + expectedId + ".");
  }

  return { hardGatePass: failures.length === 0, hardFailures: failures, warnings };
}

export function supplierSourcingAuthorityReport(): AuthorityReport {
  return { ...zeroAuthorityReport };
}

export function serializeSupplierSourcingValidation(
  result: SupplierSourcingValidationResult,
): Record<string, unknown> {
  return {
    schemaVersion: SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
    ...result,
  };
}

export function serializeSupplierSourcingRejection(
  runId: string,
  executorKey: string,
  rawOutputHash: string,
  failures: string[],
): Record<string, unknown> {
  return {
    schemaVersion: SUPPLIER_SOURCING_REJECTION_SCHEMA_VERSION,
    runId,
    executorKey,
    rawOutputHash,
    failures: [...failures],
    generatedAt: new Date().toISOString(),
  };
}

export const supplierSourcingContractSummary = {
  input: SUPPLIER_SOURCING_INPUT_SCHEMA_VERSION,
  packet: SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION,
  review: SUPPLIER_SOURCING_REVIEW_SCHEMA_VERSION,
  validation: SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
  allowedActionClass: "prepare_only",
  forbidden: [
    "send_supplier_message",
    "assert_supplier_relationship",
    "purchase",
    "hold_inventory",
    "modify_catalog",
    "publish",
    "merge",
  ],
} as const;

// Keep this module's canonicalization dependency visible to contract reviewers.
export const supplierSourcingCanonicalization = canonicalJsonStringify;
