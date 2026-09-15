import { ATTESTATION_FIELDS } from "@/lib/ai-app-release-rescue/intake";

/** A submission where every field is acceptable. Tests vary one thing at a time. */
export function validIntakeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const attestations = Object.fromEntries(ATTESTATION_FIELDS.map((field) => [field, "on"]));
  return {
    contactName: "Dana Petrov",
    workEmail: "dana@harbor-labs.test",
    repositoryUrl: "https://github.com/harbor-labs/harbor-ledger",
    appType: "next_js_web_app",
    criticalWorkflow: "An employee uploads a receipt and a manager approves the resulting expense claim.",
    criticalWorkflowEntryPoint: "/expenses/new",
    accessGrantMethod: "customer_installed_readonly_app",
    accessWindowDays: "14",
    retentionPolicy: "minimum_7_day",
    evidenceNotes: "The assistant drafts the claim before a manager sees it.",
    evidenceFileNames: "src/lib/assistant/tools.ts",
    remediationInterest: "on",
    ...attestations,
    ...overrides,
  };
}
