import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function migration(name: string) {
  return readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
}

const sql = [
  "0001_init.sql",
  "0002_lifecycle.sql",
  "0003_operating.sql",
  "0004_production_auth.sql",
  "0005_invites_storage.sql",
  "0006_lifecycle_authz.sql",
  "0007_schema_alignment.sql",
  "0008_member_rls.sql",
].map(migration).join("\n");

const controlPlaneSql = [
  "20260822180731_delegation_execution_primitives.sql",
  "20260822200013_gauntlet_loop_v1.sql",
  "20260822200301_gauntlet_loop_v1_hardening.sql",
  "20260823120000_step3d_work_cell.sql",
  "20260825190000_capability_registry_v1.sql",
  "20260826043000_native_skill_registry_v1.sql",
  "20260903090000_execution_runtime_v1.sql",
  "20260904210000_software_factory_run_manager_v1.sql",
].map(migration).join("\n");

const tenantTables = [
  "organizations",
  "organization_members",
  "operators",
  "skills",
  "operator_skills",
  "workstream_templates",
  "workstreams",
  "requests",
  "request_steps",
  "request_assignments",
  "approvals",
  "playbooks",
  "playbook_versions",
  "comments",
  "attachments",
  "time_entries",
  "qa_reviews",
  "integrations",
  "subscriptions",
  "usage_records",
  "audit_events",
  "clarifications",
  "deliveries",
  "internal_notes",
  "operating_memory",
  "profiles",
  "leads",
  "execution_plans",
  "invitations",
];

describe("RLS schema (practical)", () => {
  it("enables row level security on every product table", () => {
    for (const table of tenantTables) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
  });

  it("scopes customer-owned tables with organization_id", () => {
    const owned = [
      "workstreams",
      "requests",
      "request_steps",
      "request_assignments",
      "approvals",
      "playbooks",
      "playbook_versions",
      "comments",
      "attachments",
      "time_entries",
      "qa_reviews",
      "integrations",
      "subscriptions",
      "usage_records",
      "clarifications",
      "deliveries",
      "internal_notes",
      "operating_memory",
      "invitations",
    ];
    for (const table of owned) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table}[\\s\\S]*?organization_id uuid not null`));
    }
  });

  it("blocks sensitive in_progress without an approved approval", () => {
    expect(sql).toMatch(/enforce_sensitive_approval/);
    expect(sql).toMatch(/Sensitive execution cannot proceed without explicit approval/);
    expect(sql).toMatch(/my_org_ids/);
    expect(sql).toMatch(/platform_role/);
    expect(sql).toMatch(/enforce_external_delivery/);
    expect(sql).toMatch(/Outbound action requires customer approval before delivery/);
    expect(sql).toMatch(/mem_self_activate/);
    expect(sql).toMatch(/is_org_admin/);
    expect(sql).toMatch(/Break organization_members RLS recursion/);
  });

  it("does not publish the service role to the browser client helper", () => {
    const admin = readFileSync(resolve(process.cwd(), "src/lib/supabase/admin.ts"), "utf8");
    const browser = readFileSync(resolve(process.cwd(), "src/lib/supabase/client.ts"), "utf8");
    expect(admin).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(admin).toMatch(/must not run in the browser/);
    expect(browser).not.toMatch(/SERVICE_ROLE/);
  });
});

describe("control-plane RLS", () => {
  const tenantScoped = [
    "delegation_specs",
    "workstream_runs",
    "evidence_artifacts",
    "outcome_receipts",
    "gauntlet_cycles",
    "gauntlet_observations",
    "gauntlet_diagnoses",
    "gauntlet_reviews",
    "gauntlet_impact_assessments",
    "workstream_autonomy_profiles",
    "autonomy_decisions",
    "software_factory_runs",
    "software_factory_events",
    "software_factory_approvals",
  ];

  const staffOnly = [
    "gauntlet_failures",
    "autonomy_recoveries",
    "executor_profiles",
    "run_executor_assignments",
    "capabilities",
    "executor_capabilities",
    "native_skills",
    "execution_plan_steps",
    "execution_attempts",
    "execution_events",
  ];

  it("enables row level security on later control-plane tables", () => {
    for (const table of [...tenantScoped, ...staffOnly, "execution_approval_requests"]) {
      expect(controlPlaneSql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
  });

  it("scopes tenant control-plane reads to my_org_ids or platform staff", () => {
    for (const table of tenantScoped) {
      const policy = new RegExp(
        `create policy \\w+ on public\\.${table}[\\s\\S]{0,240}organization_id in \\(select public\\.my_org_ids\\(\\)\\) or public\\.is_platform_staff\\(\\)`,
        "i",
      );
      expect(controlPlaneSql, table).toMatch(policy);
    }
  });

  it("keeps staffing and runtime ledgers off customer authenticated reads", () => {
    for (const table of staffOnly) {
      expect(controlPlaneSql, table).toMatch(
        new RegExp(`create policy \\w+ on public\\.${table}[\\s\\S]{0,200}using \\(public\\.is_platform_staff\\(\\)\\)`, "i"),
      );
      expect(controlPlaneSql, table).not.toMatch(
        new RegExp(`create policy \\w+_select on public\\.${table}[\\s\\S]{0,200}to (anon|public)\\b`, "i"),
      );
    }
  });

  it("lets a customer read an execution approval request only inside their org", () => {
    expect(controlPlaneSql).toMatch(
      /create policy execution_approval_select on public\.execution_approval_requests[\s\S]{0,240}organization_id in \(select public\.my_org_ids\(\)\) or public\.is_platform_staff\(\)/,
    );
  });
});
