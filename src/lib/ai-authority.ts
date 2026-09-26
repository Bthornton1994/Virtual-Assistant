import type { ActionClass, ApprovalKind, ExecutionPlan, RequestStatus, RequestStep, RiskLevel } from "@/lib/domain";
import { ACTION_CLASSES, APPROVAL_KINDS, RISK_LEVELS, blocksWithoutApproval } from "@/lib/domain";
import type { ApprovalRequirement, RoutingSuggestion } from "@/lib/ai";

// Request authority (action class, risk level, approval requirements, and
// executor routing) is decided here, in deterministic code. A model may
// suggest a stricter answer; it can never lower one (AGENTS.md, "Executors
// and authoritative state"). An unrecognised suggestion is ignored, so the
// deterministic floor stands.

export type RiskDecision = { actionClass: ActionClass; riskLevel: RiskLevel; reasons: string[] };

const SENSITIVE =
  /\b(wire|transfer funds|bank|payroll|password|credential|contract sign|nda|legal|lawsuit|publish|buy|purchase|commit|prod access|production access|delete account|invoice pay)\b/i;
const EXTERNAL =
  /\b(email (the )?client|send to|outreach|call the|publish|post on|linkedin|customer email)\b/i;

/** The lowest risk level each action class may carry. */
const RISK_FLOOR: Record<ActionClass, RiskLevel> = {
  prepare_only: "low",
  low_risk_execution: "medium",
  external_execution: "high",
  sensitive_execution: "critical",
};

function rank<T extends string>(order: readonly T[], value: unknown): number {
  return typeof value === "string" ? order.indexOf(value as T) : -1;
}

function stricter<T extends string>(order: readonly T[], floor: T, suggestion: unknown): T {
  return rank(order, suggestion) > rank(order, floor) ? (suggestion as T) : floor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

type RequestText = {
  title: string;
  description: string;
  objective?: string;
  deliverable?: string;
  externalCommunication: boolean;
};

/**
 * The deterministic classification of a request from its own text and flags.
 * Every field the requester wrote is read, so consequential wording in the
 * objective or deliverable is not missed.
 */
export function classifyRequestRisk(input: RequestText): RiskDecision {
  const text = [input.title, input.objective, input.description, input.deliverable].filter(Boolean).join(" ");
  if (SENSITIVE.test(text)) {
    return {
      actionClass: "sensitive_execution",
      riskLevel: "critical",
      reasons: ["Language indicates consequential, financial, or access-changing work."],
    };
  }
  if (input.externalCommunication || EXTERNAL.test(text)) {
    return { actionClass: "external_execution", riskLevel: "high", reasons: ["Work may communicate or act outside the organization."] };
  }
  if (/\b(draft|research|brief|summar|organize|file|prep)\b/i.test(text)) {
    return { actionClass: "prepare_only", riskLevel: "low", reasons: ["Framed as preparation, research, or drafting."] };
  }
  return { actionClass: "low_risk_execution", riskLevel: "medium", reasons: ["Internal reversible work with no sensitive markers."] };
}

/**
 * The request's authoritative risk decision. The deterministic classification
 * is the floor; a model suggestion is used only where it is a known, stricter
 * value. The risk level never falls below the floor for the final action class.
 */
export function resolveRequestRisk(input: RequestText, suggestion: unknown): RiskDecision {
  const floor = classifyRequestRisk(input);
  const proposed = isRecord(suggestion) ? suggestion : {};
  const actionClass = stricter(ACTION_CLASSES, floor.actionClass, proposed.actionClass);
  const riskLevel = stricter(RISK_LEVELS, stricter(RISK_LEVELS, floor.riskLevel, RISK_FLOOR[actionClass]), proposed.riskLevel);
  const raised = actionClass !== floor.actionClass || riskLevel !== floor.riskLevel;
  return {
    actionClass,
    riskLevel,
    reasons: raised ? [...floor.reasons, ...stringList(proposed.reasons)] : floor.reasons,
  };
}

/**
 * Re-derive authority after a request's scope is edited. Returns the raised
 * decision when the edited text calls for a stricter class or risk level than
 * the request holds, and null otherwise. It never lowers either.
 */
export function raiseRiskForScope(request: RequestText & { approvalLevel: ActionClass; riskLevel: RiskLevel }): RiskDecision | null {
  const decision = resolveRequestRisk(request, { actionClass: request.approvalLevel, riskLevel: request.riskLevel });
  const raised = decision.actionClass !== request.approvalLevel || decision.riskLevel !== request.riskLevel;
  return raised ? decision : null;
}

/** The approvals policy requires for a request with a decided action class. */
export function requiredApprovals(input: {
  title: string;
  description: string;
  actionClass: ActionClass;
  externalCommunication: boolean;
}): ApprovalRequirement {
  const text = `${input.title} ${input.description}`;
  const kinds: ApprovalKind[] = ["execution_plan"];
  const reasons: string[] = ["Every request presents an execution plan before work enters the queue."];
  if (input.actionClass === "external_execution" || input.externalCommunication || /\b(email|send|outreach|follow-up)\b/i.test(text)) {
    kinds.push("external_email");
    reasons.push("Outbound communication is prepared only until the customer approves sending.");
  }
  if (/\b(crm|hubspot|salesforce).*(delete|overwrite|merge)\b/i.test(text)) {
    kinds.push("crm_destructive_change");
    reasons.push("Destructive CRM changes require an explicit approval object.");
  }
  if (/\bvendor\b/i.test(text) && input.externalCommunication) {
    kinds.push("vendor_communication");
    reasons.push("Vendor communication is an approval object.");
  }
  if (blocksWithoutApproval(input.actionClass)) {
    kinds.push("sensitive_action");
    reasons.push("Sensitive execution never proceeds without explicit approval.");
  }
  return { kinds, reasons, requiresCustomerDecision: true };
}

/**
 * The request's authoritative approval requirements: every approval policy
 * requires, plus any known approval kind a model suggests. A model can add an
 * approval; it cannot remove one.
 */
export function resolveApprovalRequirements(
  input: { title: string; description: string; actionClass: ActionClass; externalCommunication: boolean },
  suggestion: unknown,
): ApprovalRequirement {
  const required = requiredApprovals(input);
  const proposed = isRecord(suggestion) ? suggestion : {};
  const added = stringList(proposed.kinds).filter(
    (kind): kind is ApprovalKind => (APPROVAL_KINDS as readonly string[]).includes(kind) && !required.kinds.includes(kind as ApprovalKind),
  );
  return {
    kinds: [...new Set([...required.kinds, ...added])],
    reasons: added.length ? [...required.reasons, ...stringList(proposed.reasons)] : required.reasons,
    requiresCustomerDecision: true,
  };
}

/** Executor routing is a function of the action class alone. No model input. */
export function routeForActionClass(actionClass: ActionClass): RoutingSuggestion {
  if (actionClass === "sensitive_execution") {
    return {
      executor: "specialist",
      skillHints: ["sensitive-ops", "qa"],
      reason: "Sensitive execution is human-owned. AI may only prepare materials.",
      humanRequired: true,
    };
  }
  if (actionClass === "external_execution") {
    return {
      executor: "operator",
      skillHints: ["communications"],
      reason: "External action requires an accountable operator after approval.",
      humanRequired: true,
    };
  }
  if (actionClass === "prepare_only") {
    return {
      executor: "ai",
      skillHints: ["research", "drafting"],
      reason: "Preparation work can be AI-assisted with operator review.",
      humanRequired: false,
    };
  }
  return {
    executor: "operator",
    skillHints: ["general-ops"],
    reason: "Low-risk execution is operator-led with light automation.",
    humanRequired: true,
  };
}

/** Whether policy requires customer approval before the plan's work proceeds. */
export function planRequiresApproval(actionClass: ActionClass): boolean {
  return blocksWithoutApproval(actionClass) || actionClass === "external_execution";
}

/**
 * Bind a plan's authority fields to the request's decided authority. The
 * plan's steps and wording stay as generated; its action class is the
 * request's, its risk level is never below the request's, and it requires
 * approval whenever policy does.
 */
export function bindPlanToAuthority(plan: ExecutionPlan, authority: { actionClass: ActionClass; riskLevel: RiskLevel }): ExecutionPlan {
  return {
    ...plan,
    actionClass: authority.actionClass,
    riskLevel: stricter(RISK_LEVELS, authority.riskLevel, plan.riskLevel),
    approvalsRequired: plan.approvalsRequired === true || planRequiresApproval(authority.actionClass),
  };
}

/**
 * A model-written plan cannot route its own steps to unsupervised executors.
 * Above prepare_only, a step the model assigned to "ai" or "automation" is
 * assigned to an operator instead. Deterministic plans are not passed here.
 */
export function restrictModelStepOwners<T>(plan: T, actionClass: ActionClass): T {
  if (actionClass === "prepare_only" || !isRecord(plan) || !Array.isArray(plan.steps)) return plan;
  return {
    ...plan,
    steps: plan.steps.map((step: unknown) =>
      isRecord(step) && (step.owner === "ai" || step.owner === "automation") ? { ...step, owner: "operator" } : step,
    ),
  };
}

/** The step owner policy allows for a request's action class. */
export function ownerForAuthority(owner: RequestStep["owner"], actionClass: ActionClass): RequestStep["owner"] {
  return actionClass !== "prepare_only" && (owner === "ai" || owner === "automation") ? "operator" : owner;
}

// Accepted and cancelled requests cannot move again. A delivered request can
// be reopened, so a raise puts it back to plan approval like active work.
const TERMINAL_STATUSES: readonly RequestStatus[] = ["accepted", "cancelled"];
// Before the plan is put to the customer; answering the last clarification
// creates the plan approval at the request's (raised) class.
const PRE_PLAN_STATUSES: readonly RequestStatus[] = ["draft", "needs_clarification"];

/**
 * What a raise in authority requires of a request in a given status.
 * - "record": the request is finished; stored records are realigned only.
 * - "approvals": the plan has not been put to the customer yet (it will be,
 *   at the raised class); newly required action approvals are requested.
 * - "reapprove": the customer approved, or is approving, a plan at the lower
 *   class; the request returns to plan approval at the raised class.
 */
export function reapprovalAfterRaise(status: RequestStatus): "record" | "approvals" | "reapprove" {
  if (TERMINAL_STATUSES.includes(status)) return "record";
  if (PRE_PLAN_STATUSES.includes(status)) return "approvals";
  return "reapprove";
}

/**
 * An approval authorizes the class it was given at. One recorded at a lower
 * class than the request now holds (because its scope was raised since) does
 * not satisfy any gate. An unknown class covers nothing.
 */
export function approvalCovers(approval: { actionClass: ActionClass | null | undefined }, request: { approvalLevel: ActionClass }): boolean {
  const given = rank(ACTION_CLASSES, approval.actionClass);
  return given >= 0 && given >= rank(ACTION_CLASSES, request.approvalLevel);
}

/** The class to record on a new approval: its own class, or the request's if stricter. */
export function approvalClassFor(actionClass: ActionClass, request: { approvalLevel: ActionClass }): ActionClass {
  return stricter(ACTION_CLASSES, request.approvalLevel, actionClass);
}
