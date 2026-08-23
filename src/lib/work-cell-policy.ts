import type { CatalogEvidencePacketMetrics, CatalogEvidenceReviewMetrics, ValidationResult } from "@/lib/catalog-evidence-validator";

// Pure decision logic for the Step 3D work cell: given the deterministic
// validation results for the frozen packet and (optionally) the frozen
// independent review, what does the Gauntlet hard gate say?
//
// The single rule this file exists to enforce: a reviewing agent's own verdict
// never sets hard_gate_pass. Delegation Cloud's deterministic validator does.
// An agent that says "accept" over evidence the validator rejects still yields a
// failing gate, so agent confidence alone can never produce a passing Outcome
// Receipt.

export type GauntletVerdict = "passed" | "failed" | "inconclusive";

export type WorkCellGate = {
  hardGatePass: boolean;
  deterministicVerdict: GauntletVerdict;
  agentVerdict: GauntletVerdict;
  reasons: string[];
  authorityIncidents: Array<{ source: "packet" | "review"; count: number; detail: string }>;
};

export function summarizeWorkCellGate(
  packet: ValidationResult<CatalogEvidencePacketMetrics>,
  review: ValidationResult<CatalogEvidenceReviewMetrics> | null,
): WorkCellGate {
  const reasons: string[] = [];
  const authorityIncidents: WorkCellGate["authorityIncidents"] = [];

  if (packet.metrics.authorityIncidentCount > 0) {
    authorityIncidents.push({
      source: "packet",
      count: packet.metrics.authorityIncidentCount,
      detail: "The research executor reported actions outside its prepare-only authority envelope.",
    });
  }
  if (review && review.metrics.authorityIncidentCount > 0) {
    authorityIncidents.push({
      source: "review",
      count: review.metrics.authorityIncidentCount,
      detail: "The independent reviewer reported actions outside its prepare-only authority envelope.",
    });
  }

  if (!packet.hardGatePass) reasons.push("Deterministic validation rejected the evidence packet.");
  if (review && !review.hardGatePass) reasons.push("Deterministic validation rejected the independent review.");
  if (!review) reasons.push("No independent review has been ingested for this run.");
  if (authorityIncidents.length) reasons.push("One or more executors reported an authority action.");

  // One gate value governs every Gauntlet review row this work cell produces.
  // Both rows must agree, because the receipt guard passes a run as soon as any
  // single independent review passes with a clean hard gate: letting the
  // deterministic row pass while the reviewer committed an authority action
  // would open exactly the hole that guard exists to close.
  const hardGatePass = packet.hardGatePass && Boolean(review?.hardGatePass) && authorityIncidents.length === 0;

  // "failed" means something was actually disproven; "inconclusive" means the
  // evidence does not yet support a verdict. A missing review is the latter.
  const deterministicVerdict: GauntletVerdict = hardGatePass
    ? "passed"
    : packet.hardGatePass && (review === null || review.hardGatePass) && authorityIncidents.length === 0
      ? "inconclusive"
      : "failed";

  // What the Gauntlet records the reviewer as having concluded. It can never read
  // "passed" while the deterministic gate is red.
  let agentVerdict: GauntletVerdict;
  if (!review) {
    agentVerdict = "inconclusive";
  } else if (review.metrics.rejectCount > 0) {
    agentVerdict = "failed";
  } else if (!hardGatePass || review.metrics.inconclusiveCount > 0) {
    agentVerdict = "inconclusive";
  } else {
    agentVerdict = "passed";
  }

  if (hardGatePass && !reasons.length) {
    reasons.push("Deterministic validation accepted both the frozen packet and the independent review.");
  }

  return { hardGatePass, deterministicVerdict, agentVerdict, reasons, authorityIncidents };
}
