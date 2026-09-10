-- Work-cell pre-fetch claim v1
--
-- REPLACE FUNCTION ONLY. No new tables or columns. The durable pre-fetch
-- claim is an INSERT into existing run_executor_assignments; unique
-- (run_id, phase) is the atomic lock. This replaces
-- record_work_cell_phase_artifact in place so a later packet/rejection
-- persist updates a running claim instead of inserting a second assignment.
-- Operator paste ingest still inserts when no claim row exists.
--
-- SQL_VERIFICATION_NOT_AVAILABLE: do not apply this file to a live
-- Delegation Cloud database from this change.

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
  v_profile_key text;
  v_assignment_action_class text;
  v_spec_rank integer;
  v_assignment_rank integer;
  v_existing public.run_executor_assignments%rowtype;
  v_merged_metadata jsonb;
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

  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if found then
    if v_existing.status in ('completed', 'failed') then
      raise exception 'The % phase of this run already has a recorded attempt (status: %)', p_phase, v_existing.status;
    end if;
    if v_existing.status <> 'running'
       or v_existing.executor_profile_id is distinct from p_executor_profile_id
       or coalesce(v_existing.metadata->>'schemaVersion', '') is distinct from 'work-cell-phase-prefetch-claim/v1'
       or coalesce(v_existing.metadata->>'assignmentId', '') is distinct from v_assignment_id_ptr
       or coalesce(v_existing.metadata->>'envelopeHash', '') is distinct from v_envelope_hash
       or coalesce(v_existing.metadata->>'contextHash', '') is distinct from v_context_hash then
      raise exception 'The % phase of this run already has a recorded attempt (status: %)', p_phase, v_existing.status;
    end if;
    v_merged_metadata := coalesce(v_existing.metadata, '{}'::jsonb) || coalesce(p_assignment_metadata, '{}'::jsonb);
    update public.run_executor_assignments
       set status = p_assignment_status,
           output_artifact_id = v_artifact_id,
           input_artifact_id = coalesce(p_input_artifact_id, input_artifact_id),
           human_minutes = p_human_minutes,
           ai_cost_micros = p_ai_cost_micros,
           tool_cost_micros = p_tool_cost_micros,
           metadata = v_merged_metadata
     where id = v_existing.id
     returning id into v_assignment_id;
  else
    insert into public.run_executor_assignments (
      organization_id, run_id, executor_profile_id, phase, status,
      authority_snapshot, input_artifact_id, output_artifact_id,
      human_minutes, ai_cost_micros, tool_cost_micros, metadata, created_by
    ) values (
      v_org_id, p_run_id, p_executor_profile_id, p_phase, p_assignment_status,
      p_authority_snapshot, p_input_artifact_id, v_artifact_id,
      p_human_minutes, p_ai_cost_micros, p_tool_cost_micros, p_assignment_metadata, auth.uid()
    ) returning id into v_assignment_id;
  end if;

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
