import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashSupplierSourcingInput,
  buildGrokSupplierSourcingPrompt,
  hashSupplierSourcingPacket,
  validateSupplierSourcingInputManifest,
  validateSupplierSourcingPacket,
  validateSupplierSourcingReview,
  type SupplierSourcingInputManifestV1,
  type SupplierSourcingPacketV1,
  type SupplierSourcingReviewV1,
} from "@/lib/supplier-sourcing";

const HASH = "a".repeat(64);
const URL = "https://supplier.example/products/grounded";

function authorityReport() {
  return {
    externalMessagesSent: 0,
    purchasesMade: 0,
    accountsCreated: 0,
    repositoryChangesMade: 0,
    catalogRecordsModified: 0,
    permissionsChanged: 0,
    skillsCreatedOrModified: 0,
    routinesCreatedOrModified: 0,
    otherExternalActions: 0,
  };
}

function finding(status: "supported" | "contradicted" | "unresolved" = "unresolved") {
  return {
    status,
    basis: status === "supported" ? "The cited supplier policy states this explicitly." : "The source does not establish this fact.",
    sourceUrls: status === "supported" ? [URL] : [],
    sourceArtifactHashes: status === "supported" ? [HASH] : [],
  };
}

function manifest(): SupplierSourcingInputManifestV1 {
  type InputHashSource = Pick<
    SupplierSourcingInputManifestV1,
    | "runId"
    | "objective"
    | "market"
    | "catalogRepository"
    | "catalogRepositorySha"
    | "candidates"
    | "prepareExecutorKey"
    | "reviewExecutorKey"
  >;
  const base: InputHashSource = {
    runId: "run-grounded-001",
    objective: "Find supplier-direct or partner-fulfilled options for Grounded kits.",
    market: "US",
    catalogRepository: "Bthornton1994/Grounded",
    catalogRepositorySha: "d9198744a7b4c9243ea05151f1f7daadc74bb85a",
    candidates: [
      {
        candidateId: "candidate-001",
        productId: "calm-cloud-rice",
        productName: "Calm Cloud Rice",
        brand: "Grounded Curated",
        modelOrVariant: "standard",
        category: "calming",
        desiredFulfillmentModes: ["supplier-direct", "partner-fulfilled"],
        kitAssemblyRequired: true,
        knownSourceUrls: [],
        constraints: ["No owned inventory.", "No unsupported safety or compliance claims."],
      },
    ],
    prepareExecutorKey: "grok-grounded-supplier-researcher-v1",
    reviewExecutorKey: "grok-grounded-supplier-reviewer-v1",
  };
  return {
    schemaVersion: "supplier-sourcing-input/v1",
    ...base,
    createdAt: "2026-08-27T10:00:00Z",
    inputHash: hashSupplierSourcingInput(base),
  };
}

function packet(overrides: Partial<SupplierSourcingPacketV1> = {}): SupplierSourcingPacketV1 {
  const input = manifest();
  const supported = finding("supported");
  const candidate: SupplierSourcingPacketV1["candidates"][number] = {
    candidateId: "candidate-001",
    productId: "calm-cloud-rice",
    productName: "Calm Cloud Rice",
    brand: "Grounded Curated",
    modelOrVariant: "standard",
    category: "calming",
    desiredFulfillmentModes: ["supplier-direct", "partner-fulfilled"],
    kitAssemblyRequired: true,
    status: "candidate" as const,
    supplierIdentity: {
      status: "exact" as const,
      tradingName: "Example Supplier",
      legalName: null,
      websiteUrl: "https://supplier.example",
      supplierType: "manufacturer" as const,
      sourceUrls: [URL],
      reason: "The supplier's public site identifies the trading name and product.",
    },
    productFit: {
      status: "exact" as const,
      basis: "The source identifies the requested product identity.",
      sourceUrls: [URL],
    },
    fulfillment: {
      supplierDirect: supported,
      partnerFulfilled: finding(),
      kitAssembly: supported,
      inventoryModel: "supplier-direct" as const,
      shipping: supported,
      returns: supported,
      availability: supported,
      compliance: supported,
      sellerOfRecord: { value: "supplier" as const, evidence: supported },
    },
    commercialTerms: {
      pricing: finding(),
      minimumOrderQuantity: finding(),
      dropshipFees: finding(),
      kitAssemblyFees: finding(),
    },
    publicContactChannels: [
      { channel: "web-form" as const, value: URL, sourceUrl: URL },
    ],
    sourceArtifacts: [
      {
        url: URL,
        title: "Example Supplier product and fulfillment policy",
        organization: "Example Supplier",
        sourceType: "manufacturer" as const,
        accessedAt: "2026-08-27T10:05:00Z",
        validUntil: "2099-12-31T23:59:59Z",
        rawArtifactHash: HASH,
        facts: ["Product identity is named.", "Supplier-direct fulfillment is stated."],
      },
    ],
    outreachDraft: {
      status: "draft" as const,
      channel: "web-form" as const,
      destination: URL,
      subject: "Supplier-direct partnership inquiry",
      body: "Please confirm your current supplier-direct and kit-assembly capabilities.",
      factsUsedSourceUrls: [URL],
      sent: false as const,
      sentAt: null,
    },
    escalation: { required: false, reason: "" },
  };
  return {
    schemaVersion: "supplier-sourcing-packet/v1",
    runId: input.runId,
    inputHash: input.inputHash,
    executorKey: input.prepareExecutorKey,
    generatedAt: "2026-08-27T10:10:00Z",
    market: input.market,
    candidates: [candidate],
    authorityReport: authorityReport(),
    ...overrides,
  };
}

function review(packetValue: SupplierSourcingPacketV1): SupplierSourcingReviewV1 {
  return {
    schemaVersion: "supplier-sourcing-review/v1",
    runId: packetValue.runId,
    evidencePacketHash: hashSupplierSourcingPacket(packetValue),
    reviewerExecutorKey: "grok-grounded-supplier-reviewer-v1",
    reviewedAt: "2026-08-27T10:20:00Z",
    candidateReviews: [
      {
        candidateId: "candidate-001",
        verdict: "inconclusive",
        reason: "The supplier is a candidate, but the proposed relationship and live fulfillment terms require human confirmation.",
        independentSourceUrls: [URL],
        evidenceGaps: ["No supplier communication has been approved or sent."],
        severity: "high",
      },
    ],
    communicationDisposition: "needs-human-approval",
    escalationRequired: true,
    escalationReason: "Human approval is required before any supplier outreach.",
    authorityReport: authorityReport(),
  };
}

describe("supplier sourcing contract", () => {
  it("freezes the brief and accepts a source-backed draft-only packet", () => {
    const input = manifest();
    const inputCheck = validateSupplierSourcingInputManifest(input);
    expect(inputCheck.ok).toBe(true);

    const packetValue = packet();
    const packetCheck = validateSupplierSourcingPacket(packetValue, {
      manifest: input,
      expectedExecutorKey: input.prepareExecutorKey,
    });
    expect(packetCheck.hardGatePass).toBe(true);
    expect(packetCheck.metrics).toMatchObject({
      candidateCount: 1,
      exactSupplierCount: 1,
      supplierDirectSupportedCount: 1,
      kitAssemblySupportedCount: 1,
      outreachDraftCount: 1,
      authorityIncidentCount: 0,
    });

    const reviewCheck = validateSupplierSourcingReview(review(packetValue), {
      manifest: input,
      packetHash: hashSupplierSourcingPacket(packetValue),
      expectedReviewerKey: input.reviewExecutorKey,
    });
    expect(reviewCheck.hardGatePass).toBe(true);
  });

  it("rejects owned inventory and any attempted sent-message claim", () => {
    const input = manifest();
    const owned = packet({
      candidates: [
        {
          ...packet().candidates[0],
          fulfillment: {
            ...packet().candidates[0].fulfillment,
            inventoryModel: "owned-inventory",
          },
        },
      ],
    });
    const ownedCheck = validateSupplierSourcingPacket(owned, { manifest: input });
    expect(ownedCheck.hardGatePass).toBe(false);
    expect(ownedCheck.hardFailures.join(" ")).toContain("owned inventory");

    const sent = packet({
      candidates: [
        {
          ...packet().candidates[0],
          outreachDraft: {
            ...packet().candidates[0].outreachDraft,
            sent: true as never,
          },
        },
      ],
    });
    const sentCheck = validateSupplierSourcingPacket(sent, { manifest: input });
    expect(sentCheck.hardGatePass).toBe(false);
    expect(sentCheck.hardFailures.join(" ")).toContain("outreachDraft.sent");
  });

  it("rejects packet scope drift and review binding drift", () => {
    const input = manifest();
    const drifted = packet({ inputHash: "b".repeat(64) });
    const packetCheck = validateSupplierSourcingPacket(drifted, { manifest: input });
    expect(packetCheck.hardGatePass).toBe(false);
    expect(packetCheck.hardFailures.join(" ")).toContain("inputHash");

    const reviewCheck = validateSupplierSourcingReview(review(packet()), {
      manifest: input,
      packetHash: "c".repeat(64),
      expectedReviewerKey: input.reviewExecutorKey,
    });
    expect(reviewCheck.hardGatePass).toBe(false);
    expect(reviewCheck.hardFailures.join(" ")).toContain("exact supplier packet hash");
  });

  it("rejects candidate identity drift and stale current availability evidence", () => {
    const input = manifest();
    const identityDrift = packet({
      candidates: [{ ...packet().candidates[0], productName: "Different product" }],
    });
    const identityCheck = validateSupplierSourcingPacket(identityDrift, { manifest: input });
    expect(identityCheck.hardGatePass).toBe(false);
    expect(identityCheck.hardFailures.join(" ")).toContain("productName");

    const stale = packet({
      candidates: [
        {
          ...packet().candidates[0],
          sourceArtifacts: [
            {
              ...packet().candidates[0].sourceArtifacts[0],
              validUntil: "2020-01-01T00:00:00Z",
            },
          ],
        },
      ],
    });
    const staleCheck = validateSupplierSourcingPacket(stale, { manifest: input });
    expect(staleCheck.hardGatePass).toBe(false);
    expect(staleCheck.hardFailures.join(" ")).toContain("expired");
  });

  it("requires independent citations for an accepted candidate review", () => {
    const packetValue = packet();
    const accepted = review(packetValue);
    accepted.candidateReviews[0] = {
      ...accepted.candidateReviews[0],
      verdict: "accept",
      independentSourceUrls: [],
    };
    const check = validateSupplierSourcingReview(accepted, {
      manifest: manifest(),
      packetHash: hashSupplierSourcingPacket(packetValue),
      expectedReviewerKey: manifest().reviewExecutorKey,
    });
    expect(check.hardGatePass).toBe(false);
    expect(check.hardFailures.join(" ")).toContain("independent source");
  });

  it("hashes the same frozen artifact deterministically", () => {
    const input = manifest();
    expect(hashSupplierSourcingInput(input)).toBe(input.inputHash);
    expect(hashSupplierSourcingPacket(packet())).toBe(hashSupplierSourcingPacket(packet()));
  });

  it("builds a prompt bound to the frozen brief and draft-only authority", () => {
    const input = manifest();
    const prompt = buildGrokSupplierSourcingPrompt(input);
    expect(prompt).toContain(input.runId);
    expect(prompt).toContain(input.inputHash);
    expect(prompt).toContain("must not send or schedule a message");
    expect(prompt).toContain("supplier-sourcing-packet/v1");
  });

  it("does not compute approval expiry from Date.now during render", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/supplier-sourcing.tsx"), "utf8");
    expect(source).not.toMatch(/Date\.now\s*\(/);
  });
});
