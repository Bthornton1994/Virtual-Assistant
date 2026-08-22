-- QA-only Step 3B planned run for the first Grok Bot shadow experiment.
-- This does not execute Grok, grant credentials, or schedule a routine.
-- It creates the workstream run that will receive evidence/economics after the
-- owner starts the one-time Grok task defined in the Loadout repository.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
begin
  select id into v_manager_id from auth.users
   where email='ops.manager@delegation-test.cloud' limit 1;
  select id into v_org_id from public.organizations
   where slug='loadout-internal-qa' limit 1;
  select id into v_workstream_id from public.workstreams
   where organization_id=v_org_id and name='Catalog Integrity'
   order by created_at limit 1;
  select id into v_spec_id from public.delegation_specs
   where organization_id=v_org_id
     and workstream_id=v_workstream_id
     and version=1
     and status='active'
   limit 1;

  if v_manager_id is null or v_org_id is null or v_workstream_id is null or v_spec_id is null then
    raise exception 'Loadout Catalog Integrity QA fixture is missing';
  end if;

  if exists (
    select 1 from public.workstream_runs
     where organization_id=v_org_id
       and delegation_spec_id=v_spec_id
       and executor_summary->>'mode'='grok_shadow_batch_1'
       and status in ('planned','running','awaiting_verification','verified')
  ) then
    return;
  end if;

  insert into public.workstream_runs (
    organization_id,
    workstream_id,
    delegation_spec_id,
    status,
    initiated_by,
    executor_summary,
    human_minutes,
    owner_minutes,
    ai_cost_micros,
    tool_cost_micros,
    notes
  ) values (
    v_org_id,
    v_workstream_id,
    v_spec_id,
    'planned',
    v_manager_id,
    '{
      "mode":"grok_shadow_batch_1",
      "executor":"Grok Growth / Market Worker",
      "agent_authority":"observe_prepare_only",
      "repository":"Bthornton1994/Loadout",
      "scope_products":["ks-sbd-7mm","belt-sbd-13mm","ks-a7-conical","shoe-nike-romaleos","belt-inzer-forever"],
      "reference_visibility":"blind",
      "routine_allowed":false,
      "repository_write_allowed":false,
      "merge_allowed":false,
      "publish_allowed":false,
      "external_communication_allowed":false,
      "spend_allowed":false,
      "cost_tracking":"required"
    }'::jsonb,
    0,
    0,
    0,
    0,
    'Step 3B planned shadow run. Do not transition to running until the one-time Grok task is actually started. Attach the raw Grok report and source list while running, record actual human/owner review minutes and available Grok/tool cost, then submit for independent verification. Zero values are placeholders until measured.'
  );
end
$$;
