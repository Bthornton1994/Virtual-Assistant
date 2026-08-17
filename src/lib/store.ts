import {
  ACTION_CLASSES,
  AuthzError,
  DomainError,
  type ActionClass,
  type Actor,
  type Approval,
  type Attachment,
  type AuditEvent,
  type AuditAction,
  type Comment,
  type CreateRequestInput,
  type ExecutionPlan,
  type Integration,
  type Operator,
  type OperatorSkill,
  type Organization,
  type OrganizationMember,
  type Playbook,
  type PlaybookVersion,
  type QaReview,
  type RequestAssignment,
  type RequestRecord,
  type RequestStatus,
  type RequestStep,
  type Role,
  type Skill,
  type Subscription,
  type TimeEntry,
  type UsageRecord,
  type UserRecord,
  type Workstream,
  type WorkstreamTemplate,
  WORKSTREAM_TEMPLATES,
  assertOrgAccess,
  blocksWithoutApproval,
  canAssignOperators,
  canDecideApproval,
  canManageTeam,
  canMutateOpsQueue,
  canRequestCustomerApproval,
  canTransition,
  canWritePlaybook,
  deliveredStatuses,
  isClientRole,
  nowIso,
  uid,
} from "@/lib/domain";
import { mockAI } from "@/lib/ai";

export type StoreData = {
  users: UserRecord[];
  organizations: Organization[];
  members: OrganizationMember[];
  operators: Operator[];
  skills: Skill[];
  operatorSkills: OperatorSkill[];
  workstreamTemplates: WorkstreamTemplate[];
  workstreams: Workstream[];
  requests: RequestRecord[];
  steps: RequestStep[];
  assignments: RequestAssignment[];
  approvals: Approval[];
  playbooks: Playbook[];
  playbookVersions: PlaybookVersion[];
  comments: Comment[];
  attachments: Attachment[];
  timeEntries: TimeEntry[];
  qaReviews: QaReview[];
  integrations: Integration[];
  subscriptions: Subscription[];
  usage: UsageRecord[];
  audits: AuditEvent[];
  plans: Record<string, ExecutionPlan>;
};

const DEMO_PASSWORD = "demo";

function isoDaysFromNow(days: number, hours = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

export function emptyData(): StoreData {
  return {
    users: [],
    organizations: [],
    members: [],
    operators: [],
    skills: [],
    operatorSkills: [],
    workstreamTemplates: [...WORKSTREAM_TEMPLATES],
    workstreams: [],
    requests: [],
    steps: [],
    assignments: [],
    approvals: [],
    playbooks: [],
    playbookVersions: [],
    comments: [],
    attachments: [],
    timeEntries: [],
    qaReviews: [],
    integrations: [],
    subscriptions: [],
    usage: [],
    audits: [],
    plans: {},
  };
}

export function seedData(): StoreData {
  const data = emptyData();
  const createdAt = isoDaysFromNow(-40);

  data.users = [
    { id: "usr_founder", email: "founder@northline.demo", name: "Elena Voss", title: "Managing Partner", password: DEMO_PASSWORD },
    { id: "usr_teammate", email: "teammate@northline.demo", name: "Marcus Hale", title: "Director of Delivery", password: DEMO_PASSWORD },
    { id: "usr_op", email: "op@delegation.cloud", name: "Maya Chen", title: "Operator", password: DEMO_PASSWORD },
    { id: "usr_manager", email: "manager@delegation.cloud", name: "Noah Idris", title: "Ops Manager", password: DEMO_PASSWORD },
    { id: "usr_admin", email: "admin@delegation.cloud", name: "Samira Patel", title: "Platform Admin", password: DEMO_PASSWORD },
    { id: "usr_julian", email: "julian@delegation.cloud", name: "Julian Okonkwo", title: "Operator", password: DEMO_PASSWORD },
    { id: "usr_priya", email: "priya@delegation.cloud", name: "Priya Shah", title: "Operator", password: DEMO_PASSWORD },
  ];

  data.organizations = [
    {
      id: "org_northline",
      name: "Northline Advisory",
      slug: "northline",
      industry: "Management consulting",
      companySize: "18",
      timezone: "America/Chicago",
      createdAt,
    },
    {
      id: "org_harbor",
      name: "Harbor & Co.",
      slug: "harbor",
      industry: "Boutique recruiting",
      companySize: "9",
      timezone: "America/New_York",
      createdAt,
    },
  ];

  data.members = [
    { id: "mem_1", organizationId: "org_northline", userId: "usr_founder", role: "client_admin", status: "active", createdAt },
    { id: "mem_2", organizationId: "org_northline", userId: "usr_teammate", role: "client_member", status: "active", createdAt },
    { id: "mem_3", organizationId: "org_harbor", userId: "usr_founder", role: "client_member", status: "removed", createdAt },
  ];

  data.operators = [
    { id: "op_maya", userId: "usr_op", name: "Maya Chen", platformRole: "operator", status: "active", capacityHours: 32, bio: "Executive and inbox operations." },
    { id: "op_julian", userId: "usr_julian", name: "Julian Okonkwo", platformRole: "operator", status: "active", capacityHours: 30, bio: "Sales operations and research." },
    { id: "op_priya", userId: "usr_priya", name: "Priya Shah", platformRole: "operator", status: "active", capacityHours: 28, bio: "Customer and content operations." },
    { id: "op_noah", userId: "usr_manager", name: "Noah Idris", platformRole: "ops_manager", status: "active", capacityHours: 20, bio: "Queue, QA, and client health." },
    { id: "op_samira", userId: "usr_admin", name: "Samira Patel", platformRole: "platform_admin", status: "active", capacityHours: 10, bio: "Platform controls and security." },
  ];

  data.skills = [
    { id: "sk_exec", name: "Executive briefing", category: "operations" },
    { id: "sk_inbox", name: "Inbox triage", category: "communications" },
    { id: "sk_sales", name: "Sales operations", category: "revenue" },
    { id: "sk_research", name: "Research", category: "insight" },
    { id: "sk_content", name: "Content systems", category: "content" },
    { id: "sk_qa", name: "Quality assurance", category: "quality" },
  ];
  data.operatorSkills = [
    { operatorId: "op_maya", skillId: "sk_exec", proficiency: 5 },
    { operatorId: "op_maya", skillId: "sk_inbox", proficiency: 5 },
    { operatorId: "op_julian", skillId: "sk_sales", proficiency: 5 },
    { operatorId: "op_julian", skillId: "sk_research", proficiency: 4 },
    { operatorId: "op_priya", skillId: "sk_content", proficiency: 5 },
    { operatorId: "op_noah", skillId: "sk_qa", proficiency: 5 },
  ];

  const ws = (
    id: string,
    templateId: string,
    health: number,
    hours: number,
    status: Workstream["status"] = "active",
  ): Workstream => {
    const tpl = WORKSTREAM_TEMPLATES.find((t) => t.id === templateId)!;
    return {
      id,
      organizationId: "org_northline",
      templateId,
      name: tpl.name,
      objective: tpl.objective,
      sla: tpl.sla,
      recurringTasks: tpl.recurringTasks,
      metrics: tpl.metrics,
      ownerUserId: "usr_founder",
      status,
      healthScore: health,
      hoursReturned: hours,
      createdAt,
      updatedAt: nowIso(),
    };
  };

  data.workstreams = [
    ws("ws_exec", "tpl_executive", 88, 11.5),
    ws("ws_inbox", "tpl_inbox", 64, 9.0),
    ws("ws_sales", "tpl_sales", 81, 7.5),
    ws("ws_meet", "tpl_meetings", 90, 6.0),
    ws("ws_research", "tpl_research", 86, 4.5),
    ws("ws_customer", "tpl_customer", 73, 3.5),
    ws("ws_content", "tpl_content", 84, 3.0),
    ws("ws_back", "tpl_backoffice", 79, 2.5),
  ];

  const req = (partial: Partial<RequestRecord> & Pick<RequestRecord, "id" | "title" | "status" | "workstreamId">): RequestRecord => ({
    organizationId: "org_northline",
    objective: partial.objective ?? partial.title,
    description: partial.description ?? partial.title,
    deliverable: partial.deliverable ?? "Documented outcome",
    priority: "medium",
    riskLevel: "low",
    approvalLevel: "prepare_only",
    dueAt: isoDaysFromNow(3),
    createdBy: "usr_founder",
    assignedOperatorId: "op_maya",
    estimatedEffort: 2,
    actualEffort: 0,
    automationScore: 30,
    recurring: false,
    externalCommunication: false,
    createdAt: isoDaysFromNow(-4),
    updatedAt: nowIso(),
    ...partial,
  });

  data.requests = [
    req({
      id: "req_brief",
      workstreamId: "ws_exec",
      title: "Monday decision brief",
      objective: "A one-page brief Elena can use in the partners meeting.",
      description: "Summarize open decisions, owners, and what is blocked.",
      deliverable: "One-page decision brief",
      status: "in_progress",
      priority: "high",
      approvalLevel: "prepare_only",
      recurring: true,
    }),
    req({
      id: "req_inbox",
      workstreamId: "ws_inbox",
      title: "Triage founder inbox — this week",
      objective: "Only decisions and relationship-critical mail reach Elena.",
      description: "Triage, draft replies, file the rest. Do not send.",
      deliverable: "Draft pack + recommended actions",
      status: "queued",
      approvalLevel: "prepare_only",
      assignedOperatorId: "op_maya",
      recurring: true,
    }),
    req({
      id: "req_proposal",
      workstreamId: "ws_sales",
      title: "Assemble Meridian proposal",
      objective: "A proposal ready for Elena to review before it goes to the client.",
      description: "Use the approved rate card. Do not send to the client.",
      deliverable: "Proposal draft in Northline format",
      status: "qa",
      priority: "high",
      assignedOperatorId: "op_julian",
      estimatedEffort: 4,
      automationScore: 45,
    }),
    req({
      id: "req_wire",
      workstreamId: "ws_back",
      title: "Prepare vendor retainer payment pack",
      objective: "Everything finance needs to pay the research vendor — without initiating payment.",
      description: "Compile invoice, SOW, and approval history. Payment is sensitive and must not proceed without explicit approval.",
      deliverable: "Payment pack + approval request",
      status: "awaiting_approval",
      priority: "urgent",
      riskLevel: "critical",
      approvalLevel: "sensitive_execution",
      assignedOperatorId: "op_priya",
      dueAt: isoDaysFromNow(1),
    }),
    req({
      id: "req_outreach",
      workstreamId: "ws_sales",
      title: "Send follow-up to Meridian champion",
      objective: "A checked follow-up email after approval.",
      description: "External email to the buying champion summarizing next steps.",
      deliverable: "Approved email sent by operator",
      status: "awaiting_approval",
      riskLevel: "high",
      approvalLevel: "external_execution",
      externalCommunication: true,
      assignedOperatorId: "op_julian",
    }),
    req({
      id: "req_notes",
      workstreamId: "ws_meet",
      title: "Board prep notes — April offsite",
      objective: "Agenda, attendee brief, and open questions.",
      description: "Prepare only. Do not invite anyone yet.",
      deliverable: "Agenda pack",
      status: "delivered",
      actualEffort: 2.5,
      createdAt: isoDaysFromNow(-8),
    }),
    req({
      id: "req_research",
      workstreamId: "ws_research",
      title: "Competitive scan: boutique ops consultancies",
      objective: "Sourced brief on five peers.",
      description: "Public sources only.",
      deliverable: "Research brief",
      status: "accepted",
      actualEffort: 3.5,
      createdAt: isoDaysFromNow(-12),
    }),
    req({
      id: "req_onboard",
      workstreamId: "ws_customer",
      title: "Onboarding checklist for Helio Analytics",
      objective: "Kickoff pack and first 14-day plan.",
      description: "Customer operations playbook v2.",
      deliverable: "Onboarding pack",
      status: "blocked",
      riskLevel: "medium",
      approvalLevel: "low_risk_execution",
      assignedOperatorId: "op_priya",
    }),
    req({
      id: "req_content",
      workstreamId: "ws_content",
      title: "Draft POV: managed delegation vs. hiring",
      objective: "A publish-ready draft. Do not publish.",
      description: "Content operations. Prepare only.",
      deliverable: "1,000-word draft",
      status: "ready",
      approvalLevel: "prepare_only",
      assignedOperatorId: "op_priya",
    }),
    req({
      id: "req_report",
      workstreamId: "ws_back",
      title: "Weekly operating report",
      objective: "Friday pack for the partners meeting.",
      description: "Recurring back-office report.",
      deliverable: "Weekly report",
      status: "triage",
      recurring: true,
      assignedOperatorId: null,
    }),
    req({
      id: "req_harbor",
      organizationId: "org_harbor",
      workstreamId: null,
      title: "Harbor confidential pipeline cleanup",
      objective: "Internal only — other tenants must never see this.",
      description: "Used to prove tenant isolation.",
      deliverable: "CRM hygiene log",
      status: "in_progress",
      createdBy: "usr_teammate",
      assignedOperatorId: "op_julian",
    }),
  ];

  data.steps = [
    { id: "st_1", organizationId: "org_northline", requestId: "req_brief", title: "Pull open decisions", detail: "From last week’s log", owner: "ai", status: "done", sortOrder: 1 },
    { id: "st_2", organizationId: "org_northline", requestId: "req_brief", title: "Write brief", detail: "One page, no fluff", owner: "operator", status: "in_progress", sortOrder: 2 },
    { id: "st_3", organizationId: "org_northline", requestId: "req_brief", title: "QA", detail: "Check owners and dates", owner: "specialist", status: "pending", sortOrder: 3 },
  ];

  data.assignments = [
    { id: "as_1", organizationId: "org_northline", requestId: "req_brief", operatorId: "op_maya", assignedBy: "usr_manager", assignedAt: isoDaysFromNow(-1) },
    { id: "as_2", organizationId: "org_northline", requestId: "req_proposal", operatorId: "op_julian", assignedBy: "usr_manager", assignedAt: isoDaysFromNow(-2) },
  ];

  data.approvals = [
    {
      id: "ap_wire",
      organizationId: "org_northline",
      requestId: "req_wire",
      actionClass: "sensitive_execution",
      status: "pending",
      requestedBy: "usr_manager",
      decidedBy: null,
      reason: "Payment pack is ready. Initiating payment requires explicit approval.",
      decisionNote: null,
      createdAt: isoDaysFromNow(-1),
      decidedAt: null,
    },
    {
      id: "ap_mail",
      organizationId: "org_northline",
      requestId: "req_outreach",
      actionClass: "external_execution",
      status: "pending",
      requestedBy: "usr_op",
      decidedBy: null,
      reason: "External email to a client champion.",
      decisionNote: null,
      createdAt: isoDaysFromNow(-1),
      decidedAt: null,
    },
  ];

  const pb = (id: string, title: string, objective: string, wsId: string): Playbook => ({
    id,
    organizationId: "org_northline",
    title,
    objective,
    workstreamId: wsId,
    currentVersion: 2,
    createdBy: "usr_founder",
    createdAt,
    updatedAt: nowIso(),
  });
  data.playbooks = [
    pb("pb_inbox", "Founder inbox — prepare only", "Triage and draft. Never send.", "ws_inbox"),
    pb("pb_proposal", "Proposal assembly", "Build from the approved rate card.", "ws_sales"),
    pb("pb_brief", "Monday decision brief", "One page. Decisions, owners, blocks.", "ws_exec"),
  ];
  data.playbookVersions = [
    {
      id: "pv_inbox_1",
      organizationId: "org_northline",
      playbookId: "pb_inbox",
      version: 1,
      steps: ["Scan unread", "Bucket", "Draft"],
      clientPreferences: ["Short"],
      warnings: ["Do not send"],
      createdBy: "usr_founder",
      createdAt: isoDaysFromNow(-20),
    },
    {
      id: "pv_inbox_2",
      organizationId: "org_northline",
      playbookId: "pb_inbox",
      version: 2,
      steps: [
        "Scan unread and snoozed",
        "Bucket: decide / draft / file / ignore",
        "Draft in Elena’s voice",
        "Escalate relationship-critical threads",
        "Do not send",
      ],
      clientPreferences: ["No exclamation points", "Sign-off reserved for Elena"],
      warnings: ["Never send. Never share another client’s threads."],
      createdBy: "op_maya",
      createdAt: isoDaysFromNow(-6),
    },
    {
      id: "pv_prop_2",
      organizationId: "org_northline",
      playbookId: "pb_proposal",
      version: 2,
      steps: ["Pull discovery notes", "Apply rate card", "Draft scope", "Internal QA"],
      clientPreferences: ["Fixed-fee first", "No discount language"],
      warnings: ["Do not send to the client."],
      createdBy: "op_julian",
      createdAt: isoDaysFromNow(-5),
    },
    {
      id: "pv_brief_2",
      organizationId: "org_northline",
      playbookId: "pb_brief",
      version: 2,
      steps: ["Collect open decisions", "Mark owners", "Flag blocks", "One page"],
      clientPreferences: ["Bullets over prose"],
      warnings: ["No confidential Harbor material."],
      createdBy: "usr_founder",
      createdAt: isoDaysFromNow(-3),
    },
  ];

  data.comments = [
    { id: "cm_1", organizationId: "org_northline", requestId: "req_brief", authorId: "usr_founder", body: "Keep it to one page. Call out the Meridian decision first.", createdAt: isoDaysFromNow(-1) },
    { id: "cm_2", organizationId: "org_northline", requestId: "req_onboard", authorId: "op_priya", body: "Blocked on the security questionnaire from Helio.", createdAt: isoDaysFromNow(-1) },
  ];

  data.attachments = [
    { id: "at_1", organizationId: "org_northline", requestId: "req_proposal", playbookId: null, name: "northline-rate-card.pdf", path: "org_northline/req_proposal/northline-rate-card.pdf", uploadedBy: "usr_founder", createdAt: isoDaysFromNow(-3) },
  ];

  data.timeEntries = [
    { id: "te_1", organizationId: "org_northline", requestId: "req_notes", operatorId: "op_maya", hours: 2.5, note: "Agenda pack", createdAt: isoDaysFromNow(-7) },
    { id: "te_2", organizationId: "org_northline", requestId: "req_research", operatorId: "op_julian", hours: 3.5, note: "Competitive scan", createdAt: isoDaysFromNow(-10) },
  ];

  data.qaReviews = [
    { id: "qa_1", organizationId: "org_northline", requestId: "req_proposal", reviewerId: "usr_manager", passed: false, score: 80, notes: "In QA. Check rate card line items.", createdAt: isoDaysFromNow(-1) },
  ];

  data.integrations = [
    { id: "in_1", organizationId: "org_northline", provider: "Google Workspace", status: "connected", scopes: ["email.readonly", "calendar.readonly"], lastAccessedAt: isoDaysFromNow(-1) },
    { id: "in_2", organizationId: "org_northline", provider: "HubSpot", status: "requested", scopes: ["crm.objects.deals.read"], lastAccessedAt: null },
    { id: "in_3", organizationId: "org_northline", provider: "Slack", status: "disconnected", scopes: ["chat:write"], lastAccessedAt: null },
    { id: "in_4", organizationId: "org_northline", provider: "QuickBooks", status: "disconnected", scopes: ["invoices.read"], lastAccessedAt: null },
  ];

  data.subscriptions = [
    {
      id: "sub_1",
      organizationId: "org_northline",
      plan: "growth",
      status: "active",
      monthlyHours: 40,
      stripeCustomerId: "cus_demo_northline",
      stripeSubscriptionId: "sub_demo_northline",
      currentPeriodEnd: isoDaysFromNow(18),
    },
  ];

  data.usage = [
    { id: "us_1", organizationId: "org_northline", period: "2026-08", hoursUsed: 18.5, hoursIncluded: 40, requestsDelivered: 6 },
  ];

  data.audits = [
    { id: "au_1", organizationId: "org_northline", actorId: "usr_founder", action: "auth.login", entityType: "user", entityId: "usr_founder", metadata: {}, createdAt: isoDaysFromNow(-1) },
    { id: "au_2", organizationId: "org_northline", actorId: "usr_founder", action: "request.created", entityType: "request", entityId: "req_brief", metadata: { title: "Monday decision brief" }, createdAt: isoDaysFromNow(-4) },
  ];

  return data;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStore {
  data: StoreData;

  constructor(data?: StoreData) {
    this.data = data ? clone(data) : seedData();
  }

  private audit(
    actor: Actor | null,
    action: AuditAction,
    entityType: string,
    entityId: string | null,
    organizationId: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    this.data.audits.unshift({
      id: uid("au"),
      organizationId,
      actorId: actor?.id ?? null,
      action,
      entityType,
      entityId,
      metadata,
      createdAt: nowIso(),
    });
  }

  private visibleOrgIds(actor: Actor) {
    if (actor.role === "platform_admin" || actor.role === "ops_manager" || actor.role === "operator") {
      return this.data.organizations.map((o) => o.id);
    }
    return this.data.members
      .filter((m) => m.userId === actor.id && m.status === "active")
      .map((m) => m.organizationId);
  }

  private filterByTenant<T extends { organizationId: string }>(actor: Actor, rows: T[]) {
    const orgs = new Set(this.visibleOrgIds(actor));
    return rows.filter((r) => orgs.has(r.organizationId));
  }

  actorFromUser(userId: string): Actor | null {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) return null;
    const op = this.data.operators.find((o) => o.userId === userId);
    const membership = this.data.members.find((m) => m.userId === userId && m.status === "active");
    const role: Role = op?.platformRole ?? membership?.role ?? "client_member";
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      organizationId: isClientRole(role) ? membership?.organizationId ?? null : null,
      operatorId: op?.id ?? null,
    };
  }

  authenticate(email: string, password: string): Actor {
    const user = this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user || user.password !== password) {
      this.audit(null, "auth.failed_login", "user", null, null, { email });
      throw new DomainError("Invalid email or password");
    }
    const actor = this.actorFromUser(user.id);
    if (!actor) throw new DomainError("Invalid email or password");
    this.audit(actor, "auth.login", "user", actor.id, actor.organizationId, { email });
    return actor;
  }

  signup(input: { name: string; email: string; password: string; organization: string; industry: string }) {
    if (this.data.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new DomainError("An account with that email already exists");
    }
    const user: UserRecord = {
      id: uid("usr"),
      email: input.email,
      name: input.name,
      title: "Founder",
      password: input.password || DEMO_PASSWORD,
    };
    const org: Organization = {
      id: uid("org"),
      name: input.organization,
      slug: input.organization.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      industry: input.industry || "Professional services",
      companySize: "1-20",
      timezone: "America/Chicago",
      createdAt: nowIso(),
    };
    this.data.users.push(user);
    this.data.organizations.push(org);
    this.data.members.push({
      id: uid("mem"),
      organizationId: org.id,
      userId: user.id,
      role: "client_admin",
      status: "active",
      createdAt: nowIso(),
    });
    for (const tpl of WORKSTREAM_TEMPLATES) {
      this.data.workstreams.push({
        id: uid("ws"),
        organizationId: org.id,
        templateId: tpl.id,
        name: tpl.name,
        objective: tpl.objective,
        sla: tpl.sla,
        recurringTasks: tpl.recurringTasks,
        metrics: tpl.metrics,
        ownerUserId: user.id,
        status: "scoping",
        healthScore: 70,
        hoursReturned: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
    this.data.subscriptions.push({
      id: uid("sub"),
      organizationId: org.id,
      plan: "starter",
      status: "trialing",
      monthlyHours: 20,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: new Date(Date.now() + 14 * 86400000).toISOString(),
    });
    const actor = this.actorFromUser(user.id)!;
    this.audit(actor, "auth.signup", "organization", org.id, org.id, { email: user.email });
    return actor;
  }

  listOrganizations(actor: Actor) {
    const ids = new Set(this.visibleOrgIds(actor));
    return this.data.organizations.filter((o) => ids.has(o.id));
  }

  getOrganization(actor: Actor, id: string) {
    assertOrgAccess(actor, id);
    const org = this.data.organizations.find((o) => o.id === id);
    if (!org) throw new DomainError("Organization not found");
    return org;
  }

  updateOrganization(
    actor: Actor,
    id: string,
    patch: Partial<Pick<Organization, "name" | "industry" | "companySize" | "timezone">>,
  ) {
    if (!canManageTeam(actor)) throw new AuthzError("Only a client admin can change organization settings");
    const org = this.getOrganization(actor, id);
    Object.assign(org, patch);
    this.audit(actor, "permission.changed", "organization", id, id, { patch });
    return org;
  }

  listMembers(actor: Actor, organizationId: string) {
    assertOrgAccess(actor, organizationId);
    return this.data.members
      .filter((m) => m.organizationId === organizationId)
      .map((m) => ({ ...m, user: this.data.users.find((u) => u.id === m.userId) }));
  }

  inviteMember(actor: Actor, input: { email: string; name: string; role: Role }) {
    if (!canManageTeam(actor) || !actor.organizationId) throw new AuthzError();
    let user = this.data.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase());
    if (!user) {
      user = {
        id: uid("usr"),
        email: input.email,
        name: input.name,
        title: "Team member",
        password: DEMO_PASSWORD,
      };
      this.data.users.push(user);
    }
    const existing = this.data.members.find(
      (m) => m.organizationId === actor.organizationId && m.userId === user!.id,
    );
    if (existing) {
      existing.status = "active";
      existing.role = input.role;
    } else {
      this.data.members.push({
        id: uid("mem"),
        organizationId: actor.organizationId,
        userId: user.id,
        role: input.role,
        status: "active",
        createdAt: nowIso(),
      });
    }
    this.audit(actor, "permission.changed", "member", user.id, actor.organizationId, {
      email: input.email,
      role: input.role,
    });
    return user;
  }

  listOperators(actor: Actor) {
    if (!canMutateOpsQueue(actor) && !isClientRole(actor.role)) throw new AuthzError();
    return this.data.operators.map((op) => ({
      ...op,
      skills: this.data.operatorSkills
        .filter((s) => s.operatorId === op.id)
        .map((s) => ({
          ...s,
          skill: this.data.skills.find((sk) => sk.id === s.skillId),
        })),
    }));
  }

  listWorkstreamTemplates() {
    return this.data.workstreamTemplates;
  }

  listWorkstreams(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (!orgId) {
      if (!canMutateOpsQueue(actor)) return [];
      return this.data.workstreams;
    }
    assertOrgAccess(actor, orgId);
    return this.data.workstreams.filter((w) => w.organizationId === orgId);
  }

  getWorkstream(actor: Actor, id: string) {
    const ws = this.data.workstreams.find((w) => w.id === id);
    if (!ws) throw new DomainError("Workstream not found");
    assertOrgAccess(actor, ws.organizationId);
    return ws;
  }

  listRequests(actor: Actor, filters?: { organizationId?: string; status?: RequestStatus; workstreamId?: string }) {
    let rows = this.filterByTenant(actor, this.data.requests);
    if (filters?.organizationId) {
      assertOrgAccess(actor, filters.organizationId);
      rows = rows.filter((r) => r.organizationId === filters.organizationId);
    }
    if (filters?.status) rows = rows.filter((r) => r.status === filters.status);
    if (filters?.workstreamId) rows = rows.filter((r) => r.workstreamId === filters.workstreamId);
    if (actor.role === "operator" && actor.operatorId) {
      rows = rows.filter((r) => !r.assignedOperatorId || r.assignedOperatorId === actor.operatorId);
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getRequest(actor: Actor, id: string) {
    const req = this.data.requests.find((r) => r.id === id);
    if (!req) throw new DomainError("Request not found");
    assertOrgAccess(actor, req.organizationId);
    if (actor.role === "operator" && actor.operatorId && req.assignedOperatorId && req.assignedOperatorId !== actor.operatorId) {
      throw new AuthzError("Operators can only open assigned requests");
    }
    return req;
  }

  getRequestBundle(actor: Actor, id: string) {
    const request = this.getRequest(actor, id);
    return {
      request,
      workstream: request.workstreamId
        ? this.data.workstreams.find((w) => w.id === request.workstreamId) ?? null
        : null,
      steps: this.data.steps.filter((s) => s.requestId === id).sort((a, b) => a.sortOrder - b.sortOrder),
      assignments: this.data.assignments.filter((a) => a.requestId === id),
      approvals: this.data.approvals.filter((a) => a.requestId === id),
      comments: this.data.comments.filter((c) => c.requestId === id),
      attachments: this.data.attachments.filter((a) => a.requestId === id),
      timeEntries: this.data.timeEntries.filter((t) => t.requestId === id),
      qa: this.data.qaReviews.filter((q) => q.requestId === id),
      plan: this.data.plans[id] ?? null,
      organization: this.data.organizations.find((o) => o.id === request.organizationId)!,
      operator: request.assignedOperatorId
        ? this.data.operators.find((o) => o.id === request.assignedOperatorId) ?? null
        : null,
    };
  }

  async createRequest(actor: Actor, input: CreateRequestInput) {
    if (!isClientRole(actor.role) && actor.role !== "platform_admin") throw new AuthzError();
    const organizationId = actor.organizationId;
    if (!organizationId) throw new AuthzError("No organization");
    const triage = await mockAI.triageRequest({
      title: input.title,
      objective: input.objective,
      description: input.description,
      externalCommunication: input.externalCommunication,
    });
    const ws =
      (input.workstreamId && this.data.workstreams.find((w) => w.id === input.workstreamId)) ||
      this.data.workstreams.find(
        (w) =>
          w.organizationId === organizationId &&
          this.data.workstreamTemplates.find((t) => t.id === w.templateId)?.slug === triage.workstreamSlug,
      ) ||
      this.data.workstreams.find((w) => w.organizationId === organizationId) ||
      null;

    const actionClass = input.externalCommunication && triage.actionClass === "prepare_only"
      ? "external_execution"
      : triage.actionClass;

    const request: RequestRecord = {
      id: uid("req"),
      organizationId,
      workstreamId: ws?.id ?? null,
      title: input.title,
      objective: input.objective,
      description: input.description,
      deliverable: input.deliverable,
      priority: triage.priority,
      status: "triage",
      riskLevel: triage.riskLevel,
      approvalLevel: actionClass,
      dueAt: input.dueAt,
      createdBy: actor.id,
      assignedOperatorId: null,
      estimatedEffort: triage.estimatedEffort,
      actualEffort: 0,
      automationScore: triage.automationScore,
      recurring: input.recurring,
      externalCommunication: input.externalCommunication,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const plan = await mockAI.generateExecutionPlan({
      title: request.title,
      objective: request.objective,
      description: request.description,
      deliverable: request.deliverable,
      workstreamName: ws?.name,
      actionClass,
    });
    this.data.requests.unshift(request);
    this.data.plans[request.id] = plan;
    plan.steps.forEach((step, i) => {
      this.data.steps.push({
        id: uid("st"),
        organizationId,
        requestId: request.id,
        title: step.title,
        detail: step.detail,
        owner: step.owner,
        status: "pending",
        sortOrder: i + 1,
      });
    });
    for (const name of input.files ?? []) {
      this.data.attachments.push({
        id: uid("at"),
        organizationId,
        requestId: request.id,
        playbookId: null,
        name,
        path: `${organizationId}/${request.id}/${name}`,
        uploadedBy: actor.id,
        createdAt: nowIso(),
      });
    }
    this.audit(actor, "request.created", "request", request.id, organizationId, { title: request.title });
    this.audit(actor, "ai.action", "request", request.id, organizationId, {
      fn: "triageRequest+generateExecutionPlan",
      actionClass,
    });
    if (blocksWithoutApproval(actionClass)) {
      request.status = "awaiting_approval";
      this.createApproval(actor, request.id, actionClass, "Sensitive execution cannot begin without explicit approval.");
    }
    return this.getRequestBundle(actor, request.id);
  }

  updateRequestScope(actor: Actor, id: string, patch: Partial<Pick<RequestRecord, "title" | "objective" | "description" | "deliverable" | "dueAt" | "priority" | "workstreamId">>) {
    const req = this.getRequest(actor, id);
    if (!canMutateOpsQueue(actor) && actor.id !== req.createdBy && actor.role !== "client_admin") {
      throw new AuthzError();
    }
    Object.assign(req, patch, { updatedAt: nowIso() });
    this.audit(actor, "request.scope_updated", "request", id, req.organizationId, patch as Record<string, unknown>);
    return req;
  }

  transitionRequest(actor: Actor, id: string, to: RequestStatus, note?: string) {
    const req = this.getRequest(actor, id);
    if (isClientRole(actor.role) && !["accepted", "cancelled"].includes(to)) {
      throw new AuthzError("Clients can accept or cancel, not run the queue");
    }
    if (!isClientRole(actor.role) && !canMutateOpsQueue(actor)) throw new AuthzError();
    if (!canTransition(req.status, to)) {
      throw new DomainError(`Cannot move ${req.status} → ${to}`);
    }
    if (to === "in_progress" && blocksWithoutApproval(req.approvalLevel)) {
      const approved = this.data.approvals.some(
        (a) => a.requestId === req.id && a.actionClass === "sensitive_execution" && a.status === "approved",
      );
      if (!approved) {
        throw new DomainError("Sensitive execution cannot proceed without explicit approval");
      }
    }
    if (to === "in_progress" && req.approvalLevel === "external_execution") {
      const approved = this.data.approvals.some(
        (a) => a.requestId === req.id && a.actionClass === "external_execution" && a.status === "approved",
      );
      if (!approved) {
        req.status = "awaiting_approval";
        req.updatedAt = nowIso();
        this.createApproval(actor, req.id, "external_execution", "External execution requires approval before work proceeds.");
        throw new DomainError("External execution requires customer approval first");
      }
      this.audit(actor, "execution.external", "request", req.id, req.organizationId, { note });
    }
    const from = req.status;
    req.status = to;
    req.updatedAt = nowIso();
    this.audit(actor, "request.status_changed", "request", req.id, req.organizationId, { from, to, note });
    return req;
  }

  assignOperator(actor: Actor, requestId: string, operatorId: string) {
    if (!canAssignOperators(actor)) throw new AuthzError("Only ops managers can assign operators");
    const req = this.getRequest(actor, requestId);
    const op = this.data.operators.find((o) => o.id === operatorId);
    if (!op) throw new DomainError("Operator not found");
    req.assignedOperatorId = operatorId;
    req.updatedAt = nowIso();
    if (req.status === "triage") req.status = "queued";
    this.data.assignments.unshift({
      id: uid("as"),
      organizationId: req.organizationId,
      requestId,
      operatorId,
      assignedBy: actor.id,
      assignedAt: nowIso(),
    });
    this.audit(actor, "request.assigned", "request", requestId, req.organizationId, { operatorId });
    return req;
  }

  splitStep(actor: Actor, requestId: string, title: string, detail = "") {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = this.getRequest(actor, requestId);
    const sortOrder = this.data.steps.filter((s) => s.requestId === requestId).length + 1;
    const step: RequestStep = {
      id: uid("st"),
      organizationId: req.organizationId,
      requestId,
      title,
      detail,
      owner: "operator",
      status: "pending",
      sortOrder,
    };
    this.data.steps.push(step);
    return step;
  }

  updateStep(actor: Actor, stepId: string, patch: Partial<Pick<RequestStep, "status" | "title" | "detail">>) {
    const step = this.data.steps.find((s) => s.id === stepId);
    if (!step) throw new DomainError("Step not found");
    assertOrgAccess(actor, step.organizationId);
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    Object.assign(step, patch);
    return step;
  }

  listApprovals(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    let rows = this.filterByTenant(actor, this.data.approvals);
    if (orgId) rows = rows.filter((a) => a.organizationId === orgId);
    return rows
      .map((a) => ({
        ...a,
        request: this.data.requests.find((r) => r.id === a.requestId),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createApproval(actor: Actor, requestId: string, actionClass: ActionClass, reason: string) {
    if (!canRequestCustomerApproval(actor) && !isClientRole(actor.role)) throw new AuthzError();
    const req = this.getRequest(actor, requestId);
    const approval: Approval = {
      id: uid("ap"),
      organizationId: req.organizationId,
      requestId,
      actionClass,
      status: "pending",
      requestedBy: actor.id,
      decidedBy: null,
      reason,
      decisionNote: null,
      createdAt: nowIso(),
      decidedAt: null,
    };
    this.data.approvals.unshift(approval);
    if (req.status !== "awaiting_approval" && req.status !== "cancelled") {
      req.status = "awaiting_approval";
      req.updatedAt = nowIso();
    }
    this.audit(actor, "approval.requested", "approval", approval.id, req.organizationId, { actionClass, requestId });
    return approval;
  }

  decideApproval(actor: Actor, approvalId: string, decision: "approved" | "rejected", note: string) {
    if (!canDecideApproval(actor)) throw new AuthzError("Only the customer can decide approvals");
    const approval = this.data.approvals.find((a) => a.id === approvalId);
    if (!approval) throw new DomainError("Approval not found");
    assertOrgAccess(actor, approval.organizationId);
    if (approval.status !== "pending") throw new DomainError("Approval already decided");
    approval.status = decision;
    approval.decidedBy = actor.id;
    approval.decisionNote = note;
    approval.decidedAt = nowIso();
    const req = this.data.requests.find((r) => r.id === approval.requestId);
    if (req) {
      req.status = decision === "approved" ? "queued" : "cancelled";
      req.updatedAt = nowIso();
      this.audit(actor, "request.status_changed", "request", req.id, req.organizationId, {
        from: "awaiting_approval",
        to: req.status,
      });
    }
    this.audit(actor, "approval.decided", "approval", approval.id, approval.organizationId, { decision });
    return approval;
  }

  listPlaybooks(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    let rows = this.filterByTenant(actor, this.data.playbooks);
    if (orgId) {
      assertOrgAccess(actor, orgId);
      rows = rows.filter((p) => p.organizationId === orgId);
    }
    return rows;
  }

  getPlaybook(actor: Actor, id: string) {
    const pb = this.data.playbooks.find((p) => p.id === id);
    if (!pb) throw new DomainError("Playbook not found");
    assertOrgAccess(actor, pb.organizationId);
    const versions = this.data.playbookVersions
      .filter((v) => v.playbookId === id)
      .sort((a, b) => b.version - a.version);
    const linkedRequests = this.data.requests.filter(
      (r) => r.organizationId === pb.organizationId && r.workstreamId === pb.workstreamId,
    );
    return { playbook: pb, versions, current: versions[0] ?? null, linkedRequests };
  }

  createPlaybook(
    actor: Actor,
    input: { title: string; objective: string; workstreamId: string | null; steps: string[]; preferences: string[]; warnings: string[] },
  ) {
    if (!canWritePlaybook(actor)) throw new AuthzError();
    const fromWorkstream = input.workstreamId
      ? this.data.workstreams.find((w) => w.id === input.workstreamId)?.organizationId
      : null;
    const orgId = actor.organizationId || fromWorkstream || this.visibleOrgIds(actor)[0];
    if (!orgId) throw new AuthzError("No organization");
    const pb: Playbook = {
      id: uid("pb"),
      organizationId: orgId,
      title: input.title,
      objective: input.objective,
      workstreamId: input.workstreamId,
      currentVersion: 1,
      createdBy: actor.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.playbooks.unshift(pb);
    this.data.playbookVersions.push({
      id: uid("pv"),
      organizationId: orgId,
      playbookId: pb.id,
      version: 1,
      steps: input.steps,
      clientPreferences: input.preferences,
      warnings: input.warnings,
      createdBy: actor.id,
      createdAt: nowIso(),
    });
    return pb;
  }

  addPlaybookVersion(actor: Actor, playbookId: string, input: { steps: string[]; preferences: string[]; warnings: string[] }) {
    if (!canWritePlaybook(actor)) throw new AuthzError();
    const pb = this.data.playbooks.find((p) => p.id === playbookId);
    if (!pb) throw new DomainError("Playbook not found");
    assertOrgAccess(actor, pb.organizationId);
    pb.currentVersion += 1;
    pb.updatedAt = nowIso();
    const version: PlaybookVersion = {
      id: uid("pv"),
      organizationId: pb.organizationId,
      playbookId,
      version: pb.currentVersion,
      steps: input.steps,
      clientPreferences: input.preferences,
      warnings: input.warnings,
      createdBy: actor.id,
      createdAt: nowIso(),
    };
    this.data.playbookVersions.push(version);
    return version;
  }

  addComment(actor: Actor, requestId: string, body: string) {
    const req = this.getRequest(actor, requestId);
    const comment: Comment = {
      id: uid("cm"),
      organizationId: req.organizationId,
      requestId,
      authorId: actor.id,
      body,
      createdAt: nowIso(),
    };
    this.data.comments.push(comment);
    return comment;
  }

  addTimeEntry(actor: Actor, requestId: string, hours: number, note: string) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = this.getRequest(actor, requestId);
    const entry: TimeEntry = {
      id: uid("te"),
      organizationId: req.organizationId,
      requestId,
      operatorId: actor.operatorId ?? "unknown",
      hours,
      note,
      createdAt: nowIso(),
    };
    this.data.timeEntries.push(entry);
    req.actualEffort = Number((req.actualEffort + hours).toFixed(2));
    return entry;
  }

  createQaReview(actor: Actor, requestId: string, input: { passed: boolean; score: number; notes: string }) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = this.getRequest(actor, requestId);
    const review: QaReview = {
      id: uid("qa"),
      organizationId: req.organizationId,
      requestId,
      reviewerId: actor.id,
      passed: input.passed,
      score: input.score,
      notes: input.notes,
      createdAt: nowIso(),
    };
    this.data.qaReviews.unshift(review);
    req.status = input.passed ? "ready" : "in_progress";
    req.updatedAt = nowIso();
    this.audit(actor, "request.status_changed", "request", req.id, req.organizationId, {
      from: "qa",
      to: req.status,
      qa: input.passed,
    });
    return review;
  }

  deliverRequest(actor: Actor, requestId: string) {
    return this.transitionRequest(actor, requestId, "delivered");
  }

  listIntegrations(actor: Actor) {
    const orgId = actor.organizationId;
    if (!orgId) {
      if (!canMutateOpsQueue(actor)) return [];
      return this.data.integrations;
    }
    assertOrgAccess(actor, orgId);
    return this.data.integrations.filter((i) => i.organizationId === orgId);
  }

  requestIntegrationAccess(actor: Actor, integrationId: string) {
    const row = this.data.integrations.find((i) => i.id === integrationId);
    if (!row) throw new DomainError("Integration not found");
    assertOrgAccess(actor, row.organizationId);
    if (actor.role !== "client_admin" && actor.role !== "platform_admin") throw new AuthzError();
    row.status = row.status === "connected" ? "connected" : "requested";
    row.lastAccessedAt = nowIso();
    this.audit(actor, "integration.accessed", "integration", row.id, row.organizationId, {
      provider: row.provider,
    });
    return row;
  }

  getSubscription(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (!orgId) return null;
    assertOrgAccess(actor, orgId);
    return this.data.subscriptions.find((s) => s.organizationId === orgId) ?? null;
  }

  setMockSubscription(actor: Actor, plan: Subscription["plan"], monthlyHours: number) {
    if (!actor.organizationId) throw new AuthzError();
    if (actor.role !== "client_admin" && actor.role !== "platform_admin") throw new AuthzError();
    let sub = this.data.subscriptions.find((s) => s.organizationId === actor.organizationId);
    if (!sub) {
      sub = {
        id: uid("sub"),
        organizationId: actor.organizationId,
        plan,
        status: "active",
        monthlyHours,
        stripeCustomerId: null,
        stripeSubscriptionId: `sub_mock_${actor.organizationId}`,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      };
      this.data.subscriptions.push(sub);
    } else {
      sub.plan = plan;
      sub.monthlyHours = monthlyHours;
      sub.status = "active";
    }
    return sub;
  }

  listUsage(actor: Actor) {
    if (!actor.organizationId) return this.data.usage;
    assertOrgAccess(actor, actor.organizationId);
    return this.data.usage.filter((u) => u.organizationId === actor.organizationId);
  }

  listAuditEvents(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (actor.role === "platform_admin") {
      return orgId ? this.data.audits.filter((a) => a.organizationId === orgId) : this.data.audits;
    }
    if (!orgId) {
      if (canMutateOpsQueue(actor)) return this.data.audits;
      return [];
    }
    assertOrgAccess(actor, orgId);
    return this.data.audits.filter((a) => a.organizationId === orgId);
  }

  exportAudit(actor: Actor, organizationId: string) {
    if (actor.role !== "client_admin" && actor.role !== "platform_admin") throw new AuthzError();
    assertOrgAccess(actor, organizationId);
    this.audit(actor, "data.exported", "organization", organizationId, organizationId, { kind: "audit" });
    return this.data.audits.filter((a) => a.organizationId === organizationId);
  }

  hoursReturned(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (!orgId) return 0;
    assertOrgAccess(actor, orgId);
    const fromWorkstreams = this.data.workstreams
      .filter((w) => w.organizationId === orgId)
      .reduce((s, w) => s + w.hoursReturned, 0);
    const fromAccepted = this.data.requests
      .filter((r) => r.organizationId === orgId && deliveredStatuses().includes(r.status))
      .reduce((s, r) => s + r.actualEffort, 0);
    return Math.max(fromWorkstreams, fromAccepted);
  }

  activityFeed(actor: Actor, organizationId?: string) {
    return this.listAuditEvents(actor, organizationId).slice(0, 20);
  }

  userName(id: string) {
    return this.data.users.find((u) => u.id === id)?.name ?? "Unknown";
  }
}

const g = globalThis as typeof globalThis & { __dcStore?: MemoryStore };

export function getStore() {
  if (!g.__dcStore) g.__dcStore = new MemoryStore(seedData());
  return g.__dcStore;
}

export function resetStore(data?: StoreData) {
  g.__dcStore = new MemoryStore(data ?? seedData());
  return g.__dcStore;
}

export const ACTION_CLASS_VALUES = ACTION_CLASSES;
