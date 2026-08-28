\set ON_ERROR_STOP on

-- CS-4 QA proof: source-bound persistence and duplicate atomicity.
-- Run against the dedicated QA project with the existing QA fixture.
-- The fixed IDs are disposable and the transaction is rolled back before exit.
begin;

do $proof$
declare
  v_org_id uuid := 'bd832a07-729f-4ce3-b961-8b82fdb46f35';
  v_manager_id uuid := 'c0b2ab6c-c56d-4435-89fd-f972ce552609';
  v_spec_id uuid := '37bf390f-43bf-48db-af38-63fab1a91ac9';
  v_workstream_id uuid := '2a984b48-3601-4cd4-90b4-0efa9183a4ab';
  v_run_id uuid := 'c5e40001-0000-4000-8000-000000000001';
  v_packet_id uuid := 'c5e40001-0000-4000-8000-000000000002';
  v_review_id uuid := 'c5e40001-0000-4000-8000-000000000003';
  v_validation_id uuid := 'c5e40001-0000-4000-8000-000000000004';
  v_prepare_assignment_id uuid := 'c5e40001-0000-4000-8000-000000000011';
  v_review_assignment_id uuid := 'c5e40001-0000-4000-8000-000000000012';
  v_validate_assignment_id uuid := 'c5e40001-0000-4000-8000-000000000013';
  v_packet_payload jsonb;
  v_review_payload jsonb;
  v_validation_payload jsonb;
  v_packet_hash text;
  v_review_hash text;
  v_validation_hash text;
  v_prepare_observation jsonb;
  v_review_observation jsonb;
  v_validate_observation jsonb;
  v_entries jsonb;
  v_count integer;
begin
  insert into public.workstream_runs (
    id, organization_id, workstream_id, request_id, delegation_spec_id,
    status, initiated_by, executor_summary, human_minutes, owner_minutes,
    ai_cost_micros, tool_cost_micros, started_at, completed_at, notes,
    gauntlet_cycle_id, attempt_number, retry_of_run_id
  ) values (
    v_run_id, v_org_id, v_workstream_id, null, v_spec_id,
    'planned', v_manager_id, '{}'::jsonb, 0, 0,
    0, 0, null, null, 'Disposable CS-4 QA proof run',
    null, 1, null
  );

  update public.workstream_runs
     set status = 'running',
         started_at = '2026-08-28T07:00:00Z'
   where id = v_run_id;

  v_packet_payload := jsonb_build_object(
    'schemaVersion', 'catalog-evidence-packet/v1',
    'runId', v_run_id::text,
    'products', jsonb_build_array(),
    'claims', jsonb_build_array(),
    'authorityReport', jsonb_build_object(
      'messagesSent', 0,
      'purchases', 0,
      'accountsCreated', 0,
      'repositoryMutations', 0,
      'catalogMutations', 0,
      'permissionsChanged', 0
    )
  );
  v_review_payload := jsonb_build_object(
    'schemaVersion', 'catalog-evidence-review/v1',
    'runId', v_run_id::text,
    'evidencePacketHash', ''
  );
  v_validation_payload := jsonb_build_object(
    'schemaVersion', 'catalog-evidence-validation/v1',
    'runId', v_run_id::text,
    'packetHash', '',
    'reviewHash', '',
    'gate', jsonb_build_object(
      'hardGatePass', true,
      'workCellVerdict', 'passed',
      'authorityIncidents', jsonb_build_array()
    )
  );
  v_packet_hash := encode(extensions.digest(v_packet_payload::text, 'sha256'), 'hex');
  v_review_payload := jsonb_set(v_review_payload, '{evidencePacketHash}', to_jsonb(v_packet_hash));
  v_review_hash := encode(extensions.digest(v_review_payload::text, 'sha256'), 'hex');
  v_validation_payload := jsonb_set(v_validation_payload, '{packetHash}', to_jsonb(v_packet_hash));
  v_validation_payload := jsonb_set(v_validation_payload, '{reviewHash}', to_jsonb(v_review_hash));
  v_validation_hash := encode(extensions.digest(v_validation_payload::text, 'sha256'), 'hex');

  insert into public.evidence_artifacts (
    id, organization_id, run_id, request_id, kind, summary, source_uri,
    content_hash, payload, observed_at, created_by
  ) values
    (
      v_packet_id, v_org_id, v_run_id, null, 'source',
      'Disposable CS-4 QA packet', 'qa://cs4/packet',
      v_packet_hash, v_packet_payload, '2026-08-28T07:00:01Z', v_manager_id
    ),
    (
      v_review_id, v_org_id, v_run_id, null, 'source',
      'Disposable CS-4 QA review', 'qa://cs4/review',
      v_review_hash, v_review_payload, '2026-08-28T07:00:07Z', v_manager_id
    ),
    (
      v_validation_id, v_org_id, v_run_id, null, 'source',
      'Disposable CS-4 QA validation', 'qa://cs4/validation',
      v_validation_hash, v_validation_payload, '2026-08-28T07:00:09Z', v_manager_id
    );

  insert into public.run_executor_assignments (
    id, organization_id, run_id, executor_profile_id, phase, status,
    authority_snapshot, input_artifact_id, output_artifact_id,
    started_at, completed_at, human_minutes, ai_cost_micros,
    tool_cost_micros, metadata, created_by
  ) values
    (
      v_prepare_assignment_id, v_org_id, v_run_id,
      '27d5c51a-3759-4bd6-aadb-614be1b96759',
      'prepare', 'completed',
      '{}'::jsonb, null, v_packet_id,
      '2026-08-28T07:00:00Z', '2026-08-28T07:00:02Z',
      1.5, 1200, 300, '{}'::jsonb, v_manager_id
    ),
    (
      v_review_assignment_id, v_org_id, v_run_id,
      'f521f8b9-45fd-453c-8397-7ce0cab9a55d',
      'review', 'completed',
      '{}'::jsonb, v_packet_id, v_review_id,
      '2026-08-28T07:00:03Z', '2026-08-28T07:00:07Z',
      0.5, 800, 200, '{}'::jsonb, v_manager_id
    ),
    (
      v_validate_assignment_id, v_org_id, v_run_id,
      'e33d1d71-1cce-463c-8018-6959b3338210',
      'validate', 'completed',
      '{}'::jsonb, v_review_id, v_validation_id,
      '2026-08-28T07:00:08Z', '2026-08-28T07:00:09Z',
      0, 0, 0, '{}'::jsonb, v_manager_id
    );

  v_prepare_observation := jsonb_build_object(
    'schemaVersion', 'capability-performance-ledger/v1',
    'runId', v_run_id::text,
    'assignmentId', v_prepare_assignment_id::text,
    'capabilityKey', 'catalog_evidence_research',
    'executorKey', 'hermes-loadout-researcher-v1',
    'contractVersion', 'catalog-evidence-packet/v1',
    'status', 'completed',
    'hardGateResult', 'pass',
    'benchmarkTruth', null,
    'authorityIncident', false,
    'evidenceComplete', true,
    'correctionRequired', false,
    'rollbackOrRetry', false,
    'humanInterventionMinutes', 1.5,
    'aiCostMicros', 1200,
    'toolCostMicros', 300,
    'latencyMs', 2000,
    'outcomeSource', 'deterministic_validator',
    'sourceArtifactHash', v_packet_hash,
    'recordedAt', '2026-08-28T07:00:09Z'
  );
  v_review_observation := jsonb_build_object(
    'schemaVersion', 'capability-performance-ledger/v1',
    'runId', v_run_id::text,
    'assignmentId', v_review_assignment_id::text,
    'capabilityKey', 'catalog_evidence_review',
    'executorKey', 'grok-loadout-reviewer-v1',
    'contractVersion', 'catalog-evidence-review/v1',
    'status', 'completed',
    'hardGateResult', 'pass',
    'benchmarkTruth', null,
    'authorityIncident', false,
    'evidenceComplete', true,
    'correctionRequired', false,
    'rollbackOrRetry', false,
    'humanInterventionMinutes', 0.5,
    'aiCostMicros', 800,
    'toolCostMicros', 200,
    'latencyMs', 4000,
    'outcomeSource', 'deterministic_validator',
    'sourceArtifactHash', v_review_hash,
    'recordedAt', '2026-08-28T07:00:09Z'
  );
  v_validate_observation := jsonb_build_object(
    'schemaVersion', 'capability-performance-ledger/v1',
    'runId', v_run_id::text,
    'assignmentId', v_validate_assignment_id::text,
    'capabilityKey', 'deterministic_catalog_validation',
    'executorKey', 'catalog-evidence-validator-v1',
    'contractVersion', 'catalog-evidence-validation/v1',
    'status', 'completed',
    'hardGateResult', 'pass',
    'benchmarkTruth', null,
    'authorityIncident', false,
    'evidenceComplete', true,
    'correctionRequired', false,
    'rollbackOrRetry', false,
    'humanInterventionMinutes', 0,
    'aiCostMicros', 0,
    'toolCostMicros', 0,
    'latencyMs', 1000,
    'outcomeSource', 'deterministic_validator',
    'sourceArtifactHash', v_validation_hash,
    'recordedAt', '2026-08-28T07:00:09Z'
  );
  v_entries := jsonb_build_array(
    jsonb_build_object(
      'phase', 'prepare',
      'contentHash', encode(extensions.digest(v_prepare_observation::text, 'sha256'), 'hex'),
      'observation', v_prepare_observation
    ),
    jsonb_build_object(
      'phase', 'review',
      'contentHash', encode(extensions.digest(v_review_observation::text, 'sha256'), 'hex'),
      'observation', v_review_observation
    ),
    jsonb_build_object(
      'phase', 'validate',
      'contentHash', encode(extensions.digest(v_validate_observation::text, 'sha256'), 'hex'),
      'observation', v_validate_observation
    )
  );

  begin
    perform public.record_work_cell_ledger_observations(
      v_run_id,
      jsonb_set(v_entries, '{0,phase}', 'null'::jsonb, true)
    );
    raise exception 'CS4 missing-phase guard did not reject malformed input';
  exception
    when others then
      if sqlerrm <> 'Ledger observation phase must be prepare, review, or validate' then
        raise;
      end if;
  end;

  begin
    perform public.record_work_cell_ledger_observations(
      v_run_id,
      jsonb_set(v_entries, '{0,observation,status}', 'null'::jsonb, true)
    );
    raise exception 'CS4 missing-status guard did not reject malformed input';
  exception
    when others then
      if sqlerrm <> 'Ledger observation outcome fields are invalid' then
        raise;
      end if;
  end;

  select count(*) into v_count
    from public.record_work_cell_ledger_observations(v_run_id, v_entries);
  if v_count <> 3 then
    raise exception 'CS4 proof expected three persisted observations, got %', v_count;
  end if;

  select count(*) into v_count
    from public.evidence_artifacts
   where run_id = v_run_id
     and payload->>'schemaVersion' = 'capability-performance-ledger/v1';
  if v_count <> 3 then
    raise exception 'CS4 proof expected three ledger artifacts, got %', v_count;
  end if;

  begin
    perform public.record_work_cell_ledger_observations(v_run_id, v_entries);
    raise exception 'CS4 duplicate guard did not reject a second write';
  exception
    when unique_violation then
      null;
  end;

  select count(*) into v_count
    from public.evidence_artifacts
   where run_id = v_run_id
     and payload->>'schemaVersion' = 'capability-performance-ledger/v1';
  if v_count <> 3 then
    raise exception 'CS4 duplicate proof changed the immutable ledger count to %', v_count;
  end if;
end
$proof$;

rollback;

select
  (select count(*) from public.workstream_runs where id='c5e40001-0000-4000-8000-000000000001') as run_rows,
  (select count(*) from public.evidence_artifacts where id in (
    'c5e40001-0000-4000-8000-000000000002',
    'c5e40001-0000-4000-8000-000000000003',
    'c5e40001-0000-4000-8000-000000000004'
  )) as source_rows,
  (select count(*) from public.evidence_artifacts where run_id='c5e40001-0000-4000-8000-000000000001' and payload->>'schemaVersion'='capability-performance-ledger/v1') as ledger_rows,
  (select count(*) from public.run_executor_assignments where run_id='c5e40001-0000-4000-8000-000000000001') as assignment_rows;
