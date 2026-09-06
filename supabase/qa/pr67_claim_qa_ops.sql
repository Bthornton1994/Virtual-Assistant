-- QA-only helper for PR67 live staff walkthrough.
-- Intentionally outside supabase/migrations so Production schema runs do not
-- create a self-serve ops_manager claim.
--
-- Safe-use guard: requires the known Northline QA fixture. Do not run against
-- Production. The function admits only the disposable PR67 identity and does
-- not merge, deploy, write GitHub, or store secrets.

do $$
begin
  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing pr67_claim_qa_ops: Northline QA fixture not present';
  end if;
end
$$;

create or replace function public.pr67_claim_qa_ops()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_operator_id uuid;
begin
  if v_uid is null then
    raise exception 'Authenticated QA user required';
  end if;

  select email, email_confirmed_at
    into v_email, v_confirmed
    from auth.users
   where id = v_uid;

  if v_email is distinct from 'pr67-076ad943802b@delegation-test.cloud' then
    raise exception 'This claim is restricted to the disposable PR67 QA identity';
  end if;
  if v_confirmed is null then
    raise exception 'Disposable PR67 QA identity is not confirmed';
  end if;

  insert into public.operators (user_id, name, platform_role, status, capacity_hours, bio)
  values (v_uid, 'PR67 disposable QA manager', 'ops_manager', 'active', 1, 'Temporary staff identity for PR67 live verification only')
  on conflict (user_id) do update set
    name = excluded.name,
    platform_role = excluded.platform_role,
    status = excluded.status,
    capacity_hours = excluded.capacity_hours,
    bio = excluded.bio
  returning id into v_operator_id;

  return v_operator_id;
end
$function$;

revoke all on function public.pr67_claim_qa_ops() from public;
revoke all on function public.pr67_claim_qa_ops() from anon;
grant execute on function public.pr67_claim_qa_ops() to authenticated;
