-- Gauntlet v1 hardening: index new foreign keys, validate autonomy policy,
-- block direct autonomy state changes, and add explicit suspension recovery.

create index if not exists gauntlet_cycles_created_by_idx on public.gauntlet_cycles (created_by) where created_by is not null;
create index if not exists gauntlet_cycles_spec_idx on public.gauntlet_cycles (delegation_spec_id);
create index if not exists gauntlet_cycles_parent_idx on public.gauntlet_cycles (parent_cycle_id) where parent_cycle_id is not null;
create index if not exists gauntlet_diagnoses_org_idx on public.gauntlet_diagnoses (organization_id);
create index if not exists gauntlet_diagnoses_diagnosed_by_idx on public.gauntlet_diagnoses (diagnosed_by) where diagnosed_by is not null;
create index if not exists gauntlet_observations_org_idx on public.gauntlet_observations (organization_id);
create index if not exists gauntlet_observations_created_by_idx on public.gauntlet_observations (created_by) where created_by is not null;
create index if not exists gauntlet_reviews_org_idx on public.gauntlet_reviews (organization_id);
create index if not exists gauntlet_reviews_reviewed_by_idx on public.gauntlet_reviews (reviewed_by) where reviewed_by is not null;
create index if not exists gauntlet_failures_org_idx on public.gauntlet_failures (organization_id);
create index if not exists gauntlet_failures_review_idx on public.gauntlet_failures (review_id) where review_id is not null;
create index if not exists gauntlet_failures_created_by_idx on public.gauntlet_failures (created_by) where created_by is not null;
create index if not exists gauntlet_failures_resolved_by_idx on public.gauntlet_failures (resolved_by) where resolved_by is not null;
create index if not exists gauntlet_impact_run_idx on public.gauntlet_impact_assessments (run_id);
create index if not exists gauntlet_impact_receipt_idx on public.gauntlet_impact_assessments (receipt_id);
create index if not exists gauntlet_impact_assessed_by_idx on public.gauntlet_impact_assessments (assessed_by) where assessed_by is not null;
create index if not exists autonomy_profiles_workstream_idx on public.workstream_autonomy_profiles (workstream_id);
create index if not exists autonomy_profiles_updated_by_idx on public.workstream_autonomy_profiles (updated_by) where updated_by is not null;
create index if not exists autonomy_decisions_org_idx on public.autonomy_decisions (organization_id);
create index if not exists autonomy_decisions_created_by_idx on public.autonomy_decisions (created_by) where created_by is not null;
create index if not exists autonomy_decisions_applied_by_idx on public.autonomy_decisions (applied_by) where applied_by is not null;

create or replace function public.validate_gauntlet_autonomy_policy(policy_value jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare n numeric;
begin
  if policy_value is null or jsonb_typeof(policy_value) <> 'object' then raise exception 'Autonomy policy must be a JSON object'; end if;
  if policy_value ? 'minimumVerifiedRunsForPromotion' and policy_value->'minimumVerifiedRunsForPromotion' <> 'null'::jsonb then
    if jsonb_typeof(policy_value->'minimumVerifiedRunsForPromotion') <> 'number' then raise exception 'minimumVerifiedRunsForPromotion must be numeric or null'; end if;
    n := (policy_value->>'minimumVerifiedRunsForPromotion')::numeric;
    if n < 1 or trunc(n) <> n then raise exception 'minimumVerifiedRunsForPromotion must be an integer >= 1'; end if;
  end if;
  if policy_value ? 'minimumQaScore' and policy_value->'minimumQaScore' <> 'null'::jsonb then
    if jsonb_typeof(policy_value->'minimumQaScore') <> 'number' then raise exception 'minimumQaScore must be numeric or null'; end if;
    n := (policy_value->>'minimumQaScore')::numeric;
    if n < 0 or n > 100 then raise exception 'minimumQaScore must be between 0 and 100'; end if;
  end if;
  if policy_value ? 'maximumFailureRate' and policy_value->'maximumFailureRate' <> 'null'::jsonb then
    if jsonb_typeof(policy_value->'maximumFailureRate') <> 'number' then raise exception 'maximumFailureRate must be numeric or null'; end if;
    n := (policy_value->>'maximumFailureRate')::numeric;
    if n < 0 or n > 1 then raise exception 'maximumFailureRate must be between 0 and 1'; end if;
  end if;
  if policy_value ? 'maximumExceptionRate' and policy_value->'maximumExceptionRate' <> 'null'::jsonb then
    if jsonb_typeof(policy_value->'maximumExceptionRate') <> 'number' then raise exception 'maximumExceptionRate must be numeric or null'; end if;
    n := (policy_value->>'maximumExceptionRate')::numeric;
    if n < 0 or n > 1 then raise exception 'maximumExceptionRate must be between 0 and 1'; end if;
  end if;
  if policy_value ? 'maximumOwnerMinutesPerRun' and policy_value->'maximumOwnerMinutesPerRun' <> 'null'::jsonb then
    if jsonb_typeof(policy_value->'maximumOwnerMinutesPerRun') <> 'number' then raise exception 'maximumOwnerMinutesPerRun must be numeric or null'; end if;
    n := (policy_value->>'maximumOwnerMinutesPerRun')::numeric;
    if n < 0 then raise exception 'maximumOwnerMinutesPerRun must be >= 0'; end if;
  end if;
  if policy_value ? 'requireImprovedImpactForPromotion' and jsonb_typeof(policy_value->'requireImprovedImpactForPromotion') <> 'boolean' then raise exception 'requireImprovedImpactForPromotion must be boolean'; end if;
  if policy_value ? 'allowAutomaticPromotion' and jsonb_typeof(policy_value->'allowAutomaticPromotion') <> 'boolean' then raise exception 'allowAutomaticPromotion must be boolean'; end if;
  if policy_value ? 'promotionRequiresApproval' and jsonb_typeof(policy_value->'promotionRequiresApproval') <> 'boolean' then raise exception 'promotionRequiresApproval must be boolean'; end if;
  if policy_value ? 'autoDemoteOnHardGateFailure' and jsonb_typeof(policy_value->'autoDemoteOnHardGateFailure') <> 'boolean' then raise exception 'autoDemoteOnHardGateFailure must be boolean'; end if;
  if policy_value ? 'autoDemoteOnRegression' and jsonb_typeof(policy_value->'autoDemoteOnRegression') <> 'boolean' then raise exception 'autoDemoteOnRegression must be boolean'; end if;
  if policy_value ? 'autoSuspendOnAuthorityIncident' and jsonb_typeof(policy_value->'autoSuspendOnAuthorityIncident') <> 'boolean' then raise exception 'autoSuspendOnAuthorityIncident must be boolean'; end if;
end;
$$;

create or replace function public.enforce_autonomy_profile_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare transition_source text;
begin
  perform public.validate_gauntlet_autonomy_policy(new.policy);
  if tg_op = 'INSERT' then
    if new.current_level <> 0 or new.state <> 'active' then raise exception 'New autonomy profiles must start active at level 0'; end if;
    if new.max_level <> 4 then raise exception 'Gauntlet v1 profiles use a fixed maximum level of 4'; end if;
    return new;
  end if;
  if row(new.id,new.organization_id,new.workstream_id,new.created_at) is distinct from row(old.id,old.organization_id,old.workstream_id,old.created_at) then raise exception 'Autonomy profile identity is immutable'; end if;
  if new.max_level <> old.max_level then raise exception 'Autonomy max level is fixed in Gauntlet v1'; end if;
  if new.policy is distinct from old.policy then
    if new.policy_version <> old.policy_version + 1 then raise exception 'Autonomy policy changes must increment policy_version exactly once'; end if;
  elsif new.policy_version <> old.policy_version then raise exception 'policy_version cannot change without a policy change'; end if;
  if new.current_level is distinct from old.current_level or new.state is distinct from old.state then
    transition_source := current_setting('delegation.gauntlet_profile_change', true);
    if transition_source not in ('autonomy_decision','recovery') then raise exception 'Autonomy level/state can change only through an applied autonomy decision or explicit recovery'; end if;
  end if;
  return new;
end;
$$;
create trigger trg_autonomy_profile_invariants before insert or update on public.workstream_autonomy_profiles for each row execute function public.enforce_autonomy_profile_invariants();

create or replace function public.apply_autonomy_decision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'applied' or (tg_op = 'UPDATE' and old.status = 'applied') then return new; end if;
  perform set_config('delegation.gauntlet_profile_change','autonomy_decision',true);
  update public.workstream_autonomy_profiles
    set current_level = new.to_level,
        state = case when new.decision = 'suspend' then 'suspended' else 'active' end,
        updated_by = coalesce(new.applied_by,new.created_by)
    where organization_id = new.organization_id and workstream_id = new.workstream_id;
  perform set_config('delegation.gauntlet_profile_change','',true);
  if new.decision = 'suspend' then update public.gauntlet_cycles set status='suspended' where id=new.cycle_id and status='autonomy_review';
  else update public.gauntlet_cycles set status='closed' where id=new.cycle_id and status='autonomy_review'; end if;
  return new;
end;
$$;

create table public.autonomy_recoveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid not null references public.workstreams(id) on delete cascade,
  from_level smallint not null check (from_level between 0 and 4),
  to_level smallint not null default 0 check (to_level = 0),
  reason text not null,
  recovered_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index autonomy_recoveries_org_idx on public.autonomy_recoveries (organization_id, created_at desc);
create index autonomy_recoveries_workstream_idx on public.autonomy_recoveries (workstream_id, created_at desc);
create index autonomy_recoveries_recovered_by_idx on public.autonomy_recoveries (recovered_by);
alter table public.autonomy_recoveries enable row level security;
grant select,insert on public.autonomy_recoveries to authenticated;
grant all on public.autonomy_recoveries to service_role;
create policy autonomy_recoveries_select on public.autonomy_recoveries for select to authenticated using (public.is_platform_staff());
create policy autonomy_recoveries_insert on public.autonomy_recoveries for insert to authenticated with check (public.is_ops_manager() and recovered_by = (select auth.uid()));

create or replace function public.enforce_autonomy_recovery_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare p record;
begin
  if tg_op <> 'INSERT' then raise exception 'Autonomy recovery records are immutable'; end if;
  if btrim(new.reason) = '' then raise exception 'Autonomy recovery requires an explicit reason'; end if;
  select current_level,state into p from public.workstream_autonomy_profiles where organization_id=new.organization_id and workstream_id=new.workstream_id;
  if p.current_level is null then raise exception 'Autonomy recovery requires an existing profile'; end if;
  if p.state <> 'suspended' then raise exception 'Only a suspended autonomy profile can be recovered'; end if;
  new.from_level := p.current_level;
  new.to_level := 0;
  return new;
end;
$$;
create trigger trg_autonomy_recovery_invariants before insert or update or delete on public.autonomy_recoveries for each row execute function public.enforce_autonomy_recovery_invariants();

create or replace function public.apply_autonomy_recovery()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform set_config('delegation.gauntlet_profile_change','recovery',true);
  update public.workstream_autonomy_profiles set current_level=0,state='active',updated_by=new.recovered_by where organization_id=new.organization_id and workstream_id=new.workstream_id and state='suspended';
  perform set_config('delegation.gauntlet_profile_change','',true);
  return new;
end;
$$;
create trigger trg_autonomy_recovery_apply after insert on public.autonomy_recoveries for each row execute function public.apply_autonomy_recovery();
