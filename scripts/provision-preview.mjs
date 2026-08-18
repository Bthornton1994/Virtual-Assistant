/**
 * Provision preview orgs + Auth users. Requires a dedicated Delegation Cloud project.
 * Usage: node scripts/provision-preview.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !service) {
  console.error("BLOCKED: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(2);
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const password = process.env.E2E_PASSWORD || "Preview-Gate-2026!";

const orgs = [
  { name: "Northline Preview", slug: "northline-preview", industry: "Consulting" },
  { name: "Harbor Preview", slug: "harbor-preview", industry: "Legal" },
];

const users = [
  { email: "client.admin@northline-preview.test", name: "Elena Preview", org: "northline-preview", role: "client_admin" },
  { email: "ops.manager@delegation-preview.test", name: "Noah Preview", org: null, role: "ops_manager" },
  { email: "operator@delegation-preview.test", name: "Maya Preview", org: null, role: "operator" },
  { email: "client.admin@harbor-preview.test", name: "Harbor Admin", org: "harbor-preview", role: "client_admin" },
];

const { data: existingOrgs } = await admin.from("organizations").select("id, slug");
const orgIds = Object.fromEntries((existingOrgs ?? []).map((o) => [o.slug, o.id]));

for (const org of orgs) {
  if (orgIds[org.slug]) continue;
  const { data, error } = await admin.from("organizations").insert(org).select("id, slug").single();
  if (error) throw error;
  orgIds[data.slug] = data.id;
  await admin.from("operating_memory").upsert({ organization_id: data.id, prohibited_actions: "Do not send without approval" });
}

for (const person of users) {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: person.email,
    password,
    email_confirm: true,
    user_metadata: { name: person.name },
  });
  const user = created?.user ?? (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === person.email);
  if (!user) throw error ?? new Error(`Could not create ${person.email}`);
  await admin.from("profiles").upsert({ id: user.id, name: person.name, email: person.email });
  if (person.role === "ops_manager" || person.role === "operator") {
    await admin.from("operators").upsert(
      { user_id: user.id, name: person.name, platform_role: person.role, status: "active" },
      { onConflict: "user_id" },
    );
  }
  if (person.org) {
    await admin.from("organization_members").upsert(
      { organization_id: orgIds[person.org], user_id: user.id, role: person.role, status: "active" },
      { onConflict: "organization_id,user_id" },
    );
  }
}

console.log(JSON.stringify({ orgs: orgIds, users: users.map((u) => u.email), passwordHint: "E2E_PASSWORD or Preview-Gate-2026!" }, null, 2));
