import { describe, expect, it } from "vitest";
import { hashSupplierSourcingInput, hashSupplierSourcingPacket } from "@/lib/supplier-sourcing";
import {
  validateSupplierSourcingInputManifest,
  validateSupplierSourcingPacket,
  validateSupplierSourcingReview,
  type SupplierSourcingInputManifestV1,
  type SupplierSourcingPacketV1,
  type SupplierSourcingReviewV1,
} from "@/lib/supplier-sourcing";

const HASH = "a".repeat(64);
const URL = "https://supplier.example/products/grounded";

function authorityReport(overrides: Record<string, number> = {}) {
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
    ...overrides,
  };
}

function finding(status: "supported" | "contradicted" | "unresolved" = "unresolved") {
  return {
    status,
    basis:
      status === "supported"
        ? "The cited supplier policy states this explicitly."
        : "The source does not establish this fact.",
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
    status: "candidate",
    supplierIdentity: {
      status: "exact",
      tradingName: "Example Supplier",
      legalName: null,
      websiteUrl: "https://supplier.example",
      supplierType: "manufacturer",
      sourceUrls: [URL],
      reason: "The supplier's public site identifies the trading name and product.",
    },
    productFit: {
      status: "exact",
      basis: "The source identifies the requested product identity.",
      sourceUrls: [URL],
    },
    fulfillment: {
      supplierDirect: supported,
      partnerFulfilled: finding(),
      kitAssembly: supported,
      inventoryModel: "supplier-direct",
      shipping: supported,
      returns: supported,
      availability: supported,
      compliance: supported,
      sellerOfRecord: { value: "supplier", evidence: supported },
    },
    commercialTerms: {
      pricing: finding(),
      minimumOrderQuantity: finding(),
      dropshipFees: finding(),
      kitAssemblyFees: finding(),
    },
    publicContactChannels: [{ channel: "web-form", value: URL, sourceUrl: URL }],
    sourceArtifacts: [
      {
        url: URL,
        title: "Example Supplier product and fulfillment policy",
        organization: "Example Supplier",
        sourceType: "manufacturer",
        accessedAt: "2026-08-27T10:05:00Z",
        validUntil: "2099-12-31T23:59:59Z",
        rawArtifactHash: HASH,
        facts: ["Product identity is named.", "Supplier-direct fulfillment is stated."],
      },
    ],
    outreachDraft: {
      status: "draft",
      channel: "web-form",
      destination: URL,
      subject: "Supplier-direct partnership inquiry",
      body: "Please confirm your current supplier-direct and kit-assembly capabilities.",
      factsUsedSourceUrls: [URL],
      sent: false,
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
        reason:
          "The supplier is a candidate, but the proposed relationship and live fulfillment terms require human confirmation.",
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

function failuresOf(result: { ok?: boolean; hardGatePass?: boolean; failures?: string[]; hardFailures?: string[] }) {
  if ("failures" in result && result.failures) return result.failures.join(" ");
  if ("hardFailures" in result && result.hardFailures) return result.hardFailures.join(" ");
  return "";
}

describe("supplier sourcing leftover input gates", () => {
  it("refuses extra keys, padded identifiers, and a non-object brief", () => {
    const extra = validateSupplierSourcingInputManifest({ ...manifest(), autoApproveOutreach: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = validateSupplierSourcingInputManifest({ ...manifest(), runId: " run-grounded-001 " });
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|runId/i);

    for (const bad of [null, undefined, 42, "not json", []]) {
      const result = validateSupplierSourcingInputManifest(bad);
      expect(result.ok, `expected ${JSON.stringify(bad)} to refuse`).toBe(false);
    }
  });

  it("refuses duplicate candidate IDs and a shared prepare/review executor", () => {
    const input = manifest();
    const duplicated = {
      ...input,
      candidates: [input.candidates[0], { ...input.candidates[0] }],
    };
    duplicated.inputHash = hashSupplierSourcingInput(duplicated);
    const duplicate = validateSupplierSourcingInputManifest(duplicated);
    expect(duplicate.ok).toBe(false);
    expect(failuresOf(duplicate)).toMatch(/duplicate candidate/i);

    const shared = {
      ...input,
      reviewExecutorKey: input.prepareExecutorKey,
    };
    shared.inputHash = hashSupplierSourcingInput(shared);
    const sameExecutor = validateSupplierSourcingInputManifest(shared);
    expect(sameExecutor.ok).toBe(false);
    expect(failuresOf(sameExecutor)).toMatch(/must be different/i);
  });
});

describe("supplier sourcing leftover packet gates", () => {
  it("refuses extra keys, padded executor keys, and a forbidden authority action", () => {
    const extra = validateSupplierSourcingPacket({ ...packet(), summaryReport: { ready: true } }, { manifest: manifest() });
    expect(extra.hardGatePass).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);
    expect(extra.metrics.schemaViolationCount).toBeGreaterThan(0);

    const padded = validateSupplierSourcingPacket(
      { ...packet(), executorKey: " grok-grounded-supplier-researcher-v1 " },
      { manifest: manifest() },
    );
    expect(padded.hardGatePass).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|executorKey/i);

    const authority = validateSupplierSourcingPacket(
      packet({ authorityReport: authorityReport({ externalMessagesSent: 1 }) }),
      { manifest: manifest() },
    );
    expect(authority.hardGatePass).toBe(false);
    expect(failuresOf(authority)).toMatch(/forbidden authority/i);
    expect(authority.metrics.authorityIncidentCount).toBe(1);
  });

  it("binds packet identity to the frozen brief and refuses duplicate, extra, or missing candidates", () => {
    const input = manifest();

    const wrongRun = validateSupplierSourcingPacket(packet({ runId: "run-other" }), { manifest: input });
    expect(wrongRun.hardGatePass).toBe(false);
    expect(failuresOf(wrongRun)).toMatch(/runId/i);

    const wrongMarket = validateSupplierSourcingPacket(packet({ market: "UK" }), { manifest: input });
    expect(wrongMarket.hardGatePass).toBe(false);
    expect(failuresOf(wrongMarket)).toMatch(/market/i);

    const wrongExecutor = validateSupplierSourcingPacket(packet(), {
      manifest: input,
      expectedExecutorKey: "someone-else-v1",
    });
    expect(wrongExecutor.hardGatePass).toBe(false);
    expect(failuresOf(wrongExecutor)).toMatch(/prepare executor/i);

    const duplicate = validateSupplierSourcingPacket(
      packet({ candidates: [packet().candidates[0], { ...packet().candidates[0] }] }),
      { manifest: input },
    );
    expect(duplicate.hardGatePass).toBe(false);
    expect(failuresOf(duplicate)).toMatch(/duplicate candidate|candidate count/i);

    const unexpected = validateSupplierSourcingPacket(
      packet({
        candidates: [{ ...packet().candidates[0], candidateId: "candidate-999" }],
      }),
      { manifest: input },
    );
    expect(unexpected.hardGatePass).toBe(false);
    expect(failuresOf(unexpected)).toMatch(/unexpected candidate|missing frozen candidate/i);
  });

  it("refuses remaining frozen-field drift, unbound provenance, and Grounded-as-seller claims", () => {
    const input = manifest();
    const base = packet().candidates[0];

    const productId = validateSupplierSourcingPacket(
      packet({ candidates: [{ ...base, productId: "other-product" }] }),
      { manifest: input },
    );
    expect(productId.hardGatePass).toBe(false);
    expect(failuresOf(productId)).toMatch(/productId/i);

    const brand = validateSupplierSourcingPacket(
      packet({ candidates: [{ ...base, brand: "Another Brand" }] }),
      { manifest: input },
    );
    expect(brand.hardGatePass).toBe(false);
    expect(failuresOf(brand)).toMatch(/brand/i);

    const modes = validateSupplierSourcingPacket(
      packet({ candidates: [{ ...base, desiredFulfillmentModes: ["supplier-direct"] }] }),
      { manifest: input },
    );
    expect(modes.hardGatePass).toBe(false);
    expect(failuresOf(modes)).toMatch(/fulfillment modes/i);

    const unbound = validateSupplierSourcingPacket(
      packet({
        candidates: [
          {
            ...base,
            supplierIdentity: {
              ...base.supplierIdentity,
              sourceUrls: ["https://unrelated.example/page"],
            },
          },
        ],
      }),
      { manifest: input },
    );
    expect(unbound.hardGatePass).toBe(false);
    expect(failuresOf(unbound)).toMatch(/not bound to its own source artifacts/i);

    const noCite = validateSupplierSourcingPacket(
      packet({
        candidates: [
          {
            ...base,
            fulfillment: {
              ...base.fulfillment,
              shipping: { status: "supported", basis: "Claimed without evidence.", sourceUrls: [], sourceArtifactHashes: [] },
            },
          },
        ],
      }),
      { manifest: input },
    );
    expect(noCite.hardGatePass).toBe(false);
    expect(failuresOf(noCite)).toMatch(/cite source URLs and raw artifact hashes/i);

    const grounded = validateSupplierSourcingPacket(
      packet({
        candidates: [
          {
            ...base,
            fulfillment: {
              ...base.fulfillment,
              sellerOfRecord: { value: "grounded", evidence: finding("supported") },
            },
          },
        ],
      }),
      { manifest: input },
    );
    expect(grounded.hardGatePass).toBe(false);
    expect(failuresOf(grounded)).toMatch(/seller of record/i);

    const exactWithoutSource = validateSupplierSourcingPacket(
      packet({
        candidates: [
          {
            ...base,
            supplierIdentity: { ...base.supplierIdentity, sourceUrls: [] },
          },
        ],
      }),
      { manifest: input },
    );
    expect(exactWithoutSource.hardGatePass).toBe(false);
    expect(failuresOf(exactWithoutSource)).toMatch(/exact supplier identity must cite/i);
  });

  it("refuses a malformed URL and an artifact whose validUntil precedes accessedAt", () => {
    const input = manifest();
    const base = packet().candidates[0];

    const markdown = validateSupplierSourcingPacket(
      packet({
        candidates: [
          {
            ...base,
            sourceArtifacts: [{ ...base.sourceArtifacts[0], url: `[SBD](${URL})` }],
            supplierIdentity: { ...base.supplierIdentity, sourceUrls: [`[SBD](${URL})`] },
            productFit: { ...base.productFit, sourceUrls: [`[SBD](${URL})`] },
            publicContactChannels: [{ channel: "web-form", value: URL, sourceUrl: `[SBD](${URL})` }],
            outreachDraft: { ...base.outreachDraft, factsUsedSourceUrls: [`[SBD](${URL})`] },
            fulfillment: {
              ...base.fulfillment,
              supplierDirect: { ...finding("supported"), sourceUrls: [`[SBD](${URL})`] },
            },
          },
        ],
      }),
      { manifest: input },
    );
    expect(markdown.hardGatePass).toBe(false);
    expect(markdown.metrics.malformedUrlCount).toBeGreaterThan(0);

    const inverted = validateSupplierSourcingPacket(
      packet({
        candidates: [
          {
            ...base,
            sourceArtifacts: [
              {
                ...base.sourceArtifacts[0],
                accessedAt: "2026-08-27T10:05:00Z",
                validUntil: "2026-08-27T10:00:00Z",
              },
            ],
          },
        ],
      }),
      { manifest: input, evaluatedAt: "2026-08-27T10:10:00Z" },
    );
    expect(inverted.hardGatePass).toBe(false);
    expect(failuresOf(inverted)).toMatch(/validUntil precedes accessedAt/i);
  });
});

describe("supplier sourcing leftover review gates", () => {
  it("refuses extra keys, padded reviewer keys, and a review authority incident", () => {
    const packetValue = packet();
    const input = manifest();
    const packetHash = hashSupplierSourcingPacket(packetValue);

    const extra = validateSupplierSourcingReview(
      { ...review(packetValue), autoAccept: true },
      { manifest: input, packetHash, expectedReviewerKey: input.reviewExecutorKey },
    );
    expect(extra.hardGatePass).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = validateSupplierSourcingReview(
      { ...review(packetValue), reviewerExecutorKey: " grok-grounded-supplier-reviewer-v1 " },
      { manifest: input, packetHash, expectedReviewerKey: input.reviewExecutorKey },
    );
    expect(padded.hardGatePass).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|reviewerExecutorKey/i);

    const authority = validateSupplierSourcingReview(
      { ...review(packetValue), authorityReport: authorityReport({ purchasesMade: 1 }) },
      { manifest: input, packetHash, expectedReviewerKey: input.reviewExecutorKey },
    );
    expect(authority.hardGatePass).toBe(false);
    expect(failuresOf(authority)).toMatch(/forbidden authority/i);
  });

  it("binds reviewer identity and refuses duplicate, extra, missing, or malformed candidate reviews", () => {
    const packetValue = packet();
    const input = manifest();
    const packetHash = hashSupplierSourcingPacket(packetValue);
    const base = review(packetValue);

    const wrongReviewer = validateSupplierSourcingReview(base, {
      manifest: input,
      packetHash,
      expectedReviewerKey: "someone-else-v1",
    });
    expect(wrongReviewer.hardGatePass).toBe(false);
    expect(failuresOf(wrongReviewer)).toMatch(/frozen reviewer/i);

    const duplicate = validateSupplierSourcingReview(
      { ...base, candidateReviews: [base.candidateReviews[0], { ...base.candidateReviews[0] }] },
      { manifest: input, packetHash, expectedReviewerKey: input.reviewExecutorKey },
    );
    expect(duplicate.hardGatePass).toBe(false);
    expect(failuresOf(duplicate)).toMatch(/duplicate candidate review/i);

    const unexpected = validateSupplierSourcingReview(
      {
        ...base,
        candidateReviews: [{ ...base.candidateReviews[0], candidateId: "candidate-999" }],
      },
      { manifest: input, packetHash, expectedReviewerKey: input.reviewExecutorKey },
    );
    expect(unexpected.hardGatePass).toBe(false);
    expect(failuresOf(unexpected)).toMatch(/unexpected candidate|missing candidate/i);

    const malformed = validateSupplierSourcingReview(
      {
        ...base,
        candidateReviews: [
          { ...base.candidateReviews[0], independentSourceUrls: ["http://insecure.example/x"] },
        ],
      },
      { manifest: input, packetHash, expectedReviewerKey: input.reviewExecutorKey },
    );
    expect(malformed.hardGatePass).toBe(false);
    expect(failuresOf(malformed)).toMatch(/non-public HTTPS URL/i);
  });
});
