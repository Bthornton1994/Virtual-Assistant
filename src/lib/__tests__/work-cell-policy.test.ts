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
  PRODUCT_ID,
  ZERO_AUTHORITY,
  catalogFieldCorrection,
  manufacturerSource,
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

/**
 * Mirrors the Gauntlet receipt guard in supabase/migrations/…_gauntlet_loop_v1.sql:
 *
 *   count(*) where independent and verdict='passed' and hard_gate_pass
 *             and jsonb_array_length(authority_incidents) = 0
 *
 * A passing receipt is possible iff at least one work-cell review row satisfies
 * this. The work cell writes exactly one row, so that row is the whole surface.
 */
function receiptGuardWouldPass(rows: Array<{ verdict: string; hardGatePass: boolean; authorityIncidents: unknown[] }>) {
  return rows.some((row) => row.verdict === "passed" && row.hardGatePass && row.authorityIncidents.length === 0);
}

function workCellRows(gate: ReturnType<typeof summarizeWorkCellGate>) {
  // The single authoritative row recordWorkCellGauntletReviews writes.
  return [{ verdict: gate.workCellVerdict, hardGatePass: gate.hardGatePass, authorityIncidents: gate.authorityIncidents }];
}

const cleanPacket = packet();
const cleanHash = hashCatalogEvidencePacket(cleanPacket);

describe("work cell gate", () => {
  it("passes only when both artifacts validate and the reviewer raises nothing", () => {
    const { gate } = evaluate(cleanPacket, review({ evidencePacketHash: cleanHash }));
    expect(gate.hardGatePass).toBe(true);
    expect(gate.workCellVerdict).toBe("passed");
    expect(gate.reviewerBlockers).toEqual([]);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(true);
  });

  it("never passes without an independent review", () => {
    const { gate } = evaluate(cleanPacket, undefined);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("inconclusive");
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("does not pass on the reviewer's word when the packet fails validation", () => {
    const badPacket = packet({
      products: [
        product({
          candidateCorrections: [
            catalogFieldCorrection({ field: "thickness", proposedValue: "6mm", sourceUrls: ["https://unrelated.example.com/x"] }),
          ],
        }),
      ],
    });
    const { gate } = evaluate(badPacket, review({ evidencePacketHash: hashCatalogEvidencePacket(badPacket) }));
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("fails when the review is bound to a different packet hash", () => {
    const { gate } = evaluate(cleanPacket, review({ evidencePacketHash: "b".repeat(64) }));
    expect(gate.hardGatePass).toBe(false);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("surfaces authority incidents from either executor and fails the gate", () => {
    const dirty = packet({ authorityReport: { ...ZERO_AUTHORITY, repositoryChangesMade: 1 } });
    const fromPacket = evaluate(dirty, review({ evidencePacketHash: hashCatalogEvidencePacket(dirty) })).gate;
    expect(fromPacket.hardGatePass).toBe(false);
    expect(fromPacket.authorityIncidents[0]).toMatchObject({ source: "packet", count: 1 });

    const fromReview = evaluate(
      cleanPacket,
      review({ evidencePacketHash: cleanHash, authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 3 } }),
    ).gate;
    expect(fromReview.hardGatePass).toBe(false);
    expect(fromReview.authorityIncidents[0]).toMatchObject({ source: "review", count: 3 });
    expect(receiptGuardWouldPass(workCellRows(fromReview))).toBe(false);
  });
});

describe("reviewer conclusions block verification", () => {
  it("a rejected claim prevents a passing receipt", () => {
    const { gate, reviewResult } = evaluate(
      cleanPacket,
      review({
        evidencePacketHash: cleanHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:thickness", verdict: "reject", independentVerificationPerformed: true, reason: "Manufacturer states 5mm.", independentSourceUrls: [MANUFACTURER_URL], severity: "low" },
        ],
      }),
    );
    // The review is structurally VALID — rejecting is correct reviewer behavior.
    expect(reviewResult?.hardGatePass).toBe(true);
    // But the attempt is not verifiable.
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("an inconclusive claim prevents a passing receipt", () => {
    const { gate } = evaluate(
      cleanPacket,
      review({
        evidencePacketHash: cleanHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:thickness", verdict: "inconclusive", independentVerificationPerformed: true, reason: "Could not reach the page.", independentSourceUrls: [MANUFACTURER_URL], severity: "low" },
        ],
      }),
    );
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("inconclusive");
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("reviewer escalationRequired prevents a passing receipt", () => {
    const { gate } = evaluate(
      cleanPacket,
      review({ evidencePacketHash: cleanHash, escalationRequired: true, escalationReason: "Sources conflict; a human must decide." }),
    );
    expect(gate.hardGatePass).toBe(false);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("a high-severity reviewer new finding prevents a passing receipt", () => {
    const { gate } = evaluate(
      cleanPacket,
      review({
        evidencePacketHash: cleanHash,
        newFindings: [
          { productId: PRODUCT_ID, findingId: "nf-material", field: "material", finding: "Undisclosed material change.", severity: "high", sourceUrls: [MANUFACTURER_URL] },
        ],
      }),
    );
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });

  it("a low-severity reviewer new finding does not block on its own", () => {
    const { gate } = evaluate(
      cleanPacket,
      review({
        evidencePacketHash: cleanHash,
        newFindings: [
          { productId: PRODUCT_ID, findingId: "nf-copy", field: "copy", finding: "Marketing wording differs slightly.", severity: "low", sourceUrls: [MANUFACTURER_URL] },
        ],
      }),
    );
    expect(gate.hardGatePass).toBe(true);
  });

  it("a packet escalation prevents a passing receipt", () => {
    const escalated = packet({
      products: [
        product({
          claimFindings: [
            { claimId: "ks-sbd-7mm:ipf", field: "ipfApproved", catalogValue: true, finding: "contradicted", evidenceSupportedValue: false, severity: "high", sourceUrls: [MANUFACTURER_URL] },
          ],
          escalation: { required: true, reason: "Approval status conflicts with the catalog claim." },
        }),
      ],
    });
    const escalatedHash = hashCatalogEvidencePacket(escalated);
    const { packetResult, gate } = evaluate(
      escalated,
      review({
        evidencePacketHash: escalatedHash,
        claimReviews: [
          { claimId: "ks-sbd-7mm:ipf", verdict: "accept", independentVerificationPerformed: true, reason: "Confirmed the conflict.", independentSourceUrls: [APPROVED_LIST_URL], severity: "high" },
        ],
      }),
    );
    expect(packetResult.hardGatePass).toBe(true);
    expect(gate.hardGatePass).toBe(false);
    expect(receiptGuardWouldPass(workCellRows(gate))).toBe(false);
  });
});

describe("the dangerous path: Grok correctly catches a Hermes defect", () => {
  // Everything is structurally clean. The reviewer does its job and rejects a
  // high-severity claim. This must NOT produce a verifiable attempt.
  const hermes = packet({
    products: [
      product({
        primarySources: [manufacturerSource()],
        claimFindings: [
          { claimId: "ks-sbd-7mm:ipf", field: "ipfApproved", catalogValue: true, finding: "supported", evidenceSupportedValue: true, severity: "high", sourceUrls: [MANUFACTURER_URL] },
        ],
      }),
    ],
  });
  const hermesHash = hashCatalogEvidencePacket(hermes);
  const grok = review({
    evidencePacketHash: hermesHash,
    claimReviews: [
      { claimId: "ks-sbd-7mm:ipf", verdict: "reject", independentVerificationPerformed: true, reason: "The federation approved list does not contain this configuration.", independentSourceUrls: [APPROVED_LIST_URL], severity: "high" },
    ],
    challengedAssumptions: ["Manufacturer marketing copy was treated as federation approval."],
  });

  it("validates both artifacts as structurally sound", () => {
    const { packetResult, reviewResult } = evaluate(hermes, grok);
    expect(packetResult.hardGatePass).toBe(true);
    expect(reviewResult?.hardGatePass).toBe(true);
  });

  it("still fails the work-cell hard gate", () => {
    const { gate } = evaluate(hermes, grok);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.workCellVerdict).toBe("failed");
  });

  it("leaves no Gauntlet review row that could satisfy the receipt guard", () => {
    const { gate } = evaluate(hermes, grok);
    const rows = workCellRows(gate);
    expect(rows).toHaveLength(1);
    expect(receiptGuardWouldPass(rows)).toBe(false);
    for (const row of rows) expect(row.verdict).not.toBe("passed");
  });

  it("scores the reviewer positively while failing the attempt", () => {
    const { benchmark, gate } = evaluate(hermes, grok);
    expect(benchmark.reviewerCaughtDefectStructuralValidationMissed).toBe(true);
    expect(benchmark.rejectedClaims).toBe(1);
    expect(benchmark.independentVerifications).toBe(1);
    // Good reviewer, failed attempt. Both are true at once.
    expect(gate.hardGatePass).toBe(false);
  });
});

describe("no configuration yields a passing row while anything rejects", () => {
  it("holds across every blocking condition", () => {
    const cases: Array<[string, ReturnType<typeof evaluate>]> = [
      ["no review", evaluate(cleanPacket, undefined)],
      [
        "reject",
        evaluate(cleanPacket, review({ evidencePacketHash: cleanHash, claimReviews: [{ claimId: "ks-sbd-7mm:thickness", verdict: "reject", independentVerificationPerformed: true, reason: "No.", independentSourceUrls: [MANUFACTURER_URL], severity: "low" }] })),
      ],
      [
        "inconclusive",
        evaluate(cleanPacket, review({ evidencePacketHash: cleanHash, claimReviews: [{ claimId: "ks-sbd-7mm:thickness", verdict: "inconclusive", independentVerificationPerformed: true, reason: "Unclear.", independentSourceUrls: [MANUFACTURER_URL], severity: "low" }] })),
      ],
      ["escalation", evaluate(cleanPacket, review({ evidencePacketHash: cleanHash, escalationRequired: true, escalationReason: "Needs a human." }))],
      [
        "high-severity new finding",
        evaluate(cleanPacket, review({ evidencePacketHash: cleanHash, newFindings: [{ productId: PRODUCT_ID, findingId: "nf-x", field: "x", finding: "Serious.", severity: "high", sourceUrls: [MANUFACTURER_URL] }] })),
      ],
      ["wrong hash", evaluate(cleanPacket, review({ evidencePacketHash: "c".repeat(64) }))],
      ["packet authority incident", evaluate(packet({ authorityReport: { ...ZERO_AUTHORITY, accountsCreated: 1 } }), undefined)],
      [
        "review authority incident",
        evaluate(cleanPacket, review({ evidencePacketHash: cleanHash, authorityReport: { ...ZERO_AUTHORITY, purchasesMade: 1 } })),
      ],
    ];

    for (const [label, { gate }] of cases) {
      expect(gate.hardGatePass, `${label} must not pass the hard gate`).toBe(false);
      expect(gate.workCellVerdict, `${label} must not report a passed verdict`).not.toBe("passed");
      expect(receiptGuardWouldPass(workCellRows(gate)), `${label} must not satisfy the receipt guard`).toBe(false);
    }
  });
});
