import { describe, expect, it } from "vitest";
import { CANONICAL_NON_CLAIMS } from "@/lib/ai-app-release-rescue/constants";
import { SAMPLE_CUSTOMER_REPORT, SAMPLE_REPORT, SAMPLE_REPORT_HASH } from "@/lib/ai-app-release-rescue/demo-fixtures";
import {
  countFindings,
  deriveOverallReadiness,
  presentRescueReport,
  toCustomerReport,
  validateRescueReport,
} from "@/lib/ai-app-release-rescue/report";

describe("rescue report schema", () => {
  it("accepts the synthetic sample and freezes a content hash", () => {
    const gate = presentRescueReport(SAMPLE_REPORT);
    expect(gate.hardGatePass).toBe(true);
    expect(gate.contentHash).toBe(SAMPLE_REPORT_HASH);
    expect(gate.customerReport?.non_claims).toEqual([...CANONICAL_NON_CLAIMS]);
  });

  it("computes readiness from findings instead of trusting a self-report", () => {
    const inflated = {
      ...SAMPLE_REPORT,
      summary: { ...SAMPLE_REPORT.summary, overall_readiness: "ready" as const },
    };
    const gate = validateRescueReport(inflated);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.hardFailures.some((failure) => /overall_readiness/.test(failure))).toBe(true);
    expect(deriveOverallReadiness(SAMPLE_REPORT.findings)).toBe("ready_with_caveats");
  });

  it("computes finding counts in deterministic code", () => {
    expect(countFindings(SAMPLE_REPORT.findings)).toEqual({
      critical_findings: 0,
      high_findings: 1,
      medium_findings: 2,
      low_findings: 1,
      informational_findings: 1,
    });
  });

  it("strips executor_id and organization_id from the customer report", () => {
    const customer = toCustomerReport(SAMPLE_REPORT);
    expect(customer).not.toHaveProperty("organization_id");
    expect(customer.reviewer).toEqual({ executor_type: "human" });
    expect(JSON.stringify(SAMPLE_CUSTOMER_REPORT)).not.toMatch(/exec_demo_internal/);
    expect(JSON.stringify(SAMPLE_CUSTOMER_REPORT)).not.toMatch(/org_demo_internal/);
  });

  it("rejects a report whose snippet still contains a live token", () => {
    const poisoned = {
      ...SAMPLE_REPORT,
      findings: SAMPLE_REPORT.findings.map((finding) =>
        finding.id === "SEC-001"
          ? {
              ...finding,
              evidence: {
                ...finding.evidence,
                snippet: 'STRIPE_SECRET_KEY = "sk_live_abcdefghijklmnopqrstuv"',
              },
            }
          : finding,
      ),
    };
    const gate = validateRescueReport(poisoned);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.hardFailures.some((failure) => /secret/i.test(failure))).toBe(true);
  });

  it("rejects missing non-claims", () => {
    const gate = validateRescueReport({
      ...SAMPLE_REPORT,
      non_claims: [
        "This review is a full security audit.",
        "Certified for production.",
        "All vulnerabilities were found.",
        "Monitoring is included.",
      ],
    });
    expect(gate.hardGatePass).toBe(false);
    expect(gate.hardFailures.some((failure) => /non_claims is missing required text/i.test(failure))).toBe(true);
  });

  it("does not treat not_ready when only informational findings exist", () => {
    expect(deriveOverallReadiness([{ severity: "informational" }, { severity: "low" }])).toBe("ready");
    expect(deriveOverallReadiness([{ severity: "critical" }])).toBe("not_ready");
  });
});
