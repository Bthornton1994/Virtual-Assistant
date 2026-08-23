import { describe, expect, it } from "vitest";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import {
  collectClaimIds,
  collectHighSeverityClaimIds,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
} from "@/lib/catalog-evidence-validator";
import { summarizeWorkCellGate } from "@/lib/work-cell-policy";
import { MANUFACTURER_URL, ZERO_AUTHORITY, packet, product, review } from "@/lib/__tests__/catalog-evidence-fixtures";

function gateFor(hermes = packet(), grok?: Parameters<typeof validateCatalogEvidenceReview>[0]) {
  const packetResult = validateCatalogEvidencePacket(hermes);
  const hash = hashCatalogEvidencePacket(hermes);
  const reviewResult =
    grok === undefined
      ? null
      : validateCatalogEvidenceReview(grok, {
          expectedPacketHash: hash,
          allClaimIds: collectClaimIds(hermes),
          highSeverityClaimIds: collectHighSeverityClaimIds(hermes),
        });
  return summarizeWorkCellGate(packetResult, reviewResult);
}

describe("work cell gate", () => {
  it("passes only when both deterministic validations pass", () => {
    const hermes = packet();
    const gate = gateFor(hermes, review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) }));
    expect(gate.hardGatePass).toBe(true);
    expect(gate.agentVerdict).toBe("passed");
    expect(gate.authorityIncidents).toEqual([]);
  });

  it("does not pass on the agent's word when the packet fails deterministic validation", () => {
    const hermes = packet({
      products: [
        product({
          candidateCorrections: [
            { field: "thickness", proposedValue: "6mm", confidence: "medium", sourceUrls: ["https://unrelated.example.com/x"] },
          ],
        }),
      ],
    });
    // The reviewer accepts everything; the validator does not.
    const gate = gateFor(hermes, review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) }));
    expect(gate.hardGatePass).toBe(false);
    expect(gate.agentVerdict).not.toBe("passed");
    expect(gate.reasons).toContain("Deterministic validation rejected the evidence packet.");
  });

  it("never passes without an independent review", () => {
    const gate = gateFor(packet(), undefined);
    expect(gate.hardGatePass).toBe(false);
    expect(gate.agentVerdict).toBe("inconclusive");
    expect(gate.reasons).toContain("No independent review has been ingested for this run.");
  });

  it("reports failed when the reviewer rejects a claim", () => {
    const hermes = packet();
    const gate = gateFor(
      hermes,
      review({
        evidencePacketHash: hashCatalogEvidencePacket(hermes),
        claimReviews: [
          {
            claimId: "ks-sbd-7mm:thickness",
            verdict: "reject",
            independentVerificationPerformed: true,
            reason: "The cited page states a different thickness.",
            independentSourceUrls: [MANUFACTURER_URL],
            severity: "medium",
          },
        ],
      }),
    );
    expect(gate.agentVerdict).toBe("failed");
  });

  it("downgrades to inconclusive when the reviewer is unsure", () => {
    const hermes = packet();
    const gate = gateFor(
      hermes,
      review({
        evidencePacketHash: hashCatalogEvidencePacket(hermes),
        claimReviews: [
          {
            claimId: "ks-sbd-7mm:thickness",
            verdict: "inconclusive",
            independentVerificationPerformed: true,
            reason: "The manufacturer page was unreachable during the review.",
            independentSourceUrls: [],
            severity: "low",
          },
        ],
      }),
    );
    expect(gate.agentVerdict).toBe("inconclusive");
    expect(gate.hardGatePass).toBe(true);
  });

  it("surfaces authority incidents from either executor and fails the gate", () => {
    const hermes = packet({ authorityReport: { ...ZERO_AUTHORITY, repositoryChangesMade: 1 } });
    const gate = gateFor(hermes, review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) }));
    expect(gate.hardGatePass).toBe(false);
    expect(gate.authorityIncidents).toHaveLength(1);
    expect(gate.authorityIncidents[0]).toMatchObject({ source: "packet", count: 1 });

    const clean = packet();
    const reviewerGate = gateFor(
      clean,
      review({ evidencePacketHash: hashCatalogEvidencePacket(clean), authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 3 } }),
    );
    expect(reviewerGate.hardGatePass).toBe(false);
    expect(reviewerGate.authorityIncidents[0]).toMatchObject({ source: "review", count: 3 });
  });

  it("fails when the review is bound to a different packet hash", () => {
    const hermes = packet();
    const gate = gateFor(hermes, review({ evidencePacketHash: "b".repeat(64) }));
    expect(gate.hardGatePass).toBe(false);
    expect(gate.reasons).toContain("Deterministic validation rejected the independent review.");
  });

  it("never lets the deterministic row pass while the reviewer committed an authority action", () => {
    // The receipt guard passes a run as soon as any one independent review passes
    // with a clean hard gate, so both rows this work cell writes must agree.
    const clean = packet();
    const gate = gateFor(
      clean,
      review({ evidencePacketHash: hashCatalogEvidencePacket(clean), authorityReport: { ...ZERO_AUTHORITY, purchasesMade: 1 } }),
    );
    expect(gate.hardGatePass).toBe(false);
    expect(gate.deterministicVerdict).toBe("failed");
    expect(gate.agentVerdict).not.toBe("passed");
  });

  it("calls a missing review inconclusive rather than failed", () => {
    const gate = gateFor(packet(), undefined);
    expect(gate.deterministicVerdict).toBe("inconclusive");
  });

  it("calls a rejected packet failed", () => {
    const hermes = packet({ authorityReport: { ...ZERO_AUTHORITY, catalogRecordsModified: 1 } });
    const gate = gateFor(hermes, review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) }));
    expect(gate.deterministicVerdict).toBe("failed");
  });

  it("reports passed on both rows only when everything is clean", () => {
    const hermes = packet();
    const gate = gateFor(hermes, review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) }));
    expect(gate.deterministicVerdict).toBe("passed");
    expect(gate.agentVerdict).toBe("passed");
  });

  it("never reports a passing verdict while the hard gate is red", () => {
    const cases = [
      gateFor(packet(), undefined),
      gateFor(packet({ authorityReport: { ...ZERO_AUTHORITY, accountsCreated: 1 } }), undefined),
      gateFor(packet(), review({ evidencePacketHash: "c".repeat(64) })),
    ];
    for (const gate of cases) {
      expect(gate.hardGatePass).toBe(false);
      expect(gate.deterministicVerdict).not.toBe("passed");
      expect(gate.agentVerdict).not.toBe("passed");
    }
  });
});
