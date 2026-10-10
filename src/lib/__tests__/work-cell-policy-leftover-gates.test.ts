import { describe, expect, it } from "vitest";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import {
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
  type CatalogEvidenceReviewMetrics,
  type ValidationResult,
} from "@/lib/catalog-evidence-validator";
import { summarizeWorkCellBenchmark, summarizeWorkCellGate } from "@/lib/work-cell-policy";
import {
  APPROVED_LIST_URL,
  MANUFACTURER_URL,
  ZERO_AUTHORITY,
  packet,
  product,
  review,
  reviewContext,
} from "@/lib/__tests__/catalog-evidence-fixtures";

type ReviewInput = Parameters<typeof validateCatalogEvidenceReview>[0];

function evaluate(hermes = packet(), grok?: ReviewInput) {
  const packetResult = validateCatalogEvidencePacket(hermes);
  const hash = hashCatalogEvidencePacket(hermes);
  const reviewResult: ValidationResult<CatalogEvidenceReviewMetrics> | null =
    grok === undefined ? null : validateCatalogEvidenceReview(grok, reviewContext(hermes, hash));
  return {
    packetResult,
    reviewResult,
    gate: summarizeWorkCellGate(packetResult, reviewResult),
    benchmark: summarizeWorkCellBenchmark(packetResult, reviewResult),
  };
}

function receiptGuardWouldPass(rows: Array<{ verdict: string; hardGatePass: boolean; authorityIncidents: unknown[] }>) {
  return rows.some((row) => row.verdict === "passed" && row.hardGatePass && row.authorityIncidents.length === 0);
}

function workCellRows(gate: ReturnType<typeof summarizeWorkCellGate>) {
  return [{ verdict: gate.workCellVerdict, hardGatePass: gate.hardGatePass, authorityIncidents: gate.authorityIncidents }];
}

const cleanPacket = packet();
const cleanHash = hashCatalogEvidencePacket(cleanPacket);

describe("work-cell leftover verdict and benchmark gates", () => {
  it("treats reviewer-only escalation as inconclusive, not failed", () => {
    const { gate, reviewResult } = evaluate(
      cleanPacket,
      review({ evidencePacketHash: cleanHash, escalationRequired: true, escalationReason: "Sources conflict; a human must decide." }),
    );

    expect(reviewResult?.hardGatePass).toBe(true);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("inconclusive");
    expect(gate.reviewerBlockers.join(" ")).toMatch(/requires human escalation/);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("treats packet-only escalation as inconclusive, not failed", () => {
    const escalated = packet({
      products: [
        product({
          claimFindings: [
            {
              claimId: "ks-sbd-7mm:ipf",
              field: "ipfApproved",
              catalogValue: true,
              finding: "contradicted",
              evidenceSupportedValue: false,
              severity: "high",
              sourceUrls: [MANUFACTURER_URL],
            },
          ],
          escalation: { required: true, reason: "Approval status conflicts with the catalog claim." },
        }),
      ],
    });
    const { packetResult, gate } = evaluate(
      escalated,
      review({
        evidencePacketHash: hashCatalogEvidencePacket(escalated),
        claimReviews: [
          {
            claimId: "ks-sbd-7mm:ipf",
            verdict: "accept",
            independentVerificationPerformed: true,
            reason: "Confirmed the conflict.",
            independentSourceUrls: [APPROVED_LIST_URL],
            severity: "high",
          },
        ],
      }),
    );

    expect(packetResult.hardGatePass).toBe(true);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("inconclusive");
    expect(gate.reviewerBlockers.join(" ")).toMatch(/requiring escalation/);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("records authority incidents from the packet and the review together", () => {
    const dirty = packet({ authorityReport: { ...ZERO_AUTHORITY, repositoryChangesMade: 1 } });
    const { gate } = evaluate(
      dirty,
      review({
        evidencePacketHash: hashCatalogEvidencePacket(dirty),
        authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 2 },
      }),
    );

    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
    expect(gate.authorityIncidents).toEqual([
      expect.objectContaining({ source: "packet", count: 1 }),
      expect.objectContaining({ source: "review", count: 2 }),
    ]);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("zeros the benchmark when no independent review is present", () => {
    const { benchmark, gate } = evaluate(cleanPacket, undefined);

    expect(benchmark).toEqual({
      reviewerPresent: false,
      claimsReviewed: 0,
      independentVerifications: 0,
      rejectedClaims: 0,
      inconclusiveClaims: 0,
      newFindings: 0,
      highSeverityNewFindings: 0,
      challengedAssumptions: 0,
      reviewerCaughtDefectStructuralValidationMissed: false,
    });
    expect(gate.workCellVerdict).toBe("inconclusive");
  });

  it("fails the verdict when the review is structurally invalid", () => {
    const { gate, reviewResult } = evaluate(cleanPacket, review({ evidencePacketHash: "b".repeat(64) }));

    expect(reviewResult?.hardGatePass).toBe(false);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
    expect(gate.reasons.join(" ")).toMatch(/rejected the independent review/);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("records the positive pass reason only when the gate is clear", () => {
    const { gate } = evaluate(cleanPacket, review({ evidencePacketHash: cleanHash }));

    expect(gate.hardGatePass).toBe(true);
    expect(gate.workCellVerdict).toBe("passed");
    expect(gate.reasons).toContain(
      "Deterministic validation accepted the frozen packet and the independent review, and the reviewer raised no blocking conclusion.",
    );
  });
});
