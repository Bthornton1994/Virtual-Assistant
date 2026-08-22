/**
 * Persistent golden path + tenant isolation against the dedicated project.
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON),
 * SUPABASE_SERVICE_ROLE_KEY, and provisioned test users.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // optional local env
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qbvmtgaphvpwpwemplje.supabase.co";
const publishable =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PASSWORD;
if (!password) {
  console.error("CREDENTIAL BLOCKER: E2E_PASSWORD is not set.");
  process.exit(2);
}

if (!publishable) {
  console.error("CREDENTIAL BLOCKER: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON) is not set.");
  process.exit(2);
}
if (!service) {
  console.error("CREDENTIAL BLOCKER: SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

async function asUser(email) {
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`login failed ${email}: ${error?.message}`);
  return { client, user: data.user };
}

function must(cond, label) {
  if (!cond) throw new Error(label);
}

const clientAdmin = await asUser("client.admin@northline-test.delegation.cloud");
const operator = await asUser("operator@delegation-test.cloud");
const manager = await asUser("ops.manager@delegation-test.cloud");
const harbor = await asUser("client.admin@harbor-test.delegation.cloud");

const { data: northline } = await clientAdmin.client.from("organizations").select("*").single();
must(northline?.name, "Northline org missing for client admin");
const { data: harborOrg } = await harbor.client.from("organizations").select("*").single();
must(harborOrg && harborOrg.id !== northline.id, "Harbor must be a distinct org");

const { data: planted, error: plantErr } = await harbor.client
  .from("requests")
  .insert({
    organization_id: harborOrg.id,
    title: "Harbor confidential plant",
    objective: "Isolation",
    description: "Must not leak",
    deliverable: "None",
    status: "queued",
    priority: "medium",
    risk_level: "low",
    approval_level: "prepare_only",
  })
  .select("id")
  .single();
if (plantErr) throw plantErr;

const { data: leaked } = await clientAdmin.client.from("requests").select("id").eq("id", planted.id);
const { error: crossInsert } = await clientAdmin.client.from("requests").insert({
  organization_id: harborOrg.id,
  title: "Cross write",
  objective: "fail",
  description: "fail",
  deliverable: "fail",
  status: "queued",
  priority: "medium",
  risk_level: "low",
  approval_level: "prepare_only",
});
const { data: crossUpdate, error: crossUpdErr } = await clientAdmin.client
  .from("requests")
  .update({ title: "Hijack" })
  .eq("id", planted.id)
  .select("id");
const { data: crossDelete, error: crossDelErr } = await clientAdmin.client.from("requests").delete().eq("id", planted.id).select("id");

must(!leaked?.length, "RLS FAIL: Northline SELECT Harbor request");
must(Boolean(crossInsert), "RLS FAIL: Northline INSERT into Harbor");
must(!crossUpdate?.length && Boolean(crossUpdErr || !crossUpdate?.length), "RLS FAIL: Northline UPDATE Harbor");
must(!crossDelete?.length, "RLS FAIL: Northline DELETE Harbor");

const { data: created, error: createErr } = await clientAdmin.client
  .from("requests")
  .insert({
    organization_id: northline.id,
    title: `Conference follow-up ${Date.now()}`,
    objective: "Every conference lead has an owner and a next step.",
    description: "Inspect CRM. Identify unassigned leads. Draft follow-up emails. Do not send until approved.",
    deliverable: "Owner list plus drafted follow-ups",
    status: "awaiting_plan_approval",
    priority: "high",
    risk_level: "high",
    approval_level: "external_execution",
    external_communication: true,
    created_by: clientAdmin.user.id,
  })
  .select("*")
  .single();
if (createErr) throw createErr;

await clientAdmin.client.from("execution_plans").insert({
  request_id: created.id,
  organization_id: northline.id,
  plan: {
    summary: "Prepare drafts only. Send after approval.",
    actionClass: "external_execution",
    riskLevel: "high",
    steps: [{ title: "Draft", detail: "Prepare only", owner: "operator" }],
    approvalsRequired: true,
    automationCandidates: [],
    humanOwned: ["Send"],
  },
});
const { data: planApproval } = await clientAdmin.client
  .from("approvals")
  .insert({
    organization_id: northline.id,
    request_id: created.id,
    kind: "execution_plan",
    action: "Approve execution plan",
    description: "Plan",
    action_class: "external_execution",
    status: "pending",
    requested_by: clientAdmin.user.id,
    reason: "Plan",
  })
  .select("*")
  .single();

await clientAdmin.client
  .from("approvals")
  .update({ status: "approved", decided_by: clientAdmin.user.id, decided_at: new Date().toISOString() })
  .eq("id", planApproval.id);
await clientAdmin.client.from("requests").update({ status: "queued" }).eq("id", created.id);

const { data: op } = await manager.client.from("operators").select("id").eq("user_id", operator.user.id).single();
await manager.client.from("requests").update({ assigned_operator_id: op.id, status: "assigned" }).eq("id", created.id);
await operator.client.from("requests").update({ status: "in_progress" }).eq("id", created.id);
await operator.client.from("requests").update({ status: "qa" }).eq("id", created.id);

await manager.client.from("qa_reviews").insert({
  organization_id: northline.id,
  request_id: created.id,
  reviewer_id: manager.user.id,
  passed: false,
  score: 40,
  notes: "Missing owner column",
  defects: ["Owner missing"],
});
await manager.client.from("requests").update({ status: "revision_required" }).eq("id", created.id);
await operator.client.from("requests").update({ status: "in_progress" }).eq("id", created.id);
await operator.client.from("requests").update({ status: "qa" }).eq("id", created.id);
await manager.client.from("qa_reviews").insert({
  organization_id: northline.id,
  request_id: created.id,
  reviewer_id: manager.user.id,
  passed: true,
  score: 92,
  notes: "Ready after revision",
});

const { data: outbound } = await manager.client
  .from("approvals")
  .insert({
    organization_id: northline.id,
    request_id: created.id,
    kind: "external_email",
    action: "Send prepared follow-up",
    description: "Outbound",
    action_class: "external_execution",
    status: "pending",
    requested_by: manager.user.id,
    reason: "Outbound",
  })
  .select("*")
  .single();
await manager.client.from("requests").update({ status: "awaiting_action_approval" }).eq("id", created.id);
const { error: premature } = await operator.client.from("requests").update({ status: "delivered" }).eq("id", created.id);
must(Boolean(premature), "External delivery must fail without approval");

await clientAdmin.client
  .from("approvals")
  .update({ status: "approved", decided_by: clientAdmin.user.id, decided_at: new Date().toISOString() })
  .eq("id", outbound.id);
await operator.client.from("deliveries").insert({
  organization_id: northline.id,
  request_id: created.id,
  summary: "Prepared owner list and drafts. Nothing sent until approved.",
  deliverables: ["Owner list"],
  actions_taken: ["Drafted"],
  exceptions: [],
  unresolved_decisions: [],
  next_step: "Capture playbook",
  created_by: operator.user.id,
});
await operator.client.from("requests").update({ status: "delivered" }).eq("id", created.id);
await clientAdmin.client.from("requests").update({ status: "accepted" }).eq("id", created.id);

const { data: pb } = await clientAdmin.client
  .from("playbooks")
  .insert({
    organization_id: northline.id,
    title: "Conference follow-up playbook",
    objective: created.objective,
    current_version: 1,
    created_by: clientAdmin.user.id,
  })
  .select("*")
  .single();
await clientAdmin.client.from("playbook_versions").insert({
  organization_id: northline.id,
  playbook_id: pb.id,
  version: 1,
  steps: ["Inspect CRM", "Draft follow-ups", "Request send approval"],
  created_by: clientAdmin.user.id,
});
const { data: reused } = await clientAdmin.client
  .from("requests")
  .insert({
    organization_id: northline.id,
    title: "Reuse conference playbook",
    objective: created.objective,
    description: "Use the captured playbook",
    deliverable: "Same pack",
    status: "awaiting_plan_approval",
    playbook_id: pb.id,
    created_by: clientAdmin.user.id,
    priority: "medium",
    risk_level: "high",
    approval_level: "external_execution",
  })
  .select("id, playbook_id")
  .single();

const { data: afterReauth } = await (await asUser("client.admin@northline-test.delegation.cloud")).client
  .from("requests")
  .select("id, status, title")
  .eq("id", created.id)
  .single();
must(afterReauth?.status === "accepted", "State did not survive re-auth");
must(reused?.playbook_id === pb.id, "Playbook reuse failed");

console.log(
  JSON.stringify(
    {
      result: "PASS",
      requestId: created.id,
      playbookId: pb.id,
      reusedRequestId: reused.id,
      rls: { northlineCouldNotReadHarbor: true, prematureDeliveryBlocked: true },
    },
    null,
    2,
  ),
);
