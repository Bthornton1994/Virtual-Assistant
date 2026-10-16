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

describe("research-connector leftover identity and URL gates", () => {
  it("refuses padded identifiers and an unknown schema version", () => {
    const paddedConnector = validateResearchConnector({ ...connector, connectorKey: " official-research " });
    expect(paddedConnector.ok).toBe(false);
    expect(failuresOf(paddedConnector)).toMatch(/must not have leading or trailing whitespace/);

    const paddedEvidence = admitResearchEvidence({
      connector,
      evidence: { ...evidence, evidenceId: " evidence-001 " },
      requirement,
    });
    expect(paddedEvidence.ok).toBe(false);
    expect(failuresOf(paddedEvidence)).toMatch(/must not have leading or trailing whitespace/);

    const wrongSchema = validateResearchConnector({
      ...connector,
      schemaVersion: "research-connector/v0" as typeof RESEARCH_CONNECTOR_SCHEMA_VERSION,
    });
    expect(wrongSchema.ok).toBe(false);
    expect(failuresOf(wrongSchema)).toMatch(/schemaVersion|Invalid literal/i);
  });

  it("refuses extra keys on the connector during admission and unknown auth modes", () => {
    const extraConnector = admitResearchEvidence({
      connector: { ...connector, trustedByDefault: true },
      evidence,
      requirement,
    });
    expect(extraConnector.ok).toBe(false);
    expect(failuresOf(extraConnector)).toMatch(/unrecognized|additional/i);

    const unknownAuth = validateResearchConnector({
      ...connector,
      authMode: "bearer_token" as ResearchConnector["authMode"],
    });
    expect(unknownAuth.ok).toBe(false);
    expect(failuresOf(unknownAuth)).toMatch(/authMode/i);
  });

  it("refuses blank, whitespace, and non-URL source fields instead of treating them as https evidence", () => {
    const blankUrl = admitResearchEvidence({
      connector,
      evidence: { ...evidence, sourceUrl: "" },
      requirement,
    });
    expect(blankUrl.ok).toBe(false);
    expect(failuresOf(blankUrl)).toMatch(/sourceUrl|url|Invalid|too small/i);

    const whitespaceUrl = validateResearchConnector({
      ...connector,
      sourceUrl: "   ",
    });
    expect(whitespaceUrl.ok).toBe(false);
    expect(failuresOf(whitespaceUrl)).toMatch(/sourceUrl|url|Invalid/i);

    const notAUrl = admitResearchEvidence({
      connector,
      evidence: { ...evidence, sourceUrl: "not-a-url" },
      requirement,
    });
    expect(notAUrl.ok).toBe(false);
    expect(failuresOf(notAUrl)).toMatch(/sourceUrl|url|Invalid/i);
  });
});
