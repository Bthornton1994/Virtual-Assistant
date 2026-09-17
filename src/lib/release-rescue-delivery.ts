import { checkReportFieldCoverage, type CoverageFailure } from "@/lib/release-rescue-field-policy";
import {
  hashReleaseRescueReport,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
  type ReleaseRescueReportV1,
} from "@/lib/release-rescue-report";
import { toCustomerReportView, type CustomerReportView } from "@/lib/release-rescue-presentation";

/**
 * The single production path from a stored report to something a customer sees.
 *
 * `validateReleaseRescueReport`, `checkReportFieldCoverage` and
 * `releaseRescueDeliveryGate` existed for fourteen rounds with NO PRODUCTION
 * CALL SITE. They were reachable only from tests, while the sample report page
 * and its JSON download rendered `toCustomerReportView(SAMPLE_REPORT)` directly
 * and headed the result "Customer-safe report". A gate nothing calls enforces
 * nothing, and an audit named it as the defect that makes the release claim
 * untrue rather than merely incomplete.
 *
 * So the customer view is no longer something a caller can construct on the way
 * past. It is only obtainable from a decision that has already run all three
 * checks, and the `withheld` branch carries no view at all — a call site cannot
 * render what it was not given. That is the structural half; the wiring test in
 * `release-rescue-delivery.test.ts` is the half that notices if a future surface
 * goes around it.
 */
export type DeliveryDecision =
  | {
      readonly status: "deliverable";
      /** Present ONLY on this branch. A withheld decision has nothing to render. */
      readonly view: CustomerReportView;
      readonly contentHash: string;
      readonly reviewer: DeliveryReviewer;
      readonly checks: DeliveryChecks;
    }
  | {
      readonly status: "withheld";
      readonly blockers: readonly string[];
      readonly contentHash: string;
      /** Null when no human has signed, which is itself one of the blockers. */
      readonly reviewer: DeliveryReviewer | null;
      readonly checks: DeliveryChecks;
    };

/**
 * The human whose signature released this artifact, read from the report.
 *
 * Every field here is persisted ON the report and hashed with it, so what the
 * page shows is the stored record rather than anything computed for display.
 *
 * `reviewedBy` carries identity and timestamp and NOT a reason, nor a hash of
 * what was approved. `approvedContentHash` below is therefore recomputed here
 * from the artifact at decision time — it binds this decision to these bytes,
 * but it is not the reviewer's own attestation that they approved these bytes.
 * Closing that needs a schema change and a migration, and is recorded as an
 * owner decision in `docs/AI-APP-RELEASE-RESCUE-V1.md` rather than implied here.
 */
export type DeliveryReviewer = {
  readonly operatorUserId: string;
  readonly displayName: string;
  readonly reviewedAt: string;
  readonly approvedContentHash: string;
};

/** What ran, so a surface can show that the gate executed rather than assert it. */
export type DeliveryChecks = {
  readonly validationRan: boolean;
  readonly validationPassed: boolean;
  readonly coverageRan: boolean;
  readonly coverageFailureCount: number;
  readonly gateRan: boolean;
  readonly gateBlockerCount: number;
};

const NOTHING_RAN: DeliveryChecks = {
  validationRan: false,
  validationPassed: false,
  coverageRan: false,
  coverageFailureCount: 0,
  gateRan: false,
  gateBlockerCount: 0,
};

function reviewerOf(report: ReleaseRescueReportV1, contentHash: string): DeliveryReviewer | null {
  if (report.reviewedBy === null) return null;
  return {
    operatorUserId: report.reviewedBy.operatorUserId,
    displayName: report.reviewedBy.displayName,
    reviewedAt: report.reviewedBy.reviewedAt,
    approvedContentHash: contentHash,
  };
}

function coverageBlocker(failure: CoverageFailure): string {
  return `Field ${failure.path} has no cleared coverage decision: ${failure.reason}`;
}

/**
 * Decide whether a stored report may be shown, and produce the view only if so.
 *
 * Fails CLOSED in every direction. A throw anywhere in the three checks is a
 * withheld decision carrying the reason, never an exception that a page turns
 * into a blank space or a framework turns into a 500 that says nothing about
 * deliverability.
 */
export function decideReleaseRescueDelivery(report: ReleaseRescueReportV1): DeliveryDecision {
  let contentHash = "";
  try {
    contentHash = hashReleaseRescueReport(report);
  } catch (error) {
    return {
      status: "withheld",
      blockers: [`The report could not be hashed, so it cannot be bound to an approval: ${String(error)}`],
      contentHash: "",
      reviewer: null,
      checks: NOTHING_RAN,
    };
  }

  try {
    // Coverage first: it is the check that fails closed on a field nobody has
    // decided about, which is the one a new surface is most likely to add.
    const coverage = checkReportFieldCoverage(report);
    const validation = validateReleaseRescueReport(report);
    const gate = releaseRescueDeliveryGate(report, validation);

    const checks: DeliveryChecks = {
      validationRan: true,
      validationPassed: validation.hardGatePass,
      coverageRan: true,
      coverageFailureCount: coverage.length,
      gateRan: true,
      gateBlockerCount: gate.blockers.length,
    };

    const blockers = [
      ...coverage.map(coverageBlocker),
      ...validation.hardFailures,
      ...gate.blockers,
    ];

    const reviewer = reviewerOf(report, contentHash);

    if (blockers.length > 0 || !gate.deliverable || reviewer === null) {
      return {
        status: "withheld",
        // `gate.deliverable` false with an empty blocker list would otherwise
        // withhold silently, which is the shape of defect this file is about.
        blockers: blockers.length > 0 ? blockers : ["The delivery gate refused this report without naming a reason."],
        contentHash,
        reviewer,
        checks,
      };
    }

    return { status: "deliverable", view: toCustomerReportView(report), contentHash, reviewer, checks };
  } catch (error) {
    return {
      status: "withheld",
      blockers: [`A delivery check did not complete, so the report is withheld: ${String(error)}`],
      contentHash,
      reviewer: null,
      checks: NOTHING_RAN,
    };
  }
}
