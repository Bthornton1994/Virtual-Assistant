-- Delegation Cloud Execution Runtime v1, RPC continuation
--
-- The schema, grants, policies, and invariant triggers are installed by
-- 20260903090000_execution_runtime_v1.sql. Worker-facing claim and terminal
-- RPCs continue in 20260903090002_execution_runtime_v1_worker_functions.sql.

-- All mutating runtime RPCs are service-role operations. The application must
-- authenticate the human actor before obtaining this client. This keeps direct
-- PostgREST writes from manufacturing attempts, leases, or event history.
create or replace function public.create_execution_plan(
  p_plan_id uuid,
  p_organization_id uuid,
  p_run_id uuid,
  p_delegation_spec_id uuid,
  p_plan_version integer,
  p_delegation_spec_version integer,
  p_plan_hash text,
  p_objective_snapshot text,
  p_authority_class text,
  p_data_policy_snapshot jsonb,
  p_steps jsonb,
  p_created_at timestamptz,
  p_created_by uuid
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_step jsonb;
  v_step_key text;
  v_action_class text;
  v_requires_approval boolean;
  v_external_side_effect boolean;
  v_may_own boolean;
  v_plan_rank integer;
  v_step_rank integer;
  v_run_org uuid;
  v_run_spec uuid;
  v_spec_status text;
  v_spec_version integer;
  v_spec_action_class text;
  v_existing public.execution_plans%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_plan_id is null then raise exception 'Execution plan id is required'; end if;
  if p_plan_version < 1 then raise exception 'Execution plan version must be positive'; end if;
  if p_delegation_spec_version < 1 then raise exception 'Delegation Spec version must be positive'; end if;
  if p_plan_hash is null or p_plan_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid execution plan hash'; end if;
  if p_created_at is null then raise exception 'Execution plan created_at is required'; end if;
  if p_objective_snapshot is null or char_length(trim(p_objective_snapshot)) = 0 or char_length(p_objective_snapshot) > 1000 then
    raise exception 'Execution plan objective must be between 1 and 1000 characters';
  end if;
  if p_data_policy_snapshot is not null and jsonb_typeof(p_data_policy_snapshot) <> 'object' then
    raise exception 'Execution plan data policy snapshot must be an object';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) < 1 or jsonb_array_length(p_steps) > 100 then
    raise exception 'Execution plan requires between 1 and 100 steps';
  end if;
  if p_authority_class not in ('prepare_only', 'low_risk_execution', 'external_execution', 'sensitive_execution') then
    raise exception 'Invalid execution plan authority class';
  end if;

  select wr.organization_id, wr.delegation_spec_id, ds.status, ds.version, ds.action_class
    into v_run_org, v_run_spec, v_spec_status, v_spec_version, v_spec_action_class
    from public.workstream_runs wr
    join public.delegation_specs ds on ds.id = wr.delegation_spec_id
   where wr.id = p_run_id;
  if v_run_org is null or v_run_org is distinct from p_organization_id then
    raise exception 'Execution plan run does not belong to the supplied organization';
  end if;
  if v_run_spec is distinct from p_delegation_spec_id then
    raise exception 'Execution plan Delegation Spec does not match the run';
  end if;
  if v_spec_status is distinct from 'active' then
    raise exception 'Execution plans require an active Delegation Spec';
  end if;
  if v_spec_version is distinct from p_delegation_spec_version then
    raise exception 'Execution plan Delegation Spec version does not match the active Spec';
  end if;

  v_plan_rank := case p_authority_class
    when 'prepare_only' then 0 when 'low_risk_execution' then 1
    when 'external_execution' then 2 when 'sensitive_execution' then 3 end;
  v_step_rank := case v_spec_action_class
    when 'prepare_only' then 0 when 'low_risk_execution' then 1
    when 'external_execution' then 2 when 'sensitive_execution' then 3 else -1 end;
  if v_step_rank < 0 or v_plan_rank > v_step_rank then
    raise exception 'Execution plan authority exceeds its Delegation Spec authority ceiling';
  end if;

  select * into v_existing from public.execution_plans where id = p_plan_id for update;
  if found then
    if v_existing.organization_id = p_organization_id
       and v_existing.run_id = p_run_id
       and v_existing.delegation_spec_id = p_delegation_spec_id
       and v_existing.plan_version = p_plan_version
       and v_existing.delegation_spec_version = p_delegation_spec_version
       and v_existing.plan_hash = p_plan_hash then
      return p_plan_id;
    end if;
    raise exception 'Execution plan id already exists with different immutable content';
  end if;

  insert into public.execution_plans (
    id, organization_id, run_id, delegation_spec_id, plan_version, delegation_spec_version, plan_hash,
    objective_snapshot, authority_class, data_policy_snapshot, created_at, created_by
  ) values (
    p_plan_id, p_organization_id, p_run_id, p_delegation_spec_id, p_plan_version, p_delegation_spec_version, p_plan_hash,
    p_objective_snapshot, p_authority_class, coalesce(p_data_policy_snapshot, '{}'::jsonb), p_created_at, p_created_by
  ) returning id into v_plan_id;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_step_key := v_step->>'stepKey';
    v_action_class := v_step->>'actionClass';
    v_requires_approval := coalesce((v_step->>'requiresHumanApproval')::boolean, false);
    v_external_side_effect := coalesce((v_step->>'externalSideEffect')::boolean, false);
    v_may_own := coalesce((v_step->>'mayOwnAuthoritativeState')::boolean, false);
    v_step_rank := case v_action_class
      when 'prepare_only' then 0 when 'low_risk_execution' then 1
      when 'external_execution' then 2 when 'sensitive_execution' then 3 else -1 end;
    if v_step_rank < 0 or v_step_rank > v_plan_rank then raise exception 'Step % exceeds the plan authority class', v_step_key; end if;
    if v_may_own then raise exception 'Step % cannot own authoritative state', v_step_key; end if;
    if v_external_side_effect and not v_requires_approval then raise exception 'Step % has an unapproved external side effect', v_step_key; end if;
    if v_action_class in ('external_execution', 'sensitive_execution') and not v_requires_approval then raise exception 'Step % requires human approval', v_step_key; end if;

    insert into public.execution_plan_steps (
      organization_id, plan_id, run_id, step_key, sequence, title, capability_key,
      input_contract_version, output_contract_version, action_class, data_sensitivity,
      depends_on, requires_human_approval, external_side_effect, may_own_authoritative_state,
      max_attempts, deadline_at, created_by
    ) values (
      p_organization_id, v_plan_id, p_run_id, v_step_key,
      (v_step->>'sequence')::integer,
      v_step->>'title', v_step->>'capabilityKey',
      nullif(v_step->>'inputContractVersion', ''),
      nullif(v_step->>'outputContractVersion', ''),
      v_action_class, v_step->>'dataSensitivity',
      coalesce(v_step->'dependsOn', '[]'::jsonb), v_requires_approval,
      v_external_side_effect, false,
      (v_step->>'maxAttempts')::smallint,
      (v_step->>'deadline')::timestamptz, p_created_by
    );
  end loop;

  insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, actor_ref, payload)
  values (p_organization_id, v_plan_id, 'plan_proposed', 'human', p_created_by::text,
          jsonb_build_object('planHash', p_plan_hash, 'planVersion', p_plan_version));
  return v_plan_id;
end;
$$;

revoke all on function public.create_execution_plan(uuid, uuid, uuid, uuid, integer, integer, text, text, text, jsonb, jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.create_execution_plan(uuid, uuid, uuid, uuid, integer, integer, text, text, text, jsonb, jsonb, timestamptz, uuid) to service_role;

create or replace function public.freeze_execution_plan(p_plan_id uuid, p_actor_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_plan public.execution_plans%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  select * into v_plan from public.execution_plans where id = p_plan_id for update;
  if not found then raise exception 'Execution plan not found'; end if;
  if v_plan.status <> 'proposed' then raise exception 'Only proposed execution plans can be frozen'; end if;
  if not exists (select 1 from public.workstream_runs where id = v_plan.run_id and status = 'running') then
    raise exception 'The Workstream Run must be running before its execution plan is frozen';
  end if;
  if not exists (select 1 from public.execution_plan_steps where plan_id = p_plan_id) then
    raise exception 'An execution plan must contain at least one step';
  end if;
  if exists (
    select 1
      from public.execution_plan_steps s
      cross join lateral jsonb_array_elements_text(s.depends_on) dependency(step_key)
     where s.plan_id = p_plan_id
       and not exists (
         select 1 from public.execution_plan_steps dependency_step
          where dependency_step.plan_id = s.plan_id and dependency_step.step_key = dependency.step_key
       )
  ) then
    raise exception 'Execution plan contains an unknown dependency';
  end if;
  if exists (
    with recursive paths(start_key, current_key, path, cycle) as (
      select s.step_key, s.step_key, array[s.step_key]::text[], false
        from public.execution_plan_steps s where s.plan_id = p_plan_id
      union all
      select paths.start_key, dependency.step_key,
             paths.path || array[dependency.step_key],
             dependency.step_key = any(paths.path)
        from paths
        join public.execution_plan_steps s
          on s.plan_id = p_plan_id and s.step_key = paths.current_key
        cross join lateral jsonb_array_elements_text(s.depends_on) dependency(step_key)
       where not paths.cycle and cardinality(paths.path) < 101
    ) select 1 from paths where cycle
  ) then
    raise exception 'Execution plan contains a dependency cycle';
  end if;
  if exists (
    select 1
      from public.execution_plan_steps s
      left join public.capabilities c on c.key = s.capability_key
     where s.plan_id = p_plan_id
       and (c.id is null or c.status <> 'active')
  ) then
    raise exception 'Execution plan contains a capability that is not active in the capability registry';
  end if;

  update public.execution_plans
     set status = 'frozen', frozen_by = p_actor_id, frozen_at = now()
   where id = p_plan_id;

  update public.execution_plan_steps
     set status = case when requires_human_approval then 'awaiting_approval' else 'ready' end
   where plan_id = p_plan_id and status = 'pending' and jsonb_array_length(depends_on) = 0;

  insert into public.execution_approval_requests (
    organization_id, plan_id, step_id, action_class, requested_action, requested_by
  )
  select s.organization_id, s.plan_id, s.id, s.action_class, s.title, p_actor_id
    from public.execution_plan_steps s
   where s.plan_id = p_plan_id and s.status = 'awaiting_approval'
     and not exists (
       select 1 from public.execution_approval_requests a
        where a.step_id = s.id and a.status in ('pending', 'approved')
     );

  -- Release the initial queue in the same transaction as the freeze. This also
  -- applies the hard deadline gate before any worker can observe the plan.
  perform public.refresh_execution_plan_queue(p_plan_id);

  insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, actor_ref, payload)
  values (v_plan.organization_id, p_plan_id, 'plan_frozen', 'human', p_actor_id::text,
          jsonb_build_object('frozenAt', now()));
end;
$$;

revoke all on function public.freeze_execution_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.freeze_execution_plan(uuid, uuid) to service_role;

create or replace function public.refresh_execution_plan_queue(p_plan_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_plan public.execution_plans%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  select * into v_plan from public.execution_plans where id = p_plan_id for update;
  if not found then raise exception 'Execution plan not found'; end if;
  if v_plan.status in ('completed', 'failed', 'cancelled') then return; end if;

  -- A deadline is a hard control boundary. Expired work is blocked before it
  -- can be released or claimed; it is never silently run late.
  update public.execution_plan_steps
     set status = 'blocked',
         last_failure_class = 'cost_limit',
         last_failure_code = 'deadline_exceeded',
         last_failure_summary = 'Stage deadline elapsed before the stage was claimed.',
         completed_at = now(),
         lease_worker_id = null,
         lease_expires_at = null
   where plan_id = p_plan_id
     and status in ('pending', 'ready', 'awaiting_approval')
     and deadline_at <= now();

  update public.execution_plan_steps s
     set status = case
       when exists (
         select 1 from jsonb_array_elements_text(s.depends_on) dependency(step_key)
         join public.execution_plan_steps d
           on d.plan_id = s.plan_id and d.step_key = dependency.step_key
        where d.status in ('failed', 'blocked', 'cancelled')
       ) then 'blocked'
       when not exists (
         select 1 from jsonb_array_elements_text(s.depends_on) dependency(step_key)
         left join public.execution_plan_steps d
           on d.plan_id = s.plan_id and d.step_key = dependency.step_key
        where d.status is distinct from 'succeeded'
       ) and s.requires_human_approval
       and not exists (
         select 1 from public.execution_approval_requests a
          where a.step_id = s.id and a.status = 'approved'
       ) then 'awaiting_approval'
       when not exists (
         select 1 from jsonb_array_elements_text(s.depends_on) dependency(step_key)
         left join public.execution_plan_steps d
           on d.plan_id = s.plan_id and d.step_key = dependency.step_key
        where d.status is distinct from 'succeeded'
       ) then 'ready'
       else s.status
     end
   where s.plan_id = p_plan_id and s.status = 'pending';

  update public.execution_plan_steps s
     set status = case
       when exists (select 1 from public.execution_approval_requests a where a.step_id = s.id and a.status = 'approved') then 'ready'
       when exists (select 1 from public.execution_approval_requests a where a.step_id = s.id and a.status = 'rejected') then 'blocked'
       else s.status
     end
   where s.plan_id = p_plan_id and s.status = 'awaiting_approval';

  insert into public.execution_approval_requests (
    organization_id, plan_id, step_id, action_class, requested_action
  )
  select s.organization_id, s.plan_id, s.id, s.action_class, s.title
    from public.execution_plan_steps s
   where s.plan_id = p_plan_id and s.status = 'awaiting_approval'
     and not exists (
       select 1 from public.execution_approval_requests a
        where a.step_id = s.id and a.status in ('pending', 'approved')
     );

  if not exists (select 1 from public.execution_plan_steps where plan_id = p_plan_id and status <> 'succeeded') then
    update public.execution_plans set status = 'completed', completed_at = now() where id = p_plan_id;
    insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, payload)
    values (v_plan.organization_id, p_plan_id, 'plan_completed', 'system', '{}'::jsonb);
  elsif exists (select 1 from public.execution_plan_steps where plan_id = p_plan_id and status = 'failed') then
    update public.execution_plans set status = 'failed', completed_at = now() where id = p_plan_id;
    insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, payload)
    values (v_plan.organization_id, p_plan_id, 'plan_failed', 'system', '{}'::jsonb);
  elsif exists (select 1 from public.execution_plan_steps where plan_id = p_plan_id and status = 'blocked') then
    update public.execution_plans set status = 'blocked' where id = p_plan_id;
    insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, payload)
    values (v_plan.organization_id, p_plan_id, 'plan_blocked', 'system', '{}'::jsonb);
  elsif exists (select 1 from public.execution_plan_steps where plan_id = p_plan_id and status = 'awaiting_approval') then
    update public.execution_plans set status = 'awaiting_approval' where id = p_plan_id;
  elsif v_plan.status in ('frozen', 'awaiting_approval', 'blocked')
     or exists (select 1 from public.execution_plan_steps where plan_id = p_plan_id and status in ('ready', 'running', 'awaiting_verification')) then
    update public.execution_plans set status = 'running', started_at = coalesce(started_at, now()) where id = p_plan_id;
  end if;
end;
$$;

revoke all on function public.refresh_execution_plan_queue(uuid) from public, anon, authenticated;
grant execute on function public.refresh_execution_plan_queue(uuid) to service_role;
