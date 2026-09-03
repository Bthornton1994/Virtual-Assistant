-- Delegation Cloud Execution Runtime v1
--
-- This migration adds the durable execution plane suggested by the
-- Auto-Company reference project: bounded plans, dependency-aware stages,
-- leases, append-only attempts/events, explicit approval holds, and bounded
-- recovery. It does not grant external authority and it does not replace the
-- Delegation Spec, Workstream Run, evidence, Outcome Receipt, or Gauntlet.

create table public.execution_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.workstream_runs(id) on delete cascade,
  delegation_spec_id uuid not null references public.delegation_specs(id) on delete restrict,
  plan_version integer not null default 1 check (plan_version > 0),
  delegation_spec_version integer not null check (delegation_spec_version > 0),
  status text not null default 'proposed' check (status in (
    'proposed', 'frozen', 'running', 'awaiting_approval', 'blocked',
    'completed', 'failed', 'cancelled'
  )),
  plan_hash text not null check (plan_hash ~ '^[0-9a-f]{64}$'),
  objective_snapshot text not null,
  authority_class text not null check (authority_class in (
    'prepare_only', 'low_risk_execution', 'external_execution', 'sensitive_execution'
  )),
  data_policy_snapshot jsonb not null default '{}'::jsonb,
  may_own_authoritative_state boolean not null default false check (may_own_authoritative_state = false),
  created_by uuid references auth.users(id) on delete set null,
  frozen_by uuid references auth.users(id) on delete set null,
  frozen_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, plan_version),
  unique (id, organization_id)
);

create index execution_plans_org_status_idx
  on public.execution_plans (organization_id, status, created_at desc);
create index execution_plans_run_idx
  on public.execution_plans (run_id, plan_version desc);

create table public.execution_plan_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  run_id uuid not null,
  step_key text not null check (step_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  sequence integer not null check (sequence > 0),
  title text not null check (char_length(title) between 1 and 240),
  capability_key text not null check (capability_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  input_contract_version text,
  output_contract_version text,
  action_class text not null check (action_class in (
    'prepare_only', 'low_risk_execution', 'external_execution', 'sensitive_execution'
  )),
  data_sensitivity text not null check (data_sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  depends_on jsonb not null default '[]'::jsonb check (jsonb_typeof(depends_on) = 'array'),
  requires_human_approval boolean not null default false,
  external_side_effect boolean not null default false,
  may_own_authoritative_state boolean not null default false check (may_own_authoritative_state = false),
  max_attempts smallint not null default 1 check (max_attempts between 1 and 10),
  deadline_at timestamptz not null,
  status text not null default 'pending' check (status in (
    'pending', 'ready', 'leased', 'running', 'awaiting_approval',
    'awaiting_verification', 'succeeded', 'failed', 'blocked', 'cancelled'
  )),
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= max_attempts),
  lease_worker_id text,
  lease_expires_at timestamptz,
  input_artifact_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(input_artifact_ids) = 'array'),
  output_artifact_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(output_artifact_ids) = 'array'),
  last_failure_class text,
  last_failure_code text,
  last_failure_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, step_key),
  unique (plan_id, sequence),
  unique (id, organization_id),
  foreign key (plan_id, organization_id)
    references public.execution_plans(id, organization_id) on delete cascade,
  foreign key (run_id, organization_id)
    references public.workstream_runs(id, organization_id) on delete cascade
);

create index execution_plan_steps_queue_idx
  on public.execution_plan_steps (status, available_at, sequence, created_at)
  where status in ('ready', 'pending', 'awaiting_approval');
create index execution_plan_steps_plan_idx
  on public.execution_plan_steps (plan_id, sequence);
create index execution_plan_steps_org_idx
  on public.execution_plan_steps (organization_id, status, updated_at desc);
create index execution_plan_steps_lease_idx
  on public.execution_plan_steps (lease_expires_at)
  where status = 'running';

create table public.execution_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  step_id uuid not null,
  run_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('claimed', 'running', 'succeeded', 'failed', 'expired', 'cancelled')),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  lease_token_hash text not null check (lease_token_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz not null,
  heartbeat_at timestamptz,
  executor_key text,
  executor_kind text check (executor_kind is null or executor_kind in ('agent', 'deterministic', 'human')),
  authority_snapshot jsonb not null default '{}'::jsonb,
  context_hash text check (context_hash is null or context_hash ~ '^[0-9a-f]{64}$'),
  input_artifact_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(input_artifact_ids) = 'array'),
  output_artifact_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(output_artifact_ids) = 'array'),
  failure_class text check (failure_class is null or failure_class in (
    'bad_input', 'executor_failure', 'evidence_failure', 'qa_failure',
    'integration_failure', 'source_ambiguity', 'authority_limit', 'policy_conflict',
    'business_strategy_failure', 'cost_limit', 'security_incident',
    'external_dependency', 'unknown'
  )),
  failure_code text,
  failure_summary text,
  retry_decision text check (retry_decision is null or retry_decision in (
    'retry_same_executor', 'retry_different_executor', 'correct_inputs_then_retry',
    'escalate_human', 'replan', 'suspend_workstream', 'no_retry'
  )),
  human_minutes numeric(10,2) not null default 0 check (human_minutes >= 0),
  ai_cost_micros bigint not null default 0 check (ai_cost_micros >= 0),
  tool_cost_micros bigint not null default 0 check (tool_cost_micros >= 0),
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (step_id, attempt_number),
  unique (id, organization_id),
  foreign key (plan_id, organization_id)
    references public.execution_plans(id, organization_id) on delete cascade,
  foreign key (step_id, organization_id)
    references public.execution_plan_steps(id, organization_id) on delete cascade,
  foreign key (run_id, organization_id)
    references public.workstream_runs(id, organization_id) on delete cascade
);

create index execution_attempts_step_idx
  on public.execution_attempts (step_id, attempt_number desc);
create index execution_attempts_lease_idx
  on public.execution_attempts (status, lease_expires_at)
  where status in ('claimed', 'running');
create index execution_attempts_org_idx
  on public.execution_attempts (organization_id, created_at desc);

create table public.execution_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  step_id uuid not null,
  action_class text not null check (action_class in (
    'external_execution', 'sensitive_execution'
  )),
  requested_action text not null check (char_length(requested_action) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (plan_id, organization_id)
    references public.execution_plans(id, organization_id) on delete cascade,
  foreign key (step_id, organization_id)
    references public.execution_plan_steps(id, organization_id) on delete cascade
);

create unique index execution_approval_one_pending_idx
  on public.execution_approval_requests (step_id)
  where status = 'pending';
create index execution_approval_org_status_idx
  on public.execution_approval_requests (organization_id, status, requested_at desc);

create table public.execution_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid,
  step_id uuid,
  attempt_id uuid,
  event_type text not null check (event_type in (
    'plan_proposed', 'plan_frozen', 'plan_started', 'plan_blocked',
    'plan_completed', 'plan_failed', 'plan_cancelled', 'stage_ready',
    'stage_blocked', 'attempt_started', 'attempt_heartbeat', 'attempt_succeeded',
    'attempt_failed', 'attempt_expired', 'retry_scheduled', 'approval_requested',
    'approval_approved', 'approval_rejected', 'stage_cancelled', 'queue_refreshed'
  )),
  actor_kind text not null check (actor_kind in ('system', 'worker', 'human')),
  actor_ref text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (plan_id, organization_id)
    references public.execution_plans(id, organization_id) on delete cascade,
  foreign key (step_id, organization_id)
    references public.execution_plan_steps(id, organization_id) on delete cascade,
  foreign key (attempt_id, organization_id)
    references public.execution_attempts(id, organization_id) on delete cascade
);

create index execution_events_plan_idx
  on public.execution_events (plan_id, created_at desc, id desc);
create index execution_events_step_idx
  on public.execution_events (step_id, created_at desc, id desc);
create index execution_events_org_idx
  on public.execution_events (organization_id, created_at desc, id desc);

create or replace function public.prevent_execution_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Execution events are append-only';
end;
$$;

create trigger trg_execution_events_append_only
  before update or delete on public.execution_events
  for each row execute function public.prevent_execution_event_mutation();

create trigger trg_execution_plans_updated
  before update on public.execution_plans
  for each row execute function public.set_updated_at();
create trigger trg_execution_plan_steps_updated
  before update on public.execution_plan_steps
  for each row execute function public.set_updated_at();

alter table public.execution_plans enable row level security;
alter table public.execution_plan_steps enable row level security;
alter table public.execution_attempts enable row level security;
alter table public.execution_approval_requests enable row level security;
alter table public.execution_events enable row level security;

grant select on public.execution_plans, public.execution_plan_steps,
  public.execution_attempts, public.execution_events to authenticated;
grant select on public.execution_approval_requests to authenticated;
grant all on public.execution_plans, public.execution_plan_steps, public.execution_attempts,
  public.execution_approval_requests, public.execution_events to service_role;
grant usage, select on sequence public.execution_events_id_seq to service_role;

create policy execution_plans_select on public.execution_plans
  for select to authenticated using (public.is_platform_staff());
create policy execution_plan_steps_select on public.execution_plan_steps
  for select to authenticated using (public.is_platform_staff());
create policy execution_attempts_select on public.execution_attempts
  for select to authenticated using (public.is_platform_staff());
create policy execution_events_select on public.execution_events
  for select to authenticated using (public.is_platform_staff());

create policy execution_approval_select on public.execution_approval_requests
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create or replace function public.enforce_execution_plan_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_org uuid;
  run_spec uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' then
      raise exception 'Execution plans must start in proposed status';
    end if;
    if new.may_own_authoritative_state then
      raise exception 'Execution plans cannot own authoritative state';
    end if;
    select organization_id, delegation_spec_id
      into run_org, run_spec
      from public.workstream_runs
     where id = new.run_id;
    if run_org is null or run_org is distinct from new.organization_id then
      raise exception 'Execution plan must belong to the same organization as its run';
    end if;
    if run_spec is distinct from new.delegation_spec_id then
      raise exception 'Execution plan must use the run''s Delegation Spec';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.run_id, new.delegation_spec_id,
    new.plan_version, new.delegation_spec_version, new.plan_hash, new.objective_snapshot,
    new.authority_class, new.data_policy_snapshot,
    new.may_own_authoritative_state, new.created_by, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.run_id, old.delegation_spec_id,
    old.plan_version, old.delegation_spec_version, old.plan_hash, old.objective_snapshot,
    old.authority_class, old.data_policy_snapshot,
    old.may_own_authoritative_state, old.created_by, old.created_at
  ) then
    raise exception 'Execution plan contract and identity are immutable';
  end if;

  if old.status = 'proposed' and new.status not in ('proposed', 'frozen', 'cancelled') then
    raise exception 'Invalid execution plan transition: % -> %', old.status, new.status;
  elsif old.status = 'frozen' and new.status not in ('frozen', 'running', 'awaiting_approval', 'blocked', 'cancelled') then
    raise exception 'Invalid execution plan transition: % -> %', old.status, new.status;
  elsif old.status = 'running' and new.status not in ('running', 'awaiting_approval', 'blocked', 'completed', 'failed', 'cancelled') then
    raise exception 'Invalid execution plan transition: % -> %', old.status, new.status;
  elsif old.status = 'awaiting_approval' and new.status not in ('awaiting_approval', 'running', 'blocked', 'cancelled') then
    raise exception 'Invalid execution plan transition: % -> %', old.status, new.status;
  elsif old.status = 'blocked' and new.status not in ('blocked', 'running', 'cancelled') then
    raise exception 'Invalid execution plan transition: % -> %', old.status, new.status;
  elsif old.status in ('completed', 'failed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Terminal execution plans are immutable';
  end if;

  if new.status = 'frozen' and (new.frozen_by is null or new.frozen_at is null) then
    raise exception 'Freezing an execution plan requires an actor and timestamp';
  end if;
  return new;
end;
$$;

create trigger trg_execution_plan_invariants
  before insert or update on public.execution_plans
  for each row execute function public.enforce_execution_plan_invariants();

create or replace function public.enforce_execution_plan_step_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  plan_status text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.attempt_count <> 0 then
      raise exception 'Execution plan steps must start pending with zero attempts';
    end if;
    if new.external_side_effect and not new.requires_human_approval then
      raise exception 'External side effects require human approval';
    end if;
    if new.action_class in ('external_execution', 'sensitive_execution')
       and not new.requires_human_approval then
      raise exception 'External and sensitive steps require human approval';
    end if;
    select status into plan_status from public.execution_plans where id = new.plan_id;
    if plan_status is distinct from 'proposed' then
      raise exception 'Execution plan steps can only be added to a proposed plan';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.plan_id, new.run_id, new.step_key,
    new.sequence, new.title, new.capability_key, new.input_contract_version,
    new.output_contract_version, new.action_class, new.data_sensitivity,
    new.depends_on, new.requires_human_approval, new.external_side_effect,
    new.may_own_authoritative_state, new.max_attempts, new.deadline_at,
    new.created_by, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.plan_id, old.run_id, old.step_key,
    old.sequence, old.title, old.capability_key, old.input_contract_version,
    old.output_contract_version, old.action_class, old.data_sensitivity,
    old.depends_on, old.requires_human_approval, old.external_side_effect,
    old.may_own_authoritative_state, old.max_attempts, old.deadline_at,
    old.created_by, old.created_at
  ) then
    raise exception 'Execution plan step contract and identity are immutable';
  end if;

  if old.status = 'pending' and new.status not in ('pending', 'ready', 'awaiting_approval', 'blocked', 'cancelled') then
    raise exception 'Invalid execution step transition: % -> %', old.status, new.status;
  elsif old.status = 'ready' and new.status not in ('ready', 'leased', 'running', 'blocked', 'cancelled') then
    raise exception 'Invalid execution step transition: % -> %', old.status, new.status;
  elsif old.status in ('leased', 'running') and new.status not in ('leased', 'running', 'awaiting_approval', 'awaiting_verification', 'succeeded', 'ready', 'failed', 'blocked', 'cancelled') then
    raise exception 'Invalid execution step transition: % -> %', old.status, new.status;
  elsif old.status = 'awaiting_approval' and new.status not in ('awaiting_approval', 'ready', 'blocked', 'cancelled') then
    raise exception 'Invalid execution step transition: % -> %', old.status, new.status;
  elsif old.status = 'awaiting_verification' and new.status not in ('awaiting_verification', 'succeeded', 'failed', 'blocked', 'cancelled') then
    raise exception 'Invalid execution step transition: % -> %', old.status, new.status;
  elsif old.status = 'blocked' and new.status not in ('blocked', 'ready', 'cancelled') then
    raise exception 'Invalid execution step transition: % -> %', old.status, new.status;
  elsif old.status in ('succeeded', 'failed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Terminal execution steps are immutable';
  end if;

  if new.attempt_count < old.attempt_count or new.attempt_count > new.max_attempts then
    raise exception 'Execution step attempt count cannot decrease or exceed its budget';
  end if;
  if new.status in ('succeeded', 'failed', 'blocked', 'cancelled')
     and new.lease_worker_id is not null then
    raise exception 'Terminal execution steps cannot retain an active lease';
  end if;
  return new;
end;
$$;

create trigger trg_execution_plan_step_invariants
  before insert or update on public.execution_plan_steps
  for each row execute function public.enforce_execution_plan_step_invariants();

create or replace function public.enforce_execution_attempt_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  step_status text;
  step_attempt integer;
begin
  if tg_op = 'INSERT' then
    select status, attempt_count into step_status, step_attempt
      from public.execution_plan_steps where id = new.step_id;
    if step_status is distinct from 'running' or step_attempt is distinct from new.attempt_number then
      raise exception 'An attempt must match a running step and its current attempt number';
    end if;
    if new.status not in ('claimed', 'running') then
      raise exception 'New execution attempts must be claimed or running';
    end if;
    return new;
  end if;

  if row(
    new.id, new.organization_id, new.plan_id, new.step_id, new.run_id,
    new.attempt_number, new.worker_id, new.lease_token_hash,
    new.executor_key, new.executor_kind, new.authority_snapshot,
    new.context_hash, new.input_artifact_ids, new.created_at
  ) is distinct from row(
    old.id, old.organization_id, old.plan_id, old.step_id, old.run_id,
    old.attempt_number, old.worker_id, old.lease_token_hash,
    old.executor_key, old.executor_kind, old.authority_snapshot,
    old.context_hash, old.input_artifact_ids, old.created_at
  ) then
    raise exception 'Execution attempt identity, lease credential, and authority snapshot are immutable';
  end if;

  if old.status in ('succeeded', 'failed', 'expired', 'cancelled')
     and new.status is distinct from old.status then
    raise exception 'Terminal execution attempts are immutable';
  end if;
  if new.status in ('succeeded', 'failed', 'expired', 'cancelled') and new.completed_at is null then
    raise exception 'Terminal execution attempts require completed_at';
  end if;
  return new;
end;
$$;

create trigger trg_execution_attempt_invariants
  before insert or update on public.execution_attempts
  for each row execute function public.enforce_execution_attempt_invariants();

create or replace function public.enforce_execution_approval_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'Approval requests must start pending'; end if;
    return new;
  end if;
  if row(new.id, new.organization_id, new.plan_id, new.step_id, new.action_class,
         new.requested_action, new.requested_by, new.requested_at, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.plan_id, old.step_id, old.action_class,
         old.requested_action, old.requested_by, old.requested_at, old.created_at) then
    raise exception 'Approval request identity and requested action are immutable';
  end if;
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'Terminal approval decisions are immutable';
  end if;
  if new.status in ('approved', 'rejected', 'expired')
     and (new.decided_by is null or new.decided_at is null) then
    raise exception 'Approval decisions require an actor and timestamp';
  end if;
  return new;
end;
$$;

create trigger trg_execution_approval_invariants
  before insert or update on public.execution_approval_requests
  for each row execute function public.enforce_execution_approval_invariants();

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

create or replace function public.claim_execution_step(
  p_worker_id text,
  p_capability_key text,
  p_lease_token_hash text,
  p_lease_seconds integer default 300
)
returns table (
  attempt_id uuid,
  plan_id uuid,
  step_id uuid,
  run_id uuid,
  step_key text,
  capability_key text,
  action_class text,
  executor_context jsonb,
  lease_expires_at timestamptz,
  attempt_number integer
)
language plpgsql
set search_path = public
as $$
declare
  v_step public.execution_plan_steps%rowtype;
  v_plan public.execution_plans%rowtype;
  v_attempt_id uuid;
  v_expires timestamptz;
  v_attempt_number integer;
  v_executor_kind text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_worker_id is null or p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' then raise exception 'Invalid worker id'; end if;
  if p_capability_key is null or p_capability_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$' then raise exception 'Invalid capability key'; end if;
  if p_lease_token_hash is null or p_lease_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid lease token hash'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'Lease must be between 30 and 3600 seconds'; end if;

  select s, ep.executor_kind into v_step, v_executor_kind
    from public.execution_plan_steps s
    join public.execution_plans p on p.id = s.plan_id
    join public.workstream_runs wr on wr.id = s.run_id and wr.status = 'running'
    join public.executor_profiles ep on ep.key = p_worker_id and ep.status = 'active'
    join public.executor_capabilities ec on ec.executor_profile_id = ep.id
       and ec.qualification_status = 'qualified' and ec.suspended_at is null
    join public.capabilities c on c.id = ec.capability_id
       and c.key = s.capability_key and c.status = 'active'
   where p.status in ('frozen', 'running')
     and s.capability_key = p_capability_key
     and s.status = 'ready'
     and s.available_at <= now()
     and s.deadline_at > now()
     and s.attempt_count < s.max_attempts
     and (not s.requires_human_approval or exists (
       select 1 from public.execution_approval_requests a where a.step_id = s.id and a.status = 'approved'
     ))
     and not exists (
       select 1 from jsonb_array_elements_text(s.depends_on) dependency(step_key)
       left join public.execution_plan_steps d
         on d.plan_id = s.plan_id and d.step_key = dependency.step_key
      where d.status is distinct from 'succeeded'
     )
   order by s.available_at, s.sequence, s.created_at, s.id
   limit 1
   for update of s skip locked;
  if not found then return; end if;

  v_attempt_number := v_step.attempt_count + 1;
  v_expires := now() + make_interval(secs => p_lease_seconds);
  update public.execution_plan_steps
     set status = 'running', attempt_count = v_attempt_number,
         lease_worker_id = p_worker_id, lease_expires_at = v_expires,
         started_at = coalesce(started_at, now())
   where id = v_step.id;

    insert into public.execution_attempts (
    organization_id, plan_id, step_id, run_id, attempt_number, status,
    worker_id, lease_token_hash, lease_expires_at, heartbeat_at,
    authority_snapshot, executor_key, executor_kind, input_artifact_ids, started_at
  )
  select v_step.organization_id, v_step.plan_id, v_step.id, v_step.run_id,
         v_attempt_number, 'running', p_worker_id, p_lease_token_hash,
         v_expires, now(),
         jsonb_build_object(
           'actionClass', v_step.action_class,
           'dataSensitivity', v_step.data_sensitivity,
           'requiresHumanApproval', v_step.requires_human_approval,
           'externalSideEffect', v_step.external_side_effect,
           'mayOwnAuthoritativeState', false,
           'stepKey', v_step.step_key
         ),
         p_worker_id, v_executor_kind,
         v_step.input_artifact_ids, now()
  returning id into v_attempt_id;

  update public.execution_plans
     set status = 'running', started_at = coalesce(started_at, now())
   where id = v_step.plan_id and status = 'frozen';

  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_step.organization_id, v_step.plan_id, v_step.id, v_attempt_id,
          'attempt_started', 'worker', p_worker_id,
          jsonb_build_object('attemptNumber', v_attempt_number, 'leaseExpiresAt', v_expires));

  select p.* into v_plan from public.execution_plans p where p.id = v_step.plan_id;
  return query select v_attempt_id, v_step.plan_id, v_step.id, v_step.run_id,
    v_step.step_key, v_step.capability_key, v_step.action_class,
    jsonb_build_object('planHash', v_plan.plan_hash, 'executorKey', p_worker_id,
      'executorKind', v_executor_kind, 'authoritySnapshot',
      jsonb_build_object('actionClass', v_step.action_class,
        'dataSensitivity', v_step.data_sensitivity,
        'requiresHumanApproval', v_step.requires_human_approval,
        'externalSideEffect', v_step.external_side_effect,
        'mayOwnAuthoritativeState', false)),
    v_expires, v_attempt_number;
end;
$$;

revoke all on function public.claim_execution_step(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_execution_step(text, text, text, integer) to service_role;

create or replace function public.heartbeat_execution_attempt(
  p_attempt_id uuid,
  p_worker_id text,
  p_lease_token_hash text,
  p_lease_seconds integer default 300
)
returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
  v_expires timestamptz;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then raise exception 'Lease must be between 30 and 3600 seconds'; end if;
  select * into v_attempt from public.execution_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'running' then raise exception 'Execution attempt is not running'; end if;
  if v_attempt.worker_id is distinct from p_worker_id or v_attempt.lease_token_hash is distinct from p_lease_token_hash then
    raise exception 'Execution lease credential mismatch';
  end if;
  if v_attempt.lease_expires_at <= now() then raise exception 'Execution lease expired'; end if;
  if not exists (select 1 from public.workstream_runs where id = v_attempt.run_id and status = 'running') then
    raise exception 'The Workstream Run is no longer running';
  end if;
  if exists (
    select 1 from public.execution_plan_steps
     where id = v_attempt.step_id and deadline_at <= now()
  ) then
    raise exception 'Execution step deadline exceeded';
  end if;
  v_expires := now() + make_interval(secs => p_lease_seconds);
  update public.execution_attempts set heartbeat_at = now(), lease_expires_at = v_expires where id = p_attempt_id;
  update public.execution_plan_steps set lease_expires_at = v_expires where id = v_attempt.step_id and status = 'running';
  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_attempt.organization_id, v_attempt.plan_id, v_attempt.step_id, p_attempt_id,
          'attempt_heartbeat', 'worker', p_worker_id, jsonb_build_object('leaseExpiresAt', v_expires));
  return v_expires;
end;
$$;

revoke all on function public.heartbeat_execution_attempt(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.heartbeat_execution_attempt(uuid, text, text, integer) to service_role;

create or replace function public.complete_execution_attempt(
  p_attempt_id uuid,
  p_worker_id text,
  p_lease_token_hash text,
  p_output_artifact_ids jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_human_minutes numeric default 0,
  p_ai_cost_micros bigint default 0,
  p_tool_cost_micros bigint default 0
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_output_artifact_ids is null or jsonb_typeof(p_output_artifact_ids) <> 'array' then raise exception 'Output artifact ids must be an array'; end if;
  if p_human_minutes < 0 or p_ai_cost_micros < 0 or p_tool_cost_micros < 0 then raise exception 'Execution costs must be non-negative'; end if;
  select * into v_attempt from public.execution_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'running' then raise exception 'Execution attempt is not running'; end if;
  if v_attempt.worker_id is distinct from p_worker_id or v_attempt.lease_token_hash is distinct from p_lease_token_hash then raise exception 'Execution lease credential mismatch'; end if;
  if v_attempt.lease_expires_at <= now() then raise exception 'Execution lease expired'; end if;
  if not exists (select 1 from public.workstream_runs where id = v_attempt.run_id and status = 'running') then
    raise exception 'The Workstream Run is no longer running';
  end if;
  if exists (
    select 1 from public.execution_plan_steps
     where id = v_attempt.step_id and deadline_at <= now()
  ) then
    raise exception 'Execution step deadline exceeded';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_output_artifact_ids) artifact(id)
    left join public.evidence_artifacts e on e.id = artifact.id::uuid
    where e.id is null or e.organization_id is distinct from v_attempt.organization_id or e.run_id is distinct from v_attempt.run_id
  ) then raise exception 'Output artifacts must belong to the same organization and Workstream Run'; end if;

  update public.execution_attempts
     set status = 'succeeded', output_artifact_ids = p_output_artifact_ids,
         metadata = coalesce(p_metadata, '{}'::jsonb), human_minutes = p_human_minutes,
         ai_cost_micros = p_ai_cost_micros, tool_cost_micros = p_tool_cost_micros,
         completed_at = now()
   where id = p_attempt_id;
  update public.execution_plan_steps
     set status = 'succeeded', output_artifact_ids = p_output_artifact_ids,
         lease_worker_id = null, lease_expires_at = null, completed_at = now()
   where id = v_attempt.step_id;
  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_attempt.organization_id, v_attempt.plan_id, v_attempt.step_id, p_attempt_id,
          'attempt_succeeded', 'worker', p_worker_id,
          jsonb_build_object('outputArtifactIds', p_output_artifact_ids));
  perform public.refresh_execution_plan_queue(v_attempt.plan_id);
  return p_attempt_id;
end;
$$;

revoke all on function public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint) from public, anon, authenticated;
grant execute on function public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint) to service_role;

create or replace function public.fail_execution_attempt(
  p_attempt_id uuid,
  p_worker_id text,
  p_lease_token_hash text,
  p_failure_class text,
  p_failure_code text,
  p_failure_summary text,
  p_metadata jsonb default '{}'::jsonb,
  p_human_minutes numeric default 0,
  p_ai_cost_micros bigint default 0,
  p_tool_cost_micros bigint default 0,
  p_allow_expired boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_attempt public.execution_attempts%rowtype;
  v_step_deadline timestamptz;
  v_max_attempts integer;
  v_failure_class text;
  v_retry_decision text;
  v_should_retry boolean := false;
  v_terminal_status text := 'blocked';
  v_delay_seconds integer := 0;
  v_event_type text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_human_minutes < 0 or p_ai_cost_micros < 0 or p_tool_cost_micros < 0 then raise exception 'Execution costs must be non-negative'; end if;
  select * into v_attempt from public.execution_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'running' then raise exception 'Execution attempt is not running'; end if;
  if v_attempt.worker_id is distinct from p_worker_id or v_attempt.lease_token_hash is distinct from p_lease_token_hash then raise exception 'Execution lease credential mismatch'; end if;
  if v_attempt.lease_expires_at <= now() and not p_allow_expired then raise exception 'Execution lease expired'; end if;
  select deadline_at, max_attempts into v_step_deadline, v_max_attempts
    from public.execution_plan_steps where id = v_attempt.step_id;

  v_failure_class := case when p_failure_class in (
    'bad_input', 'executor_failure', 'evidence_failure', 'qa_failure',
    'integration_failure', 'source_ambiguity', 'authority_limit', 'policy_conflict',
    'business_strategy_failure', 'cost_limit', 'security_incident',
    'external_dependency', 'unknown'
  ) then p_failure_class else 'unknown' end;

  if v_step_deadline <= now() then
    v_failure_class := 'cost_limit';
    v_retry_decision := 'escalate_human';
  elsif v_failure_class = 'security_incident' then
    v_retry_decision := 'suspend_workstream';
  elsif v_failure_class in ('authority_limit', 'policy_conflict', 'source_ambiguity', 'cost_limit') then
    v_retry_decision := 'escalate_human';
  elsif v_failure_class = 'business_strategy_failure' then
    v_retry_decision := 'replan';
  elsif v_failure_class = 'bad_input' and v_attempt.attempt_number < v_max_attempts then
    v_retry_decision := 'correct_inputs_then_retry'; v_should_retry := true;
  elsif v_failure_class in ('qa_failure', 'evidence_failure') and v_attempt.attempt_number < v_max_attempts then
    v_retry_decision := 'retry_different_executor'; v_should_retry := true;
  elsif v_failure_class in ('executor_failure', 'integration_failure', 'external_dependency') and v_attempt.attempt_number < v_max_attempts then
    v_retry_decision := 'retry_same_executor'; v_should_retry := true;
  elsif v_failure_class in ('bad_input', 'qa_failure', 'evidence_failure', 'executor_failure', 'integration_failure', 'external_dependency') then
    v_retry_decision := 'no_retry'; v_terminal_status := 'failed';
  else
    v_retry_decision := 'escalate_human';
  end if;

  -- A security incident is a workstream-wide stop signal, not a local retry.
  -- The existing run state has no paused value, so failed is the terminal
  -- fail-closed state. Claiming also requires a running Workstream Run.
  if v_failure_class = 'security_incident' then
    update public.workstream_runs
       set status = 'failed', completed_at = now(),
           notes = left(concat_ws(' ', notes, 'Execution Runtime stopped this run after a security incident.'), 4000)
     where id = v_attempt.run_id and status = 'running';
  end if;

  if v_should_retry then
    v_delay_seconds := least(900, power(2::numeric, least(v_attempt.attempt_number - 1, 20))::integer);
    v_event_type := 'retry_scheduled';
  else
    v_event_type := case when p_allow_expired then 'attempt_expired' else 'attempt_failed' end;
  end if;

  update public.execution_attempts
     set status = case when p_allow_expired then 'expired' else 'failed' end,
         failure_class = v_failure_class, failure_code = nullif(p_failure_code, ''),
         failure_summary = coalesce(p_failure_summary, ''), retry_decision = v_retry_decision,
         metadata = coalesce(p_metadata, '{}'::jsonb), human_minutes = p_human_minutes,
         ai_cost_micros = p_ai_cost_micros, tool_cost_micros = p_tool_cost_micros,
         completed_at = now()
   where id = p_attempt_id;

  update public.execution_plan_steps
     set status = case when v_should_retry then 'ready' else v_terminal_status end,
         available_at = case when v_should_retry then now() + make_interval(secs => v_delay_seconds) else available_at end,
         lease_worker_id = null, lease_expires_at = null,
         last_failure_class = v_failure_class, last_failure_code = nullif(p_failure_code, ''),
         last_failure_summary = coalesce(p_failure_summary, ''),
         completed_at = case when v_should_retry then null else now() end
   where id = v_attempt.step_id;

  insert into public.execution_events (organization_id, plan_id, step_id, attempt_id, event_type, actor_kind, actor_ref, payload)
  values (v_attempt.organization_id, v_attempt.plan_id, v_attempt.step_id, p_attempt_id,
          v_event_type, case when p_allow_expired then 'system' else 'worker' end, p_worker_id,
          jsonb_build_object('failureClass', v_failure_class, 'retryDecision', v_retry_decision,
            'shouldRetry', v_should_retry, 'delaySeconds', v_delay_seconds,
            'failureCode', p_failure_code, 'failureSummary', p_failure_summary));
  perform public.refresh_execution_plan_queue(v_attempt.plan_id);
  return p_attempt_id;
end;
$$;

revoke all on function public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean) to service_role;

create or replace function public.reap_execution_leases(p_limit integer default 100)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_attempt record;
  v_count integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'Reap limit must be between 1 and 1000'; end if;
  for v_attempt in
    select id, worker_id, lease_token_hash
      from public.execution_attempts
     where status = 'running' and lease_expires_at <= now()
     order by lease_expires_at, created_at
     limit p_limit
     for update skip locked
  loop
    perform public.fail_execution_attempt(
      v_attempt.id, v_attempt.worker_id, v_attempt.lease_token_hash,
      'external_dependency', 'lease_expired',
      'Worker lease expired before the attempt completed.', '{}'::jsonb,
      0, 0, 0, true
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reap_execution_leases(integer) from public, anon, authenticated;
grant execute on function public.reap_execution_leases(integer) to service_role;

create or replace function public.decide_execution_approval(
  p_approval_id uuid,
  p_decision text,
  p_decided_by uuid,
  p_decision_note text default ''
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_approval public.execution_approval_requests%rowtype;
  v_step public.execution_plan_steps%rowtype;
  v_event_type text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Approval decision must be approved or rejected'; end if;
  select * into v_approval from public.execution_approval_requests where id = p_approval_id for update;
  if not found or v_approval.status <> 'pending' then raise exception 'Approval request is not pending'; end if;
  select * into v_step from public.execution_plan_steps where id = v_approval.step_id for update;
  if not found or v_step.status <> 'awaiting_approval' then raise exception 'Approval step is no longer awaiting approval'; end if;

  update public.execution_approval_requests
     set status = p_decision, decided_by = p_decided_by,
         decision_note = coalesce(p_decision_note, ''), decided_at = now()
   where id = p_approval_id;
  update public.execution_plan_steps
     set status = case when p_decision = 'approved' then 'ready' else 'blocked' end,
         completed_at = case when p_decision = 'rejected' then now() else null end,
         last_failure_class = case when p_decision = 'rejected' then 'authority_limit' else null end,
         last_failure_summary = case when p_decision = 'rejected' then 'Required human approval was rejected.' else null end
   where id = v_step.id;
  v_event_type := case when p_decision = 'approved' then 'approval_approved' else 'approval_rejected' end;
  insert into public.execution_events (organization_id, plan_id, step_id, event_type, actor_kind, actor_ref, payload)
  values (v_approval.organization_id, v_approval.plan_id, v_approval.step_id,
          v_event_type, 'human', p_decided_by::text,
          jsonb_build_object('approvalId', p_approval_id, 'decisionNote', p_decision_note));
  perform public.refresh_execution_plan_queue(v_approval.plan_id);
  return p_approval_id;
end;
$$;

revoke all on function public.decide_execution_approval(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_execution_approval(uuid, text, uuid, text) to service_role;

create or replace function public.cancel_execution_plan(p_plan_id uuid, p_actor_id uuid)
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
  update public.execution_attempts set status = 'cancelled', completed_at = now()
   where plan_id = p_plan_id and status in ('claimed', 'running');
  update public.execution_plan_steps
     set status = 'cancelled', lease_worker_id = null, lease_expires_at = null, completed_at = now()
   where plan_id = p_plan_id and status not in ('succeeded', 'failed', 'blocked', 'cancelled');
  update public.execution_plans set status = 'cancelled', completed_at = now() where id = p_plan_id;
  insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, actor_ref, payload)
  values (v_plan.organization_id, p_plan_id, 'plan_cancelled', 'human', p_actor_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.cancel_execution_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_execution_plan(uuid, uuid) to service_role;
