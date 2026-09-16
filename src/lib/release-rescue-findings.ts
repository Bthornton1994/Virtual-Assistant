import { z } from "zod";
import { identifierString } from "@/lib/catalog-evidence-shared";
import {
  computeFindingBlocking,
  computeFindingSeverity,
  FINDING_CONFIDENCES,
  FINDING_EXPLOITABILITIES,
  FINDING_IMPACTS,
  FINDING_SEVERITIES,
  REMEDIATION_EFFORTS,
  type FindingConfidence,
} from "@/lib/release-rescue-findings-model";
import {
  getObservation,
  getRemediation,
  isUncertaintyCode,
  OBSERVATION_CODES,
  REMEDIATION_CODES,
  UNCERTAINTY_CODES,
  type ObservationCode,
  type RemediationCode,
  type UncertaintyCode,
} from "@/lib/release-rescue-observation-catalog";
import { getRubricCheck, rubricDimensionSchema, rubricEvidenceKindSchema } from "@/lib/release-rescue-rubric";

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

export const RELEASE_RESCUE_FINDING_SCHEMA_VERSION = "release-rescue-finding/v2" as const;

export {
  FINDING_IMPACTS,
  FINDING_EXPLOITABILITIES,
  FINDING_CONFIDENCES,
  FINDING_SEVERITIES,
  REMEDIATION_EFFORTS,
  computeFindingSeverity,
  computeFindingBlocking,
  severityRank,
} from "@/lib/release-rescue-findings-model";
export type {
  FindingImpact,
  FindingExploitability,
  FindingConfidence,
  FindingSeverity,
  RemediationEffort,
  SeverityInputs,
} from "@/lib/release-rescue-findings-model";


// --- Schemas ------------------------------------------------------------------------

/**
 * The characters a repository path is made of.
 *
 * Unicode letters and digits, plus `. _ - + @ ~ ( ) [ ]`. An earlier version was
 * ASCII-only and refused `src/resume.ts` spelled with accents, and
 * `src/<kanji>/page.tsx` — ordinary file names in most of the world. `\p{L}`
 * fixes that without widening anything that matters: a letter is not punctuation.
 *
 * `$ , & ! \' { } # %` are in the set because real route files use them:
 * `app/routes/users.$userId.edit.tsx` is every dynamic route in Remix and React
 * Router v7, and an audit found the first version of this grammar refusing all
 * of them. `=` is deliberately NOT in the set — it is the character the prose
 * contract keys on, and SvelteKit\'s `[id=integer]` matcher is the only real
 * path that needs it.
 *
 * NO SPACES. The first version allowed single spaces between words so that
 * `docs/Architecture Overview.md` would validate. An audit used that to put
 * `config app.env holds the value Xk92mQvn7Lz on line 14` in the field — a
 * sentence carrying a credential, validated, stored and rendered as a path. A
 * file name with a space is rarer than that attack, and an auditor whose
 * customer has one cites the directory instead.
 */
/**
 * The characters a path segment may hold, as a character CLASS.
 *
 * `\\p{M}` is not decoration. Devanagari, Bengali, Tamil, Thai and Khmer need
 * combining marks to spell anything, and so does every NFD-normalised Latin
 * path — which is the form an APFS or HFS+ filesystem hands back, so
 * `src/café/resumé.ts` validated in NFC and was refused in NFD: the same file,
 * in the same repository, answered two ways. An audit found it while the test
 * corpus for "every non-ASCII filename works" was five entries built only from
 * `\\p{L}`, which is exactly what the rule declared legal.
 *
 * The `-` is escaped for the same reason the class is exported: the policy
 * appends `/` to it, and an unescaped trailing `-` turned into a RANGE
 * operator, so the boundary silently accepted `%`–`/` — including the asterisk,
 * making a glob a legal path there and not here. A mutation that appended a
 * character sorting below `-` made the whole expression throw at module load
 * and took thirteen test files down with it.
 *
 * Exported because the field-coverage policy re-asserts the path grammar at the
 * artifact boundary and must not invent its own. It restated this class by hand
 * once: ASCII-only, without `$ , & ! \' { } # %`, which refused every Remix and
 * React Router v7 dynamic route and every non-ASCII filename — thirteen of a
 * forty-path corpus, and two classes an earlier audit had already fixed HERE.
 * A boundary check stricter than the schema refuses reports the product
 * considers correct. Deriving it is the only way that cannot drift.
 */
export const PATH_SEGMENT_CHARACTERS = "\\p{L}\\p{M}\\p{N}._@+~()\\[\\]$,&!'{}#%\\-";

const PATH_SEGMENT = `[${PATH_SEGMENT_CHARACTERS}]+`;
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
 * caught by neither, and the named human reviewer is what stands there.
 *
 * `release-rescue-prose.ts` is GONE. It refused credential constructs in
 * executor prose, and four rounds established that the question it asked has no
 * safe answer. There is no prose left for it to ask about: a finding carries
 * codes and the catalog carries the words. Deleting it rather than leaving it
 * unused is deliberate — an orphaned module that claims a safety property is how
 * three separate audits found this codebase asserting more than it implemented.
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
 * Field names that used to carry executor- or customer-written NARRATIVE.
 *
 * Distinct from the list above, and for a different reason. Those fields carried
 * a copy of the customer's source. These carried sentences somebody wrote about
 * it — the finding's title, what we observed, why it matters, the
 * recommendation, the residual uncertainty, an assessment's rationale, the
 * customer's own application and workflow descriptions, a reviewer's clearance
 * note.
 *
 * Four rounds of measurement established that no rule over such a sentence can
 * keep a credential out of it: a rule keyed on an assignment construct is walked
 * straight past by `DB_PASSWORD is set to <value>`, and a rule strict enough to
 * catch that refuses fifteen of twenty-one sentences an auditor legitimately
 * needs to write. So the fields are gone and the words come from a frozen
 * catalog, keyed by code.
 *
 * The names stay here so that a caller still sending one is told WHAT CHANGED.
 * "unrecognized key: whatWeObserved" is a true message that teaches nothing; the
 * refusal below says the contract composes that sentence from a code now.
 */
export const FORBIDDEN_NARRATIVE_FIELDS: readonly string[] = [
  "title",
  "whatWeObserved",
  "whatWeFound",
  "whyItMatters",
  "recommendation",
  "recommendations",
  "remediation",
  "residualUncertainty",
  "uncertainty",
  "rationale",
  "reasoning",
  "justification",
  "description",
  "summary",
  "detail",
  "details",
  "narrative",
  "explanation",
  "note",
  "notes",
  "comment",
  "comments",
  "observation",
  "observations",
  "finding",
  "message",
  "prose",
  "limitations",
  "customerExclusions",
  "exclusions",
];

/** Every field name a finding, an assessment or a report may not carry. */
export const FORBIDDEN_REPORT_TEXT_FIELDS: readonly string[] = [
  ...FORBIDDEN_SOURCE_FIELDS,
  ...FORBIDDEN_NARRATIVE_FIELDS,
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
    if (FORBIDDEN_REPORT_TEXT_FIELDS.includes(key)) return key;
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

    // Both child collections, not just `locations`. `evidence` was added with
    // the same shape and the same one value taken from the customer's
    // repository, and a walk that covered one and not the other would leave the
    // newer of the two unguarded — which is how the original gap happened.
    for (const collection of ["locations", "evidence"] as const) {
      const entries = (finding as Record<string, unknown> | null)?.[collection];
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, entryIndex) => {
        const onEntry = findForbiddenSourceField(entry);
        if (onEntry) {
          sightings.push({ at: `findings[${index}].${collection}[${entryIndex}]`, field: onEntry });
        }
      });
    }
  });

  return sightings;
}

/**
 * The same question, asked of rubric assessments.
 *
 * An assessment used to carry a `rationale` — executor-written, rendered beside
 * the check, and every bit as reachable as a finding's prose. It now carries a
 * `rationaleCode`. This walk is what tells a caller still sending the old field
 * that the contract changed, on the same terms as the findings walk.
 */
export function findSourceFieldsInAssessments(assessments: unknown): SourceFieldSighting[] {
  if (!Array.isArray(assessments)) return [];

  const sightings: SourceFieldSighting[] = [];
  assessments.forEach((assessment, index) => {
    const onAssessment = findForbiddenSourceField(assessment);
    if (onAssessment) sightings.push({ at: `assessments[${index}]`, field: onAssessment });

    const evidence = (assessment as { evidence?: unknown } | null)?.evidence;
    if (!Array.isArray(evidence)) return;
    evidence.forEach((entry, entryIndex) => {
      const onEntry = findForbiddenSourceField(entry);
      if (onEntry) {
        sightings.push({ at: `assessments[${index}].evidence[${entryIndex}]`, field: onEntry });
      }
    });
  });

  return sightings;
}

/** One sentence naming every sighting, or null when there are none. */
export function describeSourceFieldSightings(sightings: readonly SourceFieldSighting[]): string | null {
  if (sightings.length === 0) return null;
  return `A Release Rescue report carries fields that were removed from this contract: ${sightings
    .map((sighting) => `${sighting.at}.${sighting.field}`)
    .join(
      ", ",
    )}. A finding cites path and line; it does not carry the source, and it does not carry a sentence — every word a customer reads is composed from the observation catalog by code. The offending values are withheld from this message deliberately.`;
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
 * Structured evidence: where the auditor looked, never what was there.
 *
 * The `reference` field this replaces was 300 characters of free text described
 * as "a pointer", and an audit measured that a pointer-shaped field is still a
 * field. A kind and a location cannot carry a sentence.
 */
export const findingEvidenceSchema = z
  .object({
    kind: rubricEvidenceKindSchema,
    path: repositoryPathSchema,
    startLine: z.number().int().min(1).nullable(),
    endLine: z.number().int().min(1).nullable(),
  })
  .strict();

/**
 * A finding: typed facts only.
 *
 * Every customer-facing sentence this produces comes from
 * `release-rescue-observation-catalog.ts`, looked up by `observationCode` when
 * the report is rendered. There is no field here for an executor to write prose
 * into, which is the point — thirteen audits established that no rule over
 * arbitrary prose can keep a credential out of it, so the prose is gone and the
 * codes remain.
 *
 * `impact` and `exploitability` are stored because a reader of the stored
 * artifact should see what severity was derived from, and VERIFIED against the
 * catalog by `validateFinding`, so storing them grants no authority to set them.
 */
export const releaseRescueFindingV2Schema = z
  .object({
    schemaVersion: z.literal(RELEASE_RESCUE_FINDING_SCHEMA_VERSION),
    findingId: identifierString.max(100),
    rubricCheckId: identifierString.max(200),
    dimension: rubricDimensionSchema,
    /** The catalog entry that supplies every word a customer reads for this finding. */
    observationCode: z.enum(OBSERVATION_CODES),
    /** The one judgement still left to an executor: did we prove it, or suspect it? */
    confidence: z.enum(FINDING_CONFIDENCES),
    /** Both derived from the observation catalog. Verified, not trusted. */
    impact: z.enum(FINDING_IMPACTS),
    exploitability: z.enum(FINDING_EXPLOITABILITIES),
    /** Derived from impact, exploitability and confidence. Verified. */
    severity: z.enum(FINDING_SEVERITIES),
    /** Derived from the rubric check, the severity and the confidence. Verified. */
    blocking: z.boolean(),
    locations: z.array(findingLocationSchema).max(20),
    evidence: z.array(findingEvidenceSchema).max(10),
    /** One of the remediations the observation declares acceptable. */
    remediationCode: z.enum(REMEDIATION_CODES),
    /** Both derived from the remediation catalog. Verified. */
    remediationEffort: z.enum(REMEDIATION_EFFORTS),
    inRemediationSprintScope: z.boolean(),
    /** Required when confidence is not `confirmed`; refused when it is. */
    uncertaintyCode: z.enum(UNCERTAINTY_CODES).nullable(),
  })
  .strict();

/** The v1 name, kept pointing at the current contract so callers read naturally. */
export const releaseRescueFindingV1Schema = releaseRescueFindingV2Schema;


export type ReleaseRescueFindingV2 = z.infer<typeof releaseRescueFindingV2Schema>;
export type ReleaseRescueFindingV1 = ReleaseRescueFindingV2;

/**
 * The facts an executor supplies. Everything else is derived.
 *
 * This is the whole of what a caller may decide about a finding. Every code
 * field is the catalog's own union type, not `string`, which is the difference
 * between a contract and a comment about one.
 *
 * An audit found the earlier version of this type declaring all three codes as
 * `string`. `composeFinding` therefore accepted an arbitrary sentence as an
 * `uncertaintyCode`, through a supported call with no cast: `tsc` passed,
 * `validateFinding` returned ok, the credential scanner had no assignment
 * construct to find, the field-coverage contract exempted the field on the
 * strength of it being "a closed enum", and the sentence rendered verbatim in
 * the customer's report. The words had been removed from the contract; the codes
 * that replaced them were never constrained.
 *
 * Three things had to be true at once, and all three are now false:
 *
 *   1. this type said `string` — fixed here;
 *   2. the schema's `z.enum` sat behind an `as [string, ...string[]]` cast that
 *      erased its inferred type back to `string` — fixed in the catalog, which
 *      declares a literal tuple so no cast is needed;
 *   3. nothing on the production path checked the value at runtime — fixed in
 *      `composeFinding` below and at the assembly boundary, which is where an
 *      input that never meets a schema arrives.
 */
export type FindingFacts = {
  findingId: string;
  observationCode: ObservationCode;
  confidence: FindingConfidence;
  remediationCode: RemediationCode;
  locations: Array<z.infer<typeof findingLocationSchema>>;
  evidence: Array<z.infer<typeof findingEvidenceSchema>>;
  uncertaintyCode?: UncertaintyCode | null;
};

/**
 * Builds a finding from facts, deriving every field the catalog owns.
 *
 * The only supported way to make one. Hand-assembling the object is what let an
 * earlier contract store an impact that did not match its observation, and the
 * validator then had to catch what the constructor should never have allowed.
 */
export function composeFinding(facts: FindingFacts): ReleaseRescueFindingV2 {
  const observation = getObservation(facts.observationCode);
  if (!observation) {
    throw new Error(`Unknown observation code "${facts.observationCode}".`);
  }
  const remediation = getRemediation(facts.remediationCode);
  if (!remediation) {
    throw new Error(`Unknown remediation code "${facts.remediationCode}".`);
  }
  if (!observation.remediationCodes.includes(remediation.code)) {
    throw new Error(
      `Observation "${observation.code}" does not offer remediation "${remediation.code}".`,
    );
  }

  const check = getRubricCheck(observation.checkId);
  if (!check) {
    throw new Error(`Observation "${observation.code}" references unknown check "${observation.checkId}".`);
  }

  // Checked at runtime as well as in the type, because the type is a
  // compile-time argument and this function is the runtime boundary. A caller
  // holding the facts as `any`, or rebuilding them from a stored payload,
  // reaches here with the compiler having had no say.
  //
  // `observationCode` and `remediationCode` were already checked above, by their
  // catalog lookups. This one was not, and that asymmetry is exactly what the
  // audit walked through.
  //
  // The message names the FIELD and never the value: it reaches logs, and the
  // value is the thing suspected of carrying a credential.
  if (
    facts.uncertaintyCode !== undefined &&
    facts.uncertaintyCode !== null &&
    !isUncertaintyCode(facts.uncertaintyCode)
  ) {
    throw new Error(
      "A finding's uncertaintyCode must be a code from the uncertainty catalog, not text. The offending value is withheld from this message deliberately.",
    );
  }

  const severity = computeFindingSeverity({
    impact: observation.impact,
    exploitability: observation.exploitability,
    confidence: facts.confidence,
  });

  return {
    schemaVersion: RELEASE_RESCUE_FINDING_SCHEMA_VERSION,
    findingId: facts.findingId,
    rubricCheckId: observation.checkId,
    dimension: observation.dimension,
    observationCode: observation.code,
    confidence: facts.confidence,
    impact: observation.impact,
    exploitability: observation.exploitability,
    severity,
    blocking: computeFindingBlocking(check, severity, facts.confidence),
    locations: facts.locations,
    evidence: facts.evidence,
    remediationCode: remediation.code,
    remediationEffort: remediation.effort,
    inRemediationSprintScope: remediation.inSprintScope,
    uncertaintyCode: facts.uncertaintyCode ?? null,
  };
}

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

  // The observation catalog is the authority on impact and exploitability, so a
  // stored pair that disagrees with it is a tampered artifact. Without this the
  // executor could reach the severity it wanted by asserting the inputs next to
  // a code that does not support them.
  const observation = getObservation(finding.observationCode);
  if (!observation) {
    failures.push(
      `Finding ${finding.findingId} references unknown observation code "${finding.observationCode}".`,
    );
    return { ok: false, failures };
  }
  if (observation.checkId !== finding.rubricCheckId) {
    failures.push(
      `Finding ${finding.findingId} pairs observation "${finding.observationCode}" with check "${finding.rubricCheckId}", but that observation belongs to "${observation.checkId}".`,
    );
  }
  if (finding.impact !== observation.impact || finding.exploitability !== observation.exploitability) {
    failures.push(
      `Finding ${finding.findingId} stores impact/exploitability "${finding.impact}/${finding.exploitability}" but observation "${finding.observationCode}" defines "${observation.impact}/${observation.exploitability}".`,
    );
  }

  // A remediation the observation does not offer is an executor writing its own
  // advice by picking an unrelated code.
  const remediation = getRemediation(finding.remediationCode);
  if (!remediation) {
    failures.push(
      `Finding ${finding.findingId} references unknown remediation code "${finding.remediationCode}".`,
    );
  } else {
    if (!observation.remediationCodes.includes(remediation.code)) {
      failures.push(
        `Finding ${finding.findingId} pairs observation "${finding.observationCode}" with remediation "${finding.remediationCode}", which that observation does not offer.`,
      );
    }
    if (finding.remediationEffort !== remediation.effort) {
      failures.push(
        `Finding ${finding.findingId} stores remediation effort "${finding.remediationEffort}" but "${remediation.code}" defines "${remediation.effort}".`,
      );
    }
    if (finding.inRemediationSprintScope !== remediation.inSprintScope) {
      failures.push(
        `Finding ${finding.findingId} stores sprint scope ${finding.inRemediationSprintScope} but "${remediation.code}" defines ${remediation.inSprintScope}.`,
      );
    }
  }

  // An unproven finding that does not say what is unproven is not reportable:
  // the customer cannot act on "maybe" without knowing what to go and check.
  // A proven one that carries an uncertainty code is contradicting itself.
  if (finding.confidence !== "confirmed" && finding.uncertaintyCode === null) {
    failures.push(
      `Finding ${finding.findingId} has confidence "${finding.confidence}" and must name its residual uncertainty.`,
    );
  }
  if (finding.confidence === "confirmed" && finding.uncertaintyCode !== null) {
    failures.push(
      `Finding ${finding.findingId} is confirmed and must not also claim a residual uncertainty.`,
    );
  }

  // A confirmed finding asserts something was proven, so it has to point at the
  // thing that proves it.
  if (finding.confidence === "confirmed" && finding.locations.length === 0) {
    failures.push(`Finding ${finding.findingId} is confirmed and must cite at least one location.`);
  }

  return { ok: failures.length === 0, failures };
}
