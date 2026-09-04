-- Delegation Cloud Execution Runtime v1, terminal worker RPCs
--
-- The base runtime schema and claim/completion RPCs are installed by the prior
-- migrations. This continuation contains failure, lease reaping, approval, and
-- cancellation RPCs.

revoke all on function public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint) from public, anon, authenticated;
grant execute on function public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint) to service_role;

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

create or replace function public.reap_execution_leases(p_limit integer default 100)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_attempt record;
  v_count integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'Reap limit must be between 1 and 1000'; end if;
  for v_attempt in
    select id, worker_id, lease_token_hash
      from public.execution_attempts
     where status = 'running' and lease_expires_at <= now()
     order by lease_expires_at, created_at
     limit p_limit
     for update skip locked
  loop
    perform public.fail_execution_attempt(
      v_attempt.id, v_attempt.worker_id, v_attempt.lease_token_hash,
      'external_dependency', 'lease_expired',
      'Worker lease expired before the attempt completed.', '{}'::jsonb,
      0, 0, 0, true
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reap_execution_leases(integer) from public, anon, authenticated;
grant execute on function public.reap_execution_leases(integer) to service_role;

create or replace function public.decide_execution_approval(
  p_approval_id uuid,
  p_decision text,
  p_decided_by uuid,
  p_decision_note text default ''
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_approval public.execution_approval_requests%rowtype;
  v_step public.execution_plan_steps%rowtype;
  v_event_type text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Approval decision must be approved or rejected'; end if;
  select * into v_approval from public.execution_approval_requests where id = p_approval_id for update;
  if not found or v_approval.status <> 'pending' then raise exception 'Approval request is not pending'; end if;
  select * into v_step from public.execution_plan_steps where id = v_approval.step_id for update;
  if not found or v_step.status <> 'awaiting_approval' then raise exception 'Approval step is no longer awaiting approval'; end if;

  update public.execution_approval_requests
     set status = p_decision, decided_by = p_decided_by,
         decision_note = coalesce(p_decision_note, ''), decided_at = now()
   where id = p_approval_id;
  update public.execution_plan_steps
     set status = case when p_decision = 'approved' then 'ready' else 'blocked' end,
         completed_at = case when p_decision = 'rejected' then now() else null end,
         last_failure_class = case when p_decision = 'rejected' then 'authority_limit' else null end,
         last_failure_summary = case when p_decision = 'rejected' then 'Required human approval was rejected.' else null end
   where id = v_step.id;
  v_event_type := case when p_decision = 'approved' then 'approval_approved' else 'approval_rejected' end;
  insert into public.execution_events (organization_id, plan_id, step_id, event_type, actor_kind, actor_ref, payload)
  values (v_approval.organization_id, v_approval.plan_id, v_approval.step_id,
          v_event_type, 'human', p_decided_by::text,
          jsonb_build_object('approvalId', p_approval_id, 'decisionNote', p_decision_note));
  perform public.refresh_execution_plan_queue(v_approval.plan_id);
  return p_approval_id;
end;
$$;

revoke all on function public.decide_execution_approval(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_execution_approval(uuid, text, uuid, text) to service_role;

create or replace function public.cancel_execution_plan(p_plan_id uuid, p_actor_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_plan public.execution_plans%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  select * into v_plan from public.execution_plans where id = p_plan_id for update;
  if not found then raise exception 'Execution plan not found'; end if;
  if v_plan.status in ('completed', 'failed', 'cancelled') then return; end if;
  update public.execution_attempts set status = 'cancelled', completed_at = now()
   where plan_id = p_plan_id and status in ('claimed', 'running');
  update public.execution_plan_steps
     set status = 'cancelled', lease_worker_id = null, lease_expires_at = null, completed_at = now()
   where plan_id = p_plan_id and status not in ('succeeded', 'failed', 'blocked', 'cancelled');
  update public.execution_plans set status = 'cancelled', completed_at = now() where id = p_plan_id;
  insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, actor_ref, payload)
  values (v_plan.organization_id, p_plan_id, 'plan_cancelled', 'human', p_actor_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.cancel_execution_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_execution_plan(uuid, uuid) to service_role;

