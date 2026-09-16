-- AI App Release Rescue v7: destructive authority, proven per caller class.
--
-- Three rounds closed one column each and left the next: `purge_after`, then
-- `created_at`, then `purged_at`. This proof is written against the CLASS, and it
-- runs each attack as every caller that exists — anonymous, customer, org admin,
-- plain operator, ops manager, service role, the scheduled sweep, and direct SQL
-- with RLS out of the picture — because a control that only holds for one of them
-- is not a control.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_destructive_authority_v7_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv7;
grant usage on schema rrv7 to public;

create or replace function rrv7.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv7.expect_refusal(p_label text, p_expect text, p_sql text)
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

-- Two organizations, every role ---------------------------------------------------

insert into auth.users (id, email) values
  ('7a000000-0000-0000-0000-00000000aa01', 'attacker.admin@example.test'),
  ('7a000000-0000-0000-0000-00000000bb01', 'victim.admin@example.test'),
  ('7a000000-0000-0000-0000-00000000cc01', 'ops.manager@example.test'),
  ('7a000000-0000-0000-0000-00000000dd01', 'plain.operator@example.test');

insert into public.organizations (id, name, slug) values
  ('7b000000-0000-0000-0000-00000000aa01', 'Attacker Co', 'attacker-v7'),
  ('7b000000-0000-0000-0000-00000000bb01', 'Victim Co', 'victim-v7');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('7b000000-0000-0000-0000-00000000aa01', '7a000000-0000-0000-0000-00000000aa01', 'client_admin', 'active'),
  ('7b000000-0000-0000-0000-00000000bb01', '7a000000-0000-0000-0000-00000000bb01', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role) values
  ('7a000000-0000-0000-0000-00000000cc01', 'Ops Manager', 'ops_manager'),
  ('7a000000-0000-0000-0000-00000000dd01', 'Plain Operator', 'operator');

-- Victim evidence, so a redirected sweep would show.
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('7c000000-0000-0000-0000-00000000bb01', '7b000000-0000-0000-0000-00000000bb01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('7d000000-0000-0000-0000-00000000bb01', '7b000000-0000-0000-0000-00000000bb01',
   '7c000000-0000-0000-0000-00000000bb01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('7e000000-0000-0000-0000-00000000bb01', '7b000000-0000-0000-0000-00000000bb01',
   '7c000000-0000-0000-0000-00000000bb01', '7d000000-0000-0000-0000-00000000bb01', 'planned');
update public.workstream_runs set status = 'running' where id = '7e000000-0000-0000-0000-00000000bb01';
insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload) values
  ('7f000000-0000-0000-0000-00000000bb01', '7b000000-0000-0000-0000-00000000bb01',
   '7e000000-0000-0000-0000-00000000bb01', 'observation', 'VICTIM confidential excerpt',
   repeat('9', 64), '{"schemaVersion":"release-rescue-report/v1","observationCatalogVersion":"release-rescue-observations/v1","observationCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","observationCatalogVersion":"release-rescue-observations/v1","observationCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb);

-- Two engagements of the attacker's, both due for purge.
insert into public.release_rescue_engagements
  (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, delivered_at)
values
  ('7aa00000-0000-0000-0000-000000000011', '7b000000-0000-0000-0000-00000000aa01',
   '{"repository":{"repositoryRef":"a/control"}}'::jsonb, repeat('1', 64),
   'purge_on_delivery', 0, 'customer_installed_readonly_app', now()),
  ('7aa00000-0000-0000-0000-000000000022', '7b000000-0000-0000-0000-00000000aa01',
   '{"repository":{"repositoryRef":"a/forged"}}'::jsonb, repeat('2', 64),
   'purge_on_delivery', 0, 'customer_installed_readonly_app', now());

\echo ''
\echo '=== 1. purged_at, attempted by every caller class ==='

do $$
declare
  v_case record;
  v_refused boolean;
  v_rows integer;
  v_checked integer := 0;
  v_stamp timestamptz;
begin
  for v_case in
    select * from (values
      ('anonymous',       'anon',          null::text),
      ('customer admin',  'authenticated', '7a000000-0000-0000-0000-00000000aa01'),
      ('other tenant',    'authenticated', '7a000000-0000-0000-0000-00000000bb01'),
      ('plain operator',  'authenticated', '7a000000-0000-0000-0000-00000000dd01'),
      ('ops manager',     'authenticated', '7a000000-0000-0000-0000-00000000cc01'),
      ('service role',    'service_role',  null::text)
    ) as t(label, role_name, subject)
  loop
    v_refused := false;
    v_rows := 0;
    begin
      execute format('set local role %I', v_case.role_name);
      if v_case.subject is not null then
        perform set_config('request.jwt.claim.sub', v_case.subject, true);
      else
        perform set_config('request.jwt.claim.sub', '', true);
      end if;

      update public.release_rescue_engagements set purged_at = now()
       where id = '7aa00000-0000-0000-0000-000000000022';
      get diagnostics v_rows = row_count;
    exception when others then
      v_refused := true;
    end;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);

    select purged_at into v_stamp from public.release_rescue_engagements
     where id = '7aa00000-0000-0000-0000-000000000022';

    perform rrv7.assert(
      format('%s cannot stamp purged_at (refused=%s, rows=%s)', v_case.label, v_refused, v_rows),
      (v_refused or v_rows = 0) and v_stamp is null);
    v_checked := v_checked + 1;
  end loop;

  if v_checked <> 6 then raise exception 'ONLY % CALLER CLASSES CHECKED', v_checked; end if;
end $$;

select rrv7.expect_refusal(
  'direct SQL, no RLS, cannot stamp it either',
  'recorded by the retention sweep',
  $q$
  update public.release_rescue_engagements set purged_at = now()
   where id = '7aa00000-0000-0000-0000-000000000022';
$q$);

select rrv7.expect_refusal(
  'nor can an engagement be created already purged',
  'cannot be created already purged',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, purged_at)
  values ('7b000000-0000-0000-0000-00000000aa01', '{"repository":{"repositoryRef":"a/born-purged"}}'::jsonb,
          repeat('3', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app', now());
$q$);

select rrv7.expect_refusal(
  'a forged purge GUC does not help, because the privilege is the check',
  'recorded by the retention sweep',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '7a000000-0000-0000-0000-00000000aa01';
  select set_config('delegation.retention_purge', 'on', true);
  update public.release_rescue_engagements set purged_at = now()
   where id = '7aa00000-0000-0000-0000-000000000022';
$q$);

\echo ''
\echo '=== 2. The sweep still works, and reaches only its own tenant ==='

do $$
declare v_purged integer; v_control text; v_forged text; v_victim integer;
begin
  select public.purge_expired_release_rescue_data('pg_cron') into v_purged;

  select status into v_control from public.release_rescue_engagements
   where id = '7aa00000-0000-0000-0000-000000000011';
  select status into v_forged from public.release_rescue_engagements
   where id = '7aa00000-0000-0000-0000-000000000022';
  select count(*) into v_victim from public.evidence_artifacts
   where id = '7f000000-0000-0000-0000-00000000bb01';

  perform rrv7.assert('the sweep purged both due engagements', v_purged = 2);
  perform rrv7.assert('the control engagement is purged', v_control = 'purged');
  perform rrv7.assert('the one the customer tried to protect is purged too', v_forged = 'purged');
  perform rrv7.assert('and the other tenant''s evidence is untouched', v_victim = 1);
end $$;

do $$
declare v_hash text; v_verdict integer;
begin
  select scope_hash into v_hash from public.release_rescue_engagements
   where id = '7aa00000-0000-0000-0000-000000000022';
  select count(*) into v_verdict from public.release_rescue_engagements
   where id = '7aa00000-0000-0000-0000-000000000022' and scope = jsonb_build_object('purged', true);

  perform rrv7.assert('retention accounting survives the content purge', v_hash = repeat('2', 64));
  perform rrv7.assert('and the content is gone', v_verdict = 1);
end $$;

select rrv7.expect_refusal(
  'a purged engagement cannot be un-purged, even inside the sweep',
  'cannot be un-purged',
  $q$
  update public.release_rescue_engagements set purged_at = null
   where id = '7aa00000-0000-0000-0000-000000000022';
$q$);

\echo ''
\echo '=== 3. A secret-hold clearance names an accountable operator ==='

insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('7c000000-0000-0000-0000-00000000aa01', '7b000000-0000-0000-0000-00000000aa01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('7d000000-0000-0000-0000-00000000aa01', '7b000000-0000-0000-0000-00000000aa01',
   '7c000000-0000-0000-0000-00000000aa01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('7e000000-0000-0000-0000-00000000aa01', '7b000000-0000-0000-0000-00000000aa01',
   '7c000000-0000-0000-0000-00000000aa01', '7d000000-0000-0000-0000-00000000aa01', 'planned');
update public.workstream_runs set status = 'running' where id = '7e000000-0000-0000-0000-00000000aa01';

insert into public.release_rescue_engagements
  (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
values ('7aa00000-0000-0000-0000-000000000033', '7b000000-0000-0000-0000-00000000aa01',
        '7e000000-0000-0000-0000-00000000aa01',
        '{"repository":{"repositoryRef":"a/report","accessMode":"customer_installed_readonly_app"}}'::jsonb,
        repeat('4', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');
update public.release_rescue_engagements
   set snapshot_limits_version = 'release-rescue-snapshot-limits/v1' where id = '7aa00000-0000-0000-0000-000000000033';
insert into public.release_rescue_repository_grants
  (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
values ('7b000000-0000-0000-0000-00000000aa01', '7aa00000-0000-0000-0000-000000000033',
        'github', 'a/report', 'customer_installed_readonly_app', now() + interval '7 days');
update public.release_rescue_engagements set reviewed_commit_sha = repeat('a', 40)
 where id = '7aa00000-0000-0000-0000-000000000033';

-- A report body whose clearance names a non-operator.
insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('7f000000-0000-0000-0000-00000000aa01', '7b000000-0000-0000-0000-00000000aa01',
        '7e000000-0000-0000-0000-00000000aa01', 'observation', 'forged clearance', repeat('a', 64),
        jsonb_build_object(
          'schemaVersion', 'release-rescue-report/v1',
          'observationCatalogVersion', 'release-rescue-observations/v1',
          'observationCatalogHash', repeat('a', 64),
          'reviewedCommitSha', repeat('a', 40),
          'clearedSecretHolds', jsonb_build_array(jsonb_build_object(
            -- v10: a clearance records a reason CODE from a closed set, not a
            -- note. A written reason is free text on the one path that exists
            -- to RELEASE withheld material, which is the worst place for it.
            'path', '$.reviewedBy.displayName', 'clearedContentHash', repeat('b', 64),
            'clearedBy', 'x', 'clearedAt', '2026-09-16T00:00:00Z',
            'reasonCode', 'value_is_a_placeholder_not_a_credential'))));

select rrv7.expect_refusal(
  'a clearance naming an arbitrary string is refused',
  'name an operator by id',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('7b000000-0000-0000-0000-00000000aa01', '7aa00000-0000-0000-0000-000000000033',
          '7e000000-0000-0000-0000-00000000aa01', '7f000000-0000-0000-0000-00000000aa01',
          'release-rescue-report/v1', repeat('1', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('4', 64), 'conditional_release', 0, 32, 32, 'auditor',
          '7a000000-0000-0000-0000-00000000cc01');
$q$);

insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('7f000000-0000-0000-0000-00000000aa02', '7b000000-0000-0000-0000-00000000aa01',
        '7e000000-0000-0000-0000-00000000aa01', 'observation', 'operator clearance', repeat('c', 64),
        jsonb_build_object(
          'schemaVersion', 'release-rescue-report/v1',
          'observationCatalogVersion', 'release-rescue-observations/v1',
          'observationCatalogHash', repeat('a', 64),
          'reviewedCommitSha', repeat('a', 40),
          'clearedSecretHolds', jsonb_build_array(jsonb_build_object(
            'path', '$.reviewedBy.displayName', 'clearedContentHash', repeat('b', 64),
            'clearedBy', '7a000000-0000-0000-0000-00000000dd01',
            'clearedAt', '2026-09-16T00:00:00Z',
            'reasonCode', 'value_is_a_placeholder_not_a_credential'))));

select rrv7.expect_refusal(
  'a clearance by a plain operator is refused',
  'ops manager or platform admin',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('7b000000-0000-0000-0000-00000000aa01', '7aa00000-0000-0000-0000-000000000033',
          '7e000000-0000-0000-0000-00000000aa01', '7f000000-0000-0000-0000-00000000aa02',
          'release-rescue-report/v1', repeat('3', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('4', 64), 'conditional_release', 0, 32, 32, 'auditor',
          '7a000000-0000-0000-0000-00000000cc01');
$q$);

insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('7f000000-0000-0000-0000-00000000aa03', '7b000000-0000-0000-0000-00000000aa01',
        '7e000000-0000-0000-0000-00000000aa01', 'observation', 'manager clearance', repeat('d', 64),
        jsonb_build_object(
          'schemaVersion', 'release-rescue-report/v1',
          'observationCatalogVersion', 'release-rescue-observations/v1',
          'observationCatalogHash', repeat('a', 64),
          'reviewedCommitSha', repeat('a', 40),
          'clearedSecretHolds', jsonb_build_array(jsonb_build_object(
            'path', '$.reviewedBy.displayName', 'clearedContentHash', repeat('b', 64),
            'clearedBy', '7a000000-0000-0000-0000-00000000cc01',
            'clearedAt', '2026-09-16T00:00:00Z', 'reasonCode', 'value_is_a_documented_example'))));

do $$
begin
  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('7cc00000-0000-0000-0000-000000000001', '7b000000-0000-0000-0000-00000000aa01',
          '7aa00000-0000-0000-0000-000000000033', '7e000000-0000-0000-0000-00000000aa01',
          '7f000000-0000-0000-0000-00000000aa03', 'release-rescue-report/v1', repeat('5', 64),
          'release-rescue-rubric/v1', repeat('2', 64), repeat('4', 64), 'conditional_release', 0,
          32, 32, 'auditor', '7a000000-0000-0000-0000-00000000cc01');
  perform rrv7.assert('a clearance by an ops manager is accepted', true);
end $$;

-- The report stamp, attempted by every caller class.
--
-- RLS denies by invisibility, not by raising: a caller with no UPDATE reach
-- matches zero rows and no exception is thrown. Expecting a refusal here would
-- pass for the wrong reason on the roles RLS covers and would say nothing about
-- the trigger. So this asserts the outcome that actually matters -- the stamp is
-- still null -- and records which of the two controls did the work, then proves
-- the trigger on its own below with RLS out of the picture.
do $$
declare
  v_case record;
  v_refused boolean;
  v_rows integer;
  v_checked integer := 0;
  v_stamp timestamptz;
begin
  for v_case in
    select * from (values
      ('anonymous',       'anon',          null::text),
      ('customer admin',  'authenticated', '7a000000-0000-0000-0000-00000000aa01'),
      ('other tenant',    'authenticated', '7a000000-0000-0000-0000-00000000bb01'),
      ('plain operator',  'authenticated', '7a000000-0000-0000-0000-00000000dd01'),
      ('ops manager',     'authenticated', '7a000000-0000-0000-0000-00000000cc01'),
      ('service role',    'service_role',  null::text)
    ) as t(label, role_name, subject)
  loop
    v_refused := false;
    v_rows := 0;
    begin
      execute format('set local role %I', v_case.role_name);
      if v_case.subject is not null then
        perform set_config('request.jwt.claim.sub', v_case.subject, true);
      else
        perform set_config('request.jwt.claim.sub', '', true);
      end if;

      update public.release_rescue_reports set purged_at = now()
       where id = '7cc00000-0000-0000-0000-000000000001';
      get diagnostics v_rows = row_count;
    exception when others then
      v_refused := true;
    end;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);

    select purged_at into v_stamp from public.release_rescue_reports
     where id = '7cc00000-0000-0000-0000-000000000001';

    perform rrv7.assert(
      format('%s cannot stamp a report purged (refused=%s, rows=%s)', v_case.label, v_refused, v_rows),
      (v_refused or v_rows = 0) and v_stamp is null);
    v_checked := v_checked + 1;
  end loop;

  if v_checked <> 6 then raise exception 'ONLY % REPORT CALLER CLASSES CHECKED', v_checked; end if;
end $$;

-- RLS out of the picture: a trigger alone has to refuse this.
--
-- The refusal here comes from the v2 report immutability trigger, which sorts
-- ahead of the v7 purge-stamp trigger and already rejects every report update
-- except stamping `delivered_at`. That is the answer we want; the wording just
-- belongs to the guard that got there first. The v7 trigger is the layer behind
-- it, and the two cases below reach it where v2 does not look.
select rrv7.expect_refusal(
  'direct SQL, no RLS, cannot stamp a report purged',
  'permitted report update',
  $q$
  update public.release_rescue_reports set purged_at = now()
   where id = '7cc00000-0000-0000-0000-000000000001';
$q$);

-- The forged flag, by the one ordinary caller that has UPDATE reach here. An ops
-- manager can stamp `delivered_at` under RLS, so unlike a customer they do reach
-- the triggers -- and the flag is a transaction-local GUC anyone may set. It buys
-- them nothing: `release_rescue_in_retention_purge()` also demands EXECUTE on the
-- sweep function, which they do not hold, so the purge carve-out stays shut and
-- the ordinary immutability rule answers.
select rrv7.expect_refusal(
  'a forged retention flag cannot stamp a report purged',
  'permitted report update',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '7a000000-0000-0000-0000-00000000cc01';
  select set_config('delegation.retention_purge', 'on', true);
  update public.release_rescue_reports set purged_at = now()
   where id = '7cc00000-0000-0000-0000-000000000001';
$q$);

-- `service_role` does hold the sweep's EXECUTE privilege, so the flag is true for it.
-- That is the sweep's own identity, and the control that still has to hold is
-- shape: it may clear the body, not stamp a row purged while the artifact stays.
select rrv7.expect_refusal(
  'the sweep identity cannot stamp a report purged while keeping its body',
  'must clear report_artifact_id',
  $q$
  set local role service_role;
  select set_config('delegation.retention_purge', 'on', true);
  update public.release_rescue_reports set purged_at = now()
   where id = '7cc00000-0000-0000-0000-000000000001';
$q$);

-- v2 guards UPDATE and DELETE only. A report born already purged is the v7
-- trigger's own case, and the sweep would skip such a row forever.
select rrv7.expect_refusal(
  'a report cannot be created already purged',
  'created already purged',
  $q$
  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by, purged_at)
  values ('7cc00000-0000-0000-0000-0000000000f1', '7b000000-0000-0000-0000-00000000aa01',
          '7aa00000-0000-0000-0000-000000000033', '7e000000-0000-0000-0000-00000000aa01',
          '7f000000-0000-0000-0000-00000000aa03', 'release-rescue-report/v1', repeat('6', 64),
          'release-rescue-rubric/v1', repeat('2', 64), repeat('4', 64), 'conditional_release', 0,
          32, 32, 'auditor', '7a000000-0000-0000-0000-00000000cc01', now());
$q$);

-- The clearance trigger is `security definer`, so its reads bypass RLS. An audit
-- pointed it at another tenant's artifact and had the refusal quote that
-- artifact's payload back. The pre-existing org-match guard exists, but triggers
-- fire in NAME order and the clearance trigger sorts ahead of it, so it ran first
-- on content it should never have been able to read.
insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('7f000000-0000-0000-0000-00000000bb09', '7b000000-0000-0000-0000-00000000bb01',
        '7e000000-0000-0000-0000-00000000bb01', 'observation', 'victim body', repeat('c', 64),
        jsonb_build_object(
          'schemaVersion', 'release-rescue-report/v1',
          'observationCatalogVersion', 'release-rescue-observations/v1',
          'observationCatalogHash', repeat('a', 64),
          'clearedSecretHolds', jsonb_build_array(jsonb_build_object(
            'path', '$.reviewedBy.displayName',
            'clearedBy', 'VICTIM-CONFIDENTIAL-STRING-abc123',
            'clearedContentHash', repeat('b', 64),
            'clearedAt', '2026-09-16T00:00:00Z', 'reasonCode', 'value_is_a_documented_example'))));

do $$
declare v_message text; v_state text;
begin
  begin
    insert into public.release_rescue_reports
      (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
       rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
       coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
    values ('7cc00000-0000-0000-0000-0000000000f9', '7b000000-0000-0000-0000-00000000aa01',
            '7aa00000-0000-0000-0000-000000000033', '7e000000-0000-0000-0000-00000000aa01',
            '7f000000-0000-0000-0000-00000000bb09', 'release-rescue-report/v1', repeat('9', 64),
            'release-rescue-rubric/v1', repeat('2', 64), repeat('4', 64), 'conditional_release', 0,
            32, 32, 'auditor', '7a000000-0000-0000-0000-00000000cc01');
    v_message := '(accepted)';
  exception when others then
    v_message := sqlerrm;
    v_state := sqlstate;
  end;

  -- Refused, and the refusal must come from the ISOLATION rule, not from the
  -- clearance rule -- and must not carry the victim's content in its text.
  perform rrv7.assert(
    format('a cross-tenant report artifact is refused (%s)', left(v_message, 60)),
    v_message <> '(accepted)');
  perform rrv7.assert(
    'and the refusal does not echo the other tenant''s payload',
    position('VICTIM-CONFIDENTIAL-STRING-abc123' in v_message) = 0);
  perform rrv7.assert(
    'and it is the organization rule that answers, not the clearance rule',
    v_message like '%organization%');
end $$;

-- --------------------------------------------------------------------------------
-- The SECURITY DEFINER class, enumerated rather than named
-- --------------------------------------------------------------------------------
--
-- Two rounds fixed one definer trigger each. Audit 6 found the clearance trigger
-- reading `evidence_artifacts` past RLS; it was scoped, and audit 7 found
-- `enforce_release_rescue_report_commit` doing the same thing four lines away.
-- Naming the next one would invite an eighth.
--
-- So this asserts the PROPERTY over every definer function in the schema: a
-- definer function runs with the owner's reach, so any read of a tenant-owned
-- table inside one must carry an `organization_id` conjunct. A new function
-- without one fails this proof on the day it is written.
-- The check itself, and then a NEGATIVE CONTROL that proves it can fail.
--
-- The first version of this block was unsound in four ways, and an audit
-- demonstrated all four by planting functions that it passed:
--
--   * it filtered `proname like '%release_rescue%'`, so 8 of 15 definer
--     functions were examined and renaming one was the bypass;
--   * it tested `substring(body from position(table in body)) ~ 'organization_id'`,
--     which is satisfied by the string appearing ANYWHERE later -- in a comment,
--     or in an unrelated statement further down;
--   * it matched only `from <table>`, so a `join` read was invisible;
--   * its table list was six names, where 40-odd public tables carry
--     `organization_id`.
--
-- This version examines every definer function in `public`, derives the tenant
-- tables from the catalogue, matches `from` and `join`, strips comments, and
-- tests the conjunct within the same statement.
create or replace function rrv7.unscoped_tenant_reads(p_src text)
returns text[] language plpgsql as $fn$
declare
  v_body text;
  v_table text;
  v_stmt text;
  v_offenders text[] := '{}';
begin
  -- Comments cannot satisfy the conjunct.
  v_body := regexp_replace(lower(p_src), '--[^\n]*', ' ', 'g');
  v_body := regexp_replace(v_body, '/\*.*?\*/', ' ', 'g');

  for v_table in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r'
       and a.attname = 'organization_id' and a.attnum > 0 and not a.attisdropped
  loop
    -- Each statement that reads the table, on its own, so a scoped read
    -- elsewhere in the function cannot vouch for an unscoped one here.
    for v_stmt in
      select regexp_split_to_table(v_body, ';')
    loop
      if v_stmt ~ ('(from|join)\s+(public\.)?' || v_table || '\M')
         and v_stmt !~ 'organization_id' then
        v_offenders := array_append(v_offenders, v_table);
      end if;
    end loop;
  end loop;

  return v_offenders;
end $fn$;

do $$
declare
  v_fn record;
  v_offenders text[] := '{}';
  v_found text[];
  v_checked integer := 0;
begin
  for v_fn in
    select p.proname, p.prosrc
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    v_checked := v_checked + 1;
    v_found := rrv7.unscoped_tenant_reads(v_fn.prosrc);
    if cardinality(v_found) > 0 then
      v_offenders := array_append(v_offenders, v_fn.proname || ' -> ' || array_to_string(v_found, ','));
    end if;
  end loop;

  perform rrv7.assert(
    format('every SECURITY DEFINER function in public was examined (%s)', v_checked),
    v_checked >= 12);
  perform rrv7.assert(
    format('none reads a tenant table unscoped (%s)', v_offenders),
    cardinality(v_offenders) = 0);
end $$;

-- The negative control. A property proof that has never been seen to fail is not
-- evidence, and the document previously claimed this had been verified against a
-- planted violation when no such control was committed. These are the exact four
-- shapes the audit planted, including the two the first version missed.
do $$
declare v_missed text[] := '{}';
begin
  -- 1. Unscoped read, with `organization_id` present only in a comment.
  if cardinality(rrv7.unscoped_tenant_reads(
    'select payload into v from public.evidence_artifacts where id = p; -- organization_id checked elsewhere'
  )) = 0 then v_missed := array_append(v_missed, 'comment-only conjunct'); end if;

  -- 2. A scoped read followed by an unscoped one of the same table.
  if cardinality(rrv7.unscoped_tenant_reads(
    'select 1 from public.evidence_artifacts where id = a and organization_id = o; select payload from public.evidence_artifacts where id = b;'
  )) = 0 then v_missed := array_append(v_missed, 'second unscoped read'); end if;

  -- 3. Reached by JOIN rather than FROM.
  if cardinality(rrv7.unscoped_tenant_reads(
    'select ea.payload from public.operators op join public.evidence_artifacts ea on ea.id = op.artifact_id;'
  )) = 0 then v_missed := array_append(v_missed, 'join read'); end if;

  -- 4. A tenant table outside the old six-name list. The catalogue reports 42
  --    tables in `public` carrying `organization_id`; the hand-written list had
  --    six. (`release_rescue_retention_runs` is deliberately NOT one of them: it
  --    is global accounting and carries no `organization_id`, which the first
  --    draft of this control got wrong and this control caught.)
  if cardinality(rrv7.unscoped_tenant_reads(
    'select * from public.outcome_receipts where id = p;'
  )) = 0 then v_missed := array_append(v_missed, 'table outside the hand-written list'); end if;

  perform rrv7.assert(
    format('the definer check catches every planted violation (missed: %s)', v_missed),
    cardinality(v_missed) = 0);

  -- And does not fire on a correctly scoped read.
  perform rrv7.assert(
    'the definer check does not fire on a scoped read',
    cardinality(rrv7.unscoped_tenant_reads(
      'select payload into v from public.evidence_artifacts where id = p and organization_id = o;'
    )) = 0);
end $$;

-- And the instance audit 7 reproduced, kept as a case in its own right: a report
-- pointed at another tenant's artifact must be refused WITHOUT the refusal
-- carrying that tenant's commit SHA.
insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('7f000000-0000-0000-0000-00000000bb0a', '7b000000-0000-0000-0000-00000000bb01',
        '7e000000-0000-0000-0000-00000000bb01', 'observation', 'victim commit', repeat('7', 64),
        jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
                           'reviewedCommitSha', repeat('f', 40)));

do $$
declare v_message text;
begin
  begin
    insert into public.release_rescue_reports
      (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
       rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
       coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
    values ('7cc00000-0000-0000-0000-0000000000fa', '7b000000-0000-0000-0000-00000000aa01',
            '7aa00000-0000-0000-0000-000000000033', '7e000000-0000-0000-0000-00000000aa01',
            '7f000000-0000-0000-0000-00000000bb0a', 'release-rescue-report/v1', repeat('a', 64),
            'release-rescue-rubric/v1', repeat('2', 64), repeat('4', 64), 'conditional_release', 0,
            32, 32, 'auditor', '7a000000-0000-0000-0000-00000000cc01');
    v_message := '(accepted)';
  exception when others then
    v_message := sqlerrm;
  end;

  perform rrv7.assert('a report naming another tenant''s artifact is refused',
                      v_message <> '(accepted)');
  perform rrv7.assert('and the refusal does not carry the other tenant''s commit sha',
                      position(repeat('f', 40) in v_message) = 0);
end $$;

-- The positive control. Everything above proves the column is refused; this proves
-- the refusals did not simply break retention, which is the failure mode that would
-- look identical from the outside. Engagement `...0033` is not due (7-day policy,
-- undelivered), so the sweep needs a due engagement that actually carries a report.
-- Its own run, as a real engagement has: the sweep scopes artifact deletion by
-- run, so sharing one would purge the other engagement's report body too.
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status)
values ('7e000000-0000-0000-0000-00000000aa44', '7b000000-0000-0000-0000-00000000aa01',
        '7c000000-0000-0000-0000-00000000aa01', '7d000000-0000-0000-0000-00000000aa01', 'planned');
update public.workstream_runs set status = 'running' where id = '7e000000-0000-0000-0000-00000000aa44';

insert into public.release_rescue_engagements
  (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days,
   access_mode, delivered_at)
values ('7aa00000-0000-0000-0000-000000000044', '7b000000-0000-0000-0000-00000000aa01',
        '7e000000-0000-0000-0000-00000000aa44',
        '{"repository":{"repositoryRef":"a/due","accessMode":"customer_installed_readonly_app"}}'::jsonb,
        repeat('7', 64), 'purge_on_delivery', 0, 'customer_installed_readonly_app', now());
update public.release_rescue_engagements
   set snapshot_limits_version = 'release-rescue-snapshot-limits/v1'
 where id = '7aa00000-0000-0000-0000-000000000044';
insert into public.release_rescue_repository_grants
  (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
values ('7b000000-0000-0000-0000-00000000aa01', '7aa00000-0000-0000-0000-000000000044',
        'github', 'a/due', 'customer_installed_readonly_app', now() + interval '7 days');
update public.release_rescue_engagements set reviewed_commit_sha = repeat('a', 40)
 where id = '7aa00000-0000-0000-0000-000000000044';

insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('7f000000-0000-0000-0000-00000000aa04', '7b000000-0000-0000-0000-00000000aa01',
        '7e000000-0000-0000-0000-00000000aa44', 'observation', 'due report body', repeat('e', 64),
        jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
                           'reviewedCommitSha', repeat('a', 40)));

insert into public.release_rescue_reports
  (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
   rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
   coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
values ('7cc00000-0000-0000-0000-000000000044', '7b000000-0000-0000-0000-00000000aa01',
        '7aa00000-0000-0000-0000-000000000044', '7e000000-0000-0000-0000-00000000aa44',
        '7f000000-0000-0000-0000-00000000aa04', 'release-rescue-report/v1', repeat('8', 64),
        'release-rescue-rubric/v1', repeat('2', 64), repeat('7', 64), 'conditional_release', 0,
        32, 32, 'auditor', '7a000000-0000-0000-0000-00000000cc01');

do $$
declare v_stamp timestamptz; v_body uuid; v_untouched timestamptz;
begin
  perform public.purge_expired_release_rescue_data('manual');

  select purged_at, report_artifact_id into v_stamp, v_body
    from public.release_rescue_reports where id = '7cc00000-0000-0000-0000-000000000044';
  perform rrv7.assert('the retention sweep itself can stamp a due report', v_stamp is not null);
  perform rrv7.assert('and the sweep cleared the report body', v_body is null);

  -- The report that is not yet due keeps its content. A guard that purged
  -- everything would have passed the assertion above too.
  select purged_at into v_untouched
    from public.release_rescue_reports where id = '7cc00000-0000-0000-0000-000000000001';
  perform rrv7.assert('a report that is not due is left alone', v_untouched is null);
end $$;

\echo ''
\echo '=== v7 destructive authority proof complete: every case above printed PASS ==='
