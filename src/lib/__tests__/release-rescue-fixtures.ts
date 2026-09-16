import {
  RELEASE_RESCUE_RUBRIC_V1,
  type RubricCheck,
} from "@/lib/release-rescue-rubric";
import {
  composeFinding,
  type FindingFacts,
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
    aiAssistedReviewAccepted: true,
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
    aiAssistedReviewAccepted: true,
    requestedServices: ["release_readiness_review"],
    customerExclusions: [],
    retentionPolicy: "minimum_7_day",
    grantExpiresAt: "2026-09-20T12:00:00.000Z",
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
    submittedAt: "2026-09-15T12:00:00.000Z",
    ...overrides,
  };
}

/** Every rubric check assessed `pass`, with artifact evidence so blocking checks clear. */
export function passingAssessments(): RubricAssessment[] {
  return RELEASE_RESCUE_RUBRIC_V1.map((check: RubricCheck) => ({
    checkId: check.id,
    outcome: "pass" as const,
    rationaleCode: "controls_present_and_evidenced" as const,
    evidence: [
      {
        kind: "code_reference" as const,
        path: `src/${check.dimension}.ts`,
        startLine: 1,
        endLine: null,
      },
    ],
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

/**
 * A finding, built the only way findings are built.
 *
 * `overrides` takes FACTS, not fields. A test can no longer patch `severity` or
 * `whatWeObserved` onto a finding, because neither is an input — which is the
 * contract this fixture exists to exercise rather than to work around.
 */
export function makeFinding(overrides: Partial<FindingFacts> = {}): ReleaseRescueFindingV1 {
  return composeFinding({
    findingId: "f-001",
    observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
    confidence: "confirmed",
    remediationCode: "scope_query_by_authenticated_principal",
    locations: [{ path: "src/app/api/orders/[id]/route.ts", startLine: 12, endLine: 20 }],
    evidence: [
      {
        kind: "code_reference",
        path: "src/app/api/orders/[id]/route.ts",
        startLine: 12,
        endLine: 20,
      },
    ],
    ...overrides,
  });
}

export function makeReportInput(overrides: Partial<AssembleReportInput> = {}): AssembleReportInput {
  return {
    reportId: "rep-001",
    engagementId: "eng-001",
    runId: "run-001",
    organizationId: "org-acme",
    scope: makeScope(),
    reviewedCommitSha: COMMIT_SHA,
    assessments: passingAssessments(),
    findings: [],
    limitationCodes: ["customer_excluded_part_of_the_repository"],
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
