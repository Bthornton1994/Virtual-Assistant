import { freezeScope, releaseRescueIntakeV1Schema, type ReleaseRescueScope } from "@/lib/release-rescue-intake";
import { RELEASE_RESCUE_RUBRIC_V1 } from "@/lib/release-rescue-rubric";
import type { AssessmentRationaleCode } from "@/lib/release-rescue-observation-catalog";
import {
  composeFinding,
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

// The local `finding()` helper is gone, and so is the `CONCERNS` map of prose it
// fed. `composeFinding` in `release-rescue-findings.ts` is the only way to build
// a finding now, and it derives everything the catalog owns — dimension, impact,
// exploitability, severity, blocking, effort, sprint scope — from the code.

/** Checks the sample engagement records as failing, with the rationale code. */
const FAILING: ReadonlyMap<string, AssessmentRationaleCode> = new Map([
  ["authz.object_level_authorization", "control_missing_on_a_reachable_path"],
  ["ai.tool_authority_is_bounded", "control_present_but_not_enforced"],
  ["release.environment_separation", "control_missing_on_a_reachable_path"],
  ["observe.error_reporting_without_leakage", "control_present_but_not_enforced"],
  ["deps.known_vulnerable_dependencies", "partial_control_with_a_gap"],
]);

function assessments(): RubricAssessment[] {
  return RELEASE_RESCUE_RUBRIC_V1.map((check) => {
    const failing = FAILING.get(check.id);
    return {
      checkId: check.id,
      outcome: failing ? ("fail" as const) : ("pass" as const),
      rationaleCode: failing ?? "controls_present_and_evidenced",
      evidence: [
        {
          kind: "code_reference" as const,
          path: `src/${check.dimension}/index.ts`,
          startLine: 1,
          endLine: null,
        },
      ],
    };
  });
}

// Five findings, composed the only way a finding can be composed: from a code in
// the observation catalog plus the facts an executor is allowed to supply. Not
// one sentence of what the customer reads is written here — open
// `release-rescue-observation-catalog.ts` to see the words.
const FINDINGS: ReleaseRescueFindingV1[] = [
  composeFinding({
    findingId: "RR-001",
    observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
    confidence: "confirmed",
    remediationCode: "scope_query_by_authenticated_principal",
    locations: [
      { path: "src/app/expenses/[id]/page.tsx", startLine: 18, endLine: 27 },
      { path: "src/lib/claims.ts", startLine: 44, endLine: 51 },
    ],
    evidence: [
      { kind: "code_reference", path: "src/lib/claims.ts", startLine: 44, endLine: 51 },
    ],
  }),
  composeFinding({
    findingId: "RR-002",
    // `ai.tool_authority_is_not_declared`, not
    // `ai.model_visible_content_can_grant_authority`. The two describe adjacent
    // problems and the catalog gives them different exploitability: the first is
    // reachable by anyone who can put text where the model reads it, the second
    // needs a user to upload something. This demo's scenario is the second, and
    // the severity that follows is `high` rather than `critical`.
    //
    // Choosing the OBSERVATION that matches the scenario is the only lever left,
    // which is the point of the derived model — the alternative would be
    // severity-shopping, and there is no field to shop in.
    observationCode: "ai.tool_authority_is_not_declared",
    confidence: "confirmed",
    remediationCode: "declare_tool_authority_explicitly",
    locations: [{ path: "src/lib/assistant/tools.ts", startLine: 61, endLine: 88 }],
    evidence: [
      { kind: "code_reference", path: "src/lib/assistant/tools.ts", startLine: 61, endLine: 88 },
    ],
  }),
  composeFinding({
    findingId: "RR-003",
    observationCode: "release.preview_shares_production_credentials",
    confidence: "confirmed",
    remediationCode: "separate_production_from_preview_credentials",
    locations: [{ path: "vercel.json", startLine: 4, endLine: 9 }],
    evidence: [
      { kind: "configuration_reference", path: "vercel.json", startLine: 4, endLine: 9 },
    ],
  }),
  composeFinding({
    findingId: "RR-004",
    observationCode: "deps.known_vulnerable_dependency_on_a_reachable_path",
    confidence: "likely",
    remediationCode: "upgrade_or_replace_the_dependency",
    locations: [{ path: "package.json", startLine: 31, endLine: 31 }],
    evidence: [
      { kind: "dependency_manifest_reference", path: "package.json", startLine: 31, endLine: 31 },
    ],
    uncertaintyCode: "path_reachable_only_under_conditions_not_tested",
  }),
  composeFinding({
    findingId: "RR-005",
    observationCode: "observe.logs_carry_secrets_or_customer_data",
    confidence: "confirmed",
    remediationCode: "strip_secrets_and_customer_data_from_logs",
    locations: [{ path: "src/app/expenses/error.tsx", startLine: 8, endLine: 14 }],
    evidence: [
      { kind: "code_reference", path: "src/app/expenses/error.tsx", startLine: 8, endLine: 14 },
    ],
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
  limitationCodes: [
    "customer_excluded_part_of_the_repository",
    "third_party_service_behaviour_not_observable",
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
