import { describe, expect, it } from "vitest";
import { validateReleaseRescueReport, releaseRescueDeliveryGate } from "@/lib/release-rescue-report";
import { findInternalIdentityLeaks } from "@/lib/release-rescue-presentation";
import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { scanForSecrets } from "@/lib/release-rescue-redaction";
import { severityRank } from "@/lib/release-rescue-findings";
import { RUBRIC_DIMENSIONS } from "@/lib/release-rescue-rubric";
import {
  SAMPLE_CUSTOMER_REPORT,
  SAMPLE_REPORT,
  SAMPLE_REPORT_HASH,
} from "@/lib/ai-app-release-rescue/demo-fixtures";
import { CANONICAL_NON_CLAIMS, REPORT_LIMITATIONS_VERBATIM } from "@/lib/ai-app-release-rescue/constants";

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
    expect(findInternalIdentityLeaks(SAMPLE_CUSTOMER_REPORT, SAMPLE_REPORT)).toEqual([]);
  });

  it("carries no secret material and no prohibited claim", () => {
    expect(scanForSecrets(SAMPLE_CUSTOMER_REPORT)).toEqual([]);
    for (const text of [
      ...SAMPLE_CUSTOMER_REPORT.limitations,
      ...SAMPLE_CUSTOMER_REPORT.disclaimers,
      SAMPLE_CUSTOMER_REPORT.verdictExplanation,
      REPORT_LIMITATIONS_VERBATIM,
      ...CANONICAL_NON_CLAIMS,
    ]) {
      expect(findProhibitedClaims(text), text.slice(0, 60)).toEqual([]);
    }
  });

  it("orders findings from most to least severe", () => {
    const ranks = SAMPLE_CUSTOMER_REPORT.findings.map((f) => severityRank(f.severity));

    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(SAMPLE_CUSTOMER_REPORT.findings.length).toBeGreaterThan(1);
  });

  it("does not inflate the prompt-injection finding to critical", () => {
    // Reaching it needs someone to upload a crafted receipt, so exploitability is
    // requires_user_interaction and the matrix caps it at high. A demo that
    // showed "critical" here would be selling alarm rather than the model.
    const injection = SAMPLE_CUSTOMER_REPORT.findings.find((f) => f.id === "RR-002");

    expect(injection?.severity).toBe("high");
    expect(injection?.blocking).toBe(true);
  });

  it("covers every rubric check", () => {
    expect(SAMPLE_CUSTOMER_REPORT.coverage.notAssessedChecks).toBe(0);
    expect(SAMPLE_CUSTOMER_REPORT.dimensions).toHaveLength(RUBRIC_DIMENSIONS.length);
  });
});
