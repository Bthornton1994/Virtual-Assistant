import {
  catalogEvidencePacketV1Schema,
  type CatalogEvidencePacketV1,
  type CatalogEvidenceProduct,
  type PrimarySource,
} from "@/lib/catalog-evidence-packet";
import { catalogEvidenceReviewV1Schema } from "@/lib/catalog-evidence-review";
import { sumAuthorityReport, type SeverityLevel } from "@/lib/catalog-evidence-shared";

// Deterministic gates for CatalogEvidencePacketV1 and CatalogEvidenceReviewV1.
//
// Hard invariant for this whole module: given the same input, it always returns
// the same result. No network access, no LLM call, no clock, no randomness. That
// is what makes it trustworthy as the machine that decides hard_gate_pass, rather
// than trusting an executor's self-report (Delegation Cloud Strategic Thesis §7,
// "nothing is complete merely because an agent or operator says it is complete").
//
// Note the separation this file maintains throughout: these functions answer
// "is this artifact well-formed, internally consistent, and inside its authority
// envelope?" They do NOT answer "should this attempt receive a passing receipt?"
// A reviewer that correctly rejects a claim produces a structurally VALID review.
// Turning reviewer conclusions into a verification decision is work-cell-policy.ts.

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

// --- URL validation ----------------------------------------------------------------

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

export function isValidEvidenceUrl(rawUrl: string | null | undefined): boolean {
  return typeof rawUrl === "string" && validateEvidenceUrl(rawUrl).ok;
}

type UrlOccurrence = { label: string; url: string };

function collectProductUrls(product: CatalogEvidenceProduct): UrlOccurrence[] {
  const out: UrlOccurrence[] = [];
  product.primarySources.forEach((source, i) => out.push({ label: `primarySources[${i}].url`, url: source.url }));
  product.secondarySources.forEach((source, i) => out.push({ label: `secondarySources[${i}].url`, url: source.url }));
  // A null price source URL is legitimate when the price is unavailable; the
  // conditional price rules below decide whether null is allowed here.
  if (product.priceEvidence.sourceUrl !== null) {
    out.push({ label: "priceEvidence.sourceUrl", url: product.priceEvidence.sourceUrl });
  }
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

// Evidence URLs a candidate correction may cite: everything the product itself
// already declares, excluding other corrections.
function declaredEvidenceUrls(product: CatalogEvidenceProduct): Set<string> {
  const urls = new Set<string>();
  product.primarySources.forEach((source) => urls.add(source.url));
  product.secondarySources.forEach((source) => urls.add(source.url));
  product.claimFindings.forEach((finding) => finding.sourceUrls.forEach((url) => urls.add(url)));
  product.federationEvidence.forEach((evidence) => evidence.sourceUrls.forEach((url) => urls.add(url)));
  return urls;
}

// Which primary-source type can carry which federation conclusion. A status not
// listed here (unknown, not-applicable) asserts nothing and needs no backing.
const FEDERATION_STATUS_REQUIRED_SOURCE: Record<string, PrimarySource["sourceType"] | undefined> = {
  "approved-list": "federation-approved-list",
  "rule-compliant": "federation-rulebook",
  "rule-noncompliant": "federation-rulebook",
  "manufacturer-claimed-compliant": "manufacturer",
};

const FEDERATION_SCOPED_SOURCE_TYPES: ReadonlyArray<PrimarySource["sourceType"]> = [
  "federation-rulebook",
  "federation-approved-list",
];

export type PacketClaimDescriptor = { claimId: string; productId: string; field: string; severity: SeverityLevel };

export function collectPacketClaims(packet: CatalogEvidencePacketV1): PacketClaimDescriptor[] {
  return packet.products.flatMap((product) =>
    product.claimFindings.map((finding) => ({
      claimId: finding.claimId,
      productId: product.productId,
      field: finding.field,
      severity: finding.severity,
    })),
  );
}

export function collectClaimIds(packet: CatalogEvidencePacketV1): string[] {
  return collectPacketClaims(packet).map((claim) => claim.claimId);
}

export function collectHighSeverityClaimIds(packet: CatalogEvidencePacketV1): string[] {
  return collectPacketClaims(packet)
    .filter((claim) => claim.severity === "high")
    .map((claim) => claim.claimId);
}

export type PacketValidationOptions = {
  expectedProductIds?: string[];
  expectedRunId?: string;
  expectedExecutorKey?: string;
  expectedMarket?: string;
};

export function validateCatalogEvidencePacket(
  input: unknown,
  options?: PacketValidationOptions,
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

  // Provenance: the artifact must name the run and executor it actually came from.
  if (options?.expectedRunId && packet.runId !== options.expectedRunId) {
    hardFailures.push(`Packet declares runId "${packet.runId}" but was ingested for run "${options.expectedRunId}".`);
  }
  if (options?.expectedExecutorKey && packet.executorKey !== options.expectedExecutorKey) {
    hardFailures.push(
      `Packet declares executorKey "${packet.executorKey}" but the prepare phase is assigned to "${options.expectedExecutorKey}".`,
    );
  }
  if (options?.expectedMarket && packet.market !== options.expectedMarket) {
    hardFailures.push(`Packet declares market "${packet.market}" but the frozen input manifest specifies "${options.expectedMarket}".`);
  }

  // Product coverage: exactly once each, and nothing outside the frozen batch.
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

  // Claim IDs must be globally unique across the packet, not merely per product:
  // the review contract addresses claims by bare claimId, so a collision would
  // make a review ambiguous about which claim it actually examined.
  const claimIdCounts = new Map<string, number>();
  for (const claim of collectPacketClaims(packet)) {
    claimIdCounts.set(claim.claimId, (claimIdCounts.get(claim.claimId) ?? 0) + 1);
  }
  for (const [claimId, count] of claimIdCounts) {
    if (count > 1) {
      hardFailures.push(`Claim ID "${claimId}" appears ${count} times across the packet; claim IDs must be globally unique.`);
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
      if (FEDERATION_SCOPED_SOURCE_TYPES.includes(source.sourceType) && !source.federation?.trim()) {
        hardFailures.push(
          `Product "${product.productId}" primarySources[${i}] is a ${source.sourceType} source but does not declare which federation it belongs to.`,
        );
      }
    });

    validateFederationEvidence(product, hardFailures, warnings);
    validatePriceEvidence(product, packet.market, hardFailures, warnings);

    // A candidate correction must cite evidence already declared in the packet.
    const evidenceUrls = declaredEvidenceUrls(product);
    for (const correction of product.candidateCorrections) {
      const uncited = correction.sourceUrls.filter((url) => !evidenceUrls.has(url));
      if (uncited.length) {
        hardFailures.push(
          `Product "${product.productId}" candidate correction for field "${correction.field}" cites a source not otherwise declared in the packet: ${uncited.join(", ")}.`,
        );
      }
      // A high-confidence correction cannot stand while identity is unresolved,
      // unless it is explicitly removing an unsupported claim.
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

    for (const finding of product.claimFindings) {
      if (finding.finding === "contradicted") {
        metrics.conflictCount += 1;
        if (finding.severity === "high") {
          metrics.highSeverityConflictCount += 1;
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

  if (metrics.authorityIncidentCount > 0) {
    hardFailures.push(
      `Executor "${packet.executorKey}" reported ${metrics.authorityIncidentCount} authority action(s); prepare-only research executors must report zero.`,
    );
  }

  return { hardGatePass: hardFailures.length === 0, hardFailures, warnings, metrics };
}

/**
 * Federation conclusions must be carried by primary evidence that was actually
 * accessed, is of the right document type, AND belongs to the federation being
 * concluded about.
 *
 * The last condition is the one that matters most: letting an IPF rulebook carry
 * a USAPL conclusion is the exact class of semantic failure seen in Hermes runs
 * 1-3. Cross-federation recognition is not inferred here — if USAPL adopts the
 * IPF list, that must be its own federationEvidence entry citing a USAPL source
 * that says so.
 */
function validateFederationEvidence(product: CatalogEvidenceProduct, hardFailures: string[], warnings: string[]) {
  const primaryByUrl = new Map<string, PrimarySource>();
  for (const source of product.primarySources) primaryByUrl.set(source.url, source);
  const secondaryUrls = new Set(product.secondarySources.map((source) => source.url));

  for (const evidence of product.federationEvidence) {
    const requiredType = FEDERATION_STATUS_REQUIRED_SOURCE[evidence.status];
    if (!requiredType) continue;

    if (!evidence.sourceUrls.length) {
      hardFailures.push(
        `Product "${product.productId}" claims ${evidence.federation} status "${evidence.status}" without citing any source.`,
      );
      continue;
    }

    // Every cited URL must resolve to a declared primary source on this product.
    // A secondary source can never carry a federation conclusion.
    for (const url of evidence.sourceUrls) {
      if (primaryByUrl.has(url)) continue;
      if (secondaryUrls.has(url)) {
        hardFailures.push(
          `Product "${product.productId}" cites secondary source "${url}" for ${evidence.federation} status "${evidence.status}"; federation conclusions require primary evidence.`,
        );
      } else {
        hardFailures.push(
          `Product "${product.productId}" cites "${url}" for ${evidence.federation} status "${evidence.status}" but that URL is not a declared primary source on this product.`,
        );
      }
    }

    const cited = evidence.sourceUrls.map((url) => primaryByUrl.get(url)).filter((s): s is PrimarySource => Boolean(s));
    const rightType = cited.filter((source) => source.sourceType === requiredType);
    if (!rightType.length) {
      hardFailures.push(
        `Product "${product.productId}" claims ${evidence.federation} status "${evidence.status}" without citing a ${requiredType} primary source.`,
      );
      continue;
    }

    const accessed = rightType.filter((source) => source.accessedDuringRun);
    if (!accessed.length) {
      hardFailures.push(
        `Product "${product.productId}" claims ${evidence.federation} status "${evidence.status}" citing ${requiredType} evidence that was not accessed during the run.`,
      );
      continue;
    }

    // Manufacturer evidence is not federation-scoped; federation documents are.
    if (FEDERATION_SCOPED_SOURCE_TYPES.includes(requiredType)) {
      const attributable = accessed.filter(
        (source) => (source.federation ?? "").trim().toLowerCase() === evidence.federation.trim().toLowerCase(),
      );
      if (!attributable.length) {
        const offered = accessed.map((s) => s.federation || "unattributed").join(", ");
        hardFailures.push(
          `Product "${product.productId}" claims ${evidence.federation} status "${evidence.status}" using ${requiredType} evidence belonging to ${offered}. Evidence from one federation cannot establish another federation's conclusion; cite a ${evidence.federation} source, or record the recognition relationship as its own ${evidence.federation} evidence entry.`,
        );
      }
    }

    // Family- or category-scoped approval is real but narrower than it looks.
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
}

function validatePriceEvidence(
  product: CatalogEvidenceProduct,
  packetMarket: string,
  hardFailures: string[],
  warnings: string[],
) {
  const price = product.priceEvidence;
  if (price.priceType === "unavailable") {
    // An honestly unresolved price needs no source and no figure. Nothing to check
    // beyond the URL validity already applied if a URL was supplied anyway.
    return;
  }

  if (price.sourceUrl === null) {
    hardFailures.push(
      `Product "${product.productId}" price evidence has priceType "${price.priceType}" but no source URL. Use priceType "unavailable" when no price could be resolved.`,
    );
  }
  if (price.currentDisplayedPrice === null) {
    hardFailures.push(
      `Product "${product.productId}" price evidence has priceType "${price.priceType}" but no displayed price. Use priceType "unavailable" when no price could be resolved.`,
    );
  }
  if (price.variantScope === null || !price.variantScope.trim()) {
    hardFailures.push(
      `Product "${product.productId}" price evidence has priceType "${price.priceType}" but no variant scope, so it is not clear what the price applies to.`,
    );
  }
  if (price.priceType === "sale") {
    if (price.regularOrCompareAtPrice === null) {
      hardFailures.push(`Product "${product.productId}" reports a sale price without the regular or compare-at price it is discounted from.`);
    } else if (price.currentDisplayedPrice !== null && price.regularOrCompareAtPrice < price.currentDisplayedPrice) {
      hardFailures.push(
        `Product "${product.productId}" reports a sale price of ${price.currentDisplayedPrice} above its regular price of ${price.regularOrCompareAtPrice}.`,
      );
    }
  }

  if (price.market !== packetMarket) {
    warnings.push(
      `Product "${product.productId}" price evidence market "${price.market}" differs from the evaluated market "${packetMarket}".`,
    );
  }
}

// --- CatalogEvidenceReviewV1 -------------------------------------------------------

export type CatalogEvidenceReviewMetrics = {
  claimsReviewedCount: number;
  acceptCount: number;
  rejectCount: number;
  inconclusiveCount: number;
  independentVerificationCount: number;
  newFindingsCount: number;
  highSeverityNewFindingCount: number;
  escalationRequiredCount: number;
  evidenceGapCount: number;
  challengedAssumptionCount: number;
  fabricatedClaimIdCount: number;
  duplicateClaimReviewCount: number;
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
  highSeverityNewFindingCount: 0,
  escalationRequiredCount: 0,
  evidenceGapCount: 0,
  challengedAssumptionCount: 0,
  fabricatedClaimIdCount: 0,
  duplicateClaimReviewCount: 0,
  missingHighSeverityReviewCount: 0,
  malformedUrlCount: 0,
  authorityIncidentCount: 0,
  schemaViolationCount: 0,
};

export type CatalogEvidenceReviewContext = {
  // The hash of the frozen Hermes packet this review must reference.
  expectedPacketHash: string;
  // Every claim in that frozen packet, with the severity Hermes assigned it.
  claims: PacketClaimDescriptor[];
  expectedRunId?: string;
  expectedReviewerKey?: string;
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
  metrics.highSeverityNewFindingCount = review.newFindings.filter((finding) => finding.severity === "high").length;
  metrics.escalationRequiredCount = review.escalationRequired ? 1 : 0;
  metrics.evidenceGapCount = review.evidenceGaps.length;
  metrics.challengedAssumptionCount = review.challengedAssumptions.length;
  metrics.authorityIncidentCount = sumAuthorityReport(review.authorityReport);

  if (review.evidencePacketHash !== context.expectedPacketHash) {
    hardFailures.push(
      `Review evidencePacketHash "${review.evidencePacketHash}" does not match the frozen Hermes packet hash "${context.expectedPacketHash}".`,
    );
  }
  if (context.expectedRunId && review.runId !== context.expectedRunId) {
    hardFailures.push(`Review declares runId "${review.runId}" but was ingested for run "${context.expectedRunId}".`);
  }
  if (context.expectedReviewerKey && review.reviewerExecutorKey !== context.expectedReviewerKey) {
    hardFailures.push(
      `Review declares reviewerExecutorKey "${review.reviewerExecutorKey}" but the review phase is assigned to "${context.expectedReviewerKey}".`,
    );
  }
  if (review.escalationRequired && !review.escalationReason.trim()) {
    hardFailures.push("Review sets escalationRequired but records no escalation reason.");
  }

  const claimsById = new Map(context.claims.map((claim) => [claim.claimId, claim] as const));
  const reviewCounts = new Map<string, number>();

  for (const claimReview of review.claimReviews) {
    if (claimReview.verdict === "accept") metrics.acceptCount += 1;
    if (claimReview.verdict === "reject") metrics.rejectCount += 1;
    if (claimReview.verdict === "inconclusive") metrics.inconclusiveCount += 1;
    if (claimReview.independentVerificationPerformed) metrics.independentVerificationCount += 1;

    reviewCounts.set(claimReview.claimId, (reviewCounts.get(claimReview.claimId) ?? 0) + 1);

    const claim = claimsById.get(claimReview.claimId);
    if (!claim) {
      metrics.fabricatedClaimIdCount += 1;
      hardFailures.push(`Review references claimId "${claimReview.claimId}" which does not exist in the frozen Hermes packet.`);
    }

    const validSources: string[] = [];
    for (const [i, url] of claimReview.independentSourceUrls.entries()) {
      const check = validateEvidenceUrl(url);
      if (check.ok) {
        validSources.push(url);
      } else {
        metrics.malformedUrlCount += 1;
        hardFailures.push(`Review claimReviews claimId "${claimReview.claimId}" independentSourceUrls[${i}] ${check.reason}: "${url}".`);
      }
    }

    // A definite verdict has to rest on something the reviewer actually looked at.
    if ((claimReview.verdict === "accept" || claimReview.verdict === "reject") && validSources.length === 0) {
      hardFailures.push(
        `Review returns verdict "${claimReview.verdict}" for claim "${claimReview.claimId}" without citing a single valid independent source.`,
      );
    }
    // An inconclusive verdict may legitimately have no source, but only when the
    // reviewer says why. It still blocks verification (see work-cell-policy).
    if (claimReview.verdict === "inconclusive" && validSources.length === 0) {
      const gapRecorded = review.evidenceGaps.some((gap) => gap.includes(claimReview.claimId));
      if (!gapRecorded) {
        hardFailures.push(
          `Review returns "inconclusive" for claim "${claimReview.claimId}" with no independent source and no matching entry in evidenceGaps naming that claim.`,
        );
      }
    }
  }

  for (const [claimId, count] of reviewCounts) {
    if (count > 1) {
      metrics.duplicateClaimReviewCount += 1;
      hardFailures.push(`Review contains ${count} reviews for claim "${claimId}"; each claim must be reviewed exactly once.`);
    }
  }

  // Every high-severity Hermes claim must receive exactly one genuinely
  // independent review. Merely naming the claim is not enough.
  for (const claim of context.claims) {
    if (claim.severity !== "high") continue;
    const matching = review.claimReviews.filter((claimReview) => claimReview.claimId === claim.claimId);
    if (matching.length === 0) {
      metrics.missingHighSeverityReviewCount += 1;
      hardFailures.push(`High-severity claim "${claim.claimId}" from the Hermes packet did not receive an independent review.`);
      continue;
    }
    for (const claimReview of matching) {
      if (!claimReview.independentVerificationPerformed) {
        hardFailures.push(
          `High-severity claim "${claim.claimId}" was reviewed without independent verification; a restatement of the Hermes finding is not a review.`,
        );
      }
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
