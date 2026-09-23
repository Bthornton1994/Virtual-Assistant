import { decideReleaseRescueDelivery, type DeliveryDecision } from "@/lib/release-rescue-delivery";
import {
  hashReleaseRescueReviewSubject,
  signReleaseRescueReport,
  validateReleaseRescueReport,
  type ReviewAttestation,
} from "@/lib/release-rescue-report";
import { reviewSubmissionSchema } from "@/lib/release-rescue-review-session";
import { findOperator, type LocalOperator } from "@/lib/release-rescue-internal/local-identity";
import { loadRun, saveRun, sealIntact, sealReport, type RunRecord } from "@/lib/release-rescue-internal/store";

// Signing and export for internal runs.
//
// The same two-step flow the product uses, with the reviewer read from the
// local session instead of Supabase: a draft is assembled and sealed, a named
// operator reads it, and their approval carries the hash of what they read.
// `signReleaseRescueReport` refuses the signature unless that hash is the hash
// of the stored draft, so a change to the draft between display and signature
// is refused rather than signed. The store's seal additionally refuses a draft
// edited on disk, before it is ever shown.
//
// Export goes through `decideReleaseRescueDelivery`, the single production path
// from a stored report to anything a reader sees. Nothing here builds a view.

export type SignOutcome =
  | { ok: true; record: RunRecord }
  | {
      ok: false;
      reason:
        | "run_not_found"
        | "not_awaiting_review"
        | "draft_tampered"
        | "operator_unknown"
        | "malformed_submission"
        | "content_changed_since_shown"
        | "signature_refused";
      detail: string;
    };

/**
 * The attestation for a local operator. The reviewer is the operator the
 * session named, re-read from the registry; the submission may carry a reason
 * code and the approved hash, and a field that names anyone makes it malformed.
 */
export function attestationFromLocalOperator(
  operator: LocalOperator,
  submission: unknown,
  reviewedAt: Date,
): { ok: true; attestation: ReviewAttestation } | { ok: false; detail: string } {
  const parsed = reviewSubmissionSchema.safeParse(submission);
  if (!parsed.success) {
    const paths = [
      ...new Set(
        parsed.error.issues.flatMap((issue) =>
          issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".") || "(root)"],
        ),
      ),
    ];
    return {
      ok: false,
      detail: `The review submission is malformed at ${paths.join(", ")}. It carries a reason code and the approved content hash, and nothing else; the reviewer is read from the session.`,
    };
  }
  return {
    ok: true,
    attestation: {
      operatorUserId: operator.operatorId,
      displayName: operator.displayName,
      reviewedAt: reviewedAt.toISOString(),
      reasonCode: parsed.data.reasonCode,
      approvedContentHash: parsed.data.approvedContentHash,
    },
  };
}

export function signRunAsLocalOperator(
  sessionOperator: LocalOperator,
  runId: string,
  submission: unknown,
  now: Date = new Date(),
): SignOutcome {
  const record = loadRun(runId);
  if (!record) return { ok: false, reason: "run_not_found", detail: "No such run." };
  if (record.status !== "awaiting_review" || !record.draft) {
    return { ok: false, reason: "not_awaiting_review", detail: "This run has no draft awaiting review." };
  }
  if (!sealIntact("draft", runId, record.draft)) {
    return {
      ok: false,
      reason: "draft_tampered",
      detail: "The stored draft no longer matches its seal. It was changed after it was written, and it cannot be signed.",
    };
  }
  // Re-read from the registry, not trusted from the caller.
  const operator = findOperator(sessionOperator.operatorId);
  if (!operator || operator.role !== "ops_manager") {
    return { ok: false, reason: "operator_unknown", detail: "The signed-in operator is not a registered reviewer." };
  }
  const attested = attestationFromLocalOperator(operator, submission, now);
  if (!attested.ok) return { ok: false, reason: "malformed_submission", detail: attested.detail };

  const currentSubject = hashReleaseRescueReviewSubject(record.draft.report);
  if (attested.attestation.approvedContentHash !== currentSubject) {
    return {
      ok: false,
      reason: "content_changed_since_shown",
      detail: "The report you approved is not the report stored now. Reload it, read it again, and sign what is shown.",
    };
  }

  let signed;
  try {
    signed = signReleaseRescueReport(record.draft.report, attested.attestation);
  } catch (error) {
    return { ok: false, reason: "signature_refused", detail: error instanceof Error ? error.message : "The signature was refused." };
  }
  const validation = validateReleaseRescueReport(signed);
  if (!validation.hardGatePass) {
    return { ok: false, reason: "signature_refused", detail: validation.hardFailures.join("; ") };
  }

  const sealed = sealReport("signed", runId, signed, currentSubject);
  const updated: RunRecord = {
    ...record,
    status: "signed",
    signed: { ...sealed, signedAt: now.toISOString(), signedBy: operator.operatorId },
    accounting: {
      ...record.accounting,
      reportHash: sealed.reportHash,
    },
  };
  saveRun(updated);
  return { ok: true, record: updated };
}

export type ExportOutcome =
  | { status: "deliverable"; decision: Extract<DeliveryDecision, { status: "deliverable" }>; record: RunRecord }
  | { status: "withheld"; blockers: string[] };

/**
 * The delivery decision for a run's signed report. A report whose seal is
 * broken is withheld before the production gate is even asked.
 */
export function deliveryForRun(runId: string): ExportOutcome {
  const record = loadRun(runId);
  if (!record) return { status: "withheld", blockers: ["No such run."] };
  if (record.status === "purged") return { status: "withheld", blockers: ["This run was purged under its retention policy."] };
  if (!record.signed) return { status: "withheld", blockers: ["No named reviewer has signed this report."] };
  if (!sealIntact("signed", runId, record.signed)) {
    return { status: "withheld", blockers: ["The stored signed report no longer matches its seal."] };
  }
  const decision = decideReleaseRescueDelivery(record.signed.report);
  if (decision.status !== "deliverable") return { status: "withheld", blockers: [...decision.blockers] };
  return { status: "deliverable", decision, record };
}

/**
 * Marks the first successful export as the delivery, which starts the
 * retention window. Later exports do not move it.
 */
export function recordDelivery(runId: string, now: Date = new Date()): void {
  const record = loadRun(runId);
  if (!record || record.deliveredAt || record.status !== "signed") return;
  saveRun({ ...record, deliveredAt: now.toISOString() });
}
