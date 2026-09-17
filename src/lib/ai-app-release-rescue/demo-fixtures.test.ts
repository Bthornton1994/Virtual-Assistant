import { OBSERVATION_CATALOG } from "@/lib/release-rescue-observation-catalog";
import { describe, expect, it } from "vitest";
import { validateReleaseRescueReport, releaseRescueDeliveryGate } from "@/lib/release-rescue-report";
import { findInternalIdentityLeaks } from "@/lib/release-rescue-presentation";
import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { scanForSecrets } from "@/lib/release-rescue-redaction";
import { severityRank } from "@/lib/release-rescue-findings";
import { RUBRIC_DIMENSIONS } from "@/lib/release-rescue-rubric";
import {
  SAMPLE_DELIVERY,
  SAMPLE_REPORT,
  SAMPLE_REPORT_HASH,
} from "@/lib/ai-app-release-rescue/demo-fixtures";
import { CANONICAL_NON_CLAIMS, REPORT_LIMITATIONS_VERBATIM } from "@/lib/ai-app-release-rescue/constants";

/**
 * The sample report's customer view, obtained the way production obtains it.
 *
 * These assertions used to read `SAMPLE_CUSTOMER_REPORT`, a bare view built by
 * calling `toCustomerReportView` directly — so they described bytes no gate had
 * passed. Going through the decision means a fixture that stops being
 * deliverable fails here loudly instead of being asserted about anyway.
 */
function deliverableView() {
  if (SAMPLE_DELIVERY.status !== "deliverable") {
    throw new Error(`the sample fixture is not deliverable: ${SAMPLE_DELIVERY.blockers.join("; ")}`);
  }
  return SAMPLE_DELIVERY.view;
}

describe("the sample report shown to prospective customers", () => {
  it("passes the same validator a real report must pass", () => {
    // If the sample could not survive the real gate, it would be advertising a
    // deliverable the service cannot produce.
    const validation = validateReleaseRescueReport(SAMPLE_REPORT);

    expect(validation.hardFailures).toEqual([]);
    expect(validation.hardGatePass).toBe(true);
  });

  it("would be deliverable", () => {
    const validation = validateReleaseRescueReport(SAMPLE_REPORT);

    expect(releaseRescueDeliveryGate(SAMPLE_REPORT, validation)).toEqual({ deliverable: true, blockers: [] });
  });

  it("derives a blocked verdict from its findings rather than declaring one", () => {
    expect(SAMPLE_REPORT.verdict).toBe("release_blocked");
    expect(SAMPLE_REPORT.blockingFindingCount).toBeGreaterThan(0);
  });

  it("hashes to a stable value", () => {
    expect(SAMPLE_REPORT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps internal identifiers out of the customer view", () => {
    expect(findInternalIdentityLeaks(deliverableView(), SAMPLE_REPORT)).toEqual([]);
  });

  it("carries no secret material and no prohibited claim", () => {
    expect(scanForSecrets(deliverableView())).toEqual([]);
    for (const text of [
      ...deliverableView().limitations,
      ...deliverableView().disclaimers,
      deliverableView().verdictExplanation,
      REPORT_LIMITATIONS_VERBATIM,
      ...CANONICAL_NON_CLAIMS,
    ]) {
      expect(findProhibitedClaims(text), text.slice(0, 60)).toEqual([]);
    }
  });

  it("orders findings from most to least severe", () => {
    const ranks = deliverableView().findings.map((f) => severityRank(f.severity));

    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(deliverableView().findings.length).toBeGreaterThan(1);
  });

  it("does not inflate the prompt-injection finding to critical", () => {
    // Reaching it needs someone to upload a crafted receipt, so exploitability is
    // requires_user_interaction and the matrix caps it at high. A demo that
    // showed "critical" here would be selling alarm rather than the model.
    //
    // Under Option 1 that exploitability is the CATALOG's, fixed against the
    // observation code, not a per-finding judgement an executor makes. So this
    // test now checks two things at once: that the demo still shows `high`, and
    // that it gets there by naming the observation that actually matches its
    // scenario rather than by writing a smaller word.
    const injection = deliverableView().findings.find((f) => f.id === "RR-002");

    expect(injection?.severity).toBe("high");
    expect(injection?.blocking).toBe(true);

    const stored = SAMPLE_REPORT.findings.find((f) => f.findingId === "RR-002");
    expect(stored?.observationCode).toBe("ai.tool_authority_is_not_declared");
    expect(stored?.exploitability).toBe(
      OBSERVATION_CATALOG["ai.tool_authority_is_not_declared"].exploitability,
    );
  });

  it("covers every rubric check", () => {
    expect(deliverableView().coverage.notAssessedChecks).toBe(0);
    expect(deliverableView().dimensions).toHaveLength(RUBRIC_DIMENSIONS.length);
  });
});
