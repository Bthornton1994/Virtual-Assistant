import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904210000_software_factory_run_manager_v1.sql"),
  "utf8",
);
const registry = readFileSync(resolve(process.cwd(), "src/lib/capability-registry.ts"), "utf8");

describe("Software Factory Run Manager schema", () => {
  it("registers the native capability without qualifying an agent executor", () => {
    expect(migration).toContain("'software_factory_run_management'");
    expect(migration).toContain("'active'");
    expect(migration).toContain("software-factory-run-manager/v1");
    expect(migration).not.toMatch(/insert into public\.executor_capabilities/i);
    expect(migration).not.toMatch(/insert into public\.executor_profiles/i);
    expect(registry).toContain('key: "software_factory_run_management"');
    expect(registry).toContain('status: "active"');
  });

  it("keeps software change capabilities proposed and fills their contracts", () => {
    expect(migration).toContain("software_repository_read");
    expect(migration).toContain("software_change_prepare");
    expect(migration).toContain("software_change_verify");
    expect(registry).toMatch(/key: "software_repository_read"[\s\S]*status: "proposed"/);
    expect(registry).toMatch(/key: "software_change_prepare"[\s\S]*status: "proposed"/);
  });

  it("creates tenant-scoped tables with RLS and least privilege", () => {
    for (const table of ["software_factory_runs", "software_factory_events", "software_factory_approvals"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toMatch(
      /revoke all privileges[\s\S]*software_factory_runs[\s\S]*from anon, authenticated, public/,
    );
    expect(migration).toMatch(/create policy software_factory_runs_select[\s\S]*my_org_ids\(\)/);
    expect(migration).toMatch(/create policy software_factory_runs_insert[\s\S]*is_platform_staff\(\)/);
    expect(migration).toMatch(/create policy software_factory_runs_update[\s\S]*is_platform_staff\(\)/);
    expect(migration).not.toMatch(/create policy software_factory_runs_delete/);
    expect(migration).not.toMatch(/create policy software_factory_events_update/);
  });

  it("freezes prepare_only authority and forbids a performed merge", () => {
    expect(migration).toContain("check (action_class = 'prepare_only')");
    expect(migration).toContain("check (may_own_authoritative_state = false)");
    expect(migration).toContain("check (merge_performed = false)");
    expect(migration).toContain("Software Factory events are append-only");
    expect(migration).toContain("Accepted cannot be inserted; it requires an owner decision and Outcome Receipt");
    expect(migration).toContain("before insert or update on public.software_factory_runs");
    expect(migration).toContain("unique (organization_id, task_id)");
    expect(migration).toContain("references public.workstream_runs (id, organization_id)");
    expect(migration).toContain("references public.delegation_specs (id, organization_id)");
  });

  it("records the Loadout proof as evidence-only and does not mutate GitHub", () => {
    const fixture = readFileSync(
      resolve(process.cwd(), "supabase/qa/software_factory_loadout_sf_load_001.sql"),
      "utf8",
    );
    expect(fixture).toContain("https://github.com/Bthornton1994/Loadout/pull/26");
    expect(fixture).toContain("insert into public.workstream_runs");
    expect(fixture).toContain("insert into public.software_factory_runs");
    expect(fixture).toContain("software-factory-run/v1");
    expect(fixture).toContain("'intake'");
    expect(fixture).not.toContain("insert into public.evidence_artifacts");
    expect(fixture).not.toMatch(/lifecycle_status,\s*'accepted'/);
    expect(fixture).not.toMatch(/'awaiting_owner'/);
    expect(fixture).toContain("githubIssuesWrite");
    expect(fixture).toContain("Northline QA fixture not present");
    expect(fixture).not.toMatch(/insert into public\.requests/i);
    expect(fixture).not.toMatch(/create table/i);
  });

  it("projects factory artifacts onto existing evidence_artifacts and outcome_receipts", () => {
    const projection = readFileSync(
      resolve(process.cwd(), "src/lib/software-factory-projection.ts"),
      "utf8",
    );
    expect(projection).toContain("EvidenceArtifact");
    expect(projection).toContain("OutcomeReceipt");
    expect(projection).toContain("prepare_only");
    expect(projection).toContain("no_merge");
    expect(projection).toContain('cursor_execution: "observation"');
    expect(projection).toContain('pull_request: "source"');
  });
});
