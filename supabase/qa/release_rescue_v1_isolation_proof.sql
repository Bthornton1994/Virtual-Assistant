-- AI App Release Rescue v1: tenant isolation, credential refusal, report
-- integrity, and retention proof.
--
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- It inserts fixture organizations, users, and engagements, and it deliberately
-- attempts actions that must be refused.
--
-- Unlike the marker-only fixtures elsewhere in this directory, this proof runs
-- against the REAL migration chain and asserts live behaviour: each case either
-- performs an action that must succeed or attempts one that must be rejected,
-- and the script aborts if an expected rejection does not occur.
--
-- Usage (disposable local Postgres only, never Supabase):
--   createdb release_rescue_proof
--   psql -d release_rescue_proof -f <supabase shim creating auth/extensions/roles>
--   for f in supabase/migrations/*.sql; do psql -d release_rescue_proof -f "$f"; done
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_v1_isolation_proof.sql
--   dropdb release_rescue_proof
--
-- The database must be fresh: the proof writes immutable rows on purpose and
-- does not tear them down.

\set ON_ERROR_STOP on
\pset pager off
-- PASS/FAIL lines below are raised as notices; keep them visible.
set client_min_messages = notice;

select 'release_rescue_v1_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrtest;

-- Raises if the statement SUCCEEDS. A refusal is the pass condition.
create or replace function rrtest.expect_error(p_label text, p_sql text)
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

create or replace function rrtest.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-00000000aaaa', 'admin.a@example.test'),
  ('11111111-0000-0000-0000-00000000bbbb', 'admin.b@example.test'),
  ('11111111-0000-0000-0000-00000000cccc', 'ops.manager@example.test'),
  ('11111111-0000-0000-0000-00000000dddd', 'operator@example.test');

insert into public.organizations (id, name, slug) values
  ('22222222-0000-0000-0000-00000000aaaa', 'Org A', 'org-a'),
  ('22222222-0000-0000-0000-00000000bbbb', 'Org B', 'org-b');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('22222222-0000-0000-0000-00000000aaaa', '11111111-0000-0000-0000-00000000aaaa', 'client_admin', 'active'),
  ('22222222-0000-0000-0000-00000000bbbb', '11111111-0000-0000-0000-00000000bbbb', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role) values
  ('11111111-0000-0000-0000-00000000cccc', 'Ops Manager', 'ops_manager'),
  ('11111111-0000-0000-0000-00000000dddd', 'Operator', 'operator');

insert into public.workstreams (id, organization_id, name, objective, sla)
values ('33333333-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
        'Release Rescue', 'Review release readiness', '5 business days');

insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class)
values ('44444444-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
        '33333333-0000-0000-0000-00000000aaaa', 'active', 'Release readiness review', 'prepare_only');

insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status)
values ('55555555-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
        '33333333-0000-0000-0000-00000000aaaa', '44444444-0000-0000-0000-00000000aaaa', 'planned');
update public.workstream_runs set status = 'running' where id = '55555555-0000-0000-0000-00000000aaaa';

\echo ''
\echo '=== 1. Intake authorship and tenant isolation ==='

select rrtest.expect_ok('a customer admin opens an engagement for their own organization', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000aaaa';
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, created_by)
  values ('66666666-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', '{"repositoryRef":"acme/app"}'::jsonb,
          repeat('a', 64), 'minimum_7_day', 7, '11111111-0000-0000-0000-00000000aaaa');
$q$);

select rrtest.expect_error('a customer admin cannot open an engagement for another organization', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000bbbb';
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days)
  values ('22222222-0000-0000-0000-00000000aaaa', '{}'::jsonb, repeat('b', 64), 'minimum_7_day', 7);
$q$);

do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000bbbb';
  select count(*) into v_count from public.release_rescue_engagements;
  if v_count <> 0 then
    raise exception 'TENANT LEAK: organization B read % engagement row(s) belonging to A', v_count;
  end if;
  raise notice 'PASS isolated | organization B reads none of organization A''s engagements';
end $$;

select rrtest.expect_error('a second live engagement for the same scope is refused', $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days)
  values ('22222222-0000-0000-0000-00000000aaaa', '{}'::jsonb, repeat('a', 64), 'minimum_7_day', 7);
$q$);

\echo ''
\echo '=== 2. Retention is a stored ceiling, not a promise ==='

select rrtest.expect_error('retention days that contradict the elected policy are refused', $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days)
  values ('22222222-0000-0000-0000-00000000bbbb', '{}'::jsonb, repeat('c', 64), 'purge_on_delivery', 30);
$q$);

select rrtest.expect_error('retention cannot be extended after intake', $q$
  update public.release_rescue_engagements
     set retention_policy = 'standard_30_day', retention_days = 30
   where id = '66666666-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_ok('retention can be shortened', $q$
  update public.release_rescue_engagements
     set retention_policy = 'purge_on_delivery', retention_days = 0
   where id = '66666666-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_error('the frozen scope hash cannot change', $q$
  update public.release_rescue_engagements set scope_hash = repeat('d', 64)
   where id = '66666666-0000-0000-0000-00000000aaaa';
$q$);

do $$
declare v_purge timestamptz;
begin
  select purge_after into v_purge from public.release_rescue_engagements
   where id = '66666666-0000-0000-0000-00000000aaaa';
  if v_purge is null then raise exception 'NO BACKSTOP: engagement has no purge deadline'; end if;
  if v_purge > now() + interval '61 days' then
    raise exception 'BACKSTOP TOO LONG: purge deadline is %', v_purge;
  end if;
  raise notice 'PASS bounded  | an undelivered engagement still expires (purge_after %)', v_purge;
end $$;

\echo ''
\echo '=== 3. Repository access holds no credential ==='

select rrtest.expect_error('metadata with a credential-named key is refused', $q$
  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at, metadata)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa', 'github',
          'acme/app', 'customer_installed_readonly_app', now() + interval '7 days',
          '{"access_token":"placeholder"}'::jsonb);
$q$);

select rrtest.expect_error('metadata holding a credential-shaped value is refused', $q$
  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at, metadata)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa', 'github',
          'acme/app', 'customer_installed_readonly_app', now() + interval '7 days',
          '{"note":"ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'::jsonb);
$q$);

select rrtest.expect_error('a repository reference carrying credentials in a URL is refused', $q$
  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa', 'github',
          'https://user:pw@github.com/acme/app', 'customer_installed_readonly_app', now() + interval '7 days');
$q$);

select rrtest.expect_error('an access window beyond 30 days is refused', $q$
  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa', 'github',
          'acme/app', 'customer_installed_readonly_app', now() + interval '45 days');
$q$);

select rrtest.expect_error('write access is refused', $q$
  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, access_level, expires_at)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa', 'github',
          'acme/app', 'customer_installed_readonly_app', 'write', now() + interval '7 days');
$q$);

select rrtest.expect_error('an operations manager cannot mint access on a customer''s behalf', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000cccc';
  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa', 'github',
          'acme/app', 'customer_installed_readonly_app', now() + interval '7 days');
$q$);

select rrtest.expect_ok('the customer grants time-boxed read-only access', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000aaaa';
  insert into public.release_rescue_repository_grants
    (id, organization_id, engagement_id, provider, repository_ref, grant_method, expires_at, granted_by, metadata)
  values ('77777777-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
          '66666666-0000-0000-0000-00000000aaaa', 'github', 'acme/app',
          'customer_installed_readonly_app', now() + interval '7 days',
          '11111111-0000-0000-0000-00000000aaaa', '{"defaultBranch":"main"}'::jsonb);
$q$);

select rrtest.expect_ok('the customer revokes their own access without asking us', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000aaaa';
  update public.release_rescue_repository_grants
     set revoked_at = now(), revocation_reason = 'customer revoked'
   where id = '77777777-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_error('a revoked grant cannot be reopened', $q$
  update public.release_rescue_repository_grants set revoked_at = null
   where id = '77777777-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_error('a grant window cannot be edited after the fact', $q$
  update public.release_rescue_repository_grants set expires_at = now() + interval '20 days'
   where id = '77777777-0000-0000-0000-00000000aaaa';
$q$);

\echo ''
\echo '=== 4. Report integrity and human accountability ==='

insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('88888888-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
        '55555555-0000-0000-0000-00000000aaaa', 'observation', 'Release Rescue report body',
        repeat('e', 64), '{"schemaVersion":"release-rescue-report/v1","verdict":"conditional_release"}'::jsonb);

-- An artifact belonging to a different run, used to prove the binding check.
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status)
values ('55555555-0000-0000-0000-00000000bbbb', '22222222-0000-0000-0000-00000000aaaa',
        '33333333-0000-0000-0000-00000000aaaa', '44444444-0000-0000-0000-00000000aaaa', 'planned');
update public.workstream_runs set status = 'running' where id = '55555555-0000-0000-0000-00000000bbbb';
insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('88888888-0000-0000-0000-00000000bbbb', '22222222-0000-0000-0000-00000000aaaa',
        '55555555-0000-0000-0000-00000000bbbb', 'observation', 'Other run body',
        repeat('f', 64), '{"schemaVersion":"release-rescue-report/v1"}'::jsonb);

select rrtest.expect_error('a report signed by a plain operator is refused', $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', '88888888-0000-0000-0000-00000000aaaa',
          'release-rescue-report/v1', repeat('1', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'conditional_release', 0, 24, 24, 'release-rescue-auditor',
          '11111111-0000-0000-0000-00000000dddd');
$q$);

select rrtest.expect_error('a report bound to an artifact from another run is refused', $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', '88888888-0000-0000-0000-00000000bbbb',
          'release-rescue-report/v1', repeat('3', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'conditional_release', 0, 24, 24, 'release-rescue-auditor',
          '11111111-0000-0000-0000-00000000cccc');
$q$);

select rrtest.expect_error('a release_blocked verdict with no blocking finding is refused', $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', '88888888-0000-0000-0000-00000000aaaa',
          'release-rescue-report/v1', repeat('4', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'release_blocked', 0, 24, 24, 'release-rescue-auditor',
          '11111111-0000-0000-0000-00000000cccc');
$q$);

select rrtest.expect_error('a clean verdict alongside blocking findings is refused', $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', '88888888-0000-0000-0000-00000000aaaa',
          'release-rescue-report/v1', repeat('5', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'no_blocking_findings_identified', 2, 24, 24, 'release-rescue-auditor',
          '11111111-0000-0000-0000-00000000cccc');
$q$);

select rrtest.expect_error('a plain operator cannot issue a report', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000dddd';
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('22222222-0000-0000-0000-00000000aaaa', '66666666-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', '88888888-0000-0000-0000-00000000aaaa',
          'release-rescue-report/v1', repeat('6', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'conditional_release', 0, 24, 24, 'release-rescue-auditor',
          '11111111-0000-0000-0000-00000000cccc');
$q$);

select rrtest.expect_ok('an operations manager issues the report', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000cccc';
  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count, medium_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('99999999-0000-0000-0000-00000000aaaa', '22222222-0000-0000-0000-00000000aaaa',
          '66666666-0000-0000-0000-00000000aaaa', '55555555-0000-0000-0000-00000000aaaa',
          '88888888-0000-0000-0000-00000000aaaa', 'release-rescue-report/v1', repeat('7', 64),
          'release-rescue-rubric/v1', repeat('2', 64), repeat('a', 64), 'conditional_release', 0, 3,
          24, 24, 'release-rescue-auditor', '11111111-0000-0000-0000-00000000cccc');
$q$);

select rrtest.expect_error('a report verdict cannot be edited after issue', $q$
  update public.release_rescue_reports set verdict = 'no_blocking_findings_identified'
   where id = '99999999-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_error('report findings counts cannot be edited after issue', $q$
  update public.release_rescue_reports set medium_count = 0
   where id = '99999999-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_error('a report cannot be deleted', $q$
  delete from public.release_rescue_reports where id = '99999999-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_ok('delivery may be stamped once', $q$
  update public.release_rescue_reports set delivered_at = now()
   where id = '99999999-0000-0000-0000-00000000aaaa';
$q$);

select rrtest.expect_error('a delivered report is immutable', $q$
  update public.release_rescue_reports set delivered_at = now() + interval '1 day'
   where id = '99999999-0000-0000-0000-00000000aaaa';
$q$);

do $$
declare v_count integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-0000-0000-0000-00000000bbbb';
  select count(*) into v_count from public.release_rescue_reports;
  if v_count <> 0 then raise exception 'TENANT LEAK: organization B read % report row(s)', v_count; end if;
  raise notice 'PASS isolated | organization B reads none of organization A''s reports';
end $$;

\echo ''
\echo '=== 5. Evidence immutability and the retention purge ==='

select rrtest.expect_error('evidence cannot be deleted outside a retention purge', $q$
  delete from public.evidence_artifacts where id = '88888888-0000-0000-0000-00000000aaaa';
$q$);

-- An unrelated workstream's evidence, to prove the purge carve-out is scoped to
-- Release Rescue artifacts and cannot be turned into a general delete primitive.
insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('88888888-0000-0000-0000-00000000cccc', '22222222-0000-0000-0000-00000000aaaa',
        '55555555-0000-0000-0000-00000000aaaa', 'observation', 'Unrelated workstream evidence',
        repeat('9', 64), '{"schemaVersion":"catalog-evidence-packet/v1"}'::jsonb);

select rrtest.expect_error('a caller who forges the purge flag still cannot touch other evidence', $q$
  set local delegation.retention_purge = 'on';
  delete from public.evidence_artifacts where id = '88888888-0000-0000-0000-00000000cccc';
$q$);

-- Bring the retention deadline forward so the sweep has something to do.
update public.release_rescue_engagements
   set delivered_at = now() - interval '1 day'
 where id = '66666666-0000-0000-0000-00000000aaaa';

do $$
declare
  v_purged integer;
  v_artifacts integer;
  v_report record;
  v_engagement record;
  v_grant_open integer;
begin
  select public.purge_expired_release_rescue_data() into v_purged;
  if v_purged <> 1 then raise exception 'PURGE DID NOT RUN: swept % engagement(s)', v_purged; end if;

  select count(*) into v_artifacts from public.evidence_artifacts
   where run_id = '55555555-0000-0000-0000-00000000aaaa'
     and coalesce(payload->>'schemaVersion','') like 'release-rescue-%';
  if v_artifacts <> 0 then raise exception 'PURGE LEFT % source-derived artifact(s)', v_artifacts; end if;
  raise notice 'PASS purged   | report body evidence removed at the retention deadline';

  select report_artifact_id, purged_at, verdict, report_hash into v_report
    from public.release_rescue_reports where id = '99999999-0000-0000-0000-00000000aaaa';
  if v_report.report_artifact_id is not null then raise exception 'PURGE LEFT a body pointer'; end if;
  if v_report.purged_at is null then raise exception 'PURGE DID NOT STAMP purged_at'; end if;
  if v_report.verdict is null or v_report.report_hash is null then
    raise exception 'PURGE DESTROYED the accounting record';
  end if;
  raise notice 'PASS retained | accounting row survives with verdict and hash, content gone';

  select scope, status, purged_at into v_engagement
    from public.release_rescue_engagements where id = '66666666-0000-0000-0000-00000000aaaa';
  if v_engagement.scope ? 'repositoryRef' then raise exception 'PURGE LEFT customer scope content'; end if;
  if v_engagement.status <> 'purged' then raise exception 'PURGE DID NOT mark the engagement purged'; end if;
  raise notice 'PASS cleared  | engagement scope content cleared, status purged';

  select count(*) into v_grant_open from public.release_rescue_repository_grants
   where engagement_id = '66666666-0000-0000-0000-00000000aaaa' and revoked_at is null;
  if v_grant_open <> 0 then raise exception 'PURGE LEFT % live access grant(s)', v_grant_open; end if;
  raise notice 'PASS revoked  | no access grant survives the purge';

  -- The sweep must not reach past its own workstream.
  if not exists (select 1 from public.evidence_artifacts
                  where id = '88888888-0000-0000-0000-00000000cccc') then
    raise exception 'PURGE OVERREACHED: it deleted another workstream''s evidence';
  end if;
  raise notice 'PASS scoped   | another workstream''s evidence is untouched by the sweep';

  -- Idempotence: a second sweep must be a no-op, so the job is safe to schedule.
  select public.purge_expired_release_rescue_data() into v_purged;
  if v_purged <> 0 then raise exception 'PURGE NOT IDEMPOTENT: second sweep touched % row(s)', v_purged; end if;
  raise notice 'PASS idempotent | a second sweep changes nothing';
end $$;

do $$
declare v_setting text;
begin
  select current_setting('delegation.retention_purge', true) into v_setting;
  if coalesce(v_setting, 'off') = 'on' then
    raise exception 'PURGE FLAG LEAKED: delegation.retention_purge is still on';
  end if;
  raise notice 'PASS scoped   | the purge flag does not outlive the sweep';
end $$;

select rrtest.expect_error('evidence is immutable again after the sweep', $q$
  insert into public.evidence_artifacts
    (id, organization_id, run_id, kind, summary, content_hash, payload)
  values ('88888888-0000-0000-0000-0000000000ff', '22222222-0000-0000-0000-00000000aaaa',
          '55555555-0000-0000-0000-00000000aaaa', 'observation', 'post-purge', repeat('0', 64),
          '{"schemaVersion":"release-rescue-report/v1"}'::jsonb);
  delete from public.evidence_artifacts where id = '88888888-0000-0000-0000-0000000000ff';
$q$);

\echo ''
\echo 'release_rescue_v1 proof complete: every case above reported PASS.'
