import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql =
  readFileSync(resolve(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(process.cwd(), "supabase/migrations/0002_lifecycle.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(process.cwd(), "supabase/migrations/0003_operating.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(process.cwd(), "supabase/migrations/0004_production_auth.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(process.cwd(), "supabase/migrations/0005_invites_storage.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(process.cwd(), "supabase/migrations/0006_lifecycle_authz.sql"), "utf8") +
  "\n" +
  readFileSync(resolve(process.cwd(), "supabase/migrations/0007_schema_alignment.sql"), "utf8");

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
  });

  it("does not publish the service role to the browser client helper", () => {
    const admin = readFileSync(resolve(process.cwd(), "src/lib/supabase/admin.ts"), "utf8");
    const browser = readFileSync(resolve(process.cwd(), "src/lib/supabase/client.ts"), "utf8");
    expect(admin).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(admin).toMatch(/must not run in the browser/);
    expect(browser).not.toMatch(/SERVICE_ROLE/);
  });
});
