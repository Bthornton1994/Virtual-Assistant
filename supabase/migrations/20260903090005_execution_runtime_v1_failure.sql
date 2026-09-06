-- Execution Runtime v1 failure RPC.
-- The schema and worker lifecycle RPCs are installed by prior migrations.
create or replace function public.fail_execution_attempt(
  p_attempt_id uuid,
  p_worker_id text,
  p_lease_token_hash text,
  p_failure_class text,
  p_failure_code text,
  p_failure_summary text,
  p_metadata jsonb default '{}'::jsonb,
  p_human_minutes numeric default 0,
  p_ai_cost_micros bigint default 0,
  p_tool_cost_micros bigint default 0,
  p_allow_expired boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
  v_step_deadline timestamptz;
  v_max_attempts integer;
  v_failure_class text;
  v_retry_decision text;
  v_should_retry boolean := false;
  v_terminal_status text := 'blocked';
  v_delay_seconds integer := 0;
  v_event_type text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_human_minutes < 0 or p_ai_cost_micros < 0 or p_tool_cost_micros < 0 then raise exception 'Execution costs must be non-negative'; end if;
  select * into v_attempt from public.execution_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'running' then raise exception 'Execution attempt is not running'; end if;
  if v_attempt.worker_id is distinct from p_worker_id or v_attempt.lease_token_hash is distinct from p_lease_token_hash then raise exception 'Execution lease credential mismatch'; end if;
  if v_attempt.lease_expires_at <= now() and not p_allow_expired then raise exception 'Execution lease expired'; end if;
  select deadline_at, max_attempts into v_step_deadline, v_max_attempts
    from public.execution_plan_steps where id = v_attempt.step_id;

  v_failure_class := case when p_failure_class in (
    'bad_input', 'executor_failure', 'evidence_failure', 'qa_failure',
    'integration_failure', 'source_ambiguity', 'authority_limit', 'policy_conflict',
    'business_strategy_failure', 'cost_limit', 'security_incident',
    'external_dependency', 'unknown'
  ) then p_failure_class else 'unknown' end;

  if v_step_deadline <= now() then
    v_failure_class := 'cost_limit';
    v_retry_decision := 'escalate_human';
  elsif v_failure_class = 'security_incident' then
    v_retry_decision := 'suspend_workstream';
  elsif v_failure_class in ('authority_limit', 'policy_conflict', 'source_ambiguity', 'cost_limit') then
    v_retry_decision := 'escalate_human';
  elsif v_failure_class = 'business_strategy_failure' then
    v_retry_decision := 'replan';
  elsif v_failure_class = 'bad_input' and v_attempt.attempt_number < v_max_attempts then
    v_retry_decision := 'correct_inputs_then_retry'; v_should_retry := true;
  elsif v_failure_class in ('qa_failure', 'evidence_failure') and v_attempt.attempt_number < v_max_attempts then
    v_retry_decision := 'retry_different_executor'; v_should_retry := true;
  elsif v_failure_class in ('executor_failure', 'integration_failure', 'external_dependency') and v_attempt.attempt_number < v_max_attempts then
    v_retry_decision := 'retry_same_executor'; v_should_retry := true;
  elsif v_failure_class in ('bad_input', 'qa_failure', 'evidence_failure', 'executor_failure', 'integration_failure', 'external_dependency') then
    v_retry_decision := 'no_retry'; v_terminal_status := 'failed';
  else
    v_retry_decision := 'escalate_human';
  end if;

  -- A security incident is a workstream-wide stop signal, not a local retry.
  -- The existing run state has no paused value, so failed is the terminal
  -- fail-closed state. Claiming also requires a running Workstream Run.
  if v_failure_class = 'security_incident' then
    update public.workstream_runs
       set status = 'failed', completed_at = now(),
           notes = left(concat_ws(' ', notes, 'Execution Runtime stopped this run after a security incident.'), 4000)
     where id = v_attempt.run_id and status = 'running';
  end if;

  if v_should_retry then
    v_delay_seconds := least(900, power(2::numeric, least(v_attempt.attempt_number - 1, 20))::integer);
    v_event_type := 'retry_scheduled';
  else
    v_event_type := case when p_allow_expired then 'attempt_expired' else 'attempt_failed' end;
  end if;

  update public.execution_attempts
     set status = case when p_allow_expired then 'expired' else 'failed' end,
         failure_class = v_failure_class, failure_code = nullif(p_failure_code, ''),
         failure_summary = coalesce(p_failure_summary, ''), retry_decision = v_retry_decision,
         metadata = coalesce(p_metadata, '{}'::jsonb), human_minutes = p_human_minutes,
         ai_cost_micros = p_ai_cost_micros, tool_cost_micros = p_tool_cost_micros,
         completed_at = now()
   where id = p_attempt_id;

  update public.execution_plan_steps
     set status = case when v_should_retry then 'ready' else v_terminal_status end,
         available_at = case when v_should_retry then now() + make_interval(secs => v_delay_seconds) else available_at end,
         lease_worker_id = null, lease_expires_at = null,
         last_failure_class = v_failure_class, last_failure_code = nullif(p_failure_code, ''),
         last_failure_summary = coalesce(p_failure_summary, ''),
         completed_at = case when v_should_retry then null else now() end
   where id = v_attempt.step_id;

  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_attempt.organization_id, v_attempt.plan_id, v_attempt.step_id, p_attempt_id,
          v_event_type, case when p_allow_expired then 'system' else 'worker' end, p_worker_id,
          jsonb_build_object('failureClass', v_failure_class, 'retryDecision', v_retry_decision,
            'shouldRetry', v_should_retry, 'delaySeconds', v_delay_seconds,
            'failureCode', p_failure_code, 'failureSummary', p_failure_summary));
  perform public.refresh_execution_plan_queue(v_attempt.plan_id);
  return p_attempt_id;
end;
$$;

revoke all on function public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean) to service_role;
