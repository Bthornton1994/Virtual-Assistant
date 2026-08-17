-- Customer operating memory (organization-scoped, not request-scoped).

create table if not exists public.operating_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  communication_tone text not null default '',
  preferred_meeting_windows text not null default '',
  crm_rules text not null default '',
  escalation_contacts text not null default '',
  preferred_vendors text not null default '',
  prohibited_actions text not null default '',
  approval_thresholds text not null default '',
  formatting_preferences text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.operating_memory enable row level security;

create policy tenant_select_om on public.operating_memory
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_om on public.operating_memory
  for all using (
    public.is_ops_manager()
    or (
      organization_id in (select public.my_org_ids())
      and exists (
        select 1 from public.organization_members m
        where m.user_id = auth.uid()
          and m.organization_id = operating_memory.organization_id
          and m.role = 'client_admin'
          and m.status = 'active'
      )
    )
  );
