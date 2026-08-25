import { describe, expect, it } from "vitest";
import {
  RESEARCH_CONNECTOR_SCHEMA_VERSION,
  admitResearchEvidence,
  sourceTrustRank,
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
  sourceTrustTier: "primary",
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
  trustTier: "primary",
  claimClass: "consequential",
};

const requirement: ResearchEvidenceRequirement = {
  claimClass: "consequential",
  minimumTrustTier: "primary",
  requiresRawArtifactHash: true,
  requiresSourceLabel: true,
};

describe("research connector trust v1", () => {
  it("admits healthy primary evidence when the trust gate is satisfied", () => {
    const result = admitResearchEvidence({ connector, evidence, requirement });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      accepted: true,
      connectorKey: "official-research",
      trustTier: "primary",
      connectorHealth: "healthy",
    });
  });

  it("keeps the trust hierarchy explicit", () => {
    expect(sourceTrustRank("primary")).toBeGreaterThan(sourceTrustRank("community"));
    expect(sourceTrustRank("community")).toBeGreaterThan(sourceTrustRank("unverified"));
  });

  it("rejects community evidence for a primary-authority claim", () => {
    const result = admitResearchEvidence({
      connector: {
        ...connector,
        connectorKey: "community-search",
        platform: "community-api",
        sourceTrustTier: "community",
        sourceUrl: "https://community.example",
      },
      evidence: {
        ...evidence,
        connectorKey: "community-search",
        sourceUrl: "https://community.example/thread",
        sourceLabel: "Community thread",
        trustTier: "community",
      },
      requirement,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("minimum required tier");
  });

  it("allows exploratory community evidence when the requirement permits it", () => {
    const result = admitResearchEvidence({
      connector: {
        ...connector,
        connectorKey: "community-search",
        platform: "community-api",
        sourceTrustTier: "community",
        sourceUrl: "https://community.example",
      },
      evidence: {
        ...evidence,
        connectorKey: "community-search",
        sourceUrl: "https://community.example/thread",
        sourceLabel: "Community thread",
        trustTier: "community",
        claimClass: "exploratory",
        rawArtifactHash: null,
      },
      requirement: {
        claimClass: "exploratory",
        minimumTrustTier: "community",
        requiresRawArtifactHash: false,
        requiresSourceLabel: true,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects unavailable connectors and mismatched evidence", () => {
    const result = admitResearchEvidence({
      connector: { ...connector, health: "auth_expired" },
      evidence: { ...evidence, connectorKey: "other-connector" },
      requirement,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toMatch(/health|does not match/);
  });

  it("requires raw artifacts for consequential evidence", () => {
    const result = admitResearchEvidence({
      connector,
      evidence: { ...evidence, rawArtifactHash: null },
      requirement,
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("rawArtifactHash");
  });
});
