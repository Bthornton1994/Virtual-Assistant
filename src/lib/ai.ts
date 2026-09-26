import type {
  ActionClass,
  ApprovalKind,
  ExecutionPlan,
  RequestRecord,
  RiskLevel,
} from "@/lib/domain";
import { WORKSTREAM_TEMPLATES, identifyMissingContext as domainMissingContext } from "@/lib/domain";
import {
  classifyRequestRisk,
  planRequiresApproval,
  requiredApprovals,
  resolveApprovalRequirements,
  resolveRequestRisk,
  restrictModelStepOwners,
} from "@/lib/ai-authority";

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

export const mockAI: DelegationAI = {
  async triageRequest(input) {
    const risk = classifyRequestRisk(input);
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
    return requiredApprovals(input);
  },

  async generateExecutionPlan(input) {
    const template = WORKSTREAM_TEMPLATES.find((t) => t.name === input.workstreamName);
    const approvalsRequired = planRequiresApproval(input.actionClass);
    return {
      summary: `Managed path to “${input.deliverable || input.objective}”. AI will classify and draft; a human operator owns judgment and delivery.`,
      actionClass: input.actionClass,
      riskLevel:
        input.actionClass === "sensitive_execution"
          ? "critical"
          : input.actionClass === "external_execution"
            ? "high"
            : input.actionClass === "low_risk_execution"
              ? "medium"
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
    return classifyRequestRisk(input);
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
    return live ? restrictModelStepOwners(live, input.actionClass) : mockAI.generateExecutionPlan(input);
  },
  async classifyRisk(input) {
    // The model may only raise the deterministic classification.
    const suggestion = parseJson<unknown>(
      await liveComplete(`Classify risk JSON {riskLevel, actionClass, reasons}. Sensitive execution if funds, access, legal, or publish. Input: ${JSON.stringify(input)}`),
    );
    return resolveRequestRisk(input, suggestion);
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
    // The model may add approval kinds; policy-required kinds always remain.
    const suggestion = parseJson<unknown>(
      await liveComplete(`Approval requirements JSON {kinds, reasons, requiresCustomerDecision}. Never omit execution_plan. Never allow autonomous send/pay/publish. Input: ${JSON.stringify(input)}`),
    );
    return resolveApprovalRequirements(input, suggestion);
  },
  async generatePlaybook(input) {
    const live = parseJson<PlaybookDraft>(
      await liveComplete(`Playbook JSON {title, objective, steps, clientPreferences, warnings}. Input: ${JSON.stringify(input)}`),
    );
    return live ?? mockAI.generatePlaybook(input);
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
async function generatePlaybook(input: Parameters<DelegationAI["generatePlaybook"]>[0]) {
  return delegationAI.generatePlaybook(input);
}
async function identifyAutomationOpportunity(input: Parameters<DelegationAI["identifyAutomationOpportunity"]>[0]) {
  return delegationAI.identifyAutomationOpportunity(input);
}
