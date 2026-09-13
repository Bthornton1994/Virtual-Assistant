import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION,
  SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
  hashSupplierSourcingInput,
  hashSupplierSourcingPacket,
  type SupplierSourcingPacketV1,
  type SupplierSourcingValidationV1,
} from "@/lib/supplier-sourcing";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import {
  createSupplierOutreachApproval,
  listSupplierOutreachApprovals,
  supplierOutreachApprovalPolicy,
} from "@/lib/supplier-outreach-approval";

const RUN_ID = "run-grounded-001";
const ORG_ID = "org-grounded-001";
const URL = "https://supplier.example/products/grounded";
const HASH = "a".repeat(64);

const manager: Actor = {
  id: "ops-manager-001",
  email: "manager@delegation.cloud",
  name: "Manager",
  role: "ops_manager",
  organizationId: ORG_ID,
  operatorId: "op_mgr",
  source: "supabase",
};

const operator: Actor = {
  ...manager,
  id: "op-001",
  email: "op@delegation.cloud",
  role: "operator",
};

const demoManager: Actor = {
  ...manager,
  source: "demo",
};

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

function finding(status: "supported" | "contradicted" | "unresolved" = "supported") {
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

function packet(overrides: Partial<SupplierSourcingPacketV1> = {}): SupplierSourcingPacketV1 {
  const inputHash = hashSupplierSourcingInput({
    runId: RUN_ID,
    objective: "Find supplier-direct options.",
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
        constraints: ["No owned inventory."],
      },
    ],
    prepareExecutorKey: "grok-grounded-supplier-researcher-v1",
    reviewExecutorKey: "grok-grounded-supplier-reviewer-v1",
  });
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
      supplierDirect: finding("supported"),
      partnerFulfilled: finding("unresolved"),
      kitAssembly: finding("supported"),
      inventoryModel: "supplier-direct",
      shipping: finding("supported"),
      returns: finding("supported"),
      availability: finding("supported"),
      compliance: finding("supported"),
      sellerOfRecord: { value: "supplier", evidence: finding("supported") },
    },
    commercialTerms: {
      pricing: finding("unresolved"),
      minimumOrderQuantity: finding("unresolved"),
      dropshipFees: finding("unresolved"),
      kitAssemblyFees: finding("unresolved"),
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
    schemaVersion: SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION,
    runId: RUN_ID,
    inputHash,
    executorKey: "grok-grounded-supplier-researcher-v1",
    generatedAt: "2026-08-27T10:10:00Z",
    market: "US",
    candidates: [candidate],
    authorityReport: authorityReport(),
    ...overrides,
  };
}

function passingValidation(packetValue: SupplierSourcingPacketV1): SupplierSourcingValidationV1 {
  return {
    schemaVersion: SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION,
    runId: packetValue.runId,
    validatedAt: "2026-08-27T10:30:00Z",
    inputHash: packetValue.inputHash,
    packetHash: hashSupplierSourcingPacket(packetValue),
    reviewHash: HASH,
    packet: {
      hardGatePass: true,
      hardFailures: [],
      warnings: [],
      metrics: {
        candidateCount: 1,
        exactSupplierCount: 1,
        supplierDirectSupportedCount: 1,
        partnerFulfilledSupportedCount: 0,
        kitAssemblySupportedCount: 1,
        unresolvedCandidateCount: 0,
        disqualifiedCandidateCount: 0,
        sourceArtifactCount: 1,
        outreachDraftCount: 1,
        authorityIncidentCount: 0,
        malformedUrlCount: 0,
        schemaViolationCount: 0,
      },
    },
    review: { hardGatePass: true, hardFailures: [], warnings: [] },
    hardGatePass: true,
    hardFailures: [],
    warnings: [],
    authorityReport: authorityReport(),
  };
}

function artifact(payload: Record<string, unknown>, contentHash = sha256Hex(payload)) {
  return { id: `artifact-${payload.schemaVersion}`, content_hash: contentHash, payload };
}

function thenable<T>(result: T) {
  const chain: {
    select: () => typeof chain;
    eq: (column: string, value: string) => typeof chain;
    order: () => typeof chain;
    limit: () => typeof chain;
    insert: () => typeof chain;
    maybeSingle: () => Promise<T>;
    then: Promise<T>["then"];
  } = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: () => chain,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function mockDb(options: {
  runStatus?: string;
  receipt?: { verification_status: string; definition_of_done_met: boolean } | null;
  packet?: SupplierSourcingPacketV1 | null;
  packetHash?: string;
  validation?: SupplierSourcingValidationV1 | null;
  validationHash?: string;
  insertError?: { message: string } | null;
}) {
  const packetValue = options.packet === undefined ? packet() : options.packet;
  const validationValue =
    options.validation === undefined
      ? packetValue
        ? passingValidation(packetValue)
        : null
      : options.validation;
  return {
    from(table: string) {
      if (table === "workstream_runs") {
        return thenable({
          data: { id: RUN_ID, organization_id: ORG_ID, status: options.runStatus ?? "verified" },
          error: null,
        });
      }
      if (table === "outcome_receipts") {
        return thenable({
          data:
            options.receipt === undefined
              ? { verification_status: "passed", definition_of_done_met: true }
              : options.receipt,
          error: null,
        });
      }
      let schema = "";
      let inserting = false;
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => {
          if (column === "payload->>schemaVersion") schema = value;
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        insert: () => {
          inserting = true;
          return chain;
        },
        maybeSingle: async () => {
          if (schema === SUPPLIER_SOURCING_PACKET_SCHEMA_VERSION) {
            if (!packetValue) return { data: null, error: null };
            return {
              data: artifact(packetValue, options.packetHash ?? sha256Hex(packetValue)),
              error: null,
            };
          }
          if (schema === SUPPLIER_SOURCING_VALIDATION_SCHEMA_VERSION) {
            if (!validationValue) return { data: null, error: null };
            return {
              data: artifact(validationValue, options.validationHash ?? sha256Hex(validationValue)),
              error: null,
            };
          }
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(
            inserting ? { data: null, error: options.insertError ?? null } : { data: [], error: null },
          ).then(resolve, reject),
      };
      return chain;
    },
  };
}

function approvalInput(overrides: Partial<Parameters<typeof createSupplierOutreachApproval>[2]> = {}) {
  return {
    candidateId: "candidate-001",
    channel: "web-form" as const,
    destination: URL,
    subject: "Supplier-direct partnership inquiry",
    body: "Please confirm your current supplier-direct and kit-assembly capabilities.",
    factsUsedSourceUrls: [URL],
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("supplier outreach approval gates", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
  });

  it("does not authorize operators or demo actors to approve or list outreach", async () => {
    await expect(createSupplierOutreachApproval(operator, RUN_ID, approvalInput())).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(listSupplierOutreachApprovals(operator, RUN_ID)).rejects.toBeInstanceOf(AuthzError);
    await expect(createSupplierOutreachApproval(demoManager, RUN_ID, approvalInput())).rejects.toThrow(
      /requires persistent Supabase/,
    );
    expect(supabaseServer).not.toHaveBeenCalled();
    expect(supplierOutreachApprovalPolicy.sendsMessage).toBe(false);
    expect(supplierOutreachApprovalPolicy.qualifiedDeliveryConnectorAvailable).toBe(false);
  });

  it("requires a verified run and a passing Outcome Receipt", async () => {
    supabaseServer.mockResolvedValue(mockDb({ runStatus: "running" }));
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /requires a verified sourcing run/,
    );

    supabaseServer.mockResolvedValue(
      mockDb({ receipt: { verification_status: "passed", definition_of_done_met: false } }),
    );
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /passing Outcome Receipt/,
    );
  });

  it("blocks outreach when the packet hash is tampered or the hard gate failed", async () => {
    supabaseServer.mockResolvedValue(mockDb({ packetHash: "b".repeat(64) }));
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /does not match the hash recomputed/,
    );

    const packetValue = packet();
    supabaseServer.mockResolvedValue(
      mockDb({
        packet: packetValue,
        validation: { ...passingValidation(packetValue), hardGatePass: false, hardFailures: ["identity"] },
      }),
    );
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /hard gate is failing/,
    );
  });

  it("requires exact identity, exact fit, fulfillment evidence, and a prepared draft", async () => {
    const inexact = packet();
    inexact.candidates[0] = {
      ...inexact.candidates[0],
      supplierIdentity: { ...inexact.candidates[0].supplierIdentity, status: "partial" },
    };
    supabaseServer.mockResolvedValue(mockDb({ packet: inexact }));
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /exact supplier identity and exact product fit/,
    );

    const noFulfillment = packet();
    noFulfillment.candidates[0] = {
      ...noFulfillment.candidates[0],
      fulfillment: {
        ...noFulfillment.candidates[0].fulfillment,
        supplierDirect: finding("unresolved"),
        partnerFulfilled: finding("unresolved"),
      },
    };
    supabaseServer.mockResolvedValue(mockDb({ packet: noFulfillment }));
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /supplier-direct or partner-fulfilled/,
    );

    const noDraft = packet();
    noDraft.candidates[0] = {
      ...noDraft.candidates[0],
      outreachDraft: {
        status: "not-prepared",
        channel: null,
        destination: null,
        subject: null,
        body: null,
        factsUsedSourceUrls: [],
        sent: false,
        sentAt: null,
      },
    };
    supabaseServer.mockResolvedValue(mockDb({ packet: noDraft }));
    await expect(createSupplierOutreachApproval(manager, RUN_ID, approvalInput())).rejects.toThrow(
      /no prepared outreach draft/,
    );
  });

  it("binds destination, expiry, and cited HTTPS facts to the frozen packet", async () => {
    supabaseServer.mockResolvedValue(mockDb({}));
    await expect(
      createSupplierOutreachApproval(manager, RUN_ID, approvalInput({ destination: "https://other.example/form" })),
    ).rejects.toThrow(/exactly match a public contact channel/);
    await expect(
      createSupplierOutreachApproval(manager, RUN_ID, approvalInput({ expiresAt: "2020-01-01T00:00:00.000Z" })),
    ).rejects.toThrow(/must expire in the future/);
    await expect(
      createSupplierOutreachApproval(manager, RUN_ID, approvalInput({ factsUsedSourceUrls: [] })),
    ).rejects.toThrow(/must cite the facts used/);
    await expect(
      createSupplierOutreachApproval(
        manager,
        RUN_ID,
        approvalInput({ factsUsedSourceUrls: ["http://supplier.example/insecure"] }),
      ),
    ).rejects.toThrow(/plain public HTTPS URLs/);
    await expect(
      createSupplierOutreachApproval(
        manager,
        RUN_ID,
        approvalInput({ factsUsedSourceUrls: ["https://unrelated.example/page"] }),
      ),
    ).rejects.toThrow(/not bound to the reviewed candidate packet/);
  });

  it("records a typed approval without transmitting a message", async () => {
    supabaseServer.mockResolvedValue(mockDb({}));
    const approved = await createSupplierOutreachApproval(manager, RUN_ID, approvalInput());
    expect(approved.actionClass).toBe("external_execution");
    expect(approved.approvedBy).toBe(manager.id);
    expect(approved.destination).toBe(URL);
    expect(approved.factsUsedSourceUrls).toEqual([URL]);
    expect(supplierOutreachApprovalPolicy.sendsMessage).toBe(false);
  });
});
