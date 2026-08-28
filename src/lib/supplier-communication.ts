import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { sha256HexSchema } from "@/lib/catalog-evidence-review";
import {
  authorityReportSchema,
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
  urlFieldSchema,
  sumAuthorityReport,
  type AuthorityReport,
} from "@/lib/catalog-evidence-shared";

export const SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION = "supplier-outreach-approval/v1" as const;
export const SUPPLIER_OUTREACH_RESULT_SCHEMA_VERSION = "supplier-outreach-result/v1" as const;

export const SUPPLIER_OUTREACH_CHANNELS = ["email", "web-form", "other"] as const;
export const SUPPLIER_OUTREACH_DELIVERY_STATUSES = ["sent", "failed", "unknown"] as const;

const zeroAuthorityReport: AuthorityReport = {
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

export const supplierOutreachApprovalV1Schema = z
  .object({
    schemaVersion: z.literal(SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION),
    runId: identifierString,
    candidateId: identifierString,
    draftHash: sha256HexSchema,
    channel: z.enum(SUPPLIER_OUTREACH_CHANNELS),
    destination: nonEmptyString,
    subject: nonEmptyString,
    body: nonEmptyString,
    factsUsedSourceUrls: z.array(urlFieldSchema).min(1),
    actionClass: z.literal("external_execution"),
    approvedBy: identifierString,
    approvedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((approval, context) => {
    if (Date.parse(approval.expiresAt) < Date.parse(approval.approvedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Outreach approval expires before it was approved.",
      });
    }
    if (hashSupplierOutreachDraft({
      candidateId: approval.candidateId,
      channel: approval.channel,
      destination: approval.destination,
      subject: approval.subject,
      body: approval.body,
      factsUsedSourceUrls: approval.factsUsedSourceUrls,
    }) !== approval.draftHash) {
      context.addIssue({
        code: "custom",
        path: ["draftHash"],
        message: "Outreach approval draftHash does not match the exact approved recipient and message.",
      });
    }
  });

export type SupplierOutreachApprovalV1 = z.infer<typeof supplierOutreachApprovalV1Schema>;

export const supplierOutreachResultV1Schema = z
  .object({
    schemaVersion: z.literal(SUPPLIER_OUTREACH_RESULT_SCHEMA_VERSION),
    runId: identifierString,
    candidateId: identifierString,
    approvalHash: sha256HexSchema,
    draftHash: sha256HexSchema,
    channel: z.enum(SUPPLIER_OUTREACH_CHANNELS),
    destination: nonEmptyString,
    deliveryStatus: z.enum(SUPPLIER_OUTREACH_DELIVERY_STATUSES),
    sentAt: isoDateTimeSchema.nullable(),
    provider: identifierString,
    senderIdentity: nonEmptyString,
    providerMessageId: nonEmptyString.nullable(),
    authorityReport: authorityReportSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.deliveryStatus === "sent" && result.sentAt === null) {
      context.addIssue({
        code: "custom",
        path: ["sentAt"],
        message: "A sent outreach result requires sentAt.",
      });
    }
    if (result.deliveryStatus === "sent" && result.providerMessageId === null) {
      context.addIssue({
        code: "custom",
        path: ["providerMessageId"],
        message: "A sent outreach result requires the provider delivery identifier.",
      });
    }
    if (result.deliveryStatus !== "sent" && result.sentAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["sentAt"],
        message: "A failed or unknown outreach result cannot claim a sentAt.",
      });
    }
    if (result.deliveryStatus === "sent") {
      const nonMessageAuthority = Object.entries(result.authorityReport)
        .filter(([key]) => key !== "externalMessagesSent")
        .some(([, value]) => value !== 0);
      if (result.authorityReport.externalMessagesSent !== 1 || nonMessageAuthority) {
        context.addIssue({
          code: "custom",
          path: ["authorityReport"],
          message: "A sent outreach result must record exactly one external message and no other authority event.",
        });
      }
    }
    if (result.deliveryStatus !== "sent" && sumAuthorityReport(result.authorityReport) !== 0) {
      context.addIssue({
        code: "custom",
        path: ["authorityReport"],
        message: "A failed or unknown outreach result cannot claim any completed authority event.",
      });
    }
  });

export type SupplierOutreachResultV1 = z.infer<typeof supplierOutreachResultV1Schema>;

export function hashSupplierOutreachDraft(input: {
  candidateId: string;
  channel: SupplierOutreachApprovalV1["channel"];
  destination: string;
  subject: string;
  body: string;
  factsUsedSourceUrls: string[];
}): string {
  return sha256Hex({
    candidateId: input.candidateId,
    channel: input.channel,
    destination: input.destination,
    subject: input.subject,
    body: input.body,
    factsUsedSourceUrls: input.factsUsedSourceUrls,
  });
}

export function hashSupplierOutreachApproval(approval: SupplierOutreachApprovalV1): string {
  return sha256Hex(approval);
}

export type SupplierOutreachValidationResult =
  | { ok: true; value: SupplierOutreachApprovalV1 | SupplierOutreachResultV1 }
  | { ok: false; failures: string[] };

function issues(prefix: string, values: readonly z.ZodIssue[]): string[] {
  return values.map((issue) => prefix + (issue.path.join(".") || "(root)") + ": " + issue.message);
}

export function validateSupplierOutreachApproval(input: unknown): SupplierOutreachValidationResult {
  const parsed = supplierOutreachApprovalV1Schema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, failures: issues("Supplier outreach approval ", parsed.error.issues) };
}

export function validateSupplierOutreachResult(
  input: unknown,
  expectedApproval: unknown,
): SupplierOutreachValidationResult {
  const approval = supplierOutreachApprovalV1Schema.safeParse(expectedApproval);
  const result = supplierOutreachResultV1Schema.safeParse(input);
  const failures: string[] = [];
  if (!approval.success) failures.push(...issues("Approval ", approval.error.issues));
  if (!result.success) failures.push(...issues("Result ", result.error.issues));
  if (!approval.success || !result.success) return { ok: false, failures };

  if (result.data.approvalHash !== hashSupplierOutreachApproval(approval.data)) {
    failures.push("Outreach result approvalHash does not match the exact approved approval artifact.");
  }
  if (result.data.runId !== approval.data.runId) failures.push("Outreach result runId does not match approval.");
  if (result.data.candidateId !== approval.data.candidateId) failures.push("Outreach result candidateId does not match approval.");
  if (result.data.draftHash !== approval.data.draftHash) failures.push("Outreach result draftHash does not match approval.");
  if (result.data.channel !== approval.data.channel) failures.push("Outreach result channel does not match approval.");
  if (result.data.destination !== approval.data.destination) failures.push("Outreach result destination does not match approval.");
  if (result.data.deliveryStatus === "sent" && Date.parse(result.data.sentAt ?? "") < Date.parse(approval.data.approvedAt)) {
    failures.push("Outreach result sentAt precedes the human approval time.");
  }
  if (result.data.deliveryStatus === "sent" && Date.parse(result.data.sentAt ?? "") > Date.parse(approval.data.expiresAt)) {
    failures.push("Outreach result sentAt is after the exact approval expired.");
  }

  return failures.length ? { ok: false, failures } : { ok: true, value: result.data };
}

export function zeroSupplierOutreachAuthorityReport(): AuthorityReport {
  return { ...zeroAuthorityReport };
}

export const supplierOutreachContractSummary = {
  approval: SUPPLIER_OUTREACH_APPROVAL_SCHEMA_VERSION,
  result: SUPPLIER_OUTREACH_RESULT_SCHEMA_VERSION,
  actionClass: "external_execution",
  alwaysRequiresHumanApproval: true,
  supplierRelationshipEffect: "none",
  catalogEffect: "none",
  forbiddenWithoutApproval: [
    "send",
    "schedule",
    "purchase",
    "assert_supplier_relationship",
    "modify_catalog",
    "publish",
  ],
} as const;
