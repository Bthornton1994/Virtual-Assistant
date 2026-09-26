import { MANAGER_ROLES, type Actor } from "@/lib/domain";

// The engagement lifecycle, as a contract.
//
// One graph, stated once, mirrored by `release_rescue_engagement_transition_allowed`
// in supabase/migrations/20260918090000_release_rescue_lifecycle_graph_v14.sql.
// A static test reads the edge list out of that migration and fails if the two
// disagree, so neither side can drift from the other quietly.
//
// The database is authoritative. This module exists so application code that
// moves an engagement can refuse an illegal move before it reaches Postgres, and
// so a surface can ask what is possible from a given state without a round trip.
//
// Three moves are not on the normal path and are modelled explicitly rather than
// as edges, because each needs an authority the normal path does not carry:
//
//   cancelled -> intake   a manager-authorized RECOVERY, with a reason code.
//   any       -> purged   the retention sweep, and nothing else.
//   delivered -> anything is refused. A delivered engagement does not reopen on
//                         the normal path. No abnormal path is defined here; one
//                         would be an owner decision, not a code change.

export const ENGAGEMENT_STATUSES = [
  "intake",
  "scoped",
  "access_granted",
  "auditing",
  "report_ready",
  "delivered",
  "cancelled",
  "purged",
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

/**
 * Normal-path edges: the forward order, and cancellation from every state before
 * delivery. Nothing else. `delivered`, `cancelled` and `purged` have no
 * normal-path exit.
 */
export const ENGAGEMENT_TRANSITIONS: Readonly<Record<EngagementStatus, readonly EngagementStatus[]>> = {
  intake: ["scoped", "cancelled"],
  scoped: ["access_granted", "cancelled"],
  access_granted: ["auditing", "cancelled"],
  auditing: ["report_ready", "cancelled"],
  report_ready: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
  purged: [],
};

/** The state a recovered engagement returns to. It restarts, it does not resume. */
export const RECOVERY_TARGET_STATUS = "intake" as const satisfies EngagementStatus;

/**
 * Why a cancelled engagement is being reopened. A code, not a sentence, for the
 * same reason a review decision and a clearance are codes (D-011, D-013): the
 * value is stored beside a customer's engagement and rendered to operators.
 */
export const ENGAGEMENT_RECOVERY_REASON_CODES = [
  "cancelled_in_error_by_operator",
  "customer_asked_to_resume_before_purge",
  "cancelled_for_payment_that_has_since_cleared",
] as const;
export type EngagementRecoveryReasonCode = (typeof ENGAGEMENT_RECOVERY_REASON_CODES)[number];

export const ENGAGEMENT_RECOVERY_REASON_CATALOG: Readonly<Record<EngagementRecoveryReasonCode, string>> = {
  cancelled_in_error_by_operator: "An operator cancelled this engagement by mistake and a manager reopened it.",
  customer_asked_to_resume_before_purge:
    "The customer asked to resume this engagement before its retention deadline and a manager reopened it.",
  cancelled_for_payment_that_has_since_cleared:
    "This engagement was cancelled while payment was outstanding; payment has cleared and a manager reopened it.",
};

export function isEngagementRecoveryReasonCode(code: string): code is EngagementRecoveryReasonCode {
  return Object.prototype.hasOwnProperty.call(ENGAGEMENT_RECOVERY_REASON_CATALOG, code);
}

/**
 * Who is asking for the move. The normal path needs nothing beyond the caller's
 * ordinary write access, which the database's row policies decide.
 */
export type TransitionAuthority =
  | { readonly kind: "normal" }
  | { readonly kind: "manager_recovery"; readonly authorizedBy: Actor; readonly reasonCode: string }
  | { readonly kind: "retention_sweep" };

export type TransitionPath = "forward" | "cancel" | "recovery" | "purge";

export type TransitionDecision =
  | { readonly allowed: true; readonly path: TransitionPath }
  | { readonly allowed: false; readonly reason: string };

function isManagerActingAsThemselves(actor: Actor): boolean {
  // A demo-source actor is the sample workspace's cookie login, not an
  // authenticated person. Authority over a real engagement requires the latter.
  return actor.source === "supabase" && MANAGER_ROLES.includes(actor.role);
}

/**
 * Decide whether `from -> to` is permitted, and on which path.
 *
 * Same answer as the database trigger, minus the state-entry preconditions
 * (a live grant, an issued report) that only the database can see.
 */
export function decideEngagementTransition(
  from: EngagementStatus,
  to: EngagementStatus,
  authority: TransitionAuthority = { kind: "normal" },
): TransitionDecision {
  if (from === to) {
    return { allowed: false, reason: `The engagement is already ${to}.` };
  }

  if (to === "purged") {
    if (authority.kind === "retention_sweep") return { allowed: true, path: "purge" };
    return {
      allowed: false,
      reason: "An engagement is marked purged by the retention sweep, not by a caller.",
    };
  }

  if (from === "purged") {
    return { allowed: false, reason: "A purged engagement has no further lifecycle." };
  }

  if (from === "cancelled") {
    if (to !== RECOVERY_TARGET_STATUS) {
      return {
        allowed: false,
        reason: `A cancelled engagement can only be reopened at ${RECOVERY_TARGET_STATUS}, by a manager-authorized recovery.`,
      };
    }
    if (authority.kind !== "manager_recovery") {
      return {
        allowed: false,
        reason: "Reopening a cancelled engagement requires a manager-authorized recovery with a reason code.",
      };
    }
    if (!isManagerActingAsThemselves(authority.authorizedBy)) {
      return {
        allowed: false,
        reason: "A cancelled engagement may only be reopened by an ops manager or platform admin acting as themselves.",
      };
    }
    if (!isEngagementRecoveryReasonCode(authority.reasonCode)) {
      return {
        allowed: false,
        reason: "The recovery reason must be a code from the recovery catalog, not text.",
      };
    }
    return { allowed: true, path: "recovery" };
  }

  if (from === "delivered") {
    return { allowed: false, reason: "A delivered engagement does not reopen." };
  }

  if (authority.kind !== "normal") {
    // A recovery or a sweep asked for a normal-path move. Refused rather than
    // downgraded: the caller asserted an authority the move does not take.
    return {
      allowed: false,
      reason: `${from} -> ${to} is a normal-path transition and takes no special authority.`,
    };
  }

  if (!ENGAGEMENT_TRANSITIONS[from].includes(to)) {
    return { allowed: false, reason: `${from} -> ${to} is not a permitted transition.` };
  }

  return { allowed: true, path: to === "cancelled" ? "cancel" : "forward" };
}

export function canTransitionEngagement(
  from: EngagementStatus,
  to: EngagementStatus,
  authority: TransitionAuthority = { kind: "normal" },
): boolean {
  return decideEngagementTransition(from, to, authority).allowed;
}
