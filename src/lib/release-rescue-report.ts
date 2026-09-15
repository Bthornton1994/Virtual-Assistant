import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import type { ValidationResult } from "@/lib/catalog-evidence-validator";
import {
  authorityReportSchema,
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
  sumAuthorityReport,
} from "@/lib/catalog-evidence-shared";
import {
  applicationScopeSchema,
  criticalWorkflowScopeSchema,
  hashScope,
  commitShaSchema,
  repositoryScopeSchema,
  RELEASE_RESCUE_OFFER_VERSION,
  type ReleaseRescueScope,
} from "@/lib/release-rescue-intake";
import { checkReportFieldCoverage } from "@/lib/release-rescue-field-policy";
import {
  blocksDelivery,
  requiresHumanClearance,
  type SecretClassification,
} from "@/lib/release-rescue-secret-classification";
import {
  FINDING_SEVERITIES,
  computeFindingBlocking,
  computeFindingSeverity,
  releaseRescueFindingV1Schema,
  severityRank,
  validateFinding,
  type FindingSeverity,
  type ReleaseRescueFindingV1,
} from "@/lib/release-rescue-findings";
import {
  RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION,
  RELEASE_RESCUE_RUBRIC_V1,
  RELEASE_RESCUE_RUBRIC_V1_HASH,
  getRubricCheck,
  isArtifactEvidence,
  rubricCheckOutcomeSchema,
  rubricEvidenceKindSchema,
  totalRubricWeight,
} from "@/lib/release-rescue-rubric";
import { scanForSecrets } from "@/lib/release-rescue-redaction";

// The Release Rescue report: its schema, its deterministic assembly, its
// validation, and the gate that decides whether it may be delivered.
//
// The report is the entire product. A customer pays $299 and receives this
// artifact; everything else in the service exists to produce it. So it is built
// the way this codebase builds anything a customer relies on: every number is
// computed here from the findings, never carried in from an executor's summary;
// the artifact is frozen and content-hashed; and a human ops reviewer signs it
// before it can be delivered.
//
// Division of labour, following the repository's existing validator/policy split:
//
//   assembleReleaseRescueReport  builds the artifact and DERIVES coverage,
//                                severity counts, and the verdict.
//   validateReleaseRescueReport  answers "is this artifact well-formed, internally
//                                consistent, and free of material it must not carry?"
//   releaseRescueDeliveryGate    answers "may this go to the customer?" — which is
//                                a different question, and additionally requires a
//                                named human reviewer.

export const RELEASE_RESCUE_REPORT_SCHEMA_VERSION = "release-rescue-report/v1" as const;

export const RELEASE_VERDICTS = [
  "release_blocked",
  "conditional_release",
  "release_with_tracked_findings",
  "no_blocking_findings_identified",
] as const;
export type ReleaseVerdict = (typeof RELEASE_VERDICTS)[number];

// --- Schemas ------------------------------------------------------------------------

export const assessmentEvidenceSchema = z
  .object({
    kind: rubricEvidenceKindSchema,
    /** Where to look: a repository path, a policy name, a manifest entry, a test id. */
    reference: nonEmptyString.max(500),
  })
  .strict();

export const rubricAssessmentSchema = z
  .object({
    checkId: identifierString.max(200),
    outcome: rubricCheckOutcomeSchema,
    /** Why this outcome. Required even for `not_assessed`, where it states why not. */
    rationale: nonEmptyString.max(2000),
    evidence: z.array(assessmentEvidenceSchema).max(10),
  })
  .strict();

export type RubricAssessment = z.infer<typeof rubricAssessmentSchema>;

export const reportScopeSchema = z
  .object({
    offerVersion: z.literal(RELEASE_RESCUE_OFFER_VERSION),
    repository: repositoryScopeSchema,
    application: applicationScopeSchema,
    criticalWorkflow: criticalWorkflowScopeSchema,
    customerExclusions: z.array(nonEmptyString.max(500)).max(20),
    aiAssistedReviewAccepted: z.boolean(),
  })
  .strict();

export const coverageSchema = z
  .object({
    totalChecks: z.number().int().min(0),
    assessedChecks: z.number().int().min(0),
    notAssessedChecks: z.number().int().min(0),
    notApplicableChecks: z.number().int().min(0),
    blockingChecksTotal: z.number().int().min(0),
    blockingChecksAssessed: z.number().int().min(0),
    assessedWeight: z.number().int().min(0),
    totalWeight: z.number().int().min(0),
  })
  .strict();

export const severityCountsSchema = z
  .object({
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
    informational: z.number().int().min(0),
  })
  .strict();

/**
 * Every disclaimer is `z.literal(true)`: they are not optional on this offer, and
 * a report that omits one does not parse. The same three claims are refused at
 * intake, so a customer meets them before the work starts and again when the
 * report arrives.
 */
export const reportDisclaimersSchema = z
  .object({
    notPenetrationTest: z.literal(true),
    notComplianceCertification: z.literal(true),
    noSecurityGuarantee: z.literal(true),
    reviewedCommitOnly: z.literal(true),
  })
  .strict();

/** Vendor and model names belong here — execution provenance, not workstream semantics. */
export const preparedBySchema = z
  .object({
    executorKey: identifierString.max(200),
    executorKind: z.enum(["agent", "deterministic", "human"]),
    provider: z.string().max(200),
    modelId: z.string().max(200).nullable(),
    protocolVersion: identifierString.max(100),
  })
  .strict();

export const reviewedBySchema = z
  .object({
    operatorUserId: identifierString.max(100),
    displayName: nonEmptyString.max(200),
    reviewedAt: isoDateTimeSchema,
  })
  .strict();

/**
 * A named human's record that they looked at a held span and decided.
 *
 * The clearance lives IN the artifact, so it is hashed with everything else and
 * a delivered report carries the evidence of who released it. Clearing a hold is
 * an accountable act, not a flag someone flips on the way past.
 */
export const clearedSecretHoldSchema = z
  .object({
    path: identifierString.max(300),
    clearedBy: identifierString.max(100),
    clearedAt: isoDateTimeSchema,
    /** Why it was safe. Free text, and itself subject to the field policy. */
    rationale: nonEmptyString.max(1000),
  })
  .strict();

export const releaseRescueReportV1Schema = z
  .object({
    schemaVersion: z.literal(RELEASE_RESCUE_REPORT_SCHEMA_VERSION),
    reportId: identifierString.max(100),
    engagementId: identifierString.max(100),
    runId: identifierString.max(100),
    organizationId: identifierString.max(100),
    rubricVersion: z.literal(RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION),
    rubricHash: z.string().regex(/^[0-9a-f]{64}$/),
    scope: reportScopeSchema,
    scopeHash: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * The commit reviewed, pinned on the engagement when the snapshot was taken.
     *
     * A sibling of `scopeHash`, not a member of `scope`: the scope is what the
     * customer agreed to and is frozen at intake, while this is which version of
     * it we read and is only knowable later. Keeping it inside `scope` made the
     * scope unfreezable at the only moment it could be frozen.
     *
     * Together the two are what makes a finding defensible months later: the
     * scope says what we agreed to look at, this says what we actually read.
     */
    reviewedCommitSha: commitShaSchema,
    assessments: z.array(rubricAssessmentSchema),
    findings: z.array(releaseRescueFindingV1Schema),
    coverage: coverageSchema,
    severityCounts: severityCountsSchema,
    blockingFindingCount: z.number().int().min(0),
    verdict: z.enum(RELEASE_VERDICTS),
    /** What this review could not establish. Never empty — see the validator. */
    limitations: z.array(nonEmptyString.max(1000)).min(1).max(30),
    disclaimers: reportDisclaimersSchema,
    /** The auditor's own account of external actions taken. Any non-zero entry fails the gate. */
    authorityReport: authorityReportSchema,
    preparedBy: preparedBySchema,
    /**
     * Holds a human has cleared. Empty by default: an ambiguous candidate is
     * held until somebody records a decision, so the safe state is the one that
     * requires an action rather than the one that requires remembering.
     */
    clearedSecretHolds: z.array(clearedSecretHoldSchema).max(50),
    reviewedBy: reviewedBySchema.nullable(),
    generatedAt: isoDateTimeSchema,
  })
  .strict();

export type ReleaseRescueReportV1 = z.infer<typeof releaseRescueReportV1Schema>;

// --- Deterministic derivation -------------------------------------------------------

export type ReleaseRescueReportMetrics = {
  findingCount: number;
  blockingFindingCount: number;
  severityCounts: Record<FindingSeverity, number>;
  /** High or critical findings the auditor did not confirm. These hold the verdict conditional. */
  unconfirmedHighOrCriticalCount: number;
  /** Confirmed high findings on checks the rubric does not gate. Also conditional. */
  confirmedHighOnNonBlockingCheckCount: number;
  remediationSprintScopeCount: number;
  authorityIncidentCount: number;
  coverage: z.infer<typeof coverageSchema>;
  verdict: ReleaseVerdict;
};

function emptySeverityCounts(): Record<FindingSeverity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
}

function deriveCoverage(assessments: readonly RubricAssessment[]): z.infer<typeof coverageSchema> {
  const byId = new Map(assessments.map((assessment) => [assessment.checkId, assessment]));
  let assessedChecks = 0;
  let notAssessedChecks = 0;
  let notApplicableChecks = 0;
  let blockingChecksAssessed = 0;
  let assessedWeight = 0;

  for (const check of RELEASE_RESCUE_RUBRIC_V1) {
    const assessment = byId.get(check.id);
    // A check with no assessment row counts exactly as `not_assessed`. The
    // validator separately rejects the missing row; coverage must not flatter
    // the report in the meantime.
    const outcome = assessment?.outcome ?? "not_assessed";
    if (outcome === "not_assessed") {
      notAssessedChecks += 1;
      continue;
    }
    assessedChecks += 1;
    assessedWeight += check.weight;
    if (outcome === "not_applicable") notApplicableChecks += 1;
    if (check.blocking) blockingChecksAssessed += 1;
  }

  return {
    totalChecks: RELEASE_RESCUE_RUBRIC_V1.length,
    assessedChecks,
    notAssessedChecks,
    notApplicableChecks,
    blockingChecksTotal: RELEASE_RESCUE_RUBRIC_V1.filter((check) => check.blocking).length,
    blockingChecksAssessed,
    assessedWeight,
    totalWeight: totalRubricWeight(),
  };
}

/**
 * The verdict ladder, in strict precedence order.
 *
 * Each rung names what the customer can actually conclude. Note what the top
 * rung is called: `no_blocking_findings_identified`, not "secure" and not
 * "ready". We can report what a review of one commit found; we cannot report
 * that nothing else exists, and the name refuses to imply otherwise.
 */
export function deriveVerdict(metrics: Omit<ReleaseRescueReportMetrics, "verdict">): ReleaseVerdict {
  if (metrics.blockingFindingCount > 0) return "release_blocked";

  if (
    metrics.coverage.notAssessedChecks > 0 ||
    metrics.unconfirmedHighOrCriticalCount > 0 ||
    metrics.confirmedHighOnNonBlockingCheckCount > 0
  ) {
    return "conditional_release";
  }

  const trackedFindings =
    metrics.severityCounts.critical +
    metrics.severityCounts.high +
    metrics.severityCounts.medium +
    metrics.severityCounts.low;
  if (trackedFindings > 0) return "release_with_tracked_findings";

  return "no_blocking_findings_identified";
}

/**
 * Computes every derived number on a report from its assessments and findings.
 *
 * Severity and blocking are RECOMPUTED here from each finding's observations
 * rather than read off the finding. A caller that hands in a finding with an
 * inflated stored severity gets correct metrics; the validator separately fails
 * the report for the mismatch. Neither path lets the inflated value through.
 */
export function deriveReportMetrics(
  assessments: readonly RubricAssessment[],
  findings: readonly ReleaseRescueFindingV1[],
  authorityReport: z.infer<typeof authorityReportSchema>,
): ReleaseRescueReportMetrics {
  const severityCounts = emptySeverityCounts();
  let blockingFindingCount = 0;
  let unconfirmedHighOrCriticalCount = 0;
  let confirmedHighOnNonBlockingCheckCount = 0;
  let remediationSprintScopeCount = 0;

  for (const finding of findings) {
    const severity = computeFindingSeverity(finding);
    severityCounts[severity] += 1;
    if (finding.inRemediationSprintScope) remediationSprintScopeCount += 1;

    const check = getRubricCheck(finding.rubricCheckId);
    const isHighOrAbove = severityRank(severity) >= severityRank("high");

    if (!check) {
      // An unrecognised check id fails CLOSED. The validator rejects such a
      // finding separately, but deriveReportMetrics is exported and must not
      // answer "not blocking" for a confirmed critical just because it cannot
      // place it.
      if (finding.confidence === "confirmed" && isHighOrAbove) blockingFindingCount += 1;
      else if (isHighOrAbove) unconfirmedHighOrCriticalCount += 1;
      continue;
    }

    if (computeFindingBlocking(check, severity, finding.confidence)) {
      blockingFindingCount += 1;
      continue;
    }
    if (isHighOrAbove && finding.confidence !== "confirmed") {
      unconfirmedHighOrCriticalCount += 1;
      continue;
    }
    if (isHighOrAbove && finding.confidence === "confirmed") {
      // Confirmed, high, on a check the rubric does not gate.
      confirmedHighOnNonBlockingCheckCount += 1;
    }
  }

  const base = {
    findingCount: findings.length,
    blockingFindingCount,
    severityCounts,
    unconfirmedHighOrCriticalCount,
    confirmedHighOnNonBlockingCheckCount,
    remediationSprintScopeCount,
    authorityIncidentCount: sumAuthorityReport(authorityReport),
    coverage: deriveCoverage(assessments),
  };

  return { ...base, verdict: deriveVerdict(base) };
}

export type AssembleReportInput = {
  reportId: string;
  engagementId: string;
  runId: string;
  organizationId: string;
  scope: ReleaseRescueScope;
  /** Pinned on the engagement at snapshot; the assembler copies, never chooses. */
  reviewedCommitSha: string;
  assessments: RubricAssessment[];
  findings: ReleaseRescueFindingV1[];
  limitations: string[];
  authorityReport: z.infer<typeof authorityReportSchema>;
  preparedBy: z.infer<typeof preparedBySchema>;
  clearedSecretHolds?: z.infer<typeof clearedSecretHoldSchema>[];
  reviewedBy: z.infer<typeof reviewedBySchema> | null;
  generatedAt: string;
};

/** Standing limitations every report carries, before engagement-specific ones. */
export const STANDING_LIMITATIONS: readonly string[] = [
  "This review examined one repository at one commit. Changes made after that commit were not reviewed.",
  "The review read source, configuration, and dependency manifests. It did not attack, load-test, or otherwise exercise a running system.",
  "Findings describe what this review identified. The absence of a finding is not evidence that a problem does not exist.",
  "Severity reflects the impact, exploitability, and confidence recorded for each finding, judged against the one critical workflow in scope.",
  // Stated plainly, because the honest answer is uncomfortable and a customer
  // who believes otherwise will over-trust the report.
  "Part of this review is performed by an AI system reading your source. Text inside a repository can attempt to influence such a system. Our controls prevent that text from changing this report's findings, severity, counts, or verdict, which are computed by deterministic code from recorded observations. They cannot rule out that it caused a real problem to go unreported. This residual risk is not solved, and a human reviewer signing this report is the mitigation, not a guarantee.",
];

export function assembleReleaseRescueReport(input: AssembleReportInput): ReleaseRescueReportV1 {
  const metrics = deriveReportMetrics(input.assessments, input.findings, input.authorityReport);
  const limitations = [...STANDING_LIMITATIONS, ...input.limitations];

  return {
    schemaVersion: RELEASE_RESCUE_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    engagementId: input.engagementId,
    runId: input.runId,
    organizationId: input.organizationId,
    rubricVersion: RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION,
    rubricHash: RELEASE_RESCUE_RUBRIC_V1_HASH,
    scope: input.scope,
    scopeHash: hashScope(input.scope),
    reviewedCommitSha: commitShaSchema.parse(input.reviewedCommitSha),
    assessments: input.assessments,
    findings: input.findings,
    coverage: metrics.coverage,
    severityCounts: metrics.severityCounts,
    blockingFindingCount: metrics.blockingFindingCount,
    verdict: metrics.verdict,
    limitations,
    disclaimers: {
      notPenetrationTest: true,
      notComplianceCertification: true,
      noSecurityGuarantee: true,
      reviewedCommitOnly: true,
    },
    authorityReport: input.authorityReport,
    preparedBy: input.preparedBy,
    clearedSecretHolds: input.clearedSecretHolds ?? [],
    reviewedBy: input.reviewedBy,
    generatedAt: input.generatedAt,
  };
}

/** Canonical content hash used to bind a stored report row to its payload. */
export function hashReleaseRescueReport(report: ReleaseRescueReportV1): string {
  return sha256Hex(report);
}

// --- Validation ---------------------------------------------------------------------

const ZERO_METRICS: ReleaseRescueReportMetrics = {
  findingCount: 0,
  blockingFindingCount: 0,
  severityCounts: emptySeverityCounts(),
  unconfirmedHighOrCriticalCount: 0,
  confirmedHighOnNonBlockingCheckCount: 0,
  remediationSprintScopeCount: 0,
  authorityIncidentCount: 0,
  coverage: {
    totalChecks: RELEASE_RESCUE_RUBRIC_V1.length,
    assessedChecks: 0,
    notAssessedChecks: RELEASE_RESCUE_RUBRIC_V1.length,
    notApplicableChecks: 0,
    blockingChecksTotal: RELEASE_RESCUE_RUBRIC_V1.filter((check) => check.blocking).length,
    blockingChecksAssessed: 0,
    assessedWeight: 0,
    totalWeight: totalRubricWeight(),
  },
  verdict: "conditional_release",
};

/** Text fields a customer reads. Scanned for prohibited claims and for secrets. */


/**
 * Deterministic validation of an assembled report.
 *
 * Same contract as the other validators in this codebase: same input, same
 * result, no clock, no network, no model. This is the machine that decides
 * whether the artifact is sound, so it cannot itself depend on anything that
 * could answer differently on a second run.
 */
export function validateReleaseRescueReport(candidate: unknown): ValidationResult<ReleaseRescueReportMetrics> {
  const parsed = releaseRescueReportV1Schema.safeParse(candidate);
  if (!parsed.success) {
    return {
      hardGatePass: false,
      hardFailures: parsed.error.issues.map(
        (issue) => `Schema violation at ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
      warnings: [],
      metrics: ZERO_METRICS,
    };
  }

  const report = parsed.data;
  const hardFailures: string[] = [];
  const warnings: string[] = [];

  // --- rubric binding ---
  if (report.rubricHash !== RELEASE_RESCUE_RUBRIC_V1_HASH) {
    hardFailures.push(
      `Report rubric hash "${report.rubricHash}" does not match the ${RELEASE_RESCUE_RUBRIC_SCHEMA_VERSION} rubric in this build ("${RELEASE_RESCUE_RUBRIC_V1_HASH}").`,
    );
  }

  const recomputedScopeHash = hashScope(report.scope);
  if (report.scopeHash !== recomputedScopeHash) {
    hardFailures.push(
      `Report scope hash "${report.scopeHash}" does not match the hash recomputed from its scope ("${recomputedScopeHash}").`,
    );
  }

  // --- assessment coverage and consistency ---
  const assessmentIds = report.assessments.map((assessment) => assessment.checkId);
  const duplicateAssessments = assessmentIds.filter((id, index) => assessmentIds.indexOf(id) !== index);
  for (const id of [...new Set(duplicateAssessments)]) {
    hardFailures.push(`Rubric check "${id}" is assessed more than once.`);
  }

  const assessmentsById = new Map(report.assessments.map((assessment) => [assessment.checkId, assessment]));
  for (const assessment of report.assessments) {
    if (!getRubricCheck(assessment.checkId)) {
      hardFailures.push(`Assessment references unknown rubric check "${assessment.checkId}".`);
    }
  }
  for (const check of RELEASE_RESCUE_RUBRIC_V1) {
    if (!assessmentsById.has(check.id)) {
      hardFailures.push(`Rubric check "${check.id}" has no assessment. Every check needs an outcome, including not_assessed.`);
    }
  }

  // A blocking check may not be passed on argument alone. This is the rule that
  // stops "I reviewed the auth code and it looks correct" from clearing a
  // release gate; something a second reader can open has to back it.
  for (const check of RELEASE_RESCUE_RUBRIC_V1) {
    if (!check.blocking) continue;
    const assessment = assessmentsById.get(check.id);
    if (!assessment || assessment.outcome !== "pass") continue;
    const hasArtifact = assessment.evidence.some((entry) => isArtifactEvidence(entry.kind));
    if (!hasArtifact) {
      hardFailures.push(
        `Blocking check "${check.id}" is marked pass without artifact evidence. A blocking pass requires a code, configuration, test, policy, manifest, or runtime reference.`,
      );
    }
  }

  // --- findings ---
  const findingIds = report.findings.map((finding) => finding.findingId);
  const duplicateFindings = findingIds.filter((id, index) => findingIds.indexOf(id) !== index);
  for (const id of [...new Set(duplicateFindings)]) {
    hardFailures.push(`Finding id "${id}" appears more than once.`);
  }

  for (const finding of report.findings) {
    const findingCheck = validateFinding(finding);
    hardFailures.push(...findingCheck.failures);
  }

  // --- assessment / finding agreement ---
  const checksWithFindings = new Set(report.findings.map((finding) => finding.rubricCheckId));
  for (const finding of report.findings) {
    const assessment = assessmentsById.get(finding.rubricCheckId);
    if (!assessment) continue;
    if (assessment.outcome === "pass" || assessment.outcome === "not_applicable") {
      hardFailures.push(
        `Check "${finding.rubricCheckId}" is marked ${assessment.outcome} but carries finding ${finding.findingId}.`,
      );
    }
    if (assessment.outcome === "not_assessed") {
      hardFailures.push(
        `Check "${finding.rubricCheckId}" is marked not_assessed but carries finding ${finding.findingId}.`,
      );
    }
  }
  for (const assessment of report.assessments) {
    if (assessment.outcome === "fail" && !checksWithFindings.has(assessment.checkId)) {
      hardFailures.push(`Check "${assessment.checkId}" is marked fail but no finding explains it.`);
    }
  }

  // --- derived numbers ---
  const metrics = deriveReportMetrics(report.assessments, report.findings, report.authorityReport);

  for (const severity of FINDING_SEVERITIES) {
    if (report.severityCounts[severity] !== metrics.severityCounts[severity]) {
      hardFailures.push(
        `Report states ${report.severityCounts[severity]} ${severity} findings; recomputation from the findings gives ${metrics.severityCounts[severity]}.`,
      );
    }
  }
  if (report.blockingFindingCount !== metrics.blockingFindingCount) {
    hardFailures.push(
      `Report states ${report.blockingFindingCount} blocking findings; recomputation gives ${metrics.blockingFindingCount}.`,
    );
  }
  for (const [key, value] of Object.entries(metrics.coverage)) {
    const stated = report.coverage[key as keyof typeof metrics.coverage];
    if (stated !== value) {
      hardFailures.push(`Report coverage.${key} states ${stated}; recomputation gives ${value}.`);
    }
  }
  if (report.verdict !== metrics.verdict) {
    hardFailures.push(`Report states verdict "${report.verdict}"; recomputation gives "${metrics.verdict}".`);
  }

  // --- the customer's review-mode choice ---
  // A customer who declined AI-assisted review and receives an agent-prepared
  // report did not get what they agreed to. This is a hard failure rather than a
  // warning: the breach happened when the report was produced, and delivering it
  // would only compound it.
  if (!report.scope.aiAssistedReviewAccepted && report.preparedBy.executorKind === "agent") {
    hardFailures.push(
      "This engagement declined AI-assisted review, but the report was prepared by an agent executor.",
    );
  }

  // --- authority ---
  // The auditor is prepare-only. Any external action it reports is an incident,
  // not a detail: it means the engagement's authority boundary was crossed.
  if (metrics.authorityIncidentCount > 0) {
    const detail = Object.entries(report.authorityReport)
      .filter(([, count]) => count > 0)
      .map(([action, count]) => `${action}=${count}`)
      .join(", ");
    hardFailures.push(`The auditor reported ${metrics.authorityIncidentCount} external action(s) (${detail}). This review is prepare-only.`);
  }

  // --- content safety ---
  //
  // Three outcomes, not two. A boolean "contains something secret-shaped" was
  // wrong in both directions at once: `DB_PASS=pr0d-Xk92mQvn7Lz` was not
  // detected and shipped, while "Password: rotation policy is weak" — the
  // ordinary wording of a real finding — hard-failed the deliverable.
  //
  //   credential_evidence         refuses the report outright, as before.
  //   ambiguous_secret_candidate  is redacted for safety and HELD: not a
  //                               validation failure, but the delivery gate
  //                               refuses until a named human clears it.
  //   sensitive_prose             never reaches here; it is not a hit at all.
  const secretHits = scanForSecrets(report);
  for (const hit of secretHits) {
    if (blocksDelivery(hit.classification)) {
      hardFailures.push(`Unredacted secret material at ${hit.path} (${hit.detectors.join(", ")}).`);
    } else {
      warnings.push(
        `Possible secret material at ${hit.path} (${hit.detectors.join(", ")}). Held for human review before delivery.`,
      );
    }
  }

  // Field coverage, not a hand-written list of fields.
  //
  // The previous version walked six named fields. It missed
  // `scope.application.description`, which the schema itself describes as used
  // verbatim in the report header, so a customer could put a prohibited claim
  // into their own application description at intake and have it delivered.
  //
  // `checkReportFieldCoverage` walks the artifact instead, and a string whose
  // path has no recorded decision is a hard failure rather than a pass. That is
  // the part that holds: a new customer-visible field cannot be added without
  // someone classifying it.
  for (const failure of checkReportFieldCoverage(report)) {
    hardFailures.push(`Report field ${failure.path}: ${failure.reason}`);
  }

  // --- warnings (do not block, but a reviewer should see them) ---
  if (metrics.coverage.notAssessedChecks > 0) {
    warnings.push(
      `${metrics.coverage.notAssessedChecks} of ${metrics.coverage.totalChecks} rubric checks were not assessed. The verdict is capped at conditional_release.`,
    );
  }
  if (metrics.unconfirmedHighOrCriticalCount > 0) {
    warnings.push(
      `${metrics.unconfirmedHighOrCriticalCount} high or critical finding(s) are unconfirmed and need customer verification.`,
    );
  }
  if (report.findings.length === 0) {
    warnings.push("This report contains no findings. Confirm the review actually ran before delivering it.");
  }

  return { hardGatePass: hardFailures.length === 0, hardFailures, warnings, metrics };
}

// --- Delivery gate ------------------------------------------------------------------

export type DeliveryGate = {
  deliverable: boolean;
  blockers: string[];
};

/**
 * Whether a validated report may be sent to the customer.
 *
 * Separate from validation on purpose. A report can be perfectly well-formed and
 * still not deliverable, and the reason is almost always the same one: no human
 * has signed it. VISION.md holds that humans remain the accountable layer; an
 * AI-drafted report going to a paying customer with no named reviewer is exactly
 * the completion theater the product is supposed to refuse.
 */
/**
 * Every ambiguous secret candidate in the report that no human has cleared.
 *
 * Exported so the customer-facing view can say WHY a report is held, and so a
 * reviewer's console can list exactly what to look at.
 */
export function pendingSecretHolds(report: ReleaseRescueReportV1): SecretHold[] {
  const cleared = new Set(report.clearedSecretHolds.map((hold) => hold.path));
  return scanForSecrets(report)
    .filter((hit) => requiresHumanClearance(hit.classification))
    .filter((hit) => !cleared.has(hit.path))
    .map((hit) => ({
      path: hit.path,
      classification: hit.classification,
      reason:
        "The scanner could not tell this apart from ordinary security prose. It has been redacted and needs a human decision.",
    }));
}

export type SecretHold = {
  path: string;
  classification: SecretClassification;
  reason: string;
};

export function releaseRescueDeliveryGate(
  report: ReleaseRescueReportV1,
  validation: ValidationResult<ReleaseRescueReportMetrics>,
): DeliveryGate {
  const blockers: string[] = [];

  if (!validation.hardGatePass) {
    blockers.push("The report did not pass deterministic validation.");
  }
  if (report.reviewedBy === null) {
    blockers.push("No human reviewer has signed this report. An ops reviewer must approve before delivery.");
  }
  if (report.limitations.length === 0) {
    blockers.push("The report states no limitations.");
  }

  // Ambiguous secret candidates are held, not waved through.
  //
  // This is what stops the three-way classification becoming a way to ship the
  // uncertain cases: an item we could not confidently call prose is redacted AND
  // refused at the gate until a named reviewer records that they looked at it.
  // The customer-visible reason is carried on the report itself, so a held
  // report explains its own hold rather than simply failing to arrive.
  const holds = pendingSecretHolds(report);
  for (const hold of holds) {
    blockers.push(
      `Possible secret material at ${hold.path} is held for human review. A named reviewer must clear it before delivery.`,
    );
  }
  if (report.preparedBy.executorKind === "agent" && report.reviewedBy === null) {
    blockers.push("An agent-prepared report may never be delivered without human review.");
  }
  // Checked again here, and not only in validation, because this is the last
  // point before the artifact reaches the person who made the choice.
  if (!report.scope.aiAssistedReviewAccepted && report.preparedBy.executorKind === "agent") {
    blockers.push(
      "This engagement declined AI-assisted review. An agent-prepared report cannot be delivered for it.",
    );
  }

  return { deliverable: blockers.length === 0, blockers };
}
