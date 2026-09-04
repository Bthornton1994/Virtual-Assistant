-- Software Factory Run Manager v1
--
-- Native control-plane overlay on Delegation Specs, Workstream Runs, evidence
-- artifacts, and Outcome Receipts. This does not grant merge, deploy, secret,
-- or GitHub mutation authority. Grok Bot and Cursor remain unconnected.

insert into public.capabilities (
  key,
  display_name,
  description,
  risk_class,
  input_contract_versions,
  output_contract_versions,
  verification_contract,
  status
) values (
  'software_factory_run_management',
  'Software Factory Run Manager',
  'Govern software work requests through Delegation Specs, Workstream Runs, structured task packets, human-mediated worker handoffs, hashed evidence, owner approval gates, and Outcome Receipts. Default action class is prepare_only. Does not merge, deploy, or mutate repositories.',
  'high',
  '["software-factory-intake/v1"]'::jsonb,
  '["software-factory-packet/v1","software-factory-handoff/v1","software-factory-evidence/v1","software-factory-receipt/v1"]'::jsonb,
  '{"kind":"native","implementation":"software-factory-run-manager/v1"}'::jsonb,
  'active'
)
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  risk_class = excluded.risk_class,
  input_contract_versions = excluded.input_contract_versions,
  output_contract_versions = excluded.output_contract_versions,
  verification_contract = excluded.verification_contract,
  status = excluded.status;

update public.capabilities
   set input_contract_versions = '["software-factory-intake/v1"]'::jsonb,
       output_contract_versions = '["software-factory-inspection/v1"]'::jsonb,
       verification_contract = '{"kind":"human_or_deterministic","implementation":"software-factory-run-manager/v1"}'::jsonb
 where key = 'software_repository_read';

update public.capabilities
   set input_contract_versions = '["software-factory-packet/v1"]'::jsonb,
       output_contract_versions = '["software-factory-handoff/v1"]'::jsonb,
       verification_contract = '{"kind":"independent-review","implementation":"software-factory-run-manager/v1"}'::jsonb
 where key = 'software_change_prepare';

update public.capabilities
   set input_contract_versions = '["software-factory-packet/v1","software-factory-evidence/v1"]'::jsonb,
       output_contract_versions = '["software-factory-verification/v1"]'::jsonb,
       verification_contract = '{"kind":"deterministic","implementation":"software-factory-run-manager/v1"}'::jsonb
 where key = 'software_change_verify';

create table public.software_factory_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id text not null check (char_length(task_id) between 1 and 64),
  workstream_run_id uuid,
  delegation_spec_id uuid,
  lifecycle_status text not null default 'intake' check (lifecycle_status in (
    'intake', 'discovery', 'planned', 'ready', 'in_progress', 'blocked',
    'pr_open', 'verification', 'awaiting_owner', 'accepted',
    'rejected', 'deferred', 'cancelled'
  )),
  action_class text not null default 'prepare_only' check (action_class = 'prepare_only'),
  may_own_authoritative_state boolean not null default false check (may_own_authoritative_state = false),
  merge_authorized_for_human boolean not null default false,
  merge_performed boolean not null default false check (merge_performed = false),
  repository text not null,
  base_branch text not null,
  frozen_in_scope jsonb not null default '[]'::jsonb check (jsonb_typeof(frozen_in_scope) = 'array'),
  frozen_acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(frozen_acceptance_criteria) = 'array'),
  packet jsonb,
  packet_hash text check (packet_hash is null or packet_hash ~ '^[0-9a-f]{64}$'),
  connector_status jsonb not null default '[]'::jsonb check (jsonb_typeof(connector_status) = 'array'),
  version integer not null default 1 check (version > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, task_id),
  unique (id, organization_id),
  unique (workstream_run_id),
  foreign key (workstream_run_id, organization_id)
    references public.workstream_runs (id, organization_id) on delete restrict,
  foreign key (delegation_spec_id, organization_id)
    references public.delegation_specs (id, organization_id) on delete restrict,
  check (
    (packet is null and packet_hash is null)
    or (packet is not null and packet_hash is not null and packet ->> 'schemaVersion' = 'software-factory-packet/v1')
  )
);

create index software_factory_runs_org_status_idx
  on public.software_factory_runs (organization_id, lifecycle_status, created_at desc);
create index software_factory_runs_workstream_idx
  on public.software_factory_runs (workstream_run_id);

create table public.software_factory_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  factory_run_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  actor_id uuid,
  actor_role text not null,
  event_type text not null,
  from_status text,
  to_status text,
  source_ref text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (idempotency_key),
  unique (id, organization_id),
  foreign key (factory_run_id, organization_id)
    references public.software_factory_runs (id, organization_id) on delete cascade,
  check (jsonb_typeof(payload) = 'object')
);

create index software_factory_events_run_idx
  on public.software_factory_events (factory_run_id, created_at);
create index software_factory_events_org_idx
  on public.software_factory_events (organization_id, created_at desc);

create table public.software_factory_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  factory_run_id uuid not null,
  kind text not null check (kind in (
    'owner_acceptance', 'merge_pr', 'deploy_production', 'modify_production_env',
    'change_permissions', 'create_or_rotate_secrets', 'purchase',
    'send_external_message', 'create_commercial_relationship',
    'delete_data_or_infrastructure', 'change_repository_vision',
    'promote_demo_data', 'expand_scope'
  )),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid,
  decided_by uuid,
  rationale text not null default '',
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  packet_hash text check (packet_hash is null or packet_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (id, organization_id),
  foreign key (factory_run_id, organization_id)
    references public.software_factory_runs (id, organization_id) on delete cascade,
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'pending') = (decided_by is null))
);

create index software_factory_approvals_run_idx
  on public.software_factory_approvals (factory_run_id, status, kind);

create trigger trg_software_factory_runs_updated
  before update on public.software_factory_runs
  for each row execute function public.set_updated_at();

create or replace function public.prevent_software_factory_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Software Factory events are append-only'
    using errcode = '23514';
end;
$$;

create trigger trg_software_factory_events_no_update
  before update or delete on public.software_factory_events
  for each row execute function public.prevent_software_factory_event_mutation();

create or replace function public.protect_software_factory_run()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.task_id is distinct from old.task_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Software Factory run identity is immutable'
      using errcode = '23514';
  end if;
  if new.action_class <> 'prepare_only' or new.may_own_authoritative_state or new.merge_performed then
    raise exception 'Software Factory v1 remains prepare_only and cannot record a performed merge'
      using errcode = '23514';
  end if;
  if new.merge_authorized_for_human
     and not exists (
       select 1
         from public.software_factory_approvals a
        where a.factory_run_id = new.id
          and a.kind = 'merge_pr'
          and a.status = 'approved'
     ) then
    raise exception 'merge_authorized_for_human requires an approved owner merge decision outside the packet'
      using errcode = '23514';
  end if;
  if new.lifecycle_status = 'accepted'
     and not exists (
       select 1
         from public.software_factory_approvals a
        where a.factory_run_id = new.id
          and a.kind = 'owner_acceptance'
          and a.status = 'approved'
          and a.packet_hash is not null
          and a.packet_hash = new.packet_hash
     ) then
    raise exception 'Accepted requires owner acceptance recorded outside the task packet'
      using errcode = '23514';
  end if;
  if new.version <> old.version + 1 and new.lifecycle_status is distinct from old.lifecycle_status then
    raise exception 'Software Factory run version must advance by one on a lifecycle change'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_protect_software_factory_run
  before update on public.software_factory_runs
  for each row execute function public.protect_software_factory_run();

create or replace function public.protect_software_factory_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.organization_id is distinct from new.organization_id
       or old.factory_run_id is distinct from new.factory_run_id
       or old.kind is distinct from new.kind
       or old.requested_by is distinct from new.requested_by
       or old.created_at is distinct from new.created_at then
      raise exception 'Software Factory approval identity is immutable'
        using errcode = '23514';
    end if;
    if old.status <> 'pending' then
      raise exception 'Software Factory approval decisions are immutable'
        using errcode = '23514';
    end if;
  end if;
  if new.status <> 'pending' and new.packet_hash is null then
    raise exception 'Software Factory owner decisions must bind to a frozen packet hash'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_protect_software_factory_approval
  before insert or update on public.software_factory_approvals
  for each row execute function public.protect_software_factory_approval();

alter table public.software_factory_runs enable row level security;
alter table public.software_factory_events enable row level security;
alter table public.software_factory_approvals enable row level security;

revoke all privileges
  on table public.software_factory_runs, public.software_factory_events, public.software_factory_approvals
  from anon, authenticated, public;

grant select on table public.software_factory_runs, public.software_factory_events, public.software_factory_approvals
  to authenticated;
grant insert, update on table public.software_factory_runs to authenticated;
grant insert on table public.software_factory_events to authenticated;
grant insert, update on table public.software_factory_approvals to authenticated;
grant all privileges
  on table public.software_factory_runs, public.software_factory_events, public.software_factory_approvals
  to service_role;
grant usage, select on sequence public.software_factory_events_id_seq to authenticated;
grant usage, select on sequence public.software_factory_events_id_seq to service_role;

create policy software_factory_runs_select on public.software_factory_runs
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy software_factory_runs_insert on public.software_factory_runs
  for insert to authenticated
  with check (public.is_platform_staff());
create policy software_factory_runs_update on public.software_factory_runs
  for update to authenticated
  using (public.is_platform_staff())
  with check (public.is_platform_staff());

create policy software_factory_events_select on public.software_factory_events
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy software_factory_events_insert on public.software_factory_events
  for insert to authenticated
  with check (public.is_platform_staff());

create policy software_factory_approvals_select on public.software_factory_approvals
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy software_factory_approvals_insert on public.software_factory_approvals
  for insert to authenticated
  with check (
    public.is_platform_staff()
    or organization_id in (select public.my_org_ids())
  );
create policy software_factory_approvals_update on public.software_factory_approvals
  for update to authenticated
  using (
    public.is_platform_staff()
    or organization_id in (select public.my_org_ids())
  )
  with check (
    public.is_platform_staff()
    or organization_id in (select public.my_org_ids())
  );
