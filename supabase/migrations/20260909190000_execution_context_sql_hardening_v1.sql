-- Execution Context SQL hardening v1
--
-- REPLACE FUNCTIONS / GRANTS / TRIGGER ONLY. No new tables or columns.
-- Stacked on 20260909180000_execution_context_enforcement_v1.sql.
--
-- Finding 1 fallback: SQL does NOT recompute canonicalJsonStringify + sha256.
-- Live Postgres was not available to prove Node/SQL hash parity. A 64-hex
-- content_hash that matches a pointer is not proof the payload hashed to it.
-- Unsupported direct authenticated observation INSERTs fail closed.
-- persist_tool_invocation_observation is the approved write path.
--
-- Finding 2 fallback: assignmentId must be a 64-hex frozen digest, not a
-- persistence UUID or arbitrary string. Exact stableWorkCellAssignmentId
-- derivation stays on TypeScript persistPhaseArtifact.
--
-- Finding 3: claim/complete/fail remain service_role-only. Canonical
-- execution-step identity stays on server bindClaimedStep.
-- p_allow_expired is preserved for the service-role reaper. Authenticated
-- callers cannot invoke fail_execution_attempt or set that flag.
--
-- Delegation Spec remains the authority ceiling. No receipt/Gauntlet change.

create or replace function public.tool_invocation_trace_struct_valid(p_payload jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_class text;
  v_inv jsonb;
  v_out jsonb;
  v_status text;
  v_result text;
  v_allowed integer := 0;
  v_ids text[] := '{}';
  v_out_ids text[] := '{}';
  v_key text;
  v_inv_keys text[] := array[
    'schemaVersion', 'invocationId', 'contextHash', 'toolClass', 'toolKey',
    'status', 'invokedAt', 'completedAt', 'failureCode'
  ];
  v_out_keys text[] := array['invocationId', 'result'];
  v_top_keys text[] := array[
    'schemaVersion', 'productionClass', 'assignmentId', 'envelopeHash',
    'contextHash', 'dcExecutedTools', 'externalAgentToolUse', 'invocations',
    'outcomes'
  ];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;
  if p_payload ? 'workerId' or p_payload ? 'leaseToken'
     or p_payload ? 'leaseTokenHash' or p_payload ? 'tokenHash'
     or p_payload ? 'secret' or p_payload ? 'password' or p_payload ? 'apiKey' then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_payload)
  loop
    if not (v_key = any (v_top_keys)) then
      return false;
    end if;
  end loop;
  if p_payload->>'schemaVersion' is distinct from 'tool-invocation-trace/v1' then
    return false;
  end if;
  v_class := p_payload->>'productionClass';
  if v_class not in (
    'operator_submitted',
    'native_tool_execution',
    'leased_executor_execution',
    'deterministic_validation_no_tools'
  ) then
    return false;
  end if;
  if p_payload->>'assignmentId' is null or p_payload->>'assignmentId' !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if p_payload->>'envelopeHash' is null or p_payload->>'envelopeHash' !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if p_payload->>'contextHash' is null or p_payload->>'contextHash' !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  if jsonb_typeof(p_payload->'dcExecutedTools') is distinct from 'boolean' then
    return false;
  end if;
  if p_payload->>'externalAgentToolUse' not in ('unknown', 'not_applicable') then
    return false;
  end if;
  if jsonb_typeof(p_payload->'invocations') is distinct from 'array'
     or jsonb_typeof(p_payload->'outcomes') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_payload->'invocations') is distinct from jsonb_array_length(p_payload->'outcomes') then
    return false;
  end if;
  if v_class in ('operator_submitted', 'deterministic_validation_no_tools') then
    if jsonb_array_length(p_payload->'invocations') <> 0 then
      return false;
    end if;
    if p_payload->>'dcExecutedTools' is distinct from 'false' then
      return false;
    end if;
  end if;
  if v_class = 'operator_submitted' and p_payload->>'externalAgentToolUse' is distinct from 'unknown' then
    return false;
  end if;
  if v_class = 'deterministic_validation_no_tools'
     and p_payload->>'externalAgentToolUse' is distinct from 'not_applicable' then
    return false;
  end if;
  if v_class = 'leased_executor_execution' and jsonb_array_length(p_payload->'invocations') = 0 then
    return false;
  end if;

  for v_inv in select value from jsonb_array_elements(p_payload->'invocations')
  loop
    if jsonb_typeof(v_inv) <> 'object' then
      return false;
    end if;
    if v_inv ? 'workerId' or v_inv ? 'leaseToken' or v_inv ? 'leaseTokenHash' or v_inv ? 'tokenHash' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_inv)
    loop
      if not (v_key = any (v_inv_keys)) then
        return false;
      end if;
    end loop;
    if v_inv->>'schemaVersion' is distinct from 'execution-context/v1' then
      return false;
    end if;
    if v_inv->>'invocationId' is null or length(btrim(v_inv->>'invocationId')) = 0 then
      return false;
    end if;
    if v_inv->>'invocationId' is distinct from btrim(v_inv->>'invocationId') then
      return false;
    end if;
    if v_inv->>'contextHash' is distinct from p_payload->>'contextHash'
       or v_inv->>'contextHash' !~ '^[0-9a-f]{64}$' then
      return false;
    end if;
    if v_inv->>'toolClass' not in (
      'public_read', 'artifact_read', 'artifact_write', 'deterministic_validation',
      'repository_read', 'repository_change_prepare', 'external_message_draft',
      'external_message_send', 'sensitive_action', 'credential_use'
    ) then
      return false;
    end if;
    if v_class = 'deterministic_validation_no_tools'
       and v_inv->>'toolClass' in (
         'public_read', 'external_message_draft', 'external_message_send',
         'sensitive_action', 'credential_use'
       ) then
      return false;
    end if;
    if v_inv->>'toolKey' is null or length(btrim(v_inv->>'toolKey')) = 0 then
      return false;
    end if;
    v_status := v_inv->>'status';
    if v_status not in ('allowed', 'blocked') then
      return false;
    end if;
    if v_inv->>'invokedAt' is null or length(v_inv->>'invokedAt') = 0 then
      return false;
    end if;
    if v_status = 'allowed' and v_inv->>'failureCode' is not null then
      return false;
    end if;
    if v_status = 'blocked' and v_inv->>'failureCode' is distinct from 'tool_class_not_authorized' then
      return false;
    end if;
    if v_inv->>'invocationId' = any (v_ids) then
      return false;
    end if;
    v_ids := array_append(v_ids, v_inv->>'invocationId');
    if v_status = 'allowed' then
      v_allowed := v_allowed + 1;
    end if;
  end loop;

  for v_out in select value from jsonb_array_elements(p_payload->'outcomes')
  loop
    if jsonb_typeof(v_out) <> 'object' then
      return false;
    end if;
    for v_key in select jsonb_object_keys(v_out)
    loop
      if not (v_key = any (v_out_keys)) then
        return false;
      end if;
    end loop;
    if v_out->>'invocationId' is null or not (v_out->>'invocationId' = any (v_ids)) then
      return false;
    end if;
    if v_out->>'invocationId' = any (v_out_ids) then
      return false;
    end if;
    v_out_ids := array_append(v_out_ids, v_out->>'invocationId');
    v_result := v_out->>'result';
    if v_result not in ('fetched', 'fetch_failed', 'blocked_preflight', 'not_applicable') then
      return false;
    end if;
    select inv into v_inv
      from jsonb_array_elements(p_payload->'invocations') inv
     where inv->>'invocationId' = v_out->>'invocationId'
     limit 1;
    v_status := v_inv->>'status';
    if v_status = 'blocked' and v_result is distinct from 'blocked_preflight' then
      return false;
    end if;
    if v_status = 'allowed' and v_result in ('blocked_preflight', 'not_applicable') then
      return false;
    end if;
    if v_result = 'fetch_failed' and v_status is distinct from 'allowed' then
      return false;
    end if;
  end loop;

  if (p_payload->>'dcExecutedTools' = 'true') is distinct from (v_allowed > 0) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.assert_tool_invocation_trace_struct(p_payload jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.tool_invocation_trace_struct_valid(p_payload) then
    raise exception 'Observation payload failed the tool-invocation-trace/v1 structural contract';
  end if;
end;
$$;

create or replace function public.work_cell_capability_allowed_for_phase(
  p_phase text,
  p_capability_key text
)
returns boolean
language sql
security invoker
set search_path = public
immutable
as $$
  select
    p_capability_key is not null
    and (
      (p_phase = 'prepare' and p_capability_key in (
        'evidence_research', 'public_web_retrieval', 'supplier_sourcing'
      ))
      or (p_phase = 'review' and p_capability_key in (
        'independent_evidence_review', 'supplier_sourcing'
      ))
      or (p_phase = 'validate' and p_capability_key in (
        'deterministic_catalog_validation', 'deterministic_supplier_sourcing_validation'
      ))
    );
$$;

create or replace function public.executor_profile_owns_active_capability(
  p_executor_profile_id uuid,
  p_capability_key text
)
returns boolean
language sql
security invoker
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.executor_capabilities ec
      join public.capabilities c on c.id = ec.capability_id
     where ec.executor_profile_id = p_executor_profile_id
       and c.key = p_capability_key
       and c.status = 'active'
       and ec.qualification_status = 'qualified'
       and ec.suspended_at is null
  );
$$;

-- Approved observation write path. Does not hash the payload.
-- Sets a transaction-local GUC so the insert trigger can distinguish this
-- helper from unsupported direct authenticated INSERTs.
create or replace function public.persist_tool_invocation_observation(
  p_organization_id uuid,
  p_run_id uuid,
  p_summary text,
  p_content_hash text,
  p_payload jsonb,
  p_created_by uuid
)
returns table (artifact_id uuid, content_hash text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_existing_hash text;
begin
  if current_user = 'anon' then
    raise exception 'Observation persist is not granted to anonymous callers';
  end if;
  if current_user <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Observation persist requires an authenticated actor';
    end if;
    if p_created_by is distinct from auth.uid() then
      raise exception 'Observation persist created_by must match the authenticated caller';
    end if;
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Observation content_hash must be a 64-character lowercase hex digest';
  end if;
  perform public.assert_tool_invocation_trace_struct(p_payload);
  if not exists (
    select 1 from public.workstream_runs wr
     where wr.id = p_run_id and wr.organization_id = p_organization_id
  ) then
    raise exception 'Observation persist run does not match the organization';
  end if;

  select e.id, e.content_hash
    into v_existing_id, v_existing_hash
    from public.evidence_artifacts e
   where e.organization_id = p_organization_id
     and e.run_id = p_run_id
     and e.kind = 'observation'
     and e.payload->>'schemaVersion' = 'tool-invocation-trace/v1'
     and e.payload->>'assignmentId' = p_payload->>'assignmentId'
   order by e.created_at
   limit 1;
  if v_existing_id is not null then
    if v_existing_hash is distinct from p_content_hash then
      raise exception 'A second observation for this frozen assignment identity would insert. Observation traces are insert-only and idempotent.';
    end if;
    return query select v_existing_id, v_existing_hash;
    return;
  end if;

  perform set_config('delegation.observation_persist_approved', '1', true);
  return query
    insert into public.evidence_artifacts (
      organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
    ) values (
      p_organization_id, p_run_id, 'observation',
      coalesce(nullif(p_summary, ''), 'Tool invocation observation trace v1.'),
      null, p_content_hash, p_payload, p_created_by
    )
    returning evidence_artifacts.id, evidence_artifacts.content_hash;
end;
$$;

create or replace function public.enforce_tool_invocation_trace_observation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.kind is distinct from 'observation'
     or coalesce(new.payload->>'schemaVersion', '') is distinct from 'tool-invocation-trace/v1' then
    return new;
  end if;
  if current_user = 'anon' then
    raise exception 'Anonymous callers cannot insert tool-invocation-trace/v1 observations'
      using errcode = '42501';
  end if;
  if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Observation content_hash must be a 64-character lowercase hex digest'
      using errcode = '23514';
  end if;
  if new.created_by is null and current_user <> 'service_role' then
    raise exception 'Observation traces require an authenticated creator'
      using errcode = '23514';
  end if;
  perform public.assert_tool_invocation_trace_struct(new.payload);
  -- SQL does not recompute the canonical hash. Structural validity + digest
  -- shape are required. Hash-to-payload binding stays on the TS persist helper.
  if current_user <> 'service_role'
     and current_setting('delegation.observation_persist_approved', true) is distinct from '1' then
    raise exception 'Unsupported direct authenticated observation insertion is fail-closed. Use persist_tool_invocation_observation.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tool_invocation_trace_observation on public.evidence_artifacts;
create trigger trg_tool_invocation_trace_observation
  before insert on public.evidence_artifacts
  for each row execute function public.enforce_tool_invocation_trace_observation();

revoke all on function public.tool_invocation_trace_struct_valid(jsonb) from public, anon;
revoke all on function public.assert_tool_invocation_trace_struct(jsonb) from public, anon;
revoke all on function public.work_cell_capability_allowed_for_phase(text, text) from public, anon;
revoke all on function public.executor_profile_owns_active_capability(uuid, text) from public, anon;
revoke all on function public.persist_tool_invocation_observation(uuid, uuid, text, text, jsonb, uuid) from public, anon;
revoke all on function public.enforce_tool_invocation_trace_observation() from public, anon;

grant execute on function public.tool_invocation_trace_struct_valid(jsonb) to authenticated, service_role;
grant execute on function public.assert_tool_invocation_trace_struct(jsonb) to authenticated, service_role;
grant execute on function public.work_cell_capability_allowed_for_phase(text, text) to authenticated, service_role;
grant execute on function public.executor_profile_owns_active_capability(uuid, text) to authenticated, service_role;
grant execute on function public.persist_tool_invocation_observation(uuid, uuid, text, text, jsonb, uuid) to authenticated, service_role;

-- Claim remains service-role-only. Hashes are not independently derived here.
-- Canonical execution-step identity stays on server bindClaimedStep.
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
security invoker
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
  v_envelope_hash text;
  v_metadata jsonb;
  v_observation public.evidence_artifacts%rowtype;
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
  if not (v_metadata ? 'assignmentId')
     or v_metadata->>'assignmentId' is null
     or v_metadata->>'assignmentId' !~ '^[0-9a-f]{64}$' then
    raise exception 'Completion requires caller metadata assignmentId matching the frozen execution-step assignment digest, not a persistence UUID';
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

  select e.* into v_observation
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
   limit 1;
  if not found then
    raise exception 'Completion requires a bound observation trace artifact for leased execution';
  end if;
  perform public.assert_tool_invocation_trace_struct(v_observation.payload);
  if not public.tool_invocation_trace_struct_valid(v_observation.payload)
     or jsonb_array_length(v_observation.payload->'invocations') = 0 then
    raise exception 'Completion requires a bound observation trace artifact for leased execution';
  end if;

  -- Stored hashes are never overwritten. Success does not issue an Outcome
  -- Receipt and does not mark the Workstream Run verified.
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

-- fail_execution_attempt keeps p_allow_expired for the service-role reaper.
-- Ordinary authenticated callers cannot execute this function and therefore
-- cannot set p_allow_expired. Do not document this as "No p_allow_expired".
revoke all on function public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean) to service_role;

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
security invoker
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
  v_profile_key text;
  v_capability_key text;
  v_assignment_action_class text;
  v_spec_rank integer;
  v_assignment_rank integer;
  v_observation public.evidence_artifacts%rowtype;
  v_owns_state text;
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
     or p_assignment_metadata ? 'tokenHash'
     or p_assignment_metadata ? 'secret'
     or p_assignment_metadata ? 'password'
     or p_assignment_metadata ? 'apiKey' then
    raise exception 'Work-cell persistence must not invent worker, lease, token, or secret fields';
  end if;
  if p_authority_snapshot ? 'workerId'
     or p_authority_snapshot ? 'leaseToken'
     or p_authority_snapshot ? 'leaseTokenHash'
     or p_authority_snapshot ? 'tokenHash'
     or p_authority_snapshot ? 'secret'
     or p_authority_snapshot ? 'password'
     or p_authority_snapshot ? 'apiKey'
     or (jsonb_typeof(p_authority_snapshot->'authorityEnvelope') = 'object'
         and (
           p_authority_snapshot->'authorityEnvelope' ? 'workerId'
           or p_authority_snapshot->'authorityEnvelope' ? 'leaseToken'
           or p_authority_snapshot->'authorityEnvelope' ? 'leaseTokenHash'
           or p_authority_snapshot->'authorityEnvelope' ? 'tokenHash'
         )) then
    raise exception 'Work-cell persistence must not invent worker, lease, token, or secret fields';
  end if;

  v_assignment_id_ptr := p_assignment_metadata->>'assignmentId';
  v_envelope_hash := p_assignment_metadata->>'envelopeHash';
  v_context_hash := p_assignment_metadata->>'contextHash';
  v_trace_hash := p_assignment_metadata->>'traceContentHash';
  if v_assignment_id_ptr is null
     or v_assignment_id_ptr ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_assignment_id_ptr !~ '^[0-9a-f]{64}$'
     or v_envelope_hash is null or v_envelope_hash !~ '^[0-9a-f]{64}$'
     or v_context_hash is null or v_context_hash !~ '^[0-9a-f]{64}$'
     or v_trace_hash is null or v_trace_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Work-cell assignmentId must be the frozen 64-hex digest from stableWorkCellAssignmentId, not a persistence UUID or arbitrary string. Missing observation trace is not an empty trace.';
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
  v_capability_key := nullif(p_assignment_metadata->>'capabilityKey', '');
  if v_capability_key is null then
    raise exception 'Work-cell persistence capabilityKey does not match the assigned capability';
  end if;
  if not public.work_cell_capability_allowed_for_phase(p_phase, v_capability_key) then
    raise exception 'Work-cell persistence capabilityKey is not valid for this phase';
  end if;
  if not public.executor_profile_owns_active_capability(p_executor_profile_id, v_capability_key) then
    raise exception 'Work-cell persistence capabilityKey is not an active qualified capability of the assigned executor';
  end if;

  v_owns_state := coalesce(
    p_authority_snapshot->>'mayOwnAuthoritativeState',
    p_authority_snapshot->'authorityEnvelope'->>'mayOwnAuthoritativeState',
    'false'
  );
  if v_owns_state is distinct from 'false' then
    raise exception 'Work-cell persistence mayOwnAuthoritativeState must remain false';
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

  select e.* into v_observation
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
   order by e.created_at
   limit 1;
  if not found then
    raise exception 'Work-cell persistence requires a same-organization, same-run observation trace';
  end if;
  perform public.assert_tool_invocation_trace_struct(v_observation.payload);
  if current_user <> 'service_role' and v_observation.created_by is distinct from auth.uid() then
    raise exception 'Work-cell persistence can only consume an observation created by the authenticated caller';
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
