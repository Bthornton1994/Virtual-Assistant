-- Explicit deny policies for server-only operational memory tables.
-- service_role bypasses RLS; browser roles receive no table grants.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_memory_records'
      and policyname = 'operational_memory_records_client_deny'
  ) then
    create policy operational_memory_records_client_deny
      on public.operational_memory_records
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_memory_erasures'
      and policyname = 'operational_memory_erasures_client_deny'
  ) then
    create policy operational_memory_erasures_client_deny
      on public.operational_memory_erasures
      for all to anon, authenticated
      using (false)
      with check (false);
  end if;
end;
$$;
