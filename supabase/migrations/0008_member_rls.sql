-- Break organization_members RLS recursion.
-- Policies must not SELECT the same table except through security-definer helpers.

create or replace function public.is_org_admin(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where user_id = auth.uid()
      and organization_id = target
      and role = 'client_admin'
      and status = 'active'
  );
$$;

drop policy if exists mem_select on public.organization_members;
drop policy if exists mem_write on public.organization_members;
drop policy if exists mem_self_read on public.organization_members;
drop policy if exists mem_self_activate on public.organization_members;

create policy mem_select on public.organization_members
  for select using (
    user_id = auth.uid()
    or organization_id in (select public.my_org_ids())
    or public.is_platform_staff()
  );

create policy mem_insert on public.organization_members
  for insert with check (
    public.is_ops_manager()
    or public.is_org_admin(organization_id)
  );

create policy mem_update on public.organization_members
  for update using (
    public.is_ops_manager()
    or public.is_org_admin(organization_id)
    or (user_id = auth.uid() and status = 'invited')
  )
  with check (
    public.is_ops_manager()
    or public.is_org_admin(organization_id)
    or (user_id = auth.uid() and status = 'active')
  );

create policy mem_delete on public.organization_members
  for delete using (
    public.is_ops_manager()
    or public.is_org_admin(organization_id)
  );
