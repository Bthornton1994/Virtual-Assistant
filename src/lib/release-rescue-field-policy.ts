import { REPOSITORY_ACCESS_MODES, findProhibitedClaims } from "@/lib/release-rescue-intake";
import { PATH_SEGMENT_CHARACTERS } from "@/lib/release-rescue-findings";
import {
  FINDING_CONFIDENCES,
  FINDING_EXPLOITABILITIES,
  FINDING_IMPACTS,
  FINDING_SEVERITIES,
  REMEDIATION_EFFORTS,
} from "@/lib/release-rescue-findings-model";
import {
  RUBRIC_CHECK_OUTCOMES,
  RUBRIC_DIMENSIONS,
  RUBRIC_EVIDENCE_KINDS,
} from "@/lib/release-rescue-rubric";
import { DEMO_IDENTIFIERS } from "@/lib/release-rescue-demo-identity";
import { EXECUTOR_KINDS } from "@/lib/executor-envelope";
import { HOLD_REASON_VALUES } from "@/lib/release-rescue-pipeline";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { SECRET_CLASSIFICATIONS, blocksDelivery } from "@/lib/release-rescue-secret-classification";

// Which report fields are protected, decided by enumeration rather than by an
// allowlist someone has to remember to extend.
//
// An audit found that `scanForSecrets` ran over the WHOLE report while
// `findProhibitedClaims` ran over a hand-written list of six fields. It omitted
// `scope.application.description` — whose own schema comment says it is "used
// verbatim in the report header" — along with finding locations, evidence
// excerpts, assessment evidence references, and the customer's own exclusions.
// A customer could therefore put "your application is secure and vulnerability
// free" into their application description at intake and have it rendered in the
// header of a delivered report, with the guard reporting no prohibited claim.
//
// That is the same defect as the two before it, one level up: the guard's
// LINGUISTICS were sharpened twice and nobody asked which FIELDS it was applied
// to. So the allowlist is replaced by a coverage contract.
//
// The contract has one rule: every string that can reach a customer must have a
// recorded decision, and a string with no decision is a hard failure rather than
// a pass. Adding a field to the report schema without classifying it breaks the
// build, which is the only mechanism that survives the next person in a hurry.

/** What we have decided to do with a given field's text. */
export type FieldDisposition =
  /**
   * Produced by our own deterministic code: ids, hashes, counts, enum values,
   * timestamps. Not attacker-influenced, so not guarded — but still enumerated,
   * because "this one is fine" is a decision and should be written down.
   */
  | "generated"
  /**
   * Free text that reaches the customer. Must carry no prohibited claim and no
   * credential. This is the default for anything a human or an executor writes.
   */
  | "guarded"
  /**
   * Text lifted from the reviewed repository, checked for credentials but not
   * for claims — a customer's own source is allowed to contain the word "secure".
   *
   * No field carries this disposition any more. `prepareExcerpt`, which used to
   * be its precondition, was deleted with the excerpt field: a finding points at
   * source and never carries it. The disposition stays so the contract can still
   * express the category, and so that re-adding a field in it is a deliberate
   * act rather than a default.
   */
  | "redacted"
  /**
   * Text that must never appear in a report at all. Present so the contract can
   * express a refusal rather than an omission.
   */
  | "rejected"
  /**
   * Fixed strings this codebase owns — the standing disclaimers, which contain
   * the prohibited phrases on purpose because they are denying them.
   */
  | "verbatim_approved";

export type FieldRule = {
  readonly disposition: FieldDisposition;
  /** Why this decision. Required: an unexplained exemption is how coverage rots. */
  readonly because: string;
  /**
   * This field holds a repository path, ref or branch name, not prose.
   *
   * Such a field is checked against the PATH GRAMMAR below instead of the claim
   * guard, and by the credential scanner exactly as every other guarded field
   * is. The claim guard does not read it at all.
   *
   * WHY, because giving up a control needs a reason and not a preference. Two
   * audits measured what the claim guard does to a path, one spelling at a
   * time, and there is no spelling where it works:
   *
   *   * reading a path as prose refused `src/utils/isSecure.ts` — `isSecure` is
   *     among the most common helper names in JavaScript, Go and C#;
   *   * reading it with separators intact refused `internal/net/is_secure.go`,
   *     `tests/test_is_secure.py`, `src/security/pen_test.py` and
   *     `docs/pen-test-report.pdf` — 18 of 19 realistic paths from Python, Go,
   *     Rust, Ruby, C and npm conventions, because `is_secure.go` is the
   *     IDIOMATIC Go spelling and `IsSecure.go` is not;
   *   * and three of the offer's prohibited claims are single words —
   *     `pentest`, `pentesting`, `vulnerability-free` — so even a rule that
   *     matched nothing across a separator would still refuse `docs/pentest.md`.
   *
   * A file name is built from the same words a claim is built from. The guard
   * cannot tell a customer's filename from a sentence, and every version of it
   * that caught more sentences refused more filenames. `findings[].locations[]
   * .path` holds a path from the CUSTOMER'S repository, so each of those is a
   * $299 review refused over data the product does not control — the failure
   * this workstream has now shipped three times.
   *
   * WHAT IS GIVEN UP, stated plainly rather than argued away: an executor could
   * write `src/this-app-is-secure.ts` as a finding location and the guard would
   * not object. Four things stand in the way of that reaching a customer as a
   * claim, and none of them is this guard: the path grammar, which refuses
   * anything with a space or a control character; the credential scanner, which
   * still runs; the fact that every customer-facing SENTENCE is resolved from
   * the frozen observation catalog and never written by a caller; and the named
   * human reviewer who must sign the report before it is delivered. The control
   * that would actually settle it — checking that the path names a real file in
   * the reviewed commit — is not available at assembly time, and is recorded in
   * the doc as the open question it is rather than papered over here.
   *
   * Declared in the policy rather than as a list inside the checker, so a new
   * path-valued field is a visible decision. Only `guarded` fields consult it.
   */
  readonly valueIsAPath?: true;
};

/**
 * Normalised path for a string leaf: array indices collapse to `[]`, so
 * `findings[0].title` and `findings[7].title` share one decision.
 */
export function normalizeFieldPath(path: string): string {
  return path.replace(/\[\d+\]/g, "[]");
}

/**
 * Every customer-reachable string in a `release-rescue-report/v1`.
 *
 * Deliberately exhaustive rather than illustrative. A path missing from here is
 * not "unguarded by oversight" — it fails the contract check and the report is
 * refused.
 */
export const REPORT_FIELD_POLICY: Readonly<Record<string, FieldRule>> = {
  "$.schemaVersion": { disposition: "generated", because: "A literal string constant this module owns." },
  "$.reportId": { disposition: "generated", because: "An identifier this codebase mints." },
  "$.engagementId": { disposition: "generated", because: "An identifier this codebase mints." },
  "$.runId": { disposition: "generated", because: "An identifier this codebase mints." },
  "$.organizationId": { disposition: "generated", because: "An identifier this codebase mints." },
  "$.rubricVersion": { disposition: "generated", because: "Pinned by the frozen rubric module." },
  "$.rubricHash": { disposition: "generated", because: "A hash computed from the frozen rubric." },
  "$.scopeHash": { disposition: "generated", because: "A hash computed from the frozen scope." },
  "$.observationCatalogVersion": {
    disposition: "generated",
    because: "A literal string constant the observation catalog owns.",
  },
  "$.observationCatalogHash": {
    disposition: "generated",
    because:
      "A hash computed from the frozen observation catalog. It binds a delivered report to the exact wording the customer was shown.",
  },
  "$.reviewedCommitSha": { disposition: "generated", because: "Pinned on the engagement and format-checked." },
  "$.verdict": { disposition: "generated", because: "Derived from the findings, never chosen. One of four values." },
  "$.generatedAt": { disposition: "generated", because: "A timestamp this codebase writes." },

  // --- the frozen scope: the customer's own words, rendered in the header ---
  "$.scope.offerVersion": { disposition: "generated", because: "A literal string constant the offer module owns." },
  "$.scope.repository.provider": { disposition: "generated", because: "A closed enum, validated at intake." },
  "$.scope.repository.accessMode": { disposition: "generated", because: "A closed enum, validated at intake." },
  "$.scope.repository.repositoryRef": {
    disposition: "guarded",
    valueIsAPath: true,
    because: "Customer-supplied at intake and shown in the report header. A repository ref, so the claim guard reads it as a path.",
  },
  "$.scope.repository.defaultBranch": {
    disposition: "guarded",
    valueIsAPath: true,
    because: "Customer-supplied, shown to the customer. A branch name, so the claim guard reads it as a path.",
  },

  // --- assessments ---
  "$.assessments[].checkId": {
    disposition: "generated",
    because:
      "Must match an id in the frozen rubric, and `assembleReleaseRescueReport` refuses the report if it does not. Same field, one level over, and it was unenforced for the same three releases.",
  },
  "$.assessments[].outcome": { disposition: "generated", because: "A closed enum the rubric module defines." },
  "$.assessments[].rationaleCode": {
    disposition: "generated",
    because:
      "A closed enum. The sentence the customer reads is the catalog's, resolved at render time; the artifact stores only the code.",
  },
  "$.assessments[].evidence[].kind": { disposition: "generated", because: "A closed enum the rubric module defines." },
  "$.assessments[].evidence[].path": {
    disposition: "guarded",
    valueIsAPath: true,
    because:
      "A repository path an executor cites. It is the last class of value taken from the customer's repository that still reaches the report, so it is checked like any other free text.",
  },

  // --- findings ---
  "$.findings[].schemaVersion": { disposition: "generated", because: "A literal string constant the finding module owns." },
  "$.findings[].findingId": { disposition: "generated", because: "An identifier this codebase mints." },
  "$.findings[].rubricCheckId": {
    disposition: "generated",
    because:
      "Must match an id in the frozen rubric, and `assembleReleaseRescueReport` refuses the report if it does not. The enforcement is named here on purpose: this field was `generated` on the strength of that sentence for three releases while nothing checked it, and an audit rendered a prohibited claim through it into the header of a customer's finding.",
  },
  "$.findings[].dimension": { disposition: "generated", because: "A closed enum, taken from the frozen rubric." },
  "$.findings[].severity": { disposition: "generated", because: "Derived from impact, exploitability and confidence." },
  "$.findings[].impact": { disposition: "generated", because: "A closed enum; an input to derived severity." },
  "$.findings[].exploitability": { disposition: "generated", because: "A closed enum; an input to derived severity." },
  "$.findings[].confidence": { disposition: "generated", because: "A closed enum; caps derived severity." },
  "$.findings[].remediationEffort": { disposition: "generated", because: "A closed enum the finding contract defines." },
  "$.findings[].observationCode": {
    disposition: "generated",
    because:
      "A closed enum over the observation catalog. Every customer-facing sentence about this finding — title, what we observed, why it matters — is resolved from this code at render time and never written by a caller.",
  },
  "$.findings[].remediationCode": {
    disposition: "generated",
    because: "A closed enum over the remediation catalog, constrained to the remediations the observation offers.",
  },
  "$.findings[].uncertaintyCode": {
    disposition: "generated",
    because: "A closed enum over the uncertainty catalog. Required whenever confidence is not `confirmed`.",
  },
  "$.findings[].locations[].path": {
    disposition: "guarded",
    valueIsAPath: true,
    because:
      "A repository path an executor writes. Bounded and grammar-checked by the finding schema, but still a value derived from the customer's repository, so it carries the guarded contract.",
  },
  "$.findings[].evidence[].kind": { disposition: "generated", because: "A closed enum the rubric module defines." },
  "$.findings[].evidence[].path": {
    disposition: "guarded",
    valueIsAPath: true,
    because: "A repository path an executor cites as evidence; same contract as a finding location.",
  },
  // --- what sanitisation removed ---
  "$.unresolvedHolds[].path": {
    disposition: "generated",
    because: "A JSON path this codebase produced when it recorded the hold.",
  },
  "$.unresolvedHolds[].classification": {
    disposition: "generated",
    because: "A closed enum from the secret-classification module.",
  },
  "$.unresolvedHolds[].originalHash": {
    disposition: "generated",
    because: "A hash of the removed text. It is a hash precisely so the hold is not a second copy of the secret.",
  },
  "$.unresolvedHolds[].reason": {
    disposition: "generated",
    because: "One of two fixed sentences this module owns, shown to the customer to explain the hold.",
  },

  // --- secret holds a human cleared ---
  "$.clearedSecretHolds[].path": {
    disposition: "generated",
    because: "A JSON path this codebase produced when it recorded the hold.",
  },
  "$.clearedSecretHolds[].clearedContentHash": {
    disposition: "generated",
    because: "A hash binding the clearance to the exact content it released.",
  },
  "$.clearedSecretHolds[].clearedBy": {
    disposition: "generated",
    because: "An operator identifier from our own records, not free text.",
  },
  "$.clearedSecretHolds[].clearedAt": {
    disposition: "generated",
    because: "A timestamp this codebase writes when the hold is cleared.",
  },
  "$.clearedSecretHolds[].reasonCode": {
    disposition: "generated",
    because:
      "A closed enum over the clearance-reason catalog. A reviewer selects a reason; they do not write one, because a written reason is free text on a path that exists to release withheld material.",
  },

  "$.limitationCodes[]": {
    disposition: "generated",
    because:
      "A closed enum over the limitation catalog. The standing limitations are appended by the builder; a caller may only select from the engagement-specific ones.",
  },

  "$.preparedBy.executorKey": { disposition: "generated", because: "A control-plane identifier, not product truth." },
  "$.preparedBy.executorKind": { disposition: "generated", because: "Enum; execution provenance, not product truth." },
  "$.preparedBy.provider": { disposition: "generated", because: "Enum; execution provenance, not product truth." },
  "$.preparedBy.protocolVersion": { disposition: "generated", because: "A control-plane identifier, not product truth." },
  "$.preparedBy.modelId": {
    disposition: "generated",
    because:
      "Execution provenance: which model produced the draft, recorded because AGENTS.md requires it. A control-plane identifier bounded to 200 characters by the schema, chosen by our own routing rather than by an executor or a customer, and never product truth.",
  },
  "$.reviewedBy.operatorUserId": { disposition: "generated", because: "An operator identifier from our own records." },
  "$.reviewedBy.displayName": {
    disposition: "guarded",
    because: "An operator's name, rendered to the customer as the signature.",
  },
  "$.reviewedBy.reviewedAt": { disposition: "generated", because: "A timestamp this codebase writes." },
} as const;

/**
 * What each `generated` path's value must LOOK LIKE.
 *
 * This replaced a rule that asked whether a value looked like prose, and the
 * replacement is an inversion rather than a repair. The history is the argument:
 *
 *   14. the six catalog codes were unconstrained
 *   15. `findings[].rubricCheckId` was not on the list that fixed them, plus
 *       four more found by generalising
 *   16. `$.engagementId` — TOP-LEVEL, excluded by a "general" check that was a
 *       regex over path shapes covering 15 of 50 generated paths
 *   17. the whitespace rule that replaced it. `generated` values are ids,
 *       hashes, codes, enums and timestamps, none of which contains whitespace
 *       — so whitespace looked like a complete test for "this is not what the
 *       policy says it is". It is not. Replace the spaces with hyphens and
 *       "This-app-is-secure-and-free-of-vulnerabilities." passed 49 of 50
 *       generated paths and rendered as the report's header line. The dotted and
 *       camelCase forms defeat `findProhibitedClaims` as well.
 *
 * Every one of those five was a NEGATIVE rule: some description of what a value
 * must not be. A negative rule over an open set of strings has no complete form,
 * which is the same wall the prose contract hit before Option 1 — and the answer
 * is the same one. Stop describing what the value must not be. Say what it IS.
 *
 * So each `generated` path declares the format its value must MATCH. The policy
 * already claims these are "produced by our own deterministic code"; this is
 * that claim written down in a form the assembler can check. A value that does
 * not match is refused, whatever it happens to say.
 *
 * WHAT THIS DOES NOT SOLVE, stated plainly because the last five rounds each
 * claimed more than they had. Two of these formats are genuinely loose:
 * `preparedBy.executorKey` and `.modelId` are vendor and control-plane strings
 * whose shape this codebase does not own. A compressed claim in camelCase
 * (`ThisAppIsSecure`) fits an identifier format and defeats the claim guard's
 * tokenizer. Those two fields do not reach the customer view — asserted by a
 * test — and that is the whole of the mitigation. It is a bound, not a proof.
 */
export type GeneratedFormat = {
  readonly pattern: RegExp;
  /**
   * The closed set of values, where one exists.
   *
   * Shape alone is not enough for an enum or a catalog code, and the test that
   * drove this found out why: `this.app.is.secure.and.free.of.vulnerabilities`
   * satisfies the lowercase-dotted-code SHAPE exactly. For a value drawn from a
   * known set, the set itself is the format — anything else is shape-checking a
   * thing whose membership we already know.
   */
  readonly allowed?: readonly string[];
  /**
   * True when this format is too loose to exclude a compressed claim, and the
   * mitigation is that the value never reaches a customer surface instead.
   *
   * Declared on the FORMAT rather than kept as a list in a test, because a list
   * in a test is the pattern that failed five times running. A path opting out
   * of the format guarantee has to say so here, next to the reason, and a
   * separate test asserts every such path is absent from the customer view.
   */
  readonly notCustomerVisible?: true;
  /** Why this format, and what it excludes. */
  readonly because: string;
};

const HASH_64: GeneratedFormat = {
  pattern: /^[0-9a-f]{64}$/,
  because: "A SHA-256 digest this codebase computes. Nothing else is 64 lowercase hex characters.",
};
const SHA_40: GeneratedFormat = {
  pattern: /^[0-9a-f]{40}$/,
  because: "A git commit SHA, already parsed by `commitShaSchema` at assembly.",
};
const ISO_TIMESTAMP: GeneratedFormat = {
  pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  because: "An ISO 8601 instant this codebase writes.",
};
const VERSION_PIN: GeneratedFormat = {
  pattern: /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?v\d+(?:\.\d+)*$/,
  because: "A literal version constant such as `release-rescue-report/v1`, owned by a module in this repository.",
};
const CODE_SHAPE = /^[a-z0-9]+(?:[._][a-z0-9]+)*$/;

/**
 * A value drawn from a closed set this repository owns.
 *
 * The set is the format. A shape-only rule is not enough here and the test that
 * drove this measured why: `this.app.is.secure.and.free.of.vulnerabilities`
 * satisfies the lowercase-dotted-code shape exactly, and was accepted by every
 * shape-checked path.
 */
/**
 * Two sets that are inlined rather than imported, and why.
 *
 * `RELEASE_VERDICTS` lives in `release-rescue-report.ts`, which imports THIS
 * module — importing it back is a cycle. The repository provider list is a
 * `z.enum` literal inside an intake schema with no exported constant.
 *
 * A copy is a thing that drifts, so a test asserts each of these equals its
 * source. That is the trade taken deliberately: a cycle is a runtime hazard, a
 * drifting copy is a test failure.
 */
const VERDICTS_INLINE: readonly string[] = [
  "release_blocked",
  "conditional_release",
  "release_with_tracked_findings",
  "no_blocking_findings_identified",
];
const REPOSITORY_PROVIDERS_INLINE: readonly string[] = ["github", "gitlab", "bitbucket", "uploaded_archive"];

function oneOf(values: readonly string[], because: string): GeneratedFormat {
  return { pattern: CODE_SHAPE, allowed: values, because };
}

/**
 * A code whose membership is verified elsewhere at assembly.
 *
 * `assertEveryCodeIsInItsCatalog` already checks these against their catalogs
 * and produces a better message naming the registry, so repeating the set here
 * would be a second copy to keep in step. The shape check still runs.
 */
const CATALOG_CODE: GeneratedFormat = {
  pattern: CODE_SHAPE,
  because:
    "A lowercase catalog code. Membership is verified against the catalog itself by `assertEveryCodeIsInItsCatalog` at the same boundary, which is why the set is not duplicated here; this is the shape half of the same check.",
};
const JSON_PATH: GeneratedFormat = {
  pattern: /^\$(?:\.[A-Za-z0-9_]+|\[\d+\])*$/,
  because: "A JSON path this codebase produced when it recorded a hold.",
};
/** A canonical lowercase UUID, which is what every identifier column here is. */
const UUID_SHAPE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * An identifier: a UUID, or one of the five demo identifiers this codebase declares.
 *
 * This is the format that used to be a BOUND — "at most four segments of at most
 * twenty-four characters" — and an audit walked a claim through it:
 * `ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified` is four
 * segments, each under twenty-four, so it assembled, passed the delivery gate,
 * and rendered in the report header as the engagement id. Both bounds held. The
 * value was still a sentence.
 *
 * That is the same lesson six audits taught in six other places, arriving one
 * last time: a bound says what a value may not exceed, and a sentence can be
 * written inside any bound. What closes it is saying what the value IS.
 *
 * A UUID is what the database columns are — `organization_id uuid`,
 * `engagement_id uuid`, `run_id uuid`, `reviewed_by uuid references
 * auth.users(id)`. The old bound refused every one of them, because a UUID is
 * five segments and the bound allowed four: the pattern that was too loose for a
 * claim was at the same moment too tight for the product's own identifiers, and
 * neither fact was visible while the fixtures used `org-acme` and `rep-001`.
 * They are UUIDs now, for that reason.
 */
const MINTED_ID: GeneratedFormat = {
  pattern: new RegExp(
    `^(?:${UUID_SHAPE}|${DEMO_IDENTIFIERS.map(escapeForPattern).join("|")})$`,
  ),
  because:
    "A UUID, which is what every identifier column in the Release Rescue schema is, or one of the five identifiers `release-rescue-demo-identity.ts` declares for the demo report. A closed set and a canonical shape, with no room between them for a sentence.",
};

/**
 * A finding's label within its report: `RR-001`.
 *
 * Findings are numbered in the report that carries them rather than minted
 * globally, so this is a sequence label, not an id. Three digits, because a
 * fixed-price review of one repository does not produce a thousand findings —
 * and if it ever did, the refusal is the correct outcome.
 */
const FINDING_LABEL: GeneratedFormat = {
  pattern: /^RR-\d{3}$/,
  because:
    "A finding's sequence label within its report: `RR-` and three digits. Findings are numbered per report, not minted globally.",
};

/**
 * The loose ones, kept loose on purpose and bounded by where they can go.
 *
 * A model id or an executor key is a vendor string — `grok-4.6`,
 * `claude-fable-5-1`, `software-factory/v1`. This codebase does not own their
 * shape and should not invent one. They are excluded from the customer view
 * instead, which a test asserts, and the claim guard reads them on the way past.
 */
const CONTROL_PLANE_PIN: GeneratedFormat = {
  // The empty string is legal and load-bearing: a HUMAN-prepared report has no
  // vendor and no model, and `preparedBy.provider` is `""` for it. The first
  // version of this pattern required at least one character and refused every
  // human-prepared report — caught by the existing suite, which is the reason a
  // tightening pass runs the whole suite rather than only its own tests.
  pattern: /^(?:|[A-Za-z0-9][A-Za-z0-9._/-]{0,199})$/,
  notCustomerVisible: true,
  because:
    "A vendor or control-plane identifier whose shape this codebase does not own — `grok-4.6`, `claude-fable-5-1`, a provider name. Loose by necessity, so the format itself excludes nothing but control characters and length. Two things cover it instead: the claim guard, which reads these values and now catches every separated and camelCase form (a test measures exactly which forms, in both directions); and non-visibility, which is what covers a vendor string that makes no claim at all. The second is a bound rather than a proof, and it is written here rather than in a test because a list kept in a test is the pattern that failed five audits running.",
};
/** The one path whose value is legitimately a sentence. */
const MODULE_SENTENCE: GeneratedFormat = {
  pattern: /^[A-Z][^\n]{10,300}$/,
  allowed: HOLD_REASON_VALUES,
  because:
    "One of exactly two fixed sentences this codebase owns, written by `sanitizeReportInput` to explain a hold. It is the one generated path whose value is legitimately prose, which is exactly why it is pinned to the SET rather than to a shape: an audit put a camelCase claim and a hyphenated credential through the shape rule that used to guard it.",
};

/**
 * What a repository path, ref or branch name must LOOK LIKE.
 *
 * The positive rule for `valueIsAPath` fields, re-asserted at the artifact
 * boundary. It is deliberately the UNION of what the three schemas already
 * accept — `repositoryPathSchema`, `repositoryRefSchema` and `branchNameSchema`
 * — because a boundary check stricter than the schema refuses values the
 * product considers correct, which is the failure shape this workstream has
 * shipped three times. It is defence in depth against a value that reached the
 * artifact without passing a schema, not a second, competing opinion.
 *
 * A sentence cannot satisfy it: no spaces, no control characters, bounded.
 */
// DERIVED, never restated. The hand-written version of this class was ASCII-only
// and omitted `$ , & ! ' { } # %`, so it refused `app/routes/users.$userId.edit.tsx`
// — every Remix and React Router v7 dynamic route — and `src/日本語/page.tsx`,
// thirteen of a forty-path corpus. Both classes were false refusals an earlier
// audit had already found and fixed in the schema; restating the class by hand
// reintroduced them one layer up. A test executes all three schemas over a corpus
// and requires that anything a schema accepts, this accepts.
const PATH_CHARACTERS = new RegExp(`^[${PATH_SEGMENT_CHARACTERS}/]+$`, "u");
const MAX_PATH_VALUE_LENGTH = 400;

/** Why a `valueIsAPath` value is not a path, or null. Never echoes the value. */
export function pathValueIsNotAPath(value: string): string | null {
  if (value.length === 0) return "it is empty";
  if (value.length > MAX_PATH_VALUE_LENGTH) {
    return `it is ${value.length} characters, and a path here is at most ${MAX_PATH_VALUE_LENGTH}`;
  }
  if (!PATH_CHARACTERS.test(value)) {
    return "it holds a character a path does not: letters, digits and `. _ - + @ ~ ( ) [ ] /` only, with no spaces";
  }
  if (value.includes("://")) return "it is a URL, not a path";
  if (value.startsWith("/")) return "it is absolute, and a repository path is relative";
  if (value.split("/").includes("..")) return "it contains a parent-traversal segment";
  return null;
}

export const GENERATED_FORMATS: Readonly<Record<string, GeneratedFormat>> = {
  "$.schemaVersion": VERSION_PIN,
  "$.reportId": MINTED_ID,
  "$.engagementId": MINTED_ID,
  "$.runId": MINTED_ID,
  "$.organizationId": MINTED_ID,
  "$.rubricVersion": VERSION_PIN,
  "$.rubricHash": HASH_64,
  "$.scopeHash": HASH_64,
  "$.observationCatalogVersion": VERSION_PIN,
  "$.observationCatalogHash": HASH_64,
  "$.reviewedCommitSha": SHA_40,
  "$.verdict": oneOf(VERDICTS_INLINE, "The four verdicts, in strict precedence. Derived from the findings and the coverage, never chosen."),
  "$.generatedAt": ISO_TIMESTAMP,
  "$.scope.offerVersion": VERSION_PIN,
  "$.scope.repository.provider": oneOf(REPOSITORY_PROVIDERS_INLINE, "The repository providers intake accepts. Pinned against the intake schema by a test, since there is no exported constant to import."),
  "$.scope.repository.accessMode": oneOf(REPOSITORY_ACCESS_MODES, "The read-only access modes intake accepts. Every one of them is revocable by the customer."),
  "$.assessments[].checkId": CATALOG_CODE,
  "$.assessments[].outcome": oneOf(RUBRIC_CHECK_OUTCOMES, "The rubric check outcomes the rubric module defines."),
  "$.assessments[].rationaleCode": CATALOG_CODE,
  "$.assessments[].evidence[].kind": oneOf(RUBRIC_EVIDENCE_KINDS, "The evidence kinds the frozen rubric defines as acceptable for a check."),
  "$.findings[].schemaVersion": VERSION_PIN,
  "$.findings[].findingId": FINDING_LABEL,
  "$.findings[].rubricCheckId": CATALOG_CODE,
  "$.findings[].dimension": oneOf(RUBRIC_DIMENSIONS, "The nine rubric dimensions the frozen rubric defines."),
  "$.findings[].observationCode": CATALOG_CODE,
  "$.findings[].remediationCode": CATALOG_CODE,
  "$.findings[].uncertaintyCode": CATALOG_CODE,
  "$.findings[].severity": oneOf(FINDING_SEVERITIES, "The five derived severities. Severity is computed from impact, exploitability and confidence, never chosen, so a value outside this set means the artifact was edited."),
  "$.findings[].impact": oneOf(FINDING_IMPACTS, "The impact levels. Fixed per observation by the observation catalog and verified against it, so an executor cannot set one."),
  "$.findings[].exploitability": oneOf(FINDING_EXPLOITABILITIES, "The exploitability levels. Fixed per observation by the observation catalog and verified against it, so an executor cannot set one."),
  "$.findings[].confidence": oneOf(FINDING_CONFIDENCES, "The three confidence levels an executor may state. Confidence can lower a derived severity and never raise one."),
  "$.findings[].remediationEffort": oneOf(REMEDIATION_EFFORTS, "The remediation effort levels, fixed per remediation by the catalog rather than estimated per finding."),
  "$.findings[].evidence[].kind": oneOf(RUBRIC_EVIDENCE_KINDS, "The evidence kinds the frozen rubric defines as acceptable for a check."),
  "$.limitationCodes[]": CATALOG_CODE,
  "$.unresolvedHolds[].path": JSON_PATH,
  "$.unresolvedHolds[].classification": oneOf(SECRET_CLASSIFICATIONS, "The secret classifications the redaction module assigns when it raises a hold."),
  "$.unresolvedHolds[].originalHash": HASH_64,
  "$.unresolvedHolds[].reason": MODULE_SENTENCE,
  "$.clearedSecretHolds[].path": JSON_PATH,
  "$.clearedSecretHolds[].clearedContentHash": HASH_64,
  "$.clearedSecretHolds[].clearedBy": MINTED_ID,
  "$.clearedSecretHolds[].clearedAt": ISO_TIMESTAMP,
  "$.clearedSecretHolds[].reasonCode": CATALOG_CODE,
  "$.preparedBy.executorKey": CONTROL_PLANE_PIN,
  "$.preparedBy.executorKind": oneOf(EXECUTOR_KINDS, "The executor kinds the executor envelope defines: agent, deterministic or human."),
  "$.preparedBy.provider": CONTROL_PLANE_PIN,
  "$.preparedBy.protocolVersion": VERSION_PIN,
  "$.preparedBy.modelId": CONTROL_PLANE_PIN,
  "$.reviewedBy.operatorUserId": MINTED_ID,
  "$.reviewedBy.reviewedAt": ISO_TIMESTAMP,
};

/**
 * Why a `generated` value is not what its policy entry says it is, or null.
 *
 * Two independent reasons, because neither alone was enough:
 *
 *   1. it does not match the declared format — the positive test, which is what
 *      catches a sentence in an id field however it is punctuated;
 *   2. it carries a prohibited claim — the claim guard, run on `generated`
 *      values as defence in depth. The policy exempts them from it on the
 *      grounds that they are machine-produced, and that exemption is precisely
 *      what five audits walked through.
 */
export function generatedValueIsNotWhatItClaims(normalizedPath: string, value: string): string | null {
  const format = GENERATED_FORMATS[normalizedPath];
  if (!format) {
    return `no format is declared for "${normalizedPath}", so its "generated" classification asserts nothing checkable`;
  }
  if (!format.pattern.test(value)) {
    return `does not match the declared format for "${normalizedPath}" (${format.because})`;
  }
  if (format.allowed && !format.allowed.includes(value)) {
    return `is not one of the ${format.allowed.length} values "${normalizedPath}" may hold (${format.because})`;
  }
  const claims = findProhibitedClaims(value);
  if (claims.length > 0) {
    return `carries a prohibited claim ("${claims[0]}")`;
  }
  return null;
}

export type FieldLeaf = { path: string; normalized: string; value: string };

/**
 * Walks a report and yields every string leaf with its normalised path.
 *
 * Walks the ARTIFACT rather than the schema, so a field added by a caller that
 * the schema has not caught up with is still seen. `.strict()` on the schema
 * makes that unlikely; the contract does not depend on it.
 */
export function enumerateStringFields(value: unknown, path = "$"): FieldLeaf[] {
  if (typeof value === "string") {
    return [{ path, normalized: normalizeFieldPath(path), value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => enumerateStringFields(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      enumerateStringFields(entry, `${path}.${key}`),
    );
  }
  return [];
}

export type CoverageFailure = { path: string; reason: string };

/**
 * The contract check: every string in the report has a recorded decision, and
 * the text satisfies it.
 *
 * Fails CLOSED on an unknown path. That is the whole mechanism: a new
 * customer-visible field is a hard failure until somebody decides what it is,
 * rather than an unguarded field that nobody notices until an audit.
 */
export function checkReportFieldCoverage(report: unknown): CoverageFailure[] {
  const failures: CoverageFailure[] = [];

  for (const leaf of enumerateStringFields(report)) {
    const rule = REPORT_FIELD_POLICY[leaf.normalized];

    if (!rule) {
      failures.push({
        path: leaf.path,
        reason: `No field-coverage decision is recorded for "${leaf.normalized}". Classify it in REPORT_FIELD_POLICY before this report can be issued.`,
      });
      continue;
    }

    switch (rule.disposition) {
      case "rejected":
        failures.push({ path: leaf.path, reason: `"${leaf.normalized}" must not appear in a report.` });
        break;
      case "guarded": {
        if (rule.valueIsAPath) {
          // A path is checked against what a path IS, not read as prose. See
          // `valueIsAPath` for the two audits behind that, and for what it
          // gives up. The value is named and never echoed.
          const wrong = pathValueIsNotAPath(leaf.value);
          if (wrong) failures.push({ path: leaf.path, reason: `Is not a repository path: ${wrong}.` });
        } else {
          // "typed_field": a `guarded` value is something a person typed into a
          // form, not offer copy, so a denial or referral inside it may not
          // license a claim. See `ClaimTextSource` — a display name is
          // structurally one clause, and licensing turned the guard off for the
          // whole field whenever the name contained a word like "no".
          for (const claim of findProhibitedClaims(leaf.value, "typed_field")) {
            failures.push({
              path: leaf.path,
              reason: `Makes a prohibited claim ("${claim}"): "${leaf.value.slice(0, 120)}".`,
            });
          }
        }
        // Only a CONFIDENT detection is a coverage failure. An ambiguous
        // candidate is redacted and held by the delivery gate instead, because
        // hard-failing it here is what turned "Password: rotation policy is
        // weak" into an undeliverable report.
        if (blocksDelivery(redactSecrets(leaf.value).classification ?? "sensitive_prose")) {
          failures.push({ path: leaf.path, reason: "Holds an unredacted credential." });
        }
        break;
      }
      case "redacted":
        if (blocksDelivery(redactSecrets(leaf.value).classification ?? "sensitive_prose")) {
          failures.push({ path: leaf.path, reason: "Holds an unredacted credential." });
        }
        break;
      case "generated": {
        // A `generated` value must MATCH the format its policy entry declares.
        // See `GENERATED_FORMATS` for why this is a positive test rather than a
        // description of what the value must not be.
        //
        // This runs in the coverage contract as defence in depth. The check that
        // matters is `assertGeneratedFieldsMatchTheirFormat` at the assembly
        // boundary, because `validateReleaseRescueReport`, which calls this
        // function, has no production call site.
        const wrong = generatedValueIsNotWhatItClaims(leaf.normalized, leaf.value);
        if (wrong) {
          failures.push({
            path: leaf.path,
            reason: `"${leaf.normalized}" is classified generated, which exempts it from the prohibited-claim guard and the credential check, but its value ${wrong}.`,
          });
        }
        break;
      }
      case "verbatim_approved":
        break;
    }
  }

  return failures;
}

/**
 * Paths the policy knows about but a sample report never exercises.
 *
 * Used by a test to keep the policy honest in the other direction: a decision
 * about a field that no longer exists is stale, and stale entries are how a
 * policy drifts into fiction.
 */
export function unusedPolicyPaths(reports: readonly unknown[]): string[] {
  const seen = new Set(reports.flatMap((report) => enumerateStringFields(report).map((leaf) => leaf.normalized)));
  return Object.keys(REPORT_FIELD_POLICY).filter((path) => !seen.has(path));
}

// --- Schema-driven enumeration ---------------------------------------------------

/**
 * Every string-typed path the report SCHEMA permits, whether or not a given
 * report populates it.
 *
 * This exists because the artifact walk was not enough. `preparedBy.modelId` is
 * `z.string().nullable()`, both fixtures set it to `null`, so no string leaf was
 * ever emitted, no test noticed it had no classification — and populating it, as
 * the Software Factory provenance rules require, refused the report. The
 * coverage contract failed closed, which is right, but it failed closed on a
 * field the documentation tells operators to fill in.
 *
 * Walking the artifact answers "is everything in THIS report classified?".
 * Walking the schema answers "is everything the schema ALLOWS classified?", and
 * only the second one catches a field that is nullable, optional, or simply not
 * exercised by the fixtures to hand.
 */
export function enumerateSchemaStringPaths(schema: unknown, path = "$", onPath: readonly unknown[] = []): string[] {
  // Zod wraps types in a chain of internal defs. This unwraps the wrappers that
  // do not change the shape of the value, then reads the container kinds.
  const node = schema as {
    _def?: {
      typeName?: string;
      innerType?: unknown;
      type?: unknown;
      shape?: () => Record<string, unknown>;
      schema?: unknown;
      options?: unknown[];
      valueType?: unknown;
    };
    def?: {
      type?: string;
      innerType?: unknown;
      element?: unknown;
      shape?: Record<string, unknown>;
      options?: unknown[];
      valueType?: unknown;
      values?: unknown;
      value?: unknown;
    };
  };
  // The cycle guard tracks the CURRENT BRANCH, not everything ever visited.
  //
  // A global `seen` set looks equivalent and is not: shared schema instances are
  // ordinary here (`isoDateTimeSchema` is used by `generatedAt` and by
  // `reviewedBy.reviewedAt`, `identifierString` by a dozen fields), and a global
  // set makes the second and later uses return nothing. The walk then
  // under-reports, which is precisely the failure that let `modelId` go
  // unclassified in the first place — a mechanism that looks right and quietly
  // covers less than it claims.
  if (!node || typeof node !== "object" || onPath.includes(node)) return [];
  if (onPath.length > 24) return [];
  const branch = [...onPath, node];

  const def = (node.def ?? node._def ?? {}) as Record<string, unknown>;
  const kind = (def.type ?? def.typeName ?? "") as string;

  // Wrappers: nullable, optional, default, readonly, catch, branded, pipe.
  const inner = def.innerType ?? def.in ?? def.schema;
  if (inner && /nullable|optional|default|readonly|catch|branded|pipe|effects|transform/i.test(kind)) {
    return enumerateSchemaStringPaths(inner, path, branch);
  }

  if (/string|enum/i.test(kind)) return [path];
  if (/literal/i.test(kind)) {
    // `z.literal(true)` is a boolean, not a string. Reading the literal's own
    // value keeps the four disclaimer flags out of the string inventory instead
    // of demanding a text classification for a boolean.
    const values = (def.values ?? (def.value === undefined ? [] : [def.value])) as unknown[];
    return (Array.isArray(values) ? values : [values]).some((value) => typeof value === "string") ? [path] : [];
  }
  if (/array/i.test(kind)) {
    const element = def.element ?? def.type ?? def.valueType;
    return enumerateSchemaStringPaths(element, `${path}[]`, branch);
  }
  if (/object/i.test(kind)) {
    const rawShape = typeof def.shape === "function" ? (def.shape as () => Record<string, unknown>)() : def.shape;
    const shape = (rawShape ?? {}) as Record<string, unknown>;
    return Object.entries(shape).flatMap(([key, child]) =>
      enumerateSchemaStringPaths(child, `${path}.${key}`, branch),
    );
  }
  if (/union/i.test(kind) && Array.isArray(def.options)) {
    return [...new Set(def.options.flatMap((option) => enumerateSchemaStringPaths(option, path, branch)))];
  }
  if (/record/i.test(kind)) {
    return enumerateSchemaStringPaths(def.valueType, `${path}.*`, branch);
  }
  return [];
}
