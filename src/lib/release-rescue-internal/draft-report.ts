import {
  RELEASE_RESCUE_INTAKE_SCHEMA_VERSION,
  RELEASE_RESCUE_OFFER_VERSION,
  freezeScope,
  pinReviewedCommit,
  releaseRescueIntakeV1Schema,
  type ReleaseRescueScope,
  type RetentionPolicy,
} from "@/lib/release-rescue-intake";
import {
  buildReleaseRescueReport,
  hashReleaseRescueReviewSubject,
  validateReleaseRescueReport,
  type ReleaseRescueReportV1,
} from "@/lib/release-rescue-report";
import { createHash } from "node:crypto";
import type { AllowlistEntry } from "@/lib/release-rescue-internal/allowlist";
import type { Analysis } from "@/lib/release-rescue-internal/checks";

// Turns one allowlisted target and one analysis into an UNSIGNED draft report,
// through the production assembler.
//
// Nothing here chooses a number. `buildReleaseRescueReport` redacts, derives
// coverage, severity counts and the verdict from the assessments and findings,
// and binds the result to the rubric, the catalog and the scope by hash. The
// draft is validated before it is returned, so a draft that the validator would
// refuse never reaches a reviewer.

/** The one organization internal runs belong to. A fixed UUID, as report ids must be. */
export const INTERNAL_ORGANIZATION_ID = "5f1d7c2e-9a3b-4c61-8e0f-2b7d4a9c6e13";

export const INTERNAL_PREPARED_BY = {
  executorKey: "release-rescue-internal-deterministic",
  executorKind: "deterministic" as const,
  provider: "delegation-cloud-local",
  modelId: null,
  protocolVersion: "release-rescue-internal/v1",
};

/**
 * The frozen scope for an internal review of our own repository.
 *
 * `customer_uploaded_archive` is the access mode because the source reaches the
 * review as a local copy the operator supplies, not through a grant in the
 * repository host. That mode does not demonstrate control of the repository,
 * so the run also records the operator's own confirmation that it is ours to
 * review. `aiAssistedReviewAccepted` is false: no model reads the source.
 */
export function internalScope(entry: AllowlistEntry, now: Date, retentionPolicy: RetentionPolicy): ReleaseRescueScope {
  const intake = releaseRescueIntakeV1Schema.parse({
    schemaVersion: RELEASE_RESCUE_INTAKE_SCHEMA_VERSION,
    offerVersion: RELEASE_RESCUE_OFFER_VERSION,
    organizationId: INTERNAL_ORGANIZATION_ID,
    repository: {
      provider: "github",
      repositoryRef: entry.repositoryRef,
      defaultBranch: entry.defaultBranch,
      accessMode: "customer_uploaded_archive",
    },
    application: entry.application,
    criticalWorkflow: entry.criticalWorkflow,
    aiAssistedReviewAccepted: false,
    requestedServices: ["release_readiness_review"],
    customerExclusions: [],
    retentionPolicy,
    grantExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
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
    submittedAt: now.toISOString(),
  });
  return freezeScope(intake);
}

/** A stable UUID derived from the run id, so one run always names the same report. */
function derivedUuid(kind: string, runId: string): string {
  const hex = createHash("sha256").update(`${kind}\n${runId}`).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type DraftReport = {
  report: ReleaseRescueReportV1;
  /** What a reviewer attests to: the report without a signature. */
  subjectHash: string;
  scopeHash: string;
};

export function buildDraftReport(input: {
  runId: string;
  entry: AllowlistEntry;
  commitSha: string;
  analysis: Analysis;
  retentionPolicy: RetentionPolicy;
  now: Date;
}): DraftReport {
  const scope = internalScope(input.entry, input.now, input.retentionPolicy);
  const pinned = pinReviewedCommit(scope, input.commitSha);
  const report = buildReleaseRescueReport({
    reportId: derivedUuid("report", input.runId),
    engagementId: derivedUuid("engagement", input.runId),
    runId: input.runId,
    organizationId: INTERNAL_ORGANIZATION_ID,
    scope,
    reviewedCommitSha: pinned.reviewedCommitSha,
    assessments: input.analysis.assessments,
    findings: input.analysis.findings,
    limitationCodes: ["review_limited_to_automated_checks", "infrastructure_outside_the_repository_not_reviewed"],
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
    preparedBy: INTERNAL_PREPARED_BY,
    reviewedBy: null,
    generatedAt: input.now.toISOString(),
  });

  const validation = validateReleaseRescueReport(report);
  if (!validation.hardGatePass) {
    throw new Error(`The draft report failed validation: ${validation.hardFailures.join("; ")}`);
  }
  return { report, subjectHash: hashReleaseRescueReviewSubject(report), scopeHash: pinned.scopeHash };
}
