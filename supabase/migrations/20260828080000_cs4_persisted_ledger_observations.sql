-- CS-4: persist attributed work-cell observations as immutable evidence.
--
-- This stores observations, not scores. The pure ledger aggregator remains the
-- only place that derives comparison metrics. A completed work cell may write
-- exactly one observation for each real prepare/review/validate assignment while
-- its run is still running; the existing evidence invariants then freeze them
-- before submission.

create unique index cs4_one_ledger_observation_per_assignment_idx
  on public.evidence_artifacts (run_id, (payload->>'assignmentId'))
  where payload->>'schemaVersion' = 'capability-performance-ledger/v1';

-- Extend the existing typed-artifact hash guard to cover CS-4 observations.
create or replace function public.enforce_typed_evidence_artifact()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  declared_version text;
begin
  declared_version := new.payload->>'schemaVersion';
  if declared_version is null then return new; end if;

  if declared_version in (
    'catalog-evidence-input/v1',
    'catalog-evidence-packet/v1',
    'catalog-evidence-review/v1',
    'catalog-evidence-validation/v1',
    'catalog-evidence-rejection/v1',
    'capability-performance-ledger/v1'
  ) then
    if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'A % artifact requires a sha256 content hash', declared_version;
    end if;
  end if;

  return new;
end;
$$;

-- The caller supplies already-validated observations. The database still binds
-- each one to this run, its real completed phase assignment, and an existing
-- source artifact hash. The operation is one transaction, so a partial ledger
-- cannot be left behind.
create or replace function public.record_work_cell_ledger_observations(
  p_run_id uuid,
  p_observations jsonb
)
returns table (artifact_id uuid, assignment_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_org_id uuid;
  v_run_status text;
  v_item jsonb;
  v_observation jsonb;
  v_phase text;
  v_content_hash text;
  v_source_hash text;
  v_assignment_id uuid;
  v_assignment_run_id uuid;
  v_assignment_phase text;
  v_assignment_status text;
  v_assignment_output_id uuid;
  v_executor_key text;
  v_artifact_id uuid;
  v_seen_phases text[] := '{}'::text[];
begin
  if not public.is_ops_manager() then
    raise exception 'Only operations managers can record capability performance observations';
  end if;

  if p_observations is null
     or jsonb_typeof(p_observations) <> 'array'
     or jsonb_array_length(p_observations) <> 3 then
    raise exception 'A work-cell ledger write requires exactly three phase observations';
  end if;

  select wr.organization_id, wr.status
    into v_org_id, v_run_status
    from public.workstream_runs wr
   where wr.id = p_run_id;

  if v_org_id is null then
    raise exception 'Workstream run % was not found', p_run_id;
  end if;
  if v_run_status <> 'running' then
    raise exception 'Capability performance observations may only be recorded while the run is running';
  end if;

  for v_item in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'observation') is distinct from 'object' then
      raise exception 'Each ledger entry must contain an observation object';
    end if;

    v_observation := v_item->'observation';
    v_phase := v_item->>'phase';
    v_content_hash := v_item->>'contentHash';
    v_source_hash := v_observation->>'sourceArtifactHash';

    if v_phase is null or v_phase not in ('prepare', 'review', 'validate') then
      raise exception 'Ledger observation phase must be prepare, review, or validate';
    end if;
    if v_phase = any(v_seen_phases) then
      raise exception 'A work-cell ledger write cannot contain duplicate phases';
    end if;
    v_seen_phases := array_append(v_seen_phases, v_phase);

    if v_observation->>'schemaVersion' is distinct from 'capability-performance-ledger/v1'
       or v_observation->>'runId' is distinct from p_run_id::text
       or v_observation->>'assignmentId' is null
       or v_observation->>'executorKey' is null
       or v_observation->>'recordedAt' is null
       or v_content_hash is null
       or v_content_hash !~ '^[0-9a-f]{64}$'
       or v_source_hash is null
       or v_source_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Ledger observation identity, provenance, and content hash are invalid';
    end if;
    if v_observation->>'status' is null
       or v_observation->>'status' not in ('completed', 'failed', 'blocked', 'inconclusive')
       or v_observation->>'hardGateResult' is null
       or v_observation->>'hardGateResult' not in ('pass', 'fail', 'not_run')
       or v_observation->>'outcomeSource' is null
       or v_observation->>'outcomeSource' not in ('deterministic_validator', 'human_qa') then
      raise exception 'Ledger observation outcome fields are invalid';
    end if;

    begin
      v_assignment_id := (v_observation->>'assignmentId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Ledger observation assignmentId must identify a persisted assignment';
    end;

    select rea.run_id, rea.phase, rea.status, rea.output_artifact_id, ep.key
      into v_assignment_run_id, v_assignment_phase, v_assignment_status,
           v_assignment_output_id, v_executor_key
      from public.run_executor_assignments rea
      join public.executor_profiles ep on ep.id = rea.executor_profile_id
     where rea.id = v_assignment_id;

    if v_assignment_run_id is null
       or v_assignment_run_id is distinct from p_run_id
       or v_assignment_phase is distinct from v_phase
       or v_assignment_status is distinct from 'completed'
       or v_assignment_output_id is null
       or v_executor_key is distinct from v_observation->>'executorKey' then
      raise exception 'Ledger observation is not bound to the real completed assignment for this run and phase';
    end if;

    if not exists (
      select 1
        from public.evidence_artifacts ea
       where ea.run_id = p_run_id
         and ea.content_hash = v_source_hash
         and ea.payload->>'schemaVersion' in (
           'catalog-evidence-packet/v1',
           'catalog-evidence-review/v1',
           'catalog-evidence-validation/v1'
         )
    ) then
      raise exception 'Ledger observation source hash is not a typed artifact in this run';
    end if;

    insert into public.evidence_artifacts (
      organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
    ) values (
      v_org_id,
      p_run_id,
      'observation',
      format('CS-4 capability performance observation for %s phase', v_phase),
      format('delegation://runs/%s/assignments/%s', p_run_id, v_assignment_id),
      v_content_hash,
      v_observation,
      auth.uid()
    )
    returning id into v_artifact_id;

    return query select v_artifact_id, v_assignment_id;
  end loop;

  if cardinality(v_seen_phases) <> 3
     or array_position(v_seen_phases, 'prepare') is null
     or array_position(v_seen_phases, 'review') is null
     or array_position(v_seen_phases, 'validate') is null then
    raise exception 'A work-cell ledger write must include prepare, review, and validate observations';
  end if;
end;
$$;

revoke all on function public.record_work_cell_ledger_observations(uuid, jsonb) from public;
revoke execute on function public.record_work_cell_ledger_observations(uuid, jsonb) from anon;
grant execute on function public.record_work_cell_ledger_observations(uuid, jsonb) to authenticated, service_role;

       or v_source_hash is null
       or v_source_hash !~ '^[0-9a-f]{64}
      raise exception 'Ledger observation identity, provenance, and content hash are invalid';
    end if;

    if v_observation->>'status' not in ('completed', 'failed', 'blocked', 'inconclusive')
       or v_observation->>'hardGateResult' not in ('pass', 'fail', 'not_run')
       or v_observation->>'outcomeSource' not in ('deterministic_validator', 'human_qa') then
      raise exception 'Ledger observation outcome fields are invalid';
    end if;

    begin
      v_assignment_id := (v_observation->>'assignmentId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Ledger observation assignmentId must identify a persisted assignment';
    end;

    select rea.run_id, rea.phase, rea.status, rea.output_artifact_id, ep.key
      into v_assignment_run_id, v_assignment_phase, v_assignment_status,
           v_assignment_output_id, v_executor_key
      from public.run_executor_assignments rea
      join public.executor_profiles ep on ep.id = rea.executor_profile_id
     where rea.id = v_assignment_id;

    if v_assignment_run_id is null
       or v_assignment_run_id is distinct from p_run_id
       or v_assignment_phase is distinct from v_phase
       or v_assignment_status <> 'completed'
       or v_assignment_output_id is null
       or v_executor_key is distinct from v_observation->>'executorKey' then
      raise exception 'Ledger observation is not bound to the real completed assignment for this run and phase';
    end if;

    if not exists (
      select 1
        from public.evidence_artifacts ea
       where ea.run_id = p_run_id
         and ea.content_hash = v_source_hash
         and ea.payload->>'schemaVersion' in (
           'catalog-evidence-packet/v1',
           'catalog-evidence-review/v1',
           'catalog-evidence-validation/v1'
         )
    ) then
      raise exception 'Ledger observation source hash is not a typed artifact in this run';
    end if;

    insert into public.evidence_artifacts (
      organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
    ) values (
      v_org_id,
      p_run_id,
      'observation',
      format('CS-4 capability performance observation for %s phase', v_phase),
      format('delegation://runs/%s/assignments/%s', p_run_id, v_assignment_id),
      v_content_hash,
      v_observation,
      auth.uid()
    )
    returning id into v_artifact_id;

    return query select v_artifact_id, v_assignment_id;
  end loop;

  if not ('prepare' = any(v_seen_phases))
     or not ('review' = any(v_seen_phases))
     or not ('validate' = any(v_seen_phases)) then
    raise exception 'A work-cell ledger write must include prepare, review, and validate observations';
  end if;
end;
$$;

revoke all on function public.record_work_cell_ledger_observations(uuid, jsonb) from public;
revoke execute on function public.record_work_cell_ledger_observations(uuid, jsonb) from anon;
grant execute on function public.record_work_cell_ledger_observations(uuid, jsonb) to authenticated, service_role;
 then
      raise exception 'Ledger observation identity, provenance, and content hash are invalid';
    end if;

    if v_observation->>'status' not in ('completed', 'failed', 'blocked', 'inconclusive')
       or v_observation->>'hardGateResult' not in ('pass', 'fail', 'not_run')
       or v_observation->>'outcomeSource' not in ('deterministic_validator', 'human_qa') then
      raise exception 'Ledger observation outcome fields are invalid';
    end if;

    begin
      v_assignment_id := (v_observation->>'assignmentId')::uuid;
    exception when invalid_text_representation then
      raise exception 'Ledger observation assignmentId must identify a persisted assignment';
    end;

    select rea.run_id, rea.phase, rea.status, rea.output_artifact_id, ep.key
      into v_assignment_run_id, v_assignment_phase, v_assignment_status,
           v_assignment_output_id, v_executor_key
      from public.run_executor_assignments rea
      join public.executor_profiles ep on ep.id = rea.executor_profile_id
     where rea.id = v_assignment_id;

    if v_assignment_run_id is null
       or v_assignment_run_id is distinct from p_run_id
       or v_assignment_phase is distinct from v_phase
       or v_assignment_status <> 'completed'
       or v_assignment_output_id is null
       or v_executor_key is distinct from v_observation->>'executorKey' then
      raise exception 'Ledger observation is not bound to the real completed assignment for this run and phase';
    end if;

    if not exists (
      select 1
        from public.evidence_artifacts ea
       where ea.run_id = p_run_id
         and ea.content_hash = v_source_hash
         and ea.payload->>'schemaVersion' in (
           'catalog-evidence-packet/v1',
           'catalog-evidence-review/v1',
           'catalog-evidence-validation/v1'
         )
    ) then
      raise exception 'Ledger observation source hash is not a typed artifact in this run';
    end if;

    insert into public.evidence_artifacts (
      organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
    ) values (
      v_org_id,
      p_run_id,
      'observation',
      format('CS-4 capability performance observation for %s phase', v_phase),
      format('delegation://runs/%s/assignments/%s', p_run_id, v_assignment_id),
      v_content_hash,
      v_observation,
      auth.uid()
    )
    returning id into v_artifact_id;

    return query select v_artifact_id, v_assignment_id;
  end loop;

  if not ('prepare' = any(v_seen_phases))
     or not ('review' = any(v_seen_phases))
     or not ('validate' = any(v_seen_phases)) then
    raise exception 'A work-cell ledger write must include prepare, review, and validate observations';
  end if;
end;
$$;

revoke all on function public.record_work_cell_ledger_observations(uuid, jsonb) from public;
revoke execute on function public.record_work_cell_ledger_observations(uuid, jsonb) from anon;
grant execute on function public.record_work_cell_ledger_observations(uuid, jsonb) to authenticated, service_role;
