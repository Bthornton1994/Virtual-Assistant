import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "@/lib/capability-registry";
import {
  CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
  type CapabilityPerformanceObservation,
} from "@/lib/capability-performance-ledger";
import { hashCatalogEvidencePacket, sha256Hex } from "@/lib/catalog-evidence-hash";
import type { CatalogEvidencePacketV1 } from "@/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "@/lib/catalog-evidence-review";
import {
  collectPacketClaims,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
} from "@/lib/catalog-evidence-validator";
import { summarizeWorkCellGate } from "@/lib/work-cell-policy";
import { classifyCatalogDecisions, type CatalogDecisionReport } from "@/lib/work-cell-operator";

const PHASE_CAPABILITY = {
  prepare: { capabilityKey: "evidence_research", contractVersion: "catalog-evidence-packet/v1" },
  review: { capabilityKey: "independent_evidence_review", contractVersion: "catalog-evidence-review/v1" },
  validate: { capabilityKey: "deterministic_catalog_validation", contractVersion: "catalog-evidence-validation/v1" },
} as const;

/**
 * Map a frozen work cell to CS-4 observations. Does not persist, promote, or
 * let an executor write its own score. Benchmark truth stays null unless supplied.
 */
export function workCellLedgerObservations(input: {
  packet: CatalogEvidencePacketV1;
  review: CatalogEvidenceReviewV1;
  expectedProductIds: string[];
  recordedAt: string;
  humanMinutesByPhase?: Partial<Record<"prepare" | "review" | "validate", number>>;
  aiCostMicrosByPhase?: Partial<Record<"prepare" | "review" | "validate", number>>;
  toolCostMicrosByPhase?: Partial<Record<"prepare" | "review" | "validate", number>>;
  latencyMsByPhase?: Partial<Record<"prepare" | "review" | "validate", number>>;
  catalogReport?: CatalogDecisionReport;
}): CapabilityPerformanceObservation[] {
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
  const report = input.catalogReport ?? classifyCatalogDecisions({ packet: input.packet, review: input.review });
  const hardGateResult = gate.hardGatePass ? "pass" : "fail";
  const status = gate.workCellVerdict === "passed" ? "completed" : gate.workCellVerdict === "failed" ? "failed" : "inconclusive";
  const reviewHash = sha256Hex(input.review);
  const validationHash = sha256Hex({ packetHash, reviewHash, gate });

  const phases: Array<{
    phase: "prepare" | "review" | "validate";
    assignmentId: string;
    executorKey: string;
    sourceArtifactHash: string;
  }> = [
    {
      phase: "prepare",
      assignmentId: `${input.packet.runId}:prepare`,
      executorKey: input.packet.executorKey,
      sourceArtifactHash: packetHash,
    },
    {
      phase: "review",
      assignmentId: `${input.packet.runId}:review`,
      executorKey: input.review.reviewerExecutorKey,
      sourceArtifactHash: reviewHash,
    },
    {
      phase: "validate",
      assignmentId: `${input.packet.runId}:validate`,
      executorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.validate,
      sourceArtifactHash: validationHash,
    },
  ];

  return phases.map((item) => ({
    schemaVersion: CAPABILITY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
    runId: input.packet.runId,
    assignmentId: item.assignmentId,
    capabilityKey: PHASE_CAPABILITY[item.phase].capabilityKey,
    executorKey: item.executorKey,
    contractVersion: PHASE_CAPABILITY[item.phase].contractVersion,
    status,
    hardGateResult,
    benchmarkTruth: null,
    authorityIncident: gate.authorityIncidents.length > 0,
    evidenceComplete: packetResult.hardGatePass && reviewResult.hardGatePass,
    correctionRequired: report.decisions.length > 0,
    rollbackOrRetry: report.hermesRetryUseful,
    humanInterventionMinutes: input.humanMinutesByPhase?.[item.phase] ?? 0,
    aiCostMicros: input.aiCostMicrosByPhase?.[item.phase] ?? 0,
    toolCostMicros: input.toolCostMicrosByPhase?.[item.phase] ?? 0,
    latencyMs: input.latencyMsByPhase?.[item.phase] ?? 0,
    outcomeSource: "deterministic_validator",
    sourceArtifactHash: item.sourceArtifactHash,
    recordedAt: input.recordedAt,
  }));
}
