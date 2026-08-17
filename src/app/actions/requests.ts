"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireClient, requireOps, requireSession } from "@/lib/auth";
import {
  APPROVAL_KINDS,
  AuthzError,
  DomainError,
  type ApprovalKind,
  type RequestStatus,
  type WorkstreamSchedule,
} from "@/lib/domain";
import { getStore } from "@/lib/store";

function rethrowAction(error: unknown): never {
  if (error instanceof DomainError || error instanceof AuthzError) {
    throw new Error(error.message);
  }
  throw error;
}

function parseDue(raw: string) {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function lines(formData: FormData, name: string) {
  return String(formData.get(name) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function revalidateRequest(id: string) {
  revalidatePath("/app");
  revalidatePath("/ops");
  revalidatePath(`/app/requests/${id}`);
  revalidatePath(`/ops/requests/${id}`);
}

export async function createRequestAction(formData: FormData) {
  const actor = await requireClient();
  const store = getStore();
  const files = String(formData.get("files") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bundle = await store.createRequest(actor, {
    title: String(formData.get("title") || "").trim() || String(formData.get("what") || "Untitled request"),
    objective: String(formData.get("objective") || "").trim(),
    description: String(formData.get("description") || formData.get("what") || "").trim(),
    deliverable: String(formData.get("deliverable") || "").trim(),
    dueAt: parseDue(String(formData.get("dueAt") || "")),
    workstreamId: String(formData.get("workstreamId") || "") || null,
    playbookId: String(formData.get("playbookId") || "") || null,
    recurring: formData.get("recurring") === "on" || formData.get("recurring") === "true",
    externalCommunication:
      formData.get("externalCommunication") === "on" || formData.get("externalCommunication") === "true",
    files,
  });
  revalidatePath("/app");
  redirect(`/app/requests/${bundle.request.id}`);
}

export async function addCommentAction(formData: FormData) {
  const actor = await requireSession();
  const requestId = String(formData.get("requestId") || "");
  const visibility = formData.get("visibility") === "internal" ? "internal" : "customer";
  getStore().addComment(actor, requestId, String(formData.get("body") || "").trim(), visibility);
  revalidateRequest(requestId);
}

export async function acceptRequestAction(formData: FormData) {
  const actor = await requireClient();
  const id = String(formData.get("requestId") || "");
  getStore().transitionRequest(actor, id, "accepted");
  revalidatePath("/app");
}

export async function cancelRequestAction(formData: FormData) {
  const actor = await requireSession();
  const id = String(formData.get("requestId") || "");
  getStore().transitionRequest(actor, id, "cancelled");
  revalidatePath("/app");
  revalidatePath("/ops");
}

export async function decideApprovalAction(formData: FormData) {
  const actor = await requireClient();
  const id = String(formData.get("approvalId") || "");
  const decision = String(formData.get("decision") || "") as "approved" | "rejected";
  try {
    getStore().decideApproval(actor, id, decision, String(formData.get("note") || ""));
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/app/approvals");
  revalidatePath("/app");
}

export async function opsTransitionAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  const to = String(formData.get("status") || "") as RequestStatus;
  try {
    getStore().transitionRequest(actor, id, to, String(formData.get("note") || ""));
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/ops");
  revalidatePath(`/ops/requests/${id}`);
}

export async function opsAssignAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  try {
    getStore().assignOperator(actor, id, String(formData.get("operatorId") || ""));
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/ops");
}

export async function opsScopeAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  getStore().updateRequestScope(actor, id, {
    title: String(formData.get("title") || ""),
    objective: String(formData.get("objective") || ""),
    description: String(formData.get("description") || ""),
    deliverable: String(formData.get("deliverable") || ""),
    dueAt: String(formData.get("dueAt") || "") || null,
  });
  revalidatePath(`/ops/requests/${id}`);
}

export async function opsSplitStepAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  getStore().splitStep(actor, id, String(formData.get("title") || "New step"), String(formData.get("detail") || ""));
  revalidatePath(`/ops/requests/${id}`);
}

export async function opsRequestApprovalAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  const request = getStore().getRequest(actor, id);
  const rawKind = String(formData.get("kind") || "");
  const kind = (APPROVAL_KINDS as readonly string[]).includes(rawKind) ? (rawKind as ApprovalKind) : undefined;
  getStore().createApproval(
    actor,
    id,
    request.approvalLevel,
    String(formData.get("reason") || "Customer approval required before continuing."),
    kind,
  );
  revalidateRequest(id);
}

export async function opsQaAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  const items = lines(formData, "checklist");
  const checks = items.length
    ? items.map((item) => ({ item: item.replace(/^ok:\s*/i, "").replace(/^fail:\s*/i, ""), ok: !item.toLowerCase().startsWith("fail:") }))
    : undefined;
  try {
    getStore().createQaReview(actor, id, {
      passed: formData.get("passed") === "true",
      score: Number(formData.get("score") || 80),
      notes: String(formData.get("notes") || ""),
      checklist: checks,
      defects: lines(formData, "defects"),
    });
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/ops/qa");
  revalidateRequest(id);
}

export async function opsTimeAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  getStore().addTimeEntry(actor, id, Number(formData.get("hours") || 0), String(formData.get("note") || ""));
  revalidatePath(`/ops/requests/${id}`);
}

export async function inviteMemberAction(formData: FormData) {
  const actor = await requireClient();
  getStore().inviteMember(actor, {
    email: String(formData.get("email") || ""),
    name: String(formData.get("name") || ""),
    role: formData.get("role") === "client_admin" ? "client_admin" : "client_member",
  });
  revalidatePath("/app/team");
}

export async function requestIntegrationAction(formData: FormData) {
  const actor = await requireClient();
  getStore().requestIntegrationAccess(actor, String(formData.get("integrationId") || ""));
  revalidatePath("/app/integrations");
}

export async function activatePlanAction(formData: FormData) {
  const actor = await requireClient();
  const plan = String(formData.get("plan") || "growth") as "starter" | "growth" | "firm";
  const hours = plan === "starter" ? 20 : plan === "firm" ? 80 : 40;
  getStore().setMockSubscription(actor, plan, hours);
  revalidatePath("/app/billing");
}

export async function updateOperatingMemoryAction(formData: FormData) {
  const actor = await requireClient();
  if (!actor.organizationId) return;
  getStore().updateOperatingMemory(actor, actor.organizationId, {
    communicationTone: String(formData.get("communicationTone") || ""),
    preferredMeetingWindows: String(formData.get("preferredMeetingWindows") || ""),
    crmRules: String(formData.get("crmRules") || ""),
    escalationContacts: String(formData.get("escalationContacts") || ""),
    preferredVendors: String(formData.get("preferredVendors") || ""),
    prohibitedActions: String(formData.get("prohibitedActions") || ""),
    approvalThresholds: String(formData.get("approvalThresholds") || ""),
    formattingPreferences: String(formData.get("formattingPreferences") || ""),
  });
  revalidatePath("/app/settings");
  revalidatePath("/app/dashboard");
}

export async function updateOrganizationAction(formData: FormData) {
  const actor = await requireClient();
  if (!actor.organizationId) return;
  getStore().updateOrganization(actor, actor.organizationId, {
    name: String(formData.get("name") || "").trim(),
    industry: String(formData.get("industry") || "").trim(),
    companySize: String(formData.get("companySize") || "").trim(),
    timezone: String(formData.get("timezone") || "").trim(),
  });
  revalidatePath("/app/settings");
}

export async function createPlaybookAction(formData: FormData) {
  const actor = await requireSession();
  const pb = getStore().createPlaybook(actor, {
    title: String(formData.get("title") || "Untitled playbook"),
    objective: String(formData.get("objective") || ""),
    workstreamId: String(formData.get("workstreamId") || "") || null,
    steps: lines(formData, "steps"),
    preferences: lines(formData, "preferences"),
    warnings: lines(formData, "warnings"),
    trigger: String(formData.get("trigger") || ""),
    requiredInputs: lines(formData, "requiredInputs"),
    tools: lines(formData, "tools"),
    authorityLimits: lines(formData, "authorityLimits"),
    approvalPoints: lines(formData, "approvalPoints"),
    qaChecklist: lines(formData, "qaChecklist"),
    knownExceptions: lines(formData, "knownExceptions"),
    templates: lines(formData, "templates"),
  });
  revalidatePath("/app/playbooks");
  revalidatePath("/ops/playbooks");
  if ((await getSession())?.role && !["operator", "ops_manager", "platform_admin"].includes(actor.role)) {
    redirect(`/app/playbooks/${pb.id}`);
  }
  redirect(`/ops/playbooks`);
}

export async function addPlaybookVersionAction(formData: FormData) {
  const actor = await requireSession();
  const id = String(formData.get("playbookId") || "");
  getStore().addPlaybookVersion(actor, id, {
    steps: lines(formData, "steps"),
    preferences: lines(formData, "preferences"),
    warnings: lines(formData, "warnings"),
    trigger: String(formData.get("trigger") || ""),
    requiredInputs: lines(formData, "requiredInputs"),
    tools: lines(formData, "tools"),
    authorityLimits: lines(formData, "authorityLimits"),
    approvalPoints: lines(formData, "approvalPoints"),
    qaChecklist: lines(formData, "qaChecklist"),
    knownExceptions: lines(formData, "knownExceptions"),
    templates: lines(formData, "templates"),
  });
  revalidatePath(`/app/playbooks/${id}`);
}

export async function modifyPlanAction(formData: FormData) {
  const actor = await requireClient();
  const id = String(formData.get("requestId") || "");
  try {
    getStore().modifyPlan(actor, id, lines(formData, "steps"));
  } catch (error) {
    rethrowAction(error);
  }
  revalidateRequest(id);
}

export async function answerClarificationAction(formData: FormData) {
  const actor = await requireClient();
  const id = String(formData.get("clarificationId") || "");
  const requestId = String(formData.get("requestId") || "");
  try {
    getStore().answerClarification(actor, id, String(formData.get("answer") || "").trim());
  } catch (error) {
    rethrowAction(error);
  }
  revalidateRequest(requestId);
}

export async function askClarificationAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  try {
    getStore().askClarification(actor, id, String(formData.get("question") || "").trim());
  } catch (error) {
    rethrowAction(error);
  }
  revalidateRequest(id);
}

export async function addInternalNoteAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  getStore().addInternalNote(actor, id, String(formData.get("body") || "").trim());
  revalidatePath(`/ops/requests/${id}`);
}

export async function updateStepAction(formData: FormData) {
  const actor = await requireOps();
  const requestId = String(formData.get("requestId") || "");
  const status = String(formData.get("status") || "done") as "pending" | "in_progress" | "blocked" | "done";
  try {
    getStore().updateStep(actor, String(formData.get("stepId") || ""), { status });
  } catch (error) {
    rethrowAction(error);
  }
  revalidateRequest(requestId);
}

export async function deliverRequestAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  try {
    getStore().deliverRequest(actor, id, {
      summary: String(formData.get("summary") || "").trim(),
      deliverables: lines(formData, "deliverables"),
      attachments: lines(formData, "attachments"),
      actionsTaken: lines(formData, "actionsTaken"),
      exceptions: lines(formData, "exceptions"),
      unresolvedDecisions: lines(formData, "unresolvedDecisions"),
      nextStep: String(formData.get("nextStep") || "").trim(),
    });
  } catch (error) {
    rethrowAction(error);
  }
  revalidateRequest(id);
}

export async function generatePlaybookFromRequestAction(formData: FormData) {
  const actor = await requireSession();
  const id = String(formData.get("requestId") || "");
  let pbId = "";
  try {
    const pb = getStore().generatePlaybookFromRequest(actor, id, String(formData.get("name") || "") || undefined);
    pbId = pb.id;
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/app/playbooks");
  revalidatePath("/ops/playbooks");
  revalidateRequest(id);
  if (actor.role === "client_admin") redirect(`/app/playbooks/${pbId}`);
}

export async function setWorkstreamScheduleAction(formData: FormData) {
  const actor = await requireSession();
  const id = String(formData.get("workstreamId") || "");
  const cadence = String(formData.get("cadence") || "none");
  const schedule: WorkstreamSchedule | null =
    cadence === "none"
      ? null
      : {
          cadence: cadence === "weekly" ? "weekly" : "weekdays",
          time: String(formData.get("time") || "08:00"),
          tasks: lines(formData, "tasks"),
        };
  try {
    getStore().setWorkstreamSchedule(actor, id, schedule);
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/app/workstreams");
  revalidatePath(`/app/workstreams/${id}`);
  revalidatePath("/ops");
}

export async function runWorkstreamScheduleAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("workstreamId") || "");
  let requestId = "";
  try {
    const bundle = await getStore().runWorkstreamSchedule(actor, id);
    requestId = bundle.request.id;
  } catch (error) {
    rethrowAction(error);
  }
  revalidatePath("/ops");
  if (requestId) redirect(`/ops/requests/${requestId}`);
}
