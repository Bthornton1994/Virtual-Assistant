import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260823120000_step3d_work_cell.sql"),
  "utf8",
);
const fixture = readFileSync(resolve(process.cwd(), "supabase/qa/step3d_executor_profiles.sql"), "utf8");

describe("Step 3D work-cell schema", () => {
  it("registers both new tables with row level security", () => {
    for (const table of ["executor_profiles", "run_executor_assignments"]) {
      expect(migration).toMatch(new RegExp(`create table public\\.${table}`));
      expect(migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
    }
  });

  it("keeps the executor roster backstage and manager-writable only", () => {
    expect(migration).toMatch(/create policy executor_profiles_select[\s\S]*?using \(public\.is_platform_staff\(\)\)/);
    expect(migration).toMatch(/create policy executor_profiles_insert[\s\S]*?with check \(public\.is_ops_manager\(\)\)/);
    expect(migration).toMatch(/create policy executor_profiles_update[\s\S]*?using \(public\.is_ops_manager\(\)\)/);
  });

  it("scopes run assignments to the organization like the rest of execution", () => {
    expect(migration).toMatch(/create table public\.run_executor_assignments[\s\S]*?organization_id uuid not null references public\.organizations\(id\)/);
    expect(migration).toMatch(/create policy run_executor_assignments_insert[\s\S]*?with check \(public\.is_platform_staff\(\)\)/);
  });

  it("keeps raw executor assignments staff-only at the database boundary", () => {
    // Assignment rows expose which agent ran, its authority envelope, and internal
    // AI/tool cost. Customers manage outcomes, not the AI workforce, so this must
    // not be readable by organization members — not merely hidden by the ops UI.
    expect(migration).toMatch(/create policy run_executor_assignments_select[\s\S]*?using \(public\.is_platform_staff\(\)\)/);
    const selectPolicy = migration.slice(
      migration.indexOf("create policy run_executor_assignments_select"),
      migration.indexOf("create policy run_executor_assignments_insert"),
    );
    expect(selectPolicy).not.toMatch(/my_org_ids/);
  });

  it("keeps the executor roster itself staff-only too", () => {
    const selectPolicy = migration.slice(
      migration.indexOf("create policy executor_profiles_select"),
      migration.indexOf("create policy executor_profiles_insert"),
    );
    expect(selectPolicy).not.toMatch(/my_org_ids/);
  });

  it("reuses evidence_artifacts instead of creating a parallel evidence store", () => {
    expect(migration).not.toMatch(/create table public\.catalog_evidence_packets/);
    expect(migration).not.toMatch(/create table public\.catalog_evidence_reviews/);
    expect(migration).toMatch(/references public\.evidence_artifacts\(id\)/);
  });

  it("refuses to let an AI worker own the verification gate", () => {
    expect(migration).toMatch(/The validate phase requires a deterministic executor/);
  });

  it("freezes assignment identity, the authority snapshot, and recorded output", () => {
    expect(migration).toMatch(/Executor assignment identity and frozen authority snapshot are immutable/);
    expect(migration).toMatch(/A completed or failed executor assignment is terminal/);
    expect(migration).toMatch(/output artifact cannot be replaced once recorded/);
  });

  it("requires every typed evidence artifact to carry a sha256 content hash", () => {
    for (const version of [
      "catalog-evidence-input/v1",
      "catalog-evidence-packet/v1",
      "catalog-evidence-review/v1",
      "catalog-evidence-validation/v1",
      "catalog-evidence-rejection/v1",
    ]) {
      expect(migration).toContain(version);
    }
    expect(migration).toMatch(/requires a sha256 content hash/);
    expect(migration).toMatch(/\^\[0-9a-f\]\{64\}\$/);
  });

  it("binds referenced artifacts to the same run", () => {
    expect(migration).toMatch(/input artifact must belong to the same workstream run/);
    expect(migration).toMatch(/output artifact must belong to the same workstream run/);
  });

  it("allows only one executor per phase of a run", () => {
    expect(migration).toMatch(/unique \(run_id, phase\)/);
  });
});

describe("Step 3D executor profile fixture", () => {
  it("registers the three work-cell executors", () => {
    for (const key of ["hermes-loadout-researcher-v1", "grok-loadout-reviewer-v1", "catalog-evidence-validator-v1"]) {
      expect(fixture).toContain(key);
    }
  });

  it("keeps both agent executors in shadow status and the validator deterministic", () => {
    expect(fixture).toMatch(/'hermes-loadout-researcher-v1'[\s\S]*?'agent',[\s\S]*?'researcher',\s*\n\s*'shadow'/);
    expect(fixture).toMatch(/'grok-loadout-reviewer-v1'[\s\S]*?'agent',[\s\S]*?'reviewer',\s*\n\s*'shadow'/);
    expect(fixture).toMatch(/'catalog-evidence-validator-v1'[\s\S]*?'deterministic',[\s\S]*?'validator',\s*\n\s*'active'/);
  });

  it("forbids every external and write action for both agent executors", () => {
    for (const forbidden of [
      "repository changes",
      "catalog changes",
      "external messages",
      "vendor contact",
      "purchases",
      "account creation",
      "permission changes",
      "production writes",
      "Skill creation or modification",
      "Routine creation or modification",
    ]) {
      const occurrences = fixture.split(`"${forbidden}"`).length - 1;
      expect(occurrences, `${forbidden} should be forbidden for both agent executors`).toBeGreaterThanOrEqual(2);
    }
  });

  it("forbids the reviewer from editing or trusting the packet it reviews", () => {
    expect(fixture).toContain('"modifying the Hermes evidence packet"');
    expect(fixture).toContain('"treating Hermes output as an authoritative source"');
  });

  it("forbids the deterministic validator from network access and inference", () => {
    expect(fixture).toMatch(/'\["network access", "LLM inference", "catalog writes", "external actions"\]'::jsonb/);
  });

  it("stores no credentials", () => {
    // Comments are allowed to say "no API keys or tokens"; the statements must not contain them.
    const statements = fixture.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toMatch(/api[_-]?key|secret|token|password|bearer/i);
  });

  it("is safe to re-run", () => {
    expect(fixture.split("on conflict (key) do update set").length - 1).toBe(3);
  });

  it("restores shadow status for every profile on re-run", () => {
    // Without this, a profile manually promoted out of shadow would survive a
    // re-run of the authoritative fixture.
    expect(fixture.split("status = excluded.status").length - 1).toBe(3);
  });
});
