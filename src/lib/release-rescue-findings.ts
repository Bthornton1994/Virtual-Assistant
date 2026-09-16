import { z } from "zod";
import { identifierString, nonEmptyString } from "@/lib/catalog-evidence-shared";
import {
  describeQuotedCredentialConstructs,
  findQuotedCredentialConstructs,
} from "@/lib/release-rescue-prose";
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
 * The characters a repository path is made of.
 *
 * Unicode letters and digits, plus `. _ - + @ ~ ( ) [ ]`. An earlier version was
 * ASCII-only and refused `src/resume.ts` spelled with accents, and
 * `src/<kanji>/page.tsx` — ordinary file names in most of the world. `\p{L}`
 * fixes that without widening anything that matters: a letter is not punctuation.
 *
 * NO SPACES. The first version allowed single spaces between words so that
 * `docs/Architecture Overview.md` would validate. An audit used that to put
 * `config app.env holds the value Xk92mQvn7Lz on line 14` in the field — a
 * sentence carrying a credential, validated, stored and rendered as a path. A
 * file name with a space is rarer than that attack, and an auditor whose
 * customer has one cites the directory instead.
 */
const PATH_SEGMENT = "[\\p{L}\\p{N}._@+~()\\[\\]-]+";
export const REPOSITORY_PATH_PATTERN = new RegExp(`^${PATH_SEGMENT}(/${PATH_SEGMENT})*$`, "u");

/** No segment of a real repository path is longer than this. */
const MAX_PATH_SEGMENT_LENGTH = 255;

/**
 * True when a path actually walks upward, rather than merely containing dots.
 *
 * The rule was `!value.includes("..")`, present since this workstream's first
 * commit. It refused `app/api/auth/[...nextauth]/route.ts` — the most common
 * authentication entry point in this product's target framework, on a dimension
 * the rubric gates at weight 3. A confirmed finding must cite a location, so an
 * auth finding on that route could not be recorded at all. Three dots inside a
 * route bracket are not traversal; a `..` SEGMENT is.
 */
function walksUpward(value: string): boolean {
  return value.split("/").some((segment) => segment === ".." || segment === ".");
}

/**
 * A repository-relative path inside the reviewed snapshot.
 *
 * Refuses absolute paths, parent traversal, and URLs. A finding points inside
 * the one repository in scope; anything else is either a mistake or an auditor
 * wandering outside the engagement, and both are worth failing on.
 *
 * It also refuses anything that is not SHAPED like a path, and that part is a
 * security boundary rather than hygiene. With the excerpt field gone, `path` is
 * the only remaining place in a finding whose value comes from the customer's
 * repository, and without a grammar it was `identifierString.max(400)` — four
 * hundred characters of anything, newlines included. A source window pasted into
 * `locations[].path` would have validated, stored, and rendered. The grammar
 * closes that: no control characters, no quotes, no assignment or statement
 * punctuation, no empty segments, and no spaces, so a sentence is not a path.
 *
 * What a grammar cannot do is make a path-shaped string harmless — `AKIA...` is
 * a legal file name — so this is not the only control on the field. Every string
 * in a report, this one included, goes through `sanitizeReportInput` before
 * assembly, which redacts credential material and raises a hold.
 *
 * The two together are not a guarantee, and an audit caught an earlier version
 * of this comment saying they were. The grammar removes the pasted-window
 * channel; the scanner catches what it recognises in what is left. A token the
 * scanner does not recognise, in a value the grammar considers path-shaped, is
 * caught by neither — the same gap `release-rescue-prose.ts` documents for the
 * prose fields, and the named human reviewer is what stands there.
 */
export const repositoryPathSchema = identifierString
  .max(400)
  .refine((value) => !value.startsWith("/"), "must be repository-relative, not absolute")
  .refine((value) => !walksUpward(value), "must not contain a parent-traversal segment")
  .refine((value) => !value.includes("://"), "must be a path, not a URL")
  .refine(
    (value) => REPOSITORY_PATH_PATTERN.test(value),
    "must be a repository path, not source text: letters, digits and `. _ - + @ ~ ( ) [ ]`, separated by `/`, with no spaces",
  )
  .refine(
    (value) => value.split("/").every((segment) => segment.length <= MAX_PATH_SEGMENT_LENGTH),
    `each path segment must be at most ${MAX_PATH_SEGMENT_LENGTH} characters`,
  );

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
 * source already is.
 *
 * The line numbers are not derived from the file's content. The PATH is — it is
 * a name taken from the customer's repository — which an audit pointed out after
 * an earlier version of this comment claimed otherwise. `repositoryPathSchema`
 * constrains it to a path SHAPE, which stops it becoming the source window the
 * excerpt used to be. It does not stop it being a single token that happens to
 * be a credential; nothing here can, and the comment above says what does.
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
 */
export function findForbiddenSourceField(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_SOURCE_FIELDS.includes(key)) return key;
  }
  return null;
}

/** Where a forbidden field was seen. The VALUE is never carried out of here. */
export type SourceFieldSighting = {
  /** A JSON path such as `findings[2].locations[0]`. */
  at: string;
  field: string;
};

/**
 * Finds forbidden source-carrying fields on findings and their locations.
 *
 * Scoped to exactly what the database guard walks — a finding object and its
 * location objects — so the two enforcement points answer the same question. A
 * wider walk would start refusing report internals that legitimately have a
 * `reason` or a `context`, and a narrower one would leave a hole under
 * `locations[]`.
 *
 * `.strict()` on the schemas already refuses an unknown key, but only for input
 * that reaches a schema, and only as "unrecognized key". This runs at the
 * assembly boundary, where input arrives through `Sanitized<T>` without a parse,
 * and on a stored artifact read back as `unknown` — and it names the field, so a
 * caller still sending `excerpt` is told what changed rather than being told
 * their key is unrecognised.
 */
export function findSourceFieldsInFindings(findings: unknown): SourceFieldSighting[] {
  if (!Array.isArray(findings)) return [];

  const sightings: SourceFieldSighting[] = [];
  findings.forEach((finding, index) => {
    const onFinding = findForbiddenSourceField(finding);
    if (onFinding) sightings.push({ at: `findings[${index}]`, field: onFinding });

    const locations = (finding as { locations?: unknown } | null)?.locations;
    if (!Array.isArray(locations)) return;
    locations.forEach((location, locationIndex) => {
      const onLocation = findForbiddenSourceField(location);
      if (onLocation) {
        sightings.push({ at: `findings[${index}].locations[${locationIndex}]`, field: onLocation });
      }
    });
  });

  return sightings;
}

/** One sentence naming every sighting, or null when there are none. */
export function describeSourceFieldSightings(sightings: readonly SourceFieldSighting[]): string | null {
  if (sightings.length === 0) return null;
  return `A Release Rescue finding carries source-bearing fields that were removed from this contract: ${sightings
    .map((sighting) => `${sighting.at}.${sighting.field}`)
    .join(", ")}. A finding cites path and line; it does not carry the source. The offending values are withheld from this message deliberately.`;
}

/**
 * Refuses findings that carry source-bearing fields.
 *
 * Throws rather than blanking the field. Blanking after assembly would mean the
 * value existed in this process, in this object, and in whatever logged it on
 * the way here; refusing means the report is never built.
 */
export function assertNoSourceFieldsInFindings(findings: unknown, context: string): void {
  const message = describeSourceFieldSightings(findSourceFieldsInFindings(findings));
  if (message) throw new Error(`${context}: ${message}`);
}

/**
 * A prose field an auditor authors, which may describe but may not quote.
 *
 * The refusal is a REFUSAL, not a scrub: blanking after assembly would mean the
 * value existed in this process and in whatever logged it on the way here. See
 * `release-rescue-prose.ts` for why this is about the construct and never about
 * the value.
 */
export function observationField(maxLength: number) {
  return nonEmptyString.max(maxLength).superRefine((value, ctx) => {
    const message = describeQuotedCredentialConstructs(
      findQuotedCredentialConstructs(value),
      "This field",
    );
    if (message) ctx.addIssue({ code: "custom", message });
  });
}

/** The same rule for a field that is allowed to be empty. */
export function optionalObservationField(maxLength: number) {
  return z
    .string()
    .max(maxLength)
    .superRefine((value, ctx) => {
      const message = describeQuotedCredentialConstructs(
        findQuotedCredentialConstructs(value),
        "This field",
      );
      if (message) ctx.addIssue({ code: "custom", message });
    });
}

export const releaseRescueFindingV1Schema = z
  .object({
    schemaVersion: z.literal(RELEASE_RESCUE_FINDING_SCHEMA_VERSION),
    findingId: identifierString.max(100),
    rubricCheckId: identifierString.max(200),
    dimension: rubricDimensionSchema,
    /** The headline a customer reads. Executor-written, so same prose contract. */
    title: observationField(200),
    /** What the auditor saw. Observation, not inference. */
    whatWeObserved: observationField(4000),
    /** Why it matters for THIS release, not in general. */
    whyItMatters: observationField(4000),
    /** What the customer should do. Actionable, specific to the code. */
    recommendation: observationField(4000),
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
    residualUncertainty: optionalObservationField(2000),
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
