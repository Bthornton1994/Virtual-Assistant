export const ROLES = [
  "client_admin",
  "client_member",
  "operator",
  "ops_manager",
  "platform_admin",
] as const;
export type Role = (typeof ROLES)[number];

export const CLIENT_ROLES: Role[] = ["client_admin", "client_member"];
export const OPS_ROLES: Role[] = ["operator", "ops_manager", "platform_admin"];
export const MANAGER_ROLES: Role[] = ["ops_manager", "platform_admin"];

export const REQUEST_STATUSES = [
  "draft",
  "triage",
  "needs_clarification",
  "awaiting_plan_approval",
  "queued",
  "assigned",
  "in_progress",
  "blocked",
  "qa",
  "revision_required",
  "awaiting_action_approval",
  "ready_to_deliver",
  "delivered",
  "accepted",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const APPROVAL_KINDS = [
  "execution_plan",
  "external_email",
  "crm_destructive_change",
  "vendor_communication",
  "sensitive_action",
] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_KIND_COPY: Record<ApprovalKind, { label: string; description: string }> = {
  execution_plan: {
    label: "Execution plan",
    description: "Approve the proposed path before work enters the operations queue.",
  },
  external_email: {
    label: "External email",
    description: "Send or act on outbound email outside the organization.",
  },
  crm_destructive_change: {
    label: "CRM destructive change",
    description: "Overwrite, merge, or delete CRM records.",
  },
  vendor_communication: {
    label: "Vendor communication",
    description: "Contact a vendor on the customer's behalf.",
  },
  sensitive_action: {
    label: "Sensitive action",
    description: "Consequential work. Never proceeds without explicit approval.",
  },
};

export const ACTION_CLASSES = [
  "prepare_only",
  "low_risk_execution",
  "external_execution",
  "sensitive_execution",
] as const;
export type ActionClass = (typeof ACTION_CLASSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const WORKSTREAM_STATUSES = ["scoping", "active", "paused", "retired"] as const;
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];

export const AUDIT_ACTIONS = [
  "auth.login",
  "auth.logout",
  "auth.signup",
  "auth.failed_login",
  "request.created",
  "request.status_changed",
  "request.assigned",
  "request.scope_updated",
  "approval.requested",
  "approval.decided",
  "execution.external",
  "data.exported",
  "permission.changed",
  "integration.accessed",
  "ai.action",
  "memory.updated",
  "schedule.generated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type Actor = {
  id: string;
  email: string;
  name: string;
  role: Role;
  organizationId: string | null;
  operatorId: string | null;
  source: "demo" | "supabase";
};

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  title: string;
  password: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  companySize: string;
  timezone: string;
  createdAt: string;
};

export const OPERATING_MEMORY_FIELDS = [
  { key: "communicationTone", label: "Communication tone" },
  { key: "preferredMeetingWindows", label: "Preferred meeting windows" },
  { key: "crmRules", label: "CRM rules" },
  { key: "escalationContacts", label: "Escalation contacts" },
  { key: "preferredVendors", label: "Preferred vendors" },
  { key: "prohibitedActions", label: "Prohibited actions" },
  { key: "approvalThresholds", label: "Approval thresholds" },
  { key: "formattingPreferences", label: "Formatting preferences" },
] as const;

export type OperatingMemoryFieldKey = (typeof OPERATING_MEMORY_FIELDS)[number]["key"];

export type OperatingMemory = {
  id: string;
  organizationId: string;
  communicationTone: string;
  preferredMeetingWindows: string;
  crmRules: string;
  escalationContacts: string;
  preferredVendors: string;
  prohibitedActions: string;
  approvalThresholds: string;
  formattingPreferences: string;
  updatedBy: string | null;
  updatedAt: string;
};

export function emptyOperatingMemory(organizationId: string): OperatingMemory {
  return {
    id: uid("om"),
    organizationId,
    communicationTone: "",
    preferredMeetingWindows: "",
    crmRules: "",
    escalationContacts: "",
    preferredVendors: "",
    prohibitedActions: "",
    approvalThresholds: "",
    formattingPreferences: "",
    updatedBy: null,
    updatedAt: nowIso(),
  };
}

export function formatOperatingMemory(memory: OperatingMemory): string[] {
  return OPERATING_MEMORY_FIELDS.map((field) => {
    const value = memory[field.key].trim();
    return value ? `${field.label}: ${value}` : "";
  }).filter(Boolean);
}

export const QUEUE_SECTIONS: Array<{ id: string; label: string; statuses: RequestStatus[] }> = [
  { id: "new", label: "New", statuses: ["draft"] },
  { id: "needs_triage", label: "Needs triage", statuses: ["triage"] },
  { id: "awaiting_customer", label: "Awaiting customer", statuses: ["needs_clarification", "awaiting_plan_approval"] },
  { id: "ready", label: "Ready", statuses: ["queued"] },
  { id: "assigned", label: "Assigned", statuses: ["assigned"] },
  { id: "in_progress", label: "In progress", statuses: ["in_progress"] },
  { id: "blocked", label: "Blocked", statuses: ["blocked"] },
  { id: "qa", label: "QA", statuses: ["qa", "revision_required"] },
  { id: "awaiting_approval", label: "Awaiting approval", statuses: ["awaiting_action_approval"] },
  { id: "ready_to_deliver", label: "Ready to deliver", statuses: ["ready_to_deliver"] },
];

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  status: "invited" | "active" | "removed";
  createdAt: string;
};

export type Operator = {
  id: string;
  userId: string;
  name: string;
  platformRole: Extract<Role, "operator" | "ops_manager" | "platform_admin">;
  status: "active" | "away" | "inactive";
  capacityHours: number;
  bio: string;
};

export type Skill = {
  id: string;
  name: string;
  category: string;
};

export type OperatorSkill = {
  operatorId: string;
  skillId: string;
  proficiency: number;
};

export type WorkstreamTemplate = {
  id: string;
  name: string;
  slug: string;
  objective: string;
  sla: string;
  recurringTasks: string[];
  metrics: string[];
};

export type WorkstreamSchedule = {
  cadence: "weekdays" | "weekly" | "none";
  time: string;
  tasks: string[];
};

export type Workstream = {
  id: string;
  organizationId: string;
  templateId: string | null;
  name: string;
  objective: string;
  sla: string;
  recurringTasks: string[];
  metrics: string[];
  ownerUserId: string;
  status: WorkstreamStatus;
  healthScore: number;
  hoursReturned: number;
  schedule: WorkstreamSchedule | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RequestRecord = {
  id: string;
  organizationId: string;
  workstreamId: string | null;
  title: string;
  objective: string;
  description: string;
  deliverable: string;
  priority: Priority;
  status: RequestStatus;
  riskLevel: RiskLevel;
  approvalLevel: ActionClass;
  dueAt: string | null;
  createdBy: string;
  assignedOperatorId: string | null;
  estimatedEffort: number;
  actualEffort: number;
  automationScore: number;
  recurring: boolean;
  externalCommunication: boolean;
  playbookId: string | null;
  missingContext: string[];
  customerInstructions: string;
  internalInstructions: string;
  qaChecklist: string[];
  createdAt: string;
  updatedAt: string;
};

export type RequestStep = {
  id: string;
  organizationId: string;
  requestId: string;
  title: string;
  detail: string;
  owner: "ai" | "automation" | "operator" | "specialist" | "customer";
  status: "pending" | "in_progress" | "blocked" | "done";
  sortOrder: number;
};

export type RequestAssignment = {
  id: string;
  organizationId: string;
  requestId: string;
  operatorId: string;
  assignedBy: string;
  assignedAt: string;
};

export type Approval = {
  id: string;
  organizationId: string;
  requestId: string;
  kind: ApprovalKind;
  action: string;
  description: string;
  riskLevel: RiskLevel;
  actionClass: ActionClass;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  decidedBy: string | null;
  reason: string;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type Clarification = {
  id: string;
  organizationId: string;
  requestId: string;
  question: string;
  askedBy: string;
  answer: string | null;
  answeredBy: string | null;
  createdAt: string;
  answeredAt: string | null;
};

export type DeliveryPackage = {
  id: string;
  organizationId: string;
  requestId: string;
  summary: string;
  deliverables: string[];
  attachments: string[];
  actionsTaken: string[];
  exceptions: string[];
  unresolvedDecisions: string[];
  nextStep: string;
  createdBy: string;
  createdAt: string;
};

export type Playbook = {
  id: string;
  organizationId: string;
  title: string;
  objective: string;
  workstreamId: string | null;
  currentVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PlaybookVersion = {
  id: string;
  organizationId: string;
  playbookId: string;
  version: number;
  steps: string[];
  clientPreferences: string[];
  warnings: string[];
  trigger: string;
  requiredInputs: string[];
  tools: string[];
  authorityLimits: string[];
  approvalPoints: string[];
  qaChecklist: string[];
  knownExceptions: string[];
  templates: string[];
  createdBy: string;
  createdAt: string;
};

export type Comment = {
  id: string;
  organizationId: string;
  requestId: string;
  authorId: string;
  body: string;
  visibility: "customer" | "internal";
  createdAt: string;
};

export type Attachment = {
  id: string;
  organizationId: string;
  requestId: string | null;
  playbookId: string | null;
  name: string;
  path: string;
  uploadedBy: string;
  createdAt: string;
};

export type TimeEntry = {
  id: string;
  organizationId: string;
  requestId: string;
  operatorId: string;
  hours: number;
  note: string;
  createdAt: string;
};

export type QaReview = {
  id: string;
  organizationId: string;
  requestId: string;
  reviewerId: string;
  passed: boolean;
  score: number;
  notes: string;
  checklist: Array<{ item: string; ok: boolean }>;
  defects: string[];
  createdAt: string;
};

export type Integration = {
  id: string;
  organizationId: string;
  provider: string;
  status: "disconnected" | "requested" | "connected";
  scopes: string[];
  lastAccessedAt: string | null;
};

export type Subscription = {
  id: string;
  organizationId: string;
  plan: "starter" | "growth" | "firm";
  status: "trialing" | "active" | "past_due" | "canceled";
  monthlyHours: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: string;
};

export type UsageRecord = {
  id: string;
  organizationId: string;
  period: string;
  hoursUsed: number;
  hoursIncluded: number;
  requestsDelivered: number;
};

export type AuditEvent = {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ExecutionPlan = {
  summary: string;
  actionClass: ActionClass;
  riskLevel: RiskLevel;
  steps: Array<Pick<RequestStep, "title" | "detail" | "owner">>;
  approvalsRequired: boolean;
  automationCandidates: string[];
  humanOwned: string[];
};

export type CreateRequestInput = {
  title: string;
  objective: string;
  description: string;
  deliverable: string;
  dueAt: string | null;
  workstreamId: string | null;
  playbookId?: string | null;
  recurring: boolean;
  externalCommunication: boolean;
  files?: string[];
};

export class AuthzError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthzError";
  }
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function isClientRole(role: Role) {
  return CLIENT_ROLES.includes(role);
}

export function isOpsRole(role: Role) {
  return OPS_ROLES.includes(role);
}

export function isManagerRole(role: Role) {
  return MANAGER_ROLES.includes(role);
}

export function tenantOrgId(actor: Actor): string | null {
  return actor.organizationId;
}

export function canAccessOrganization(actor: Actor, organizationId: string) {
  if (actor.role === "platform_admin" || actor.role === "ops_manager") return true;
  if (actor.role === "operator") return true;
  return actor.organizationId === organizationId;
}

export function assertOrgAccess(actor: Actor, organizationId: string) {
  if (!canAccessOrganization(actor, organizationId)) {
    throw new AuthzError("Cross-tenant access denied");
  }
}

export function canManageTeam(actor: Actor) {
  return actor.role === "client_admin" || actor.role === "platform_admin";
}

export function canAssignOperators(actor: Actor) {
  return isManagerRole(actor.role);
}

export function canMutateOpsQueue(actor: Actor) {
  return isOpsRole(actor.role);
}

export function canDeliverRequest(actor: Actor, request: Pick<RequestRecord, "assignedOperatorId">) {
  if (actor.role === "platform_admin" || actor.role === "ops_manager") return true;
  if (actor.role === "operator") {
    return Boolean(actor.operatorId) && request.assignedOperatorId === actor.operatorId;
  }
  return false;
}

export function canWritePlaybook(actor: Actor) {
  return (
    actor.role === "client_admin" ||
    actor.role === "ops_manager" ||
    actor.role === "platform_admin"
  );
}

export function canDecideApproval(actor: Actor) {
  return actor.role === "client_admin" || actor.role === "client_member";
}

export function canRequestCustomerApproval(actor: Actor) {
  return isOpsRole(actor.role);
}

export function canExportData(actor: Actor) {
  return actor.role === "client_admin" || actor.role === "platform_admin";
}

export const STATUS_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  draft: ["triage", "cancelled"],
  triage: ["needs_clarification", "awaiting_plan_approval", "queued", "cancelled"],
  needs_clarification: ["triage", "awaiting_plan_approval", "cancelled"],
  awaiting_plan_approval: ["queued", "triage", "needs_clarification", "cancelled"],
  queued: ["assigned", "in_progress", "cancelled", "awaiting_plan_approval"],
  assigned: ["in_progress", "queued", "cancelled"],
  in_progress: ["blocked", "qa", "awaiting_action_approval", "cancelled"],
  blocked: ["in_progress", "assigned", "queued", "cancelled"],
  qa: ["ready_to_deliver", "revision_required", "in_progress", "cancelled"],
  revision_required: ["in_progress", "qa", "cancelled"],
  awaiting_action_approval: ["in_progress", "qa", "cancelled"],
  ready_to_deliver: ["delivered", "in_progress", "cancelled"],
  delivered: ["accepted", "in_progress"],
  accepted: [],
  cancelled: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus) {
  return STATUS_TRANSITIONS[from].includes(to);
}

export function requiresExplicitApproval(actionClass: ActionClass) {
  return actionClass === "sensitive_execution" || actionClass === "external_execution";
}

export function blocksWithoutApproval(actionClass: ActionClass) {
  return actionClass === "sensitive_execution";
}

export function activeWorkStatuses(): RequestStatus[] {
  return [
    "triage",
    "needs_clarification",
    "awaiting_plan_approval",
    "queued",
    "assigned",
    "in_progress",
    "blocked",
    "qa",
    "revision_required",
    "awaiting_action_approval",
    "ready_to_deliver",
  ];
}

export function identifyMissingContext(input: {
  title: string;
  objective: string;
  description: string;
  deliverable: string;
  files?: string[];
  playbookApplied?: boolean;
}) {
  if (input.playbookApplied) return [];
  const missing: string[] = [];
  if (!input.deliverable.trim()) missing.push("What does done look like? Name the deliverable.");
  if (input.description.trim().length < 40) missing.push("More context: systems, people, and source material.");
  if (/crm|hubspot|salesforce/i.test(`${input.title} ${input.description}`) && !/hubspot|salesforce/i.test(input.description)) {
    missing.push("Which CRM and which records or pipeline views should we use?");
  }
  if (!input.files?.length && /attach|file|sheet|export/i.test(`${input.title} ${input.description}`)) {
    missing.push("Attach the source file or export this request refers to.");
  }
  return missing;
}

export function inferApprovalKind(text: string): ApprovalKind | null {
  const t = text.toLowerCase();
  if (/\b(email|send |outreach|follow-up mail)\b/.test(t)) return "external_email";
  if (/\b(crm|hubspot|salesforce|overwrite|merge record|delete deal)\b/.test(t)) return "crm_destructive_change";
  if (/\bvendor\b/.test(t)) return "vendor_communication";
  if (/\b(sensitive|payment|wire|access|credential|fund)\b/.test(t)) return "sensitive_action";
  if (/\b(plan|approv)\b/.test(t)) return "execution_plan";
  return null;
}

export function emptyPlaybookVersionFields(): Pick<
  PlaybookVersion,
  | "trigger"
  | "requiredInputs"
  | "tools"
  | "authorityLimits"
  | "approvalPoints"
  | "qaChecklist"
  | "knownExceptions"
  | "templates"
> {
  return {
    trigger: "",
    requiredInputs: [],
    tools: [],
    authorityLimits: [],
    approvalPoints: [],
    qaChecklist: [],
    knownExceptions: [],
    templates: [],
  };
}

export function computeNextRunAt(schedule: WorkstreamSchedule | null): string | null {
  if (!schedule || schedule.cadence === "none") return null;
  const [hh, mm] = (schedule.time || "08:00").split(":").map((n) => Number(n) || 0);
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  d.setHours(hh, mm, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  if (schedule.cadence === "weekdays") {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  }
  return d.toISOString();
}

export function deliveredStatuses(): RequestStatus[] {
  return ["delivered", "accepted"];
}

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export const WORKSTREAM_TEMPLATES: WorkstreamTemplate[] = [
  {
    id: "tpl_executive",
    name: "Executive Operations",
    slug: "executive-operations",
    objective: "Protect founder time with briefing, follow-through, and decision logistics.",
    sla: "Same-day on urgent, 1 business day otherwise",
    recurringTasks: [
      "Daily priority brief",
      "Decision log upkeep",
      "Follow-up chase list",
    ],
    metrics: ["Hours returned", "Brief on-time rate", "Open decisions"],
  },
  {
    id: "tpl_inbox",
    name: "Inbox Operations",
    slug: "inbox-operations",
    objective: "Triage, draft, and file communications so only decisions reach the founder.",
    sla: "Inbox zero-ready draft pack twice daily",
    recurringTasks: ["Morning triage", "Draft replies", "Label and file"],
    metrics: ["Messages processed", "Response latency", "Escalation rate"],
  },
  {
    id: "tpl_sales",
    name: "Sales Operations",
    slug: "sales-operations",
    objective: "Keep pipeline hygiene, proposals, and follow-ups moving without founder admin.",
    sla: "CRM updates same day; proposals in 2 business days",
    recurringTasks: ["Pipeline hygiene", "Proposal assembly", "Follow-up sequences"],
    metrics: ["Stale deals", "Proposal cycle time", "Follow-up coverage"],
  },
  {
    id: "tpl_meetings",
    name: "Meeting Operations",
    slug: "meeting-operations",
    objective: "Schedule, prep, capture, and convert meetings into owned next steps.",
    sla: "Agenda 4 hours before; notes within 4 hours after",
    recurringTasks: ["Scheduling", "Agenda packs", "Notes and actions"],
    metrics: ["Prep on-time", "Action capture rate", "Hours in meetings avoided"],
  },
  {
    id: "tpl_research",
    name: "Research Desk",
    slug: "research-desk",
    objective: "Produce sourced briefs the team can act on without starting from a blank page.",
    sla: "Standard brief in 2 business days",
    recurringTasks: ["Market scans", "Account research", "Competitive notes"],
    metrics: ["Briefs delivered", "Source completeness", "Reuse rate"],
  },
  {
    id: "tpl_customer",
    name: "Customer Operations",
    slug: "customer-operations",
    objective: "Onboard, renew, and support accounts with a consistent operating rhythm.",
    sla: "Onboarding pack in 1 business day; renewals 14 days out",
    recurringTasks: ["Onboarding checklists", "Health reviews", "Renewal prep"],
    metrics: ["Time to onboard", "At-risk accounts", "Renewal readiness"],
  },
  {
    id: "tpl_content",
    name: "Content Operations",
    slug: "content-operations",
    objective: "Turn approved points of view into drafts, assets, and a publish-ready queue.",
    sla: "First draft in 3 business days; publish only after approval",
    recurringTasks: ["Editorial calendar", "Draft production", "Asset packaging"],
    metrics: ["Drafts delivered", "Revision cycles", "Publish-ready queue"],
  },
  {
    id: "tpl_backoffice",
    name: "Back Office Operations",
    slug: "back-office-operations",
    objective: "Keep billing, vendors, and reporting current without founder bookkeeping.",
    sla: "Weekly close pack every Friday; invoices within 1 day of trigger",
    recurringTasks: ["Invoice prep", "Vendor follow-up", "Weekly operating report"],
    metrics: ["Close on-time", "Aging invoices", "Report punctuality"],
  },
];

export const ACTION_CLASS_COPY: Record<
  ActionClass,
  { label: string; description: string }
> = {
  prepare_only: {
    label: "Prepare only",
    description: "Research, organize, or draft. No external action.",
  },
  low_risk_execution: {
    label: "Low-risk execution",
    description: "Reversible, pre-authorized work inside agreed limits.",
  },
  external_execution: {
    label: "External execution",
    description: "Communicate or act outside the company with explicit authority.",
  },
  sensitive_execution: {
    label: "Sensitive execution",
    description: "Consequential or private work. Never proceeds without explicit approval.",
  },
};
