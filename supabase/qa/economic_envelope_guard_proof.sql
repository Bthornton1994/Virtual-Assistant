-- QA-only transactional proof for CS-14 economic envelope guards.
--
-- This script assumes the dedicated Delegation Cloud QA fixture, including:
--   * Grounded internal QA spec 2d7d2305-82ff-4d6d-973f-f0cb7f3d5ad2
--   * legacy-alias QA spec bdd002fd-1492-4cf3-a9bf-ebed09f63414
--   * QA ops manager c0b2ab6c-c56d-4435-89fd-f972ce552609
--   * active deterministic validator e33d1d71-1cce-463c-8018-6959b3338210
--
-- Run only with a privileged QA SQL connection. The explicit ROLLBACK keeps
-- every disposable run, artifact, assignment, and receipt out of QA. Never run
-- this script against Production.

\set ON_ERROR_STOP on
\pset pager off

begin;

do $proof$
declare
  v_org_id uuid;
  v_workstream_id uuid;
  v_manager_id uuid := 'c0b2ab6c-c56d-4435-89fd-f972ce552609';
  v_owner_spec_id uuid := 'bdd002fd-1492-4cf3-a9bf-ebed09f63414';
  v_workcell_spec_id uuid := '2d7d2305-82ff-4d6d-973f-f0cb7f3d5ad2';
  v_owner_run_id uuid := 'c0de0001-0000-4000-8000-000000000001';
  v_workcell_run_id uuid := 'c0de0001-0000-4000-8000-000000000002';
  v_validation_artifact_id uuid := 'c0de0001-0000-4000-8000-000000000003';
begin
  if exists (select 1 from public.workstream_runs where id in (v_owner_run_id, v_workcell_run_id))
     or exists (select 1 from public.evidence_artifacts where id = v_validation_artifact_id) then
    raise exception 'QA proof sentinel IDs already exist; refusing to run a non-isolated probe';
  end if;

  perform public.validate_economic_envelope_shape(
    '{"maxOwnerMinutes":5,"max_owner_minutes":5,"maxAiCostMicros":0}'::jsonb
  );

  begin
    perform public.validate_economic_envelope_shape('{"maxAiCostMicros":1.5}'::jsonb);
    raise exception 'QA_PROOF_FAILED: fractional micros ceiling was accepted';
  exception when others then
    if sqlerrm like 'QA_PROOF_FAILED:%' then raise; end if;
  end;

  select organization_id, workstream_id
    into v_org_id, v_workstream_id
    from public.delegation_specs
   where id = v_owner_spec_id;

  if v_org_id is null or v_workstream_id is null then
    raise exception 'QA_PROOF_FAILED: legacy-alias QA spec was not found';
  end if;

  begin
    insert into public.delegation_specs (
      organization_id, workstream_id, version, status, objective,
      definition_of_done, economic_envelope, created_by
    ) values (
      v_org_id, v_workstream_id, 999, 'draft', 'Disposable malformed envelope proof',
      '["must fail"]'::jsonb, '{"maxOwnerMinutes":"5"}'::jsonb, v_manager_id
    );
    raise exception 'QA_PROOF_FAILED: malformed Delegation Spec envelope was inserted';
  exception when others then
    if sqlerrm like 'QA_PROOF_FAILED:%' then raise; end if;
  end;

  insert into public.workstream_runs (
    id, organization_id, workstream_id, delegation_spec_id, status, initiated_by
  ) values (
    v_owner_run_id, v_org_id, v_workstream_id, v_owner_spec_id, 'planned', v_manager_id
  );
  update public.workstream_runs set status = 'running' where id = v_owner_run_id;
  insert into public.evidence_artifacts (
    organization_id, run_id, kind, summary, payload, content_hash
  ) values (
    v_org_id, v_owner_run_id, 'observation', 'Disposable economic envelope proof evidence',
    '{}'::jsonb, repeat('a', 64)
  );
  update public.workstream_runs
     set owner_minutes = 6,
         status = 'awaiting_verification'
   where id = v_owner_run_id;

  begin
    insert into public.outcome_receipts (
      organization_id, run_id, verification_status, definition_of_done_met,
      summary, verification_notes, actions_taken, exceptions,
      unresolved_decisions, verified_by, verified_at
    ) values (
      v_org_id, v_owner_run_id, 'passed', true,
      'Disposable passing receipt must be rejected',
      'The owner minutes exceed the legacy five-minute ceiling.',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, v_manager_id, now()
    );
    raise exception 'QA_PROOF_FAILED: over-limit passing receipt was accepted';
  exception when others then
    if sqlerrm like 'QA_PROOF_FAILED:%'
       or sqlerrm not like 'Economic envelope maxOwnerMinutes exceeded:%' then
      raise;
    end if;
  end;

  if (select status from public.workstream_runs where id = v_owner_run_id) <> 'awaiting_verification' then
    raise exception 'QA_PROOF_FAILED: rejected passing receipt changed the run status';
  end if;

  insert into public.outcome_receipts (
    organization_id, run_id, verification_status, definition_of_done_met,
    summary, verification_notes, actions_taken, exceptions,
    unresolved_decisions, verified_by, verified_at
  ) values (
    v_org_id, v_owner_run_id, 'failed', false,
    'Disposable over-limit attempt failed',
    'The recorded owner minutes exceeded the declared ceiling.',
    '[]'::jsonb, '["economic envelope exceeded"]'::jsonb,
    '[]'::jsonb, v_manager_id, now()
  );

  if (select status from public.workstream_runs where id = v_owner_run_id) <> 'failed' then
    raise exception 'QA_PROOF_FAILED: failed receipt did not finalize the over-limit run';
  end if;

  select organization_id, workstream_id
    into v_org_id, v_workstream_id
    from public.delegation_specs
   where id = v_workcell_spec_id;

  insert into public.workstream_runs (
    id, organization_id, workstream_id, delegation_spec_id, status, initiated_by
  ) values (
    v_workcell_run_id, v_org_id, v_workstream_id, v_workcell_spec_id, 'planned', v_manager_id
  );
  update public.workstream_runs set status = 'running' where id = v_workcell_run_id;

  insert into public.evidence_artifacts (
    id, organization_id, run_id, kind, summary, payload, content_hash
  ) values (
    v_validation_artifact_id, v_org_id, v_workcell_run_id, 'test',
    'Disposable validation artifact',
    '{"schemaVersion":"catalog-evidence-validation/v1","gate":{"hardGatePass":false,"workCellVerdict":"failed"}}'::jsonb,
    repeat('b', 64)
  );
  insert into public.run_executor_assignments (
    organization_id, run_id, executor_profile_id, phase, status,
    output_artifact_id, human_minutes
  ) values (
    v_org_id, v_workcell_run_id,
    'e33d1d71-1cce-463c-8018-6959b3338210',
    'validate', 'completed', v_validation_artifact_id, 0
  );
  insert into public.run_executor_assignments (
    organization_id, run_id, executor_profile_id, phase, status,
    human_minutes
  ) values (
    v_org_id, v_workcell_run_id,
    'e33d1d71-1cce-463c-8018-6959b3338210',
    'prepare', 'planned', 2
  );

  begin
    update public.workstream_runs
       set human_minutes = 1,
           status = 'awaiting_verification'
     where id = v_workcell_run_id;
    raise exception 'QA_PROOF_FAILED: under-reported work-cell human minutes were accepted';
  exception when others then
    if sqlerrm like 'QA_PROOF_FAILED:%'
       or sqlerrm not like 'Workstream run human_minutes cannot be lower than recorded executor assignment costs' then
      raise;
    end if;
  end;

  update public.workstream_runs
     set human_minutes = 2,
         status = 'awaiting_verification'
   where id = v_workcell_run_id;

  if (select status from public.workstream_runs where id = v_workcell_run_id) <> 'awaiting_verification' then
    raise exception 'QA_PROOF_FAILED: correctly reported work-cell totals did not submit';
  end if;
end
$proof$;

rollback;

select
  'passed'::text as qa_economic_envelope_proof,
  'transaction rolled back; existing QA fixtures preserved'::text as isolation;
