\set ON_ERROR_STOP on
\pset pager off

-- End-to-end QA proof for Execution Runtime v1.
--
-- Preconditions:
--   * This is the dedicated Delegation Cloud QA project.
--   * The existing QA fixture contains the organization, manager user,
--     LOADOUT workstream, and active prepare-only Delegation Spec below.
--   * The runtime schema and RPC migrations have already been applied.
--
-- The proof uses service_role because runtime mutations are deliberately
-- server-only. It creates disposable Workstream Runs and plans, then rolls
-- the complete fixture back before the script exits. The temporary active
-- external-authority spec exists only inside that rollback-isolated proof so
-- the approval path and executor authority ceiling can be tested without
-- changing the product's durable authority boundary.
--
-- Never run this against Production or an unrelated Supabase project.

begin;
set local role service_role;

do $proof$
declare
  v_org_id uuid := 'bd832a07-729f-4ce3-b961-8b82fdb46f35';
  v_manager_id uuid := 'c0b2ab6c-c56d-4435-89fd-f972ce552609';
  v_spec_id uuid := '37bf390f-43bf-48db-af38-63fab1a91ac9';
  v_workstream_id uuid := '2a984b48-3601-4cd4-90b4-0efa9183a4ab';
  v_approval_workstream_id uuid := 'd7a00005-0000-4000-8000-000000000005';
  v_approval_spec_id uuid := 'd7a00005-0000-4000-8000-000000000004';
  v_run_lifecycle uuid := 'd7a00001-0000-4000-8000-000000000001';
  v_plan_lifecycle uuid := 'd7a00001-0000-4000-8000-000000000002';
  v_run_failure uuid := 'd7a00002-0000-4000-8000-000000000001';
  v_plan_failure uuid := 'd7a00002-0000-4000-8000-000000000002';
  v_run_reaper uuid := 'd7a00003-0000-4000-8000-000000000001';
  v_plan_reaper uuid := 'd7a00003-0000-4000-8000-000000000002';
  v_run_cancel uuid := 'd7a00004-0000-4000-8000-000000000001';
  v_plan_cancel uuid := 'd7a00004-0000-4000-8000-000000000002';
  v_run_approval uuid := 'd7a00005-0000-4000-8000-000000000001';
  v_plan_approval uuid := 'd7a00005-0000-4000-8000-000000000002';
  v_plan_guard uuid := 'd7a00006-0000-4000-8000-000000000002';
  v_spec_version integer;
  v_capability_key text := 'deterministic_catalog_validation';
  v_worker_id text := 'catalog-evidence-validator-v1';
  v_deadline timestamptz := now() + interval '1 hour';
  v_steps jsonb;
  v_approval_steps jsonb;
  v_returned_plan uuid;
  v_step_id uuid;
  v_attempt_id uuid;
  v_approval_id uuid;
  v_lease_expires timestamptz;
  v_claim_count integer;
  v_reaped integer;
  v_event_count integer;
  v_plan_status text;
  v_step_status text;
  v_attempt_status text;
  v_approval_status text;
begin
  begin
    if not exists (select 1 from public.organizations where id = v_org_id)
       or not exists (
         select 1 from public.workstreams
         where id = v_workstream_id and organization_id = v_org_id
       )
       or not exists (
         select 1 from public.delegation_specs
         where id = v_spec_id
           and organization_id = v_org_id
           and workstream_id = v_workstream_id
           and status = 'active'
       )
       or not exists (
         select 1 from public.capabilities
         where key = v_capability_key and status = 'active'
       )
       or not exists (
         select 1
         from public.executor_profiles ep
         join public.executor_capabilities ec
           on ec.executor_profile_id = ep.id
          and ec.qualification_status = 'qualified'
          and ec.suspended_at is null
         join public.capabilities c
           on c.id = ec.capability_id
          and c.key = v_capability_key
          and c.status = 'active'
         where ep.key = v_worker_id
           and ep.status = 'active'
       ) then
      raise exception 'Required Delegation Cloud QA runtime fixture is missing';
    end if;

    select version into v_spec_version
    from public.delegation_specs
    where id = v_spec_id;

    if exists (
      select 1
      from public.workstream_runs
      where id in (
        v_run_lifecycle, v_run_failure, v_run_reaper, v_run_cancel,
        v_run_approval
      )
    )
    or exists (
      select 1
      from public.execution_plans
      where id in (
        v_plan_lifecycle, v_plan_failure, v_plan_reaper,
        v_plan_cancel, v_plan_approval, v_plan_guard
      )
    )
    or exists (
      select 1
      from public.workstreams
      where id = v_approval_workstream_id
    )
    or exists (
      select 1
      from public.delegation_specs
      where id = v_approval_spec_id
    ) then
      raise exception 'Execution Runtime QA sentinel IDs or version already exist; refusing to run';
    end if;

    v_steps := jsonb_build_array(
      jsonb_build_object(
        'stepKey', 'prepare',
        'sequence', 1,
        'title', 'Disposable Execution Runtime prepare step',
        'capabilityKey', v_capability_key,
        'actionClass', 'prepare_only',
        'dataSensitivity', 'internal',
        'dependsOn', '[]'::jsonb,
        'requiresHumanApproval', false,
        'externalSideEffect', false,
        'mayOwnAuthoritativeState', false,
        'maxAttempts', 1,
        'deadline', v_deadline
      )
    );

    v_approval_steps := jsonb_build_array(
      jsonb_build_object(
        'stepKey', 'external-review',
        'sequence', 1,
        'title', 'Disposable approved external review step',
        'capabilityKey', v_capability_key,
        'actionClass', 'external_execution',
        'dataSensitivity', 'internal',
        'dependsOn', '[]'::jsonb,
        'requiresHumanApproval', true,
        'externalSideEffect', true,
        'mayOwnAuthoritativeState', false,
        'maxAttempts', 1,
        'deadline', v_deadline
      )
    );

    -- Lifecycle and idempotent plan creation.
    insert into public.workstream_runs (
      id, organization_id, workstream_id, delegation_spec_id,
      status, initiated_by
    ) values (
      v_run_lifecycle, v_org_id, v_workstream_id, v_spec_id,
      'planned', v_manager_id
    );
    update public.workstream_runs
       set status = 'running', started_at = now()
     where id = v_run_lifecycle;

    select public.create_execution_plan(
      v_plan_lifecycle, v_org_id, v_run_lifecycle, v_spec_id,
      1, v_spec_version, repeat('a', 64),
      'Disposable Execution Runtime lifecycle proof',
      'prepare_only', '{"proof":"execution-runtime-v1"}'::jsonb,
      v_steps, now(), v_manager_id
    ) into v_returned_plan;

    if v_returned_plan <> v_plan_lifecycle then
      raise exception 'QA_PROOF_FAILED: initial plan creation returned the wrong id';
    end if;

    select public.create_execution_plan(
      v_plan_lifecycle, v_org_id, v_run_lifecycle, v_spec_id,
      1, v_spec_version, repeat('a', 64),
      'Disposable Execution Runtime lifecycle proof',
      'prepare_only', '{"proof":"execution-runtime-v1"}'::jsonb,
      v_steps, now(), v_manager_id
    ) into v_returned_plan;

    if v_returned_plan <> v_plan_lifecycle then
      raise exception 'QA_PROOF_FAILED: identical plan creation was not idempotent';
    end if;

    perform public.freeze_execution_plan(v_plan_lifecycle, v_manager_id);

    select p.status, s.status, s.id
      into v_plan_status, v_step_status, v_step_id
    from public.execution_plans p
    join public.execution_plan_steps s on s.plan_id = p.id
    where p.id = v_plan_lifecycle
      and s.step_key = 'prepare';

    if v_plan_status <> 'running' or v_step_status <> 'ready' then
      raise exception 'QA_PROOF_FAILED: freeze did not release the initial ready queue';
    end if;

    -- Atomic claim and duplicate-claim prevention.
    select c.attempt_id, c.step_id
      into v_attempt_id, v_step_id
    from public.claim_execution_step(
      v_worker_id, v_capability_key, repeat('a', 64), 60
    ) c;

    if not found or v_attempt_id is null or v_step_id is null then
      raise exception 'QA_PROOF_FAILED: qualified worker could not claim a ready step';
    end if;

    select count(*) into v_claim_count
    from public.claim_execution_step(
      v_worker_id, v_capability_key, repeat('b', 64), 60
    );

    if v_claim_count <> 0
       or (select count(*) from public.execution_attempts where step_id = v_step_id) <> 1 then
      raise exception 'QA_PROOF_FAILED: a claimed step was claimable twice';
    end if;

    select public.heartbeat_execution_attempt(
      v_attempt_id, v_worker_id, repeat('a', 64), 60
    ) into v_lease_expires;

    if v_lease_expires <= now() then
      raise exception 'QA_PROOF_FAILED: heartbeat did not extend the lease';
    end if;

    begin
      perform public.heartbeat_execution_attempt(
        v_attempt_id, v_worker_id, repeat('b', 64), 60
      );
      raise exception 'QA_PROOF_FAILED: invalid lease credentials were accepted';
    exception when others then
      if sqlerrm not like 'Execution lease credential mismatch%' then
        raise;
      end if;
    end;

    select status into v_attempt_status
    from public.execution_attempts
    where id = v_attempt_id;

    if v_attempt_status <> 'running' then
      raise exception 'QA_PROOF_FAILED: rejected heartbeat changed attempt state';
    end if;

    perform public.complete_execution_attempt(
      v_attempt_id, v_worker_id, repeat('a', 64),
      '[]'::jsonb, '{"proof":"runtime-lifecycle"}'::jsonb,
      1, 2, 3
    );

    select p.status, s.status, a.status
      into v_plan_status, v_step_status, v_attempt_status
    from public.execution_plans p
    join public.execution_plan_steps s on s.plan_id = p.id
    join public.execution_attempts a on a.plan_id = p.id
    where p.id = v_plan_lifecycle;

    if v_plan_status <> 'completed'
       or v_step_status <> 'succeeded'
       or v_attempt_status <> 'succeeded' then
      raise exception 'QA_PROOF_FAILED: successful completion did not close the lifecycle';
    end if;

    select count(*) into v_event_count
    from public.execution_events
    where plan_id = v_plan_lifecycle
      and event_type in (
        'plan_proposed', 'plan_frozen', 'attempt_started',
        'attempt_heartbeat', 'attempt_succeeded', 'plan_completed'
      );

    if v_event_count <> 6 then
      raise exception 'QA_PROOF_FAILED: lifecycle event history was incomplete';
    end if;

    -- Terminal worker failure with a bounded no-retry decision.
    insert into public.workstream_runs (
      id, organization_id, workstream_id, delegation_spec_id,
      status, initiated_by
    ) values (
      v_run_failure, v_org_id, v_workstream_id, v_spec_id,
      'planned', v_manager_id
    );
    update public.workstream_runs
       set status = 'running', started_at = now()
     where id = v_run_failure;

    perform public.create_execution_plan(
      v_plan_failure, v_org_id, v_run_failure, v_spec_id,
      1, v_spec_version, repeat('c', 64),
      'Disposable Execution Runtime failure proof',
      'prepare_only', '{"proof":"execution-runtime-v1"}'::jsonb,
      v_steps, now(), v_manager_id
    );
    perform public.freeze_execution_plan(v_plan_failure, v_manager_id);

    select c.attempt_id
      into v_attempt_id
    from public.claim_execution_step(
      v_worker_id, v_capability_key, repeat('c', 64), 60
    ) c;

    if not found then
      raise exception 'QA_PROOF_FAILED: failure proof step was not claimable';
    end if;

    perform public.fail_execution_attempt(
      v_attempt_id, v_worker_id, repeat('c', 64),
      'executor_failure', 'qa_failure',
      'Disposable executor failure for the runtime proof.',
      '{}'::jsonb, 0, 0, 0, false
    );

    select p.status, s.status, a.status
      into v_plan_status, v_step_status, v_attempt_status
    from public.execution_plans p
    join public.execution_plan_steps s on s.plan_id = p.id
    join public.execution_attempts a on a.plan_id = p.id
    where p.id = v_plan_failure;

    if v_plan_status <> 'failed'
       or v_step_status <> 'failed'
       or v_attempt_status <> 'failed' then
      raise exception 'QA_PROOF_FAILED: terminal failure did not fail closed';
    end if;

    if (select count(*) from public.execution_events
        where plan_id = v_plan_failure
          and event_type = 'attempt_failed') <> 1
       or (select count(*) from public.execution_events
        where plan_id = v_plan_failure
          and event_type = 'plan_failed') <> 1 then
      raise exception 'QA_PROOF_FAILED: terminal failure events were incomplete';
    end if;

    -- Lease expiry is reaped as an expired attempt and a failed step.
    insert into public.workstream_runs (
      id, organization_id, workstream_id, delegation_spec_id,
      status, initiated_by
    ) values (
      v_run_reaper, v_org_id, v_workstream_id, v_spec_id,
      'planned', v_manager_id
    );
    update public.workstream_runs
       set status = 'running', started_at = now()
     where id = v_run_reaper;

    perform public.create_execution_plan(
      v_plan_reaper, v_org_id, v_run_reaper, v_spec_id,
      1, v_spec_version, repeat('e', 64),
      'Disposable Execution Runtime reaper proof',
      'prepare_only', '{"proof":"execution-runtime-v1"}'::jsonb,
      v_steps, now(), v_manager_id
    );
    perform public.freeze_execution_plan(v_plan_reaper, v_manager_id);

    select c.attempt_id
      into v_attempt_id
    from public.claim_execution_step(
      v_worker_id, v_capability_key, repeat('e', 64), 60
    ) c;

    if not found then
      raise exception 'QA_PROOF_FAILED: reaper proof step was not claimable';
    end if;

    update public.execution_attempts
       set lease_expires_at = now() - interval '1 minute'
     where id = v_attempt_id;
    update public.execution_plan_steps
       set lease_expires_at = now() - interval '1 minute'
     where plan_id = v_plan_reaper
       and status = 'running';

    select public.reap_execution_leases(10) into v_reaped;

    if v_reaped <> 1 then
      raise exception 'QA_PROOF_FAILED: lease reaper did not reap exactly one expired attempt';
    end if;

    select p.status, s.status, a.status
      into v_plan_status, v_step_status, v_attempt_status
    from public.execution_plans p
    join public.execution_plan_steps s on s.plan_id = p.id
    join public.execution_attempts a on a.plan_id = p.id
    where p.id = v_plan_reaper;

    if v_plan_status <> 'failed'
       or v_step_status <> 'failed'
       or v_attempt_status <> 'expired' then
      raise exception 'QA_PROOF_FAILED: reaper did not preserve an explicit expired-attempt outcome';
    end if;

    if (select count(*) from public.execution_events
        where plan_id = v_plan_reaper
          and event_type = 'attempt_expired') <> 1 then
      raise exception 'QA_PROOF_FAILED: reaper did not emit an expiry event';
    end if;

    -- Cancellation must close both an active attempt and its plan.
    insert into public.workstream_runs (
      id, organization_id, workstream_id, delegation_spec_id,
      status, initiated_by
    ) values (
      v_run_cancel, v_org_id, v_workstream_id, v_spec_id,
      'planned', v_manager_id
    );
    update public.workstream_runs
       set status = 'running', started_at = now()
     where id = v_run_cancel;

    perform public.create_execution_plan(
      v_plan_cancel, v_org_id, v_run_cancel, v_spec_id,
      1, v_spec_version, repeat('f', 64),
      'Disposable Execution Runtime cancellation proof',
      'prepare_only', '{"proof":"execution-runtime-v1"}'::jsonb,
      v_steps, now(), v_manager_id
    );
    perform public.freeze_execution_plan(v_plan_cancel, v_manager_id);

    select c.attempt_id
      into v_attempt_id
    from public.claim_execution_step(
      v_worker_id, v_capability_key, repeat('f', 64), 60
    ) c;

    if not found then
      raise exception 'QA_PROOF_FAILED: cancellation proof step was not claimable';
    end if;

    perform public.cancel_execution_plan(v_plan_cancel, v_manager_id);

    select p.status, s.status, a.status
      into v_plan_status, v_step_status, v_attempt_status
    from public.execution_plans p
    join public.execution_plan_steps s on s.plan_id = p.id
    join public.execution_attempts a on a.plan_id = p.id
    where p.id = v_plan_cancel;

    if v_plan_status <> 'cancelled'
       or v_step_status <> 'cancelled'
       or v_attempt_status <> 'cancelled' then
      raise exception 'QA_PROOF_FAILED: cancellation did not close active runtime state';
    end if;

    -- Approval path: use a temporary higher-authority Spec only within the
    -- rollback-isolated proof. The prepare-only worker must still be unable
    -- to claim the approved external step.
    insert into public.workstreams (
      id, organization_id, name, objective, sla,
      recurring_tasks, metrics, owner_user_id, status,
      health_score, hours_returned
    ) values (
      v_approval_workstream_id, v_org_id,
      'Disposable Execution Runtime approval workstream',
      'Disposable approval-path QA fixture',
      'qa-only',
      '{}'::jsonb, '{}'::jsonb, v_manager_id, 'active', 0, 0
    );

    insert into public.delegation_specs (
      id, organization_id, workstream_id, version, status,
      objective, definition_of_done, trigger_description, required_inputs,
      action_class, authority_rules, approval_points, verification_rules,
      exception_policy, sla, economic_envelope, data_policy,
      created_by, activated_by, activated_at
    )
    select
      v_approval_spec_id, ds.organization_id, v_approval_workstream_id, 1,
      'active', ds.objective, ds.definition_of_done, ds.trigger_description,
      ds.required_inputs, 'external_execution', ds.authority_rules,
      ds.approval_points, ds.verification_rules, ds.exception_policy,
      ds.sla, ds.economic_envelope, ds.data_policy,
      v_manager_id, v_manager_id, now()
    from public.delegation_specs ds
    where ds.id = v_spec_id;

    insert into public.workstream_runs (
      id, organization_id, workstream_id, delegation_spec_id,
      status, initiated_by
    ) values (
      v_run_approval, v_org_id, v_approval_workstream_id, v_approval_spec_id,
      'planned', v_manager_id
    );
    update public.workstream_runs
       set status = 'running', started_at = now()
     where id = v_run_approval;

    perform public.create_execution_plan(
      v_plan_approval, v_org_id, v_run_approval, v_approval_spec_id,
      1, 1, repeat('9', 64),
      'Disposable Execution Runtime approval proof',
      'external_execution', '{"proof":"execution-runtime-v1"}'::jsonb,
      v_approval_steps, now(), v_manager_id
    );
    perform public.freeze_execution_plan(v_plan_approval, v_manager_id);

    select a.id, a.status, s.status
      into v_approval_id, v_approval_status, v_step_status
    from public.execution_approval_requests a
    join public.execution_plan_steps s on s.id = a.step_id
    where a.plan_id = v_plan_approval;

    select status into v_plan_status
    from public.execution_plans
    where id = v_plan_approval;

    if v_approval_id is null
       or v_approval_status <> 'pending'
       or v_step_status <> 'awaiting_approval'
       or v_plan_status <> 'awaiting_approval' then
      raise exception 'QA_PROOF_FAILED: freeze did not create an approval hold';
    end if;

    perform public.decide_execution_approval(
      v_approval_id, 'approved', v_manager_id,
      'Disposable approval-path proof'
    );

    select p.status, s.status, a.status
      into v_plan_status, v_step_status, v_approval_status
    from public.execution_plans p
    join public.execution_plan_steps s on s.plan_id = p.id
    join public.execution_approval_requests a on a.plan_id = p.id;

    if v_plan_status <> 'running'
       or v_step_status <> 'ready'
       or v_approval_status <> 'approved' then
      raise exception 'QA_PROOF_FAILED: approval did not release the step';
    end if;

    select count(*) into v_claim_count
    from public.claim_execution_step(
      v_worker_id, v_capability_key, repeat('9', 64), 60
    );

    if v_claim_count <> 0
       or (select count(*) from public.execution_attempts
           where plan_id = v_plan_approval) <> 0 then
      raise exception 'QA_PROOF_FAILED: prepare-only executor claimed an approved external step';
    end if;

    -- Authority ceiling guard: a prepare-only Spec cannot create a higher
    -- authority plan, and the failed request must leave no durable plan row.
    begin
      perform public.create_execution_plan(
        v_plan_guard, v_org_id, v_run_cancel, v_spec_id,
        2, v_spec_version, repeat('8', 64),
        'Disposable Execution Runtime authority guard proof',
        'external_execution', '{"proof":"execution-runtime-v1"}'::jsonb,
        v_approval_steps, now(), v_manager_id
      );
      raise exception 'QA_PROOF_FAILED: prepare-only Spec created external plan authority';
    exception when others then
      if sqlerrm not like 'Execution plan authority exceeds%' then
        raise;
      end if;
    end;

    if exists (select 1 from public.execution_plans where id = v_plan_guard)
       or exists (select 1 from public.execution_plan_steps where plan_id = v_plan_guard) then
      raise exception 'QA_PROOF_FAILED: rejected authority request left runtime rows';
    end if;

    -- Deliberately raise the rollback marker. The inner block catches it,
    -- rolling back every disposable row while preserving the pass result.
    raise exception '__QA_RUNTIME_PROOF_ROLLBACK__';
  exception when others then
    if sqlerrm <> '__QA_RUNTIME_PROOF_ROLLBACK__' then
      raise;
    end if;
  end;
end
$proof$;

rollback;

select
  'execution_runtime_v1_fixture' as proof,
  true as passed,
  'transaction rolled back; disposable runs, plans, attempts, approvals, events, and temporary workstream, authority spec, and runtime rows were not retained' as isolation;
