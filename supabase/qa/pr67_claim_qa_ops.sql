-- QA-only helpers for PR67 live staff walkthrough.
-- Intentionally outside supabase/migrations so Production schema runs do not
-- create a self-serve ops_manager provision path.
--
-- Safe-use guard: requires the known Northline QA fixture. Do not run against
-- Production. These functions admit only the disposable PR67 identity and do
-- not merge, deploy, write GitHub, store secrets, or change Auth confirmation
-- settings. Provision writes a confirmed auth user so CI does not send mail.

do $$
begin
  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing pr67 QA helpers: Northline QA fixture not present';
  end if;
end
$$;

create or replace function public.pr67_provision_qa_ops(p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email constant text := 'bthornton9415+pr67-076ad943802b@gmail.com';
  v_uid uuid;
  v_operator_id uuid;
begin
  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing pr67_provision_qa_ops: Northline QA fixture not present';
  end if;

  if p_password is null or char_length(p_password) < 16 then
    raise exception 'Disposable QA password must be at least 16 characters';
  end if;
  if p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    raise exception 'Disposable QA password must include a letter and a number';
  end if;

  select id into v_uid from auth.users where email = v_email;

  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      email_change_token_current,
      is_sso_user,
      is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"name":"PR67 disposable QA manager"}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      '',
      '',
      false,
      false
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      created_at,
      updated_at
    ) values (
      gen_random_uuid(),
      v_uid,
      v_uid::text,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email',
      now(),
      now()
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_uid;
  end if;

  insert into public.operators (user_id, name, platform_role, status, capacity_hours, bio)
  values (
    v_uid,
    'PR67 disposable QA manager',
    'ops_manager',
    'active',
    1,
    'Temporary staff identity for PR67 live verification only'
  )
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

  if v_email is distinct from 'bthornton9415+pr67-076ad943802b@gmail.com' then
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

revoke all on function public.pr67_provision_qa_ops(text) from public;
grant execute on function public.pr67_provision_qa_ops(text) to anon;
grant execute on function public.pr67_provision_qa_ops(text) to authenticated;

revoke all on function public.pr67_claim_qa_ops() from public;
revoke all on function public.pr67_claim_qa_ops() from anon;
grant execute on function public.pr67_claim_qa_ops() to authenticated;
