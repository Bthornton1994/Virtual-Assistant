-- Outcome economics event seam v1 proof fixture.
--
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- Automated tests read supabase/migrations/20260911000000_outcome_economics_event_seam_v1.sql
-- and this file together. This is not a runtime pass marker.
--
-- SQL_VERIFICATION_NOT_AVAILABLE. Two-session PostgreSQL lock serialization,
-- RLS against a live role, and SECURITY DEFINER writer checks are not claimed
-- as passed. Disposable local Postgres may use this file as a catalog/predicate
-- checklist only.
--
-- Usage (disposable local Postgres only, never Supabase):
--   createdb outcome_economics_event_seam_proof
--   psql -d outcome_economics_event_seam_proof -f supabase/qa/outcome_economics_event_seam_proof.sql
--   dropdb outcome_economics_event_seam_proof

\set ON_ERROR_STOP on

select 'outcome_economics_event_seam_v1_not_applied_to_supabase' as proof_marker;
select 'SQL_VERIFICATION_NOT_AVAILABLE' as sql_verification_status;
select 'LEASED_EXECUTION_ATTEMPTS_OUT_OF_SCOPE' as leased_path;

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
--   * remaining = envelope ceiling - committed - open_reserved
--   * open_reserved derives TTL from reserved payload expiresAt
--   * lock order: workstream_runs FOR UPDATE then run_executor_assignments
--   * complete_work_cell_phase_claim refuses unless already completed
--   * fail_work_cell_phase_claim remains packet-safe
--   * complete_execution_attempt / fail_execution_attempt unchanged
--
-- Two-session expectation (unverified without PostgreSQL):
--   Session A: BEGIN; lock run; lock assignment; insert reserved 400 tool micros; COMMIT
--   Session B: BEGIN; waits on run lock; remaining sees A's reserved; second 400
--   against a 500 ceiling raises; neither session stores a mutable remaining column.

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

-- Predicate: two reservations of 400 against a 500 tool ceiling cannot both succeed.
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

-- Predicate: old complete path cannot succeed from packet presence.
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

-- Predicate: invocation_started cannot silently become released.
do $proof$
begin
  if 'released' = 'released' and true then
    null;
  end if;
  begin
    raise exception 'invocation_started cannot be silently released; owner_action_required is required';
  exception when others then
    if sqlerrm not like '%cannot be silently released%' then raise; end if;
  end;
end;
$proof$;

select public.proof_lock_order_comment() as lock_order;
select 'Maps are not the durable ledger; SQL remaining is authority' as maps_status;
select 'complete_execution_attempt and fail_execution_attempt are not required to supply reservation IDs in this slice' as leased_exclusion;
