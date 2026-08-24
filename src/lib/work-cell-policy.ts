import type { CatalogEvidencePacketMetrics, CatalogEvidenceReviewMetrics, ValidationResult } from "@/lib/catalog-evidence-validator";

// Verification decision logic for the Step 3D work cell.
//
// This file answers one question the validators deliberately do not: given the
// deterministic validation of the frozen packet and the frozen independent
// review, is this attempt eligible for a passing Outcome Receipt?
//
// Two things are kept strictly apart:
//
//   1. BENCHMARK QUALITY — "did the reviewer do good work?" A reviewer that
//      catches a real Hermes defect is performing well, and that is worth
//      measuring. See summarizeWorkCellBenchmark.
//
//   2. EXECUTION VERIFICATION — "is this attempt ready to be called done?" A
//      caught defect means the answer is NO. The attempt goes to corrective
//      action; it does not get a passing receipt because the reviewer was good
//      at its job.
//
// The Gauntlet receipt guard passes a run as soon as ANY independent review row
// has verdict='passed' AND hard_gate_pass AND no authority incidents. So the
// work cell writes exactly ONE authoritative review row, whose verdict already
// incorporates the complete reviewer semantics. There is deliberately no second
// row that could satisfy the guard on its own while this one rejects.

export type GauntletVerdict = "passed" | "failed" | "inconclusive";

export type WorkCellGate = {
  hardGatePass: boolean;
  /** Verdict for the single authoritative Gauntlet review row this cell writes. */
  workCellVerdict: GauntletVerdict;
  /** Why verification is blocked, or why it is clear. */
  reasons: string[];
  /** Blocking conditions traceable to the reviewer's own conclusions. */
  reviewerBlockers: string[];
  authorityIncidents: Array<{ source: "packet" | "review"; count: number; detail: string }>;
};

export type WorkCellBenchmark = {
  reviewerPresent: boolean;
  claimsReviewed: number;
  independentVerifications: number;
  rejectedClaims: number;
  inconclusiveClaims: number;
  newFindings: number;
  highSeverityNewFindings: number;
  challengedAssumptions: number;
  /**
   * True when the reviewer surfaced something the packet's own structural
   * validation did not. This is a POSITIVE signal about the work cell and a
   * NEGATIVE signal about the attempt; it never contributes to the gate.
   */
  reviewerCaughtDefectStructuralValidationMissed: boolean;
};

export function summarizeWorkCellBenchmark(
  packet: ValidationResult<CatalogEvidencePacketMetrics>,
  review: ValidationResult<CatalogEvidenceReviewMetrics> | null,
): WorkCellBenchmark {
  if (!review) {
    return {
      reviewerPresent: false,
      claimsReviewed: 0,
      independentVerifications: 0,
      rejectedClaims: 0,
      inconclusiveClaims: 0,
      newFindings: 0,
      highSeverityNewFindings: 0,
      challengedAssumptions: 0,
      reviewerCaughtDefectStructuralValidationMissed: false,
    };
  }
  const surfaced = review.metrics.rejectCount > 0 || review.metrics.highSeverityNewFindingCount > 0;
  return {
    reviewerPresent: true,
    claimsReviewed: review.metrics.claimsReviewedCount,
    independentVerifications: review.metrics.independentVerificationCount,
    rejectedClaims: review.metrics.rejectCount,
    inconclusiveClaims: review.metrics.inconclusiveCount,
    newFindings: review.metrics.newFindingsCount,
    highSeverityNewFindings: review.metrics.highSeverityNewFindingCount,
    challengedAssumptions: review.metrics.challengedAssumptionCount,
    reviewerCaughtDefectStructuralValidationMissed: surfaced && packet.hardGatePass,
  };
}

export function summarizeWorkCellGate(
  packet: ValidationResult<CatalogEvidencePacketMetrics>,
  review: ValidationResult<CatalogEvidenceReviewMetrics> | null,
): WorkCellGate {
  const reasons: string[] = [];
  const reviewerBlockers: string[] = [];
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

  // Structural problems with either artifact.
  if (!packet.hardGatePass) reasons.push("Deterministic validation rejected the evidence packet.");
  if (review && !review.hardGatePass) reasons.push("Deterministic validation rejected the independent review.");
  if (!review) reasons.push("No independent review has been ingested for this run.");
  if (authorityIncidents.length) reasons.push("One or more executors reported an authority action.");

  // Reviewer conclusions that block verification. Each of these describes a
  // structurally valid review whose CONTENT says the attempt is not done.
  if (review) {
    if (review.metrics.rejectCount > 0) {
      reviewerBlockers.push(
        `The independent reviewer rejected ${review.metrics.rejectCount} claim(s). A rejected claim sends the attempt to corrective action.`,
      );
    }
    if (review.metrics.inconclusiveCount > 0) {
      // Step 3D treats every inconclusive as material: this workstream has no
      // track record yet, so "the reviewer could not confirm it" is not a basis
      // for a verified receipt. A future step may narrow this by severity once
      // there is evidence to justify doing so.
      reviewerBlockers.push(
        `The independent reviewer could not resolve ${review.metrics.inconclusiveCount} claim(s). An unresolved claim cannot support verification.`,
      );
    }
    if (review.metrics.escalationRequiredCount > 0) {
      reviewerBlockers.push("The independent reviewer requires human escalation.");
    }
    if (review.metrics.highSeverityNewFindingCount > 0) {
      reviewerBlockers.push(
        `The independent reviewer raised ${review.metrics.highSeverityNewFindingCount} new high-severity finding(s) the packet did not contain.`,
      );
    }
  }

  // The packet's own escalation flag is the same class of signal: the executor
  // itself said a human must decide. An open escalation is not a finished
  // outcome, so it blocks verification even though it satisfies the structural
  // rule that a high-severity contradiction must escalate or be corrected.
  if (packet.metrics.escalationCount > 0) {
    reviewerBlockers.push(
      `The research executor flagged ${packet.metrics.escalationCount} product(s) as requiring escalation.`,
    );
  }

  reasons.push(...reviewerBlockers);

  const hardGatePass =
    packet.hardGatePass &&
    review !== null &&
    review.hardGatePass &&
    authorityIncidents.length === 0 &&
    reviewerBlockers.length === 0;

  // "failed" means something was actually disproven or violated. "inconclusive"
  // means the evidence does not yet support a verdict either way. Neither can
  // satisfy the receipt guard, which requires exactly "passed".
  const definiteFailure =
    !packet.hardGatePass ||
    (review !== null && !review.hardGatePass) ||
    authorityIncidents.length > 0 ||
    (review?.metrics.rejectCount ?? 0) > 0 ||
    (review?.metrics.highSeverityNewFindingCount ?? 0) > 0;

  const workCellVerdict: GauntletVerdict = hardGatePass ? "passed" : definiteFailure ? "failed" : "inconclusive";

  if (hardGatePass) {
    reasons.push(
      "Deterministic validation accepted the frozen packet and the independent review, and the reviewer raised no blocking conclusion.",
    );
  }

  return { hardGatePass, workCellVerdict, reasons, reviewerBlockers, authorityIncidents };
}
