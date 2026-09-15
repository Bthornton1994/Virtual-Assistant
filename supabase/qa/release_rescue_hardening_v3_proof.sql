-- AI App Release Rescue hardening v3 proof.
--
-- The second independent audit's criticism was that each previous fix closed the
-- literal statement it had executed while the property stayed open. So the cases
-- here are written as PROPERTIES, and each is exercised over every value the
-- attacker controls rather than over the one value the audit happened to use:
--
--   * every access mode, not the archive label the old gate branched on;
--   * every forged purge flag, on every trigger that has a purge carve-out;
--   * every unusable grant shape — revoked, expired, other repository.
--
-- NEVER apply this file to a real Supabase project.
--
-- Usage (disposable local Postgres with the full migration chain applied):
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_hardening_v3_proof.sql

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_hardening_v3_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv3;

create or replace function rrv3.expect_refusal(p_label text, p_expect text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'RR001', message = 'EXPECTED-REFUSAL-NOT-RAISED: ' || p_label;
exception
  when others then
    if sqlstate = 'RR001' then raise; end if;
    if sqlstate in ('42883', '42P01', '42703', '42601', '42P02', '3F000') then
      raise exception using errcode = 'RR002',
        message = 'BROKEN-TEST (' || sqlstate || ') in "' || p_label || '": ' || sqlerrm;
    end if;
    if position(lower(p_expect) in lower(sqlerrm)) = 0 then
      raise exception using errcode = 'RR003',
        message = 'WRONG-REFUSAL in "' || p_label || '": expected ~"' || p_expect || '", got "' || sqlerrm || '"';
    end if;
    raise notice 'PASS refused  | %', p_label;
end $$;

create or replace function rrv3.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11110000-0000-0000-0000-000000000001', 'customer.admin@example.test'),
  ('11110000-0000-0000-0000-000000000002', 'ops.manager@example.test');

insert into public.organizations (id, name, slug)
values ('22220000-0000-0000-0000-000000000001', 'Customer Org', 'customer-org');

insert into public.organization_members (organization_id, user_id, role, status)
values ('22220000-0000-0000-0000-000000000001', '11110000-0000-0000-0000-000000000001', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role)
values ('11110000-0000-0000-0000-000000000002', 'Ops Manager', 'ops_manager');

\echo ''
\echo '=== P1. The ownership gate does not depend on the customer-declared mode ==='
--
-- The property: no engagement starts a review before an operator has recorded how
-- ownership was established. The old gate asked "is the mode
-- customer_uploaded_archive?" first, so this loop is run over EVERY mode the
-- check constraint permits, including the ones that previously skipped it.

do $$
declare
  v_mode text;
  v_id uuid;
  v_started boolean;
  v_checked integer := 0;
begin
  for v_mode in
    select unnest(array[
      'customer_uploaded_archive',
      'customer_installed_readonly_app',
      'customer_added_readonly_collaborator'
    ])
  loop
    v_id := gen_random_uuid();

    insert into public.release_rescue_engagements
      (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
    values (v_id, '22220000-0000-0000-0000-000000000001',
            jsonb_build_object('repository',
              jsonb_build_object('repositoryRef', 'acme/app', 'accessMode', v_mode)),
            -- Distinct per mode: one active engagement per scope hash is a v1 index.
            md5(v_mode) || md5('p1-' || v_mode), 'minimum_7_day', 7, v_mode);

    insert into public.release_rescue_repository_grants
      (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
    values ('22220000-0000-0000-0000-000000000001', v_id,
            case when v_mode = 'customer_uploaded_archive' then 'uploaded_archive' else 'github' end,
            'acme/app',
            case when v_mode = 'customer_added_readonly_collaborator'
                 then 'customer_added_readonly_collaborator' else v_mode end,
            now() + interval '7 days');

    v_started := true;
    begin
      update public.release_rescue_engagements set status = 'auditing' where id = v_id;
    exception when others then
      if position('ownership' in lower(sqlerrm)) = 0 then
        raise exception 'WRONG-REFUSAL for mode "%": %', v_mode, sqlerrm;
      end if;
      v_started := false;
    end;

    if v_started then
      raise exception 'MODE "%" STARTED A REVIEW WITH NO OWNERSHIP EVIDENCE', v_mode;
    end if;

    -- And the same engagement proceeds once an operator records ownership, so the
    -- gate is a gate and not a wall.
    update public.release_rescue_engagements
       set ownership_confirmation = 'provider_ownership_verified_by_operator',
           ownership_confirmed_by = '11110000-0000-0000-0000-000000000002',
           ownership_confirmation_note = 'Owner confirmed against the provider organisation record.'
     where id = v_id;
    update public.release_rescue_engagements set status = 'auditing' where id = v_id;

    v_checked := v_checked + 1;
    raise notice 'PASS property | mode "%" is gated on ownership, then proceeds', v_mode;
  end loop;

  if v_checked <> 3 then raise exception 'ONLY % MODES CHECKED', v_checked; end if;
end $$;

\echo ''
\echo '=== P2. No trigger trusts a purge flag the caller can set ==='
--
-- The property: the purge carve-out is gated on privilege, not on a GUC. v2 added
-- the privileged helper and left one trigger reading the raw flag, so the stub was
-- still forgeable. Both carve-outs are exercised here from `authenticated`, and a
-- schema-wide assertion checks that no third reader has appeared.

insert into public.release_rescue_engagements
  (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode,
   ownership_confirmation, ownership_confirmed_by, ownership_confirmation_note)
values ('33330000-0000-0000-0000-000000000001', '22220000-0000-0000-0000-000000000001',
        '{"repository":{"repositoryRef":"acme/frozen","accessMode":"customer_installed_readonly_app"},"aiAssistedReviewAccepted":false}'::jsonb,
        repeat('2', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app',
        'existing_contracted_customer_of_record', '11110000-0000-0000-0000-000000000002',
        'Master services agreement on file.');

select rrv3.expect_refusal(
  'a customer cannot forge the purge flag to overwrite a frozen scope',
  'scope is frozen at intake',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11110000-0000-0000-0000-000000000001';
  select set_config('delegation.retention_purge', 'on', true);
  update public.release_rescue_engagements
     set scope = jsonb_build_object('purged', true)
   where id = '33330000-0000-0000-0000-000000000001';
$q$);

select rrv3.expect_refusal(
  'nor use the forged flag as a step toward rewriting the reviewed repository',
  'scope is frozen at intake',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11110000-0000-0000-0000-000000000001';
  select set_config('delegation.retention_purge', 'on', true);
  update public.release_rescue_engagements
     set scope = '{"repository":{"repositoryRef":"victim/private"}}'::jsonb
   where id = '33330000-0000-0000-0000-000000000001';
$q$);

do $$
declare
  v_offenders text;
begin
  select string_agg(p.proname, ', ')
    into v_offenders
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'release\_rescue%' or p.proname like 'enforce\_release\_rescue%')
     and p.proname <> 'release_rescue_in_retention_purge'
     and pg_get_functiondef(p.oid) like '%delegation.retention_purge%';

  if v_offenders is not null then
    raise exception 'THESE FUNCTIONS READ THE FORGEABLE PURGE GUC DIRECTLY: %', v_offenders;
  end if;
  raise notice 'PASS property | only the privileged helper reads the purge flag';
end $$;

do $$
declare v_secdef boolean;
begin
  select p.prosecdef into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_release_rescue_scope_frozen';
  if v_secdef then
    raise exception 'SCOPE TRIGGER IS SECURITY DEFINER, SO ITS PRIVILEGE CHECK ANSWERS FOR THE OWNER';
  end if;
  raise notice 'PASS property | the scope trigger runs with invoker rights';
end $$;

\echo ''
\echo '=== P3. A grant counts only while it is live and only for this repository ==='
--
-- The property: the grant the review relies on must be unrevoked, unexpired, and
-- about the repository the frozen scope names. v2 counted rows, which meant a
-- customer could revoke access and the review would still start, and a grant for
-- one repository licensed a review of another.

do $$
declare
  v_case text;
  v_id uuid;
  v_started boolean;
  v_checked integer := 0;
begin
  for v_case in select unnest(array['revoked', 'expired', 'other_repository', 'wrong_access_level'])
  loop
    v_id := gen_random_uuid();

    insert into public.release_rescue_engagements
      (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode,
       ownership_confirmation, ownership_confirmed_by, ownership_confirmation_note)
    values (v_id, '22220000-0000-0000-0000-000000000001',
            '{"repository":{"repositoryRef":"acme/under-review","accessMode":"customer_installed_readonly_app"}}'::jsonb,
            md5(v_case) || md5('p3-' || v_case), 'minimum_7_day', 7, 'customer_installed_readonly_app',
            'provider_ownership_verified_by_operator', '11110000-0000-0000-0000-000000000002',
            'Owner confirmed against the provider organisation record.');

    -- `wrong_access_level` has no row at all: the column is constrained to
    -- 'read_only', so "a grant at a level we do not accept" and "no grant" are the
    -- same state, and the gate must refuse both.
    if v_case <> 'wrong_access_level' then
      -- The expired case is granted in the past so it is a grant that HAS expired,
      -- not one that was issued already dead: grant hygiene refuses the latter,
      -- and refusing for the wrong reason would not test this gate.
      insert into public.release_rescue_repository_grants
        (organization_id, engagement_id, provider, repository_ref, grant_method,
         granted_at, expires_at, revoked_at, revocation_reason)
      values ('22220000-0000-0000-0000-000000000001', v_id, 'github',
              case when v_case = 'other_repository' then 'acme/some-other-repo' else 'acme/under-review' end,
              'customer_installed_readonly_app',
              case when v_case = 'expired' then now() - interval '8 days' else now() end,
              case when v_case = 'expired' then now() - interval '1 hour' else now() + interval '7 days' end,
              case when v_case = 'revoked' then now() - interval '1 minute' else null end,
              case when v_case = 'revoked' then 'Customer revoked access.' else '' end);
    end if;

    v_started := true;
    begin
      update public.release_rescue_engagements set status = 'auditing' where id = v_id;
    exception when others then
      if position('live, unrevoked read-only grant' in lower(sqlerrm)) = 0 then
        raise exception 'WRONG-REFUSAL for case "%": %', v_case, sqlerrm;
      end if;
      v_started := false;
    end;

    if v_started then
      raise exception 'CASE "%" STARTED A REVIEW ON AN UNUSABLE GRANT', v_case;
    end if;

    v_checked := v_checked + 1;
    raise notice 'PASS property | a "%" grant does not license a review', v_case;
  end loop;

  if v_checked <> 4 then raise exception 'ONLY % GRANT CASES CHECKED', v_checked; end if;
end $$;

select rrv3.expect_refusal(
  'a scope that names no repository cannot start a review',
  'must name the repository',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, status,
     ownership_confirmation, ownership_confirmed_by, ownership_confirmation_note)
  values ('22220000-0000-0000-0000-000000000001', '{}'::jsonb, repeat('4', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app', 'auditing',
          'existing_contracted_customer_of_record', '11110000-0000-0000-0000-000000000002', 'On file.');
$q$);

do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode,
     ownership_confirmation, ownership_confirmed_by, ownership_confirmation_note)
  values (v_id, '22220000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"acme/good","accessMode":"customer_installed_readonly_app"}}'::jsonb,
          repeat('5', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app',
          'provider_ownership_verified_by_operator', '11110000-0000-0000-0000-000000000002',
          'Owner confirmed against the provider organisation record.');

  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
  values ('22220000-0000-0000-0000-000000000001', v_id, 'github', 'acme/good',
          'customer_installed_readonly_app', now() + interval '7 days');

  update public.release_rescue_engagements set status = 'auditing' where id = v_id;
  raise notice 'PASS allowed  | a live grant naming the reviewed repository does start the review';

  -- And revoking it afterwards is recorded, so the customer's revocation is real.
  update public.release_rescue_repository_grants
     set revoked_at = now(), revocation_reason = 'Customer revoked access.'
   where engagement_id = v_id;
  raise notice 'PASS allowed  | the customer can revoke a live grant';
end $$;

\echo ''
\echo '=== v3 proof complete: every case above printed PASS ==='
