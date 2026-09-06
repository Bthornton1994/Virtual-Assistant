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
create index execution_plans_created_by_idx
  on public.execution_plans (created_by);
create index execution_plans_delegation_spec_idx
  on public.execution_plans (delegation_spec_id);
create index execution_plans_frozen_by_idx
  on public.execution_plans (frozen_by);

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

-- Runtime RPCs continue in 20260903090001_execution_runtime_v1_functions.sql so
-- the tracked migration remains below Supabase connector payload limits.
