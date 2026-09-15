import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { containsLikelySecret } from "@/lib/release-rescue-redaction";

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
   * Text lifted from the reviewed repository. Must already have been through
   * `prepareExcerpt`, so it is checked for credentials but not for claims — a
   * customer's own source is allowed to contain the word "secure".
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
  "$.reviewedCommitSha": { disposition: "generated", because: "Pinned on the engagement and format-checked." },
  "$.verdict": { disposition: "generated", because: "Derived from the findings, never chosen. One of four values." },
  "$.generatedAt": { disposition: "generated", because: "A timestamp this codebase writes." },

  // --- the frozen scope: the customer's own words, rendered in the header ---
  "$.scope.offerVersion": { disposition: "generated", because: "A literal string constant the offer module owns." },
  "$.scope.repository.provider": { disposition: "generated", because: "A closed enum, validated at intake." },
  "$.scope.repository.accessMode": { disposition: "generated", because: "A closed enum, validated at intake." },
  "$.scope.repository.repositoryRef": {
    disposition: "guarded",
    because: "Customer-supplied at intake and shown in the report header.",
  },
  "$.scope.repository.defaultBranch": {
    disposition: "guarded",
    because: "Customer-supplied free text, shown to the customer.",
  },
  "$.scope.application.name": { disposition: "guarded", because: "Customer-supplied at intake, shown in the header." },
  "$.scope.application.description": {
    disposition: "guarded",
    because:
      "Customer-supplied and used VERBATIM in the report header. This is the field the coverage gap was found in.",
  },
  "$.scope.application.primaryStack": { disposition: "guarded", because: "Customer-supplied at intake, rendered to them." },
  "$.scope.criticalWorkflow.name": { disposition: "guarded", because: "Customer-supplied at intake, rendered to them." },
  "$.scope.criticalWorkflow.description": { disposition: "guarded", because: "Customer-supplied at intake, rendered to them." },
  "$.scope.criticalWorkflow.entryPoint": { disposition: "guarded", because: "Customer-supplied at intake, rendered to them." },
  "$.scope.customerExclusions[]": {
    disposition: "guarded",
    because: "Customer-supplied free text, rendered as the exclusions list.",
  },

  // --- assessments ---
  "$.assessments[].checkId": { disposition: "generated", because: "Must match an id in the frozen rubric." },
  "$.assessments[].outcome": { disposition: "generated", because: "A closed enum the rubric module defines." },
  "$.assessments[].rationale": { disposition: "guarded", because: "Executor-written, rendered per check." },
  "$.assessments[].evidence[].kind": { disposition: "generated", because: "A closed enum the rubric module defines." },
  "$.assessments[].evidence[].reference": {
    disposition: "guarded",
    because: "A path or identifier an executor writes; rendered beside the check.",
  },

  // --- findings ---
  "$.findings[].schemaVersion": { disposition: "generated", because: "A literal string constant the finding module owns." },
  "$.findings[].findingId": { disposition: "generated", because: "An identifier this codebase mints." },
  "$.findings[].rubricCheckId": { disposition: "generated", because: "Must match an id in the frozen rubric." },
  "$.findings[].dimension": { disposition: "generated", because: "A closed enum, taken from the frozen rubric." },
  "$.findings[].severity": { disposition: "generated", because: "Derived from impact, exploitability and confidence." },
  "$.findings[].impact": { disposition: "generated", because: "A closed enum; an input to derived severity." },
  "$.findings[].exploitability": { disposition: "generated", because: "A closed enum; an input to derived severity." },
  "$.findings[].confidence": { disposition: "generated", because: "A closed enum; caps derived severity." },
  "$.findings[].remediationEffort": { disposition: "generated", because: "A closed enum the finding contract defines." },
  "$.findings[].title": { disposition: "guarded", because: "Executor-written free text, rendered to the customer." },
  "$.findings[].whatWeObserved": { disposition: "guarded", because: "Executor-written free text, rendered to the customer." },
  "$.findings[].whyItMatters": { disposition: "guarded", because: "Executor-written free text, rendered to the customer." },
  "$.findings[].recommendation": { disposition: "guarded", because: "Executor-written free text, rendered to the customer." },
  "$.findings[].residualUncertainty": { disposition: "guarded", because: "Executor-written free text, rendered to the customer." },
  "$.findings[].locations[].path": {
    disposition: "guarded",
    because: "A repository path an executor writes; free text in practice, and rendered.",
  },
  // An excerpt is null unless a finding quotes source, so a sample report may not
  // exercise this path. It is classified anyway: the decision is about the field,
  // not about whether today's fixture happens to populate it.
  "$.findings[].locations[].excerpt": {
    disposition: "redacted",
    because:
      "Lifted from the customer's own source. Checked for credentials; NOT checked for claims, because their source may legitimately contain the word 'secure'.",
  },
  "$.findings[].evidenceExcerpts[].path": {
    disposition: "guarded",
    because: "A repository path an executor writes; rendered beside the excerpt.",
  },
  "$.findings[].evidenceExcerpts[].excerpt": {
    disposition: "redacted",
    because: "Lifted from the customer's own source; must already have been through prepareExcerpt.",
  },

  // --- the rest ---
  "$.limitations[]": { disposition: "guarded", because: "Rendered as the report's own limitations." },
  "$.preparedBy.executorKey": { disposition: "generated", because: "A control-plane identifier, not product truth." },
  "$.preparedBy.executorKind": { disposition: "generated", because: "Enum; execution provenance, not product truth." },
  "$.preparedBy.provider": { disposition: "generated", because: "Enum; execution provenance, not product truth." },
  "$.preparedBy.protocolVersion": { disposition: "generated", because: "A control-plane identifier, not product truth." },
  "$.reviewedBy.operatorUserId": { disposition: "generated", because: "An operator identifier from our own records." },
  "$.reviewedBy.displayName": {
    disposition: "guarded",
    because: "An operator's name, rendered to the customer as the signature.",
  },
  "$.reviewedBy.reviewedAt": { disposition: "generated", because: "A timestamp this codebase writes." },
} as const;

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
        for (const claim of findProhibitedClaims(leaf.value)) {
          failures.push({
            path: leaf.path,
            reason: `Makes a prohibited claim ("${claim}"): "${leaf.value.slice(0, 120)}".`,
          });
        }
        if (containsLikelySecret(leaf.value)) {
          failures.push({ path: leaf.path, reason: "Holds an unredacted credential." });
        }
        break;
      }
      case "redacted":
        if (containsLikelySecret(leaf.value)) {
          failures.push({ path: leaf.path, reason: "Holds an unredacted credential." });
        }
        break;
      case "generated":
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
