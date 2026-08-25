import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import type { CatalogEvidencePacketV1 } from "@/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";
import {
  collectPacketClaims,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
} from "@/lib/catalog-evidence-validator";
import { summarizeWorkCellBenchmark, summarizeWorkCellGate } from "@/lib/work-cell-policy";

export type CatalogProductRecord = { id: string } & Record<string, unknown>;

export function buildFrozenInputRecords(
  products: CatalogProductRecord[],
  productIds: string[],
): { records: Record<string, CatalogProductRecord>; missing: string[] } {
  const byId = new Map(products.map((product) => [product.id, product]));
  const records: Record<string, CatalogProductRecord> = {};
  const missing: string[] = [];
  for (const id of productIds) {
    const product = byId.get(id);
    if (!product) {
      missing.push(id);
      continue;
    }
    records[id] = product;
  }
  return { records, missing };
}

export type CatalogDecisionKind =
  | "identity-mismatch"
  | "identity-uncertain"
  | "price-disagreement"
  | "claim-contradicted"
  | "proposed-correction"
  | "escalation";

export type CatalogDecisionAction =
  | "human-catalog-decision"
  | "human-price-decision"
  | "hold-escalation"
  | "none";

export type CatalogDecision = {
  productId: string;
  kind: CatalogDecisionKind;
  action: CatalogDecisionAction;
  summary: string;
  hermesRetryUseful: boolean;
  loadoutWrite: false;
};

export type CatalogDecisionReport = {
  decisions: CatalogDecision[];
  hermesRetryUseful: boolean;
  loadoutWrite: false;
  summary: string;
};

function catalogNumber(record: CatalogProductRecord | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Turn a finished packet (and optional review) into catalog-side decisions.
 * Identity mismatch on a frozen SKU is not a Hermes retry; the batch cannot
 * pass by re-researching the same IDs.
 */
export function classifyCatalogDecisions(input: {
  packet: CatalogEvidencePacketV1;
  frozenRecords?: Record<string, CatalogProductRecord>;
  review?: CatalogEvidenceReviewV1;
}): CatalogDecisionReport {
  const decisions: CatalogDecision[] = [];
  const rejected = new Set(
    (input.review?.claimReviews ?? []).filter((item) => item.verdict === "reject").map((item) => item.claimId),
  );

  for (const product of input.packet.products) {
    const frozen = input.frozenRecords?.[product.productId];
    if (product.identity.status === "mismatch") {
      decisions.push({
        productId: product.productId,
        kind: "identity-mismatch",
        action: "human-catalog-decision",
        summary: `${product.productId}: identity mismatch. ${product.identity.reason} Same frozen SKU will not pass by retrying Hermes.`,
        hermesRetryUseful: false,
        loadoutWrite: false,
      });
    } else if (product.identity.status === "uncertain") {
      decisions.push({
        productId: product.productId,
        kind: "identity-uncertain",
        action: "human-catalog-decision",
        summary: `${product.productId}: identity uncertain. ${product.identity.reason}`,
        hermesRetryUseful: false,
        loadoutWrite: false,
      });
    }

    const catalogPrice = catalogNumber(frozen, "price");
    const displayed = product.priceEvidence.currentDisplayedPrice;
    if (
      catalogPrice !== undefined &&
      displayed !== null &&
      displayed !== catalogPrice
    ) {
      decisions.push({
        productId: product.productId,
        kind: "price-disagreement",
        action: "human-price-decision",
        summary: `${product.productId}: catalog price ${catalogPrice} vs evidence ${displayed} (${product.priceEvidence.priceType}).`,
        hermesRetryUseful: false,
        loadoutWrite: false,
      });
    } else if (product.priceEvidence.priceType === "sale") {
      decisions.push({
        productId: product.productId,
        kind: "price-disagreement",
        action: "human-price-decision",
        summary: `${product.productId}: evidence price is promotional/sale; catalog must not absorb a sale as list.`,
        hermesRetryUseful: false,
        loadoutWrite: false,
      });
    }

    for (const claim of product.claimFindings) {
      if (claim.finding !== "contradicted" && !rejected.has(claim.claimId)) continue;
      decisions.push({
        productId: product.productId,
        kind: "claim-contradicted",
        action: "human-catalog-decision",
        summary: `${claim.claimId}: ${claim.field} catalog=${JSON.stringify(claim.catalogValue)} evidence=${JSON.stringify(claim.evidenceSupportedValue)}.`,
        hermesRetryUseful: false,
        loadoutWrite: false,
      });
    }

    for (const correction of product.candidateCorrections) {
      decisions.push({
        productId: product.productId,
        kind: "proposed-correction",
        action: "human-catalog-decision",
        summary: `${product.productId}: ${correction.correctionKind} ${correction.field} → ${JSON.stringify(correction.proposedValue)} (${correction.confidence}).`,
        hermesRetryUseful: false,
        loadoutWrite: false,
      });
    }

    if (product.escalation.required) {
      decisions.push({
        productId: product.productId,
        kind: "escalation",
        action: "hold-escalation",
        summary: `${product.productId}: Hermes escalation. ${product.escalation.reason}`,
        hermesRetryUseful: product.identity.status === "exact",
        loadoutWrite: false,
      });
    }
  }

  const identityBlocks = decisions.some((item) => item.kind === "identity-mismatch");
  const hermesRetryUseful = !identityBlocks && decisions.some((item) => item.hermesRetryUseful);
  return {
    decisions,
    hermesRetryUseful,
    loadoutWrite: false,
    summary: identityBlocks
      ? "At least one frozen SKU is an identity mismatch. Do not retry Hermes on this batch. A human must change the frozen IDs or the catalog identity. No Loadout write."
      : hermesRetryUseful
        ? "No identity mismatch. Escalations on exact-identity products may justify another prepare — still no catalog write."
        : decisions.length
          ? "Decisions are catalog-side or price-side. Hermes retry is not useful. No Loadout write."
          : "No catalog decisions from this packet.",
  };
}

export type WorkCellReceiptDraft = {
  verificationStatus: "passed" | "failed";
  definitionOfDoneMet: boolean;
  summary: string;
  verificationNotes: string;
  actionsTaken: string[];
  exceptions: string[];
  unresolvedDecisions: string[];
  packetHash: string;
  hardGatePass: boolean;
};

export function draftWorkCellReceipt(input: {
  packet: CatalogEvidencePacketV1;
  review: CatalogEvidenceReviewV1;
  expectedProductIds: string[];
}): WorkCellReceiptDraft {
  const packetResult = validateCatalogEvidencePacket(input.packet, {
    expectedProductIds: input.expectedProductIds,
    expectedRunId: input.packet.runId,
    expectedExecutorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    expectedMarket: input.packet.market,
  });
  const packetHash = hashCatalogEvidencePacket(input.packet);
  const reviewResult = validateCatalogEvidenceReview(input.review, {
    expectedPacketHash: packetHash,
    claims: collectPacketClaims(input.packet),
    packetProductIds: input.packet.products.map((product) => product.productId),
    expectedRunId: input.packet.runId,
    expectedReviewerKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
  });
  const gate = summarizeWorkCellGate(packetResult, reviewResult);
  const benchmark = summarizeWorkCellBenchmark(packetResult, reviewResult);
  const escalations = input.packet.products.filter((product) => product.escalation.required).map((product) => product.productId);
  const mismatches = input.packet.products.filter((product) => product.identity.status === "mismatch").map((product) => product.productId);

  return {
    verificationStatus: gate.hardGatePass ? "passed" : "failed",
    definitionOfDoneMet: gate.hardGatePass,
    packetHash,
    hardGatePass: gate.hardGatePass,
    summary: [
      `Work cell ${input.packet.runId} completed prepare → hash-bound review → deterministic validation on ${input.packet.products.length} frozen product(s).`,
      `Packet sha256:${packetHash}.`,
      `Reviewer ${benchmark.claimsReviewed} claims, ${benchmark.rejectedClaims} reject, ${benchmark.independentVerifications} independent.`,
      gate.hardGatePass ? "Hard gate pass." : `Hard gate fail. ${gate.reasons[0] ?? ""}`.trim(),
      "No catalog write.",
    ].join(" "),
    verificationNotes: [
      ...gate.reasons,
      packetResult.warnings.join(" "),
      mismatches.length ? `Identity mismatch: ${mismatches.join(", ")}.` : "",
      escalations.length ? `Hermes escalations: ${escalations.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    actionsTaken: [
      `Froze input records for ${input.expectedProductIds.join(", ")}`,
      `Ingested ${input.packet.executorKey} packet`,
      `Ingested ${input.review.reviewerExecutorKey} review bound to ${packetHash}`,
      "Ran catalog-evidence-validator-v1",
    ],
    exceptions: gate.reviewerBlockers,
    unresolvedDecisions: [
      ...mismatches.map((id) => `${id}: identity mismatch; no replacement SKU from this packet`),
      ...escalations.filter((id) => !mismatches.includes(id)).map((id) => `${id}: Hermes required escalation`),
    ],
  };
}
