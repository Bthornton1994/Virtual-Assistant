-- Step 3D: multi-executor work cell.
--
-- Adds a generic executor registry and per-run executor assignments so a single
-- Workstream Run can be carried out by several replaceable executors (a research
-- agent, an independent reviewer agent, a deterministic validator) while
-- Delegation Cloud keeps sole ownership of authoritative state.
--
-- Deliberately NOT added here:
--   * no catalog_evidence_packets table. The typed Hermes packet and the typed
--     Grok review are stored as ordinary immutable rows in evidence_artifacts,
--     discriminated by payload->>'schemaVersion'. evidence_artifacts already
--     grants only select+insert to authenticated (no update, no delete), which
--     is exactly the immutability these artifacts require.
--   * no new authority. An executor profile records what an executor is allowed
--     to attempt; the Delegation Spec remains the authority ceiling and the
--     Gauntlet hard gate remains the completion gate.
--   * no secrets. Profiles hold capability and policy metadata only.

create table public.executor_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  executor_kind text not null check (executor_kind in ('agent', 'deterministic', 'human')),
  provider text not null default '',
  role text not null default '',
  status text not null default 'shadow' check (status in ('shadow', 'active', 'suspended', 'retired')),
  capabilities jsonb not null default '[]'::jsonb,
  authority_envelope jsonb not null default '{}'::jsonb,
  forbidden_actions jsonb not null default '[]'::jsonb,
  configuration_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index executor_profiles_status_idx on public.executor_profiles (status, key);

create table public.run_executor_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.workstream_runs(id) on delete cascade,
  executor_profile_id uuid not null references public.executor_profiles(id) on delete restrict,
  phase text not null check (phase in ('prepare', 'review', 'validate')),
  status text not null default 'planned' check (status in ('planned', 'running', 'completed', 'failed')),
  -- The executor's authority envelope frozen at assignment time. The live profile
  -- may later change; what governed this assignment must not.
  authority_snapshot jsonb not null default '{}'::jsonb,
  input_artifact_id uuid references public.evidence_artifacts(id) on delete restrict,
  output_artifact_id uuid references public.evidence_artifacts(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  human_minutes numeric(10,2) not null default 0 check (human_minutes >= 0),
  ai_cost_micros bigint not null default 0 check (ai_cost_micros >= 0),
  tool_cost_micros bigint not null default 0 check (tool_cost_micros >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One executor holds a given phase of a given run. A second attempt at the same
  -- phase belongs to a new Gauntlet attempt, not to a silent overwrite.
  unique (run_id, phase)
);

create index run_executor_assignments_run_idx on public.run_executor_assignments (run_id, phase);
create index run_executor_assignments_org_idx on public.run_executor_assignments (organization_id, created_at desc);
create index run_executor_assignments_profile_idx on public.run_executor_assignments (executor_profile_id, created_at desc);
create index run_executor_assignments_input_artifact_idx on public.run_executor_assignments (input_artifact_id) where input_artifact_id is not null;
create index run_executor_assignments_output_artifact_idx on public.run_executor_assignments (output_artifact_id) where output_artifact_id is not null;

create trigger trg_executor_profiles_updated
  before update on public.executor_profiles
  for each row execute function public.set_updated_at();

create trigger trg_run_executor_assignments_updated
  before update on public.run_executor_assignments
  for each row execute function public.set_updated_at();

alter table public.executor_profiles enable row level security;
alter table public.run_executor_assignments enable row level security;

grant select, insert, update on public.executor_profiles to authenticated;
grant select, insert, update on public.run_executor_assignments to authenticated;
grant all on public.executor_profiles, public.run_executor_assignments to service_role;

-- The executor registry is internal staffing detail, not customer-facing data.
-- Customers see workstreams and outcomes; the roster stays backstage.
create policy executor_profiles_select on public.executor_profiles for select to authenticated
  using (public.is_platform_staff());
create policy executor_profiles_insert on public.executor_profiles for insert to authenticated
  with check (public.is_ops_manager());
create policy executor_profiles_update on public.executor_profiles for update to authenticated
  using (public.is_ops_manager()) with check (public.is_ops_manager());

create policy run_executor_assignments_select on public.run_executor_assignments for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy run_executor_assignments_insert on public.run_executor_assignments for insert to authenticated
  with check (public.is_platform_staff());
create policy run_executor_assignments_update on public.run_executor_assignments for update to authenticated
  using (public.is_platform_staff()) with check (public.is_platform_staff());

create or replace function public.enforce_run_executor_assignment_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_org uuid;
  profile record;
  artifact_run uuid;
begin
  if tg_op = 'INSERT' then
    select organization_id into run_org from public.workstream_runs where id = new.run_id;
    if run_org is null or run_org is distinct from new.organization_id then
      raise exception 'Executor assignment must belong to the same organization as its workstream run';
    end if;

    select status, executor_kind into profile from public.executor_profiles where id = new.executor_profile_id;
    if profile.status is null then raise exception 'Executor profile not found'; end if;
    if profile.status in ('suspended', 'retired') then
      raise exception 'Executor profile is % and cannot be assigned to new work', profile.status;
    end if;
    if new.phase = 'validate' and profile.executor_kind <> 'deterministic' then
      raise exception 'The validate phase requires a deterministic executor; an AI worker cannot own a verification gate';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if row(new.id, new.organization_id, new.run_id, new.executor_profile_id, new.phase,
           new.authority_snapshot, new.created_by, new.created_at)
       is distinct from
       row(old.id, old.organization_id, old.run_id, old.executor_profile_id, old.phase,
           old.authority_snapshot, old.created_by, old.created_at) then
      raise exception 'Executor assignment identity and frozen authority snapshot are immutable';
    end if;
    if old.status in ('completed', 'failed') and new.status is distinct from old.status then
      raise exception 'A completed or failed executor assignment is terminal';
    end if;
    if old.output_artifact_id is not null and new.output_artifact_id is distinct from old.output_artifact_id then
      raise exception 'An executor assignment output artifact cannot be replaced once recorded';
    end if;
    if new.status = 'completed' and new.output_artifact_id is null then
      raise exception 'Completing an executor assignment requires its output evidence artifact';
    end if;
  end if;

  -- Referenced artifacts must belong to the same run. A review cannot silently
  -- point at evidence from a different run to manufacture provenance.
  if new.input_artifact_id is not null then
    select run_id into artifact_run from public.evidence_artifacts where id = new.input_artifact_id;
    if artifact_run is distinct from new.run_id then
      raise exception 'Executor assignment input artifact must belong to the same workstream run';
    end if;
  end if;
  if new.output_artifact_id is not null then
    select run_id into artifact_run from public.evidence_artifacts where id = new.output_artifact_id;
    if artifact_run is distinct from new.run_id then
      raise exception 'Executor assignment output artifact must belong to the same workstream run';
    end if;
  end if;

  if new.status = 'running' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('completed', 'failed') and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end;
$$;

create trigger trg_run_executor_assignment_invariants
  before insert or update on public.run_executor_assignments
  for each row execute function public.enforce_run_executor_assignment_invariants();

-- A Step 3D evidence artifact declares its typed contract version. Once written it
-- must carry a content hash, because the Grok review references the Hermes packet
-- by hash and an unhashed packet cannot be referenced provably.
create or replace function public.enforce_typed_evidence_artifact()
returns trigger
language plpgsql
set search_path = public
as $$
declare declared_version text;
begin
  declared_version := new.payload->>'schemaVersion';
  if declared_version is null then return new; end if;
  if declared_version in ('catalog-evidence-packet/v1', 'catalog-evidence-review/v1') then
    if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'A % artifact requires a sha256 content hash', declared_version;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_typed_evidence_artifact
  before insert on public.evidence_artifacts
  for each row execute function public.enforce_typed_evidence_artifact();
