-- Execution Context enforcement proof fixture.
--
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- Automated tests read supabase/migrations/20260909180000_execution_context_enforcement_v1.sql
-- and this file together. This is not a marker-only select: each case asserts
-- the fail-closed predicate that would reject the corresponding bypass.
--
-- Usage (disposable local Postgres only, never Supabase):
--   createdb execution_context_enforcement_proof
--   psql -d execution_context_enforcement_proof -f supabase/qa/execution_context_enforcement_proof.sql
--   dropdb execution_context_enforcement_proof

\set ON_ERROR_STOP on

select 'execution_context_enforcement_v1_not_applied_to_supabase' as proof_marker;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table public.workstream_runs (
  id uuid primary key,
  organization_id uuid not null,
  delegation_spec_id uuid
);
create table public.delegation_specs (
  id uuid primary key,
  action_class text not null
);
create table public.executor_profiles (
  id uuid primary key,
  key text not null
);
create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  kind text not null,
  content_hash text not null,
  payload jsonb not null
);

-- Predicate-only stand-in for the work-cell persist gate. Keep exception text
-- aligned with 20260909180000_execution_context_enforcement_v1.sql.
create or replace function public.proof_work_cell_persist_gate(
  p_run_id uuid,
  p_phase text,
  p_executor_profile_id uuid,
  p_assignment_metadata jsonb,
  p_authority_snapshot jsonb
) returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_org_id uuid;
  v_spec_action_class text;
  v_assignment_id_ptr text;
  v_envelope_hash text;
  v_context_hash text;
  v_trace_hash text;
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
    when 'prepare_only' then 0 when 'low_risk_execution' then 1
    when 'external_execution' then 2 when 'sensitive_execution' then 3 else 99 end;
  v_assignment_rank := case
    when v_assignment_action_class is null then v_spec_rank
    when v_assignment_action_class = 'prepare_only' then 0
    when v_assignment_action_class = 'low_risk_execution' then 1
    when v_assignment_action_class = 'external_execution' then 2
    when v_assignment_action_class = 'sensitive_execution' then 3
    else 99 end;
  if v_assignment_rank > v_spec_rank then
    raise exception 'Work-cell persistence action class exceeds the Delegation Spec ceiling';
  end if;
  if not exists (
    select 1 from public.evidence_artifacts e
     where e.organization_id = v_org_id
       and e.run_id = p_run_id
       and e.kind = 'observation'
       and e.content_hash = v_trace_hash
       and e.payload->>'schemaVersion' = 'tool-invocation-trace/v1'
       and e.payload->>'assignmentId' = v_assignment_id_ptr
       and e.payload->>'envelopeHash' = v_envelope_hash
       and e.payload->>'contextHash' = v_context_hash
       and e.payload->>'productionClass' in (
         'operator_submitted', 'native_tool_execution', 'deterministic_validation_no_tools'
       )
  ) then
    raise exception 'Work-cell persistence requires a same-organization, same-run observation trace';
  end if;
  return true;
end;
$$;

create or replace function public.proof_leased_complete_gate(
  p_status text,
  p_stored_context_hash text,
  p_stored_envelope_hash text,
  p_metadata jsonb,
  p_observation jsonb,
  p_observation_hash text
) returns boolean
language plpgsql
as $$
begin
  if p_status is distinct from 'running' then
    raise exception 'Execution attempt is not running; cancelled, expired, or taken-over attempts cannot complete';
  end if;
  if p_stored_context_hash is null or p_stored_context_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Execution attempt is missing a stored context hash';
  end if;
  if p_stored_envelope_hash is null or p_stored_envelope_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Execution attempt is missing a stored envelope hash';
  end if;
  if not (p_metadata ? 'contextHash')
     or p_metadata->>'contextHash' is distinct from p_stored_context_hash then
    raise exception 'Completion requires caller metadata contextHash equal to the stored context hash';
  end if;
  if not (p_metadata ? 'envelopeHash')
     or p_metadata->>'envelopeHash' is distinct from p_stored_envelope_hash then
    raise exception 'Completion requires caller metadata envelopeHash equal to the stored envelope hash';
  end if;
  if p_observation is null
     or p_observation->>'schemaVersion' is distinct from 'tool-invocation-trace/v1'
     or p_observation->>'productionClass' is distinct from 'leased_executor_execution'
     or p_observation->>'contextHash' is distinct from p_stored_context_hash
     or p_observation->>'envelopeHash' is distinct from p_stored_envelope_hash
     or p_observation->>'assignmentId' is distinct from p_metadata->>'assignmentId'
     or p_observation_hash is distinct from p_metadata->>'traceContentHash'
     or jsonb_typeof(p_observation->'invocations') is distinct from 'array'
     or jsonb_array_length(p_observation->'invocations') = 0 then
    raise exception 'Completion requires a bound observation trace artifact for leased execution';
  end if;
  return true;
end;
$$;

do $$
declare
  v_spec uuid := '00000000-0000-4000-8000-000000000001';
  v_org uuid := '00000000-0000-4000-8000-000000000002';
  v_run uuid := '00000000-0000-4000-8000-000000000003';
  v_profile uuid := '00000000-0000-4000-8000-000000000004';
  v_hash text := repeat('a', 64);
  v_other text := repeat('b', 64);
  v_ok boolean;
begin
  insert into public.delegation_specs(id, action_class) values (v_spec, 'prepare_only');
  insert into public.workstream_runs(id, organization_id, delegation_spec_id)
  values (v_run, v_org, v_spec);
  insert into public.executor_profiles(id, key) values (v_profile, 'hermes-catalog-evidence-prepare-v1');

  begin
    perform public.proof_work_cell_persist_gate(v_run, 'prepare', v_profile, '{}'::jsonb, '{}'::jsonb);
    raise exception 'work_cell_persist_without_context_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'Missing observation trace is not an empty trace%' then
        raise exception '1. work-cell persistence without context rejected: %', sqlerrm;
      end if;
  end;

  begin
    perform public.proof_work_cell_persist_gate(
      v_run, 'prepare', v_profile,
      jsonb_build_object(
        'assignmentId', 'assign-1',
        'envelopeHash', v_hash,
        'contextHash', v_other,
        'traceContentHash', v_hash,
        'organizationId', v_org::text,
        'runId', v_run::text,
        'phase', 'prepare',
        'executorKey', 'hermes-catalog-evidence-prepare-v1',
        'capabilityKey', 'evidence_research'
      ),
      '{}'::jsonb
    );
    raise exception 'work_cell_persist_mismatched_hash_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'Work-cell persistence requires a same-organization, same-run observation trace%'
         and sqlerrm not like 'Missing observation%' then
        raise exception '2. work-cell persistence mismatched context hash rejected: %', sqlerrm;
      end if;
  end;

  begin
    perform public.proof_work_cell_persist_gate(
      v_run, 'prepare', v_profile,
      jsonb_build_object(
        'assignmentId', 'assign-1',
        'envelopeHash', v_hash,
        'contextHash', v_hash,
        'traceContentHash', v_hash,
        'organizationId', '00000000-0000-4000-8000-000000000099',
        'runId', v_run::text,
        'phase', 'prepare',
        'executorKey', 'hermes-catalog-evidence-prepare-v1',
        'capabilityKey', 'evidence_research'
      ),
      '{}'::jsonb
    );
    raise exception 'work_cell_persist_mismatched_tenant_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'Work-cell persistence organizationId does not match%' then
        raise exception '3. work-cell persistence mismatched tenant rejected: %', sqlerrm;
      end if;
  end;

  begin
    perform public.proof_leased_complete_gate('running', v_hash, v_hash, '{}'::jsonb, null, null);
    raise exception 'leased_complete_without_context_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'Completion requires caller metadata contextHash%' then
        raise exception '5. leased completion without context rejected: %', sqlerrm;
      end if;
  end;

  begin
    perform public.proof_leased_complete_gate(
      'running', v_hash, v_hash,
      jsonb_build_object(
        'contextHash', v_other, 'envelopeHash', v_hash,
        'assignmentId', 'assign-1', 'traceContentHash', v_hash
      ),
      jsonb_build_object('schemaVersion', 'tool-invocation-trace/v1'),
      v_hash
    );
    raise exception 'leased_complete_mismatched_hash_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'Completion requires caller metadata contextHash%' then
        raise exception '6. leased completion mismatched context hash rejected: %', sqlerrm;
      end if;
  end;

  begin
    perform public.proof_leased_complete_gate(
      'cancelled', v_hash, v_hash,
      jsonb_build_object(
        'contextHash', v_hash, 'envelopeHash', v_hash,
        'assignmentId', 'assign-1', 'traceContentHash', v_hash
      ),
      jsonb_build_object(
        'schemaVersion', 'tool-invocation-trace/v1',
        'productionClass', 'leased_executor_execution',
        'contextHash', v_hash, 'envelopeHash', v_hash, 'assignmentId', 'assign-1',
        'invocations', '[{"status":"allowed"}]'::jsonb
      ),
      v_hash
    );
    raise exception 'leased_complete_cancelled_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'cancelled, expired, or taken-over%' then
        raise exception '8. leased completion after cancellation rejected: %', sqlerrm;
      end if;
  end;

  begin
    perform public.proof_leased_complete_gate(
      'running', v_hash, v_hash,
      jsonb_build_object(
        'contextHash', v_hash, 'envelopeHash', v_hash,
        'assignmentId', 'assign-1', 'traceContentHash', v_hash
      ),
      jsonb_build_object(
        'schemaVersion', 'tool-invocation-trace/v1',
        'productionClass', 'leased_executor_execution',
        'contextHash', v_hash, 'envelopeHash', v_hash, 'assignmentId', 'assign-1',
        'invocations', '[]'::jsonb
      ),
      v_hash
    );
    raise exception 'leased_complete_empty_observation_should_have_failed';
  exception
    when others then
      if sqlerrm not like 'Completion requires a bound observation%' then
        raise exception '9. leased completion without valid observation rejected: %', sqlerrm;
      end if;
  end;

  insert into public.evidence_artifacts(organization_id, run_id, kind, content_hash, payload)
  values (
    v_org, v_run, 'observation', v_hash,
    jsonb_build_object(
      'schemaVersion', 'tool-invocation-trace/v1',
      'productionClass', 'operator_submitted',
      'assignmentId', 'assign-1',
      'envelopeHash', v_hash,
      'contextHash', v_hash
    )
  );
  v_ok := public.proof_work_cell_persist_gate(
    v_run, 'prepare', v_profile,
    jsonb_build_object(
      'assignmentId', 'assign-1',
      'envelopeHash', v_hash,
      'contextHash', v_hash,
      'traceContentHash', v_hash,
      'organizationId', v_org::text,
      'runId', v_run::text,
      'phase', 'prepare',
      'executorKey', 'hermes-catalog-evidence-prepare-v1',
      'capabilityKey', 'evidence_research'
    ),
    jsonb_build_object('actionClass', 'prepare_only')
  );
  if v_ok is not true then
    raise exception '13. valid prepare persist gate should pass';
  end if;
end;
$$;
