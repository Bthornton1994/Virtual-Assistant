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

function authorityReport(externalMessagesSent = 0, extra: Record<string, number> = {}) {
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
    ...extra,
  };
}

function sentResult(approved: SupplierOutreachApprovalV1, overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "supplier-outreach-result/v1",
    runId: approved.runId,
    candidateId: approved.candidateId,
    approvalHash: hashSupplierOutreachApproval(approved),
    draftHash: approved.draftHash,
    channel: approved.channel,
    destination: approved.destination,
    deliveryStatus: "sent",
    sentAt: "2026-08-27T11:05:00Z",
    provider: "approved-communication-connector-v1",
    senderIdentity: "grounded-ops@example.com",
    providerMessageId: "message-001",
    authorityReport: authorityReport(1),
    ...overrides,
  };
}

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("supplier outreach leftover approval gates", () => {
  it("refuses extra keys, padded identifiers, inverted expiry, and a non-outreach channel", () => {
    expect(validateSupplierOutreachApproval(approval()).ok).toBe(true);

    const extra = validateSupplierOutreachApproval({ ...approval(), autoSend: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const paddedRun = validateSupplierOutreachApproval(approval({ runId: " run-grounded-001 " }));
    expect(paddedRun.ok).toBe(false);
    expect(failuresOf(paddedRun)).toMatch(/whitespace|runId/i);

    const paddedApprover = validateSupplierOutreachApproval(approval({ approvedBy: " ops-manager-001 " }));
    expect(paddedApprover.ok).toBe(false);
    expect(failuresOf(paddedApprover)).toMatch(/whitespace|approvedBy/i);

    const inverted = validateSupplierOutreachApproval(
      approval({ approvedAt: "2026-08-28T11:00:00Z", expiresAt: "2026-08-27T11:00:00Z" }),
    );
    expect(inverted.ok).toBe(false);
    expect(failuresOf(inverted)).toMatch(/expires before it was approved/i);

    const phone = validateSupplierOutreachApproval({
      ...approval(),
      channel: "phone",
    } as unknown as SupplierOutreachApprovalV1);
    expect(phone.ok).toBe(false);
    expect(failuresOf(phone)).toMatch(/channel/i);

    const wrongClass = validateSupplierOutreachApproval({
      ...approval(),
      actionClass: "prepare_only",
    } as unknown as SupplierOutreachApprovalV1);
    expect(wrongClass.ok).toBe(false);
    expect(failuresOf(wrongClass)).toMatch(/actionClass|external_execution/i);
  });

  it("refuses a non-object, a wrong schema, and extra keys on the authority report of a result", () => {
    for (const bad of [null, undefined, 42, "not json", []]) {
      const result = validateSupplierOutreachApproval(bad);
      expect(result.ok, `expected ${JSON.stringify(bad)} to refuse`).toBe(false);
    }

    const wrongSchema = validateSupplierOutreachApproval({
      ...approval(),
      schemaVersion: "supplier-outreach-approval/v0",
    } as unknown as SupplierOutreachApprovalV1);
    expect(wrongSchema.ok).toBe(false);
    expect(failuresOf(wrongSchema)).toMatch(/schemaVersion/i);
  });
});

describe("supplier outreach leftover result gates", () => {
  it("refuses extra keys, padded provider identity, and a send before approval", () => {
    const approved = approval();

    const extra = validateSupplierOutreachResult({ ...sentResult(approved), bypassExpiry: true }, approved);
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = validateSupplierOutreachResult(
      sentResult(approved, { provider: " approved-communication-connector-v1 " }),
      approved,
    );
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|provider/i);

    const early = validateSupplierOutreachResult(
      sentResult(approved, { sentAt: "2026-08-27T10:59:00Z" }),
      approved,
    );
    expect(early.ok).toBe(false);
    expect(failuresOf(early)).toMatch(/precedes the human approval/i);
  });

  it("binds run, candidate, draft, and channel to the exact approval", () => {
    const approved = approval();

    const wrongRun = validateSupplierOutreachResult(sentResult(approved, { runId: "run-other" }), approved);
    expect(wrongRun.ok).toBe(false);
    expect(failuresOf(wrongRun)).toMatch(/runId/i);

    const wrongCandidate = validateSupplierOutreachResult(
      sentResult(approved, { candidateId: "candidate-999" }),
      approved,
    );
    expect(wrongCandidate.ok).toBe(false);
    expect(failuresOf(wrongCandidate)).toMatch(/candidateId/i);

    const wrongDraft = validateSupplierOutreachResult(
      sentResult(approved, { draftHash: "b".repeat(64) }),
      approved,
    );
    expect(wrongDraft.ok).toBe(false);
    expect(failuresOf(wrongDraft)).toMatch(/draftHash/i);

    const wrongChannel = validateSupplierOutreachResult(
      sentResult(approved, {
        channel: "web-form",
        destination: approved.destination,
        draftHash: hashSupplierOutreachDraft({ ...DRAFT, channel: "web-form" }),
      }),
      approved,
    );
    expect(wrongChannel.ok).toBe(false);
    expect(failuresOf(wrongChannel)).toMatch(/channel/i);
  });

  it("refuses a failed send that claims sentAt, an unknown send that claims authority, and a sent result that does not record exactly one message", () => {
    const approved = approval();

    const failedWithSentAt = validateSupplierOutreachResult(
      sentResult(approved, {
        deliveryStatus: "failed",
        sentAt: "2026-08-27T11:05:00Z",
        providerMessageId: null,
        authorityReport: authorityReport(0),
      }),
      approved,
    );
    expect(failedWithSentAt.ok).toBe(false);
    expect(failuresOf(failedWithSentAt)).toMatch(/cannot claim a sentAt/i);

    const unknownAuthority = validateSupplierOutreachResult(
      sentResult(approved, {
        deliveryStatus: "unknown",
        sentAt: null,
        providerMessageId: null,
        authorityReport: authorityReport(1),
      }),
      approved,
    );
    expect(unknownAuthority.ok).toBe(false);
    expect(failuresOf(unknownAuthority)).toMatch(/cannot claim any completed authority/i);

    const zeroMessages = validateSupplierOutreachResult(
      sentResult(approved, { authorityReport: authorityReport(0) }),
      approved,
    );
    expect(zeroMessages.ok).toBe(false);
    expect(failuresOf(zeroMessages)).toMatch(/exactly one external message/i);

    const twoMessages = validateSupplierOutreachResult(
      sentResult(approved, { authorityReport: authorityReport(2) }),
      approved,
    );
    expect(twoMessages.ok).toBe(false);
    expect(failuresOf(twoMessages)).toMatch(/exactly one external message/i);

    const extraAuthority = validateSupplierOutreachResult(
      sentResult(approved, { authorityReport: authorityReport(1, { accountsCreated: 1 }) }),
      approved,
    );
    expect(extraAuthority.ok).toBe(false);
    expect(failuresOf(extraAuthority)).toMatch(/no other authority event/i);
  });
});
