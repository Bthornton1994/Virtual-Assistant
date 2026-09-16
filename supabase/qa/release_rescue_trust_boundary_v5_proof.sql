-- AI App Release Rescue v5: trust boundary and tenancy, proven.
--
-- This proof exists because the previous five proofs, 146 passing cases, could
-- coexist with a reproducible cross-tenant delete. They tested each guard against
-- the value it inspects. None of them asked whether the RELATIONSHIPS held, or
-- who the CALLER was.
--
-- So every case here is written from an attacker's seat: a real second
-- organization with a real admin, acting through `authenticated` over their own
-- rows, which is exactly the access a paying customer has. Where a case needs
-- unrestricted access it says so and runs as the superuser, because a guard that
-- only works because RLS hid the row is not a guard.
--
-- NEVER apply this file to a real Supabase project.
--
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_trust_boundary_v5_proof.sql

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_trust_boundary_v5_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv5;
grant usage on schema rrv5 to public;

create or replace function rrv5.expect_refusal(p_label text, p_expect text, p_sql text)
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

create or replace function rrv5.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

create or replace function rrv5.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

-- Two real organizations ---------------------------------------------------------

insert into auth.users (id, email) values
  ('5a000000-0000-0000-0000-00000000aa01', 'attacker.admin@example.test'),
  ('5a000000-0000-0000-0000-00000000bb01', 'victim.admin@example.test'),
  ('5a000000-0000-0000-0000-00000000cc01', 'ops.manager@example.test'),
  ('5a000000-0000-0000-0000-00000000cc02', 'other.manager@example.test'),
  ('5a000000-0000-0000-0000-00000000dd01', 'plain.operator@example.test');

insert into public.organizations (id, name, slug) values
  ('5b000000-0000-0000-0000-00000000aa01', 'Attacker Co', 'attacker-co-v5'),
  ('5b000000-0000-0000-0000-00000000bb01', 'Victim Co', 'victim-co-v5');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('5b000000-0000-0000-0000-00000000aa01', '5a000000-0000-0000-0000-00000000aa01', 'client_admin', 'active'),
  ('5b000000-0000-0000-0000-00000000bb01', '5a000000-0000-0000-0000-00000000bb01', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role) values
  ('5a000000-0000-0000-0000-00000000cc01', 'Ops Manager', 'ops_manager'),
  ('5a000000-0000-0000-0000-00000000cc02', 'Other Manager', 'ops_manager'),
  ('5a000000-0000-0000-0000-00000000dd01', 'Plain Operator', 'operator');

-- A run and evidence inside the VICTIM organization.
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('5c000000-0000-0000-0000-00000000bb01', '5b000000-0000-0000-0000-00000000bb01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('5d000000-0000-0000-0000-00000000bb01', '5b000000-0000-0000-0000-00000000bb01',
   '5c000000-0000-0000-0000-00000000bb01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('5e000000-0000-0000-0000-00000000bb01', '5b000000-0000-0000-0000-00000000bb01',
   '5c000000-0000-0000-0000-00000000bb01', '5d000000-0000-0000-0000-00000000bb01', 'planned');
update public.workstream_runs set status = 'running' where id = '5e000000-0000-0000-0000-00000000bb01';
insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload) values
  ('5f000000-0000-0000-0000-00000000bb01', '5b000000-0000-0000-0000-00000000bb01',
   '5e000000-0000-0000-0000-00000000bb01', 'observation', 'VICTIM confidential excerpt',
   repeat('9', 64), '{"schemaVersion":"release-rescue-report/v1","observationCatalogVersion":"release-rescue-observations/v1","observationCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationCatalogVersion":"release-rescue-observations/v1","observationCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb);

-- The same, inside the ATTACKER organization, so they have a legitimate run.
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('5c000000-0000-0000-0000-00000000aa01', '5b000000-0000-0000-0000-00000000aa01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('5d000000-0000-0000-0000-00000000aa01', '5b000000-0000-0000-0000-00000000aa01',
   '5c000000-0000-0000-0000-00000000aa01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('5e000000-0000-0000-0000-00000000aa01', '5b000000-0000-0000-0000-00000000aa01',
   '5c000000-0000-0000-0000-00000000aa01', '5d000000-0000-0000-0000-00000000aa01', 'planned'),
  ('5e000000-0000-0000-0000-00000000aa02', '5b000000-0000-0000-0000-00000000aa01',
   '5c000000-0000-0000-0000-00000000aa01', '5d000000-0000-0000-0000-00000000aa01', 'planned');
update public.workstream_runs set status = 'running'
 where id in ('5e000000-0000-0000-0000-00000000aa01', '5e000000-0000-0000-0000-00000000aa02');

\echo ''
\echo '=== B3-1. An engagement cannot name another organization''s run ==='
--
-- The reproduced attack, verbatim, through RLS as the attacker's own admin.

select rrv5.expect_refusal(
  'RLS-mediated: the attacker cannot point their engagement at the victim''s run',
  'release_rescue_engagements_run_organization_fkey',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode, purge_after)
  values ('5aa00000-0000-0000-0000-000000000001', '5b000000-0000-0000-0000-00000000aa01',
          '5e000000-0000-0000-0000-00000000bb01',
          '{"repository":{"repositoryRef":"attacker/own"}}'::jsonb, repeat('1', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app', now() - interval '1 day');
$q$);

-- The same, as the SUPERUSER, with RLS out of the picture entirely. A guard that
-- only holds because a policy hid the row is not a guard.
select rrv5.expect_refusal(
  'direct SQL, no RLS: the composite key refuses it just the same',
  'release_rescue_engagements_run_organization_fkey',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('5b000000-0000-0000-0000-00000000aa01', '5e000000-0000-0000-0000-00000000bb01',
          '{"repository":{"repositoryRef":"attacker/own"}}'::jsonb, repeat('2', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app');
$q$);

\echo ''
\echo '=== B3-2. run_id cannot be reassigned after it is set ==='

select rrv5.expect_ok('the attacker opens a legitimate engagement on their own run', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('5aa00000-0000-0000-0000-000000000002', '5b000000-0000-0000-0000-00000000aa01',
          '5e000000-0000-0000-0000-00000000aa01',
          '{"repository":{"repositoryRef":"attacker/own","accessMode":"customer_installed_readonly_app"}}'::jsonb,
          repeat('3', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');
$q$);

-- The immutability trigger fires before the foreign key is evaluated, so this is
-- the message that surfaces. Both would refuse it; the trigger simply gets there
-- first. The key is what covers INSERT, where there is no prior value to protect.
select rrv5.expect_refusal(
  'RLS-mediated: they cannot repoint it at the victim''s run',
  'pinned once and cannot be reassigned',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements set run_id = '5e000000-0000-0000-0000-00000000bb01'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'nor at a different run inside their OWN organization, which the key alone allows',
  'pinned once and cannot be reassigned',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements set run_id = '5e000000-0000-0000-0000-00000000aa02'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'nor null it out to orphan the evidence from the sweep',
  'pinned once and cannot be reassigned',
  $q$
  update public.release_rescue_engagements set run_id = null
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'direct SQL cannot reassign it either',
  'pinned once and cannot be reassigned',
  $q$
  update public.release_rescue_engagements set run_id = '5e000000-0000-0000-0000-00000000aa02'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'and the organization is still immutable',
  'organization is immutable',
  $q$
  update public.release_rescue_engagements set organization_id = '5b000000-0000-0000-0000-00000000bb01'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

\echo ''
\echo '=== B3-3. purge_after is server state. The caller does not get a vote ==='

do $$
declare v_purge timestamptz; v_created timestamptz;
begin
  select purge_after, created_at into v_purge, v_created from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000002';
  perform rrv5.assert('an undelivered engagement purges at the 60-day backstop',
                      v_purge between v_created + interval '59 days' and v_created + interval '61 days');
end $$;

do $$
declare v_purge timestamptz; v_id uuid := '5aa00000-0000-0000-0000-000000000003';
begin
  -- A caller who supplies a past value gets the derived value instead. Nothing is
  -- validated and nothing is refused: the field is simply not theirs.
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode, purge_after)
  values (v_id, '5b000000-0000-0000-0000-00000000aa01', '5e000000-0000-0000-0000-00000000aa02',
          '{"repository":{"repositoryRef":"attacker/second"}}'::jsonb, repeat('4', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app', now() - interval '10 years');
  reset role;

  select purge_after into v_purge from public.release_rescue_engagements where id = v_id;
  perform rrv5.assert('a forged past purge_after at INSERT is discarded, not honoured',
                      v_purge > now() + interval '59 days');
end $$;

do $$
declare v_purge timestamptz;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements set purge_after = now() - interval '1 day'
   where id = '5aa00000-0000-0000-0000-000000000003';
  reset role;

  select purge_after into v_purge from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000003';
  perform rrv5.assert('a forged past purge_after on UPDATE is discarded too',
                      v_purge > now() + interval '59 days');
end $$;

do $$
declare v_purge timestamptz;
begin
  -- Direct SQL, no RLS. The derivation is a trigger, so it still applies.
  update public.release_rescue_engagements set purge_after = now() - interval '1 day'
   where id = '5aa00000-0000-0000-0000-000000000003';
  select purge_after into v_purge from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000003';
  perform rrv5.assert('direct SQL cannot forge it either', v_purge > now() + interval '59 days');
end $$;

do $$
declare v_purge timestamptz;
begin
  -- Shortening still works, through the policy, which is the supported route.
  update public.release_rescue_engagements
     set delivered_at = now(), retention_policy = 'purge_on_delivery', retention_days = 0
   where id = '5aa00000-0000-0000-0000-000000000003';
  select purge_after into v_purge from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000003';
  perform rrv5.assert('electing purge_on_delivery still shortens retention to delivery',
                      v_purge <= now() + interval '1 minute');
end $$;

\echo ''
\echo '=== B3-4. The sweep cannot reach another tenant''s evidence ==='

do $$
declare
  v_before integer;
  v_after integer;
  v_purged integer;
begin
  select count(*) into v_before from public.evidence_artifacts
   where id = '5f000000-0000-0000-0000-00000000bb01';
  perform rrv5.assert('the victim''s evidence exists before the sweep', v_before = 1);

  -- The attacker's own engagement IS due (they elected purge_on_delivery above),
  -- so the sweep really runs and really purges — it simply cannot reach past the
  -- organization boundary while doing it.
  select public.purge_expired_release_rescue_data('pg_cron') into v_purged;
  perform rrv5.assert('the sweep purged the attacker''s own engagement', v_purged >= 1);

  select count(*) into v_after from public.evidence_artifacts
   where id = '5f000000-0000-0000-0000-00000000bb01';
  perform rrv5.assert('and the victim''s evidence is untouched', v_after = 1);
end $$;

do $$
declare v_scoped boolean;
begin
  select pg_get_functiondef(p.oid) ~ 'organization_id = v_engagement\.organization_id'
    into v_scoped
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_expired_release_rescue_data';
  perform rrv5.assert('the sweep scopes its delete by the engagement''s own organization', v_scoped);
end $$;

select rrv5.expect_refusal(
  'the sweep takes no caller-chosen target, only a closed set of labels',
  'Unknown retention sweep caller',
  $q$ select public.purge_expired_release_rescue_data(''' or true --'); $q$);

do $$
declare v_denied boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  begin
    perform public.purge_expired_release_rescue_data('manual');
  exception when others then v_denied := true;
  end;
  reset role;
  perform rrv5.assert('a customer cannot invoke the sweep at all', v_denied);
end $$;

\echo ''
\echo '=== B1. Ownership confirmation is authorized by the CALLER ==='
--
-- The reproduced attack: the customer names a real ops manager, whose UUID their
-- own SELECT policy showed them, and the gate passes.

select rrv5.expect_refusal(
  'an organization admin cannot confirm ownership by naming an ops manager',
  'acting as themselves',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc01',
         ownership_confirmation_note = 'I own it, honest.'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'nor by naming themselves',
  'acting as themselves',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000aa01',
         ownership_confirmation_note = 'Me.'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

-- A plain operator is refused one layer earlier: the UPDATE policy already
-- requires org admin or ops manager, so their statement matches no row. Asserted
-- on the row count and on the stored value, because RLS denies by invisibility
-- rather than by raising, and "no exception" is not the same as "no effect".
do $$
declare v_rows integer; v_confirmation text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000dd01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000dd01',
         ownership_confirmation_note = 'Checked the org page.'
   where id = '5aa00000-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  reset role;

  select ownership_confirmation into v_confirmation from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000002';

  perform rrv5.assert('a plain operator''s confirmation matches no row', v_rows = 0);
  perform rrv5.assert('and nothing was confirmed', v_confirmation is null);
end $$;

-- And the trigger refuses them too, independently of RLS, so the control does not
-- rest on the policy alone. Run as the superuser with the operator's identity.
do $$
declare v_refused boolean := false;
begin
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000dd01';
  begin
    update public.release_rescue_engagements
       set ownership_confirmation = 'provider_ownership_verified_by_operator',
           ownership_confirmed_by = '5a000000-0000-0000-0000-00000000dd01',
           ownership_confirmation_note = 'Checked the org page.'
     where id = '5aa00000-0000-0000-0000-000000000002';
  exception when others then v_refused := true;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  -- NOTE: as the superuser this takes the SERVER branch, which requires the named
  -- person to hold manager authority. A plain operator does not, so it refuses
  -- there too — by a different rule, which is the point of having both.
  perform rrv5.assert('the trigger refuses a plain operator on the server channel as well', v_refused);
end $$;

select rrv5.expect_refusal(
  'an ops manager cannot attribute the confirmation to a DIFFERENT manager',
  'cannot be attributed to another person',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000cc01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc02',
         ownership_confirmation_note = 'Verified.'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'and a confirmation with no note is still refused',
  'how ownership was established',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000cc01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc01',
         ownership_confirmation_note = '   '
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_ok('an ops manager confirms ownership as themselves', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000cc01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc01',
         ownership_confirmation_note = 'Repository owner matches the contracting organisation.'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

do $$
declare v_via text; v_by uuid;
begin
  select ownership_confirmed_via, ownership_confirmed_by into v_via, v_by
    from public.release_rescue_engagements where id = '5aa00000-0000-0000-0000-000000000002';
  perform rrv5.assert('the trusted channel is recorded', v_via = 'authenticated_operator');
  perform rrv5.assert('and attributed to the caller', v_by = '5a000000-0000-0000-0000-00000000cc01');
end $$;

select rrv5.expect_refusal(
  'a recorded confirmation cannot be changed, however many times it is tried',
  'cannot be changed once recorded',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000cc01';
  update public.release_rescue_engagements
     set ownership_confirmation = 'existing_contracted_customer_of_record'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'nor can its attribution be rewritten',
  'cannot be rewritten',
  $q$
  update public.release_rescue_engagements
     set ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc02'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

select rrv5.expect_refusal(
  'nor the channel it came through',
  'cannot be rewritten',
  $q$
  update public.release_rescue_engagements set ownership_confirmed_via = 'service_role'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

-- Role change: a manager who is demoted stops being able to confirm. The gate
-- reads the CALLER's CURRENT role, so this needs no cache invalidation anywhere.
--
-- Asserted on the outcome rather than on an exception: once demoted they also
-- fail the UPDATE policy, so the statement matches no row instead of raising.
-- Both are refusals; only checking for the exception would have reported a pass
-- for the wrong reason.
insert into public.release_rescue_engagements
  (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
values ('5aa00000-0000-0000-0000-000000000004', '5b000000-0000-0000-0000-00000000aa01',
        '5e000000-0000-0000-0000-00000000aa02',
        '{"repository":{"repositoryRef":"attacker/third","accessMode":"customer_installed_readonly_app"}}'::jsonb,
        repeat('5', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');

do $$
declare
  v_rows integer := 0;
  v_raised boolean := false;
  v_confirmation text;
begin
  update public.operators set platform_role = 'operator'
   where user_id = '5a000000-0000-0000-0000-00000000cc02';

  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000cc02';
    update public.release_rescue_engagements
       set ownership_confirmation = 'provider_ownership_verified_by_operator',
           ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc02',
           ownership_confirmation_note = 'Still here.'
     where id = '5aa00000-0000-0000-0000-000000000004';
    get diagnostics v_rows = row_count;
  exception when others then v_raised := true;
  end;
  reset role;

  select ownership_confirmation into v_confirmation from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000004';

  perform rrv5.assert('a demoted manager is refused, by exception or by matching no row',
                      v_raised or v_rows = 0);
  perform rrv5.assert('and the engagement is still unconfirmed', v_confirmation is null);

  update public.operators set platform_role = 'ops_manager'
   where user_id = '5a000000-0000-0000-0000-00000000cc02';
end $$;

-- Re-promoted, the same caller succeeds immediately. This is the half that proves
-- the previous case failed for the RIGHT reason rather than because the row was
-- unreachable for some unrelated cause.
select rrv5.expect_ok('and once re-promoted the same caller may confirm', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000cc02';
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000cc02',
         ownership_confirmation_note = 'Owner verified against the provider organisation record.'
   where id = '5aa00000-0000-0000-0000-000000000004';
$q$);

-- The service-role channel, stated rather than assumed: the server may name an
-- operator, and the operator must be real.
select rrv5.expect_refusal(
  'the server channel still cannot name a non-manager',
  'ops manager or platform admin',
  $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000dd01',
         ownership_confirmation_note = 'Server-side flow.'
   where id = '5aa00000-0000-0000-0000-000000000003';
$q$);

select rrv5.expect_refusal(
  'nor an unknown user',
  'ops manager or platform admin',
  $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '5a000000-0000-0000-0000-00000000aa01',
         ownership_confirmation_note = 'Server-side flow.'
   where id = '5aa00000-0000-0000-0000-000000000003';
$q$);

\echo ''
\echo '=== B1/B3. The gate still gates, end to end ==='

-- Engagement ...0002 has a named repository, a confirmed owner (by a real manager
-- acting as themselves) and a live-grant requirement still unmet, so it isolates
-- the ownership-adjacent gates rather than tripping on a missing scope field.
select rrv5.expect_refusal(
  'the attacker cannot start a review without a live grant naming their repository',
  'live, unrevoked read-only grant',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements set status = 'auditing'
   where id = '5aa00000-0000-0000-0000-000000000002';
$q$);

-- And on an engagement nobody has confirmed, the ownership gate is what stops it.
-- Engagement ...0004 was confirmed above, so a fresh one is used.
insert into public.release_rescue_engagements
  (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
values ('5aa00000-0000-0000-0000-000000000005', '5b000000-0000-0000-0000-00000000aa01',
        '5e000000-0000-0000-0000-00000000aa02',
        '{"repository":{"repositoryRef":"attacker/fourth","accessMode":"customer_installed_readonly_app"}}'::jsonb,
        repeat('6', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');
insert into public.release_rescue_repository_grants
  (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
values ('5b000000-0000-0000-0000-00000000aa01', '5aa00000-0000-0000-0000-000000000005',
        'github', 'attacker/fourth', 'customer_installed_readonly_app', now() + interval '7 days');

select rrv5.expect_refusal(
  'with access settled, the unconfirmed ownership is what blocks the review',
  'ownership',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000aa01';
  update public.release_rescue_engagements set status = 'auditing'
   where id = '5aa00000-0000-0000-0000-000000000005';
$q$);

\echo ''
\echo '=== Tenant isolation, read and write ==='

do $$
declare v_rows integer; v_visible integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '5a000000-0000-0000-0000-00000000bb01';

  select count(*) into v_visible from public.release_rescue_engagements
   where organization_id = '5b000000-0000-0000-0000-00000000aa01';

  update public.release_rescue_engagements set status = 'cancelled'
   where id = '5aa00000-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  reset role;

  perform rrv5.assert('the victim admin sees none of the attacker''s engagements', v_visible = 0);
  perform rrv5.assert('and their write matches no row', v_rows = 0);
end $$;

\echo ''
\echo '=== Repeated and interleaved lifecycle transitions ==='

do $$
declare v_purged integer; v_status text;
begin
  -- Repeated sweeps are idempotent and do not re-purge.
  select public.purge_expired_release_rescue_data('manual') into v_purged;
  perform rrv5.assert('a repeat sweep finds nothing new', v_purged = 0);

  select status into v_status from public.release_rescue_engagements
   where id = '5aa00000-0000-0000-0000-000000000003';
  perform rrv5.assert('the purged engagement stays purged', v_status = 'purged');
end $$;

select rrv5.expect_refusal(
  'a purged engagement cannot be un-purged',
  'cannot be un-purged',
  $q$
  update public.release_rescue_engagements set purged_at = null
   where id = '5aa00000-0000-0000-0000-000000000003';
$q$);

do $$
declare v_commit text; v_hash text;
begin
  select reviewed_commit_sha, scope_hash into v_commit, v_hash
    from public.release_rescue_engagements where id = '5aa00000-0000-0000-0000-000000000003';
  perform rrv5.assert('the scope hash survives the purge as accounting evidence', v_hash = repeat('4', 64));
end $$;

\echo ''
\echo '=== v5 trust boundary proof complete: every case above printed PASS ==='
