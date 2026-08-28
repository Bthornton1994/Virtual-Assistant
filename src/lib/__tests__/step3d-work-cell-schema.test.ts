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
    // Manager authority: is_platform_staff() admits a plain operator, and every
    // work-cell function that stages a cell is manager-only.
    expect(migration).toMatch(/create policy run_executor_assignments_insert[\s\S]*?with check \(public\.is_ops_manager\(\)\)/);
    expect(migration).toMatch(/create policy run_executor_assignments_update[\s\S]*?using \(public\.is_ops_manager\(\)\)/);
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
    expect(hardening).toMatch(/v_has_work_cell := public\.run_has_work_cell\(new\.run_id\)/);
    expect(hardening).toMatch(/gr\.reviewer_kind = 'deterministic' and gr\.reviewer_ref = 'delegation-cloud-work-cell-v1'/);
    expect(hardening).toMatch(/A work-cell run cannot pass without the deterministic work-cell hard-gate review/);
  });

  it("defines one shared work-cell predicate keyed beyond success-only rows", () => {
    // Assignment rows exist only when an executor SUCCEEDED. Keying solely on
    // them made every guard read a rejected work cell as "not a work-cell run".
    expect(hardening).toMatch(/create or replace function public\.run_has_work_cell/);
    expect(hardening).toMatch(/'catalog-evidence-input\/v1', 'catalog-evidence-packet\/v1'/);
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
    expect(hardening).toMatch(/if v_has_work_cell then/);
  });

  it("still reserves the work-cell reference against impersonation", () => {
    expect(hardening).toMatch(/is reserved for the deterministic work-cell verdict/);
  });

  it("leaves runs without a work cell on the original manual-review behavior", () => {
    const fn = hardening.slice(hardening.indexOf("function public.reserve_work_cell_reviewer_ref"));
    expect(fn).toMatch(/v_has_work_cell/);
    // The squat guard is conditional on the run actually having a work cell.
    expect(fn).toMatch(/if v_has_work_cell then/);
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

  it("does not let the refusal guard fail open on a null count", () => {
    // `if (count)` would read a null exact-count as "no work cell" and skip the
    // check. A guard whose job is to refuse must not fail in the allow direction.
    const guard = gauntlet.slice(
      gauntlet.indexOf("if (!input.workCellVerdict)"),
      gauntlet.indexOf("Record findings in the work cell rather than as a separate review"),
    );
    expect(guard).not.toMatch(/count: "exact"/);
    expect(guard).toMatch(/await runHasWorkCell\(db, runId\)/);
  });

  it("uses one shared predicate in app and database so they cannot drift", () => {
    const primitives = readFileSync(resolve(process.cwd(), "src/lib/execution-primitives.ts"), "utf8");
    expect(primitives).toMatch(/export async function runHasWorkCell/);
    expect(primitives).toMatch(/catalog-evidence-input\/v1", "catalog-evidence-packet\/v1/);
    expect(primitives).toMatch(/Mirrors public\.run_has_work_cell in SQL/);
  });

  it("marks the work cell's own verdict as exempt", () => {
    expect(workCell).toMatch(/workCellVerdict: true/);
  });
});

describe("Step 3D submit-before-validate guard", () => {
  const primitives = readFileSync(resolve(process.cwd(), "src/lib/execution-primitives.ts"), "utf8");
  const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
  const runPage = readFileSync(resolve(process.cwd(), "src/app/(ops)/ops/execution/runs/[id]/page.tsx"), "utf8");
  const component = readFileSync(resolve(process.cwd(), "src/components/work-cell.tsx"), "utf8");

  // Reserving the slot for the deterministic verdict creates a trap unless the
  // half-built state is unreachable: validation only runs while the run is
  // 'running', and awaiting_verification is terminal in that direction. One
  // premature submit would otherwise strand the attempt with no way to fill it.
  it("blocks running -> awaiting_verification on an unvalidated work cell in the database", () => {
    expect(hardening).toMatch(/create or replace function public\.require_work_cell_validation_before_submit/);
    expect(hardening).toMatch(/create trigger trg_require_work_cell_validation_before_submit/);
    expect(hardening).toMatch(/Run deterministic work-cell validation before submitting it for verification/);
  });

  it("requires the validation artifact, not merely a validate assignment", () => {
    const fn = hardening.slice(hardening.indexOf("function public.require_work_cell_validation_before_submit"));
    expect(fn).toMatch(/rea\.phase = 'validate'/);
    expect(fn).toMatch(/rea\.status = 'completed'/);
    expect(fn).toMatch(/catalog-evidence-validation\/v1/);
  });

  it("mirrors the guard in transitionWorkstreamRun", () => {
    expect(primitives).toMatch(/to === "awaiting_verification" \|\| to === "verified"/);
    expect(primitives).toMatch(/await runHasWorkCell\(db, run\.id\)/);
    expect(primitives).toMatch(/to === "awaiting_verification" && workCellRun/);
    expect(primitives).toMatch(/Run deterministic work-cell validation before submitting it for verification/);
  });

  it("withholds the submit card until validation has run", () => {
    expect(runPage).toMatch(/submitBlockedByWorkCell/);
    expect(runPage).toMatch(/run\.status === "running" && !submitBlockedByWorkCell/);
  });

  it("gates the verdict control on completed validation, not on merely having a work cell", () => {
    expect(component).toMatch(/const validationComplete = assignments\.some/);
    expect(component).toMatch(/awaitingVerification && manager && cycleId && validationComplete/);
    expect(component).not.toMatch(/cycleId && hasWorkCell/);
  });

  it("runs work-cell mutations in a client transition instead of revalidatePath", () => {
    const actions = readFileSync(resolve(process.cwd(), "src/app/actions/work-cell.ts"), "utf8");
    expect(actions).not.toMatch(/revalidatePath\(/);
    expect(component).toMatch(/WorkCellActionForm/);
  });

  it("reports the real precondition instead of letting the impersonation message surface", () => {
    expect(workCell).toMatch(/Deterministic work-cell validation has not completed for this run/);
  });

  it("binds the reserved reviewer reference to the validator's actual output", () => {
    // A bare "a validate assignment exists" test was forgeable: insert the
    // assignment, then write a passing review under the reserved ref.
    const fn = hardening.slice(
      hardening.indexOf("function public.reserve_work_cell_reviewer_ref"),
      hardening.indexOf("create trigger trg_reserve_work_cell_reviewer_ref"),
    );
    expect(fn).toMatch(/catalog-evidence-validation\/v1/);
    expect(fn).toMatch(/not public\.is_ops_manager\(\)/);
    expect(fn).toMatch(/rea\.status = 'completed'/);
  });

  it("rejects an unfit executor before writing any artifact", () => {
    // persistPhaseArtifact (the atomic artifact+assignment RPC wrapper) itself
    // re-checks fitness, but the ingest function also checks before EVER
    // calling it, so an unfit profile is refused before any write is attempted.
    const ingest = workCell.slice(
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
      workCell.indexOf("export type ReviewIngestResult"),
    );
    const fitnessAt = ingest.indexOf('assertProfileFitsPhase(profile, "prepare")');
    const writeAt = ingest.indexOf("persistPhaseArtifact");
    expect(fitnessAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(fitnessAt);
  });
});

describe("Step 3D provenance hardening (round three)", () => {
  const provenance = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260824180000_step3d_work_cell_provenance.sql"),
    "utf8",
  );

  it("binds the reserved verdict to the validation artifact's own stored content, not merely its existence", () => {
    const fn = provenance.slice(provenance.indexOf("function public.reserve_work_cell_reviewer_ref"));
    expect(fn).toMatch(/payload -> 'gate' ->> 'hardGatePass'/);
    expect(fn).toMatch(/payload -> 'gate' ->> 'workCellVerdict'/);
    expect(fn).toMatch(/new\.hard_gate_pass is distinct from v_stored_hard_gate_pass/);
    expect(fn).toMatch(/new\.verdict is distinct from v_stored_verdict/);
    expect(fn).toMatch(/disagrees with the deterministic validation artifact it claims to record/);
  });

  it("requires the validate assignment's executor to be catalog-evidence-validator-v1 specifically, not merely deterministic", () => {
    expect(provenance).toMatch(/v_validate_profile_key is distinct from 'catalog-evidence-validator-v1'/);
    expect(provenance).toMatch(/join public\.executor_profiles ep on ep\.id = rea\.executor_profile_id/);
  });

  it("redefines the function in place rather than declaring a new trigger", () => {
    // CREATE OR REPLACE FUNCTION preserves the function's identity, so the
    // existing trg_reserve_work_cell_reviewer_ref trigger (created in
    // 20260824090000) picks up this body with no new CREATE TRIGGER needed —
    // and none should appear here, or Postgres would reject it as a duplicate.
    expect(provenance).not.toMatch(/create trigger trg_reserve_work_cell_reviewer_ref/);
  });

  it("makes phase persistence atomic via one RPC covering both inserts", () => {
    expect(provenance).toMatch(/create or replace function public\.record_work_cell_phase_artifact/);
    expect(provenance).toMatch(/insert into public\.evidence_artifacts/);
    expect(provenance).toMatch(/insert into public\.run_executor_assignments/);
    expect(provenance).toMatch(/returning id into v_artifact_id/);
    expect(provenance).toMatch(/returning id into v_assignment_id/);
    // No explicit "security definer" clause in the function's own signature —
    // the surrounding comment discusses the concept, so scope the check to the
    // signature/body, not the whole file — meaning it runs as the caller and
    // RLS plus every existing insert trigger on both tables still apply.
    const fn = provenance.slice(
      provenance.indexOf("create or replace function public.record_work_cell_phase_artifact"),
      provenance.indexOf("revoke all on function public.record_work_cell_phase_artifact"),
    );
    expect(fn.toLowerCase()).not.toMatch(/security definer/);
  });

  it("locks down execute on the RPC to authenticated callers only", () => {
    expect(provenance).toMatch(/revoke all on function public\.record_work_cell_phase_artifact from public/);
    expect(provenance).toMatch(/grant execute on function public\.record_work_cell_phase_artifact to authenticated/);
  });
});

describe("Step 3D P0 reserved-verdict proof script", () => {
  const proof = readFileSync(
    resolve(process.cwd(), "supabase/qa/step3d_p0_reserved_verdict_proof.sql"),
    "utf8",
  );

  it("proves stored=failed rejects an attempted passed row, and stored=passed accepts a matching row", () => {
    expect(proof).toMatch(/stored validation=failed rejects an attempted row claiming passed/);
    expect(proof).toMatch(/stored validation=passed accepts a matching attempted row/);
    expect(proof).toMatch(/"hardGatePass":false,"workCellVerdict":"failed"/);
    expect(proof).toMatch(/"hardGatePass":true,"workCellVerdict":"passed"/);
  });

  it("keeps the embedded function copy in sync with the shipped migration's function name", () => {
    expect(proof).toContain("create or replace function public.reserve_work_cell_reviewer_ref()");
  });
});

describe("Step 3D final validation binds each phase to its completed assignment", () => {
  const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");

  it("always validates against the frozen manifest's executor keys, never a conditional assignment lookup", () => {
    const compute = workCell.slice(
      workCell.indexOf("async function computeValidationReport"),
      workCell.indexOf("export async function runWorkCellValidation"),
    );
    expect(compute).toMatch(/expectedExecutorKey: manifest\.prepareExecutorKey/);
    expect(compute).toMatch(/expectedReviewerKey: manifest\.reviewExecutorKey/);
    expect(compute).not.toMatch(/preparedBy\?\.key/);
    expect(compute).not.toMatch(/reviewedBy\?\.key/);
  });

  it("refuses an accepted packet or review with no matching completed assignment", () => {
    expect(workCell).toMatch(/async function describeAssignmentBindingFailure/);
    expect(workCell).toMatch(/No completed \$\{expected\.phase\} executor assignment is bound to this run/);
  });

  it("wires the prepare binding check into hard failure and hardGatePass=false, keyed to the packet artifact id", () => {
    const compute = workCell.slice(
      workCell.indexOf("async function computeValidationReport"),
      workCell.indexOf("export async function runWorkCellValidation"),
    );
    expect(compute).toMatch(/const prepareBindingFailure = await describeAssignmentBindingFailure\(db, prepareAssignment, \{/);
    expect(compute).toMatch(/expectedOutputArtifactId: String\(packetRow\.id\)/);
    expect(compute).toMatch(/packetResult\.hardFailures\.push\(prepareBindingFailure\)/);
    expect(compute).toMatch(/packetResult\.hardGatePass = false/);
  });

  it("wires the review binding check into hard failure and hardGatePass=false, keyed to both the packet and review artifact ids", () => {
    const compute = workCell.slice(
      workCell.indexOf("async function computeValidationReport"),
      workCell.indexOf("export async function runWorkCellValidation"),
    );
    expect(compute).toMatch(/const reviewBindingFailure = await describeAssignmentBindingFailure\(db, reviewAssignment, \{/);
    expect(compute).toMatch(/expectedInputArtifactId: String\(packetRow\.id\)/);
    expect(compute).toMatch(/expectedOutputArtifactId: String\(reviewRow\.id\)/);
    expect(compute).toMatch(/reviewResult\.hardFailures\.push\(reviewBindingFailure\)/);
  });

  it("requires the validate assignment recording the verdict to belong to the registered validator", () => {
    const record = workCell.slice(workCell.indexOf("export async function recordWorkCellGauntletReviews"));
    expect(record).toMatch(/validateProfile\.key !== VALIDATOR_EXECUTOR_KEY/);
    expect(record).toMatch(/validationRow\.id\) !== validateAssignment\.outputArtifactId/);
  });
});

describe("Step 3D rejected executor output becomes a failed, cost-bearing assignment", () => {
  const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");

  it("records a failed assignment bound to the rejection artifact, carrying its cost, not just the artifact", () => {
    const fn = workCell.slice(
      workCell.indexOf("async function recordRejectedExecutorOutput"),
      workCell.indexOf("// --- Frozen input manifest"),
    );
    expect(fn).toMatch(/assignmentStatus: "failed"/);
    expect(fn).toMatch(/persistPhaseArtifact/);
    expect(fn).toMatch(/humanMinutes: input\.humanMinutes/);
    expect(fn).toMatch(/aiCostMicros: input\.aiCostMicros/);
    expect(fn).toMatch(/toolCostMicros: input\.toolCostMicros/);
  });

  it("threads human/AI/tool cost from both ingest call sites into the rejection path", () => {
    const packetIngest = workCell.slice(
      workCell.indexOf("export async function ingestCatalogEvidencePacket"),
      workCell.indexOf("export type ReviewIngestResult"),
    );
    const reviewIngest = workCell.slice(workCell.indexOf("export async function ingestCatalogEvidenceReview"));
    for (const fn of [packetIngest, reviewIngest]) {
      const rejectionCalls = fn.split("recordRejectedExecutorOutput(db, actor, run, {").length - 1;
      expect(rejectionCalls).toBeGreaterThanOrEqual(2);
      expect(fn).toMatch(/recordRejectedExecutorOutput\(db, actor, run, \{[\s\S]*?humanMinutes: input\.humanMinutes,/);
    }
  });

  it("relies on the (run_id, phase) unique constraint to block a same-attempt retry", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260823120000_step3d_work_cell.sql"), "utf8");
    expect(migration).toMatch(/unique\s*\(run_id,\s*phase\)/);
  });
});

describe("Step 3D frozen input manifest freezes actual records and self-verifies on load", () => {
  const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
  const input = readFileSync(resolve(process.cwd(), "src/lib/catalog-evidence-input.ts"), "utf8");

  it("requires a frozen input record per expected product, covered by the hash", () => {
    expect(input).toMatch(/inputRecords: z\.array\(catalogEvidenceInputRecordSchema\)\.min\(1\)/);
    expect(input).toMatch(/is missing a frozen input record for expected product/);
    expect(input).toMatch(/freezes input record\(s\) for product ID\(s\) not in the expected batch/);
    expect(input).toMatch(/inputRecords: \[\.\.\.manifest\.inputRecords\]/);
  });

  it("verifies the manifest belongs to this run and its artifact content hash on load", () => {
    const fn = workCell.slice(workCell.indexOf("async function loadInputManifest"), workCell.indexOf("async function requireInputManifest"));
    expect(fn).toMatch(/result\.manifest\.runId !== runId/);
    expect(fn).toMatch(/checkPayloadHash\(row\.payload, String\(row\.content_hash/);
  });
});
