# Step 3D QA Qualification

Date: 2026-08-24

Environment: dedicated QA Supabase project `qbvmtgaphvpwpwemplje`

Production status: **untouched**. No Production migration, database write, environment-variable change, deployment, promotion, or executor-authority change was performed by this qualification.

## Purpose

This is the live-database qualification record for PR #14, `Step 3D: establish verified multi-executor work cell`.

The goal was not to prove the Run 4 research behavior yet. It was to prove that the Step 3D control plane survives the real hosted QA schema, existing RLS, existing Gauntlet triggers, receipt guards, and privileged/unprivileged identities before the PR is merged.

## Applied to QA

The Step 3D schema was applied in order:

1. `20260823120000_step3d_work_cell.sql`
2. `20260824090000_step3d_work_cell_hardening.sql`
3. `20260824180000_step3d_work_cell_provenance.sql`
4. `20260824190000_step3d_work_cell_advisor_hardening.sql`

The three executor profiles were registered from the QA fixture semantics:

- `hermes-loadout-researcher-v1` — `agent`, researcher, `shadow`
- `grok-loadout-reviewer-v1` — `agent`, reviewer, `shadow`
- `catalog-evidence-validator-v1` — `deterministic`, validator, `active`

The fourth migration was discovered during live QA. Supabase's security advisor identified the original `run_has_work_cell(uuid)` helper as a public `SECURITY DEFINER` RPC, and the performance advisor identified the new `run_executor_assignments.created_by` foreign key as unindexed. Live ACL inspection also showed that `record_work_cell_phase_artifact(...)` still carried an explicit anonymous EXECUTE grant despite the earlier PUBLIC revoke. The advisor-hardening migration:

- makes `run_has_work_cell(uuid)` `SECURITY INVOKER`, so RLS determines what the caller can observe;
- removes anonymous EXECUTE from `run_has_work_cell(uuid)`;
- removes anonymous EXECUTE from `record_work_cell_phase_artifact(...)`;
- retains authenticated/service-role execution for the intended paths; and
- adds `run_executor_assignments_created_by_idx`.

After that migration, the Step 3D `run_has_work_cell` advisor warning disappeared. Remaining SECURITY DEFINER advisor warnings pre-date Step 3D and are outside this PR's scope.

## Live RLS and authority checks

Using existing QA identities under PostgreSQL `authenticated` role semantics:

- an unrelated non-staff client saw **zero** executor profiles and **zero** executor assignments;
- a platform `operator` could read the internal executor roster but was rejected when attempting to insert an executor profile;
- an `ops_manager` could perform the authorized manager write;
- both agent profiles remained `shadow` after the fixture; and
- the deterministic validator remained the only active validation executor.

After the advisor hardening:

- `anon` cannot execute `run_has_work_cell(uuid)`;
- `anon` cannot execute `record_work_cell_phase_artifact(...)`;
- an unrelated non-staff client cannot infer a private work-cell run through `run_has_work_cell`;
- platform operator and ops-manager identities still recognize the work-cell run through their legitimate RLS-visible state.

## Fail-path qualification

A dedicated internal QA workstream, `QA Step 3D Control Plane`, was created so the existing Loadout proving cycle was not modified.

Attempt 1:

- Run: `d3f0b793-d6af-4874-ae67-9d67b100b950`
- Expected terminal state: `failed`
- Actual terminal state: `failed`
- Outcome Receipt: `failed`, definition of done false, QA score 100

The following conditions were exercised against the live QA database:

1. **Caller-supplied SHA-256 preservation**
   - A known 64-hex manifest hash was inserted.
   - The stored hash remained exactly the supplied hash rather than being overwritten by the generic evidence trigger.

2. **Work-cell recognition**
   - A frozen input manifest caused the run to be recognized as a work-cell run.

3. **Premature submission rejection**
   - `running -> awaiting_verification` was attempted before deterministic validation.
   - The transition was rejected and the run remained `running`.

4. **Deterministic validation ownership**
   - Hermes was deliberately submitted as the `validate` executor through the atomic phase RPC.
   - The assignment invariant rejected it because an agent cannot own the validation gate.

5. **Atomic rollback**
   - The invalid validation attempt inserted the artifact first inside the RPC transaction and then failed assignment validation.
   - No orphan artifact remained after rollback.

6. **Stored FAIL cannot be reported as PASS**
   - A real completed validation assignment was persisted with stored gate `hardGatePass=false`, `workCellVerdict=failed`.
   - A reserved Gauntlet review claiming `passed/true` was rejected.
   - A matching `failed/false` deterministic review was accepted.

7. **Manual-review slot squatting blocked**
   - A non-work-cell/manual review was attempted after submission.
   - The work-cell review-slot reservation rejected it.

8. **Outcome Receipt escape blocked**
   - A passing Outcome Receipt was attempted over the failed deterministic hard gate.
   - The existing receipt guard rejected it.
   - An honest failed receipt succeeded and terminalized the run as failed.

## Positive-path qualification

Attempt 2 was a real Gauntlet retry of Attempt 1:

- Run: `6a160358-ae72-4d08-8d8b-ffc581b2c4f8`
- Retry of: `d3f0b793-d6af-4874-ae67-9d67b100b950`
- Expected terminal state: `verified`
- Actual terminal state: `verified`
- Outcome Receipt: `passed`, definition of done true, QA score 100

The retry exercised all three phases in order:

1. `prepare` → `hermes-loadout-researcher-v1` → completed
2. `review` → `grok-loadout-reviewer-v1` → completed
3. `validate` → `catalog-evidence-validator-v1` → completed

The deterministic validation artifact carried a passing gate. The single reserved deterministic Gauntlet review matched that stored gate. The passing Outcome Receipt succeeded, the run finalized `verified`, and the Gauntlet cycle advanced to `impact_review`.

This is a database-control-plane proof, not a claim that the synthetic QA packet/review contents themselves were produced by the Run 4 agents. Run 4 remains the empirical executor-quality test.

## Failed-phase economics and retry semantics

A separate QA run exercised a rejected executor phase:

- Hermes `prepare` was persisted with assignment status `failed`.
- `human_minutes = 1.25` was preserved.
- `ai_cost_micros = 321000` was preserved.
- `tool_cost_micros = 45000` was preserved.
- A second `prepare` execution in the same Workstream Run was rejected by the unique `(run_id, phase)` invariant.
- The failed second atomic call left no orphan artifact.

This confirms that a failed executor attempt remains an auditable economic event and that a retry requires a new attempt rather than silent same-run repetition.

## Advisor status

Security advisor was run after the Step 3D migrations and again after advisor hardening.

- The Step 3D `run_has_work_cell` SECURITY DEFINER warning was removed by the fourth migration.
- Remaining security warnings are pre-existing functions/auth configuration and are not introduced by PR #14.

Performance advisor was also run.

- `run_executor_assignments.created_by` was the new Step 3D unindexed foreign key and is now covered by `run_executor_assignments_created_by_idx`.
- Existing application-wide performance warnings remain outside this PR's scope.

## Qualification conclusion

The hosted QA database has now demonstrated both the expected failure path and expected success path under real existing schema/triggers/RLS, plus failed-phase economics and retry prevention.

Remaining merge gates after this record:

1. exact-head repository verification must be green after the QA-discovered fourth migration and its regression test;
2. Preview should remain healthy;
3. PR must remain unmerged until the owner explicitly authorizes merge.

Run 4 must not begin until those merge gates are satisfied and the Step 3D branch is merged.
