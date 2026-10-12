import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
  inputManifestHashSource,
  type CatalogEvidenceInputManifestV1,
} from "@/lib/catalog-evidence-input";
import { validateCatalogEvidencePacket } from "@/lib/catalog-evidence-validator";
import {
  PUBLIC_WEB_RESEARCHER_KEY,
  extractHttpsUrls,
  isPublicHttpsUrl,
  pageIdentifiesProduct,
  preparePublicWebEvidencePacket,
  readablePageText,
  type PageFetcher,
} from "@/lib/public-web-researcher";

function manifest(): CatalogEvidenceInputManifestV1 {
  const base = {
    runId: "run-native-0001",
    market: "US",
    expectedProductIds: ["ks-sbd-7mm"],
    inputRecords: [
      {
        productId: "ks-sbd-7mm",
        record: {
          name: "SBD 7mm Knee Sleeves",
          thickness: "7mm",
          manufacturerUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
          ipfApproved: true,
        },
      },
    ],
    prepareExecutorKey: PUBLIC_WEB_RESEARCHER_KEY,
    reviewExecutorKey: "grok-loadout-reviewer-v1",
  };
  return {
    schemaVersion: CATALOG_EVIDENCE_INPUT_SCHEMA_VERSION,
    createdAt: "2026-08-25T12:00:00Z",
    inputHash: sha256Hex(inputManifestHashSource(base)),
    ...base,
  };
}

describe("public https URL gate", () => {
  it("allows ordinary public https pages and blocks private targets", () => {
    expect(isPublicHttpsUrl("https://www.sbdapparel.com/products/7mm-knee-sleeves")).toBe(true);
    expect(isPublicHttpsUrl("http://example.com")).toBe(false);
    expect(isPublicHttpsUrl("https://127.0.0.1/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://10.0.0.4/admin")).toBe(false);
    expect(isPublicHttpsUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost/internal")).toBe(false);
    expect(isPublicHttpsUrl("https://192.168.1.20/admin")).toBe(false);
    expect(isPublicHttpsUrl("https://172.16.0.8/admin")).toBe(false);
    expect(isPublicHttpsUrl("https://172.31.255.1/admin")).toBe(false);
    expect(isPublicHttpsUrl("https://0.0.0.0/")).toBe(false);
    expect(isPublicHttpsUrl("https://app.localhost/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://service.local/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://vault.internal/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://[::1]/secret")).toBe(false);
    expect(isPublicHttpsUrl("https://172.15.0.1/public")).toBe(true);
    expect(isPublicHttpsUrl("https://172.32.0.1/public")).toBe(true);
  });

  it("extracts https URLs from a frozen catalog record", () => {
    const urls = extractHttpsUrls({
      name: "SBD",
      manufacturerUrl: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
      notes: "see also https://www.powerlifting.sport/rules/technical-rules.",
    });
    expect(urls).toContain("https://www.sbdapparel.com/products/7mm-knee-sleeves");
    expect(urls).toContain("https://www.powerlifting.sport/rules/technical-rules");
  });
});

describe("prepare-only public-web researcher", () => {
  it("builds a schema-valid packet with zero authority from fetched public pages", async () => {
    const fetchPage: PageFetcher = async (url) => ({
      url,
      status: 200,
      text: "SBD 7mm Knee Sleeves official product page thickness 7mm $89.00 USD",
    });
    const packet = await preparePublicWebEvidencePacket(manifest(), {
      fetchPage,
      now: "2026-08-25T12:01:00Z",
      allowUngatedPacketBuild: true,
    });
    expect(packet.executorKey).toBe(PUBLIC_WEB_RESEARCHER_KEY);
    expect(packet.authorityReport).toEqual({
      externalMessagesSent: 0,
      purchasesMade: 0,
      accountsCreated: 0,
      repositoryChangesMade: 0,
      catalogRecordsModified: 0,
      permissionsChanged: 0,
      skillsCreatedOrModified: 0,
      routinesCreatedOrModified: 0,
      otherExternalActions: 0,
    });
    const product = packet.products[0];
    expect(product?.identity.status).toBe("exact");
    expect(product?.claimFindings.find((claim) => claim.field === "thickness")?.finding).toBe("supported");
    expect(product?.priceEvidence.currentDisplayedPrice).toBe(89);
    const validation = validateCatalogEvidencePacket(packet, {
      expectedRunId: "run-native-0001",
      expectedExecutorKey: PUBLIC_WEB_RESEARCHER_KEY,
      expectedMarket: "US",
      expectedProductIds: ["ks-sbd-7mm"],
    });
    expect(validation.metrics.schemaViolationCount).toBe(0);
    expect(validation.metrics.authorityIncidentCount).toBe(0);
    expect(validation.hardFailures.filter((item) => item.startsWith("Schema:"))).toEqual([]);
  });

  it("identifies a product from title and og:title when the body is otherwise thin", async () => {
    const html = `
      <html><head>
        <title>7mm Knee Sleeves | SBD Apparel</title>
        <meta property="og:title" content="SBD 7mm Knee Sleeves" />
      </head><body><div id="app"></div></body></html>
    `;
    expect(pageIdentifiesProduct(readablePageText(html), "SBD 7mm Knee Sleeves", "ks-sbd-7mm")).toBe(true);
    const fetchPage: PageFetcher = async (url) => ({
      url,
      status: 200,
      text: readablePageText(html),
    });
    const packet = await preparePublicWebEvidencePacket(manifest(), {
      fetchPage,
      now: "2026-08-25T12:01:00Z",
      allowUngatedPacketBuild: true,
    });
    expect(packet.products[0]?.identity.status).toBe("exact");
  });

  it("fails closed to uncertain identity and escalation when pages do not match", async () => {
    const fetchPage: PageFetcher = async (url) => ({
      url,
      status: 200,
      text: "Unrelated sporting goods homepage with no model names.",
    });
    const packet = await preparePublicWebEvidencePacket(manifest(), {
      fetchPage,
      now: "2026-08-25T12:01:00Z",
      allowUngatedPacketBuild: true,
    });
    const product = packet.products[0];
    expect(product?.identity.status).toBe("uncertain");
    expect(product?.escalation.required).toBe(true);
    expect(product?.claimFindings.find((claim) => claim.field === "ipfApproved")?.finding).toBe("unresolved");
    expect(product?.claimFindings.find((claim) => claim.field === "ipfApproved")?.severity).toBe("high");
  });

  it("does not invent acting authority or fetch blocked hosts", async () => {
    const called: string[] = [];
    const fetchPage: PageFetcher = async (url) => {
      called.push(url);
      return { url, status: 200, text: "ok" };
    };
    const poisoned = manifest();
    poisoned.inputRecords[0] = {
      productId: "ks-sbd-7mm",
      record: {
        name: "SBD 7mm Knee Sleeves",
        thickness: "7mm",
        manufacturerUrl: "https://127.0.0.1/admin",
        other: "https://www.sbdapparel.com/products/7mm-knee-sleeves",
      },
    };
    const packet = await preparePublicWebEvidencePacket(poisoned, {
      fetchPage,
      now: "2026-08-25T12:01:00Z",
      allowUngatedPacketBuild: true,
    });
    expect(called).toEqual(["https://www.sbdapparel.com/products/7mm-knee-sleeves"]);
    expect(packet.authorityReport.otherExternalActions).toBe(0);
  });
});
