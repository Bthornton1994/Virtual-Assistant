/**
 * Provision Northline Consulting Test + Harbor Test and real Auth users.
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * These are NOT /demo identities.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qbvmtgaphvpwpwemplje.supabase.co";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PASSWORD || "Preview-Gate-2026!";

if (!service) {
  console.error("CREDENTIAL BLOCKER: SUPABASE_SERVICE_ROLE_KEY is not set.");
  console.error("Copy the service_role secret from the dedicated project (never a browser key).");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const orgs = [
  { name: "Northline Consulting Test", slug: "northline-consulting-test", industry: "Consulting" },
  { name: "Harbor Test", slug: "harbor-test", industry: "Legal" },
];

const people = [
  { email: "client.admin@northline-test.delegation.cloud", name: "Elena Northline", org: "northline-consulting-test", role: "client_admin" },
  { email: "client.member@northline-test.delegation.cloud", name: "Marcus Northline", org: "northline-consulting-test", role: "client_member" },
  { email: "ops.manager@delegation-test.cloud", name: "Noah Ops", org: null, role: "ops_manager" },
  { email: "operator@delegation-test.cloud", name: "Maya Operator", org: null, role: "operator" },
  { email: "platform.admin@delegation-test.cloud", name: "Samira Admin", org: null, role: "platform_admin" },
  { email: "client.admin@harbor-test.delegation.cloud", name: "Harbor Admin", org: "harbor-test", role: "client_admin" },
];

async function ensureOrg(org) {
  const { data: existing } = await admin.from("organizations").select("id, slug").eq("slug", org.slug).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin.from("organizations").insert(org).select("id").single();
  if (error) throw error;
  await admin.from("operating_memory").upsert({
    organization_id: data.id,
    prohibited_actions: "Do not send, purchase, publish, or change access without approval.",
  });
  const { data: templates } = await admin.from("workstream_templates").select("*");
  for (const tpl of templates ?? []) {
    await admin.from("workstreams").insert({
      organization_id: data.id,
      template_id: tpl.id,
      name: tpl.name,
      objective: tpl.objective,
      sla: tpl.sla,
      recurring_tasks: tpl.recurring_tasks,
      metrics: tpl.metrics,
      status: "active",
    });
  }
  return data.id;
}

const orgIds = {};
for (const org of orgs) orgIds[org.slug] = await ensureOrg(org);

const created = [];
for (const person of people) {
  const { data: createdUser, error } = await admin.auth.admin.createUser({
    email: person.email,
    password,
    email_confirm: true,
    user_metadata: { name: person.name },
  });
  let user = createdUser?.user;
  if (error || !user) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    user = listed.data.users.find((u) => u.email === person.email);
  }
  if (!user) throw error ?? new Error(`Could not create ${person.email}`);
  await admin.from("profiles").upsert({ id: user.id, name: person.name, email: person.email });
  if (["operator", "ops_manager", "platform_admin"].includes(person.role)) {
    await admin.from("operators").upsert(
      { user_id: user.id, name: person.name, platform_role: person.role, status: "active", capacity_hours: 30 },
      { onConflict: "user_id" },
    );
  }
  if (person.org) {
    await admin.from("organization_members").upsert(
      { organization_id: orgIds[person.org], user_id: user.id, role: person.role, status: "active" },
      { onConflict: "organization_id,user_id" },
    );
  }
  created.push({ email: person.email, role: person.role, userId: user.id });
}

console.log(
  JSON.stringify(
    {
      project: url,
      orgs: orgIds,
      users: created,
      passwordEnv: "E2E_PASSWORD or default Preview-Gate-2026!",
    },
    null,
    2,
  ),
);
