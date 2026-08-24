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

const hardening = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824090000_step3d_work_cell_hardening.sql"),
  "utf8",
);

describe("Step 3D hardening migration", () => {
  it("stops the evidence trigger from discarding a caller-supplied content hash", () => {
    // The original trigger unconditionally overwrote content_hash, which would
    // have made the canonical packet hash unreproducible and failed every cell.
    expect(hardening).toMatch(/create or replace function public\.enforce_evidence_artifact_invariants/);
    expect(hardening).toMatch(/if new\.content_hash is null or new\.content_hash !~ '\^\[0-9a-f\]\{64\}\$' then/);
    // The digest must now sit inside that guard, not after it.
    const fn = hardening.slice(
      hardening.indexOf("create or replace function public.enforce_evidence_artifact_invariants"),
      hardening.indexOf("create or replace function public.require_gauntlet_review_for_receipt"),
    );
    const guardIndex = fn.indexOf("if new.content_hash is null");
    const digestIndex = fn.indexOf("extensions.digest");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(digestIndex).toBeGreaterThan(guardIndex);
  });

  it("preserves the rest of the original evidence invariants", () => {
    expect(hardening).toMatch(/Evidence artifacts are immutable/);
    expect(hardening).toMatch(/Evidence may only be appended while a run is running/);
    expect(hardening).toMatch(/Evidence organization must match its workstream run/);
    expect(hardening).toMatch(/Evidence request must belong to the same organization/);
  });

  it("requires the work cell's own review to pass a work-cell run", () => {
    // Otherwise the pre-existing manual review form could mint a passing row and
    // satisfy the receipt guard without the deterministic gate ever running.
    expect(hardening).toMatch(/run_executor_assignments rea where rea\.run_id = new\.run_id/);
    expect(hardening).toMatch(/gr\.reviewer_kind = 'deterministic' and gr\.reviewer_ref = 'delegation-cloud-work-cell-v1'/);
    expect(hardening).toMatch(/A work-cell run cannot pass without the deterministic work-cell hard-gate review/);
  });

  it("leaves non-work-cell runs on the original guard", () => {
    expect(hardening).toMatch(/not v_has_work_cell/);
    expect(hardening).toMatch(/A Gauntlet run cannot pass without an independent adversarial hard-gate review/);
  });

  it("reserves the work-cell reviewer reference against hand-entered reviews", () => {
    expect(hardening).toMatch(/reserve_work_cell_reviewer_ref/);
    expect(hardening).toMatch(/is reserved for the deterministic work-cell verdict/);
    expect(hardening).toMatch(/create trigger trg_reserve_work_cell_reviewer_ref/);
  });
});

describe("Step 3D generic-evidence-form route", () => {
  it("allows only one of each singleton typed artifact per run", () => {
    // loadTypedArtifact takes the first row by created_at, so without this a
    // planted artifact inserted first would shadow the genuine one.
    expect(hardening).toMatch(/create unique index step3d_one_typed_artifact_per_run_idx/);
    expect(hardening).toMatch(/on public\.evidence_artifacts \(run_id, \(payload->>'schemaVersion'\)\)/);
    for (const version of [
      "catalog-evidence-input/v1",
      "catalog-evidence-packet/v1",
      "catalog-evidence-review/v1",
      "catalog-evidence-validation/v1",
    ]) {
      expect(hardening).toContain(version);
    }
  });

  it("still permits repeated rejection records", () => {
    // Multiple rejected executor attempts are expected and must stay auditable.
    const index = hardening.slice(
      hardening.indexOf("create unique index step3d_one_typed_artifact_per_run_idx"),
      hardening.indexOf("-- 4b."),
    );
    expect(index).not.toMatch(/catalog-evidence-rejection/);
  });

  it("requires manager authority for any work-cell artifact whatever the code path", () => {
    // addEvidenceArtifact is open to any ops role and writes the same table.
    expect(hardening).toMatch(/enforce_step3d_artifact_authority/);
    expect(hardening).toMatch(/not public\.is_ops_manager\(\)/);
    expect(hardening).toMatch(/may only be written by an operations manager/);
    expect(hardening).toMatch(/create trigger trg_step3d_artifact_authority/);
  });
});

describe("Step 3D single review slot", () => {
  // gauntlet_one_final_review_per_run_idx allows exactly ONE review row per run,
  // and reviews are immutable with no delete path. So the slot must be reserved:
  // an ordinary human review recorded first would take it permanently, and since
  // rule 2 requires the work cell's own row to pass a work-cell run, that run
  // would become unverifiable. No malice required.
  it("reserves the single review slot on a work-cell run", () => {
    expect(hardening).toMatch(/its single Gauntlet review is written by the deterministic work-cell verdict/);
    expect(hardening).toMatch(/v_has_work_cell and new\.reviewer_ref <> 'delegation-cloud-work-cell-v1'/);
  });

  it("still reserves the work-cell reference against impersonation", () => {
    expect(hardening).toMatch(/is reserved for the deterministic work-cell verdict/);
  });

  it("leaves runs without a work cell on the original manual-review behavior", () => {
    const fn = hardening.slice(hardening.indexOf("function public.reserve_work_cell_reviewer_ref"));
    expect(fn).toMatch(/v_has_work_cell/);
    // The squat guard is conditional on the run actually having a work cell.
    expect(fn).toMatch(/if v_has_work_cell and/);
  });
});

describe("Step 3D app-layer guards match the database", () => {
  const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
  const gauntlet = readFileSync(resolve(process.cwd(), "src/lib/gauntlet.ts"), "utf8");

  it("probes for an existing review by run_id alone, matching the unique index", () => {
    // Filtering the probe by reviewer_ref would disagree with a constraint keyed
    // on run_id alone: a foreign row would be invisible and the insert would die
    // on a raw unique violation instead of reporting what happened.
    const probe = workCell.slice(
      workCell.indexOf('.from("gauntlet_reviews")'),
      workCell.indexOf("const { report } = await computeValidationReport(db, runId);"),
    );
    expect(probe).toMatch(/\.eq\("run_id", runId\)/);
    expect(probe).not.toMatch(/\.eq\("reviewer_ref"/);
  });

  it("reports a foreign review row instead of failing on a unique violation", () => {
    expect(workCell).toMatch(/already carries a Gauntlet review from/);
    expect(workCell).toMatch(/retry the work under a new attempt/);
  });

  it("refuses a manual review on a work-cell run unless it is the work cell's own", () => {
    expect(gauntlet).toMatch(/workCellVerdict\?: boolean/);
    expect(gauntlet).toMatch(/if \(!input\.workCellVerdict\)/);
    expect(gauntlet).toMatch(/from\("run_executor_assignments"\)/);
    expect(gauntlet).toMatch(/Record findings in the work cell rather than as a separate review/);
  });

  it("marks the work cell's own verdict as exempt", () => {
    expect(workCell).toMatch(/workCellVerdict: true/);
  });
});
