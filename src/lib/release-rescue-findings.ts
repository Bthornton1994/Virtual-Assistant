import { z } from "zod";
import { identifierString, nonEmptyString } from "@/lib/catalog-evidence-shared";
import { getRubricCheck, rubricDimensionSchema, type RubricCheck } from "@/lib/release-rescue-rubric";

// The finding contract and the severity model.
//
// The central decision in this file: an auditor states OBSERVATIONS, and
// severity is DERIVED from them. It is never a label the auditor chooses.
//
// That is not a style preference. Severity drives the release verdict, the
// remediation-sprint pitch, and what the customer does on release day. An AI
// executor asked to pick a severity label has every incentive to reach for
// "critical" — it reads as thorough, and it sells the $1,250 sprint. So the
// executor answers three narrower questions it can actually evidence:
//
//   impact          — how bad is the outcome if this is exercised?
//   exploitability  — what does someone need in order to exercise it?
//   confidence      — did we prove it, or do we suspect it?
//
// and a fixed table turns those into severity. Two reviewers who agree on the
// observations cannot disagree on the severity, and a report whose stored
// severity does not match the recomputation is rejected as tampered.

export const RELEASE_RESCUE_FINDING_SCHEMA_VERSION = "release-rescue-finding/v1" as const;

export const FINDING_IMPACTS = ["none", "limited", "serious", "severe"] as const;
export type FindingImpact = (typeof FINDING_IMPACTS)[number];

export const FINDING_EXPLOITABILITIES = [
  "theoretical",
  "requires_privilege",
  "requires_user_interaction",
  "remote_unauthenticated",
] as const;
export type FindingExploitability = (typeof FINDING_EXPLOITABILITIES)[number];

export const FINDING_CONFIDENCES = ["confirmed", "likely", "possible"] as const;
export type FindingConfidence = (typeof FINDING_CONFIDENCES)[number];

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "informational"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const REMEDIATION_EFFORTS = ["trivial", "small", "medium", "large"] as const;
export type RemediationEffort = (typeof REMEDIATION_EFFORTS)[number];

const SEVERITY_RANK: Readonly<Record<FindingSeverity, number>> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const RANK_TO_SEVERITY: readonly FindingSeverity[] = ["informational", "low", "medium", "high", "critical"];

/**
 * Base severity before confidence is applied.
 *
 * Read down a column to see the intent: the same outcome gets progressively less
 * severe as the attacker needs more to reach it. `theoretical` never reaches
 * high on its own — a real path to the problem has to be shown first.
 */
const BASE_SEVERITY: Readonly<Record<FindingImpact, Readonly<Record<FindingExploitability, FindingSeverity>>>> = {
  severe: {
    remote_unauthenticated: "critical",
    requires_user_interaction: "high",
    requires_privilege: "high",
    theoretical: "medium",
  },
  serious: {
    remote_unauthenticated: "high",
    requires_user_interaction: "medium",
    requires_privilege: "medium",
    theoretical: "low",
  },
  limited: {
    remote_unauthenticated: "medium",
    requires_user_interaction: "low",
    requires_privilege: "low",
    theoretical: "low",
  },
  none: {
    remote_unauthenticated: "informational",
    requires_user_interaction: "informational",
    requires_privilege: "informational",
    theoretical: "informational",
  },
};

/**
 * Confidence caps severity; it never raises it.
 *
 * An unproven suspicion is worth reporting and worth the customer's time to
 * check, but it is not worth telling them their release is blocked. Only
 * `confirmed` reaches critical, and only `confirmed` can block — see
 * `computeFindingBlocking`.
 */
const CONFIDENCE_CEILING: Readonly<Record<FindingConfidence, FindingSeverity>> = {
  confirmed: "critical",
  likely: "high",
  possible: "medium",
};

export type SeverityInputs = {
  impact: FindingImpact;
  exploitability: FindingExploitability;
  confidence: FindingConfidence;
};

export function computeFindingSeverity(inputs: SeverityInputs): FindingSeverity {
  const base = BASE_SEVERITY[inputs.impact][inputs.exploitability];
  const ceiling = CONFIDENCE_CEILING[inputs.confidence];
  const rank = Math.min(SEVERITY_RANK[base], SEVERITY_RANK[ceiling]);
  return RANK_TO_SEVERITY[rank];
}

/**
 * Whether this finding stops the release verdict.
 *
 * Confirmation is required in every case: we do not block a customer's release
 * on a suspicion. Beyond that, a confirmed CRITICAL blocks wherever it was
 * found — the rubric's `blocking` flag marks which checks are release gates,
 * and a proven critical outranks that classification rather than being filed
 * under it. A confirmed HIGH blocks only on a check the rubric gates.
 *
 * An unconfirmed critical is loud in the report and absent from this gate. It
 * still holds the verdict at `conditional_release` (see the report contract),
 * so it is neither used to block a release nor quietly dropped.
 */
export function computeFindingBlocking(check: RubricCheck, severity: FindingSeverity, confidence: FindingConfidence): boolean {
  if (confidence !== "confirmed") return false;
  if (severity === "critical") return true;
  return check.blocking && SEVERITY_RANK[severity] >= SEVERITY_RANK.high;
}

export function severityRank(severity: FindingSeverity): number {
  return SEVERITY_RANK[severity];
}

// --- Schemas ------------------------------------------------------------------------

/**
 * A repository-relative path inside the reviewed snapshot.
 *
 * Refuses absolute paths, parent traversal, and URLs. A finding points inside
 * the one repository in scope; anything else is either a mistake or an auditor
 * wandering outside the engagement, and both are worth failing on.
 */
export const repositoryPathSchema = identifierString
  .max(400)
  .refine((value) => !value.startsWith("/"), "must be repository-relative, not absolute")
  .refine((value) => !value.includes(".."), "must not contain parent traversal")
  .refine((value) => !value.includes("://"), "must be a path, not a URL");

/**
 * Field names that used to carry customer source, or that an executor might
 * reach for to smuggle it back in.
 *
 * A finding POINTS AT source; it does not carry it. Ten independent audits
 * turned on a credential detector trying to make a copied source excerpt safe to
 * ship, and the last of them reported the detector both leaking credentials and
 * permanently bricking correct reports in the same commit. The excerpt is gone,
 * so the property is now structural rather than probabilistic: there is no
 * customer source in the artifact to redact wrongly or to leak.
 *
 * `.strict()` below already rejects an unknown key. This list exists so the
 * refusal NAMES the field, because a legacy caller sending `excerpt` deserves to
 * be told what changed rather than getting "unrecognized key".
 */
export const FORBIDDEN_SOURCE_FIELDS: readonly string[] = [
  "excerpt",
  "excerpts",
  "snippet",
  "snippets",
  "code",
  "codeSnippet",
  "source",
  "sourceText",
  "sourceWindow",
  "window",
  "context",
  "contextLines",
  "lines",
  "content",
  "body",
  "raw",
  "rawSource",
  "text",
  "span",
  "spans",
  "match",
  "matchedText",
];

/**
 * A finding location: where to look, never what is there.
 *
 * `path`, `startLine` and `endLine` are everything a customer needs to open the
 * file and see the finding for themselves, in their own checkout, where the
 * source already is. Nothing here is derived from the CONTENT of that file.
 */
export const findingLocationSchema = z
  .object({
    path: repositoryPathSchema,
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
  })
  .strict()
  .refine(
    (location) => location.startLine === null || location.endLine === null || location.endLine >= location.startLine,
    { message: "endLine must not precede startLine", path: ["endLine"] },
  );

/**
 * Names a forbidden source-carrying field on an object, or null.
 *
 * Used at the assembly boundary as well as by the schema, so a caller building a
 * report through the typed path and a caller arriving through `any` get the same
 * refusal with the same wording.
 */
export function findForbiddenSourceField(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_SOURCE_FIELDS.includes(key)) return key;
  }
  return null;
}

export const releaseRescueFindingV1Schema = z
  .object({
    schemaVersion: z.literal(RELEASE_RESCUE_FINDING_SCHEMA_VERSION),
    findingId: identifierString.max(100),
    rubricCheckId: identifierString.max(200),
    dimension: rubricDimensionSchema,
    title: nonEmptyString.max(200),
    /** What the auditor saw. Observation, not inference. */
    whatWeObserved: nonEmptyString.max(4000),
    /** Why it matters for THIS release, not in general. */
    whyItMatters: nonEmptyString.max(4000),
    /** What the customer should do. Actionable, specific to the code. */
    recommendation: nonEmptyString.max(4000),
    impact: z.enum(FINDING_IMPACTS),
    exploitability: z.enum(FINDING_EXPLOITABILITIES),
    confidence: z.enum(FINDING_CONFIDENCES),
    /** Derived. Stored so a reader sees it; verified so it cannot be edited. */
    severity: z.enum(FINDING_SEVERITIES),
    /** Derived from the rubric check, the severity, and the confidence. */
    blocking: z.boolean(),
    locations: z.array(findingLocationSchema).max(20),
    remediationEffort: z.enum(REMEDIATION_EFFORTS),
    /** Whether the remediation sprint would cover this. Commercial, not technical. */
    inRemediationSprintScope: z.boolean(),
    /** What the auditor could not establish. Non-empty when confidence is not `confirmed`. */
    residualUncertainty: z.string().max(2000),
  })
  .strict();

export type ReleaseRescueFindingV1 = z.infer<typeof releaseRescueFindingV1Schema>;

export type FindingValidation = {
  ok: boolean;
  failures: string[];
};

/**
 * Checks one finding beyond what the schema can express.
 *
 * The schema proves shape. This proves the derived fields were not authored: it
 * recomputes severity and blocking from the observations and rejects a mismatch.
 * That is the specific defence against an executor — or anyone editing a stored
 * artifact — writing `"severity": "critical"` next to observations that do not
 * support it.
 */
export function validateFinding(finding: ReleaseRescueFindingV1): FindingValidation {
  const failures: string[] = [];
  const check = getRubricCheck(finding.rubricCheckId);

  if (!check) {
    failures.push(`Finding ${finding.findingId} references unknown rubric check "${finding.rubricCheckId}".`);
    return { ok: false, failures };
  }

  if (check.dimension !== finding.dimension) {
    failures.push(
      `Finding ${finding.findingId} declares dimension "${finding.dimension}" but check "${check.id}" belongs to "${check.dimension}".`,
    );
  }

  const expectedSeverity = computeFindingSeverity(finding);
  if (finding.severity !== expectedSeverity) {
    failures.push(
      `Finding ${finding.findingId} stores severity "${finding.severity}" but its impact/exploitability/confidence derive "${expectedSeverity}".`,
    );
  }

  const expectedBlocking = computeFindingBlocking(check, expectedSeverity, finding.confidence);
  if (finding.blocking !== expectedBlocking) {
    failures.push(
      `Finding ${finding.findingId} stores blocking=${finding.blocking} but the rubric and severity derive ${expectedBlocking}.`,
    );
  }

  // An unproven finding that does not say what is unproven is not reportable:
  // the customer cannot act on "maybe" without knowing what to go and check.
  if (finding.confidence !== "confirmed" && finding.residualUncertainty.trim().length === 0) {
    failures.push(
      `Finding ${finding.findingId} has confidence "${finding.confidence}" and must state its residual uncertainty.`,
    );
  }

  // A confirmed finding asserts something was proven, so it has to point at the
  // thing that proves it.
  if (finding.confidence === "confirmed" && finding.locations.length === 0) {
    failures.push(`Finding ${finding.findingId} is confirmed and must cite at least one location.`);
  }

  return { ok: failures.length === 0, failures };
}
