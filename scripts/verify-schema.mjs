/**
 * Verify live public tables, RLS, and required objects on the dedicated project.
 * Requires SUPABASE_ACCESS_TOKEN.
 */
const REF = process.env.SUPABASE_PROJECT_REF || "qbvmtgaphvpwpwemplje";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("CREDENTIAL BLOCKER: SUPABASE_ACCESS_TOKEN is not set.");
  process.exit(2);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return JSON.parse(text);
}

const required = [
  "organizations",
  "organization_members",
  "profiles",
  "operators",
  "skills",
  "operator_skills",
  "workstream_templates",
  "workstreams",
  "requests",
  "request_steps",
  "request_assignments",
  "execution_plans",
  "clarifications",
  "approvals",
  "comments",
  "attachments",
  "qa_reviews",
  "deliveries",
  "playbooks",
  "playbook_versions",
  "operating_memory",
  "audit_events",
  "leads",
  "invitations",
  "internal_notes",
];

const tables = await sql(`
  select c.relname as table_name, c.relrowsecurity as rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by 1
`);
const names = tables.map((t) => t.table_name);
const missing = required.filter((name) => !names.includes(name));
const noRls = tables.filter((t) => required.includes(t.table_name) && !t.rls).map((t) => t.table_name);
const statuses = await sql(`
  select pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'public.requests'::regclass and contype = 'c'
`);
const policies = await sql(`
  select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2
`);

const report = {
  project: REF,
  tables: names,
  missing,
  rlsDisabled: noRls,
  requestStatusConstraint: statuses,
  policyCount: policies.length,
  hasDeliveryPackagesView: (await sql(`select to_regclass('public.delivery_packages') as reg`))[0]?.reg,
};
console.log(JSON.stringify(report, null, 2));
if (missing.length || noRls.length) process.exit(1);
