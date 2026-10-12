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
  MANUFACTURER_URL,
  catalogFieldCorrection,
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

describe("work-cell leftover benchmark gates", () => {
  it("does not credit the reviewer for catching a defect the packet already failed structurally", () => {
    const badPacket = packet({
      products: [
        product({
          candidateCorrections: [
            catalogFieldCorrection({
              field: "thickness",
              proposedValue: "6mm",
              sourceUrls: ["https://unrelated.example.com/x"],
            }),
          ],
        }),
      ],
    });
    const { packetResult, reviewResult, benchmark, gate } = evaluate(
      badPacket,
      review({
        evidencePacketHash: hashCatalogEvidencePacket(badPacket),
        claimReviews: [
          {
            claimId: "ks-sbd-7mm:thickness",
            verdict: "reject",
            independentVerificationPerformed: true,
            reason: "The packet already failed structural validation.",
            independentSourceUrls: [MANUFACTURER_URL],
            severity: "high",
          },
        ],
      }),
    );

    expect(packetResult.hardGatePass).toBe(false);
    expect(reviewResult?.metrics.rejectCount).toBeGreaterThan(0);
    expect(benchmark.reviewerCaughtDefectStructuralValidationMissed).toBe(false);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
  });
});
