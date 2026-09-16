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

/**
 * Fixture identifiers, as UUIDs, because that is what the columns are.
 *
 * They used to be `org-acme`, `rep-001`, `run-001`, `op-1`. That was not a
 * cosmetic choice: while the fixtures were toy strings, the one test that claims
 * to prove "assembly accepts every value a real report legitimately produces"
 * was proving it about values a real report never produces. The identifier
 * format refused every actual UUID for a whole commit, and no test noticed,
 * because no test passed one. A fixture that does not resemble production tests
 * the fixture.
 */
export const FIXTURE_ORGANIZATION_ID = "6d1f6f6e-9f5d-4a63-9a6a-52a1b9c0d7e1";
export const FIXTURE_REPORT_ID = "0b7c2f14-3a4d-4b91-8c26-11f0a9d4e5b2";
export const FIXTURE_ENGAGEMENT_ID = "c3e8a5d0-7b62-4f19-9d84-2a6e1c5f30ab";
export const FIXTURE_RUN_ID = "9a41d7b8-5c03-4e2f-8b17-6d9e0f2a3c45";
export const FIXTURE_OPERATOR_ID = "e57b0c92-1d48-4a36-b5e0-8f27c4d13a69";
/** A second report id, for the tests that assert two reports differ. */
export const FIXTURE_SECOND_REPORT_ID = "4f82b1a7-6c95-4d30-ae18-73b2e9f01c64";

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
    organizationId: FIXTURE_ORGANIZATION_ID,
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
    findingId: "RR-001",
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
    reportId: FIXTURE_REPORT_ID,
    engagementId: FIXTURE_ENGAGEMENT_ID,
    runId: FIXTURE_RUN_ID,
    organizationId: FIXTURE_ORGANIZATION_ID,
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
      operatorUserId: FIXTURE_OPERATOR_ID,
      displayName: "Ops Manager",
      reviewedAt: "2026-09-16T10:00:00.000Z",
    },
    generatedAt: "2026-09-16T09:00:00.000Z",
    ...overrides,
  };
}
