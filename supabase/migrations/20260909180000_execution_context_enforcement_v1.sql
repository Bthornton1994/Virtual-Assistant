-- Execution Context enforcement v1
--
-- REPLACE FUNCTIONS ONLY. No new tables or columns. Delegation Spec remains
-- the authority ceiling. This fails closed on leased claim/complete/fail:
-- context and envelope hashes must be supplied, stored, and later matched.
-- Observation traces live in public.evidence_artifacts (kind observation).
-- record_work_cell_phase_artifact is replaced in place with the same
-- signature so a direct RPC call cannot persist without a bound observation.

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
  if not (v_metadata ? 'contextHash')
     or v_metadata->>'contextHash' is distinct from v_attempt.context_hash
     or v_metadata->>'contextHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'Completion requires caller metadata contextHash equal to the stored context hash';
  end if;
  if not (v_metadata ? 'envelopeHash')
     or v_metadata->>'envelopeHash' is distinct from v_envelope_hash
     or v_metadata->>'envelopeHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'Completion requires caller metadata envelopeHash equal to the stored envelope hash';
  end if;
  if not (v_metadata ? 'assignmentId') or nullif(v_metadata->>'assignmentId', '') is null then
    raise exception 'Completion requires caller metadata assignmentId matching the frozen execution-step assignment';
  end if;
  if not (v_metadata ? 'traceContentHash') or v_metadata->>'traceContentHash' !~ '^[0-9a-f]{64}$' then
    raise exception 'Completion requires caller metadata traceContentHash for the bound observation';
  end if;
  if exists (
    select 1 from public.execution_plan_steps s
     where s.id = v_attempt.step_id
       and s.lease_worker_id is distinct from p_worker_id
  ) then
    raise exception 'Execution attempt is not running; cancelled, expired, or taken-over attempts cannot complete';
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
       and e.content_hash = v_metadata->>'traceContentHash'
       and e.payload->>'schemaVersion' = 'tool-invocation-trace/v1'
       and e.payload->>'assignmentId' = v_metadata->>'assignmentId'
       and e.payload->>'contextHash' = v_attempt.context_hash
       and e.payload->>'envelopeHash' = v_envelope_hash
       and e.payload->>'productionClass' = 'leased_executor_execution'
       and jsonb_typeof(e.payload->'invocations') = 'array'
       and jsonb_array_length(e.payload->'invocations') > 0
       and (
         (e.payload->>'dcExecutedTools' = 'true' and exists (
           select 1 from jsonb_array_elements(e.payload->'invocations') inv
            where inv->>'status' = 'allowed'
         ))
         or
         (e.payload->>'dcExecutedTools' is distinct from 'true' and not exists (
           select 1 from jsonb_array_elements(e.payload->'invocations') inv
            where inv->>'status' = 'allowed'
         ))
       )
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

-- Work-cell paste is operator_submitted: no worker, lease, or token.
-- Lease expiry is enforced on leased complete, not on this paste ingest path.
create or replace function public.record_work_cell_phase_artifact(
  p_run_id uuid,
  p_kind text,
  p_summary text,
  p_source_uri text,
  p_content_hash text,
  p_payload jsonb,
  p_executor_profile_id uuid,
  p_phase text,
  p_assignment_status text,
  p_authority_snapshot jsonb,
  p_input_artifact_id uuid,
  p_human_minutes numeric,
  p_ai_cost_micros bigint,
  p_tool_cost_micros bigint,
  p_assignment_metadata jsonb
)
returns table (artifact_id uuid, assignment_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_org_id uuid;
  v_spec_action_class text;
  v_artifact_id uuid;
  v_assignment_id uuid;
  v_assignment_id_ptr text;
  v_envelope_hash text;
  v_context_hash text;
  v_trace_hash text;
  v_production_class text;
  v_profile_key text;
  v_assignment_action_class text;
  v_spec_rank integer;
  v_assignment_rank integer;
begin
  select wr.organization_id, ds.action_class
    into v_org_id, v_spec_action_class
    from public.workstream_runs wr
    left join public.delegation_specs ds on ds.id = wr.delegation_spec_id
   where wr.id = p_run_id;
  if v_org_id is null then
    raise exception 'Workstream run % was not found', p_run_id;
  end if;
  if v_spec_action_class is null or v_spec_action_class not in (
    'prepare_only', 'low_risk_execution', 'external_execution', 'sensitive_execution'
  ) then
    raise exception 'Work-cell persistence requires the run Delegation Spec action class';
  end if;

  if p_assignment_metadata is null or jsonb_typeof(p_assignment_metadata) <> 'object' then
    raise exception 'Work-cell persistence requires assignment metadata observation pointers';
  end if;
  if p_assignment_metadata ? 'workerId'
     or p_assignment_metadata ? 'leaseToken'
     or p_assignment_metadata ? 'leaseTokenHash'
     or p_assignment_metadata ? 'tokenHash' then
    raise exception 'Work-cell persistence must not invent worker, lease, or token fields';
  end if;

  v_assignment_id_ptr := p_assignment_metadata->>'assignmentId';
  v_envelope_hash := p_assignment_metadata->>'envelopeHash';
  v_context_hash := p_assignment_metadata->>'contextHash';
  v_trace_hash := p_assignment_metadata->>'traceContentHash';
  if v_assignment_id_ptr is null or v_assignment_id_ptr = ''
     or v_envelope_hash is null or v_envelope_hash !~ '^[0-9a-f]{64}$'
     or v_context_hash is null or v_context_hash !~ '^[0-9a-f]{64}$'
     or v_trace_hash is null or v_trace_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Missing observation trace is not an empty trace. Phase persistence requires a bound observation.';
  end if;
  if p_assignment_metadata->>'organizationId' is distinct from v_org_id::text then
    raise exception 'Work-cell persistence organizationId does not match the Workstream Run tenant';
  end if;
  if p_assignment_metadata->>'runId' is distinct from p_run_id::text then
    raise exception 'Work-cell persistence runId does not match the Workstream Run';
  end if;
  if p_assignment_metadata->>'phase' is distinct from p_phase then
    raise exception 'Work-cell persistence phase does not match the assignment phase';
  end if;

  select key into v_profile_key from public.executor_profiles where id = p_executor_profile_id;
  if v_profile_key is null then
    raise exception 'Work-cell persistence executor profile was not found';
  end if;
  if p_assignment_metadata->>'executorKey' is distinct from v_profile_key then
    raise exception 'Work-cell persistence executorKey does not match the assigned executor';
  end if;
  if nullif(p_assignment_metadata->>'capabilityKey', '') is null then
    raise exception 'Work-cell persistence capabilityKey does not match the assigned capability';
  end if;

  v_assignment_action_class := coalesce(
    p_authority_snapshot->>'actionClass',
    p_authority_snapshot->'authorityEnvelope'->>'actionClass'
  );
  v_spec_rank := case v_spec_action_class
    when 'prepare_only' then 0
    when 'low_risk_execution' then 1
    when 'external_execution' then 2
    when 'sensitive_execution' then 3
    else 99
  end;
  v_assignment_rank := case
    when v_assignment_action_class is null then v_spec_rank
    when v_assignment_action_class = 'prepare_only' then 0
    when v_assignment_action_class = 'low_risk_execution' then 1
    when v_assignment_action_class = 'external_execution' then 2
    when v_assignment_action_class = 'sensitive_execution' then 3
    else 99
  end;
  if v_assignment_rank > v_spec_rank then
    raise exception 'Work-cell persistence action class exceeds the Delegation Spec ceiling';
  end if;

  if not exists (
    select 1
      from public.evidence_artifacts e
     where e.organization_id = v_org_id
       and e.run_id = p_run_id
       and e.kind = 'observation'
       and e.content_hash = v_trace_hash
       and e.payload->>'schemaVersion' = 'tool-invocation-trace/v1'
       and e.payload->>'assignmentId' = v_assignment_id_ptr
       and e.payload->>'envelopeHash' = v_envelope_hash
       and e.payload->>'contextHash' = v_context_hash
       and e.payload->>'productionClass' in (
         'operator_submitted',
         'native_tool_execution',
         'deterministic_validation_no_tools'
       )
       and (
         (p_phase = 'prepare' and e.payload->>'productionClass' in ('operator_submitted', 'native_tool_execution'))
         or (p_phase = 'review' and e.payload->>'productionClass' = 'operator_submitted')
         or (p_phase = 'validate' and e.payload->>'productionClass' = 'deterministic_validation_no_tools')
       )
  ) then
    raise exception 'Work-cell persistence requires a same-organization, same-run observation trace';
  end if;

  insert into public.evidence_artifacts (
    organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
  ) values (
    v_org_id, p_run_id, p_kind, p_summary, p_source_uri, p_content_hash, p_payload, auth.uid()
  ) returning id into v_artifact_id;

  insert into public.run_executor_assignments (
    organization_id, run_id, executor_profile_id, phase, status,
    authority_snapshot, input_artifact_id, output_artifact_id,
    human_minutes, ai_cost_micros, tool_cost_micros, metadata, created_by
  ) values (
    v_org_id, p_run_id, p_executor_profile_id, p_phase, p_assignment_status,
    p_authority_snapshot, p_input_artifact_id, v_artifact_id,
    p_human_minutes, p_ai_cost_micros, p_tool_cost_micros, p_assignment_metadata, auth.uid()
  ) returning id into v_assignment_id;

  return query select v_artifact_id, v_assignment_id;
end;
$$;

revoke all on function public.record_work_cell_phase_artifact(
  uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid,
  numeric, bigint, bigint, jsonb
) from public;
revoke execute on function public.record_work_cell_phase_artifact(
  uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid,
  numeric, bigint, bigint, jsonb
) from anon;
grant execute on function public.record_work_cell_phase_artifact(
  uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid,
  numeric, bigint, bigint, jsonb
) to authenticated, service_role;
