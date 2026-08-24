-- Step 3D P0 proof: reserve_work_cell_reviewer_ref() must bind the reserved
-- Gauntlet verdict to the CONTENT of the completed validation artifact (its
-- payload.gate.hardGatePass / payload.gate.workCellVerdict), not merely to the
-- artifact's existence and schemaVersion, and to the catalog-evidence-
-- validator-v1 executor specifically, not merely "some deterministic
-- executor". Round-two hardening (20260824090000) checked identity, authority,
-- and existence; it never checked that the row being inserted agreed with what
-- the artifact actually said. This proof was run live against a disposable
-- local PostgreSQL 16 instance during the round-three review and is committed
-- here so it can be re-run whenever the trigger changes.
--
-- This is a self-contained, disposable harness: it builds a minimal stub
-- schema (not the full Step 3D migration history — no PostgREST roles, no
-- Supabase auth schema beyond a stubbed auth.uid()) so it can be run against
-- any throwaway Postgres 16+ database with nothing else pre-applied. The
-- function body below is copied verbatim from
-- supabase/migrations/20260824180000_step3d_work_cell_provenance.sql — keep
-- the two in sync; step3d-work-cell-schema.test.ts separately asserts on the
-- real migration file's text so that automated coverage cannot silently drift
-- even if this copy does.
--
-- NEVER run this against a real Supabase project (local, QA, or Production):
-- it creates its own `public.workstream_runs` / `public.gauntlet_reviews` /
-- etc. tables, which would collide with or shadow the real ones.
--
-- Usage:
--   createdb step3d_p0_proof
--   psql -d step3d_p0_proof -f supabase/qa/step3d_p0_reserved_verdict_proof.sql
--   dropdb step3d_p0_proof

\set ON_ERROR_STOP on
\pset pager off

create schema auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.is_ops_manager() returns boolean language sql stable as $$ select true $$;
create or replace function public.run_has_work_cell(p_run_id uuid) returns boolean language sql stable as $$ select true $$;

create table public.workstream_runs (id uuid primary key default gen_random_uuid(), status text);
create table public.executor_profiles (id uuid primary key default gen_random_uuid(), key text unique not null);
create table public.evidence_artifacts (id uuid primary key default gen_random_uuid(), run_id uuid, payload jsonb);
create table public.run_executor_assignments (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  executor_profile_id uuid references public.executor_profiles(id),
  phase text,
  status text,
  output_artifact_id uuid,
  created_at timestamptz not null default now()
);
create table public.gauntlet_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  reviewer_kind text,
  reviewer_ref text not null default '',
  verdict text,
  hard_gate_pass boolean
);

-- Verbatim copy of reserve_work_cell_reviewer_ref() from
-- 20260824180000_step3d_work_cell_provenance.sql.
create or replace function public.reserve_work_cell_reviewer_ref()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_work_cell boolean;
  v_validate_artifact_id uuid;
  v_validate_profile_key text;
  v_stored_hard_gate_pass boolean;
  v_stored_verdict text;
begin
  v_has_work_cell := public.run_has_work_cell(new.run_id);

  if new.reviewer_ref = 'delegation-cloud-work-cell-v1' then
    if new.reviewer_kind <> 'deterministic' or not public.is_ops_manager() then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict over a completed validation artifact';
    end if;

    select rea.output_artifact_id, ep.key
      into v_validate_artifact_id, v_validate_profile_key
    from public.run_executor_assignments rea
    join public.executor_profiles ep on ep.id = rea.executor_profile_id
    where rea.run_id = new.run_id
      and rea.phase = 'validate'
      and rea.status = 'completed'
    order by rea.created_at asc
    limit 1;

    if v_validate_artifact_id is null then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict over a completed validation artifact';
    end if;

    if v_validate_profile_key is distinct from 'catalog-evidence-validator-v1' then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the catalog-evidence-validator-v1 executor''s validation output';
    end if;

    select
      (ea.payload -> 'gate' ->> 'hardGatePass')::boolean,
      ea.payload -> 'gate' ->> 'workCellVerdict'
      into v_stored_hard_gate_pass, v_stored_verdict
    from public.evidence_artifacts ea
    where ea.id = v_validate_artifact_id
      and ea.payload ->> 'schemaVersion' = 'catalog-evidence-validation/v1';

    if v_stored_hard_gate_pass is null or v_stored_verdict is null then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict over a completed validation artifact';
    end if;

    if new.hard_gate_pass is distinct from v_stored_hard_gate_pass
       or new.verdict is distinct from v_stored_verdict then
      raise exception 'The inserted Gauntlet review disagrees with the deterministic validation artifact it claims to record (stored hardGatePass=%, workCellVerdict=%; attempted hard_gate_pass=%, verdict=%)',
        v_stored_hard_gate_pass, v_stored_verdict, new.hard_gate_pass, new.verdict;
    end if;

    return new;
  end if;

  if v_has_work_cell then
    raise exception 'This run is executed by a work cell; its single Gauntlet review is written by the deterministic work-cell verdict. Record findings in the work cell rather than as a separate review.';
  end if;
  return new;
end;
$$;

create trigger trg_reserve_work_cell_reviewer_ref before insert on public.gauntlet_reviews
  for each row execute function public.reserve_work_cell_reviewer_ref();

-- Fixtures shared by every scenario below: the real validator profile and a
-- decoy deterministic profile registered under a DIFFERENT key.
insert into public.executor_profiles (id, key) values
  ('22222222-2222-2222-2222-222222222222', 'catalog-evidence-validator-v1'),
  ('33333333-3333-3333-3333-333333333333', 'some-other-deterministic-executor-v1');

do $$
begin
  -- Scenario 1: stored validation artifact says FAILED; the attempted row
  -- claims PASSED. Must be rejected outright.
  insert into public.workstream_runs (id, status) values ('11111111-1111-1111-1111-111111111111', 'awaiting_verification');
  insert into public.evidence_artifacts (id, run_id, payload) values (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
    '{"schemaVersion":"catalog-evidence-validation/v1","gate":{"hardGatePass":false,"workCellVerdict":"failed"}}'::jsonb
  );
  insert into public.run_executor_assignments (run_id, executor_profile_id, phase, status, output_artifact_id)
  values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'validate', 'completed', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

  begin
    insert into public.gauntlet_reviews (run_id, reviewer_kind, reviewer_ref, verdict, hard_gate_pass)
    values ('11111111-1111-1111-1111-111111111111', 'deterministic', 'delegation-cloud-work-cell-v1', 'passed', true);
    raise exception 'PROOF FAILED: stored validation=failed did not block an attempted row claiming passed';
  exception when others then
    if sqlerrm not like 'The inserted Gauntlet review disagrees%' then raise; end if;
    raise notice 'OK: stored validation=failed rejects an attempted row claiming passed';
  end;
end $$;

do $$
begin
  -- Scenario 2: stored validation artifact says PASSED; the attempted row
  -- matches exactly. Must be accepted.
  insert into public.workstream_runs (id, status) values ('44444444-4444-4444-4444-444444444444', 'awaiting_verification');
  insert into public.evidence_artifacts (id, run_id, payload) values (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444',
    '{"schemaVersion":"catalog-evidence-validation/v1","gate":{"hardGatePass":true,"workCellVerdict":"passed"}}'::jsonb
  );
  insert into public.run_executor_assignments (run_id, executor_profile_id, phase, status, output_artifact_id)
  values ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'validate', 'completed', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

  insert into public.gauntlet_reviews (run_id, reviewer_kind, reviewer_ref, verdict, hard_gate_pass)
  values ('44444444-4444-4444-4444-444444444444', 'deterministic', 'delegation-cloud-work-cell-v1', 'passed', true);

  if (select count(*) from public.gauntlet_reviews where run_id = '44444444-4444-4444-4444-444444444444') <> 1 then
    raise exception 'PROOF FAILED: a matching passed row over a passed validation artifact was not accepted';
  end if;
  raise notice 'OK: stored validation=passed accepts a matching attempted row';
end $$;

do $$
begin
  -- Scenario 3: the validate assignment was completed by a deterministic
  -- executor OTHER than catalog-evidence-validator-v1. Must be rejected even
  -- though the row content agrees with the artifact.
  insert into public.workstream_runs (id, status) values ('55555555-5555-5555-5555-555555555555', 'awaiting_verification');
  insert into public.evidence_artifacts (id, run_id, payload) values (
    'cccccccc-cccc-cccc-cccc-cccccccccccc', '55555555-5555-5555-5555-555555555555',
    '{"schemaVersion":"catalog-evidence-validation/v1","gate":{"hardGatePass":true,"workCellVerdict":"passed"}}'::jsonb
  );
  insert into public.run_executor_assignments (run_id, executor_profile_id, phase, status, output_artifact_id)
  values ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'validate', 'completed', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

  begin
    insert into public.gauntlet_reviews (run_id, reviewer_kind, reviewer_ref, verdict, hard_gate_pass)
    values ('55555555-5555-5555-5555-555555555555', 'deterministic', 'delegation-cloud-work-cell-v1', 'passed', true);
    raise exception 'PROOF FAILED: a validate assignment run by a non-validator deterministic profile was accepted';
  exception when others then
    if sqlerrm not like '%reserved for the catalog-evidence-validator-v1 executor%' then raise; end if;
    raise notice 'OK: a validate assignment run by a different deterministic profile is rejected';
  end;
end $$;

do $$
begin
  -- Scenario 4: hardGatePass matches but verdict does not (a partial forgery).
  -- Must be rejected — every field is checked, not just one.
  insert into public.workstream_runs (id, status) values ('66666666-6666-6666-6666-666666666666', 'awaiting_verification');
  insert into public.evidence_artifacts (id, run_id, payload) values (
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-6666-6666-6666-666666666666',
    '{"schemaVersion":"catalog-evidence-validation/v1","gate":{"hardGatePass":true,"workCellVerdict":"passed"}}'::jsonb
  );
  insert into public.run_executor_assignments (run_id, executor_profile_id, phase, status, output_artifact_id)
  values ('66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'validate', 'completed', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

  begin
    insert into public.gauntlet_reviews (run_id, reviewer_kind, reviewer_ref, verdict, hard_gate_pass)
    values ('66666666-6666-6666-6666-666666666666', 'deterministic', 'delegation-cloud-work-cell-v1', 'failed', true);
    raise exception 'PROOF FAILED: a row with matching hard_gate_pass but a disagreeing verdict was accepted';
  exception when others then
    if sqlerrm not like 'The inserted Gauntlet review disagrees%' then raise; end if;
    raise notice 'OK: a partial mismatch (verdict disagrees even though hard_gate_pass agrees) is rejected';
  end;
end $$;

\echo 'All P0 reserved-verdict proof scenarios passed.'
