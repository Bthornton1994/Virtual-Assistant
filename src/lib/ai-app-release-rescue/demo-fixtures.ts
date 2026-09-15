import { freezeScope, releaseRescueIntakeV1Schema, type ReleaseRescueScope } from "@/lib/release-rescue-intake";
import { RELEASE_RESCUE_RUBRIC_V1 } from "@/lib/release-rescue-rubric";
import {
  RELEASE_RESCUE_FINDING_SCHEMA_VERSION,
  computeFindingBlocking,
  computeFindingSeverity,
  type ReleaseRescueFindingV1,
} from "@/lib/release-rescue-findings";
import {
  buildReleaseRescueReport,
  hashReleaseRescueReport,
  type ReleaseRescueReportV1,
  type RubricAssessment,
} from "@/lib/release-rescue-report";
import { toCustomerReportView, type CustomerReportView } from "@/lib/release-rescue-presentation";
import { getRubricCheck } from "@/lib/release-rescue-rubric";
import { DEMO_SAMPLE_REPORT_ID } from "@/lib/ai-app-release-rescue/constants";

// The sample report shown on the demo page.
//
// Built through the real assembler rather than hand-written as a literal, so the
// sample a prospective customer reads is the same artifact the service produces:
// same schema, same derived severities, same verdict logic, same hash. A
// hand-written sample would be free to promise a shape the pipeline cannot make,
// and a test in this repository asserts this one passes the real validator.

const DEMO_COMMIT = "4f1c2a9e7b83d05e61af2c48d7be9013a5c6f27b";

const DEMO_INTAKE = releaseRescueIntakeV1Schema.parse({
  schemaVersion: "release-rescue-intake/v1",
  offerVersion: "release-rescue-offer/v1",
  organizationId: "demo-organization",
  repository: {
    provider: "github",
    repositoryRef: "harbor-labs/harbor-ledger",
    defaultBranch: "main",
    accessMode: "customer_installed_readonly_app",
  },
  application: {
    name: "Harbor Ledger",
    description: "A bookkeeping app with an AI assistant that drafts and files expense claims.",
    primaryStack: "next_js_web_app",
    usesAiFeatures: true,
  },
  criticalWorkflow: {
    name: "Submit an expense claim",
    description: "An employee uploads a receipt, the assistant drafts a claim, and a manager approves it.",
    entryPoint: "/expenses/new",
    handlesCustomerData: true,
    triggersExternalActions: true,
  },
  aiAssistedReviewAccepted: true,
  requestedServices: ["release_readiness_review", "ai_boundary_review"],
  customerExclusions: ["The marketing site under /www is out of scope."],
  retentionPolicy: "minimum_7_day",
  grantExpiresAt: "2026-10-01T09:00:00.000Z",
  attestations: {
    authorizedToGrantRepositoryAccess: true,
    ownsOrIsAuthorisedByOwnerOfTheCode: true,
    accessGrantedIsReadOnly: true,
    noProductionCredentialsProvided: true,
    noEndUserPersonalDataProvided: true,
    understandsNotPenetrationTest: true,
    understandsNotComplianceCertification: true,
    understandsNoSecurityGuarantee: true,
    understandsFindingsRequireCustomerAction: true,
  },
  submittedAt: "2026-09-10T09:00:00.000Z",
});

export const SAMPLE_SCOPE: ReleaseRescueScope = freezeScope(DEMO_INTAKE);

/** Builds a finding with severity and blocking derived, never hand-declared. */
function finding(
  input: Omit<ReleaseRescueFindingV1, "schemaVersion" | "severity" | "blocking" | "dimension">,
): ReleaseRescueFindingV1 {
  const check = getRubricCheck(input.rubricCheckId);
  if (!check) throw new Error(`Demo fixture references unknown rubric check "${input.rubricCheckId}".`);
  const severity = computeFindingSeverity(input);
  return {
    schemaVersion: RELEASE_RESCUE_FINDING_SCHEMA_VERSION,
    dimension: check.dimension,
    severity,
    blocking: computeFindingBlocking(check, severity, input.confidence),
    ...input,
  };
}

const CONCERNS = new Map<string, string>([
  [
    "ai.untrusted_input_is_not_authority",
    "The assistant reads receipt text and can call the approval tool in the same turn.",
  ],
  [
    "authz.object_level_authorization",
    "The claim detail route loads by id without comparing the owner to the session.",
  ],
  [
    "release.environment_separation",
    "Preview deployments point at the production database.",
  ],
  [
    "observe.error_reporting_without_leakage",
    "Unhandled errors return a stack trace to the browser.",
  ],
  [
    "deps.known_vulnerable_dependencies",
    "A transitive dependency on the upload path has a published advisory.",
  ],
]);

function assessments(): RubricAssessment[] {
  return RELEASE_RESCUE_RUBRIC_V1.map((check) => {
    const concern = CONCERNS.get(check.id);
    if (concern) {
      return {
        checkId: check.id,
        outcome: "fail" as const,
        rationale: concern,
        evidence: [{ kind: "code_reference" as const, reference: `src/${check.dimension}/index.ts` }],
      };
    }
    return {
      checkId: check.id,
      outcome: "pass" as const,
      rationale: `Reviewed ${check.title.toLowerCase()} against the expense-claim workflow and found it sound.`,
      evidence: [{ kind: "code_reference" as const, reference: `src/${check.dimension}/index.ts` }],
    };
  });
}

const FINDINGS: ReleaseRescueFindingV1[] = [
  finding({
    findingId: "RR-001",
    rubricCheckId: "authz.object_level_authorization",
    title: "Any employee can open another employee's expense claim",
    whatWeObserved:
      "The claim detail route loads a claim by the id in the URL and returns it without comparing the claim's owner to the signed-in user.",
    whyItMatters:
      "Every employee can read every colleague's expense claims, including receipts and amounts, by changing one number in the address bar.",
    recommendation:
      "Filter the claim query by the session's user id, and return 404 rather than 403 so the route does not confirm that a claim exists.",
    impact: "serious",
    exploitability: "requires_privilege",
    confidence: "confirmed",
    locations: [
      { path: "src/app/expenses/[id]/page.tsx", startLine: 18, endLine: 27, excerpt: null },
      { path: "src/lib/claims.ts", startLine: 44, endLine: 51, excerpt: null },
    ],
    remediationEffort: "small",
    inRemediationSprintScope: true,
    residualUncertainty: "",
  }),
  finding({
    findingId: "RR-002",
    rubricCheckId: "ai.untrusted_input_is_not_authority",
    title: "Receipt text can reach the approval tool",
    whatWeObserved:
      "Text extracted from an uploaded receipt is placed in the same prompt as the tool definitions, and the approval tool is available in that turn.",
    whyItMatters:
      "A receipt image containing instructions could cause the assistant to approve a claim that no manager approved.",
    recommendation:
      "Remove the approval tool from the drafting turn. Approval should be a separate, human-initiated action that the model cannot call.",
    impact: "severe",
    exploitability: "requires_user_interaction",
    confidence: "confirmed",
    locations: [{ path: "src/lib/assistant/tools.ts", startLine: 61, endLine: 88, excerpt: null }],
    remediationEffort: "medium",
    inRemediationSprintScope: true,
    residualUncertainty: "",
  }),
  finding({
    findingId: "RR-003",
    rubricCheckId: "release.environment_separation",
    title: "Preview deployments write to the production database",
    whatWeObserved:
      "The preview environment and the production environment resolve the same database connection setting.",
    whyItMatters:
      "A pull request preview can modify real expense claims, and a destructive migration tested in preview would run against production data.",
    recommendation: "Give preview its own database and seed it. Fail the build if preview resolves the production host.",
    impact: "severe",
    exploitability: "requires_privilege",
    confidence: "confirmed",
    locations: [{ path: "vercel.json", startLine: 4, endLine: 9, excerpt: null }],
    remediationEffort: "medium",
    inRemediationSprintScope: true,
    residualUncertainty: "",
  }),
  finding({
    findingId: "RR-004",
    rubricCheckId: "deps.known_vulnerable_dependencies",
    title: "Vulnerable image parser on the receipt upload path",
    whatWeObserved:
      "The upload handler depends on a version of the image library with a published advisory for malformed input.",
    whyItMatters: "A crafted receipt upload could crash the handler, and the advisory describes worse outcomes.",
    recommendation: "Upgrade to a patched version and add a regression test that uploads a malformed image.",
    impact: "serious",
    exploitability: "requires_user_interaction",
    confidence: "likely",
    locations: [{ path: "package.json", startLine: 31, endLine: 31, excerpt: null }],
    remediationEffort: "trivial",
    inRemediationSprintScope: true,
    residualUncertainty:
      "We could not confirm the vulnerable code path is reachable with the options this application passes.",
  }),
  finding({
    findingId: "RR-005",
    rubricCheckId: "observe.error_reporting_without_leakage",
    title: "Stack traces reach the browser",
    whatWeObserved: "Unhandled errors in the claim routes return the stack trace in the response body.",
    whyItMatters: "Stack traces disclose file paths and library versions that make other problems easier to find.",
    recommendation: "Return a generic message with a correlation id, and log the detail server-side.",
    impact: "limited",
    exploitability: "remote_unauthenticated",
    confidence: "confirmed",
    locations: [{ path: "src/app/expenses/error.tsx", startLine: 8, endLine: 14, excerpt: null }],
    remediationEffort: "trivial",
    inRemediationSprintScope: false,
    residualUncertainty: "",
  }),
];

export const SAMPLE_REPORT: ReleaseRescueReportV1 = buildReleaseRescueReport({
  reportId: DEMO_SAMPLE_REPORT_ID,
  engagementId: "demo-engagement",
  runId: "demo-run",
  organizationId: "demo-organization",
  scope: SAMPLE_SCOPE,
  reviewedCommitSha: DEMO_COMMIT,
  assessments: assessments(),
  findings: FINDINGS,
  limitations: [
    "The customer excluded the marketing site under /www from this review.",
    "We reviewed the assistant's tool definitions as written. We did not observe the assistant running against live traffic.",
  ],
  authorityReport: {
    externalMessagesSent: 0,
    purchasesMade: 0,
    accountsCreated: 0,
    repositoryChangesMade: 0,
    catalogRecordsModified: 0,
    permissionsChanged: 0,
    skillsCreatedOrModified: 0,
    routinesCreatedOrModified: 0,
    otherExternalActions: 0,
  },
  preparedBy: {
    executorKey: "release-rescue-auditor",
    executorKind: "agent",
    provider: "internal",
    modelId: null,
    protocolVersion: "v1",
  },
  reviewedBy: {
    operatorUserId: "demo-operator",
    displayName: "Sam Okafor, operations manager",
    reviewedAt: "2026-09-12T16:30:00.000Z",
  },
  generatedAt: "2026-09-12T15:00:00.000Z",
});

export const SAMPLE_REPORT_HASH: string = hashReleaseRescueReport(SAMPLE_REPORT);
export const SAMPLE_CUSTOMER_REPORT: CustomerReportView = toCustomerReportView(SAMPLE_REPORT);
