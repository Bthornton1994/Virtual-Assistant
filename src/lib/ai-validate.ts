import {
  ACTION_CLASSES,
  APPROVAL_KINDS,
  DomainError,
  PRIORITIES,
  RISK_LEVELS,
  type ActionClass,
  type ApprovalKind,
  type ExecutionPlan,
  type Priority,
  type RiskLevel,
} from "@/lib/domain";
import type {
  ApprovalRequirement,
  AutomationOpportunity,
  PlaybookDraft,
  TriageResult,
} from "@/lib/ai";

function fail(what: string): never {
  throw new DomainError(`${what} failed validation and was not saved.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function inSet<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  fail(`${label} is not a permitted value`);
}

export function validateTriage(value: unknown): TriageResult {
  if (!isRecord(value)) fail("AI triage");
  const priority = inSet<Priority>(value.priority, PRIORITIES, "AI triage priority");
  const actionClass = inSet<ActionClass>(value.actionClass, ACTION_CLASSES, "AI triage action class");
  const riskLevel = inSet<RiskLevel>(value.riskLevel, RISK_LEVELS, "AI triage risk");
  const workstreamSlug = asString(value.workstreamSlug).trim();
  if (!workstreamSlug) fail("AI triage workstream");
  return {
    workstreamSlug,
    priority,
    actionClass,
    riskLevel,
    estimatedEffort: Math.max(0, asNumber(value.estimatedEffort, 1)),
    automationScore: Math.min(100, Math.max(0, asNumber(value.automationScore))),
    rationale: asString(value.rationale),
  };
}

export function validateExecutionPlan(value: unknown): ExecutionPlan {
  if (!isRecord(value)) fail("AI execution plan");
  const steps = Array.isArray(value.steps)
    ? value.steps
        .filter(isRecord)
        .map((step) => ({
          title: asString(step.title).trim(),
          detail: asString(step.detail),
          owner: (["ai", "operator", "customer", "specialist"].includes(asString(step.owner))
            ? step.owner
            : "operator") as ExecutionPlan["steps"][number]["owner"],
        }))
        .filter((step) => step.title)
    : [];
  if (!steps.length) fail("AI execution plan steps");
  return {
    summary: asString(value.summary).trim() || "Managed execution plan",
    actionClass: inSet<ActionClass>(value.actionClass, ACTION_CLASSES, "AI plan action class"),
    riskLevel: inSet<RiskLevel>(value.riskLevel, RISK_LEVELS, "AI plan risk"),
    steps,
    approvalsRequired: asBool(value.approvalsRequired),
    automationCandidates: asStringArray(value.automationCandidates),
    humanOwned: asStringArray(value.humanOwned),
  };
}

export function validateMissingContext(value: unknown): { missing: string[] } {
  if (!isRecord(value)) fail("AI missing-context");
  return { missing: asStringArray(value.missing) };
}

export function validateApprovalRequirement(value: unknown): ApprovalRequirement {
  if (!isRecord(value)) fail("AI approval requirements");
  const kinds = asStringArray(value.kinds).filter((kind): kind is ApprovalKind =>
    (APPROVAL_KINDS as readonly string[]).includes(kind),
  );
  if (!kinds.includes("execution_plan")) kinds.unshift("execution_plan");
  return {
    kinds: [...new Set(kinds)],
    reasons: asStringArray(value.reasons),
    requiresCustomerDecision: asBool(value.requiresCustomerDecision, true),
  };
}

export function validatePlaybookDraft(value: unknown): PlaybookDraft {
  if (!isRecord(value)) fail("AI playbook");
  const title = asString(value.title).trim();
  const steps = asStringArray(value.steps);
  if (!title || !steps.length) fail("AI playbook");
  return {
    title,
    objective: asString(value.objective),
    steps,
    clientPreferences: asStringArray(value.clientPreferences),
    warnings: asStringArray(value.warnings),
  };
}

export function validateAutomation(value: unknown): AutomationOpportunity {
  if (!isRecord(value)) fail("AI automation");
  return {
    candidate: asBool(value.candidate),
    step: asString(value.step) || "None",
    reason: asString(value.reason),
    requiresHumanApproval: true,
  };
}

export function validatedOrFallback<T>(value: unknown, validate: (input: unknown) => T, fallback: T): T {
  try {
    return validate(value);
  } catch {
    return validate(fallback);
  }
}
