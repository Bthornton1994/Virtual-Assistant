import type { RubricCheck } from "@/lib/release-rescue-rubric";

// The severity model, on its own so the observation catalog can import it.
//
// `release-rescue-observation-catalog.ts` fixes each observation's impact and
// exploitability, and `release-rescue-findings.ts` imports the catalog to
// validate a finding against it. Those two cannot both live in one module
// without a cycle, so the part they share — the enums and the derivation — sits
// here and depends on neither.
//
// The doctrine is unchanged and is the reason this model exists at all: an
// auditor states OBSERVATIONS and severity is DERIVED. It is never a label
// anybody chooses. An executor asked to pick a severity has every incentive to
// reach for "critical" — it reads as thorough, and it sells the remediation
// sprint. What changed under Option 1 is that two of the three inputs are no
// longer asserted by the executor either: impact and exploitability are
// properties of the observation class, so they come from the catalog with the
// code, and only `confidence` is still an executor judgement.

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
