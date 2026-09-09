-- Execution Context enforcement v1
--
-- REPLACE FUNCTIONS ONLY. No new tables or columns. Delegation Spec remains
-- the authority ceiling. This fails closed on leased claim/complete/fail:
-- context and envelope hashes must be supplied, stored, and later matched.
-- Observation traces live in public.evidence_artifacts (kind observation).

drop function if exists public.claim_execution_step(text, text, text, integer);

create or replace function public.claim_execution_step(
  p_worker_id text,
  p_capability_key text,
  p_lease_token_hash text,
  p_context_hash text,
  p_envelope_hash text,
  p_lease_seconds integer default 300
)
returns table (
  attempt_id uuid,
  plan_id uuid,
  step_id uuid,
  run_id uuid,
  step_key text,
  capability_key text,
  action_class text,
  executor_context jsonb,
  lease_expires_at timestamptz,
  attempt_number integer
)
language plpgsql
set search_path = public
as $$
declare
  v_step public.execution_plan_steps%rowtype;
  v_plan public.execution_plans%rowtype;
  v_attempt_id uuid;
  v_expires timestamptz;
  v_attempt_number integer;
  v_executor_kind text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' then raise exception 'Invalid worker id'; end if;
  if p_capability_key is null or p_capability_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' then raise exception 'Invalid capability key'; end if;
  if p_lease_token_hash is null or p_lease_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid lease token hash'; end if;
  if p_context_hash is null or p_context_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid execution context hash'; end if;
  if p_envelope_hash is null or p_envelope_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid executor envelope hash'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'Lease must be between 30 and 3600 seconds'; end if;

  select s, ep.executor_kind into v_step, v_executor_kind
    from public.execution_plan_steps s
    join public.execution_plans p on p.id = s.plan_id
    join public.workstream_runs wr on wr.id = s.run_id and wr.status = 'running'
    join public.executor_profiles ep on ep.key = p_worker_id and ep.status = 'active'
    join public.executor_capabilities ec on ec.executor_profile_id = ep.id
       and ec.qualification_status = 'qualified' and ec.suspended_at is null
    join public.capabilities c on c.id = ec.capability_id
       and c.key = s.capability_key and c.status = 'active'
   where p.status in ('frozen', 'running')
     and s.capability_key = p_capability_key
     and s.status = 'ready'
     and s.available_at <= now()
     and s.deadline_at > now()
     and s.attempt_count < s.max_attempts
     and (not s.requires_human_approval or exists (
       select 1 from public.execution_approval_requests a where a.step_id = s.id and a.status = 'approved'
     ))
     and not exists (
       select 1 from jsonb_array_elements_text(s.depends_on) dependency(step_key)
       left join public.execution_plan_steps d
         on d.plan_id = s.plan_id and d.step_key = dependency.step_key
      where d.status is distinct from 'succeeded'
     )
   order by s.available_at, s.sequence, s.created_at, s.id
   limit 1
   for update of s skip locked;
  if not found then return; end if;

  v_attempt_number := v_step.attempt_count + 1;
  v_expires := now() + make_interval(secs => p_lease_seconds);
  update public.execution_plan_steps
     set status = 'running', attempt_count = v_attempt_number,
         lease_worker_id = p_worker_id, lease_expires_at = v_expires,
         started_at = coalesce(started_at, now())
   where id = v_step.id;

  insert into public.execution_attempts (
    organization_id, plan_id, step_id, run_id, attempt_number, status,
    worker_id, lease_token_hash, lease_expires_at, heartbeat_at,
    authority_snapshot, context_hash, executor_key, executor_kind, input_artifact_ids, started_at
  )
  select v_step.organization_id, v_step.plan_id, v_step.id, v_step.run_id,
         v_attempt_number, 'running', p_worker_id, p_lease_token_hash,
         v_expires, now(),
         jsonb_build_object(
           'actionClass', v_step.action_class,
           'dataSensitivity', v_step.data_sensitivity,
           'requiresHumanApproval', v_step.requires_human_approval,
           'externalSideEffect', v_step.external_side_effect,
           'mayOwnAuthoritativeState', false,
           'stepKey', v_step.step_key,
           'envelopeHash', p_envelope_hash
         ),
         p_context_hash,
         p_worker_id, v_executor_kind,
         v_step.input_artifact_ids, now()
  returning id into v_attempt_id;

  update public.execution_plans
     set status = 'running', started_at = coalesce(started_at, now())
   where id = v_step.plan_id and status = 'frozen';

  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_step.organization_id, v_step.plan_id, v_step.id, v_attempt_id,
          'attempt_started', 'worker', p_worker_id,
          jsonb_build_object(
            'attemptNumber', v_attempt_number,
            'leaseExpiresAt', v_expires,
            'contextHash', p_context_hash,
            'envelopeHash', p_envelope_hash
          ));

  select p.* into v_plan from public.execution_plans p where p.id = v_step.plan_id;
  return query select v_attempt_id, v_step.plan_id, v_step.id, v_step.run_id,
    v_step.step_key, v_step.capability_key, v_step.action_class,
    jsonb_build_object('planHash', v_plan.plan_hash, 'executorKey', p_worker_id,
      'executorKind', v_executor_kind, 'contextHash', p_context_hash, 'envelopeHash', p_envelope_hash,
      'authoritySnapshot',
      jsonb_build_object('actionClass', v_step.action_class,
        'dataSensitivity', v_step.data_sensitivity,
        'requiresHumanApproval', v_step.requires_human_approval,
        'externalSideEffect', v_step.external_side_effect,
        'mayOwnAuthoritativeState', false,
        'envelopeHash', p_envelope_hash)),
    v_expires, v_attempt_number;
end;
$$;

revoke all on function public.claim_execution_step(text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_execution_step(text, text, text, text, text, integer) to service_role;

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
  v_envelope_hash text;
  v_metadata jsonb;
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
  if v_attempt.context_hash is null or v_attempt.context_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Execution attempt is missing a stored context hash';
  end if;
  v_envelope_hash := v_attempt.authority_snapshot->>'envelopeHash';
  if v_envelope_hash is null or v_envelope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Execution attempt is missing a stored envelope hash';
  end if;
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  if v_metadata ? 'contextHash' and v_metadata->>'contextHash' is distinct from v_attempt.context_hash then
    raise exception 'Caller metadata contextHash does not match the stored context hash';
  end if;
  if v_metadata ? 'envelopeHash' and v_metadata->>'envelopeHash' is distinct from v_envelope_hash then
    raise exception 'Caller metadata envelopeHash does not match the stored envelope hash';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_output_artifact_ids) artifact(id)
    left join public.evidence_artifacts e on e.id = artifact.id::uuid
    where e.id is null or e.organization_id is distinct from v_attempt.organization_id or e.run_id is distinct from v_attempt.run_id
  ) then raise exception 'Output artifacts must belong to the same organization and Workstream Run'; end if;
  if not exists (
    select 1
      from jsonb_array_elements_text(p_output_artifact_ids) artifact(id)
      join public.evidence_artifacts e on e.id = artifact.id::uuid
     where e.organization_id = v_attempt.organization_id
       and e.run_id = v_attempt.run_id
       and e.kind = 'observation'
       and e.payload->>'schemaVersion' = 'tool-invocation-trace/v1'
       and e.payload->>'contextHash' = v_attempt.context_hash
       and e.payload->>'envelopeHash' = v_envelope_hash
       and e.payload->>'productionClass' = 'leased_executor_execution'
  ) then
    raise exception 'Completion requires a bound observation trace artifact for leased execution';
  end if;

  update public.execution_attempts
     set status = 'succeeded', output_artifact_ids = p_output_artifact_ids,
         metadata = v_metadata, human_minutes = p_human_minutes,
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
  v_envelope_hash text;
  v_metadata jsonb;
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
  if v_attempt.context_hash is null or v_attempt.context_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Execution attempt is missing a stored context hash';
  end if;
  v_envelope_hash := v_attempt.authority_snapshot->>'envelopeHash';
  if v_envelope_hash is null or v_envelope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Execution attempt is missing a stored envelope hash';
  end if;
  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  if v_metadata ? 'contextHash' and v_metadata->>'contextHash' is distinct from v_attempt.context_hash then
    raise exception 'Caller metadata contextHash does not match the stored context hash';
  end if;
  if v_metadata ? 'envelopeHash' and v_metadata->>'envelopeHash' is distinct from v_envelope_hash then
    raise exception 'Caller metadata envelopeHash does not match the stored envelope hash';
  end if;
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
         metadata = v_metadata, human_minutes = p_human_minutes,
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
