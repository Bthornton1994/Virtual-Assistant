-- QA-only Software Factory Loadout seed.
--
-- Creates a demonstration Delegation Spec + planned Workstream Run + Software
-- Factory overlay at intake for SF-LOAD-001. It does not freeze a packet,
-- attach reserved evidence, Accept the run, or mutate Loadout.
--
-- Apply only when Delegation Cloud QA setup is explicitly authorized and the
-- Software Factory migrations have already been applied.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
  v_run_id uuid;
begin
  if to_regclass('public.software_factory_runs') is null then
    raise exception 'Refusing Software Factory QA seed: apply the software_factory_run_manager migration first';
  end if;

  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing Software Factory QA seed: Northline QA fixture not present';
  end if;

  select id into v_org_id
    from public.organizations
   where slug = 'northline-consulting-test'
   limit 1;

  select id into v_manager_id
    from auth.users
   where email = 'ops.manager@delegation-test.cloud'
   limit 1;

  if v_manager_id is null then
    raise exception 'Refusing Software Factory QA seed: QA ops manager not present';
  end if;

  select id into v_workstream_id
    from public.workstreams
   where organization_id = v_org_id
     and name = 'Software Factory'
   order by created_at asc
   limit 1;

  if v_workstream_id is null then
    insert into public.workstreams (
      organization_id,
      name,
      objective,
      sla,
      recurring_tasks,
      metrics,
      owner_user_id,
      status,
      health_score,
      hours_returned
    ) values (
      v_org_id,
      'Software Factory',
      'Govern software work through Delegation Specs, Workstream Runs, task packets, evidence, and owner approval without merging or deploying.',
      'On demand. No always-on schedule.',
      '["Intake software work","Freeze a task packet","Collect PR/CI evidence","Pause for owner acceptance"]'::jsonb,
      '["runs accepted only after owner decision","merge performed count must stay zero"]'::jsonb,
      v_manager_id,
      'active',
      70,
      0
    ) returning id into v_workstream_id;
  end if;

  select id into v_spec_id
    from public.delegation_specs
   where organization_id = v_org_id
     and workstream_id = v_workstream_id
     and version = 1
   limit 1;

  if v_spec_id is null then
    insert into public.delegation_specs (
      organization_id,
      workstream_id,
      version,
      status,
      objective,
      definition_of_done,
      trigger_description,
      required_inputs,
      action_class,
      authority_rules,
      approval_points,
      verification_rules,
      exception_policy,
      sla,
      created_by,
      activated_by,
      activated_at
    ) values (
      v_org_id,
      v_workstream_id,
      1,
      'active',
      'Demonstrate Software Factory control of the Loadout proof workflow without mutating Loadout.',
      '["Delegation Spec and Workstream Run exist for SF-LOAD-001.","Task packet is frozen and hashed.","Loadout PR #26 is attached as historical evidence without mutation.","Merge remains unperformed by Delegation Cloud."]'::jsonb,
      'Manual demonstration. No routine.',
      '["software-factory-run/v1","Bthornton1994/Loadout","https://github.com/Bthornton1994/Loadout/pull/26"]'::jsonb,
      'prepare_only',
      '["prepare_only","packet cannot authorize itself","no GitHub mutation"]'::jsonb,
      '["owner_acceptance","merge_pr"]'::jsonb,
      '["Required evidence kinds must be hashed","Owner acceptance must be recorded outside the packet"]'::jsonb,
      '["Missing connector","Unverifiable evidence","Scope expansion"]'::jsonb,
      'Demonstration only',
      v_manager_id,
      v_manager_id,
      now()
    ) returning id into v_spec_id;
  else
    update public.delegation_specs
       set required_inputs = (
             select coalesce(jsonb_agg(value), '[]'::jsonb)
               from (
                 select distinct value
                   from jsonb_array_elements(
                     coalesce(required_inputs, '[]'::jsonb) || '["software-factory-run/v1"]'::jsonb
                   ) as value
               ) items
           ),
           action_class = 'prepare_only'
     where id = v_spec_id;
  end if;

  select id into v_run_id
    from public.workstream_runs
   where organization_id = v_org_id
     and delegation_spec_id = v_spec_id
     and notes like '%SF-LOAD-001%'
   order by created_at desc
   limit 1;

  if v_run_id is null then
    insert into public.workstream_runs (
      organization_id,
      workstream_id,
      delegation_spec_id,
      status,
      initiated_by,
      executor_summary,
      notes
    ) values (
      v_org_id,
      v_workstream_id,
      v_spec_id,
      'planned',
      v_manager_id,
      '{"mode":"human_mediated","agent_authority":"none","repository":"Bthornton1994/Loadout","taskId":"SF-LOAD-001","githubIssuesWrite":false}'::jsonb,
      'SF-LOAD-001 demonstration. Historical Loadout PR #26 is evidence only. GitHub Issues write is unavailable. Merge remains blocked.'
    ) returning id into v_run_id;
  end if;

  if not exists (
    select 1
      from public.software_factory_runs
     where organization_id = v_org_id
       and task_id = 'SF-LOAD-001'
  ) then
    insert into public.software_factory_runs (
      organization_id,
      task_id,
      workstream_run_id,
      delegation_spec_id,
      lifecycle_status,
      action_class,
      repository,
      base_branch,
      frozen_in_scope,
      frozen_acceptance_criteria,
      connector_status,
      created_by
    ) values (
      v_org_id,
      'SF-LOAD-001',
      v_run_id,
      v_spec_id,
      'intake',
      'prepare_only',
      'Bthornton1994/Loadout',
      'main',
      '["Record the Loadout proof as a Delegation Cloud Software Factory run.","Attach historical PR and verification evidence."]'::jsonb,
      '["Delegation Spec and Workstream Run exist for SF-LOAD-001.","Task packet is frozen and hashed.","Loadout PR #26 is attached as historical evidence without mutation.","Merge remains unperformed by Delegation Cloud."]'::jsonb,
      '[{"key":"grok_bot","available":false,"limitation":"No approved Grok Bot connector."},{"key":"cursor_cloud_agent","available":false,"limitation":"No approved Cursor Cloud Agent connector."},{"key":"github_issues_write","available":false,"limitation":"GitHub Issues write is not an approved connector; Workstream Run is the canonical board."},{"key":"github_evidence","available":true,"limitation":"GitHub is an evidence provider only."}]'::jsonb,
      v_manager_id
    );
  end if;
end
$$;
