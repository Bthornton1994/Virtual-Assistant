import { describe, expect, it } from "vitest";
import { MANUFACTURER_URL, PRODUCT_ID, ZERO_AUTHORITY, packet, review } from "@/lib/__tests__/catalog-evidence-fixtures";
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

  it("uses real persisted assignment bindings when supplied", () => {
    const hermes = packet();
    const grok = review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) });
    const observations = workCellLedgerObservations({
      packet: hermes,
      review: grok,
      expectedProductIds: [PRODUCT_ID],
      recordedAt: "2026-08-25T23:00:00Z",
      phaseBindings: {
        prepare: {
          assignmentId: "assignment-prepare",
          executorKey: "hermes-loadout-researcher-v1",
          sourceArtifactHash: "a".repeat(64),
          humanInterventionMinutes: 1.5,
          aiCostMicros: 1200,
          toolCostMicros: 300,
          latencyMs: 120,
        },
        review: {
          assignmentId: "assignment-review",
          executorKey: "grok-loadout-reviewer-v1",
          sourceArtifactHash: "b".repeat(64),
          humanInterventionMinutes: 0.5,
          aiCostMicros: 800,
          toolCostMicros: 200,
          latencyMs: 80,
        },
        validate: {
          assignmentId: "assignment-validate",
          executorKey: "catalog-evidence-validator-v1",
          sourceArtifactHash: "c".repeat(64),
          humanInterventionMinutes: 0,
          aiCostMicros: 0,
          toolCostMicros: 0,
          latencyMs: 10,
        },
      },
    });
    expect(observations.map((item) => item.assignmentId)).toEqual([
      "assignment-prepare",
      "assignment-review",
      "assignment-validate",
    ]);
    expect(observations.map((item) => item.sourceArtifactHash)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
    ]);
    expect(observations.map((item) => item.humanInterventionMinutes)).toEqual([1.5, 0.5, 0]);
    expect(observations.map((item) => item.latencyMs)).toEqual([120, 80, 10]);
  });

  it("marks every phase failed when the reviewer rejects a claim", () => {
    const hermes = packet();
    const grok = review({
      evidencePacketHash: hashCatalogEvidencePacket(hermes),
      claimReviews: [
        {
          claimId: "ks-sbd-7mm:thickness",
          verdict: "reject",
          independentVerificationPerformed: true,
          reason: "Manufacturer states 5mm.",
          independentSourceUrls: [MANUFACTURER_URL],
          severity: "low",
        },
      ],
    });
    const observations = workCellLedgerObservations({
      packet: hermes,
      review: grok,
      expectedProductIds: [PRODUCT_ID],
      recordedAt: "2026-08-25T23:00:00Z",
    });
    expect(observations).toHaveLength(3);
    expect(observations.every((item) => item.status === "failed")).toBe(true);
    expect(observations.every((item) => item.hardGateResult === "fail")).toBe(true);
    expect(observations.every((item) => item.authorityIncident === false)).toBe(true);
    expect(observations.every((item) => item.evidenceComplete === true)).toBe(true);
    expect(observations.every((item) => item.correctionRequired === true)).toBe(true);
  });

  it("marks every phase inconclusive when the reviewer cannot resolve a claim", () => {
    const hermes = packet();
    const grok = review({
      evidencePacketHash: hashCatalogEvidencePacket(hermes),
      claimReviews: [
        {
          claimId: "ks-sbd-7mm:thickness",
          verdict: "inconclusive",
          independentVerificationPerformed: true,
          reason: "Could not reach the page.",
          independentSourceUrls: [MANUFACTURER_URL],
          severity: "low",
        },
      ],
    });
    const observations = workCellLedgerObservations({
      packet: hermes,
      review: grok,
      expectedProductIds: [PRODUCT_ID],
      recordedAt: "2026-08-25T23:00:00Z",
    });
    expect(observations.every((item) => item.status === "inconclusive")).toBe(true);
    expect(observations.every((item) => item.hardGateResult === "fail")).toBe(true);
    expect(observations.every((item) => item.authorityIncident === false)).toBe(true);
  });

  it("propagates a packet authority incident onto every observation", () => {
    const hermes = packet({
      authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 1 },
    });
    const grok = review({ evidencePacketHash: hashCatalogEvidencePacket(hermes) });
    const observations = workCellLedgerObservations({
      packet: hermes,
      review: grok,
      expectedProductIds: [PRODUCT_ID],
      recordedAt: "2026-08-25T23:00:00Z",
    });
    expect(observations.every((item) => item.status === "failed")).toBe(true);
    expect(observations.every((item) => item.authorityIncident === true)).toBe(true);
    expect(observations.every((item) => item.hardGateResult === "fail")).toBe(true);
    expect(observations.every((item) => item.evidenceComplete === false)).toBe(true);
  });
});
