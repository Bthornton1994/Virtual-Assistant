-- Delegation Cloud schema + row-level security
-- Apply with the Supabase CLI or SQL editor. Authorization is enforced here
-- in addition to application checks. Proxy/middleware is not the auth boundary.

create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  industry text,
  company_size text,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('client_admin', 'client_member', 'operator', 'ops_manager', 'platform_admin')),
  status text not null default 'active' check (status in ('invited', 'active', 'removed')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.operators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null,
  platform_role text not null check (platform_role in ('operator', 'ops_manager', 'platform_admin')),
  status text not null default 'active',
  capacity_hours numeric not null default 30,
  bio text
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null
);

create table if not exists public.operator_skills (
  operator_id uuid not null references public.operators(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  proficiency int not null default 3,
  primary key (operator_id, skill_id)
);

create table if not exists public.workstream_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  objective text not null,
  sla text not null,
  recurring_tasks jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '[]'::jsonb
);

create table if not exists public.workstreams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid references public.workstream_templates(id),
  name text not null,
  objective text not null,
  sla text not null,
  recurring_tasks jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '[]'::jsonb,
  owner_user_id uuid references auth.users(id),
  status text not null default 'active',
  health_score numeric not null default 70,
  hours_returned numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workstream_id uuid references public.workstreams(id),
  title text not null,
  objective text not null,
  description text,
  deliverable text,
  priority text not null default 'medium',
  status text not null default 'draft' check (status in (
    'draft','triage','awaiting_approval','queued','in_progress','blocked','qa','ready','delivered','accepted','cancelled'
  )),
  risk_level text not null default 'low',
  approval_level text not null default 'prepare_only' check (approval_level in (
    'prepare_only','low_risk_execution','external_execution','sensitive_execution'
  )),
  due_at timestamptz,
  created_by uuid references auth.users(id),
  assigned_operator_id uuid references public.operators(id),
  estimated_effort numeric not null default 0,
  actual_effort numeric not null default 0,
  automation_score numeric not null default 0,
  recurring boolean not null default false,
  external_communication boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  title text not null,
  detail text,
  owner text not null,
  status text not null default 'pending',
  sort_order int not null default 0
);

create table if not exists public.request_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  operator_id uuid not null references public.operators(id),
  assigned_by uuid references auth.users(id),
  assigned_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  action_class text not null,
  status text not null default 'pending',
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  reason text,
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.playbooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  objective text not null,
  workstream_id uuid references public.workstreams(id),
  current_version int not null default 1,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.playbook_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  playbook_id uuid not null references public.playbooks(id) on delete cascade,
  version int not null,
  steps jsonb not null default '[]'::jsonb,
  client_preferences jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid references public.requests(id) on delete cascade,
  playbook_id uuid references public.playbooks(id) on delete cascade,
  name text not null,
  path text not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  operator_id uuid references public.operators(id),
  hours numeric not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.qa_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  reviewer_id uuid references auth.users(id),
  passed boolean not null,
  score numeric not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected',
  scopes jsonb not null default '[]'::jsonb,
  last_accessed_at timestamptz
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan text not null,
  status text not null,
  monthly_hours numeric not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz
);

create table if not exists public.usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period text not null,
  hours_used numeric not null default 0,
  hours_included numeric not null default 0,
  requests_delivered int not null default 0
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists requests_org_status_idx on public.requests (organization_id, status);
create index if not exists audit_org_idx on public.audit_events (organization_id, created_at desc);

-- Helpers (security definer, locked search_path)
create or replace function public.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid()
    and status = 'active';
$$;

create or replace function public.platform_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select platform_role
  from public.operators
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_role() is not null;
$$;

create or replace function public.is_ops_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_role() in ('ops_manager', 'platform_admin');
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.operators enable row level security;
alter table public.skills enable row level security;
alter table public.operator_skills enable row level security;
alter table public.workstream_templates enable row level security;
alter table public.workstreams enable row level security;
alter table public.requests enable row level security;
alter table public.request_steps enable row level security;
alter table public.request_assignments enable row level security;
alter table public.approvals enable row level security;
alter table public.playbooks enable row level security;
alter table public.playbook_versions enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.time_entries enable row level security;
alter table public.qa_reviews enable row level security;
alter table public.integrations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_records enable row level security;
alter table public.audit_events enable row level security;

-- Organizations
create policy org_select on public.organizations
  for select using (id in (select public.my_org_ids()) or public.is_platform_staff());
create policy org_update on public.organizations
  for update using (
    id in (select public.my_org_ids())
    or public.is_ops_manager()
  );

-- Memberships
create policy mem_select on public.organization_members
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy mem_write on public.organization_members
  for all using (
    public.is_ops_manager()
    or (
      organization_id in (select public.my_org_ids())
      and exists (
        select 1 from public.organization_members m
        where m.user_id = auth.uid()
          and m.organization_id = organization_members.organization_id
          and m.role = 'client_admin'
          and m.status = 'active'
      )
    )
  );

-- Operators / skills visible to staff and to customers as names only
create policy operators_select on public.operators
  for select using (public.is_platform_staff() or auth.uid() = user_id);
create policy operators_write on public.operators
  for all using (public.is_ops_manager());
create policy skills_read on public.skills for select using (true);
create policy operator_skills_read on public.operator_skills
  for select using (public.is_platform_staff());

create policy templates_read on public.workstream_templates for select using (auth.uid() is not null);

-- Tenant-owned tables share the same pattern
create policy ws_select on public.workstreams
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy ws_write on public.workstreams
  for all using (organization_id in (select public.my_org_ids()) or public.is_ops_manager());

create policy req_select on public.requests
  for select using (
    organization_id in (select public.my_org_ids())
    or public.is_ops_manager()
    or (
      public.platform_role() = 'operator'
      and (
        assigned_operator_id in (select id from public.operators where user_id = auth.uid())
        or assigned_operator_id is null
      )
    )
  );
create policy req_insert on public.requests
  for insert with check (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy req_update on public.requests
  for update using (
    organization_id in (select public.my_org_ids())
    or public.is_platform_staff()
  );

create policy tenant_select_steps on public.request_steps
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_steps on public.request_steps
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_asg on public.request_assignments
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_asg on public.request_assignments
  for all using (public.is_ops_manager());

create policy tenant_select_appr on public.approvals
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_appr on public.approvals
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_pb on public.playbooks
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_pb on public.playbooks
  for all using (organization_id in (select public.my_org_ids()) or public.is_ops_manager());

create policy tenant_select_pbv on public.playbook_versions
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_pbv on public.playbook_versions
  for all using (organization_id in (select public.my_org_ids()) or public.is_ops_manager());

create policy tenant_select_c on public.comments
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_c on public.comments
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_att on public.attachments
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_att on public.attachments
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_te on public.time_entries
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_te on public.time_entries
  for all using (public.is_platform_staff());

create policy tenant_select_qa on public.qa_reviews
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_qa on public.qa_reviews
  for all using (public.is_platform_staff());

create policy tenant_select_int on public.integrations
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_int on public.integrations
  for all using (organization_id in (select public.my_org_ids()) or public.is_ops_manager());

create policy tenant_select_sub on public.subscriptions
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_sub on public.subscriptions
  for all using (public.is_ops_manager());

create policy tenant_select_use on public.usage_records
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_aud on public.audit_events
  for select using (
    organization_id in (select public.my_org_ids())
    or public.is_platform_staff()
  );
create policy tenant_insert_aud on public.audit_events
  for insert with check (
    organization_id in (select public.my_org_ids())
    or public.is_platform_staff()
    or organization_id is null
  );

-- Sensitive execution cannot flip to in_progress without an approved approval.
create or replace function public.enforce_sensitive_approval()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'in_progress'
     and new.approval_level = 'sensitive_execution'
     and not exists (
       select 1 from public.approvals a
       where a.request_id = new.id
         and a.action_class = 'sensitive_execution'
         and a.status = 'approved'
     ) then
    raise exception 'Sensitive execution cannot proceed without explicit approval';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sensitive_approval on public.requests;
create trigger trg_sensitive_approval
  before update on public.requests
  for each row execute function public.enforce_sensitive_approval();

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
