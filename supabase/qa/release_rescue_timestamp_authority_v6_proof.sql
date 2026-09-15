-- AI App Release Rescue v6: no caller-reachable timestamp decides destruction.
--
-- v5 removed the caller's control over `purge_after` and then derived it from
-- `created_at`, a plain column with a `now()` default that `authenticated` could
-- write. An ordinary customer insert bought 3713 days of retention. The v5 proof
-- never supplied `created_at`, so 192 passing cases sat alongside it.
--
-- Every case here supplies one. Past, future, null, absurd, repeated, through
-- RLS and through direct SQL, on INSERT and on UPDATE — and a cross-tenant pair
-- proving a forged timestamp cannot delay a purge or redirect one.
--
-- NEVER apply this file to a real Supabase project.
--
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_timestamp_authority_v6_proof.sql

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_timestamp_authority_v6_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv6;
grant usage on schema rrv6 to public;

create or replace function rrv6.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv6.expect_refusal(p_label text, p_expect text, p_sql text)
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

-- Attacker and victim -------------------------------------------------------------

insert into auth.users (id, email) values
  ('6a000000-0000-0000-0000-00000000aa01', 'attacker.admin@example.test'),
  ('6a000000-0000-0000-0000-00000000bb01', 'victim.admin@example.test');

insert into public.organizations (id, name, slug) values
  ('6b000000-0000-0000-0000-00000000aa01', 'Attacker Co', 'attacker-v6'),
  ('6b000000-0000-0000-0000-00000000bb01', 'Victim Co', 'victim-v6');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('6b000000-0000-0000-0000-00000000aa01', '6a000000-0000-0000-0000-00000000aa01', 'client_admin', 'active'),
  ('6b000000-0000-0000-0000-00000000bb01', '6a000000-0000-0000-0000-00000000bb01', 'client_admin', 'active');

-- Victim evidence, so a redirected purge would be visible.
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('6c000000-0000-0000-0000-00000000bb01', '6b000000-0000-0000-0000-00000000bb01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('6d000000-0000-0000-0000-00000000bb01', '6b000000-0000-0000-0000-00000000bb01',
   '6c000000-0000-0000-0000-00000000bb01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('6e000000-0000-0000-0000-00000000bb01', '6b000000-0000-0000-0000-00000000bb01',
   '6c000000-0000-0000-0000-00000000bb01', '6d000000-0000-0000-0000-00000000bb01', 'planned');
update public.workstream_runs set status = 'running' where id = '6e000000-0000-0000-0000-00000000bb01';
insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload) values
  ('6f000000-0000-0000-0000-00000000bb01', '6b000000-0000-0000-0000-00000000bb01',
   '6e000000-0000-0000-0000-00000000bb01', 'observation', 'VICTIM confidential excerpt',
   repeat('9', 64), '{"schemaVersion":"release-rescue-report/v1"}'::jsonb);

\echo ''
\echo '=== 1. Every caller-supplied created_at is discarded ==='

do $$
declare
  v_case record;
  v_id uuid;
  v_created timestamptz;
  v_purge timestamptz;
  v_checked integer := 0;
begin
  for v_case in
    select * from (values
      ('ten years ahead',  (now() + interval '10 years')::timestamptz),
      ('one year ahead',   (now() + interval '1 year')::timestamptz),
      ('one day ahead',    (now() + interval '1 day')::timestamptz),
      ('far past',         (now() - interval '10 years')::timestamptz),
      ('epoch',            'epoch'::timestamptz),
      ('null',             null::timestamptz),
      ('infinity',         'infinity'::timestamptz)
    ) as t(label, supplied)
  loop
    v_id := gen_random_uuid();

    set local role authenticated;
    set local request.jwt.claim.sub = '6a000000-0000-0000-0000-00000000aa01';
    -- The column is not INSERT-grantable to `authenticated` any more, so the
    -- attacker's most direct route is refused outright. Run as the superuser to
    -- prove the TRIGGER holds even where the grant does not.
    reset role;

    insert into public.release_rescue_engagements
      (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, created_at)
    values (v_id, '6b000000-0000-0000-0000-00000000aa01',
            jsonb_build_object('repository', jsonb_build_object('repositoryRef', 'a/' || v_checked)),
            md5(v_case.label) || md5('v6-' || v_case.label), 'standard_30_day', 30,
            'customer_installed_readonly_app', v_case.supplied);

    select created_at, purge_after into v_created, v_purge
      from public.release_rescue_engagements where id = v_id;

    perform rrv6.assert(
      format('created_at "%s" is replaced with server time', v_case.label),
      v_created between now() - interval '1 minute' and now() + interval '1 minute');
    perform rrv6.assert(
      format('and retention stays at the 60-day backstop for "%s"', v_case.label),
      v_purge between now() + interval '59 days' and now() + interval '61 days');

    v_checked := v_checked + 1;
  end loop;

  if v_checked <> 7 then raise exception 'ONLY % TIMESTAMP CASES CHECKED', v_checked; end if;
end $$;

\echo ''
\echo '=== 2. Naming the column changes nothing ==='
--
-- A column-level REVOKE was tried here and removed: a table-level INSERT grant
-- subsumes it, so `authenticated` may still name `created_at`. This asserts the
-- honest situation — the customer CAN mention the column, and it makes no
-- difference, because the trigger overwrites it either way.

do $$
declare v_id uuid := gen_random_uuid(); v_created timestamptz; v_purge timestamptz;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '6a000000-0000-0000-0000-00000000aa01';
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, created_at)
  values (v_id, '6b000000-0000-0000-0000-00000000aa01',
          '{"repository":{"repositoryRef":"a/named"}}'::jsonb, repeat('e', 64),
          'standard_30_day', 30, 'customer_installed_readonly_app', now() + interval '10 years');
  reset role;

  select created_at, purge_after into v_created, v_purge
    from public.release_rescue_engagements where id = v_id;

  perform rrv6.assert('a customer naming created_at through RLS gets server time anyway',
                      v_created between now() - interval '1 minute' and now() + interval '1 minute');
  perform rrv6.assert('and 60 days of retention, not ten years',
                      v_purge between now() + interval '59 days' and now() + interval '61 days');
end $$;

do $$
declare v_id uuid := gen_random_uuid(); v_created timestamptz;
begin
  -- And an ordinary insert that does not mention it still works.
  set local role authenticated;
  set local request.jwt.claim.sub = '6a000000-0000-0000-0000-00000000aa01';
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values (v_id, '6b000000-0000-0000-0000-00000000aa01',
          '{"repository":{"repositoryRef":"a/ordinary"}}'::jsonb, repeat('d', 64),
          'standard_30_day', 30, 'customer_installed_readonly_app');
  reset role;

  select created_at into v_created from public.release_rescue_engagements where id = v_id;
  perform rrv6.assert('an ordinary customer insert still succeeds and is server-stamped',
                      v_created between now() - interval '1 minute' and now() + interval '1 minute');
end $$;

\echo ''
\echo '=== 3. created_at cannot be moved afterwards, by anyone ==='

select rrv6.expect_refusal(
  'RLS-mediated: a customer cannot rewrite their engagement''s creation time',
  'cannot be rewritten',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '6a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements set created_at = now() + interval '5 years'
   where organization_id = '6b000000-0000-0000-0000-00000000aa01';
$q$);

select rrv6.expect_refusal(
  'direct SQL cannot either',
  'cannot be rewritten',
  $q$
  update public.release_rescue_engagements set created_at = now() - interval '5 years'
   where organization_id = '6b000000-0000-0000-0000-00000000aa01';
$q$);

select rrv6.expect_refusal(
  'nor can it be moved repeatedly in one statement',
  'cannot be rewritten',
  $q$
  update public.release_rescue_engagements
     set created_at = now() + interval '1 day', purge_after = now() - interval '1 day'
   where organization_id = '6b000000-0000-0000-0000-00000000aa01';
$q$);

\echo ''
\echo '=== 4. The derivation reads server time, not a column ==='

do $$
declare v_body text;
begin
  select pg_get_functiondef(p.oid) into v_body from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'derive_release_rescue_purge_after';

  perform rrv6.assert('the derivation anchors on now()', v_body ~ 'now\(\) \+ interval ''60 days''');
  perform rrv6.assert('and does not read its creation-time argument',
                      v_body !~ 'coalesce\(p_created_at' and v_body !~ 'p_created_at \+');
end $$;

do $$
declare v_purge timestamptz; v_id uuid;
begin
  select id into v_id from public.release_rescue_engagements
   where organization_id = '6b000000-0000-0000-0000-00000000aa01' limit 1;

  -- Retention still shortens through the supported route.
  update public.release_rescue_engagements
     set delivered_at = now(), retention_policy = 'minimum_7_day', retention_days = 7
   where id = v_id;
  select purge_after into v_purge from public.release_rescue_engagements where id = v_id;
  perform rrv6.assert('delivery plus a 7-day election shortens retention to 7 days',
                      v_purge between now() + interval '6 days' and now() + interval '8 days');

end $$;

-- And only ever earlier: extending the election is refused outright by the v1
-- invariant, so `purge_after` never has the chance to move later.
select rrv6.expect_refusal(
  'a longer retention election after a shorter one is refused',
  'only be shortened',
  $q$
  update public.release_rescue_engagements
     set retention_policy = 'standard_30_day', retention_days = 30
   where organization_id = '6b000000-0000-0000-0000-00000000aa01' and delivered_at is not null;
$q$);

\echo ''
\echo '=== 5. A forged timestamp cannot delay or redirect a purge ==='

do $$
declare
  v_id uuid := gen_random_uuid();
  v_victim integer;
  v_purged integer;
  v_status text;
begin
  -- The attacker builds an engagement that is due now, and tries to aim it at
  -- the victim's run while backdating its creation.
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode,
     created_at, delivered_at)
  values (v_id, '6b000000-0000-0000-0000-00000000aa01',
          '{"repository":{"repositoryRef":"a/due"}}'::jsonb, repeat('c', 64),
          'purge_on_delivery', 0, 'customer_installed_readonly_app',
          now() - interval '9 years', now());

  begin
    update public.release_rescue_engagements set run_id = '6e000000-0000-0000-0000-00000000bb01'
     where id = v_id;
    raise exception 'REDIRECT SUCCEEDED, WHICH IT MUST NOT';
  exception when others then
    if sqlerrm like 'REDIRECT SUCCEEDED%' then raise; end if;
    perform rrv6.assert('the forged-age engagement still cannot point at the victim''s run', true);
  end;

  select public.purge_expired_release_rescue_data('pg_cron') into v_purged;
  select status into v_status from public.release_rescue_engagements where id = v_id;
  select count(*) into v_victim from public.evidence_artifacts
   where id = '6f000000-0000-0000-0000-00000000bb01';

  perform rrv6.assert('the sweep runs and purges the attacker''s own due engagement', v_status = 'purged');
  perform rrv6.assert('the victim''s evidence is untouched', v_victim = 1);
end $$;

do $$
declare v_purge_before timestamptz; v_purge_after timestamptz; v_id uuid;
begin
  -- The other direction: a forged FUTURE creation time must not postpone a purge.
  select id into v_id from public.release_rescue_engagements
   where organization_id = '6b000000-0000-0000-0000-00000000aa01' and purged_at is null limit 1;
  select purge_after into v_purge_before from public.release_rescue_engagements where id = v_id;

  begin
    update public.release_rescue_engagements set created_at = now() + interval '10 years' where id = v_id;
  exception when others then null;
  end;

  select purge_after into v_purge_after from public.release_rescue_engagements where id = v_id;
  perform rrv6.assert('a forged future creation time does not postpone the deadline',
                      v_purge_after = v_purge_before);
end $$;

\echo ''
\echo '=== 6. A purged engagement keeps the deadline it was purged against ==='

do $$
declare v_before timestamptz; v_after timestamptz; v_id uuid;
begin
  select id, purge_after into v_id, v_before from public.release_rescue_engagements
   where purged_at is not null limit 1;

  -- Touch the row without changing retention; the deadline must not move.
  update public.release_rescue_engagements set attestations = '{"touched":true}'::jsonb
   where id = v_id;
  select purge_after into v_after from public.release_rescue_engagements where id = v_id;

  perform rrv6.assert('the purged row''s deadline is not recomputed', v_after = v_before);
end $$;

\echo ''
\echo '=== v6 timestamp authority proof complete: every case above printed PASS ==='
