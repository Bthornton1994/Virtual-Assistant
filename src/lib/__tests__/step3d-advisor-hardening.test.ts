import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260824190000_step3d_work_cell_advisor_hardening.sql",
  ),
  "utf8",
);

describe("Step 3D QA-discovered advisor hardening", () => {
  it("keeps run_has_work_cell RLS-aware instead of SECURITY DEFINER", () => {
    expect(migration).toMatch(
      /create or replace function public\.run_has_work_cell\(p_run_id uuid\)[\s\S]*?security invoker/i,
    );
    expect(migration).not.toMatch(
      /create or replace function public\.run_has_work_cell\(p_run_id uuid\)[\s\S]*?security definer/i,
    );
  });

  it("removes anonymous execution from both Step 3D RPC surfaces", () => {
    expect(migration).toMatch(
      /revoke execute on function public\.run_has_work_cell\(uuid\) from anon/i,
    );
    expect(migration).toMatch(
      /revoke execute on function public\.record_work_cell_phase_artifact\([\s\S]*?\) from anon/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.run_has_work_cell\(uuid\) to authenticated, service_role/i,
    );
  });

  it("covers the created_by foreign key introduced by run executor assignments", () => {
    expect(migration).toMatch(
      /create index if not exists run_executor_assignments_created_by_idx[\s\S]*?on public\.run_executor_assignments \(created_by\)/i,
    );
  });
});
