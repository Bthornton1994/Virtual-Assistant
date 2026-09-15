-- AI App Release Rescue hardening proof: ownership evidence and retention scheduling.
--
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- It inserts fixture rows and deliberately attempts actions that must be refused.
--
-- Usage (disposable local Postgres with the full migration chain applied):
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_hardening_v1_proof.sql
--
-- The database must be fresh. This proof writes rows it does not tear down.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_hardening_v1_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrh;

create or replace function rrh.expect_error(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'RR001', message = 'EXPECTED-REFUSAL-NOT-RAISED: ' || p_label;
exception
  when others then
    if sqlstate = 'RR001' then raise; end if;
    -- A broken test must not read as a security refusal. These classes mean the
    -- statement never reached the guard under test.
    if sqlstate in ('42883', '42P01', '42703', '42601', '42P02', '3F000') then
      raise exception using errcode = 'RR002',
        message = 'BROKEN-TEST (' || sqlstate || ') in "' || p_label || '": ' || sqlerrm;
    end if;
    raise notice 'PASS refused  | %', p_label;
end $$;

create or replace function rrh.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id, email) values
  ('aaaa0000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('aaaa0000-0000-0000-0000-000000000002', 'ops.manager@example.test'),
  ('aaaa0000-0000-0000-0000-000000000003', 'operator@example.test');

insert into public.organizations (id, name, slug)
values ('bbbb0000-0000-0000-0000-000000000001', 'Archive Org', 'archive-org');

insert into public.organization_members (organization_id, user_id, role, status)
values ('bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role) values
  ('aaaa0000-0000-0000-0000-000000000002', 'Ops Manager', 'ops_manager'),
  ('aaaa0000-0000-0000-0000-000000000003', 'Operator', 'operator');

-- An archive engagement and an app-install engagement, same organization.
insert into public.release_rescue_engagements
  (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
values
  ('cccc0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001',
   '{"repositoryRef":"someone/else"}'::jsonb, repeat('1', 64), 'minimum_7_day', 7, 'customer_uploaded_archive'),
  ('cccc0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000001',
   '{"repositoryRef":"acme/theirs"}'::jsonb, repeat('2', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app'),
  ('cccc0000-0000-0000-0000-000000000003', 'bbbb0000-0000-0000-0000-000000000001',
   '{"repositoryRef":"acme/unknown"}'::jsonb, repeat('3', 64), 'minimum_7_day', 7, null);

-- A recorded read-only grant, which hardening v2 now requires before any review
-- may start. The grant is the evidence that the customer could act on the
-- repository at all; the access-mode label alone is only a claim.
insert into public.release_rescue_repository_grants
  (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
values
  ('bbbb0000-0000-0000-0000-000000000001', 'cccc0000-0000-0000-0000-000000000001',
   'uploaded_archive', 'someone/else', 'customer_uploaded_archive', now() + interval '7 days'),
  ('bbbb0000-0000-0000-0000-000000000001', 'cccc0000-0000-0000-0000-000000000002',
   'github', 'acme/theirs', 'customer_installed_readonly_app', now() + interval '7 days'),
  ('bbbb0000-0000-0000-0000-000000000001', 'cccc0000-0000-0000-0000-000000000003',
   'github', 'acme/unknown', 'customer_installed_readonly_app', now() + interval '7 days');

\echo ''
\echo '=== 1. An uploaded archive is not evidence of ownership ==='

select rrh.expect_error('an archive engagement cannot start a review without ownership confirmation', $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_error('nor can it reach report_ready or delivered', $q$
  update public.release_rescue_engagements set status = 'delivered'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_ok('an archive engagement may still be scoped before ownership is established', $q$
  update public.release_rescue_engagements set status = 'scoped'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_error('a plain operator cannot confirm ownership', $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = 'aaaa0000-0000-0000-0000-000000000003',
         ownership_confirmation_note = 'Checked the org page.'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_error('ownership confirmation without a named person is refused', $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmation_note = 'Checked.'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_error('ownership confirmation without a note is refused', $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = 'aaaa0000-0000-0000-0000-000000000002',
         ownership_confirmation_note = '   '
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_ok('an ops manager records how ownership was established', $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'signed_authorization_letter_on_file',
         ownership_confirmed_by = 'aaaa0000-0000-0000-0000-000000000002',
         ownership_confirmation_note = 'Authorisation letter signed by the repository owner, filed 2026-09-15.'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

do $$
declare v_at timestamptz;
begin
  select ownership_confirmed_at into v_at from public.release_rescue_engagements
   where id = 'cccc0000-0000-0000-0000-000000000001';
  if v_at is null then raise exception 'CONFIRMATION NOT TIMESTAMPED'; end if;
  raise notice 'PASS stamped  | the confirmation records when it was made';
end $$;

select rrh.expect_ok('the review may now start', $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_error('ownership attribution cannot be rewritten', $q$
  update public.release_rescue_engagements
     set ownership_confirmed_by = 'aaaa0000-0000-0000-0000-000000000003'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

select rrh.expect_error('a recorded ownership confirmation cannot be changed', $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'existing_contracted_customer_of_record'
   where id = 'cccc0000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== 2. Modes that do demonstrate control are not obstructed ==='

select rrh.expect_ok('an app-install engagement starts its review without extra confirmation', $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'cccc0000-0000-0000-0000-000000000002';
$q$);

select rrh.expect_error('an engagement with no recorded access mode cannot start a review', $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'cccc0000-0000-0000-0000-000000000003';
$q$);

\echo ''
\echo '=== 3. The retention sweep is observable and safe to schedule ==='

do $$
declare v_purged integer; v_runs integer;
begin
  select public.purge_expired_release_rescue_data('pg_cron') into v_purged;
  if v_purged <> 0 then raise exception 'SWEPT % engagements when none were due', v_purged; end if;

  select count(*) into v_runs from public.release_rescue_retention_runs where invoked_by = 'pg_cron';
  if v_runs <> 1 then raise exception 'SWEEP LEFT NO TRACE: % run rows', v_runs; end if;
  raise notice 'PASS recorded | a sweep that purges nothing still records that it ran';
end $$;

select rrh.expect_error('a sweep from an unknown caller is refused', $q$
  select public.purge_expired_release_rescue_data('somewhere_else');
$q$);

do $$
declare v_purged integer;
begin
  -- Make the archive engagement due, then sweep.
  update public.release_rescue_engagements
     set purge_after = now() - interval '1 day'
   where id = 'cccc0000-0000-0000-0000-000000000001';

  select public.purge_expired_release_rescue_data('http_schedule') into v_purged;
  if v_purged <> 1 then raise exception 'EXPECTED ONE PURGE, GOT %', v_purged; end if;
  raise notice 'PASS swept    | a due engagement is purged by the scheduled caller';

  if exists (
    select 1 from public.release_rescue_engagements
     where id = 'cccc0000-0000-0000-0000-000000000001'
       and (scope ? 'repositoryRef' or length(ownership_confirmation_note) > 0)
  ) then
    raise exception 'PURGE LEFT customer content or the ownership note';
  end if;
  raise notice 'PASS cleared  | the purge clears the ownership note along with the scope';

  -- Attribution survives: we can still show who established ownership and when,
  -- without retaining what they wrote about the customer's code.
  if not exists (
    select 1 from public.release_rescue_engagements
     where id = 'cccc0000-0000-0000-0000-000000000001'
       and ownership_confirmation = 'signed_authorization_letter_on_file'
       and ownership_confirmed_by = 'aaaa0000-0000-0000-0000-000000000002'
       and ownership_confirmed_at is not null
  ) then
    raise exception 'PURGE DESTROYED the ownership attribution';
  end if;
  raise notice 'PASS retained | who confirmed ownership, and when, survives the purge';

  select public.purge_expired_release_rescue_data('http_schedule') into v_purged;
  if v_purged <> 0 then raise exception 'PURGE NOT IDEMPOTENT: second sweep touched %', v_purged; end if;
  raise notice 'PASS idempotent | a second sweep changes nothing';
end $$;

do $$
declare v_setting text;
begin
  select current_setting('delegation.retention_purge', true) into v_setting;
  if coalesce(v_setting, 'off') = 'on' then raise exception 'PURGE FLAG LEAKED'; end if;
  raise notice 'PASS scoped   | the purge flag does not outlive the sweep';
end $$;

\echo ''
\echo '=== 4. Retention history is staff-only ==='

do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000001';
  select count(*) into v_count from public.release_rescue_retention_runs;
  if v_count <> 0 then
    raise exception 'RETENTION HISTORY LEAKED: a customer admin read % run row(s)', v_count;
  end if;
  raise notice 'PASS isolated | a customer admin reads no retention history';
end $$;

select rrh.expect_error('a customer admin cannot write retention history', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000001';
  insert into public.release_rescue_retention_runs (engagements_purged, invoked_by) values (99, 'manual');
$q$);

select rrh.expect_error('a signed-in user cannot run the sweep directly', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000002';
  select public.purge_expired_release_rescue_data('manual');
$q$);

\echo ''
\echo 'release_rescue_hardening_v1 proof complete: every case above reported PASS.'
