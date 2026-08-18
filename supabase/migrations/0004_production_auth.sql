-- Production identity + inbound leads. Demo Northline rows must never be inserted here.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  title text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
create policy profile_self on public.profiles
  for select using (id = auth.uid() or public.is_platform_staff());
create policy profile_self_write on public.profiles
  for all using (id = auth.uid() or public.is_ops_manager());

create table if not exists public.leads (
  id text primary key,
  name text not null,
  email text not null,
  company text not null,
  outcome text not null default '',
  source text not null default 'book',
  utm jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.leads enable row level security;
create policy leads_staff_read on public.leads
  for select using (public.is_ops_manager());
create policy leads_staff_write on public.leads
  for all using (public.is_ops_manager());

create table if not exists public.execution_plans (
  request_id uuid primary key references public.requests(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.execution_plans enable row level security;
create policy ep_select on public.execution_plans
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy ep_write on public.execution_plans
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
