import {
  catalogEvidencePacketV1Schema,
  type CatalogEvidencePacketV1,
  type CatalogEvidenceProduct,
} from "@/lib/catalog-evidence-packet";
import { catalogEvidenceReviewV1Schema } from "@/lib/catalog-evidence-review";
import { sumAuthorityReport } from "@/lib/catalog-evidence-shared";

// Deterministic gates for CatalogEvidencePacketV1 and CatalogEvidenceReviewV1.
//
// Hard invariant for this whole module: given the same input, it always returns
// the same result. No network access, no LLM call, no clock, no randomness. That
// is what makes it trustworthy as the machine that decides hard_gate_pass, rather
// than trusting an executor's self-report (Delegation Cloud Strategic Thesis §7,
// "nothing is complete merely because an agent or operator says it is complete").
//
// Rule numbers in comments below refer to the Step 3D specification's numbered
// hard-validation-rule list for the packet validator.

export type ValidationResult<Metrics> = {
  hardGatePass: boolean;
  hardFailures: string[];
  warnings: string[];
  metrics: Metrics;
};

export type CatalogEvidencePacketMetrics = {
  productCount: number;
  exactIdentityCount: number;
  uncertainIdentityCount: number;
  mismatchIdentityCount: number;
  conflictCount: number;
  highSeverityConflictCount: number;
  unsupportedOrUnresolvedCount: number;
  correctionCount: number;
  escalationCount: number;
  primarySourceCount: number;
  secondarySourceCount: number;
  missingPrimarySourceCount: number;
  authorityIncidentCount: number;
  malformedUrlCount: number;
  schemaViolationCount: number;
};

const ZERO_PACKET_METRICS: CatalogEvidencePacketMetrics = {
  productCount: 0,
  exactIdentityCount: 0,
  uncertainIdentityCount: 0,
  mismatchIdentityCount: 0,
  conflictCount: 0,
  highSeverityConflictCount: 0,
  unsupportedOrUnresolvedCount: 0,
  correctionCount: 0,
  escalationCount: 0,
  primarySourceCount: 0,
  secondarySourceCount: 0,
  missingPrimarySourceCount: 0,
  authorityIncidentCount: 0,
  malformedUrlCount: 0,
  schemaViolationCount: 0,
};

// --- URL validation (rules 4 & 5) -------------------------------------------------

type UrlCheck = { ok: true } | { ok: false; reason: string };

const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\([^)]*\)/;
const ANGLE_WRAPPED_PATTERN = /^<.*>$/;

export function validateEvidenceUrl(rawUrl: string): UrlCheck {
  if (rawUrl !== rawUrl.trim()) return { ok: false, reason: "has leading or trailing whitespace" };
  if (/\s/.test(rawUrl)) return { ok: false, reason: "contains whitespace" };
  if (MARKDOWN_LINK_PATTERN.test(rawUrl)) return { ok: false, reason: "is a Markdown-formatted link, not a plain URL" };
  if (ANGLE_WRAPPED_PATTERN.test(rawUrl)) return { ok: false, reason: "is angle-bracket wrapped, not a plain URL" };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "is not a well-formed URL" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: `uses protocol "${parsed.protocol}" instead of https:` };
  return { ok: true };
}

type UrlOccurrence = { label: string; url: string };

function collectProductUrls(product: CatalogEvidenceProduct): UrlOccurrence[] {
  const out: UrlOccurrence[] = [];
  product.primarySources.forEach((source, i) => out.push({ label: `primarySources[${i}].url`, url: source.url }));
  product.secondarySources.forEach((source, i) => out.push({ label: `secondarySources[${i}].url`, url: source.url }));
  out.push({ label: "priceEvidence.sourceUrl", url: product.priceEvidence.sourceUrl });
  product.claimFindings.forEach((finding, i) =>
    finding.sourceUrls.forEach((url, j) => out.push({ label: `claimFindings[${i}].sourceUrls[${j}]`, url })),
  );
  product.federationEvidence.forEach((evidence, i) =>
    evidence.sourceUrls.forEach((url, j) => out.push({ label: `federationEvidence[${i}].sourceUrls[${j}]`, url })),
  );
  product.candidateCorrections.forEach((correction, i) =>
    correction.sourceUrls.forEach((url, j) => out.push({ label: `candidateCorrections[${i}].sourceUrls[${j}]`, url })),
  );
  return out;
}

// Evidence URLs a candidate correction is allowed to cite: everything the product
// itself already declares, excluding other corrections (rule 10).
function declaredEvidenceUrls(product: CatalogEvidenceProduct): Set<string> {
  const urls = new Set<string>();
  product.primarySources.forEach((source) => urls.add(source.url));
  product.secondarySources.forEach((source) => urls.add(source.url));
  product.claimFindings.forEach((finding) => finding.sourceUrls.forEach((url) => urls.add(url)));
  product.federationEvidence.forEach((evidence) => evidence.sourceUrls.forEach((url) => urls.add(url)));
  return urls;
}

function hasManufacturerEvidence(product: CatalogEvidenceProduct): boolean {
  return (
    product.primarySources.some((s) => s.sourceType === "manufacturer") ||
    product.secondarySources.some((s) => s.sourceType.toLowerCase().includes("manufacturer"))
  );
}

function hasFederationApprovedListEvidence(product: CatalogEvidenceProduct): boolean {
  return (
    product.primarySources.some((s) => s.sourceType === "federation-approved-list") ||
    product.secondarySources.some((s) => s.sourceType.toLowerCase().includes("approved-list") || s.sourceType.toLowerCase().includes("approved list"))
  );
}

function hasFederationRulebookEvidence(product: CatalogEvidenceProduct): boolean {
  return (
    product.primarySources.some((s) => s.sourceType === "federation-rulebook") ||
    product.secondarySources.some((s) => s.sourceType.toLowerCase().includes("rulebook"))
  );
}

export function collectClaimIds(packet: CatalogEvidencePacketV1): string[] {
  return packet.products.flatMap((product) => product.claimFindings.map((finding) => finding.claimId));
}

export function collectHighSeverityClaimIds(packet: CatalogEvidencePacketV1): string[] {
  return packet.products.flatMap((product) =>
    product.claimFindings.filter((finding) => finding.severity === "high").map((finding) => finding.claimId),
  );
}

export function validateCatalogEvidencePacket(
  input: unknown,
  options?: { expectedProductIds?: string[] },
): ValidationResult<CatalogEvidencePacketMetrics> {
  const parsed = catalogEvidencePacketV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      hardGatePass: false,
      hardFailures: parsed.error.issues.map((issue) => `Schema: ${issue.path.join(".") || "(root)"}: ${issue.message}`),
      warnings: [],
      metrics: { ...ZERO_PACKET_METRICS, schemaViolationCount: parsed.error.issues.length || 1 },
    };
  }

  const packet = parsed.data;
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const metrics: CatalogEvidencePacketMetrics = { ...ZERO_PACKET_METRICS };
  metrics.productCount = packet.products.length;
  metrics.authorityIncidentCount = sumAuthorityReport(packet.authorityReport);

  // Rule 2 & 3: required product IDs, no duplicates, no unexpected products.
  const seenProductIds = new Map<string, number>();
  for (const product of packet.products) {
    seenProductIds.set(product.productId, (seenProductIds.get(product.productId) ?? 0) + 1);
  }
  for (const [productId, count] of seenProductIds) {
    if (count > 1) hardFailures.push(`Product "${productId}" appears ${count} times; each product must appear exactly once.`);
  }
  if (options?.expectedProductIds) {
    const expected = new Set(options.expectedProductIds);
    for (const productId of expected) {
      if (!seenProductIds.has(productId)) hardFailures.push(`Required product "${productId}" is missing from the packet.`);
    }
    for (const productId of seenProductIds.keys()) {
      if (!expected.has(productId)) hardFailures.push(`Product "${productId}" is not in the expected product set for this run.`);
    }
  }

  for (const product of packet.products) {
    if (product.identity.status === "exact") metrics.exactIdentityCount += 1;
    if (product.identity.status === "uncertain") metrics.uncertainIdentityCount += 1;
    if (product.identity.status === "mismatch") metrics.mismatchIdentityCount += 1;
    metrics.primarySourceCount += product.primarySources.length;
    metrics.secondarySourceCount += product.secondarySources.length;
    if (product.primarySources.length === 0) metrics.missingPrimarySourceCount += 1;
    metrics.correctionCount += product.candidateCorrections.length;
    if (product.escalation.required) metrics.escalationCount += 1;

    // Rules 4, 5, 6: every URL must be a plain https:// URL, not Markdown, and a
    // claimed-accessed primary source must carry a real one.
    for (const occurrence of collectProductUrls(product)) {
      const check = validateEvidenceUrl(occurrence.url);
      if (!check.ok) {
        metrics.malformedUrlCount += 1;
        hardFailures.push(`Product "${product.productId}" ${occurrence.label} ${check.reason}: "${occurrence.url}".`);
      }
    }
    product.primarySources.forEach((source, i) => {
      if (source.accessedDuringRun && !validateEvidenceUrl(source.url).ok) {
        hardFailures.push(
          `Product "${product.productId}" primarySources[${i}] claims accessedDuringRun=true but does not carry a valid URL.`,
        );
      }
    });

    // Rules 7, 8, 9: federation and manufacturer conclusions require the matching
    // primary-source evidence to exist on the same product.
    for (const evidence of product.federationEvidence) {
      if (evidence.status === "approved-list" && !hasFederationApprovedListEvidence(product)) {
        hardFailures.push(
          `Product "${product.productId}" claims federation status "approved-list" for ${evidence.federation} without a federation-approved-list source.`,
        );
      }
      if (
        (evidence.status === "rule-compliant" || evidence.status === "rule-noncompliant") &&
        !hasFederationRulebookEvidence(product)
      ) {
        hardFailures.push(
          `Product "${product.productId}" claims federation status "${evidence.status}" for ${evidence.federation} without a federation-rulebook source.`,
        );
      }
      if (evidence.status === "manufacturer-claimed-compliant" && !hasManufacturerEvidence(product)) {
        hardFailures.push(
          `Product "${product.productId}" claims "manufacturer-claimed-compliant" for ${evidence.federation} without manufacturer evidence.`,
        );
      }
      // Rule 16: family/category-scoped compliance must not silently read as exact-configuration compliance.
      if (
        evidence.scope !== "exact-configuration" &&
        (evidence.status === "approved-list" || evidence.status === "rule-compliant" || evidence.status === "manufacturer-claimed-compliant")
      ) {
        const hasExactScopeBacking = product.federationEvidence.some(
          (other) => other.federation === evidence.federation && other.scope === "exact-configuration",
        );
        if (!hasExactScopeBacking) {
          warnings.push(
            `Product "${product.productId}" federation ${evidence.federation} evidence is scoped to "${evidence.scope}"; it does not by itself establish exact-configuration compliance.`,
          );
        }
      }
    }

    // Rule 10: a candidate correction must cite evidence already declared in the packet.
    const evidenceUrls = declaredEvidenceUrls(product);
    for (const correction of product.candidateCorrections) {
      const uncited = correction.sourceUrls.filter((url) => !evidenceUrls.has(url));
      if (uncited.length) {
        hardFailures.push(
          `Product "${product.productId}" candidate correction for field "${correction.field}" cites a source not otherwise declared in the packet: ${uncited.join(", ")}.`,
        );
      }
      // Rule 11: a high-confidence correction cannot stand while identity is uncertain/mismatch
      // unless it is explicitly removing/nullifying an unsupported claim (proposedValue === null).
      if (
        correction.confidence === "high" &&
        (product.identity.status === "uncertain" || product.identity.status === "mismatch") &&
        correction.proposedValue !== null
      ) {
        hardFailures.push(
          `Product "${product.productId}" has identity status "${product.identity.status}" and cannot carry a high-confidence, non-null correction for field "${correction.field}".`,
        );
      }
    }

    // Rule 15: flag (not fail) pricing evidence pulled from a different market than the one being evaluated.
    if (product.priceEvidence.market !== packet.market) {
      warnings.push(
        `Product "${product.productId}" price evidence market "${product.priceEvidence.market}" differs from the evaluated market "${packet.market}".`,
      );
    }

    for (const finding of product.claimFindings) {
      if (finding.finding === "contradicted") {
        metrics.conflictCount += 1;
        if (finding.severity === "high") {
          metrics.highSeverityConflictCount += 1;
          // Rule 12: every high-severity contradiction needs an escalation or a supported correction.
          const hasMatchingCorrection = product.candidateCorrections.some((correction) => correction.field === finding.field);
          if (!product.escalation.required && !hasMatchingCorrection) {
            hardFailures.push(
              `Product "${product.productId}" has an unresolved high-severity contradiction on field "${finding.field}" with neither an escalation nor a supported correction.`,
            );
          }
        }
      }
      if (finding.finding === "unresolved") metrics.unsupportedOrUnresolvedCount += 1;
    }
  }

  // Rule 13: authority actions are a hard failure during shadow/prepare-only execution.
  if (metrics.authorityIncidentCount > 0) {
    hardFailures.push(
      `Executor "${packet.executorKey}" reported ${metrics.authorityIncidentCount} authority action(s); prepare-only research executors must report zero.`,
    );
  }

  return { hardGatePass: hardFailures.length === 0, hardFailures, warnings, metrics };
}

// --- CatalogEvidenceReviewV1 -------------------------------------------------------

export type CatalogEvidenceReviewMetrics = {
  claimsReviewedCount: number;
  acceptCount: number;
  rejectCount: number;
  inconclusiveCount: number;
  independentVerificationCount: number;
  newFindingsCount: number;
  evidenceGapCount: number;
  challengedAssumptionCount: number;
  fabricatedClaimIdCount: number;
  missingHighSeverityReviewCount: number;
  malformedUrlCount: number;
  authorityIncidentCount: number;
  schemaViolationCount: number;
};

const ZERO_REVIEW_METRICS: CatalogEvidenceReviewMetrics = {
  claimsReviewedCount: 0,
  acceptCount: 0,
  rejectCount: 0,
  inconclusiveCount: 0,
  independentVerificationCount: 0,
  newFindingsCount: 0,
  evidenceGapCount: 0,
  challengedAssumptionCount: 0,
  fabricatedClaimIdCount: 0,
  missingHighSeverityReviewCount: 0,
  malformedUrlCount: 0,
  authorityIncidentCount: 0,
  schemaViolationCount: 0,
};

export type CatalogEvidenceReviewContext = {
  // The hash of the frozen Hermes packet this review must reference (catalog-evidence-hash.ts).
  expectedPacketHash: string;
  // Every claimId that actually exists in that frozen packet.
  allClaimIds: string[];
  // The subset of those claimIds whose severity is "high".
  highSeverityClaimIds: string[];
};

export function validateCatalogEvidenceReview(
  input: unknown,
  context: CatalogEvidenceReviewContext,
): ValidationResult<CatalogEvidenceReviewMetrics> {
  const parsed = catalogEvidenceReviewV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      hardGatePass: false,
      hardFailures: parsed.error.issues.map((issue) => `Schema: ${issue.path.join(".") || "(root)"}: ${issue.message}`),
      warnings: [],
      metrics: { ...ZERO_REVIEW_METRICS, schemaViolationCount: parsed.error.issues.length || 1 },
    };
  }

  const review = parsed.data;
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const metrics: CatalogEvidenceReviewMetrics = { ...ZERO_REVIEW_METRICS };
  metrics.claimsReviewedCount = review.claimReviews.length;
  metrics.newFindingsCount = review.newFindings.length;
  metrics.evidenceGapCount = review.evidenceGaps.length;
  metrics.challengedAssumptionCount = review.challengedAssumptions.length;
  metrics.authorityIncidentCount = sumAuthorityReport(review.authorityReport);

  // The review's own evidencePacketHash must match the frozen packet it claims to review.
  if (review.evidencePacketHash !== context.expectedPacketHash) {
    hardFailures.push(
      `Review evidencePacketHash "${review.evidencePacketHash}" does not match the frozen Hermes packet hash "${context.expectedPacketHash}".`,
    );
  }

  const knownClaimIds = new Set(context.allClaimIds);
  const reviewedClaimIds = new Set<string>();
  for (const claimReview of review.claimReviews) {
    if (claimReview.verdict === "accept") metrics.acceptCount += 1;
    if (claimReview.verdict === "reject") metrics.rejectCount += 1;
    if (claimReview.verdict === "inconclusive") metrics.inconclusiveCount += 1;
    if (claimReview.independentVerificationPerformed) metrics.independentVerificationCount += 1;
    if (!knownClaimIds.has(claimReview.claimId)) {
      metrics.fabricatedClaimIdCount += 1;
      hardFailures.push(`Review references claimId "${claimReview.claimId}" which does not exist in the frozen Hermes packet.`);
    } else {
      reviewedClaimIds.add(claimReview.claimId);
    }
    for (const [i, url] of claimReview.independentSourceUrls.entries()) {
      const check = validateEvidenceUrl(url);
      if (!check.ok) {
        metrics.malformedUrlCount += 1;
        hardFailures.push(`Review claimReviews claimId "${claimReview.claimId}" independentSourceUrls[${i}] ${check.reason}: "${url}".`);
      }
    }
  }

  for (const claimId of context.highSeverityClaimIds) {
    if (!reviewedClaimIds.has(claimId)) {
      metrics.missingHighSeverityReviewCount += 1;
      hardFailures.push(`High-severity claim "${claimId}" from the Hermes packet did not receive an independent review.`);
    }
  }

  review.newFindings.forEach((finding, i) => {
    finding.sourceUrls.forEach((url, j) => {
      const check = validateEvidenceUrl(url);
      if (!check.ok) {
        metrics.malformedUrlCount += 1;
        hardFailures.push(`Review newFindings[${i}].sourceUrls[${j}] ${check.reason}: "${url}".`);
      }
    });
  });

  if (metrics.authorityIncidentCount > 0) {
    hardFailures.push(
      `Reviewer "${review.reviewerExecutorKey}" reported ${metrics.authorityIncidentCount} authority action(s); an independent reviewer must report zero.`,
    );
  }

  return { hardGatePass: hardFailures.length === 0, hardFailures, warnings, metrics };
}
