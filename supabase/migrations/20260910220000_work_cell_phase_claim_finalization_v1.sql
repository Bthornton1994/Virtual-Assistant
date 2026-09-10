-- Work-cell phase claim fail / complete finalization v1
--
-- REPLACE/DROP FUNCTIONS ONLY. No new tables or columns. Uses existing
-- run_executor_assignments and evidence_artifacts.
--
-- Authoritative claim-failure and completion path. Production TypeScript
-- must call these RPCs; a direct UPDATE of assignment status is not an
-- implemented control.
--
-- Fail transitions running -> failed only when no accepted catalog packet
-- exists and no output artifact is bound. Completed rows are never failed.
-- Complete transitions running -> completed only with output evidence;
-- already-completed matching identity is idempotent; already-failed
-- cannot be completed.
--
-- Reclaim does not fetch. These functions do not INSERT a second assignment.
--
-- Process-local economics Maps are not recovered here. Isolate death after
-- a process-local commit and before complete remains OWNER_BLOCKED for
-- remaining-budget accounting. Durable remaining budget still requires
-- committed evidence_artifacts plus open reservations on existing
-- execution_attempts — not a new totals table.
--
-- SQL_VERIFICATION_NOT_AVAILABLE: do not apply this file to a live
-- Delegation Cloud database from this change.

drop function if exists public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer);
drop function if exists public.complete_work_cell_phase_claim(uuid, text);

create or replace function public.fail_work_cell_phase_claim(
  p_run_id uuid,
  p_phase text,
  p_reason text,
  p_stale_only boolean default false,
  p_ttl_ms integer default 120000,
  p_reservation_ids text[] default '{}'::text[]
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.run_executor_assignments%rowtype;
  v_ttl interval;
  v_accepted_packet boolean;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can fail a work-cell phase claim';
  end if;
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
  if v_existing.status = 'completed' then
    raise exception 'A completed work-cell phase assignment cannot be overwritten by a claim failure.';
  end if;
  if v_existing.status = 'failed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status <> 'running' then
    raise exception 'The % phase of this run already has a recorded attempt (status: %)', p_phase, v_existing.status;
  end if;

  select exists (
    select 1
      from public.evidence_artifacts e
     where e.run_id = p_run_id
       and e.payload->>'schemaVersion' = 'catalog-evidence-packet/v1'
  ) into v_accepted_packet;

  if v_accepted_packet or v_existing.output_artifact_id is not null then
    raise exception 'An accepted catalog evidence packet exists; refusing to fail the work-cell phase claim';
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
             'economicReservationIds', to_jsonb(coalesce(p_reservation_ids, '{}'::text[])),
             'reclaimedWithoutFetch', p_stale_only
           )
         )
   where id = v_existing.id
     and status = 'running'
     and output_artifact_id is null
   returning id, status into assignment_id, assignment_status;
  if assignment_id is not null then
    return next;
    return;
  end if;

  select * into v_existing
    from public.run_executor_assignments
   where id = v_existing.id;
  if v_existing.status = 'failed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status = 'completed' then
    raise exception 'A completed work-cell phase assignment cannot be overwritten by a claim failure.';
  end if;
  raise exception 'An accepted catalog evidence packet exists; refusing to fail the work-cell phase claim';
end;
$$;

create or replace function public.complete_work_cell_phase_claim(
  p_run_id uuid,
  p_phase text,
  p_metadata_patch jsonb default '{}'::jsonb,
  p_assignment_id text default null
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.run_executor_assignments%rowtype;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can complete a work-cell phase claim';
  end if;
  if p_metadata_patch is not null and jsonb_typeof(p_metadata_patch) <> 'object' then
    raise exception 'Work-cell claim completion metadata must be a JSON object';
  end if;
  if p_metadata_patch ? 'workerId'
     or p_metadata_patch ? 'leaseToken'
     or p_metadata_patch ? 'leaseTokenHash'
     or p_metadata_patch ? 'tokenHash' then
    raise exception 'Work-cell claim completion must not invent worker, lease, or token fields';
  end if;

  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if not found then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;
  if p_assignment_id is not null
     and coalesce(v_existing.metadata->>'assignmentId', '') is distinct from p_assignment_id then
    raise exception 'Work-cell phase claim identity does not match the completion request';
  end if;
  if v_existing.status = 'completed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status = 'failed' then
    raise exception 'A failed work-cell phase assignment cannot be completed.';
  end if;
  if v_existing.status <> 'running' or v_existing.output_artifact_id is null then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;

  update public.run_executor_assignments
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         metadata = coalesce(metadata, '{}'::jsonb)
           || coalesce(p_metadata_patch, '{}'::jsonb)
           || jsonb_build_object('economicsCommit', 'complete')
   where id = v_existing.id
     and status = 'running'
     and output_artifact_id is not null
   returning id, status into assignment_id, assignment_status;
  if assignment_id is not null then
    return next;
    return;
  end if;
  raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
end;
$$;

revoke all on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) from public;
revoke execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) from anon;
grant execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) to authenticated, service_role;

revoke all on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text) from public;
revoke execute on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text) from anon;
grant execute on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text) to authenticated, service_role;
