"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, requireClient, requireOps, requireSession } from "@/lib/auth";
import { AuthzError, DomainError, type RequestStatus } from "@/lib/domain";
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
  getStore().addComment(actor, requestId, String(formData.get("body") || "").trim());
  revalidatePath(`/app/requests/${requestId}`);
  revalidatePath(`/ops/requests/${requestId}`);
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
  getStore().createApproval(
    actor,
    id,
    request.approvalLevel,
    String(formData.get("reason") || "Customer approval required before continuing."),
  );
  revalidatePath(`/ops/requests/${id}`);
}

export async function opsQaAction(formData: FormData) {
  const actor = await requireOps();
  const id = String(formData.get("requestId") || "");
  getStore().createQaReview(actor, id, {
    passed: formData.get("passed") === "true",
    score: Number(formData.get("score") || 80),
    notes: String(formData.get("notes") || ""),
  });
  revalidatePath("/ops/qa");
  revalidatePath(`/ops/requests/${id}`);
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
    steps: String(formData.get("steps") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    preferences: String(formData.get("preferences") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    warnings: String(formData.get("warnings") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
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
    steps: String(formData.get("steps") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    preferences: String(formData.get("preferences") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    warnings: String(formData.get("warnings") || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  revalidatePath(`/app/playbooks/${id}`);
}
