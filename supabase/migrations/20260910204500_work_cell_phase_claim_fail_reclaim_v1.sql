-- Work-cell phase claim fail / reclaim / complete v1
--
-- REPLACE/ADD FUNCTIONS ONLY. No new tables or columns. Uses existing
-- run_executor_assignments status, metadata, created_at, completed_at.
-- Fail and reclaim only transition running -> failed. They do not insert
-- a second assignment and therefore cannot start a second fetch.
-- Complete only transitions running -> completed when output evidence exists.
--
-- SQL_VERIFICATION_NOT_AVAILABLE: do not apply this file to a live
-- Delegation Cloud database from this change.

create or replace function public.fail_work_cell_phase_claim(
  p_run_id uuid,
  p_phase text,
  p_reason text,
  p_stale_only boolean default false,
  p_ttl_ms integer default 120000
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.run_executor_assignments%rowtype;
  v_ttl interval;
begin
  if p_ttl_ms is null or p_ttl_ms < 0 then
    raise exception 'Work-cell claim reclaim TTL must be a non-negative duration';
  end if;
  v_ttl := make_interval(secs => p_ttl_ms / 1000.0);

  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if not found then
    return;
  end if;
  if v_existing.status in ('completed', 'failed') then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status <> 'running' then
    raise exception 'The % phase of this run already has a recorded attempt (status: %)', p_phase, v_existing.status;
  end if;
  if p_stale_only and v_existing.created_at >= (now() - v_ttl) then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;

  update public.run_executor_assignments
     set status = 'failed',
         completed_at = coalesce(completed_at, now()),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'claimFailure', jsonb_build_object(
             'schemaVersion', 'work-cell-phase-claim-fail/v1',
             'reason', p_reason,
             'failedAt', now(),
             'reclaimedWithoutFetch', p_stale_only
           )
         )
   where id = v_existing.id
     and status = 'running'
   returning id, status into assignment_id, assignment_status;
  if assignment_id is not null then
    return next;
  end if;
end;
$$;

create or replace function public.complete_work_cell_phase_claim(
  p_run_id uuid,
  p_phase text
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.run_executor_assignments%rowtype;
begin
  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if not found or v_existing.status <> 'running' or v_existing.output_artifact_id is null then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;

  update public.run_executor_assignments
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('economicsCommit', 'complete')
   where id = v_existing.id
     and status = 'running'
   returning id, status into assignment_id, assignment_status;
  if assignment_id is not null then
    return next;
  end if;
end;
$$;

revoke all on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer) from public;
revoke execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer) from anon;
grant execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer) to authenticated, service_role;

revoke all on function public.complete_work_cell_phase_claim(uuid, text) from public;
revoke execute on function public.complete_work_cell_phase_claim(uuid, text) from anon;
grant execute on function public.complete_work_cell_phase_claim(uuid, text) to authenticated, service_role;
