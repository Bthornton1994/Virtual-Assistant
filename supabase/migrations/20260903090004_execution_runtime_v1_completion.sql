-- Execution Runtime v1 completion RPC.
-- The schema, claim, and heartbeat RPCs are installed by prior migrations.
create or replace function public.complete_execution_attempt(
  p_attempt_id uuid,
  p_worker_id text,
  p_lease_token_hash text,
  p_output_artifact_ids jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_human_minutes numeric default 0,
  p_ai_cost_micros bigint default 0,
  p_tool_cost_micros bigint default 0
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_output_artifact_ids is null or jsonb_typeof(p_output_artifact_ids) <> 'array' then raise exception 'Output artifact ids must be an array'; end if;
  if p_human_minutes < 0 or p_ai_cost_micros < 0 or p_tool_cost_micros < 0 then raise exception 'Execution costs must be non-negative'; end if;
  select * into v_attempt from public.execution_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'running' then raise exception 'Execution attempt is not running'; end if;
  if v_attempt.worker_id is distinct from p_worker_id or v_attempt.lease_token_hash is distinct from p_lease_token_hash then raise exception 'Execution lease credential mismatch'; end if;
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
  if exists (
    select 1 from jsonb_array_elements_text(p_output_artifact_ids) artifact(id)
    left join public.evidence_artifacts e on e.id = artifact.id::uuid
    where e.id is null or e.organization_id is distinct from v_attempt.organization_id or e.run_id is distinct from v_attempt.run_id
  ) then raise exception 'Output artifacts must belong to the same organization and Workstream Run'; end if;

  update public.execution_attempts
     set status = 'succeeded', output_artifact_ids = p_output_artifact_ids,
         metadata = coalesce(p_metadata, '{}'::jsonb), human_minutes = p_human_minutes,
         ai_cost_micros = p_ai_cost_micros, tool_cost_micros = p_tool_cost_micros,
         completed_at = now()
   where id = p_attempt_id;
  update public.execution_plan_steps
     set status = 'succeeded', output_artifact_ids = p_output_artifact_ids,
         lease_worker_id = null, lease_expires_at = null, completed_at = now()
   where id = v_attempt.step_id;
  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_attempt.organization_id, v_attempt.plan_id, v_attempt.step_id, p_attempt_id,
          'attempt_succeeded', 'worker', p_worker_id,
          jsonb_build_object('outputArtifactIds', p_output_artifact_ids));
  perform public.refresh_execution_plan_queue(v_attempt.plan_id);
  return p_attempt_id;
end;
$$;

revoke all on function public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint) from public, anon, authenticated;
grant execute on function public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint) to service_role;
