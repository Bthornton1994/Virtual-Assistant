-- QA-only operational gate record.
-- The first invocation reached the harness but failed before writes because the
-- temporary test password exceeded Supabase Auth's 72-character limit. The
-- corrected harness was invoked by this retry. Exact QA-fixture guard makes this
-- a no-op outside the dedicated QA environment.
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
