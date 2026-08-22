-- Gauntlet Loop v1
--
-- Extends evidence-bearing execution into a closed learning loop:
-- observe -> diagnose -> execute -> adversarial verification -> corrective action
-- -> business impact -> autonomy decision -> re-entry.
--
-- The loop does not grant external authority. Promotions remain approval-gated by
-- default and all consequential action boundaries remain governed by Delegation Specs.

create table public.gauntlet_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete restrict,
  delegation_spec_id uuid not null references public.delegation_specs(id) on delete restrict,
  sequence integer not null check (sequence > 0),
  status text not null default 'observing' check (status in (
    'observing', 'executing', 'verification', 'corrective_action',
    'impact_review', 'autonomy_review', 'closed', 'suspended'
  )),
  recurrence_mode text not null default 'manual' check (recurrence_mode in ('manual', 'recurring', 'event')),
  trigger_kind text not null default 'manual' check (trigger_kind in ('manual', 'scheduled', 'event', 'retry', 'reentry')),
  trigger_ref text,
  objective_snapshot text not null,
  hypothesis text not null default '',
  parent_cycle_id uuid references public.gauntlet_cycles(id) on delete restrict,
  reentry_reason text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, workstream_id, sequence),
  unique (id, organization_id)
);

create unique index gauntlet_one_open_cycle_per_workstream_idx
  on public.gauntlet_cycles (organization_id, workstream_id)
  where status <> 'closed' and status <> 'suspended';
create index gauntlet_cycles_org_created_idx on public.gauntlet_cycles (organization_id, created_at desc);
create index gauntlet_cycles_workstream_created_idx on public.gauntlet_cycles (workstream_id, created_at desc);

create table public.gauntlet_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.gauntlet_cycles(id) on delete cascade,
  signal_type text not null,
  summary text not null,
  source_uri text,
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index gauntlet_observations_cycle_idx on public.gauntlet_observations (cycle_id, created_at);

create table public.gauntlet_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null unique references public.gauntlet_cycles(id) on delete cascade,
  diagnosis text not null,
  binding_constraint text not null,
  selected_action text not null,
  hypothesis text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  diagnosed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.workstream_runs
  add column gauntlet_cycle_id uuid references public.gauntlet_cycles(id) on delete restrict,
  add column attempt_number integer not null default 1 check (attempt_number > 0),
  add column retry_of_run_id uuid references public.workstream_runs(id) on delete restrict;
create index workstream_runs_gauntlet_cycle_idx on public.workstream_runs (gauntlet_cycle_id, created_at) where gauntlet_cycle_id is not null;
create index workstream_runs_retry_of_idx on public.workstream_runs (retry_of_run_id) where retry_of_run_id is not null;

create table public.gauntlet_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.gauntlet_cycles(id) on delete cascade,
  run_id uuid not null references public.workstream_runs(id) on delete cascade,
  reviewer_kind text not null check (reviewer_kind in ('human', 'deterministic', 'agent', 'hybrid')),
  reviewer_ref text not null default '',
  independent boolean not null default true,
  verdict text not null check (verdict in ('passed', 'failed', 'inconclusive')),
  hard_gate_pass boolean not null,
  challenged_assumptions jsonb not null default '[]'::jsonb,
  defects jsonb not null default '[]'::jsonb,
  evidence_gaps jsonb not null default '[]'::jsonb,
  authority_incidents jsonb not null default '[]'::jsonb,
  notes text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index gauntlet_reviews_run_idx on public.gauntlet_reviews (run_id, created_at desc);
create index gauntlet_reviews_cycle_idx on public.gauntlet_reviews (cycle_id, created_at desc);

create table public.gauntlet_failures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.gauntlet_cycles(id) on delete cascade,
  run_id uuid references public.workstream_runs(id) on delete set null,
  review_id uuid references public.gauntlet_reviews(id) on delete set null,
  classification text not null default 'unknown' check (classification in (
    'bad_input', 'executor_failure', 'evidence_failure', 'qa_failure',
    'integration_failure', 'source_ambiguity', 'authority_limit', 'policy_conflict',
    'business_strategy_failure', 'cost_limit', 'security_incident',
    'external_dependency', 'unknown'
  )),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  retry_decision text not null default 'escalate_human' check (retry_decision in (
    'retry_same_executor', 'retry_different_executor', 'correct_inputs_then_retry',
    'escalate_human', 'replan', 'suspend_workstream', 'no_retry'
  )),
  root_cause text not null default '',
  corrective_action text not null default '',
  status text not null default 'open' check (status in ('open', 'resolved', 'waived')),
  created_by uuid references auth.users(id) on delete set null,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gauntlet_failures_cycle_idx on public.gauntlet_failures (cycle_id, status, created_at desc);
create index gauntlet_failures_run_idx on public.gauntlet_failures (run_id) where run_id is not null;

create table public.gauntlet_impact_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null unique references public.gauntlet_cycles(id) on delete cascade,
  run_id uuid not null references public.workstream_runs(id) on delete restrict,
  receipt_id uuid not null references public.outcome_receipts(id) on delete restrict,
  direction text not null check (direction in ('improved', 'neutral', 'regressed', 'inconclusive')),
  hypothesis text not null,
  primary_metric text not null,
  baseline jsonb not null default '{}'::jsonb,
  observed jsonb not null default '{}'::jsonb,
  delta jsonb not null default '{}'::jsonb,
  guardrails jsonb not null default '[]'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  evidence_quality text not null default 'weak' check (evidence_quality in ('weak', 'moderate', 'strong')),
  interpretation text not null default '',
  assessed_by uuid references auth.users(id) on delete set null,
  assessed_at timestamptz not null default now()
);
create index gauntlet_impact_org_idx on public.gauntlet_impact_assessments (organization_id, assessed_at desc);

create table public.workstream_autonomy_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete cascade,
  current_level smallint not null default 0 check (current_level between 0 and 4),
  max_level smallint not null default 4 check (max_level between 0 and 4 and max_level >= current_level),
  state text not null default 'active' check (state in ('active', 'suspended')),
  policy jsonb not null default '{
    "minimumVerifiedRunsForPromotion": null,
    "minimumQaScore": null,
    "maximumFailureRate": null,
    "maximumExceptionRate": null,
    "maximumOwnerMinutesPerRun": null,
    "requireImprovedImpactForPromotion": true,
    "allowAutomaticPromotion": false,
    "promotionRequiresApproval": true,
    "autoDemoteOnHardGateFailure": true,
    "autoDemoteOnRegression": true,
    "autoSuspendOnAuthorityIncident": true
  }'::jsonb,
  policy_version integer not null default 1 check (policy_version > 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, workstream_id)
);

create table public.autonomy_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete cascade,
  cycle_id uuid not null references public.gauntlet_cycles(id) on delete cascade,
  decision text not null check (decision in ('promote', 'hold', 'demote', 'suspend')),
  from_level smallint not null check (from_level between 0 and 4),
  to_level smallint not null check (to_level between 0 and 4),
  reason text not null,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  policy_snapshot jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index autonomy_decisions_cycle_idx on public.autonomy_decisions (cycle_id, created_at desc);
create index autonomy_decisions_workstream_idx on public.autonomy_decisions (workstream_id, created_at desc);

create trigger trg_gauntlet_cycles_updated before update on public.gauntlet_cycles
  for each row execute function public.set_updated_at();
create trigger trg_gauntlet_failures_updated before update on public.gauntlet_failures
  for each row execute function public.set_updated_at();
create trigger trg_workstream_autonomy_profiles_updated before update on public.workstream_autonomy_profiles
  for each row execute function public.set_updated_at();

alter table public.gauntlet_cycles enable row level security;
alter table public.gauntlet_observations enable row level security;
alter table public.gauntlet_diagnoses enable row level security;
alter table public.gauntlet_reviews enable row level security;
alter table public.gauntlet_failures enable row level security;
alter table public.gauntlet_impact_assessments enable row level security;
alter table public.workstream_autonomy_profiles enable row level security;
alter table public.autonomy_decisions enable row level security;

grant select, insert, update on public.gauntlet_cycles to authenticated;
grant select, insert on public.gauntlet_observations to authenticated;
grant select, insert on public.gauntlet_diagnoses to authenticated;
grant select, insert on public.gauntlet_reviews to authenticated;
grant select, insert, update on public.gauntlet_failures to authenticated;
grant select, insert on public.gauntlet_impact_assessments to authenticated;
grant select, insert, update on public.workstream_autonomy_profiles to authenticated;
grant select, insert, update on public.autonomy_decisions to authenticated;
grant all on public.gauntlet_cycles, public.gauntlet_observations, public.gauntlet_diagnoses,
  public.gauntlet_reviews, public.gauntlet_failures, public.gauntlet_impact_assessments,
  public.workstream_autonomy_profiles, public.autonomy_decisions to service_role;

create policy gauntlet_cycles_select on public.gauntlet_cycles for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy gauntlet_cycles_insert on public.gauntlet_cycles for insert to authenticated
  with check (public.is_ops_manager());
create policy gauntlet_cycles_update on public.gauntlet_cycles for update to authenticated
  using (public.is_platform_staff()) with check (public.is_platform_staff());

create policy gauntlet_observations_select on public.gauntlet_observations for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy gauntlet_observations_insert on public.gauntlet_observations for insert to authenticated
  with check (public.is_platform_staff());

create policy gauntlet_diagnoses_select on public.gauntlet_diagnoses for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy gauntlet_diagnoses_insert on public.gauntlet_diagnoses for insert to authenticated
  with check (public.is_platform_staff());

create policy gauntlet_reviews_select on public.gauntlet_reviews for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy gauntlet_reviews_insert on public.gauntlet_reviews for insert to authenticated
  with check (public.is_platform_staff());

create policy gauntlet_failures_select on public.gauntlet_failures for select to authenticated
  using (public.is_platform_staff());
create policy gauntlet_failures_insert on public.gauntlet_failures for insert to authenticated
  with check (public.is_platform_staff());
create policy gauntlet_failures_update on public.gauntlet_failures for update to authenticated
  using (public.is_platform_staff()) with check (public.is_platform_staff());

create policy gauntlet_impact_select on public.gauntlet_impact_assessments for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy gauntlet_impact_insert on public.gauntlet_impact_assessments for insert to authenticated
  with check (public.is_ops_manager());

create policy autonomy_profiles_select on public.workstream_autonomy_profiles for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy autonomy_profiles_insert on public.workstream_autonomy_profiles for insert to authenticated
  with check (public.is_ops_manager());
create policy autonomy_profiles_update on public.workstream_autonomy_profiles for update to authenticated
  using (public.is_ops_manager()) with check (public.is_ops_manager());

create policy autonomy_decisions_select on public.autonomy_decisions for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy autonomy_decisions_insert on public.autonomy_decisions for insert to authenticated
  with check (public.is_ops_manager());
create policy autonomy_decisions_update on public.autonomy_decisions for update to authenticated
  using (public.is_ops_manager()) with check (public.is_ops_manager());

create or replace function public.enforce_gauntlet_cycle_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  observation_count bigint;
  diagnosis_count bigint;
  verified_run_count bigint;
  impact_count bigint;
  applied_decision_count bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'observing' then raise exception 'New Gauntlet cycles must start in observing status'; end if;
    if not exists (
      select 1 from public.delegation_specs ds
      where ds.id = new.delegation_spec_id
        and ds.organization_id = new.organization_id
        and ds.workstream_id = new.workstream_id
        and ds.status = 'active'
    ) then
      raise exception 'Gauntlet cycle requires an active Delegation Spec for the same organization and workstream';
    end if;
    return new;
  end if;

  if row(new.id, new.organization_id, new.workstream_id, new.delegation_spec_id, new.sequence,
         new.recurrence_mode, new.trigger_kind, new.trigger_ref, new.objective_snapshot,
         new.hypothesis, new.parent_cycle_id, new.created_by, new.started_at, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.workstream_id, old.delegation_spec_id, old.sequence,
         old.recurrence_mode, old.trigger_kind, old.trigger_ref, old.objective_snapshot,
         old.hypothesis, old.parent_cycle_id, old.created_by, old.started_at, old.created_at) then
    raise exception 'Gauntlet cycle identity and operating contract are immutable';
  end if;

  if old.status in ('closed', 'suspended') and new.status <> old.status then
    raise exception 'Closed or suspended Gauntlet cycles are terminal';
  end if;

  if old.status = 'observing' and new.status not in ('observing', 'executing', 'suspended') then
    raise exception 'Invalid Gauntlet transition: % -> %', old.status, new.status;
  elsif old.status = 'executing' and new.status not in ('executing', 'verification', 'corrective_action', 'suspended') then
    raise exception 'Invalid Gauntlet transition: % -> %', old.status, new.status;
  elsif old.status = 'verification' and new.status not in ('verification', 'impact_review', 'corrective_action', 'suspended') then
    raise exception 'Invalid Gauntlet transition: % -> %', old.status, new.status;
  elsif old.status = 'corrective_action' and new.status not in ('corrective_action', 'executing', 'suspended') then
    raise exception 'Invalid Gauntlet transition: % -> %', old.status, new.status;
  elsif old.status = 'impact_review' and new.status not in ('impact_review', 'autonomy_review', 'corrective_action', 'suspended') then
    raise exception 'Invalid Gauntlet transition: % -> %', old.status, new.status;
  elsif old.status = 'autonomy_review' and new.status not in ('autonomy_review', 'closed', 'corrective_action', 'suspended') then
    raise exception 'Invalid Gauntlet transition: % -> %', old.status, new.status;
  end if;

  if old.status = 'observing' and new.status = 'executing' then
    select count(*) into observation_count from public.gauntlet_observations where cycle_id = old.id;
    select count(*) into diagnosis_count from public.gauntlet_diagnoses where cycle_id = old.id;
    if observation_count = 0 then raise exception 'Gauntlet execution requires at least one recorded observation'; end if;
    if diagnosis_count = 0 then raise exception 'Gauntlet execution requires a locked diagnosis'; end if;
  end if;

  if old.status = 'verification' and new.status = 'impact_review' then
    select count(*) into verified_run_count
      from public.workstream_runs wr
      where wr.gauntlet_cycle_id = old.id and wr.status = 'verified';
    if verified_run_count = 0 then raise exception 'Impact review requires a verified workstream run'; end if;
  end if;

  if old.status = 'impact_review' and new.status = 'autonomy_review' then
    select count(*) into impact_count from public.gauntlet_impact_assessments where cycle_id = old.id;
    if impact_count = 0 then raise exception 'Autonomy review requires a business-impact assessment'; end if;
  end if;

  if old.status = 'autonomy_review' and new.status = 'closed' then
    select count(*) into applied_decision_count
      from public.autonomy_decisions where cycle_id = old.id and status = 'applied';
    if applied_decision_count = 0 then raise exception 'Closing a Gauntlet cycle requires an applied autonomy decision'; end if;
  end if;

  if new.status in ('closed', 'suspended') and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;

create trigger trg_gauntlet_cycle_invariants
  before insert or update on public.gauntlet_cycles
  for each row execute function public.enforce_gauntlet_cycle_invariants();

create or replace function public.enforce_gauntlet_observation_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare cycle_status text; cycle_org uuid;
begin
  if tg_op <> 'INSERT' then raise exception 'Gauntlet observations are immutable'; end if;
  select status, organization_id into cycle_status, cycle_org from public.gauntlet_cycles where id = new.cycle_id;
  if cycle_status is null or cycle_org is distinct from new.organization_id then raise exception 'Observation cycle does not belong to this organization'; end if;
  if cycle_status <> 'observing' then raise exception 'Observations may only be appended during the observing stage'; end if;
  return new;
end;
$$;
create trigger trg_gauntlet_observation_invariants
  before insert or update or delete on public.gauntlet_observations
  for each row execute function public.enforce_gauntlet_observation_invariants();

create or replace function public.enforce_gauntlet_diagnosis_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare cycle_status text; cycle_org uuid; observation_count bigint;
begin
  if tg_op <> 'INSERT' then raise exception 'Gauntlet diagnoses are immutable'; end if;
  select status, organization_id into cycle_status, cycle_org from public.gauntlet_cycles where id = new.cycle_id;
  if cycle_status is null or cycle_org is distinct from new.organization_id then raise exception 'Diagnosis cycle does not belong to this organization'; end if;
  if cycle_status <> 'observing' then raise exception 'Diagnosis may only be locked during the observing stage'; end if;
  select count(*) into observation_count from public.gauntlet_observations where cycle_id = new.cycle_id;
  if observation_count = 0 then raise exception 'Diagnosis requires at least one observation'; end if;
  return new;
end;
$$;
create trigger trg_gauntlet_diagnosis_invariants
  before insert or update or delete on public.gauntlet_diagnoses
  for each row execute function public.enforce_gauntlet_diagnosis_invariants();

create or replace function public.advance_gauntlet_after_diagnosis()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.gauntlet_cycles set status = 'executing' where id = new.cycle_id and status = 'observing';
  return new;
end;
$$;
create trigger trg_gauntlet_diagnosis_advance
  after insert on public.gauntlet_diagnoses
  for each row execute function public.advance_gauntlet_after_diagnosis();

create or replace function public.enforce_gauntlet_run_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare c record; retry record;
begin
  if tg_op = 'INSERT' and new.gauntlet_cycle_id is not null then
    select organization_id, workstream_id, delegation_spec_id, status into c
      from public.gauntlet_cycles where id = new.gauntlet_cycle_id;
    if c.organization_id is null then raise exception 'Gauntlet cycle not found'; end if;
    if c.organization_id is distinct from new.organization_id
       or c.workstream_id is distinct from new.workstream_id
       or c.delegation_spec_id is distinct from new.delegation_spec_id then
      raise exception 'Gauntlet run must match its cycle organization, workstream, and Delegation Spec';
    end if;
    if c.status not in ('executing', 'corrective_action') then
      raise exception 'Gauntlet attempts may only be created during execution or corrective action';
    end if;
    if new.retry_of_run_id is not null then
      select gauntlet_cycle_id, status, attempt_number into retry from public.workstream_runs where id = new.retry_of_run_id;
      if retry.gauntlet_cycle_id is distinct from new.gauntlet_cycle_id then raise exception 'Retry run must belong to the same Gauntlet cycle'; end if;
      if retry.status not in ('failed', 'cancelled') then raise exception 'Retry source run must be failed or cancelled'; end if;
      if new.attempt_number <= retry.attempt_number then raise exception 'Retry attempt number must increase'; end if;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.gauntlet_cycle_id is not null then
    if row(new.gauntlet_cycle_id, new.attempt_number, new.retry_of_run_id)
       is distinct from row(old.gauntlet_cycle_id, old.attempt_number, old.retry_of_run_id) then
      raise exception 'Gauntlet attempt linkage is immutable';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_gauntlet_run_invariants
  before insert or update on public.workstream_runs
  for each row execute function public.enforce_gauntlet_run_invariants();

create or replace function public.sync_gauntlet_cycle_from_run()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.gauntlet_cycle_id is null or new.status = old.status then return new; end if;
  if new.status = 'running' then
    update public.gauntlet_cycles set status = 'executing' where id = new.gauntlet_cycle_id and status = 'corrective_action';
  elsif new.status = 'awaiting_verification' then
    update public.gauntlet_cycles set status = 'verification' where id = new.gauntlet_cycle_id and status = 'executing';
  elsif new.status in ('failed', 'cancelled') then
    update public.gauntlet_cycles set status = 'corrective_action' where id = new.gauntlet_cycle_id and status in ('executing', 'verification');
  elsif new.status = 'verified' then
    update public.gauntlet_cycles set status = 'impact_review' where id = new.gauntlet_cycle_id and status = 'verification';
  end if;
  return new;
end;
$$;
create trigger trg_gauntlet_run_sync
  after update on public.workstream_runs
  for each row execute function public.sync_gauntlet_cycle_from_run();

create or replace function public.enforce_gauntlet_review_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare run_record record;
begin
  if tg_op <> 'INSERT' then raise exception 'Gauntlet reviews are immutable'; end if;
  select organization_id, gauntlet_cycle_id, status, initiated_by into run_record
    from public.workstream_runs where id = new.run_id;
  if run_record.organization_id is null
     or run_record.organization_id is distinct from new.organization_id
     or run_record.gauntlet_cycle_id is distinct from new.cycle_id then
    raise exception 'Review must match the Gauntlet run organization and cycle';
  end if;
  if run_record.status <> 'awaiting_verification' then raise exception 'Adversarial review requires a run awaiting verification'; end if;
  if new.reviewer_kind = 'human' and new.independent and new.reviewed_by is not null and new.reviewed_by = run_record.initiated_by then
    raise exception 'A human executor cannot independently review their own run';
  end if;
  if new.verdict = 'passed' and not new.hard_gate_pass then raise exception 'A passed adversarial review requires the hard gate to pass'; end if;
  if new.hard_gate_pass and jsonb_array_length(coalesce(new.authority_incidents, '[]'::jsonb)) > 0 then
    raise exception 'Authority incidents prevent the adversarial hard gate from passing';
  end if;
  return new;
end;
$$;
create trigger trg_gauntlet_review_invariants
  before insert or update or delete on public.gauntlet_reviews
  for each row execute function public.enforce_gauntlet_review_invariants();

create or replace function public.require_gauntlet_review_for_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare cycle_id uuid; review_count bigint;
begin
  if new.verification_status <> 'passed' or not new.definition_of_done_met then return new; end if;
  select gauntlet_cycle_id into cycle_id from public.workstream_runs where id = new.run_id and organization_id = new.organization_id;
  if cycle_id is null then return new; end if;
  select count(*) into review_count
    from public.gauntlet_reviews gr
    where gr.run_id = new.run_id
      and gr.cycle_id = cycle_id
      and gr.independent
      and gr.verdict = 'passed'
      and gr.hard_gate_pass
      and jsonb_array_length(coalesce(gr.authority_incidents, '[]'::jsonb)) = 0;
  if review_count = 0 then raise exception 'A Gauntlet run cannot pass without an independent adversarial hard-gate review'; end if;
  return new;
end;
$$;
create trigger trg_gauntlet_receipt_guard
  before insert on public.outcome_receipts
  for each row execute function public.require_gauntlet_review_for_receipt();

create or replace function public.create_gauntlet_failure_from_terminal_run()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.gauntlet_cycle_id is null or new.status = old.status or new.status not in ('failed', 'cancelled') then return new; end if;
  insert into public.gauntlet_failures (
    organization_id, cycle_id, run_id, classification, severity, retry_decision,
    root_cause, corrective_action, status
  )
  select new.organization_id, new.gauntlet_cycle_id, new.id, 'unknown', 'medium', 'escalate_human',
    'Terminal Gauntlet attempt has not yet been classified.',
    'Classify the failure before deciding whether and how to retry.', 'open'
  where not exists (select 1 from public.gauntlet_failures where run_id = new.id);
  return new;
end;
$$;
create trigger trg_gauntlet_failure_from_run
  after update on public.workstream_runs
  for each row execute function public.create_gauntlet_failure_from_terminal_run();

create or replace function public.enforce_gauntlet_failure_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.organization_id, new.cycle_id, new.run_id, new.review_id, new.created_by, new.created_at)
       is distinct from row(old.id, old.organization_id, old.cycle_id, old.run_id, old.review_id, old.created_by, old.created_at) then
      raise exception 'Gauntlet failure identity is immutable';
    end if;
    if old.status <> 'open' then raise exception 'Resolved or waived Gauntlet failures are immutable'; end if;
    if new.status in ('resolved', 'waived') and (new.resolved_by is null or new.resolved_at is null) then
      raise exception 'Resolving or waiving a Gauntlet failure requires actor and timestamp';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_gauntlet_failure_invariants
  before update on public.gauntlet_failures
  for each row execute function public.enforce_gauntlet_failure_invariants();

create or replace function public.enforce_gauntlet_impact_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare c record; r record; receipt record;
begin
  if tg_op <> 'INSERT' then raise exception 'Gauntlet impact assessments are immutable'; end if;
  select organization_id, status into c from public.gauntlet_cycles where id = new.cycle_id;
  if c.organization_id is null or c.organization_id is distinct from new.organization_id then raise exception 'Impact cycle does not belong to this organization'; end if;
  if c.status <> 'impact_review' then raise exception 'Business impact may only be assessed during impact review'; end if;
  select organization_id, gauntlet_cycle_id, status into r from public.workstream_runs where id = new.run_id;
  if r.organization_id is distinct from new.organization_id or r.gauntlet_cycle_id is distinct from new.cycle_id or r.status <> 'verified' then
    raise exception 'Impact assessment requires a verified run from the same Gauntlet cycle';
  end if;
  select run_id, verification_status, definition_of_done_met into receipt from public.outcome_receipts where id = new.receipt_id;
  if receipt.run_id is distinct from new.run_id or receipt.verification_status <> 'passed' or not receipt.definition_of_done_met then
    raise exception 'Impact assessment requires the passing Outcome Receipt for the verified run';
  end if;
  return new;
end;
$$;
create trigger trg_gauntlet_impact_invariants
  before insert or update or delete on public.gauntlet_impact_assessments
  for each row execute function public.enforce_gauntlet_impact_invariants();

create or replace function public.advance_gauntlet_after_impact()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.gauntlet_cycles set status = 'autonomy_review' where id = new.cycle_id and status = 'impact_review';
  return new;
end;
$$;
create trigger trg_gauntlet_impact_advance
  after insert on public.gauntlet_impact_assessments
  for each row execute function public.advance_gauntlet_after_impact();

create or replace function public.enforce_autonomy_decision_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare p record; cycle_status text;
begin
  select current_level, max_level, state into p
    from public.workstream_autonomy_profiles
    where organization_id = new.organization_id and workstream_id = new.workstream_id;
  if p.current_level is null then raise exception 'Autonomy decision requires an existing workstream profile'; end if;

  if tg_op = 'INSERT' then
    select status into cycle_status from public.gauntlet_cycles
      where id = new.cycle_id and organization_id = new.organization_id and workstream_id = new.workstream_id;
    if cycle_status <> 'autonomy_review' then raise exception 'Autonomy decisions may only be created during autonomy review'; end if;
    if new.from_level <> p.current_level then raise exception 'Autonomy decision from_level must match the current profile level'; end if;
    if new.decision = 'promote' and new.to_level <> new.from_level + 1 then raise exception 'Promotion must advance exactly one autonomy level'; end if;
    if new.decision = 'demote' and new.to_level <> greatest(0, new.from_level - 1) then raise exception 'Demotion must reduce exactly one autonomy level'; end if;
    if new.decision in ('hold', 'suspend') and new.to_level <> new.from_level then raise exception 'Hold and suspend decisions cannot change the autonomy level'; end if;
    if new.to_level > p.max_level then raise exception 'Autonomy decision exceeds the workstream maximum level'; end if;
    if new.status = 'applied' and new.requires_approval and new.applied_by is null then raise exception 'Approval-gated autonomy decision requires an applying actor'; end if;
    return new;
  end if;

  if row(new.id, new.organization_id, new.workstream_id, new.cycle_id, new.decision,
         new.from_level, new.to_level, new.reason, new.metrics_snapshot, new.policy_snapshot,
         new.requires_approval, new.created_by, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.workstream_id, old.cycle_id, old.decision,
         old.from_level, old.to_level, old.reason, old.metrics_snapshot, old.policy_snapshot,
         old.requires_approval, old.created_by, old.created_at) then
    raise exception 'Autonomy decision evidence is immutable';
  end if;
  if old.status <> 'proposed' then raise exception 'Only proposed autonomy decisions may be updated'; end if;
  if new.status not in ('applied', 'rejected') then raise exception 'Proposed autonomy decision may only be applied or rejected'; end if;
  if new.status = 'applied' and (new.applied_by is null or new.applied_at is null) then raise exception 'Applying autonomy requires actor and timestamp'; end if;
  return new;
end;
$$;
create trigger trg_autonomy_decision_invariants
  before insert or update on public.autonomy_decisions
  for each row execute function public.enforce_autonomy_decision_invariants();

create or replace function public.apply_autonomy_decision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'applied' or (tg_op = 'UPDATE' and old.status = 'applied') then return new; end if;
  update public.workstream_autonomy_profiles
    set current_level = new.to_level,
        state = case when new.decision = 'suspend' then 'suspended' else 'active' end,
        updated_by = coalesce(new.applied_by, new.created_by)
    where organization_id = new.organization_id and workstream_id = new.workstream_id;

  if new.decision = 'suspend' then
    update public.gauntlet_cycles set status = 'suspended' where id = new.cycle_id and status = 'autonomy_review';
  else
    update public.gauntlet_cycles set status = 'closed' where id = new.cycle_id and status = 'autonomy_review';
  end if;
  return new;
end;
$$;
create trigger trg_autonomy_decision_apply
  after insert or update on public.autonomy_decisions
  for each row execute function public.apply_autonomy_decision();

create or replace function public.create_gauntlet_reentry()
returns trigger
language plpgsql
set search_path = public
as $$
declare profile_state text; impact_direction text; decision_kind text;
begin
  if new.status <> 'closed' or old.status = 'closed' or new.recurrence_mode = 'manual' then return new; end if;
  select state into profile_state from public.workstream_autonomy_profiles
    where organization_id = new.organization_id and workstream_id = new.workstream_id;
  if profile_state is distinct from 'active' then return new; end if;
  select direction into impact_direction from public.gauntlet_impact_assessments where cycle_id = new.id;
  select decision into decision_kind from public.autonomy_decisions where cycle_id = new.id and status = 'applied' order by created_at desc limit 1;

  insert into public.gauntlet_cycles (
    organization_id, workstream_id, delegation_spec_id, sequence, status,
    recurrence_mode, trigger_kind, trigger_ref, objective_snapshot, hypothesis,
    parent_cycle_id, reentry_reason, created_by
  ) values (
    new.organization_id, new.workstream_id, new.delegation_spec_id, new.sequence + 1, 'observing',
    new.recurrence_mode, 'reentry', new.id::text, new.objective_snapshot, new.hypothesis,
    new.id, concat('Prior cycle impact=', coalesce(impact_direction, 'unknown'), '; autonomy=', coalesce(decision_kind, 'unknown')), null
  );
  return new;
end;
$$;
create trigger trg_gauntlet_cycle_reentry
  after update on public.gauntlet_cycles
  for each row execute function public.create_gauntlet_reentry();
