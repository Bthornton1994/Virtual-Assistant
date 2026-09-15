import { z } from "zod";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import {
  CANONICAL_NON_CLAIMS,
  EVIDENCE_TYPES,
  EFFORT_LEVELS,
  EXECUTOR_TYPES,
  FINDING_SEVERITIES,
  READINESS_LEVELS,
  REPORT_STATUSES,
  RESCUE_SCHEMA_VERSION,
  RUBRIC_CATEGORIES,
  SCORE_LABELS,
  type FindingSeverity,
  type ReadinessLevel,
  type RubricCategory,
  type RubricScore,
} from "@/lib/ai-app-release-rescue/constants";
import { missingRubricCategories } from "@/lib/ai-app-release-rescue/rubric";
import { REDACTION_MARKER, redactSecretSnippets, scanTextForSecrets } from "@/lib/ai-app-release-rescue/secrets";

const identifier = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "must not have leading or trailing whitespace");

const evidenceSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES),
    location: z.string().trim().min(1).max(300),
    snippet: z.string().max(2000).nullable(),
    observation: z.string().max(1000).nullable(),
  })
  .strict();

const findingSchema = z
  .object({
    id: identifier,
    category: z.enum(RUBRIC_CATEGORIES),
    severity: z.enum(FINDING_SEVERITIES),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2000),
    evidence: evidenceSchema,
    impact: z.string().trim().min(1).max(1000),
    recommendation: z.string().trim().min(1).max(2000),
    effort: z.enum(EFFORT_LEVELS),
    remediation_sprint_eligible: z.boolean(),
    references: z.array(z.string().trim().min(1)).max(20),
  })
  .strict();

const rubricScoreSchema = z
  .object({
    category: z.enum(RUBRIC_CATEGORIES),
    score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    label: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(500),
    findings_count: z.number().int().min(0),
  })
  .strict();

const recommendationItemSchema = z
  .object({
    finding_id: identifier,
    action: z.string().trim().min(1).max(500),
  })
  .strict();

export const rescueReportSchema = z
  .object({
    schema_version: z.literal(RESCUE_SCHEMA_VERSION),
    engagement_id: identifier,
    organization_id: identifier,
    created_at: z.iso.datetime({ offset: true }),
    delivered_at: z.iso.datetime({ offset: true }).nullable(),
    status: z.enum(REPORT_STATUSES),
    scope: z
      .object({
        repository_url: z.string().trim().min(1),
        repository_ref: z.string().trim().min(1),
        deployment_url: z.string().trim().min(1).nullable(),
        app_type: z.string().trim().min(1),
        critical_workflow: z.string().trim().min(1),
      })
      .strict(),
    reviewer: z
      .object({
        executor_type: z.enum(EXECUTOR_TYPES),
        executor_id: identifier,
      })
      .strict(),
    non_claims: z.array(z.string().trim().min(1)).min(CANONICAL_NON_CLAIMS.length),
    summary: z
      .object({
        overall_readiness: z.enum(READINESS_LEVELS),
        critical_findings: z.number().int().min(0),
        high_findings: z.number().int().min(0),
        medium_findings: z.number().int().min(0),
        low_findings: z.number().int().min(0),
        informational_findings: z.number().int().min(0),
        recommendation: z.string().trim().min(1).max(1000),
        remediation_estimate: z.string().trim().min(1).max(400).nullable(),
      })
      .strict(),
    rubric_scores: z.array(rubricScoreSchema).min(RUBRIC_CATEGORIES.length),
    findings: z.array(findingSchema),
    recommendations: z
      .object({
        immediate: z.array(recommendationItemSchema),
        short_term: z.array(recommendationItemSchema),
        long_term: z.array(recommendationItemSchema),
        remediation_sprint: z
          .object({
            eligible: z.boolean(),
            eligible_findings: z.array(identifier),
            estimated_scope: z.string().trim().min(1).max(800),
          })
          .strict(),
      })
      .strict(),
    appendices: z
      .object({
        dependency_summary: z
          .object({
            total_dependencies: z.number().int().min(0),
            outdated: z.number().int().min(0),
            known_vulnerabilities: z
              .object({
                critical: z.number().int().min(0),
                high: z.number().int().min(0),
                medium: z.number().int().min(0),
                low: z.number().int().min(0),
              })
              .strict(),
            tool_used: z.string().trim().min(1),
          })
          .strict(),
        ci_cd_summary: z
          .object({
            pipeline_present: z.boolean(),
            lint_configured: z.boolean(),
            typecheck_configured: z.boolean(),
            test_configured: z.boolean(),
            build_configured: z.boolean(),
            deployment_target: z.string().trim().min(1).nullable(),
          })
          .strict(),
        accessibility_summary: z
          .object({
            tool_used: z.string().trim().min(1),
            pages_tested: z.number().int().min(0),
            critical_violations: z.number().int().min(0),
            serious_violations: z.number().int().min(0),
          })
          .strict(),
        review_metadata: z
          .object({
            review_start: z.iso.datetime({ offset: true }),
            review_end: z.iso.datetime({ offset: true }),
            repository_ref: z.string().trim().min(1),
            tools_used: z.array(z.string().trim().min(1)),
            ai_assisted: z.boolean(),
            ai_provider: z.string().trim().min(1).nullable(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type RescueReport = z.infer<typeof rescueReportSchema>;
export type RescueFinding = RescueReport["findings"][number];

export type CustomerRescueReport = Omit<RescueReport, "organization_id" | "reviewer"> & {
  reviewer: { executor_type: RescueReport["reviewer"]["executor_type"] };
};

export type FindingCounts = {
  critical_findings: number;
  high_findings: number;
  medium_findings: number;
  low_findings: number;
  informational_findings: number;
};

export function countFindings(findings: Array<{ severity: FindingSeverity }>): FindingCounts {
  const counts: FindingCounts = {
    critical_findings: 0,
    high_findings: 0,
    medium_findings: 0,
    low_findings: 0,
    informational_findings: 0,
  };
  for (const finding of findings) {
    if (finding.severity === "critical") counts.critical_findings += 1;
    else if (finding.severity === "high") counts.high_findings += 1;
    else if (finding.severity === "medium") counts.medium_findings += 1;
    else if (finding.severity === "low") counts.low_findings += 1;
    else counts.informational_findings += 1;
  }
  return counts;
}

export function deriveOverallReadiness(findings: Array<{ severity: FindingSeverity }>): ReadinessLevel {
  const counts = countFindings(findings);
  if (counts.critical_findings > 0) return "not_ready";
  if (counts.high_findings > 0) return "ready_with_caveats";
  return "ready";
}

export function scoreLabel(score: RubricScore) {
  return SCORE_LABELS[score];
}

export type ReportGate = {
  hardGatePass: boolean;
  hardFailures: string[];
  warnings: string[];
  report: RescueReport | null;
  customerReport: CustomerRescueReport | null;
  contentHash: string | null;
};

function collectStrings(value: unknown, path: string, acc: Array<{ path: string; value: string }>) {
  if (typeof value === "string") acc.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, acc));
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) collectStrings(nested, `${path}.${key}`, acc);
  }
}

function locationLooksAbsolute(location: string) {
  return location.startsWith("/") && !location.startsWith("./") && /\/(Users|home|var|etc)\//.test(location);
}

export function toCustomerReport(report: RescueReport): CustomerRescueReport {
  return {
    schema_version: report.schema_version,
    engagement_id: report.engagement_id,
    created_at: report.created_at,
    delivered_at: report.delivered_at,
    status: report.status,
    scope: report.scope,
    reviewer: { executor_type: report.reviewer.executor_type },
    non_claims: report.non_claims,
    summary: report.summary,
    rubric_scores: report.rubric_scores,
    findings: report.findings,
    recommendations: report.recommendations,
    appendices: report.appendices,
  };
}

export function validateRescueReport(input: unknown): ReportGate {
  const hardFailures: string[] = [];
  const warnings: string[] = [];
  const parsed = rescueReportSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      hardFailures.push(`${issue.path.join(".") || "report"}: ${issue.message}`);
    }
    return { hardGatePass: false, hardFailures, warnings, report: null, customerReport: null, contentHash: null };
  }

  const report = parsed.data;
  for (const claim of CANONICAL_NON_CLAIMS) {
    if (!report.non_claims.includes(claim)) {
      hardFailures.push(`non_claims is missing required text: "${claim}"`);
    }
  }

  const missingCategories = missingRubricCategories(report.rubric_scores.map((row) => row.category));
  if (missingCategories.length > 0) {
    hardFailures.push(`rubric_scores missing categories: ${missingCategories.join(", ")}`);
  }

  const scoredCategories = new Set<string>();
  for (const row of report.rubric_scores) {
    if (scoredCategories.has(row.category)) hardFailures.push(`Duplicate rubric category "${row.category}"`);
    scoredCategories.add(row.category);
    const expectedLabel = SCORE_LABELS[row.score];
    if (row.label !== expectedLabel) {
      hardFailures.push(`Category ${row.category} label "${row.label}" does not match score ${row.score}`);
    }
    const categoryCount = report.findings.filter((finding) => finding.category === row.category).length;
    if (row.findings_count !== categoryCount) {
      hardFailures.push(`Category ${row.category} findings_count ${row.findings_count} != ${categoryCount}`);
    }
  }

  const findingIds = new Set<string>();
  for (const finding of report.findings) {
    if (findingIds.has(finding.id)) hardFailures.push(`Duplicate finding id ${finding.id}`);
    findingIds.add(finding.id);
    if (finding.evidence.location.startsWith("/") && locationLooksAbsolute(finding.evidence.location)) {
      hardFailures.push(`${finding.id} evidence.location must be a repository-relative path`);
    }
    if (finding.severity === "medium" || finding.severity === "high" || finding.severity === "critical") {
      if (finding.recommendation.trim().length < 12) {
        hardFailures.push(`${finding.id} needs a specific recommendation`);
      }
    }
    if (finding.evidence.snippet && hasUnredactedSecretInReportField(finding.evidence.snippet)) {
      hardFailures.push(`${finding.id} snippet contains a secret value`);
    }
  }

  const computed = countFindings(report.findings);
  const derived = deriveOverallReadiness(report.findings);
  if (report.summary.overall_readiness !== derived) {
    hardFailures.push(
      `summary.overall_readiness "${report.summary.overall_readiness}" does not match derived "${derived}"`,
    );
  }
  for (const key of Object.keys(computed) as Array<keyof FindingCounts>) {
    if (report.summary[key] !== computed[key]) {
      hardFailures.push(`summary.${key} ${report.summary[key]} != computed ${computed[key]}`);
    }
  }

  const recIds = [
    ...report.recommendations.immediate,
    ...report.recommendations.short_term,
    ...report.recommendations.long_term,
  ].map((item) => item.finding_id);
  for (const id of recIds) {
    if (!findingIds.has(id)) hardFailures.push(`Recommendation references unknown finding ${id}`);
  }
  for (const id of report.recommendations.remediation_sprint.eligible_findings) {
    if (!findingIds.has(id)) hardFailures.push(`Remediation sprint references unknown finding ${id}`);
    const finding = report.findings.find((item) => item.id === id);
    if (finding && !finding.remediation_sprint_eligible) {
      hardFailures.push(`${id} is listed for the sprint but is not eligible`);
    }
  }

  if (report.appendices.review_metadata.ai_assisted && !report.appendices.review_metadata.ai_provider) {
    hardFailures.push("ai_provider is required when ai_assisted is true");
  }
  if (!report.appendices.review_metadata.ai_assisted && report.appendices.review_metadata.ai_provider) {
    hardFailures.push("ai_provider must be null when ai_assisted is false");
  }

  const strings: Array<{ path: string; value: string }> = [];
  collectStrings(toCustomerReport(report), "report", strings);
  for (const { path, value } of strings) {
    if (path.endsWith("executor_id") || path.endsWith("organization_id")) {
      hardFailures.push(`Customer report leaked ${path}`);
    }
    if (hasUnredactedSecretInReportField(value)) {
      hardFailures.push(`${path} contains a secret value`);
    }
  }

  if (hardFailures.length > 0) {
    return { hardGatePass: false, hardFailures, warnings, report: null, customerReport: null, contentHash: null };
  }

  const customerReport = toCustomerReport(report);
  return {
    hardGatePass: true,
    hardFailures: [],
    warnings,
    report,
    customerReport,
    contentHash: sha256Hex(customerReport),
  };
}

function hasUnredactedSecretInReportField(value: string) {
  if (value.includes(REDACTION_MARKER)) {
    const scan = scanTextForSecrets(value);
    return !scan.ok;
  }
  return !scanTextForSecrets(value).ok;
}

export function presentRescueReport(input: unknown): ReportGate {
  const gate = validateRescueReport(input);
  if (!gate.hardGatePass || !gate.report) return gate;
  const findings = gate.report.findings.map((finding) => ({
    ...finding,
    evidence: {
      ...finding.evidence,
      snippet: finding.evidence.snippet ? redactSecretSnippets(finding.evidence.snippet) : null,
    },
  }));
  const computed = countFindings(findings);
  const normalized: RescueReport = {
    ...gate.report,
    findings,
    summary: {
      ...gate.report.summary,
      ...computed,
      overall_readiness: deriveOverallReadiness(findings),
    },
  };
  return validateRescueReport(normalized);
}

export function isRubricCategory(value: string): value is RubricCategory {
  return (RUBRIC_CATEGORIES as readonly string[]).includes(value);
}
