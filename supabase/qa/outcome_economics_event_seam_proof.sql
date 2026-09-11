-- Outcome economics event seam v1 checklist / model fixture.
--
-- THIS FILE IS NOT POSTGRESQL RUNTIME PROOF.
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- Toy tables and helper functions below are a MODEL FIXTURE / CATALOG CHECKLIST
-- only. They do not execute the real migration, RLS, triggers, or DEFINER RPCs.
-- Do not describe a passing run of this file as PostgreSQL verification.
--
-- Automated tests read supabase/migrations/20260911000000_outcome_economics_event_seam_v1.sql
-- and this file together. This is not a runtime pass marker.
--
-- SQL_VERIFICATION_NOT_AVAILABLE. Two-session PostgreSQL lock serialization,
-- RLS against a live role, SECURITY DEFINER writer checks, remaining formula
-- against real evidence_artifacts, and finalizer atomicity are not claimed
-- as passed. Disposable local Postgres may use the REAL-SCHEMA QUERIES
-- section as a checklist only after an explicitly authorized disposable
-- database exists. None is provided with this change.
--
-- Usage (disposable local Postgres only, never Supabase, still not claimed):
--   createdb outcome_economics_event_seam_proof
--   psql -d outcome_economics_event_seam_proof -f supabase/qa/outcome_economics_event_seam_proof.sql
--   dropdb outcome_economics_event_seam_proof

\set ON_ERROR_STOP on

select 'outcome_economics_event_seam_v1_not_applied_to_supabase' as proof_marker;
select 'SQL_VERIFICATION_NOT_AVAILABLE' as sql_verification_status;
select 'LEASED_EXECUTION_ATTEMPTS_OUT_OF_SCOPE' as leased_path;
select 'CHECKLIST_MODEL_FIXTURE_NOT_RUNTIME_PROOF' as fixture_kind;
select 'KNOWN_VECTOR_SQL_PARITY_NOT_EXECUTED' as hash_parity;

-- Expected catalog from 20260911000000_outcome_economics_event_seam_v1.sql:
--   * no new tables or remaining-counter columns
--   * evidence_artifacts schemaVersion outcome-economics-event/v1
--   * partial unique indexes on (run_id, reservationId, eventType) and
--     (run_id, idempotencyKey, eventType)
--   * no (run_id, schemaVersion) singleton
--   * no unique on assignment ID
--   * content_hash is not reservation identity
--   * RLS evidence_artifacts_insert excludes outcome-economics-event/v1
--     including platform staff
--   * trg_outcome_economics_event_writer requires current_user = postgres
--   * DEFINER writers: reserve/start/release/finalize; public execute revoked;
--     anon and service_role execute revoked; authenticated + is_ops_manager
--   * remaining = ceiling - committed - unexpired_unstarted
--     - unresolved_started_or_owner_action
--   * owner_action_required and invocation_started hold budget after TTL
--   * released/expired release budget only when invocation never started
--   * lock order: workstream_runs FOR UPDATE then run_executor_assignments
--   * complete_work_cell_phase_claim refuses unless already completed
--   * older complete overloads (uuid,text) and (uuid,text,jsonb,text) dropped
--   * fail_work_cell_phase_claim remains packet-safe
--   * complete_execution_attempt / fail_execution_attempt unchanged
--   * finalizer requires the exact durable reservation set
--   * finalizer does not merge caller binding/authority/economic metadata
--
-- Two-session expectation (unverified without PostgreSQL):
--   Session A: BEGIN; lock run; lock assignment; insert reserved 400 tool micros; COMMIT
--   Session B: BEGIN; waits on run lock; remaining sees A's reserved; second 400
--   against a 500 ceiling raises; neither session stores a mutable remaining column.

-- ---------------------------------------------------------------------------
-- MODEL FIXTURE (toy tables / helpers). Not the real schema. Not runtime proof.
-- ---------------------------------------------------------------------------

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.workstream_runs (
  id uuid primary key,
  organization_id uuid not null,
  delegation_spec_id uuid not null,
  status text not null,
  ai_cost_micros bigint not null default 0
);
create table public.delegation_specs (
  id uuid primary key,
  economic_envelope jsonb not null default '{}'::jsonb
);
create table public.run_executor_assignments (
  id uuid primary key,
  organization_id uuid not null,
  run_id uuid not null,
  phase text not null,
  status text not null,
  output_artifact_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ai_cost_micros bigint not null default 0
);
create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  kind text not null,
  summary text not null default '',
  source_uri text,
  content_hash text,
  payload jsonb not null,
  created_by uuid
);

create or replace function public.proof_outcome_economics_remaining(
  p_ceiling_ai bigint,
  p_ceiling_tool bigint,
  p_committed_ai bigint,
  p_committed_tool bigint,
  p_open_ai bigint,
  p_open_tool bigint
) returns boolean
language plpgsql
as $$
begin
  if p_ceiling_ai is not null and p_ceiling_ai - p_committed_ai - p_open_ai < 0 then
    raise exception 'Economics reservation would exceed the AI cost ceiling';
  end if;
  if p_ceiling_tool is not null and p_ceiling_tool - p_committed_tool - p_open_tool < 0 then
    raise exception 'Economics reservation would exceed the tool cost ceiling';
  end if;
  return true;
end;
$$;

create or replace function public.proof_lock_order_comment()
returns text
language sql
as $$
  select 'workstream_runs FOR UPDATE then run_executor_assignments FOR UPDATE';
$$;

create or replace function public.proof_old_complete_refuses_without_finalizer()
returns boolean
language plpgsql
as $$
begin
  raise exception 'Work-cell phase claim completion requires committed economics events from finalize_work_cell_phase_economics. Packet presence is not economics proof';
end;
$$;

-- Predicate model: two reservations of 400 against a 500 tool ceiling cannot both succeed.
do $proof$
begin
  perform public.proof_outcome_economics_remaining(1000, 500, 0, 0, 0, 400);
  begin
    perform public.proof_outcome_economics_remaining(1000, 500, 0, 0, 0, 800);
    raise exception 'QA_PROOF_FAILED: overspend remaining was accepted';
  exception when others then
    if sqlerrm like 'QA_PROOF_FAILED:%' then raise; end if;
    if sqlerrm not like '%exceed the tool cost ceiling%' then raise; end if;
  end;
end;
$proof$;

-- Predicate model: old complete path cannot succeed from packet presence.
do $proof$
begin
  begin
    perform public.proof_old_complete_refuses_without_finalizer();
    raise exception 'QA_PROOF_FAILED: old complete path succeeded';
  exception when others then
    if sqlerrm like 'QA_PROOF_FAILED:%' then raise; end if;
    if sqlerrm not like '%finalize_work_cell_phase_economics%' then raise; end if;
  end;
end;
$proof$;

-- Predicate model: invocation_started cannot silently become released.
do $proof$
begin
  begin
    raise exception 'invocation_started cannot be silently released; owner_action_required is required';
  exception when others then
    if sqlerrm not like '%cannot be silently released%' then raise; end if;
  end;
end;
$proof$;

-- Predicate model: remaining holds owner_action and started after TTL.
-- remaining = ceiling - committed - unexpired_unstarted - unresolved_started_or_owner_action
do $proof$
begin
  -- ceiling 500, committed 0, unexpired unstarted 0, unresolved owner_action 40 => remaining 460
  if 500 - 0 - 0 - 40 <> 460 then
    raise exception 'QA_PROOF_FAILED: owner_action remaining model';
  end if;
  -- started after TTL still holds
  if 500 - 0 - 0 - 25 <> 475 then
    raise exception 'QA_PROOF_FAILED: started-after-TTL remaining model';
  end if;
end;
$proof$;

select public.proof_lock_order_comment() as lock_order;
select 'Maps are not the durable ledger; SQL remaining is authority' as maps_status;
select 'complete_execution_attempt and fail_execution_attempt are not required to supply reservation IDs in this slice' as leased_exclusion;
select 'These toy helpers are not PostgreSQL runtime proof' as fixture_disclaimer;

-- ---------------------------------------------------------------------------
-- REAL-SCHEMA CHECKLIST QUERIES
-- Copy against an authorized disposable database that has the real
-- migration applied. Do not claim these passed. SQL_VERIFICATION_NOT_AVAILABLE.
--
-- Function security / search_path:
--   select n.nspname, p.proname, p.prosecdef, p.proconfig
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where p.proname in (
--      'reserve_outcome_economics_event',
--      'start_outcome_economics_invocation',
--      'release_outcome_economics_event',
--      'finalize_work_cell_phase_economics',
--      'outcome_economics_event_append',
--      'complete_work_cell_phase_claim',
--      'fail_work_cell_phase_claim'
--    );
--
-- Grants:
--   select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE')
--     from pg_proc p, pg_roles r
--    where p.proname in (
--      'reserve_outcome_economics_event',
--      'start_outcome_economics_invocation',
--      'release_outcome_economics_event',
--      'finalize_work_cell_phase_economics',
--      'outcome_economics_event_append',
--      'complete_work_cell_phase_claim'
--    )
--      and r.rolname in ('anon', 'authenticated', 'service_role', 'public');
--
-- RLS predicates:
--   select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
--     from pg_policy
--    where polrelid = 'public.evidence_artifacts'::regclass;
--
-- Reserved-schema trigger:
--   select tgname, pg_get_triggerdef(oid)
--     from pg_trigger
--    where tgrelid = 'public.evidence_artifacts'::regclass
--      and tgname = 'trg_outcome_economics_event_writer';
--
-- Partial unique indexes:
--   select indexname, indexdef from pg_indexes
--    where indexname like 'outcome_economics_event%';
--
-- Remaining formula (comments + body of outcome_economics_remaining_for_run):
--   select pg_get_functiondef('public.outcome_economics_remaining_for_run(uuid)'::regprocedure);
--
-- Finalizer exact set / unresolved invocation / owner-action:
--   select pg_get_functiondef('public.finalize_work_cell_phase_economics(uuid,text,text,text,text,text,text,text,text,text[],text,jsonb)'::regprocedure);
--
-- Known vector (SQL hash of the same canonical packet JSON TS hashes).
-- Expected TS digest:
--   38a58241805c654c82ff21f6c91a5304bdc11ba3e0ebdaadddee973f115231f3
--   select public.outcome_economics_event_canonical_sha256(
--     '{"executorKey":"delegation-cloud-public-web-researcher-v1","runId":"run-econ-hash-vector","schemaVersion":"catalog-evidence-packet/v1"}'::jsonb
--   );
-- Do not claim parity unless that SELECT actually ran on PostgreSQL.
-- ---------------------------------------------------------------------------
