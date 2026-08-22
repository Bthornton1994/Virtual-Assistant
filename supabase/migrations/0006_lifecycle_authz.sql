-- Invitation acceptance, profile bootstrap, and delivery/external gates.

alter table public.profiles add column if not exists email text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Member'),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(public.profiles.name, excluded.name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists mem_self_read on public.organization_members;
create policy mem_self_read on public.organization_members
  for select using (user_id = auth.uid() or organization_id in (select public.my_org_ids()) or public.is_platform_staff());

drop policy if exists mem_self_activate on public.organization_members;
create policy mem_self_activate on public.organization_members
  for update using (user_id = auth.uid() and status = 'invited')
  with check (user_id = auth.uid() and status = 'active');

create unique index if not exists invitations_open_email_org
  on public.invitations (organization_id, lower(email))
  where status = 'invited';

drop policy if exists inv_tenant_read on public.invitations;
create policy inv_tenant_read on public.invitations
  for select using (organization_id in (select public.my_org_ids()) or public.is_ops_manager());

drop policy if exists inv_self_accept on public.invitations;
create policy inv_self_accept on public.invitations
  for update using (lower(email) = lower(coalesce(auth.jwt()->>'email', '')))
  with check (status in ('active', 'invited'));

create or replace function public.enforce_external_delivery()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered'
     and (new.approval_level = 'external_execution' or new.external_communication is true)
     and not exists (
       select 1 from public.approvals a
       where a.request_id = new.id
         and a.kind = 'external_email'
         and a.status = 'approved'
     ) then
    raise exception 'Outbound action requires customer approval before delivery';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_external_delivery on public.requests;
create trigger trg_external_delivery
  before update on public.requests
  for each row execute function public.enforce_external_delivery();
