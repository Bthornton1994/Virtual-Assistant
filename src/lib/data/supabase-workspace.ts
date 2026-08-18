import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AuthzError,
  DomainError,
  type ActionClass,
  type Actor,
  type Approval,
  type ApprovalKind,
  type Clarification,
  type CreateRequestInput,
  type DeliveryPackage,
  type ExecutionPlan,
  type OperatingMemory,
  type Organization,
  type Playbook,
  type PlaybookVersion,
  type Priority,
  type RequestRecord,
  type RequestStatus,
  type RequestStep,
  type Role,
  type Workstream,
  type WorkstreamSchedule,
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
  computeNextRunAt,
  deliveredStatuses,
  emptyOperatingMemory,
  formatOperatingMemory,
  isClientRole,
  nowIso,
} from "@/lib/domain";
import { delegationAI, mockAI } from "@/lib/ai";
import {
  validateApprovalRequirement,
  validateAutomation,
  validateExecutionPlan,
  validateMissingContext,
  validatePlaybookDraft,
  validateRouting,
  validateTriage,
  validatedOrFallback,
} from "@/lib/ai-validate";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

function dbFail(error: { message?: string } | null, fallback = "Database request failed") {
  throw new DomainError(error?.message || fallback);
}

function id() {
  return crypto.randomUUID();
}

export class SupabaseWorkspaceRepository {
  private async client(): Promise<SupabaseClient> {
    const client = await supabaseServer();
    if (!client) throw new DomainError("Database access failed. Production workspaces require Supabase.");
    return client;
  }

  private async advanceRequestForApproval(
    db: SupabaseClient,
    req: RequestRecord,
    kind: ApprovalKind,
    options?: { advanceStatus?: boolean },
  ) {
    if (options?.advanceStatus === false || req.status === "cancelled") return;
    const next = kind === "execution_plan" ? "awaiting_plan_approval" : "awaiting_action_approval";
    await db.from("requests").update({ status: next, updated_at: nowIso() }).eq("id", req.id);
  }

  private mapOrg(row: Record<string, unknown>): Organization {
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      industry: String(row.industry ?? ""),
      companySize: String(row.company_size ?? ""),
      timezone: String(row.timezone ?? "America/Chicago"),
      createdAt: String(row.created_at),
    };
  }

  private mapRequest(row: Record<string, unknown>): RequestRecord {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      workstreamId: (row.workstream_id as string) ?? null,
      title: String(row.title),
      objective: String(row.objective ?? ""),
      description: String(row.description ?? ""),
      deliverable: String(row.deliverable ?? ""),
      priority: row.priority as RequestRecord["priority"],
      status: row.status as RequestStatus,
      riskLevel: row.risk_level as RequestRecord["riskLevel"],
      approvalLevel: row.approval_level as ActionClass,
      dueAt: (row.due_at as string) ?? null,
      createdBy: String(row.created_by ?? ""),
      assignedOperatorId: (row.assigned_operator_id as string) ?? null,
      estimatedEffort: Number(row.estimated_effort ?? 0),
      actualEffort: Number(row.actual_effort ?? 0),
      automationScore: Number(row.automation_score ?? 0),
      recurring: Boolean(row.recurring),
      externalCommunication: Boolean(row.external_communication),
      playbookId: (row.playbook_id as string) ?? null,
      missingContext: (row.missing_context as string[]) ?? [],
      customerInstructions: String(row.customer_instructions ?? ""),
      internalInstructions: String(row.internal_instructions ?? ""),
      qaChecklist: (row.qa_checklist as string[]) ?? [],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapApproval(row: Record<string, unknown>): Approval {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      requestId: String(row.request_id),
      kind: row.kind as ApprovalKind,
      action: String(row.action ?? ""),
      description: String(row.description ?? row.reason ?? ""),
      riskLevel: row.risk_level as Approval["riskLevel"],
      actionClass: row.action_class as ActionClass,
      status: row.status as Approval["status"],
      requestedBy: String(row.requested_by ?? ""),
      decidedBy: (row.decided_by as string) ?? null,
      reason: String(row.reason ?? ""),
      decisionNote: (row.decision_note as string) ?? null,
      createdAt: String(row.created_at),
      decidedAt: (row.decided_at as string) ?? null,
    };
  }

  private async audit(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string | null,
    organizationId: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    const db = await this.client();
    const { error } = await db.from("audit_events").insert({
      organization_id: organizationId,
      actor_id: actor.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata,
    });
    if (error) dbFail(error, "Could not write the audit event");
  }

  async listOrganizations(actor: Actor) {
    void actor;
    const db = await this.client();
    const { data, error } = await db.from("organizations").select("*");
    if (error) dbFail(error);
    return (data ?? []).map((row) => this.mapOrg(row));
  }

  async getOrganization(actor: Actor, id: string) {
    assertOrgAccess(actor, id);
    const db = await this.client();
    const { data, error } = await db.from("organizations").select("*").eq("id", id).maybeSingle();
    if (error) dbFail(error);
    if (!data) throw new DomainError("Organization not found");
    return this.mapOrg(data);
  }

  async updateOrganization(
    actor: Actor,
    id: string,
    patch: Partial<Pick<Organization, "name" | "industry" | "companySize" | "timezone">>,
  ) {
    if (!canManageTeam(actor)) throw new AuthzError("Only a client admin can change organization settings");
    assertOrgAccess(actor, id);
    const db = await this.client();
    const { data, error } = await db
      .from("organizations")
      .update({
        name: patch.name,
        industry: patch.industry,
        company_size: patch.companySize,
        timezone: patch.timezone,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) dbFail(error);
    await this.audit(actor, "permission.changed", "organization", id, id, { patch });
    return this.mapOrg(data);
  }

  async listMembers(actor: Actor, organizationId: string) {
    assertOrgAccess(actor, organizationId);
    const db = await this.client();
    const { data, error } = await db
      .from("organization_members")
      .select("*, profiles:user_id(name, title)")
      .eq("organization_id", organizationId);
    if (error) dbFail(error);
    return (data ?? []).map((m) => ({
      id: m.id,
      organizationId: m.organization_id,
      userId: m.user_id,
      role: m.role,
      status: m.status,
      user: {
        id: m.user_id,
        name: (m.profiles as { name?: string } | null)?.name ?? "Member",
        title: (m.profiles as { title?: string } | null)?.title ?? "",
        email: (m.profiles as { email?: string } | null)?.email ?? "",
        password: "",
      },
    }));
  }

  async inviteMember(actor: Actor, input: { email: string; name: string; role: Role }) {
    if (!canManageTeam(actor) || !actor.organizationId) throw new AuthzError();
    return this.inviteToOrganization(actor, actor.organizationId, input);
  }

  async inviteToOrganization(
    actor: Actor,
    organizationId: string,
    input: { email: string; name: string; role: Role },
  ) {
    if (!canManageTeam(actor) && !canMutateOpsQueue(actor)) throw new AuthzError();
    const admin = supabaseAdmin();
    if (!admin) throw new DomainError("Invitations require a server database key");
    const { data: existing } = await admin
      .from("invitations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("email", input.email.toLowerCase())
      .eq("status", "invited")
      .maybeSingle();
    if (existing) throw new DomainError("That email already has an open invitation");

    const origin = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { name: input.name },
      redirectTo: `${origin}/auth/callback?next=/login`,
    });
    if (inviteError) throw new DomainError("We could not send the invitation. The address may already be active.");

    const { error } = await admin.from("invitations").insert({
      organization_id: organizationId,
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      status: "invited",
      invited_by: actor.id,
    });
    if (error) dbFail(error);
    if (invited.user) {
      await admin.from("profiles").upsert({
        id: invited.user.id,
        name: input.name,
        email: input.email.toLowerCase(),
      });
      await admin.from("organization_members").upsert(
        {
          organization_id: organizationId,
          user_id: invited.user.id,
          role: input.role,
          status: "invited",
        },
        { onConflict: "organization_id,user_id" },
      );
    }
    await this.audit(actor, "permission.changed", "member", invited.user?.id ?? input.email, organizationId, {
      email: input.email,
      role: input.role,
    });
    return invited.user;
  }

  async listOperators(actor: Actor) {
    if (!canMutateOpsQueue(actor) && !isClientRole(actor.role)) throw new AuthzError();
    const db = await this.client();
    const { data, error } = await db.from("operators").select("*");
    if (error) dbFail(error);
    return (data ?? []).map((op) => ({
      id: op.id,
      userId: op.user_id,
      name: op.name,
      platformRole: op.platform_role,
      status: op.status,
      capacityHours: Number(op.capacity_hours ?? 0),
      bio: op.bio ?? "",
      skills: [],
    }));
  }

  listWorkstreamTemplates() {
    return WORKSTREAM_TEMPLATES;
  }

  async listWorkstreams(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    const db = await this.client();
    let q = db.from("workstreams").select("*");
    if (orgId) {
      assertOrgAccess(actor, orgId);
      q = q.eq("organization_id", orgId);
    }
    const { data, error } = await q;
    if (error) dbFail(error);
    return (data ?? []).map((w) => this.mapWorkstream(w));
  }

  private mapWorkstream(w: Record<string, unknown>): Workstream {
    return {
      id: String(w.id),
      organizationId: String(w.organization_id),
      templateId: (w.template_id as string) ?? null,
      name: String(w.name),
      objective: String(w.objective ?? ""),
      sla: String(w.sla ?? ""),
      recurringTasks: (w.recurring_tasks as string[]) ?? [],
      metrics: (w.metrics as string[]) ?? [],
      ownerUserId: String(w.owner_user_id ?? ""),
      status: w.status as Workstream["status"],
      healthScore: Number(w.health_score ?? 0),
      hoursReturned: Number(w.hours_returned ?? 0),
      schedule: (w.schedule as WorkstreamSchedule) ?? null,
      nextRunAt: (w.next_run_at as string) ?? null,
      createdAt: String(w.created_at),
      updatedAt: String(w.updated_at),
    };
  }

  async getWorkstream(actor: Actor, id: string) {
    const db = await this.client();
    const { data, error } = await db.from("workstreams").select("*").eq("id", id).maybeSingle();
    if (error) dbFail(error);
    if (!data) throw new DomainError("Workstream not found");
    assertOrgAccess(actor, data.organization_id);
    return this.mapWorkstream(data);
  }

  async listRequests(
    actor: Actor,
    filters?: {
      organizationId?: string;
      status?: RequestStatus | RequestStatus[];
      workstreamId?: string;
      operatorId?: string;
      priority?: Priority;
      riskLevel?: RequestRecord["riskLevel"];
      deadline?: "overdue" | "today" | "week";
    },
  ) {
    const db = await this.client();
    let q = db.from("requests").select("*").order("updated_at", { ascending: false });
    if (filters?.organizationId) {
      assertOrgAccess(actor, filters.organizationId);
      q = q.eq("organization_id", filters.organizationId);
    }
    if (filters?.workstreamId) q = q.eq("workstream_id", filters.workstreamId);
    if (filters?.operatorId) q = q.eq("assigned_operator_id", filters.operatorId);
    if (filters?.priority) q = q.eq("priority", filters.priority);
    if (filters?.riskLevel) q = q.eq("risk_level", filters.riskLevel);
    if (filters?.status) {
      const wanted = Array.isArray(filters.status) ? filters.status : [filters.status];
      q = q.in("status", wanted);
    }
    const { data, error } = await q;
    if (error) dbFail(error);
    let rows = (data ?? []).map((r) => this.mapRequest(r));
    if (actor.role === "operator" && actor.operatorId) {
      rows = rows.filter((r) => !r.assignedOperatorId || r.assignedOperatorId === actor.operatorId);
    }
    return rows;
  }

  async getRequest(actor: Actor, id: string) {
    const db = await this.client();
    const { data, error } = await db.from("requests").select("*").eq("id", id).maybeSingle();
    if (error) dbFail(error);
    if (!data) throw new DomainError("Request not found");
    assertOrgAccess(actor, data.organization_id);
    const req = this.mapRequest(data);
    if (actor.role === "operator" && actor.operatorId && req.assignedOperatorId && req.assignedOperatorId !== actor.operatorId) {
      throw new AuthzError("Operators can only open assigned requests");
    }
    return req;
  }

  async getRequestBundle(actor: Actor, id: string) {
    const request = await this.getRequest(actor, id);
    const db = await this.client();
    const [steps, approvals, comments, attachments, timeEntries, qa, clarifications, deliveries, notes, playbook, org, operator, planRow, audits] =
      await Promise.all([
        db.from("request_steps").select("*").eq("request_id", id).order("sort_order"),
        db.from("approvals").select("*").eq("request_id", id),
        db.from("comments").select("*").eq("request_id", id),
        db.from("attachments").select("*").eq("request_id", id),
        db.from("time_entries").select("*").eq("request_id", id),
        db.from("qa_reviews").select("*").eq("request_id", id),
        db.from("clarifications").select("*").eq("request_id", id),
        db.from("deliveries").select("*").eq("request_id", id),
        db.from("internal_notes").select("*").eq("request_id", id),
        request.playbookId ? db.from("playbooks").select("*").eq("id", request.playbookId).maybeSingle() : Promise.resolve({ data: null, error: null }),
        db.from("organizations").select("*").eq("id", request.organizationId).maybeSingle(),
        request.assignedOperatorId
          ? db.from("operators").select("*").eq("id", request.assignedOperatorId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        db.from("execution_plans").select("*").eq("request_id", id).maybeSingle(),
        db.from("audit_events").select("*").eq("entity_id", id).order("created_at", { ascending: false }),
      ]);
    const commentRows = (comments.data ?? []).filter((c) => {
      if (isClientRole(actor.role) && c.visibility === "internal") return false;
      return true;
    });
    const versions = request.playbookId
      ? (await db.from("playbook_versions").select("*").eq("playbook_id", request.playbookId).order("version", { ascending: false })).data
      : [];
    return {
      request,
      workstream: request.workstreamId ? await this.getWorkstream(actor, request.workstreamId).catch(() => null) : null,
      steps: (steps.data ?? []).map((s) => ({
        id: s.id,
        organizationId: s.organization_id,
        requestId: s.request_id,
        title: s.title,
        detail: s.detail ?? "",
        owner: s.owner,
        status: s.status,
        sortOrder: s.sort_order,
      })),
      assignments: [],
      approvals: (approvals.data ?? []).map((a) => this.mapApproval(a)),
      comments: commentRows.map((c) => ({
        id: c.id,
        organizationId: c.organization_id,
        requestId: c.request_id,
        authorId: c.author_id,
        body: c.body,
        visibility: c.visibility,
        createdAt: c.created_at,
      })),
      attachments: (attachments.data ?? []).map((a) => ({
        id: a.id,
        organizationId: a.organization_id,
        requestId: a.request_id,
        playbookId: a.playbook_id,
        name: a.name,
        path: a.path,
        uploadedBy: a.uploaded_by,
        createdAt: a.created_at,
      })),
      timeEntries: timeEntries.data ?? [],
      qa: qa.data ?? [],
      plan: (planRow.data?.plan as ExecutionPlan) ?? null,
      clarifications: (clarifications.data ?? []).map((c) => ({
        id: c.id,
        organizationId: c.organization_id,
        requestId: c.request_id,
        question: c.question,
        askedBy: c.asked_by,
        answer: c.answer,
        answeredBy: c.answered_by,
        createdAt: c.created_at,
        answeredAt: c.answered_at,
      })),
      delivery: deliveries.data?.[0]
        ? {
            id: deliveries.data[0].id,
            organizationId: deliveries.data[0].organization_id,
            requestId: deliveries.data[0].request_id,
            summary: deliveries.data[0].summary,
            deliverables: deliveries.data[0].deliverables ?? [],
            attachments: deliveries.data[0].attachments ?? [],
            actionsTaken: deliveries.data[0].actions_taken ?? [],
            exceptions: deliveries.data[0].exceptions ?? [],
            unresolvedDecisions: deliveries.data[0].unresolved_decisions ?? [],
            nextStep: deliveries.data[0].next_step ?? "",
            createdBy: deliveries.data[0].created_by,
            createdAt: deliveries.data[0].created_at,
          }
        : null,
      internalNotes: isClientRole(actor.role)
        ? []
        : (notes.data ?? []).map((n) => ({
            id: n.id,
            organizationId: n.organization_id,
            requestId: n.request_id,
            authorId: n.author_id,
            body: n.body,
            createdAt: n.created_at,
          })),
      playbook: playbook.data ? this.mapPlaybook(playbook.data) : null,
      playbookVersion: versions?.[0] ? this.mapPlaybookVersion(versions[0]) : null,
      organization: org.data ? this.mapOrg(org.data) : null,
      operator: operator.data ?? null,
      memory: await this.getOperatingMemory(actor, request.organizationId),
      audits: audits.data ?? [],
    };
  }

  async createRequest(actor: Actor, input: CreateRequestInput) {
    if (!isClientRole(actor.role) && actor.role !== "platform_admin") throw new AuthzError();
    const organizationId = actor.organizationId;
    if (!organizationId) throw new AuthzError("No organization");
    const db = await this.client();
    const [triageRaw, classified, risk, missingRaw] = await Promise.all([
      delegationAI.triageRequest({
        title: input.title,
        objective: input.objective,
        description: input.description,
        externalCommunication: input.externalCommunication,
      }),
      delegationAI.classifyWorkstream({
        title: input.title,
        objective: input.objective,
        description: input.description,
      }),
      delegationAI.classifyRisk({
        title: input.title,
        description: input.description,
        externalCommunication: input.externalCommunication,
      }),
      delegationAI.identifyMissingContext({ ...input, playbookApplied: Boolean(input.playbookId) }),
    ]);
    const triage = validatedOrFallback(triageRaw, validateTriage, await mockAI.triageRequest(input));
    const missingResult = validatedOrFallback(missingRaw, validateMissingContext, await mockAI.identifyMissingContext(input));
    const workstreams = await this.listWorkstreams(actor, organizationId);
    const ws =
      workstreams.find((w) => w.id === input.workstreamId) ||
      workstreams.find((w) => WORKSTREAM_TEMPLATES.find((t) => t.id === w.templateId)?.slug === classified.workstreamSlug) ||
      workstreams[0] ||
      null;
    const actionClass =
      input.externalCommunication && risk.actionClass === "prepare_only" ? "external_execution" : risk.actionClass;
    const playbook = input.playbookId ? (await db.from("playbooks").select("*").eq("id", input.playbookId).maybeSingle()).data : null;
    if (playbook) assertOrgAccess(actor, playbook.organization_id);
    const pbVersion = playbook
      ? (await db.from("playbook_versions").select("*").eq("playbook_id", playbook.id).order("version", { ascending: false }).limit(1)).data?.[0]
      : null;
    const missingContext = pbVersion ? [] : missingResult.missing;
    const memory = await this.getOperatingMemory(actor, organizationId);
    const requestId = id();
    const now = nowIso();
    const row = {
      id: requestId,
      organization_id: organizationId,
      workstream_id: ws?.id ?? playbook?.workstream_id ?? null,
      title: input.title,
      objective: input.objective,
      description: input.description,
      deliverable: input.deliverable,
      priority: triage.priority,
      status: missingContext.length ? "needs_clarification" : "awaiting_plan_approval",
      risk_level: risk.riskLevel,
      approval_level: actionClass,
      due_at: input.dueAt,
      created_by: actor.id,
      assigned_operator_id: null,
      estimated_effort: triage.estimatedEffort,
      actual_effort: 0,
      automation_score: triage.automationScore,
      recurring: input.recurring,
      external_communication: input.externalCommunication,
      playbook_id: playbook?.id ?? null,
      missing_context: missingContext,
      customer_instructions: [...(pbVersion?.client_preferences ?? []), ...formatOperatingMemory(memory)].filter(Boolean).join("\n"),
      internal_instructions: pbVersion
        ? [...(pbVersion.warnings ?? []), ...(pbVersion.authority_limits ?? [])].join("\n")
        : memory.prohibitedActions,
      qa_checklist: pbVersion?.qa_checklist?.length
        ? pbVersion.qa_checklist
        : ["Matches stated objective", "Authority limits respected", "Residual uncertainty disclosed"],
      created_at: now,
      updated_at: now,
    };
    const { error } = await db.from("requests").insert(row);
    if (error) dbFail(error);
    const [planRaw, approvalRaw, routingRaw, automationRaw] = await Promise.all([
      delegationAI.generateExecutionPlan({
        title: input.title,
        objective: input.objective,
        description: input.description,
        deliverable: input.deliverable,
        workstreamName: ws?.name,
        actionClass,
      }),
      delegationAI.determineApprovalRequirements({
        title: input.title,
        description: input.description,
        actionClass,
        externalCommunication: input.externalCommunication,
      }),
      delegationAI.suggestExecutor({
        actionClass,
        workstreamName: ws?.name,
        title: input.title,
      }),
      delegationAI.identifyAutomationOpportunity({
        title: input.title,
        actionClass,
        recurring: input.recurring,
      }),
    ]);
    const plan = validatedOrFallback(
      planRaw,
      validateExecutionPlan,
      await mockAI.generateExecutionPlan({
        title: input.title,
        objective: input.objective,
        description: input.description,
        deliverable: input.deliverable,
        workstreamName: ws?.name,
        actionClass,
      }),
    );
    const approvalNeeds = validatedOrFallback(
      approvalRaw,
      validateApprovalRequirement,
      await mockAI.determineApprovalRequirements({
        title: input.title,
        description: input.description,
        actionClass,
        externalCommunication: input.externalCommunication,
      }),
    );
    const routing = validatedOrFallback(routingRaw, validateRouting, await mockAI.suggestExecutor({ actionClass, workstreamName: ws?.name, title: input.title }));
    const automation = validatedOrFallback(
      automationRaw,
      validateAutomation,
      await mockAI.identifyAutomationOpportunity({ title: input.title, actionClass, recurring: input.recurring }),
    );
    if (pbVersion?.steps?.length) {
      plan.steps = pbVersion.steps.map((title: string) => ({
        title,
        detail: "From the customer playbook",
        owner: "operator" as const,
      }));
    }
    await db.from("execution_plans").insert({ request_id: requestId, organization_id: organizationId, plan });
    await db.from("request_steps").insert(
      plan.steps.map((step, i) => ({
        organization_id: organizationId,
        request_id: requestId,
        title: step.title,
        detail: step.detail,
        owner: step.owner,
        status: "pending",
        sort_order: i + 1,
      })),
    );
    for (const name of input.files ?? []) {
      await db.from("attachments").insert({
        organization_id: organizationId,
        request_id: requestId,
        name,
        path: `${organizationId}/${requestId}/${name}`,
        uploaded_by: actor.id,
      });
    }
    await this.audit(actor, "request.created", "request", requestId, organizationId, { title: input.title });
    await this.audit(actor, "ai.action", "request", requestId, organizationId, {
      fn: "triage+classify+plan+approvals+routing",
      actionClass,
      missingContext,
      workstreamSlug: classified.workstreamSlug,
      suggestedExecutor: routing.executor,
      automation: automation.step,
      approvalKinds: approvalNeeds.kinds,
    });
    const req = await this.getRequest(actor, requestId);
    if (missingContext.length) {
      const { error: clError } = await db.from("clarifications").insert(
        missingContext.map((question) => ({
          organization_id: organizationId,
          request_id: requestId,
          question,
          asked_by: actor.id,
        })),
      );
      if (clError) dbFail(clError, "Could not persist clarification questions");
    } else {
      await this.createApprovalRecord(actor, req, {
        kind: "execution_plan",
        action: "Approve execution plan",
        description: plan.summary,
        riskLevel: plan.riskLevel,
        actionClass,
      });
    }
    for (const kind of approvalNeeds.kinds.filter((k) => k !== "execution_plan")) {
      await this.createApprovalRecord(
        actor,
        req,
        {
          kind,
          action: kind.replaceAll("_", " "),
          description: approvalNeeds.reasons.join(" "),
          riskLevel: req.riskLevel,
          actionClass,
        },
        { advanceStatus: false },
      );
    }
    return this.getRequestBundle(actor, requestId);
  }

  async updateRequestScope(actor: Actor, id: string, patch: Record<string, unknown>) {
    const req = await this.getRequest(actor, id);
    if (!canMutateOpsQueue(actor) && actor.id !== req.createdBy && actor.role !== "client_admin") throw new AuthzError();
    const db = await this.client();
    const { data, error } = await db
      .from("requests")
      .update({
        title: patch.title ?? req.title,
        objective: patch.objective ?? req.objective,
        description: patch.description ?? req.description,
        deliverable: patch.deliverable ?? req.deliverable,
        due_at: patch.dueAt === undefined ? req.dueAt : patch.dueAt,
        updated_at: nowIso(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) dbFail(error);
    await this.audit(actor, "request.scope_updated", "request", id, req.organizationId, patch);
    return this.mapRequest(data);
  }

  async transitionRequest(actor: Actor, id: string, to: RequestStatus, note?: string) {
    const req = await this.getRequest(actor, id);
    if (isClientRole(actor.role) && !["accepted", "cancelled"].includes(to)) {
      throw new AuthzError("Clients can accept or cancel, not run the queue");
    }
    if (!isClientRole(actor.role) && !canMutateOpsQueue(actor)) throw new AuthzError();
    if (!canTransition(req.status, to)) throw new DomainError(`Cannot move ${req.status} → ${to}`);
    const db = await this.client();
    if (to === "queued" && req.status === "awaiting_plan_approval") {
      const { data } = await db.from("approvals").select("id").eq("request_id", id).eq("kind", "execution_plan").eq("status", "approved");
      if (!data?.length) throw new DomainError("Execution plan must be approved before the request enters the queue");
    }
    if (to === "delivered") {
      const { data } = await db.from("deliveries").select("id").eq("request_id", id);
      if (!data?.length) throw new DomainError("Deliver through a delivery package that records the outcome");
    }
    if (to === "in_progress" && blocksWithoutApproval(req.approvalLevel)) {
      const { data } = await db.from("approvals").select("id").eq("request_id", id).eq("kind", "sensitive_action").eq("status", "approved");
      if (!data?.length) {
        await this.createApprovalRecord(actor, req, {
          kind: "sensitive_action",
          action: "Begin sensitive execution",
          description: "Sensitive work cannot enter in progress without explicit approval.",
          riskLevel: "critical",
          actionClass: "sensitive_execution",
        });
        throw new DomainError("Sensitive execution cannot proceed without explicit approval");
      }
    }
    const { data, error } = await db.from("requests").update({ status: to, updated_at: nowIso() }).eq("id", id).select("*").single();
    if (error) dbFail(error);
    await this.audit(actor, "request.status_changed", "request", id, req.organizationId, { from: req.status, to, note });
    return this.mapRequest(data);
  }

  async assignOperator(actor: Actor, requestId: string, operatorId: string) {
    if (!canAssignOperators(actor)) throw new AuthzError("Only ops managers can assign operators");
    const req = await this.getRequest(actor, requestId);
    const db = await this.client();
    const { data: op } = await db.from("operators").select("id").eq("id", operatorId).maybeSingle();
    if (!op) throw new DomainError("Operator not found");
    const nextStatus = req.status === "triage" || req.status === "queued" ? "assigned" : req.status;
    const { data, error } = await db
      .from("requests")
      .update({ assigned_operator_id: operatorId, status: nextStatus, updated_at: nowIso() })
      .eq("id", requestId)
      .select("*")
      .single();
    if (error) dbFail(error);
    await db.from("request_assignments").insert({
      organization_id: req.organizationId,
      request_id: requestId,
      operator_id: operatorId,
      assigned_by: actor.id,
    });
    await this.audit(actor, "request.assigned", "request", requestId, req.organizationId, { operatorId });
    return this.mapRequest(data);
  }

  async splitStep(actor: Actor, requestId: string, title: string, detail = "") {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    const db = await this.client();
    const { count } = await db.from("request_steps").select("*", { count: "exact", head: true }).eq("request_id", requestId);
    const { data, error } = await db
      .from("request_steps")
      .insert({
        organization_id: req.organizationId,
        request_id: requestId,
        title,
        detail,
        owner: "operator",
        status: "pending",
        sort_order: (count ?? 0) + 1,
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    return data as RequestStep;
  }

  async updateStep(actor: Actor, stepId: string, patch: Partial<Pick<RequestStep, "status" | "title" | "detail">>) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const db = await this.client();
    const { data: step } = await db.from("request_steps").select("*").eq("id", stepId).maybeSingle();
    if (!step) throw new DomainError("Step not found");
    assertOrgAccess(actor, step.organization_id);
    const { data, error } = await db.from("request_steps").update(patch).eq("id", stepId).select("*").single();
    if (error) dbFail(error);
    return data;
  }

  async listApprovals(actor: Actor, organizationId?: string) {
    const db = await this.client();
    let q = db.from("approvals").select("*").order("created_at", { ascending: false });
    if (organizationId) q = q.eq("organization_id", organizationId);
    const { data, error } = await q;
    if (error) dbFail(error);
    const requests = await this.listRequests(actor, organizationId ? { organizationId } : undefined);
    return (data ?? []).map((a) => ({ ...this.mapApproval(a), request: requests.find((r) => r.id === a.request_id) }));
  }

  async createApproval(actor: Actor, requestId: string, actionClass: ActionClass, reason: string, kind?: ApprovalKind) {
    const req = await this.getRequest(actor, requestId);
    const resolved: ApprovalKind =
      kind ??
      (actionClass === "sensitive_execution"
        ? "sensitive_action"
        : actionClass === "external_execution"
          ? "external_email"
          : "execution_plan");
    return this.createApprovalRecord(actor, req, {
      kind: resolved,
      action: reason,
      description: reason,
      riskLevel: req.riskLevel,
      actionClass,
    });
  }

  async createApprovalRecord(
    actor: Actor,
    req: RequestRecord,
    input: { kind: ApprovalKind; action: string; description: string; riskLevel: RequestRecord["riskLevel"]; actionClass: ActionClass },
    options?: { advanceStatus?: boolean },
  ) {
    if (!canRequestCustomerApproval(actor) && !isClientRole(actor.role)) throw new AuthzError();
    const db = await this.client();
    const { data: existing } = await db
      .from("approvals")
      .select("*")
      .eq("request_id", req.id)
      .eq("kind", input.kind)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      await this.advanceRequestForApproval(db, req, input.kind, options);
      return this.mapApproval(existing);
    }
    const { data, error } = await db
      .from("approvals")
      .insert({
        organization_id: req.organizationId,
        request_id: req.id,
        kind: input.kind,
        action: input.action,
        description: input.description,
        risk_level: input.riskLevel,
        action_class: input.actionClass,
        status: "pending",
        requested_by: actor.id,
        reason: input.description,
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    await this.advanceRequestForApproval(db, req, input.kind, options);
    await this.audit(actor, "approval.requested", "approval", data.id, req.organizationId, { kind: input.kind, requestId: req.id });
    return this.mapApproval(data);
  }

  async decideApproval(actor: Actor, approvalId: string, decision: "approved" | "rejected", note: string) {
    if (!canDecideApproval(actor)) throw new AuthzError("Only the customer can decide approvals");
    const db = await this.client();
    const { data: approval } = await db.from("approvals").select("*").eq("id", approvalId).maybeSingle();
    if (!approval) throw new DomainError("Approval not found");
    assertOrgAccess(actor, approval.organization_id);
    if (approval.status !== "pending") throw new DomainError("Approval already decided");
    const { data, error } = await db
      .from("approvals")
      .update({ status: decision, decided_by: actor.id, decision_note: note, decided_at: nowIso() })
      .eq("id", approvalId)
      .select("*")
      .single();
    if (error) dbFail(error);
    const req = await this.getRequest(actor, approval.request_id);
    let next = req.status;
    if (approval.kind === "execution_plan") next = decision === "approved" ? "queued" : "cancelled";
    else if (decision === "rejected") next = "blocked";
    else if (approval.kind === "sensitive_action") next = "in_progress";
    else {
      const { data: qa } = await db.from("qa_reviews").select("id").eq("request_id", req.id).eq("passed", true);
      if (qa?.length) next = "ready_to_deliver";
      else if (req.status === "awaiting_action_approval") next = req.assignedOperatorId ? "in_progress" : "queued";
    }
    await db.from("requests").update({ status: next, updated_at: nowIso() }).eq("id", req.id);
    await this.audit(actor, "approval.decided", "approval", approvalId, approval.organization_id, { decision, kind: approval.kind });
    await this.audit(actor, "request.status_changed", "request", req.id, req.organizationId, { from: req.status, to: next });
    return this.mapApproval(data);
  }

  async modifyPlan(actor: Actor, requestId: string, steps: string[]) {
    if (!canDecideApproval(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    if (req.status !== "awaiting_plan_approval") throw new DomainError("Plan can only be modified before it is approved");
    const db = await this.client();
    await db.from("request_steps").delete().eq("request_id", requestId);
    await db.from("request_steps").insert(
      steps.filter(Boolean).map((title, i) => ({
        organization_id: req.organizationId,
        request_id: requestId,
        title,
        detail: "Revised by customer",
        owner: "operator",
        status: "pending",
        sort_order: i + 1,
      })),
    );
    const { data: planRow } = await db.from("execution_plans").select("*").eq("request_id", requestId).maybeSingle();
    if (planRow) {
      const plan = planRow.plan as ExecutionPlan;
      plan.steps = steps.filter(Boolean).map((title) => ({ title, detail: "Revised by customer", owner: "operator" as const }));
      await db.from("execution_plans").update({ plan }).eq("request_id", requestId);
    }
    return this.getRequestBundle(actor, requestId);
  }

  async askClarification(actor: Actor, requestId: string, question: string) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    const db = await this.client();
    const { data, error } = await db
      .from("clarifications")
      .insert({
        organization_id: req.organizationId,
        request_id: requestId,
        question,
        asked_by: actor.id,
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    await db.from("requests").update({ status: "needs_clarification", updated_at: nowIso() }).eq("id", requestId);
    return data as Clarification;
  }

  async answerClarification(actor: Actor, clarificationId: string, answer: string) {
    if (!canDecideApproval(actor)) throw new AuthzError();
    const db = await this.client();
    const { data: row } = await db.from("clarifications").select("*").eq("id", clarificationId).maybeSingle();
    if (!row) throw new DomainError("Clarification not found");
    assertOrgAccess(actor, row.organization_id);
    await db
      .from("clarifications")
      .update({ answer, answered_by: actor.id, answered_at: nowIso() })
      .eq("id", clarificationId);
    const { data: open } = await db.from("clarifications").select("id").eq("request_id", row.request_id).is("answer", null);
    if (!open?.length) {
      const req = await this.getRequest(actor, row.request_id);
      await db.from("requests").update({ missing_context: [], status: "awaiting_plan_approval", updated_at: nowIso() }).eq("id", req.id);
      const { data: plan } = await db.from("execution_plans").select("plan").eq("request_id", req.id).maybeSingle();
      await this.createApprovalRecord(actor, req, {
        kind: "execution_plan",
        action: "Approve execution plan",
        description: (plan?.plan as ExecutionPlan | undefined)?.summary ?? req.objective,
        riskLevel: req.riskLevel,
        actionClass: req.approvalLevel,
      });
    }
    return row;
  }

  async addInternalNote(actor: Actor, requestId: string, body: string) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    const db = await this.client();
    const { data, error } = await db
      .from("internal_notes")
      .insert({ organization_id: req.organizationId, request_id: requestId, author_id: actor.id, body })
      .select("*")
      .single();
    if (error) dbFail(error);
    return data;
  }

  async addComment(actor: Actor, requestId: string, body: string, visibility: "customer" | "internal" = "customer") {
    const req = await this.getRequest(actor, requestId);
    const db = await this.client();
    const { data, error } = await db
      .from("comments")
      .insert({
        organization_id: req.organizationId,
        request_id: requestId,
        author_id: actor.id,
        body,
        visibility: isClientRole(actor.role) ? "customer" : visibility,
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    return data;
  }

  async addTimeEntry(actor: Actor, requestId: string, hours: number, note: string) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    const db = await this.client();
    const { error } = await db.from("time_entries").insert({
      organization_id: req.organizationId,
      request_id: requestId,
      operator_id: actor.operatorId,
      hours,
      note,
    });
    if (error) dbFail(error);
    await db.from("requests").update({ actual_effort: Number((req.actualEffort + hours).toFixed(2)) }).eq("id", requestId);
    return { hours, note };
  }

  async createQaReview(
    actor: Actor,
    requestId: string,
    input: { passed: boolean; score: number; notes: string; checklist?: Array<{ item: string; ok: boolean }>; defects?: string[] },
  ) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    if (req.status !== "qa") throw new DomainError("QA reviews are recorded from the QA stage");
    const db = await this.client();
    const { data, error } = await db
      .from("qa_reviews")
      .insert({
        organization_id: req.organizationId,
        request_id: requestId,
        reviewer_id: actor.id,
        passed: input.passed,
        score: input.score,
        notes: input.notes,
        checklist: input.checklist ?? req.qaChecklist.map((item) => ({ item, ok: input.passed })),
        defects: input.defects ?? [],
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    if (input.notes) await this.addComment(actor, requestId, input.notes, "internal");
    if (!input.passed) {
      await db.from("requests").update({ status: "revision_required", updated_at: nowIso() }).eq("id", requestId);
    } else {
      const needsOutbound = req.approvalLevel === "external_execution" || req.externalCommunication;
      const { data: outbound } = await db
        .from("approvals")
        .select("id")
        .eq("request_id", requestId)
        .eq("kind", "external_email")
        .eq("status", "approved");
      if (needsOutbound && !outbound?.length) {
        await this.createApprovalRecord(actor, req, {
          kind: "external_email",
          action: "Send prepared outbound follow-up",
          description: "QA passed. Outbound communication still requires explicit customer approval before delivery.",
          riskLevel: req.riskLevel,
          actionClass: "external_execution",
        });
      } else {
        await db.from("requests").update({ status: "ready_to_deliver", updated_at: nowIso() }).eq("id", requestId);
      }
    }
    const after = await this.getRequest(actor, requestId);
    await this.audit(actor, "request.status_changed", "request", requestId, req.organizationId, {
      from: req.status,
      to: after.status,
      qaPassed: input.passed,
    });
    return data;
  }

  async deliverRequest(
    actor: Actor,
    requestId: string,
    pack: Omit<DeliveryPackage, "id" | "organizationId" | "requestId" | "createdBy" | "createdAt">,
  ) {
    if (!canMutateOpsQueue(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    if (req.status !== "ready_to_deliver" && req.status !== "qa") throw new DomainError("Only checked work can be delivered");
    const db = await this.client();
    if (req.approvalLevel === "external_execution" || req.externalCommunication) {
      const { data } = await db.from("approvals").select("id").eq("request_id", requestId).eq("kind", "external_email").eq("status", "approved");
      if (!data?.length) throw new DomainError("Outbound action requires customer approval before delivery");
    }
    const { data, error } = await db
      .from("deliveries")
      .insert({
        organization_id: req.organizationId,
        request_id: requestId,
        summary: pack.summary,
        deliverables: pack.deliverables ?? [req.deliverable],
        attachments: pack.attachments ?? [],
        actions_taken: pack.actionsTaken ?? [],
        exceptions: pack.exceptions ?? [],
        unresolved_decisions: pack.unresolvedDecisions ?? [],
        next_step: pack.nextStep ?? "",
        created_by: actor.id,
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    await db.from("requests").update({ status: "delivered", updated_at: nowIso() }).eq("id", requestId);
    await this.audit(actor, "request.status_changed", "request", requestId, req.organizationId, { from: req.status, to: "delivered" });
    return data;
  }

  async generatePlaybookFromRequest(actor: Actor, requestId: string, name?: string) {
    if (!canWritePlaybook(actor)) throw new AuthzError();
    const req = await this.getRequest(actor, requestId);
    if (req.status !== "accepted" && req.status !== "delivered") throw new DomainError("Playbooks are captured after delivery");
    const db = await this.client();
    const { data: steps } = await db.from("request_steps").select("title").eq("request_id", requestId);
    const draft = validatedOrFallback(
      await delegationAI.generatePlaybook({
        title: name || req.title,
        objective: req.objective,
        description: req.description,
      }),
      validatePlaybookDraft,
      {
        title: name || `${req.title} playbook`,
        objective: req.objective,
        steps: (steps ?? []).map((s) => s.title),
        clientPreferences: req.customerInstructions ? [req.customerInstructions] : [],
        warnings: req.externalCommunication ? ["External action requires approval"] : [],
      },
    );
    const pbId = id();
    const { error } = await db.from("playbooks").insert({
      id: pbId,
      organization_id: req.organizationId,
      title: draft.title,
      objective: draft.objective || req.objective,
      workstream_id: req.workstreamId,
      current_version: 1,
      created_by: actor.id,
    });
    if (error) dbFail(error);
    await db.from("playbook_versions").insert({
      organization_id: req.organizationId,
      playbook_id: pbId,
      version: 1,
      steps: draft.steps.length ? draft.steps : (steps ?? []).map((s) => s.title),
      client_preferences: draft.clientPreferences,
      warnings: draft.warnings,
      trigger: req.recurring ? "Recurring schedule" : "On request",
      qa_checklist: req.qaChecklist,
      created_by: actor.id,
    });
    return this.mapPlaybook({
      id: pbId,
      organization_id: req.organizationId,
      title: draft.title,
      objective: draft.objective || req.objective,
      workstream_id: req.workstreamId,
      current_version: 1,
      created_by: actor.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  async listPlaybooks(actor: Actor, organizationId?: string) {
    const db = await this.client();
    let q = db.from("playbooks").select("*");
    if (organizationId) {
      assertOrgAccess(actor, organizationId);
      q = q.eq("organization_id", organizationId);
    }
    const { data, error } = await q;
    if (error) dbFail(error);
    return (data ?? []).map((row) => this.mapPlaybook(row));
  }

  private mapPlaybook(row: Record<string, unknown>): Playbook {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      title: String(row.title),
      objective: String(row.objective ?? ""),
      workstreamId: (row.workstream_id as string) ?? null,
      currentVersion: Number(row.current_version ?? 1),
      createdBy: String(row.created_by ?? ""),
      createdAt: String(row.created_at ?? nowIso()),
      updatedAt: String(row.updated_at ?? nowIso()),
    };
  }

  private mapPlaybookVersion(row: Record<string, unknown>): PlaybookVersion {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      playbookId: String(row.playbook_id),
      version: Number(row.version),
      steps: (row.steps as string[]) ?? [],
      clientPreferences: (row.client_preferences as string[]) ?? [],
      warnings: (row.warnings as string[]) ?? [],
      trigger: String(row.trigger ?? ""),
      requiredInputs: (row.required_inputs as string[]) ?? [],
      tools: (row.tools as string[]) ?? [],
      authorityLimits: (row.authority_limits as string[]) ?? [],
      approvalPoints: (row.approval_points as string[]) ?? [],
      qaChecklist: (row.qa_checklist as string[]) ?? [],
      knownExceptions: (row.known_exceptions as string[]) ?? [],
      templates: (row.templates as string[]) ?? [],
      createdBy: String(row.created_by ?? ""),
      createdAt: String(row.created_at ?? nowIso()),
    };
  }

  async getPlaybook(actor: Actor, id: string) {
    const db = await this.client();
    const { data: pb, error } = await db.from("playbooks").select("*").eq("id", id).maybeSingle();
    if (error) dbFail(error);
    if (!pb) throw new DomainError("Playbook not found");
    assertOrgAccess(actor, pb.organization_id);
    const { data: versions } = await db.from("playbook_versions").select("*").eq("playbook_id", id).order("version", { ascending: false });
    const mapped = (versions ?? []).map((row) => this.mapPlaybookVersion(row));
    const { data: linked } = await db
      .from("requests")
      .select("*")
      .eq("organization_id", pb.organization_id)
      .or(`playbook_id.eq.${id}${pb.workstream_id ? `,workstream_id.eq.${pb.workstream_id}` : ""}`);
    return {
      playbook: this.mapPlaybook(pb),
      versions: mapped,
      current: mapped[0] ?? null,
      linkedRequests: (linked ?? []).map((row) => this.mapRequest(row)),
    };
  }

  async createPlaybook(
    actor: Actor,
    input: {
      title: string;
      objective: string;
      workstreamId: string | null;
      steps: string[];
      preferences: string[];
      warnings: string[];
      trigger?: string;
      requiredInputs?: string[];
      tools?: string[];
      authorityLimits?: string[];
      approvalPoints?: string[];
      qaChecklist?: string[];
      knownExceptions?: string[];
      templates?: string[];
    },
  ) {
    if (!canWritePlaybook(actor)) throw new AuthzError();
    const orgId = actor.organizationId;
    if (!orgId) throw new AuthzError("No organization");
    const db = await this.client();
    const pbId = id();
    const { error } = await db.from("playbooks").insert({
      id: pbId,
      organization_id: orgId,
      title: input.title,
      objective: input.objective,
      workstream_id: input.workstreamId,
      current_version: 1,
      created_by: actor.id,
    });
    if (error) dbFail(error);
    await db.from("playbook_versions").insert({
      organization_id: orgId,
      playbook_id: pbId,
      version: 1,
      steps: input.steps,
      client_preferences: input.preferences,
      warnings: input.warnings,
      trigger: input.trigger ?? "",
      required_inputs: input.requiredInputs ?? [],
      tools: input.tools ?? [],
      authority_limits: input.authorityLimits ?? [],
      approval_points: input.approvalPoints ?? [],
      qa_checklist: input.qaChecklist ?? [],
      known_exceptions: input.knownExceptions ?? [],
      templates: input.templates ?? [],
      created_by: actor.id,
    });
    return this.mapPlaybook({
      id: pbId,
      organization_id: orgId,
      title: input.title,
      objective: input.objective,
      workstream_id: input.workstreamId,
      current_version: 1,
      created_by: actor.id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }

  async addPlaybookVersion(
    actor: Actor,
    playbookId: string,
    input: {
      steps: string[];
      preferences: string[];
      warnings: string[];
      trigger?: string;
      requiredInputs?: string[];
      tools?: string[];
      authorityLimits?: string[];
      approvalPoints?: string[];
      qaChecklist?: string[];
      knownExceptions?: string[];
      templates?: string[];
    },
  ) {
    if (!canWritePlaybook(actor)) throw new AuthzError();
    const bundle = await this.getPlaybook(actor, playbookId);
    const db = await this.client();
    const version = bundle.playbook.currentVersion + 1;
    await db.from("playbooks").update({ current_version: version, updated_at: nowIso() }).eq("id", playbookId);
    const { data, error } = await db
      .from("playbook_versions")
      .insert({
        organization_id: bundle.playbook.organizationId,
        playbook_id: playbookId,
        version,
        steps: input.steps,
        client_preferences: input.preferences,
        warnings: input.warnings,
        trigger: input.trigger ?? "",
        required_inputs: input.requiredInputs ?? [],
        tools: input.tools ?? [],
        authority_limits: input.authorityLimits ?? [],
        approval_points: input.approvalPoints ?? [],
        qa_checklist: input.qaChecklist ?? [],
        known_exceptions: input.knownExceptions ?? [],
        templates: input.templates ?? [],
        created_by: actor.id,
      })
      .select("*")
      .single();
    if (error) dbFail(error);
    return this.mapPlaybookVersion(data);
  }

  async getOperatingMemory(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (!orgId) throw new DomainError("No organization");
    assertOrgAccess(actor, orgId);
    const db = await this.client();
    const { data, error } = await db.from("operating_memory").select("*").eq("organization_id", orgId).maybeSingle();
    if (error) dbFail(error);
    if (!data) return { ...emptyOperatingMemory(orgId), organizationId: orgId };
    return {
      id: data.id,
      organizationId: data.organization_id,
      communicationTone: data.communication_tone ?? "",
      preferredMeetingWindows: data.preferred_meeting_windows ?? "",
      crmRules: data.crm_rules ?? "",
      escalationContacts: data.escalation_contacts ?? "",
      preferredVendors: data.preferred_vendors ?? "",
      prohibitedActions: data.prohibited_actions ?? "",
      approvalThresholds: data.approval_thresholds ?? "",
      formattingPreferences: data.formatting_preferences ?? "",
      updatedBy: data.updated_by,
      updatedAt: data.updated_at,
    } as OperatingMemory;
  }

  async updateOperatingMemory(actor: Actor, organizationId: string, patch: Partial<OperatingMemory>) {
    if (!canManageTeam(actor) && !canMutateOpsQueue(actor)) throw new AuthzError();
    assertOrgAccess(actor, organizationId);
    const db = await this.client();
    const payload = {
      organization_id: organizationId,
      communication_tone: patch.communicationTone ?? "",
      preferred_meeting_windows: patch.preferredMeetingWindows ?? "",
      crm_rules: patch.crmRules ?? "",
      escalation_contacts: patch.escalationContacts ?? "",
      preferred_vendors: patch.preferredVendors ?? "",
      prohibited_actions: patch.prohibitedActions ?? "",
      approval_thresholds: patch.approvalThresholds ?? "",
      formatting_preferences: patch.formattingPreferences ?? "",
      updated_by: actor.id,
      updated_at: nowIso(),
    };
    const { error } = await db.from("operating_memory").upsert(payload, { onConflict: "organization_id" });
    if (error) dbFail(error);
    await this.audit(actor, "memory.updated", "operating_memory", organizationId, organizationId, {});
    return this.getOperatingMemory(actor, organizationId);
  }

  async setWorkstreamSchedule(actor: Actor, workstreamId: string, schedule: WorkstreamSchedule | null) {
    if (!canMutateOpsQueue(actor) && actor.role !== "client_admin") throw new AuthzError();
    await this.getWorkstream(actor, workstreamId);
    const db = await this.client();
    const { data, error } = await db
      .from("workstreams")
      .update({ schedule, next_run_at: computeNextRunAt(schedule), updated_at: nowIso() })
      .eq("id", workstreamId)
      .select("*")
      .single();
    if (error) dbFail(error);
    return this.mapWorkstream(data);
  }

  async runWorkstreamSchedule(actor: Actor, workstreamId: string) {
    if (!canMutateOpsQueue(actor) && actor.role !== "client_admin") throw new AuthzError();
    const ws = await this.getWorkstream(actor, workstreamId);
    if (!ws.schedule || ws.schedule.cadence === "none") throw new DomainError("No recurring schedule");
    const db = await this.client();
    const { data: founder } = await db
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", ws.organizationId)
      .eq("role", "client_admin")
      .eq("status", "active")
      .maybeSingle();
    const { data: playbook } = await db
      .from("playbooks")
      .select("id")
      .eq("organization_id", ws.organizationId)
      .eq("workstream_id", ws.id)
      .maybeSingle();
    const creator: Actor = {
      id: founder?.user_id ?? actor.id,
      email: actor.email,
      name: "Schedule",
      role: "client_admin",
      organizationId: ws.organizationId,
      operatorId: null,
      source: actor.source,
    };
    const bundle = await this.createRequest(creator, {
      title: `${ws.name}: scheduled run`,
      objective: ws.objective,
      description: `${ws.objective} Scheduled operating checklist: ${ws.schedule.tasks.join(". ")}.`,
      deliverable: "Completed scheduled checklist",
      dueAt: nowIso(),
      workstreamId: ws.id,
      playbookId: playbook?.id ?? null,
      recurring: true,
      externalCommunication: false,
    });
    const nextRun = computeNextRunAt(ws.schedule);
    await db.from("workstreams").update({ next_run_at: nextRun, updated_at: nowIso() }).eq("id", ws.id);
    await this.audit(actor, "schedule.generated", "workstream", ws.id, ws.organizationId, { requestId: bundle.request.id });
    return bundle;
  }

  async runDueSchedules(actor: Actor, now = new Date()) {
    const workstreams = await this.listWorkstreams(actor);
    const due = workstreams.filter((w) => w.schedule && w.schedule.cadence !== "none" && w.nextRunAt && new Date(w.nextRunAt) <= now);
    const created = [];
    for (const ws of due) created.push(await this.runWorkstreamSchedule(actor, ws.id));
    return created;
  }

  async listIntegrations(actor: Actor) {
    if (!actor.organizationId) return [];
    const db = await this.client();
    const { data, error } = await db.from("integrations").select("*").eq("organization_id", actor.organizationId);
    if (error) dbFail(error);
    return data ?? [];
  }

  async requestIntegrationAccess(actor: Actor, integrationId: string) {
    const db = await this.client();
    const { data, error } = await db.from("integrations").update({ status: "requested" }).eq("id", integrationId).select("*").single();
    if (error) dbFail(error);
    return data;
  }

  async getSubscription(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (!orgId) return null;
    assertOrgAccess(actor, orgId);
    const db = await this.client();
    const { data } = await db.from("subscriptions").select("*").eq("organization_id", orgId).maybeSingle();
    return data;
  }

  async setMockSubscription(actor: Actor, plan?: string, hours?: number) {
    void actor;
    void plan;
    void hours;
    throw new DomainError("Billing is provisioned by operations, not self-serve mock plans");
  }

  async listUsage(actor: Actor) {
    if (!actor.organizationId) return [];
    const db = await this.client();
    const { data, error } = await db.from("usage_records").select("*").eq("organization_id", actor.organizationId);
    if (error) dbFail(error);
    return data ?? [];
  }

  async listOpenClarifications(actor: Actor) {
    const requests = await this.listRequests(actor);
    const ids = requests.map((r) => r.id);
    if (!ids.length) return [];
    const db = await this.client();
    const { data, error } = await db.from("clarifications").select("*").is("answer", null).in("request_id", ids);
    if (error) dbFail(error);
    return (data ?? []).map((c) => ({
      id: c.id,
      organizationId: c.organization_id,
      requestId: c.request_id,
      question: c.question,
      askedBy: c.asked_by,
      answer: c.answer,
      answeredBy: c.answered_by,
      createdAt: c.created_at,
      answeredAt: c.answered_at,
    }));
  }

  async listQaReviews(actor: Actor) {
    const requests = await this.listRequests(actor);
    const ids = requests.map((r) => r.id);
    if (!ids.length) return [];
    const db = await this.client();
    const { data, error } = await db.from("qa_reviews").select("*").in("request_id", ids).order("created_at", { ascending: false });
    if (error) dbFail(error);
    return (data ?? []).map((q) => ({
      id: q.id,
      organizationId: q.organization_id,
      requestId: q.request_id,
      reviewerId: q.reviewer_id,
      passed: q.passed,
      score: Number(q.score ?? 0),
      notes: q.notes ?? "",
      checklist: q.checklist ?? [],
      defects: q.defects ?? [],
      createdAt: q.created_at,
    }));
  }

  async listTimeEntries(actor: Actor) {
    const requests = await this.listRequests(actor);
    const ids = requests.map((r) => r.id);
    if (!ids.length) return [];
    const db = await this.client();
    const { data, error } = await db.from("time_entries").select("*").in("request_id", ids);
    if (error) dbFail(error);
    return (data ?? []).map((t) => ({
      id: t.id,
      hours: Number(t.hours ?? 0),
      note: t.note ?? "",
      requestId: t.request_id,
    }));
  }

  async listAuditEvents(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    const db = await this.client();
    let q = db.from("audit_events").select("*").order("created_at", { ascending: false });
    if (orgId) q = q.eq("organization_id", orgId);
    const { data, error } = await q;
    if (error) dbFail(error);
    return data ?? [];
  }

  async exportAudit(actor: Actor, organizationId: string) {
    if (actor.role !== "client_admin" && actor.role !== "platform_admin") throw new AuthzError();
    const rows = await this.listAuditEvents(actor, organizationId);
    await this.audit(actor, "data.exported", "organization", organizationId, organizationId, { kind: "audit" });
    return rows;
  }

  async hoursReturned(actor: Actor, organizationId?: string) {
    const orgId = organizationId ?? actor.organizationId;
    if (!orgId) return 0;
    const requests = await this.listRequests(actor, { organizationId: orgId });
    return requests.filter((r) => deliveredStatuses().includes(r.status)).reduce((s, r) => s + r.actualEffort, 0);
  }

  async activityFeed(actor: Actor, organizationId?: string) {
    const rows = await this.listAuditEvents(actor, organizationId);
    return rows.slice(0, 20);
  }

  async userName(id: string) {
    const db = await this.client();
    const { data } = await db.from("profiles").select("name").eq("id", id).maybeSingle();
    return data?.name ?? "Unknown";
  }

  async signedAttachmentUrl(actor: Actor, path: string) {
    const org = path.split("/")[0];
    assertOrgAccess(actor, org);
    const admin = supabaseAdmin();
    if (!admin) throw new DomainError("File access requires storage configuration");
    const { data, error } = await admin.storage.from("attachments").createSignedUrl(path, 60);
    if (error || !data) throw new DomainError("Could not sign that file");
    return data.signedUrl;
  }
}

export { SupabaseWorkspaceRepository as SupabaseWorkspace };
