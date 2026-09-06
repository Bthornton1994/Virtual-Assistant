-- QA-only seed for SF-TWL-PREPARE-PROOF-01.
-- Intentionally outside supabase/migrations so Production schema runs do not
-- create this workstream, spec, or run.
--
-- Safe-use guard: requires the known Northline QA fixture and the QA
-- ops-manager account. Do not run against Production.
--
-- This script creates at most one planned run. It does not verify, merge,
-- deploy, write GitHub, or store secrets.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
begin
  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing SF-TWL-PREPARE-PROOF-01 QA seed: Northline QA fixture not present';
  end if;

  select id
    into v_manager_id
    from auth.users
   where email = 'ops.manager@delegation-test.cloud'
   limit 1;

  if v_manager_id is null then
    raise exception 'Refusing SF-TWL-PREPARE-PROOF-01 QA seed: QA ops manager not present';
  end if;

  select id
    into v_org_id
    from public.organizations
   where slug = 'northline-consulting-test'
   limit 1;

  select id
    into v_workstream_id
    from public.workstreams
   where organization_id = v_org_id
     and name = 'Three White Lights prepare-only proof'
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
      'Three White Lights prepare-only proof',
      'Prove Delegation Cloud can create a durable prepare-only run, assign a worker who cannot Accept alone, show status, attach hashed public PR evidence, verify, escalate, and route release without merge or deploy.',
      'One reviewed QA session; no autonomous cadence',
      '["Create or resume the QA run","Assign a human operator or shadow worker","Start the run","Attach read-only public PR evidence","Submit for independent verification"]'::jsonb,
      '["run created","worker assigned","public PR evidence hashed","verification passed without agent-report-only Accept","merge_performed false"]'::jsonb,
      v_manager_id,
      'active',
      70,
      0
    ) returning id into v_workstream_id;
  end if;

  select id
    into v_spec_id
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
      economic_envelope,
      data_policy,
      created_by,
      activated_by,
      activated_at
    ) values (
      v_org_id,
      v_workstream_id,
      1,
      'active',
      'Prove a QA-only prepare-only path: durable run, assigned worker who cannot Accept alone, visible status, hashed public PR evidence, deterministic verification, escalation, and release routing without merge or deploy.',
      '["A durable QA workstream run exists for this spec","A human operator or shadow worker is assigned and cannot Accept alone","Run status is visible on staff /ops/execution","Read-only public GitHub PR metadata is attached as hashed evidence","Evidence records mutatesRepository=false and merge_performed=false","Deterministic verification required evidence kinds and hashes; an agent report alone cannot Accept","Exceptions escalate to an operations manager; release is routed without merge or deploy","No merge, deploy, secret, GitHub write, issues write, purchase, or external message is performed"]'::jsonb,
      'Manual QA one-shot. Operator-triggered only. Do not schedule, webhook-advance, or treat this as a live always-on operator.',
      '["twl-prepare-proof/v1","Public GitHub pull request metadata (default Bthornton1994/three-white-lights#35)","Assigned human operator or shadow worker"]'::jsonb,
      'prepare_only',
      '["Read public GitHub pull request metadata by operator-triggered GET","Hash and attach evidence_artifacts","Assign a human operator or shadow worker who cannot Accept alone","Escalate exceptions to an operations manager","Route a prepare-only release decision without merge or deploy"]'::jsonb,
      '["Any merge to a default branch","Any deployment","Any GitHub write, issue write, or secret use","Any purchase or external message","Accept / Outcome Receipt"]'::jsonb,
      '["Required evidence kinds: assignment observation and public PR source","Recompute the PR evidence payload hash and reject a mismatch","Refuse Accept when only an agent report is present","Refuse Accept if mutatesRepository is not false","Refuse Accept if merge_performed is not false","Refuse Accept if action_class is not prepare_only","Assigned worker cannot issue the Outcome Receipt"]'::jsonb,
      '["Missing required evidence kinds","Evidence hash mismatch","Write, merge, deploy, secret, or GitHub-write request","Agent report offered as the sole Accept basis","Assigned worker attempts to Accept","Public GitHub read fails or returns a non-public target"]'::jsonb,
      'Complete one reviewed QA session; no autonomous cadence',
      '{"record_human_minutes":true,"record_owner_minutes":true,"record_ai_cost_micros":true,"record_tool_cost_micros":true}'::jsonb,
      '{"proofKey":"sf-twl-prepare-proof-01","publicGithubReadOnly":true,"noSecrets":true,"noConnectors":true}'::jsonb,
      v_manager_id,
      v_manager_id,
      now()
    ) returning id into v_spec_id;
  end if;

  insert into public.executor_profiles (
    key, display_name, executor_kind, provider, role, status,
    capabilities, authority_envelope, forbidden_actions, configuration_metadata
  ) values (
    'sf-twl-prepare-proof-shadow-v1',
    'SF-TWL prepare-only shadow',
    'agent',
    'delegation-cloud',
    'researcher',
    'shadow',
    '["observe a running prepare-only proof","cannot Accept"]'::jsonb,
    '{
      "actionClass": "prepare_only",
      "mayOwnAuthoritativeState": false,
      "mayOwnAccept": false,
      "mayMerge": false,
      "mayDeploy": false,
      "mayUseSecrets": false,
      "mayWriteGithub": false
    }'::jsonb,
    '[
      "Accept / Outcome Receipt",
      "merge",
      "deploy",
      "secrets",
      "github write",
      "issues write",
      "purchases",
      "external messages"
    ]'::jsonb,
    '{
      "proofKey": "sf-twl-prepare-proof-01",
      "notes": "Shadow only. Cannot own Accept. Not a live always-on operator."
    }'::jsonb
  )
  on conflict (key) do update set
    display_name = excluded.display_name,
    executor_kind = excluded.executor_kind,
    provider = excluded.provider,
    role = excluded.role,
    status = excluded.status,
    capabilities = excluded.capabilities,
    authority_envelope = excluded.authority_envelope,
    forbidden_actions = excluded.forbidden_actions,
    configuration_metadata = excluded.configuration_metadata;

  if not exists (
    select 1
      from public.workstream_runs
     where delegation_spec_id = v_spec_id
       and status in ('planned', 'running', 'awaiting_verification')
  ) then
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
      '{"proofKey":"sf-twl-prepare-proof-01","mode":"qa_oneshot","agent_authority":"none","merge_performed":false,"mutatesRepository":false}'::jsonb,
      'SF-TWL-PREPARE-PROOF-01. Remain planned until an operator starts it on /ops/execution, assigns a worker, and attaches read-only public PR evidence. Do not merge or deploy.'
    );
  end if;
end
$$;
