import type {
  ActionClass,
  ApprovalKind,
  ExecutionPlan,
  RequestRecord,
  RiskLevel,
} from "@/lib/domain";
import { WORKSTREAM_TEMPLATES, blocksWithoutApproval, identifyMissingContext as domainMissingContext } from "@/lib/domain";

export type TriageResult = {
  workstreamSlug: string;
  priority: RequestRecord["priority"];
  actionClass: ActionClass;
  riskLevel: RiskLevel;
  estimatedEffort: number;
  automationScore: number;
  rationale: string;
};

export type RoutingSuggestion = {
  executor: "ai" | "automation" | "operator" | "specialist";
  skillHints: string[];
  reason: string;
  humanRequired: boolean;
};

export type QaResult = {
  passed: boolean;
  score: number;
  checklist: Array<{ item: string; ok: boolean }>;
  residualRisk: string;
};

export type PlaybookDraft = {
  title: string;
  objective: string;
  steps: string[];
  clientPreferences: string[];
  warnings: string[];
};

export type ApprovalRequirement = {
  kinds: ApprovalKind[];
  reasons: string[];
  requiresCustomerDecision: boolean;
};

export type AutomationOpportunity = {
  candidate: boolean;
  step: string;
  reason: string;
  requiresHumanApproval: boolean;
};

export type OutcomeSummary = {
  summary: string;
};

export interface DelegationAI {
  triageRequest(input: {
    title: string;
    objective: string;
    description: string;
    externalCommunication: boolean;
  }): Promise<TriageResult>;
  classifyWorkstream(input: { title: string; objective: string; description: string }): Promise<{
    workstreamSlug: string;
    rationale: string;
  }>;
  identifyMissingContext(input: {
    title: string;
    objective: string;
    description: string;
    deliverable: string;
    files?: string[];
    playbookApplied?: boolean;
  }): Promise<{ missing: string[] }>;
  generateExecutionPlan(input: {
    title: string;
    objective: string;
    description: string;
    deliverable: string;
    workstreamName?: string;
    actionClass: ActionClass;
  }): Promise<ExecutionPlan>;
  classifyRisk(input: {
    title: string;
    description: string;
    externalCommunication: boolean;
  }): Promise<{ riskLevel: RiskLevel; actionClass: ActionClass; reasons: string[] }>;
  determineApprovalRequirements(input: {
    title: string;
    description: string;
    actionClass: ActionClass;
    externalCommunication: boolean;
  }): Promise<ApprovalRequirement>;
  suggestExecutor(input: {
    actionClass: ActionClass;
    workstreamName?: string;
    title: string;
  }): Promise<RoutingSuggestion>;
  suggestRouting(input: {
    actionClass: ActionClass;
    workstreamName?: string;
    title: string;
  }): Promise<RoutingSuggestion>;
  qaDeliverable(input: {
    objective: string;
    deliverable: string;
    notes: string;
    actionClass: ActionClass;
  }): Promise<QaResult>;
  summarizeOutcome(input: {
    title: string;
    deliverable: string;
    actionsTaken: string[];
    exceptions: string[];
    nextStep: string;
  }): Promise<OutcomeSummary>;
  generatePlaybook(input: {
    title: string;
    objective: string;
    description: string;
  }): Promise<PlaybookDraft>;
  identifyAutomationOpportunity(input: {
    title: string;
    actionClass: ActionClass;
    recurring: boolean;
  }): Promise<AutomationOpportunity>;
}

const SENSITIVE =
  /\b(wire|transfer funds|bank|payroll|password|credential|contract sign|nda|legal|lawsuit|publish|buy|purchase|commit|prod access|production access|delete account|invoice pay)\b/i;
const EXTERNAL =
  /\b(email (the )?client|send to|outreach|call the|publish|post on|linkedin|customer email)\b/i;

function inferActionClass(input: {
  title: string;
  description: string;
  externalCommunication: boolean;
}): { actionClass: ActionClass; riskLevel: RiskLevel; reasons: string[] } {
  const text = `${input.title} ${input.description}`;
  const reasons: string[] = [];
  if (SENSITIVE.test(text)) {
    reasons.push("Language indicates consequential, financial, or access-changing work.");
    return { actionClass: "sensitive_execution", riskLevel: "critical", reasons };
  }
  if (input.externalCommunication || EXTERNAL.test(text)) {
    reasons.push("Work may communicate or act outside the organization.");
    return { actionClass: "external_execution", riskLevel: "high", reasons };
  }
  if (/\b(draft|research|brief|summar|organize|file|prep)\b/i.test(text)) {
    reasons.push("Framed as preparation, research, or drafting.");
    return { actionClass: "prepare_only", riskLevel: "low", reasons };
  }
  reasons.push("Internal reversible work with no sensitive markers.");
  return { actionClass: "low_risk_execution", riskLevel: "medium", reasons };
}

function inferWorkstream(text: string) {
  const pairs: Array<[RegExp, string]> = [
    [/inbox|email|reply/i, "inbox-operations"],
    [/pipeline|crm|proposal|deal/i, "sales-operations"],
    [/meeting|agenda|notes|schedule/i, "meeting-operations"],
    [/research|competitor|market|brief/i, "research-desk"],
    [/onboard|renewal|customer success|account health/i, "customer-operations"],
    [/content|newsletter|linkedin|blog/i, "content-operations"],
    [/invoice|billing|vendor|report/i, "back-office-operations"],
    [/founder|brief|decision|exec/i, "executive-operations"],
  ];
  for (const [re, slug] of pairs) {
    if (re.test(text)) return slug;
  }
  return "executive-operations";
}

function routeFor(input: { actionClass: ActionClass; workstreamName?: string; title: string }): RoutingSuggestion {
  if (input.actionClass === "sensitive_execution") {
    return {
      executor: "specialist",
      skillHints: ["sensitive-ops", "qa"],
      reason: "Sensitive execution is human-owned. AI may only prepare materials.",
      humanRequired: true,
    };
  }
  if (input.actionClass === "external_execution") {
    return {
      executor: "operator",
      skillHints: ["communications"],
      reason: "External action requires an accountable operator after approval.",
      humanRequired: true,
    };
  }
  if (input.actionClass === "prepare_only") {
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

export const mockAI: DelegationAI = {
  async triageRequest(input) {
    const risk = inferActionClass(input);
    const classified = await mockAI.classifyWorkstream(input);
    const estimatedEffort =
      risk.actionClass === "sensitive_execution"
        ? 4
        : risk.actionClass === "external_execution"
          ? 3
          : 2;
    return {
      workstreamSlug: classified.workstreamSlug,
      priority: risk.riskLevel === "critical" ? "urgent" : risk.riskLevel === "high" ? "high" : "medium",
      actionClass: risk.actionClass,
      riskLevel: risk.riskLevel,
      estimatedEffort,
      automationScore: risk.actionClass === "prepare_only" ? 62 : 28,
      rationale: [classified.rationale, ...risk.reasons].join(" "),
    };
  },

  async classifyWorkstream(input) {
    const slug = inferWorkstream(`${input.title} ${input.objective} ${input.description}`);
    return { workstreamSlug: slug, rationale: `Classified as ${slug.replaceAll("-", " ")}.` };
  },

  async identifyMissingContext(input) {
    return { missing: domainMissingContext(input) };
  },

  async determineApprovalRequirements(input) {
    const kinds: ApprovalKind[] = ["execution_plan"];
    const reasons: string[] = ["Every request presents an execution plan before work enters the queue."];
    if (input.actionClass === "external_execution" || input.externalCommunication || /\b(email|send|outreach|follow-up)\b/i.test(`${input.title} ${input.description}`)) {
      kinds.push("external_email");
      reasons.push("Outbound communication is prepared only until the customer approves sending.");
    }
    if (/\b(crm|hubspot|salesforce).*(delete|overwrite|merge)\b/i.test(`${input.title} ${input.description}`)) {
      kinds.push("crm_destructive_change");
      reasons.push("Destructive CRM changes require an explicit approval object.");
    }
    if (/\bvendor\b/i.test(`${input.title} ${input.description}`) && input.externalCommunication) {
      kinds.push("vendor_communication");
      reasons.push("Vendor communication is an approval object.");
    }
    if (input.actionClass === "sensitive_execution") {
      kinds.push("sensitive_action");
      reasons.push("Sensitive execution never proceeds without explicit approval.");
    }
    return {
      kinds: [...new Set(kinds)],
      reasons,
      requiresCustomerDecision: kinds.length > 0,
    };
  },

  async suggestExecutor(input) {
    return routeFor(input);
  },

  async generateExecutionPlan(input) {
    const template = WORKSTREAM_TEMPLATES.find((t) => t.name === input.workstreamName);
    const approvalsRequired = blocksWithoutApproval(input.actionClass) || input.actionClass === "external_execution";
    return {
      summary: `Managed path to “${input.deliverable || input.objective}”. AI will classify and draft; a human operator owns judgment and delivery.`,
      actionClass: input.actionClass,
      riskLevel:
        input.actionClass === "sensitive_execution"
          ? "critical"
          : input.actionClass === "external_execution"
            ? "high"
            : "low",
      steps: [
        {
          title: "Clarify outcome and authority",
          detail: "Confirm the result, source material, and allowed action class.",
          owner: "operator",
        },
        {
          title: "Assemble context",
          detail: template
            ? `Pull the ${template.name.toLowerCase()} inputs and prior playbook steps.`
            : "Collect files, systems, and prior examples.",
          owner: "ai",
        },
        {
          title: "Produce working draft",
          detail: "Create the first version of the deliverable without acting externally.",
          owner: input.actionClass === "prepare_only" ? "ai" : "operator",
        },
        {
          title: approvalsRequired ? "Obtain explicit approval" : "Internal quality check",
          detail: approvalsRequired
            ? "Sensitive or external work cannot proceed until the customer approves."
            : "Check the draft against the objective and acceptance criteria.",
          owner: approvalsRequired ? "customer" : "operator",
        },
        {
          title: "QA and delivery",
          detail: "Verify sources, authority limits, and residual risk, then deliver the outcome.",
          owner: "specialist",
        },
      ],
      approvalsRequired,
      automationCandidates: ["File naming", "Checklist generation", "Status notifications"],
      humanOwned: ["Authority decisions", "External communication", "Final acceptance"],
    };
  },

  async classifyRisk(input) {
    return inferActionClass(input);
  },

  async suggestRouting(input) {
    return routeFor(input);
  },

  async qaDeliverable(input) {
    const hasObjective = input.notes.toLowerCase().includes(input.objective.slice(0, 12).toLowerCase()) || input.notes.length > 40;
    const checklist = [
      { item: "Matches stated objective", ok: hasObjective },
      { item: "Deliverable type is present", ok: input.deliverable.length > 0 },
      { item: "Authority limits respected", ok: input.actionClass !== "sensitive_execution" || /approv/i.test(input.notes) },
      { item: "Residual uncertainty disclosed", ok: true },
    ];
    const score = Math.round((checklist.filter((c) => c.ok).length / checklist.length) * 100);
    return {
      passed: score >= 75,
      score,
      checklist,
      residualRisk:
        input.actionClass === "sensitive_execution"
          ? "Sensitive work must remain customer-authorized."
          : "Standard residual risk: source freshness and unstated preferences.",
    };
  },

  async generatePlaybook(input) {
    return {
      title: input.title || "Untitled playbook",
      objective: input.objective,
      steps: [
        "Confirm the outcome, deadline, and action class.",
        "Collect source files and system access actually required.",
        "Produce a prepare-only draft.",
        "Run the quality checklist.",
        "Request approval if the action class is external or sensitive.",
        "Deliver and capture corrections for the next version.",
      ],
      clientPreferences: ["Plain language", "Cite sources", "Do not act externally without approval"],
      warnings: [
        "AI must not independently send, purchase, publish, commit, transfer funds, or change access.",
        "Do not reuse confidential material from another organization.",
      ],
    };
  },

  async summarizeOutcome(input) {
    const exceptions = input.exceptions.length ? ` Exceptions: ${input.exceptions.join("; ")}.` : "";
    return {
      summary: `${input.title}: delivered ${input.deliverable}. ${input.actionsTaken.join("; ") || "No actions listed."}${exceptions} Next: ${input.nextStep || "None recorded."}`,
    };
  },

  async identifyAutomationOpportunity(input) {
    if (input.actionClass === "sensitive_execution") {
      return {
        candidate: false,
        step: "None",
        reason: "Sensitive work is not an automation candidate.",
        requiresHumanApproval: true,
      };
    }
    if (input.recurring && input.actionClass === "prepare_only") {
      return {
        candidate: true,
        step: "Assemble context / checklist",
        reason: "Recurring prepare-only work can earn automation after a proven playbook.",
        requiresHumanApproval: true,
      };
    }
    return {
      candidate: input.recurring,
      step: "Draft production",
      reason: "Drafting may be automated later. Sending, purchasing, publishing, or changing access cannot be autonomous.",
      requiresHumanApproval: true,
    };
  },
};

async function liveComplete(prompt: string): Promise<string | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;
  const model = process.env.XAI_MODEL || "grok-4.6";
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are Delegation Cloud's operations planner. Never instruct sending, purchasing, publishing, committing, transferring funds, or changing access without explicit human approval. Return compact JSON only.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

export const delegationAI: DelegationAI = {
  async triageRequest(input) {
    const live = parseJson<TriageResult>(
      await liveComplete(`Triage this request as JSON with keys workstreamSlug, priority, actionClass, riskLevel, estimatedEffort, automationScore, rationale. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.triageRequest(input);
  },
  async generateExecutionPlan(input) {
    const live = parseJson<ExecutionPlan>(
      await liveComplete(`Create an execution plan JSON with summary, actionClass, riskLevel, steps[{title,detail,owner}], approvalsRequired, automationCandidates, humanOwned. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.generateExecutionPlan(input);
  },
  async classifyRisk(input) {
    const live = parseJson<{ riskLevel: RiskLevel; actionClass: ActionClass; reasons: string[] }>(
      await liveComplete(`Classify risk JSON {riskLevel, actionClass, reasons}. Sensitive execution if funds, access, legal, or publish. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.classifyRisk(input);
  },
  async suggestRouting(input) {
    const live = parseJson<RoutingSuggestion>(
      await liveComplete(`Routing JSON {executor, skillHints, reason, humanRequired}. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.suggestRouting(input);
  },
  async qaDeliverable(input) {
    const live = parseJson<QaResult>(
      await liveComplete(`QA JSON {passed, score, checklist[{item,ok}], residualRisk}. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.qaDeliverable(input);
  },
  async classifyWorkstream(input) {
    const live = parseJson<{ workstreamSlug: string; rationale: string }>(
      await liveComplete(`Classify workstream JSON {workstreamSlug, rationale}. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.classifyWorkstream(input);
  },
  async identifyMissingContext(input) {
    const live = parseJson<{ missing: string[] }>(
      await liveComplete(`Missing context JSON {missing: string[]}. If complete, missing is []. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.identifyMissingContext(input);
  },
  async determineApprovalRequirements(input) {
    const live = parseJson<ApprovalRequirement>(
      await liveComplete(`Approval requirements JSON {kinds, reasons, requiresCustomerDecision}. Never omit execution_plan. Never allow autonomous send/pay/publish. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.determineApprovalRequirements(input);
  },
  async suggestExecutor(input) {
    const live = parseJson<RoutingSuggestion>(
      await liveComplete(`Executor JSON {executor, skillHints, reason, humanRequired}. Sensitive work is never unsupervised AI. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.suggestExecutor(input);
  },
  async generatePlaybook(input) {
    const live = parseJson<PlaybookDraft>(
      await liveComplete(`Playbook JSON {title, objective, steps, clientPreferences, warnings}. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.generatePlaybook(input);
  },
  async summarizeOutcome(input) {
    const live = parseJson<OutcomeSummary>(
      await liveComplete(`Outcome summary JSON {summary}. Do not claim unapproved external action. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.summarizeOutcome(input);
  },
  async identifyAutomationOpportunity(input) {
    const live = parseJson<AutomationOpportunity>(
      await liveComplete(`Automation JSON {candidate, step, reason, requiresHumanApproval}. Sensitive/external send is never autonomous. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.identifyAutomationOpportunity(input);
  },
};

export {
  triageRequest,
  classifyWorkstream,
  identifyMissingContext,
  generateExecutionPlan,
  classifyRisk,
  determineApprovalRequirements,
  suggestExecutor,
  suggestRouting,
  qaDeliverable,
  summarizeOutcome,
  generatePlaybook,
  identifyAutomationOpportunity,
};

async function triageRequest(input: Parameters<DelegationAI["triageRequest"]>[0]) {
  return delegationAI.triageRequest(input);
}
async function classifyWorkstream(input: Parameters<DelegationAI["classifyWorkstream"]>[0]) {
  return delegationAI.classifyWorkstream(input);
}
async function identifyMissingContext(input: Parameters<DelegationAI["identifyMissingContext"]>[0]) {
  return delegationAI.identifyMissingContext(input);
}
async function generateExecutionPlan(input: Parameters<DelegationAI["generateExecutionPlan"]>[0]) {
  return delegationAI.generateExecutionPlan(input);
}
async function classifyRisk(input: Parameters<DelegationAI["classifyRisk"]>[0]) {
  return delegationAI.classifyRisk(input);
}
async function determineApprovalRequirements(input: Parameters<DelegationAI["determineApprovalRequirements"]>[0]) {
  return delegationAI.determineApprovalRequirements(input);
}
async function suggestExecutor(input: Parameters<DelegationAI["suggestExecutor"]>[0]) {
  return delegationAI.suggestExecutor(input);
}
async function suggestRouting(input: Parameters<DelegationAI["suggestRouting"]>[0]) {
  return delegationAI.suggestRouting(input);
}
async function qaDeliverable(input: Parameters<DelegationAI["qaDeliverable"]>[0]) {
  return delegationAI.qaDeliverable(input);
}
async function summarizeOutcome(input: Parameters<DelegationAI["summarizeOutcome"]>[0]) {
  return delegationAI.summarizeOutcome(input);
}
async function generatePlaybook(input: Parameters<DelegationAI["generatePlaybook"]>[0]) {
  return delegationAI.generatePlaybook(input);
}
async function identifyAutomationOpportunity(input: Parameters<DelegationAI["identifyAutomationOpportunity"]>[0]) {
  return delegationAI.identifyAutomationOpportunity(input);
}
