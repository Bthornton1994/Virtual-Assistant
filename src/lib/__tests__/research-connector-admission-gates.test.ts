import { describe, expect, it } from "vitest";
import {
  RESEARCH_CONNECTOR_SCHEMA_VERSION,
  admitResearchEvidence,
  validateResearchConnector,
  type ResearchConnector,
  type ResearchEvidenceMetadata,
  type ResearchEvidenceRequirement,
} from "@/lib/research-connector";

const HASH = "e".repeat(64);

const connector: ResearchConnector = {
  schemaVersion: RESEARCH_CONNECTOR_SCHEMA_VERSION,
  connectorKey: "official-research",
  platform: "official-api",
  authMode: "oauth2",
  capabilities: ["search", "fetch"],
  health: "healthy",
  sourceTrustTier: "institutional",
  sourceUrl: "https://example.gov",
  accessedAt: "2026-08-25T20:00:00Z",
  rawArtifactHash: HASH,
};

const evidence: ResearchEvidenceMetadata = {
  schemaVersion: RESEARCH_CONNECTOR_SCHEMA_VERSION,
  evidenceId: "evidence-001",
  connectorKey: "official-research",
  sourceUrl: "https://example.gov/report",
  sourceLabel: "Official report",
  accessedAt: "2026-08-25T20:01:00Z",
  rawArtifactHash: HASH,
  trustTier: "institutional",
  claimClass: "informational",
};

const requirement: ResearchEvidenceRequirement = {
  claimClass: "informational",
  minimumTrustTier: "institutional",
  requiresRawArtifactHash: true,
  requiresSourceLabel: true,
};

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("research connector admission gates", () => {
  it("validates a connector and rejects extra keys or a blank capability set", () => {
    expect(validateResearchConnector(connector).ok).toBe(true);

    const extra = validateResearchConnector({ ...connector, trustedByDefault: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const emptyCaps = validateResearchConnector({ ...connector, capabilities: [] });
    expect(emptyCaps.ok).toBe(false);
    expect(failuresOf(emptyCaps)).toMatch(/capabilities/i);
  });

  it("does not let evidence claim a higher trust tier than its connector", () => {
    const result = admitResearchEvidence({
      connector,
      evidence: { ...evidence, trustTier: "primary" },
      requirement: { ...requirement, minimumTrustTier: "primary" },
    });
    expect(result.ok).toBe(false);
    expect(failuresOf(result)).toMatch(/exceeds the connector trust tier/i);
  });

  it("fails closed on unknown or unavailable health, empty labels, and claim-class mismatch", () => {
    const unknown = admitResearchEvidence({
      connector: { ...connector, health: "unknown" },
      evidence,
      requirement,
    });
    expect(unknown.ok).toBe(false);
    expect(failuresOf(unknown)).toMatch(/health/i);

    const unavailable = admitResearchEvidence({
      connector: { ...connector, health: "unavailable" },
      evidence,
      requirement,
    });
    expect(unavailable.ok).toBe(false);
    expect(failuresOf(unavailable)).toMatch(/health/i);

    const blankLabel = admitResearchEvidence({
      connector,
      evidence: { ...evidence, sourceLabel: "   " },
      requirement,
    });
    expect(blankLabel.ok).toBe(false);
    expect(failuresOf(blankLabel)).toMatch(/sourceLabel|source label/i);

    const claimMismatch = admitResearchEvidence({
      connector,
      evidence: { ...evidence, claimClass: "consequential" },
      requirement,
    });
    expect(claimMismatch.ok).toBe(false);
    expect(failuresOf(claimMismatch)).toMatch(/claimClass/i);
  });

  it("admits degraded healthy-enough connectors and rejects extra keys on evidence or requirement", () => {
    const degraded = admitResearchEvidence({
      connector: { ...connector, health: "degraded" },
      evidence,
      requirement,
    });
    expect(degraded.ok).toBe(true);
    if (degraded.ok) {
      expect(degraded.value.accepted).toBe(true);
      expect(degraded.value.connectorHealth).toBe("degraded");
    }

    const extraEvidence = admitResearchEvidence({
      connector,
      evidence: { ...evidence, admitted: true },
      requirement,
    });
    expect(extraEvidence.ok).toBe(false);
    expect(failuresOf(extraEvidence)).toMatch(/unrecognized|additional/i);

    const extraRequirement = admitResearchEvidence({
      connector,
      evidence,
      requirement: { ...requirement, autoAdmit: true },
    });
    expect(extraRequirement.ok).toBe(false);
    expect(failuresOf(extraRequirement)).toMatch(/unrecognized|additional/i);
  });
});
