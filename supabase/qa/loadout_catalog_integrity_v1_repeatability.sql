-- QA-only Step 3A repeatability run for Loadout Catalog Integrity v1.
-- Records a second clean audit after the baseline documentation commit triggered
-- a new repository verification run. The machine report matched the first
-- baseline byte-for-byte.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
  v_run_id uuid;
begin
  select id into v_manager_id from auth.users where email='ops.manager@delegation-test.cloud' limit 1;
  select id into v_org_id from public.organizations where slug='loadout-internal-qa' limit 1;
  select id into v_workstream_id from public.workstreams where organization_id=v_org_id and name='Catalog Integrity' order by created_at limit 1;
  select id into v_spec_id from public.delegation_specs where organization_id=v_org_id and workstream_id=v_workstream_id and version=1 limit 1;

  if v_manager_id is null or v_org_id is null or v_workstream_id is null or v_spec_id is null then
    raise exception 'Loadout Catalog Integrity QA fixture is missing';
  end if;

  if exists (
    select 1 from public.workstream_runs r
    join public.outcome_receipts receipt on receipt.run_id=r.id
    where r.organization_id=v_org_id
      and r.delegation_spec_id=v_spec_id
      and r.executor_summary->>'mode'='repeatability_baseline'
      and receipt.verification_status='passed'
      and receipt.definition_of_done_met
  ) then return; end if;

  insert into public.workstream_runs (
    organization_id,workstream_id,delegation_spec_id,status,initiated_by,executor_summary,notes
  ) values (
    v_org_id,v_workstream_id,v_spec_id,'planned',v_manager_id,
    '{"mode":"repeatability_baseline","agent_authority":"none","repository":"Bthornton1994/Loadout","workstream":"Catalog Integrity v1","cost_tracking":"not_yet_instrumented"}'::jsonb,
    'Second reviewed deterministic baseline run used to establish repeatability before Grok shadow mode.'
  ) returning id into v_run_id;

  update public.workstream_runs set status='running' where id=v_run_id;

  insert into public.evidence_artifacts (
    organization_id,run_id,kind,summary,source_uri,payload,observed_at,created_by
  ) values (
    v_org_id,v_run_id,'test',
    'Second machine-readable catalog audit reproduced the first baseline exactly: 38 products, 271 claims, 0 verified, 195 unverified, 76 demo-only, 0 commercial-ready, 0 blockers.',
    'https://github.com/Bthornton1994/Loadout/actions/runs/32592774163',
    '{"artifact_id":9480760087,"artifact_name":"catalog-integrity-baseline","artifact_digest":"sha256:42933ad374e745ec33a13245089b886c205e75243109f4cffeadbabe0e08cc4b","report_sha256":"e48b2129127f9bc293c0236d1ee1a89841b013cdf3bbc8e2c0536350997cc4e0","matches_first_report":true,"head_sha":"ea71d824dddc1ee55d7720d4a64e071eca09bf24","product_count":38,"assessed_claim_count":271,"status_counts":{"verified":0,"stale":0,"unverified":195,"demo":76},"commercial_ready_product_count":0,"blocker_count":0}'::jsonb,
    now(),v_manager_id
  );

  insert into public.evidence_artifacts (
    organization_id,run_id,kind,summary,source_uri,payload,observed_at,created_by
  ) values (
    v_org_id,v_run_id,'test',
    'Second Loadout verification run passed install, lint, typecheck, tests, artifact upload, and static-export build.',
    'https://github.com/Bthornton1994/Loadout/pull/20',
    '{"workflow_run_id":32592774163,"workflow":"Verify","conclusion":"success"}'::jsonb,
    now(),v_manager_id
  );

  update public.workstream_runs
     set status='awaiting_verification',
         executor_summary='{"mode":"repeatability_baseline","executor":"deterministic Loadout audit","agent_authority":"none","repository":"Bthornton1994/Loadout","pull_request":20,"workflow_run_id":32592774163,"result":"exact_repeatability_confirmed","cost_tracking":"not_yet_instrumented"}'::jsonb,
         notes='Second deterministic report matched the first report byte-for-byte. Economics remain uninstrumented and must not be inferred from zero values.'
   where id=v_run_id;

  insert into public.outcome_receipts (
    organization_id,run_id,verification_status,definition_of_done_met,summary,
    verification_notes,actions_taken,exceptions,unresolved_decisions,qa_score,
    verified_by,verified_at
  ) values (
    v_org_id,v_run_id,'passed',true,
    'Catalog Integrity v1 repeatability gate passed.',
    'The second reviewed execution produced the same machine report byte-for-byte and the full repository gate passed. This establishes deterministic baseline repeatability, not source-verification accuracy.',
    '["Repeated deterministic audit","Compared report hash to first baseline","Verified repository gate"]'::jsonb,
    '["No sourced verified claims yet","Cost/coordination telemetry not yet instrumented"]'::jsonb,
    '["Proceed to Grok shadow mode with prepare-only authority and measured review/cost telemetry"]'::jsonb,
    100,v_manager_id,now()
  );
end
$$;
