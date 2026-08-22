-- QA-only operational gate record.
-- This invocation is guarded by the exact Northline QA fixture and therefore
-- is a no-op in environments that do not contain that fixture.
do $$
begin
  if exists (
    select 1
    from public.organizations
    where id = '230533c4-a1cf-4f4e-a825-d7cf93134a30'::uuid
      and name = 'Northline Consulting Test'
  ) then
    perform net.http_get(
      url := 'https://qbvmtgaphvpwpwemplje.supabase.co/functions/v1/qa-step2a-golden-path',
      timeout_milliseconds := 10000
    );
  end if;
end;
$$;
