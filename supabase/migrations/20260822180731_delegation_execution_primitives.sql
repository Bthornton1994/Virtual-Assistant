-- Delegation Cloud Step 2: typed delegation, execution runs, immutable evidence, and outcome receipts.
-- This migration is intentionally execution-neutral: it records and verifies work but does not authorize autonomous actions.

create table public.delegation_specs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid references public.workstreams(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  objective text not null,
  definition_of_done jsonb not null default '[]'::jsonb,
  trigger_description text not null default '',
  required_inputs jsonb not null default '[]'::jsonb,
  action_class text not null default 'prepare_only' check (action_class in ('prepare_only', 'low_risk_execution', 'external_execution', 'sensitive_execution')),
  authority_rules jsonb not null default '[]'::jsonb,
  approval_points jsonb not null default '[]'::jsonb,
  verification_rules jsonb not null default '[]'::jsonb,
  exception_policy jsonb not null default '[]'::jsonb,
  sla text not null default '',
  economic_envelope jsonb not null default '{}'::jsonb,
  data_policy jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  activated_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, workstream_id, version)
);

create index delegation_specs_org_workstream_idx on public.delegation_specs (organization_id, workstream_id, created_at desc);
create index delegation_specs_active_idx on public.delegation_specs (organization_id, workstream_id) where status = 'active';

create table public.workstream_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid references public.workstreams(id) on delete set null,
  request_id uuid references public.requests(id) on delete set null,
  delegation_spec_id uuid not null references public.delegation_specs(id) on delete restrict,
  status text not null default 'planned' check (status in ('planned', 'running', 'awaiting_verification', 'verified', 'failed', 'cancelled')),
  initiated_by uuid references auth.users(id) on delete set null,
  executor_summary jsonb not null default '{}'::jsonb,
  human_minutes numeric(10,2) not null default 0 check (human_minutes >= 0),
  owner_minutes numeric(10,2) not null default 0 check (owner_minutes >= 0),
  ai_cost_micros bigint not null default 0 check (ai_cost_micros >= 0),
  tool_cost_micros bigint not null default 0 check (tool_cost_micros >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workstream_runs_org_created_idx on public.workstream_runs (organization_id, created_at desc);
create index workstream_runs_spec_idx on public.workstream_runs (delegation_spec_id, created_at desc);
create index workstream_runs_request_idx on public.workstream_runs (request_id) where request_id is not null;

create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.workstream_runs(id) on delete cascade,
  request_id uuid references public.requests(id) on delete set null,
  kind text not null check (kind in ('source', 'before_after', 'test', 'deployment', 'communication', 'reconciliation', 'observation', 'other')),
  summary text not null,
  source_uri text,
  content_hash text,
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index evidence_artifacts_run_idx on public.evidence_artifacts (run_id, created_at);
create index evidence_artifacts_org_idx on public.evidence_artifacts (organization_id, created_at desc);

create table public.outcome_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null unique references public.workstream_runs(id) on delete restrict,
  verification_status text not null check (verification_status in ('passed', 'failed')),
  definition_of_done_met boolean not null,
  summary text not null,
  verification_notes text not null default '',
  actions_taken jsonb not null default '[]'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,
  unresolved_decisions jsonb not null default '[]'::jsonb,
  qa_score numeric(5,2) check (qa_score is null or (qa_score >= 0 and qa_score <= 100)),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index outcome_receipts_org_idx on public.outcome_receipts (organization_id, created_at desc);

create trigger trg_delegation_specs_updated
  before update on public.delegation_specs
  for each row execute function public.set_updated_at();

create trigger trg_workstream_runs_updated
  before update on public.workstream_runs
  for each row execute function public.set_updated_at();

alter table public.delegation_specs enable row level security;
alter table public.workstream_runs enable row level security;
alter table public.evidence_artifacts enable row level security;
alter table public.outcome_receipts enable row level security;

grant select, insert, update, delete on public.delegation_specs to authenticated;
grant select, insert, update on public.workstream_runs to authenticated;
grant select, insert on public.evidence_artifacts to authenticated;
grant select, insert on public.outcome_receipts to authenticated;

grant all on public.delegation_specs, public.workstream_runs, public.evidence_artifacts, public.outcome_receipts to service_role;

create policy delegation_specs_select on public.delegation_specs
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy delegation_specs_insert on public.delegation_specs
  for insert to authenticated
  with check (public.is_org_admin(organization_id) or public.is_ops_manager());

create policy delegation_specs_update on public.delegation_specs
  for update to authenticated
  using ((public.is_org_admin(organization_id) or public.is_ops_manager()) and status = 'draft')
  with check (public.is_org_admin(organization_id) or public.is_ops_manager());

create policy delegation_specs_delete on public.delegation_specs
  for delete to authenticated
  using ((public.is_org_admin(organization_id) or public.is_ops_manager()) and status = 'draft');

create policy workstream_runs_select on public.workstream_runs
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy workstream_runs_insert on public.workstream_runs
  for insert to authenticated
  with check (public.is_platform_staff());

create policy workstream_runs_update on public.workstream_runs
  for update to authenticated
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

create policy evidence_artifacts_select on public.evidence_artifacts
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy evidence_artifacts_insert on public.evidence_artifacts
  for insert to authenticated
  with check (public.is_platform_staff());

create policy outcome_receipts_select on public.outcome_receipts
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy outcome_receipts_insert on public.outcome_receipts
  for insert to authenticated
  with check (public.is_ops_manager());
