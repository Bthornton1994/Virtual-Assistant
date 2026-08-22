-- QA-only execution record for Loadout Catalog Integrity v1 baseline.
-- Requires the fixture created by loadout_catalog_integrity_v1.sql.
--
-- This script intentionally records the first premature submission as FAILED,
-- then creates a clean deterministic baseline run with the CI artifact attached
-- before verification. Production migrations must not execute this fixture.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
  v_old_run_id uuid;
  v_new_run_id uuid;
begin
  select id into v_manager_id from auth.users
   where email = 'ops.manager@delegation-test.cloud' limit 1;
  select id into v_org_id from public.organizations
   where slug = 'loadout-internal-qa' limit 1;

  if v_manager_id is null or v_org_id is null then
    raise exception 'Loadout Catalog Integrity QA fixture is missing';
  end if;

  select id into v_workstream_id from public.workstreams
   where organization_id = v_org_id and name = 'Catalog Integrity'
   order by created_at asc limit 1;
  select id into v_spec_id from public.delegation_specs
   where organization_id = v_org_id and workstream_id = v_workstream_id and version = 1
   limit 1;

  if v_workstream_id is null or v_spec_id is null then
    raise exception 'Loadout Catalog Integrity workstream/spec is missing';
  end if;

  -- Preserve the first real process failure instead of papering over it.
  select r.id into v_old_run_id
    from public.workstream_runs r
    left join public.outcome_receipts receipt on receipt.run_id = r.id
   where r.organization_id = v_org_id
     and r.delegation_spec_id = v_spec_id
     and r.status = 'awaiting_verification'
     and receipt.id is null
   order by r.created_at asc
   limit 1;

  if v_old_run_id is not null then
    insert into public.outcome_receipts (
      organization_id, run_id, verification_status, definition_of_done_met,
      summary, verification_notes, actions_taken, exceptions,
      unresolved_decisions, qa_score, verified_by, verified_at
    ) values (
      v_org_id,
      v_old_run_id,
      'failed',
      false,
      'Foundation run submitted before the machine-readable CI baseline artifact existed.',
      'The work itself was useful, but the run was frozen too early. Catalog Integrity v1 requires the deterministic report to exist before submission so verification can inspect the actual machine output. This failure is retained as process evidence.',
      '["Defined Catalog Integrity v1 contract","Prepared Loadout integrity substrate","Opened Loadout PR #20"]'::jsonb,
      '["Run entered awaiting_verification before the required CI artifact was available"]'::jsonb,
      '["Retry as a clean run with the artifact attached while status is running"]'::jsonb,
      0,
      v_manager_id,
      now()
    );
  end if;

  -- Idempotency: do not create a second successful baseline if one already exists.
  if exists (
    select 1
      from public.workstream_runs r
      join public.outcome_receipts receipt on receipt.run_id = r.id
     where r.organization_id = v_org_id
       and r.delegation_spec_id = v_spec_id
       and r.executor_summary ->> 'mode' = 'deterministic_baseline'
       and receipt.verification_status = 'passed'
       and receipt.definition_of_done_met
  ) then
    return;
  end if;

  insert into public.workstream_runs (
    organization_id, workstream_id, delegation_spec_id, status, initiated_by,
    executor_summary, notes
  ) values (
    v_org_id,
    v_workstream_id,
    v_spec_id,
    'planned',
    v_manager_id,
    '{"mode":"deterministic_baseline","agent_authority":"none","repository":"Bthornton1994/Loadout","workstream":"Catalog Integrity v1","cost_tracking":"not_yet_instrumented"}'::jsonb,
    'Clean Step 3A baseline retry. Repository facts remain unchanged; this run measures the current evidence state.'
  ) returning id into v_new_run_id;

  update public.workstream_runs
     set status = 'running'
   where id = v_new_run_id;

  insert into public.evidence_artifacts (
    organization_id, run_id, kind, summary, source_uri, payload,
    observed_at, created_by
  ) values (
    v_org_id,
    v_new_run_id,
    'test',
    'Machine-readable Loadout Catalog Integrity baseline: 38 products, 271 tracked claims, 0 verified, 195 unverified, 76 demo-only, 0 commercial-ready products, 0 blocker-level integrity errors.',
    'https://github.com/Bthornton1994/Loadout/actions/runs/32592598004',
    '{"artifact_id":9480714942,"artifact_name":"catalog-integrity-baseline","artifact_digest":"sha256:e6a399f9d87ee92ddb01df4228ea84adeeb3d3fc2085572ab915554cada7679c","head_sha":"dda42f911b22ed0eb0116df099dafabd7be01f0b","product_count":38,"assessed_claim_count":271,"status_counts":{"verified":0,"stale":0,"unverified":195,"demo":76},"commercial_ready_product_count":0,"blocker_count":0}'::jsonb,
    now(),
    v_manager_id
  );

  insert into public.evidence_artifacts (
    organization_id, run_id, kind, summary, source_uri, payload,
    observed_at, created_by
  ) values (
    v_org_id,
    v_new_run_id,
    'test',
    'Loadout PR #20 verification gate passed install, lint, TypeScript, unit tests, artifact upload, and static-export build.',
    'https://github.com/Bthornton1994/Loadout/pull/20',
    '{"workflow_run_id":32592598004,"workflow":"Verify","conclusion":"success","steps":["npm ci","lint","typecheck","test","upload baseline artifact","build:pages"]}'::jsonb,
    now(),
    v_manager_id
  );

  update public.workstream_runs
     set status = 'awaiting_verification',
         human_minutes = 0,
         owner_minutes = 0,
         ai_cost_micros = 0,
         tool_cost_micros = 0,
         executor_summary = '{"mode":"deterministic_baseline","executor":"deterministic Loadout audit plus AI-assisted setup","agent_authority":"none","repository":"Bthornton1994/Loadout","pull_request":20,"workflow_run_id":32592598004,"cost_tracking":"not_yet_instrumented","result":"baseline_report_generated"}'::jsonb,
         notes = 'Baseline state measured successfully. Zero-dollar/minute values mean cost and coordination telemetry were not yet instrumented for this setup run; they are not claims that execution was free.'
   where id = v_new_run_id;

  insert into public.outcome_receipts (
    organization_id, run_id, verification_status, definition_of_done_met,
    summary, verification_notes, actions_taken, exceptions,
    unresolved_decisions, qa_score, verified_by, verified_at
  ) values (
    v_org_id,
    v_new_run_id,
    'passed',
    true,
    'Catalog Integrity v1 baseline completed without upgrading or publishing unsupported catalog claims.',
    'Independent verification confirmed the machine report covers all 38 current products and 271 tracked claims, reports zero blocker-level integrity errors, preserves 76 unsupported rating/performance claims as demo-only, reports 195 factual claims as unverified, and records zero verified/commercial-ready products. The repository verification workflow passed. QA score reflects adherence to this baseline assessment contract, not commercial data quality.',
    '["Generated deterministic integrity report","Preserved report artifact and digest","Verified repository gate","Quantified current evidence backlog","Preserved reference/demo disclosures"]'::jsonb,
    '["Current catalog has no sourced verified claims","Cost/owner-time telemetry was not instrumented for this setup run"]'::jsonb,
    '["Source-verification work must occur before any product can become commercial-ready","At least one more reviewed run is required before scheduling or Grok shadow-mode automation"]'::jsonb,
    100,
    v_manager_id,
    now()
  );
end
$$;
