import {
  RELEASE_RESCUE_RUBRIC_V1,
  type RubricCheck,
} from "@/lib/release-rescue-rubric";
import {
  RELEASE_RESCUE_FINDING_SCHEMA_VERSION,
  type ReleaseRescueFindingV1,
} from "@/lib/release-rescue-findings";
import {
  RELEASE_RESCUE_INTAKE_SCHEMA_VERSION,
  RELEASE_RESCUE_OFFER_VERSION,
  type ReleaseRescueScope,
} from "@/lib/release-rescue-intake";
import type { AssembleReportInput, RubricAssessment } from "@/lib/release-rescue-report";

// Shared fixtures for the Release Rescue suites. Kept out of the .test.ts naming
// convention so vitest does not try to run it as a suite.

export const ZERO_AUTHORITY = {
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

export const COMMIT_SHA = "a".repeat(40);

export function makeScope(overrides: Partial<ReleaseRescueScope> = {}): ReleaseRescueScope {
  return {
    offerVersion: RELEASE_RESCUE_OFFER_VERSION,
    repository: {
      provider: "github",
      repositoryRef: "acme/checkout-app",
      commitSha: COMMIT_SHA,
      defaultBranch: "main",
      accessMode: "customer_installed_readonly_app",
    },
    application: {
      name: "Acme Checkout",
      description: "A checkout application with an AI support assistant.",
      primaryStack: "Next.js + Postgres",
      usesAiFeatures: true,
    },
    criticalWorkflow: {
      name: "Guest checkout",
      description: "A guest completes a purchase without an account.",
      entryPoint: "/checkout",
      handlesCustomerData: true,
      triggersExternalActions: true,
    },
    customerExclusions: [],
    ...overrides,
  };
}

export function makeIntake(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: RELEASE_RESCUE_INTAKE_SCHEMA_VERSION,
    offerVersion: RELEASE_RESCUE_OFFER_VERSION,
    organizationId: "org-acme",
    repository: {
      provider: "github",
      repositoryRef: "acme/checkout-app",
      defaultBranch: "main",
      accessMode: "customer_installed_readonly_app",
    },
    application: makeScope().application,
    criticalWorkflow: makeScope().criticalWorkflow,
    requestedServices: ["release_readiness_review"],
    customerExclusions: [],
    retentionPolicy: "minimum_7_day",
    grantExpiresAt: "2026-09-20T12:00:00.000Z",
    attestations: {
      authorizedToGrantRepositoryAccess: true,
      accessGrantedIsReadOnly: true,
      noProductionCredentialsProvided: true,
      noEndUserPersonalDataProvided: true,
      understandsNotPenetrationTest: true,
      understandsNotComplianceCertification: true,
      understandsNoSecurityGuarantee: true,
      understandsFindingsRequireCustomerAction: true,
    },
    submittedAt: "2026-09-15T12:00:00.000Z",
    ...overrides,
  };
}

/** Every rubric check assessed `pass`, with artifact evidence so blocking checks clear. */
export function passingAssessments(): RubricAssessment[] {
  return RELEASE_RESCUE_RUBRIC_V1.map((check: RubricCheck) => ({
    checkId: check.id,
    outcome: "pass" as const,
    rationale: `Reviewed ${check.title.toLowerCase()} against the checkout workflow and found it sound.`,
    evidence: [{ kind: "code_reference" as const, reference: `src/${check.dimension}.ts` }],
  }));
}

export function setAssessment(
  assessments: RubricAssessment[],
  checkId: string,
  patch: Partial<RubricAssessment>,
): RubricAssessment[] {
  return assessments.map((assessment) =>
    assessment.checkId === checkId ? { ...assessment, ...patch } : assessment,
  );
}

export function makeFinding(overrides: Partial<ReleaseRescueFindingV1> = {}): ReleaseRescueFindingV1 {
  const base: ReleaseRescueFindingV1 = {
    schemaVersion: RELEASE_RESCUE_FINDING_SCHEMA_VERSION,
    findingId: "f-001",
    rubricCheckId: "authz.object_level_authorization",
    dimension: "authorization_and_tenancy",
    title: "Order lookup does not check ownership",
    whatWeObserved: "The order route loads an order by id and returns it without comparing the owner to the session.",
    whyItMatters: "Any signed-in customer can read another customer's order by changing the id in the URL.",
    recommendation: "Filter the order query by the session's customer id and return 404 on a miss.",
    impact: "serious",
    exploitability: "remote_unauthenticated",
    confidence: "confirmed",
    severity: "high",
    blocking: true,
    locations: [{ path: "src/app/api/orders/[id]/route.ts", startLine: 12, endLine: 20, excerpt: null }],
    remediationEffort: "small",
    inRemediationSprintScope: true,
    residualUncertainty: "",
  };
  return { ...base, ...overrides };
}

export function makeReportInput(overrides: Partial<AssembleReportInput> = {}): AssembleReportInput {
  return {
    reportId: "rep-001",
    engagementId: "eng-001",
    runId: "run-001",
    organizationId: "org-acme",
    scope: makeScope(),
    assessments: passingAssessments(),
    findings: [],
    limitations: ["The customer excluded the admin console from scope."],
    authorityReport: { ...ZERO_AUTHORITY },
    preparedBy: {
      executorKey: "release-rescue-auditor",
      executorKind: "agent",
      provider: "internal",
      modelId: null,
      protocolVersion: "v1",
    },
    reviewedBy: {
      operatorUserId: "op-1",
      displayName: "Ops Manager",
      reviewedAt: "2026-09-16T10:00:00.000Z",
    },
    generatedAt: "2026-09-16T09:00:00.000Z",
    ...overrides,
  };
}
