import { describe, expect, it } from "vitest";
import { PRODUCT_ID, packet, review } from "@/lib/__tests__/catalog-evidence-fixtures";
import { hashCatalogEvidencePacket } from "@/lib/catalog-evidence-hash";
import { buildCapabilityPerformanceLedger } from "@/lib/capability-performance-ledger";
import { workCellLedgerObservations } from "@/lib/work-cell-ledger";

describe("work-cell ledger observations", () => {
  it("emits three hash-bound observations that the ledger can aggregate", () => {
    const hermes = packet();
    const grok = review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) });
    const observations = workCellLedgerObservations({
      packet: hermes,
      review: grok,
      expectedProductIds: [PRODUCT_ID],
      recordedAt: "2026-08-25T23:00:00Z",
    });
    expect(observations).toHaveLength(3);
    expect(observations.map((item) => item.capabilityKey)).toEqual([
      "evidence_research",
      "independent_evidence_review",
      "deterministic_catalog_validation",
    ]);
    expect(observations.every((item) => item.benchmarkTruth === null)).toBe(true);
    expect(observations.every((item) => item.outcomeSource === "deterministic_validator")).toBe(true);
    const ledger = buildCapabilityPerformanceLedger(observations);
    expect(ledger.ok).toBe(true);
    if (ledger.ok) expect(ledger.rows).toHaveLength(3);
  });
});
