-- Execution Runtime v1 heartbeat RPC.
-- The schema and claim RPC are installed by prior migrations.
create or replace function public.heartbeat_execution_attempt(
  p_attempt_id uuid,
  p_worker_id text,
  p_lease_token_hash text,
  p_lease_seconds integer default 300
)
returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
  v_expires timestamptz;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'Lease must be between 30 and 3600 seconds'; end if;
  select * into v_attempt from public.execution_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'running' then raise exception 'Execution attempt is not running'; end if;
  if v_attempt.worker_id is distinct from p_worker_id or v_attempt.lease_token_hash is distinct from p_lease_token_hash then
    raise exception 'Execution lease credential mismatch';
  end if;
  if v_attempt.lease_expires_at <= now() then raise exception 'Execution lease expired'; end if;
  if not exists (select 1 from public.workstream_runs where id = v_attempt.run_id and status = 'running') then
    raise exception 'The Workstream Run is no longer running';
  end if;
  if exists (
    select 1 from public.execution_plan_steps
     where id = v_attempt.step_id and deadline_at <= now()
  ) then
    raise exception 'Execution step deadline exceeded';
  end if;
  v_expires := now() + make_interval(secs => p_lease_seconds);
  update public.execution_attempts set heartbeat_at = now(), lease_expires_at = v_expires where id = p_attempt_id;
  update public.execution_plan_steps set lease_expires_at = v_expires where id = v_attempt.step_id and status = 'running';
  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_attempt.organization_id, v_attempt.plan_id, v_attempt.step_id, p_attempt_id,
          'attempt_heartbeat', 'worker', p_worker_id, jsonb_build_object('leaseExpiresAt', v_expires));
  return v_expires;
end;
$$;

revoke all on function public.heartbeat_execution_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.heartbeat_execution_attempt(uuid, text, text, integer) to service_role;
