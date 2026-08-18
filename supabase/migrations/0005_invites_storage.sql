-- Invitations and private attachment access. Apply on the Delegation Cloud project only.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('client_admin', 'client_member', 'operator', 'ops_manager')),
  status text not null default 'invited' check (status in ('invited', 'active', 'expired', 'revoked')),
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;
create policy inv_staff on public.invitations
  for all using (public.is_ops_manager());

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy attach_select on storage.objects
  for select using (
    bucket_id = 'attachments'
    and (
      public.is_platform_staff()
      or split_part(name, '/', 1) in (select public.my_org_ids()::text)
    )
  );

create policy attach_write on storage.objects
  for insert with check (
    bucket_id = 'attachments'
    and (
      public.is_platform_staff()
      or split_part(name, '/', 1) in (select public.my_org_ids()::text)
    )
  );
