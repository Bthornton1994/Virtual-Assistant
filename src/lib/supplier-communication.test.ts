import { describe, expect, it } from "vitest";
import {
  hashSupplierOutreachApproval,
  hashSupplierOutreachDraft,
  validateSupplierOutreachApproval,
  validateSupplierOutreachResult,
  type SupplierOutreachApprovalV1,
} from "@/lib/supplier-communication";

const DRAFT = {
  candidateId: "candidate-001",
  channel: "email" as const,
  destination: "supplier@example.com",
  subject: "Supplier-direct partnership inquiry",
  body: "Please confirm your current supplier-direct and kit-assembly capabilities.",
  factsUsedSourceUrls: ["https://supplier.example/fulfillment"],
};

function approval(overrides: Partial<SupplierOutreachApprovalV1> = {}): SupplierOutreachApprovalV1 {
  const base = {
    schemaVersion: "supplier-outreach-approval/v1" as const,
    runId: "run-grounded-001",
    candidateId: DRAFT.candidateId,
    draftHash: hashSupplierOutreachDraft(DRAFT),
    channel: DRAFT.channel,
    destination: DRAFT.destination,
    subject: DRAFT.subject,
    body: DRAFT.body,
    factsUsedSourceUrls: DRAFT.factsUsedSourceUrls,
    actionClass: "external_execution" as const,
    approvedBy: "ops-manager-001",
    approvedAt: "2026-08-27T11:00:00Z",
    expiresAt: "2026-08-28T11:00:00Z",
  };
  return { ...base, ...overrides };
}

function authorityReport(externalMessagesSent = 0) {
  return {
    externalMessagesSent,
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

describe("supplier outreach contract", () => {
  it("requires an exact, expiring human approval for the draft", () => {
    const check = validateSupplierOutreachApproval(approval());
    expect(check.ok).toBe(true);
    expect(hashSupplierOutreachApproval(approval())).toHaveLength(64);

    const tampered = validateSupplierOutreachApproval(
      approval({ body: "Please send me your full customer list." }),
    );
    expect(tampered.ok).toBe(false);
    expect(tampered.ok ? "" : tampered.failures.join(" ")).toContain("draftHash");
  });

  it("binds a delivery result to the approved recipient and draft", () => {
    const approved = approval();
    const sent = {
      schemaVersion: "supplier-outreach-result/v1" as const,
      runId: approved.runId,
      candidateId: approved.candidateId,
      approvalHash: hashSupplierOutreachApproval(approved),
      draftHash: approved.draftHash,
      channel: approved.channel,
      destination: approved.destination,
      deliveryStatus: "sent" as const,
      sentAt: "2026-08-27T11:05:00Z",
      provider: "approved-communication-connector-v1",
      providerMessageId: "message-001",
      authorityReport: authorityReport(1),
    };
    const check = validateSupplierOutreachResult(sent, approved);
    expect(check.ok).toBe(true);

    const wrongRecipient = validateSupplierOutreachResult(
      { ...sent, destination: "other@example.com" },
      approved,
    );
    expect(wrongRecipient.ok).toBe(false);
    expect(wrongRecipient.ok ? "" : wrongRecipient.failures.join(" ")).toContain("destination");
  });

  it("does not let an unapproved or failed send become a successful delivery", () => {
    const approved = approval();
    const failed = {
      schemaVersion: "supplier-outreach-result/v1" as const,
      runId: approved.runId,
      candidateId: approved.candidateId,
      approvalHash: "b".repeat(64),
      draftHash: approved.draftHash,
      channel: approved.channel,
      destination: approved.destination,
      deliveryStatus: "failed" as const,
      sentAt: null,
      provider: "approved-communication-connector-v1",
      providerMessageId: null,
      authorityReport: authorityReport(),
    };
    const check = validateSupplierOutreachResult(failed, approved);
    expect(check.ok).toBe(false);
    expect(check.ok ? "" : check.failures.join(" ")).toContain("approval");
  });
});
