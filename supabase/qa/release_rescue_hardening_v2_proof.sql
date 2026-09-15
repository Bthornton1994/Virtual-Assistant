-- AI App Release Rescue hardening v2 proof.
--
-- Every case here reproduces an attack an independent audit executed successfully
-- against the previous schema, and asserts it is now refused. The attacker is a
-- customer `client_admin` acting through the `authenticated` role over their own
-- engagement, which is exactly the access a paying customer has.
--
-- NEVER apply this file to a real Supabase project.
--
-- Usage (disposable local Postgres with the full migration chain applied):
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_hardening_v2_proof.sql

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_hardening_v2_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv2;

/**
 * Refusal helper that checks WHAT was refused.
 *
 * The earlier helpers accepted any error, so a typo or a missing column read as
 * a security refusal. This one requires the guard's own message.
 */
create or replace function rrv2.expect_refusal(p_label text, p_expect text, p_sql text)
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

create or replace function rrv2.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id, email) values
  ('dddd0000-0000-0000-0000-000000000001', 'attacker.admin@example.test'),
  ('dddd0000-0000-0000-0000-000000000002', 'ops.manager@example.test');

insert into public.organizations (id, name, slug)
values ('eeee0000-0000-0000-0000-000000000001', 'Attacker Org', 'attacker-org');

insert into public.organization_members (organization_id, user_id, role, status)
values ('eeee0000-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000001', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role)
values ('dddd0000-0000-0000-0000-000000000002', 'Ops Manager', 'ops_manager');

-- An archive engagement over a repository the customer does not own.
insert into public.release_rescue_engagements
  (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
values ('ffff0000-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
        '{"repository":{"repositoryRef":"victim/private-repo","accessMode":"customer_uploaded_archive"},"aiAssistedReviewAccepted":false}'::jsonb,
        repeat('a', 64), 'minimum_7_day', 7, 'customer_uploaded_archive');

insert into public.release_rescue_repository_grants
  (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at)
values ('eeee0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000001',
        'uploaded_archive', 'victim/private-repo', 'customer_uploaded_archive', now() + interval '7 days');

-- The snapshot and its commit, so the report cases below exercise report
-- invariants rather than the v4 precondition that a report names a pinned commit.
update public.release_rescue_engagements
   set snapshot_limits_version = 'release-rescue-snapshot-limits/v1'
 where id = 'ffff0000-0000-0000-0000-000000000001';
update public.release_rescue_engagements
   set reviewed_commit_sha = repeat('7', 40)
 where id = 'ffff0000-0000-0000-0000-000000000001';

\echo ''
\echo '=== B1. Relabelling the access mode no longer opens the ownership gate ==='

select rrv2.expect_refusal(
  'a customer cannot relabel an archive engagement as an app install',
  'access mode is fixed at intake',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddd0000-0000-0000-0000-000000000001';
  update public.release_rescue_engagements
     set access_mode = 'customer_installed_readonly_app'
   where id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

select rrv2.expect_refusal(
  'nor relabel and start the review in one statement',
  'access mode is fixed at intake',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddd0000-0000-0000-0000-000000000001';
  update public.release_rescue_engagements
     set access_mode = 'customer_installed_readonly_app', status = 'auditing'
   where id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

select rrv2.expect_refusal(
  'the archive engagement still cannot start a review on its own',
  -- v3 generalised the message with the gate: it no longer names archives,
  -- because it no longer branches on the customer-declared mode.
  'ownership',
  $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== B2. A self-declared access mode is not evidence ==='

select rrv2.expect_refusal(
  'a direct insert at auditing with no grant row is refused',
  'the frozen scope must name the repository',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddd0000-0000-0000-0000-000000000001';
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, status)
  values ('ffff0000-0000-0000-0000-000000000002', 'eeee0000-0000-0000-0000-000000000001',
          '{}'::jsonb, repeat('b', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app', 'auditing');
$q$);

select rrv2.expect_refusal(
  'an access mode contradicting the frozen scope is refused',
  'contradicts the frozen scope',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('eeee0000-0000-0000-0000-000000000001',
          '{"repository":{"accessMode":"customer_uploaded_archive"}}'::jsonb,
          repeat('c', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');
$q$);

\echo ''
\echo '=== B3. The frozen scope is frozen ==='

select rrv2.expect_refusal(
  'a customer cannot rewrite the reviewed repository after intake',
  'scope is frozen at intake',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddd0000-0000-0000-0000-000000000001';
  update public.release_rescue_engagements
     set scope = '{"repository":{"repositoryRef":"totally/different-repo"}}'::jsonb
   where id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

select rrv2.expect_refusal(
  'nor flip a human-only engagement to AI-assisted',
  'scope is frozen at intake',
  $q$
  update public.release_rescue_engagements
     set scope = jsonb_set(scope, '{aiAssistedReviewAccepted}', 'true'::jsonb)
   where id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== B7. A report row cannot contradict itself or its body ==='

insert into public.workstreams (id, organization_id, name, objective, sla)
values ('8888aaaa-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
        'Release Rescue', 'Review release readiness', '5 business days');

insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class)
values ('9999aaaa-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
        '8888aaaa-0000-0000-0000-000000000001', 'active', 'Release readiness review', 'prepare_only');

insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status)
values ('aaaa1111-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
        '8888aaaa-0000-0000-0000-000000000001', '9999aaaa-0000-0000-0000-000000000001', 'planned');
update public.workstream_runs set status = 'running' where id = 'aaaa1111-0000-0000-0000-000000000001';

insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('bbbb1111-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
        'aaaa1111-0000-0000-0000-000000000001', 'observation', 'body', repeat('e', 64),
        '{"schemaVersion":"release-rescue-report/v1","verdict":"release_blocked","blockingFindingCount":2,"coverage":{"totalChecks":32,"assessedChecks":32}}'::jsonb);

-- A body that states only its schema version. The body-contradiction checks stay
-- silent for it, so the row's SELF-consistency rules are what these cases test.
insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('bbbb1111-0000-0000-0000-000000000002', 'eeee0000-0000-0000-0000-000000000001',
        'aaaa1111-0000-0000-0000-000000000001', 'observation', 'bare body', repeat('f', 64),
        '{"schemaVersion":"release-rescue-report/v1"}'::jsonb);

select rrv2.expect_refusal(
  'a tracked-findings verdict cannot carry blocking findings',
  'cannot coexist with',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count, critical_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('eeee0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000001',
          'aaaa1111-0000-0000-0000-000000000001', 'bbbb1111-0000-0000-0000-000000000002',
          'release-rescue-report/v1', repeat('1', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'release_with_tracked_findings', 9, 9, 32, 32, 'auditor',
          'dddd0000-0000-0000-0000-000000000002');
$q$);

select rrv2.expect_refusal(
  'a conditional verdict cannot carry blocking findings either',
  'cannot coexist with',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('eeee0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000001',
          'aaaa1111-0000-0000-0000-000000000001', 'bbbb1111-0000-0000-0000-000000000002',
          'release-rescue-report/v1', repeat('3', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'conditional_release', 12, 32, 32, 'auditor',
          'dddd0000-0000-0000-0000-000000000002');
$q$);

select rrv2.expect_refusal(
  'coverage cannot claim one-of-one against the coverage its body states',
  'contradicts its body',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('eeee0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000001',
          'aaaa1111-0000-0000-0000-000000000001', 'bbbb1111-0000-0000-0000-000000000001',
          'release-rescue-report/v1', repeat('4', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'release_blocked', 2, 1, 1, 'auditor',
          'dddd0000-0000-0000-0000-000000000002');
$q$);

select rrv2.expect_refusal(
  'a row whose verdict contradicts its own body is refused',
  'contradicts its body',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('eeee0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000001',
          'aaaa1111-0000-0000-0000-000000000001', 'bbbb1111-0000-0000-0000-000000000001',
          'release-rescue-report/v1', repeat('5', 64), 'release-rescue-rubric/v1', repeat('2', 64),
          repeat('a', 64), 'no_blocking_findings_identified', 0, 32, 32, 'auditor',
          'dddd0000-0000-0000-0000-000000000002');
$q$);

select rrv2.expect_ok('a consistent report row is accepted', $q$
  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count, critical_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('cccc1111-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
          'ffff0000-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001',
          'bbbb1111-0000-0000-0000-000000000001', 'release-rescue-report/v1', repeat('6', 64),
          'release-rescue-rubric/v1', repeat('2', 64), repeat('a', 64), 'release_blocked', 2, 2,
          32, 32, 'auditor', 'dddd0000-0000-0000-0000-000000000002');
$q$);

\echo ''
\echo '=== B7b. Forging the purge flag no longer unbinds a report ==='

select rrv2.expect_refusal(
  'a caller who sets the purge flag themselves cannot clear a report body',
  'only permitted report update',
  $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'dddd0000-0000-0000-0000-000000000002';
  set local delegation.retention_purge = 'on';
  update public.release_rescue_reports
     set report_artifact_id = null, purged_at = now()
   where id = 'cccc1111-0000-0000-0000-000000000001';
$q$);

do $$
declare v_artifact uuid;
begin
  select report_artifact_id into v_artifact from public.release_rescue_reports
   where id = 'cccc1111-0000-0000-0000-000000000001';
  if v_artifact is null then raise exception 'REPORT BODY WAS UNBOUND'; end if;
  raise notice 'PASS intact   | the report is still bound to its body';
end $$;

\echo ''
\echo '=== Grant records keep their revocation reason ==='

select rrv2.expect_ok('a grant can be revoked with a reason', $q$
  update public.release_rescue_repository_grants
     set revoked_at = now(), revocation_reason = 'customer revoked'
   where engagement_id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

select rrv2.expect_refusal(
  'the recorded reason cannot be rewritten afterwards',
  'cannot be rewritten',
  $q$
  update public.release_rescue_repository_grants
     set revocation_reason = 'expired normally'
   where engagement_id = 'ffff0000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== The retention sweep still works through its own privilege ==='

do $$
declare v_purged integer;
begin
  -- Hardening v5 made `purge_after` server-derived, so a proof can no longer
  -- force a sweep by writing that column. It becomes due the way a real
  -- engagement does: it is delivered under a zero-day retention election.
  update public.release_rescue_engagements
     set delivered_at = now(), retention_policy = 'purge_on_delivery', retention_days = 0
   where id = 'ffff0000-0000-0000-0000-000000000001';

  select public.purge_expired_release_rescue_data('pg_cron') into v_purged;
  if v_purged <> 1 then raise exception 'SWEEP DID NOT RUN: purged %', v_purged; end if;

  if exists (select 1 from public.release_rescue_engagements
              where id = 'ffff0000-0000-0000-0000-000000000001' and scope ? 'repository') then
    raise exception 'PURGE LEFT customer scope content';
  end if;
  if exists (select 1 from public.release_rescue_reports
              where id = 'cccc1111-0000-0000-0000-000000000001' and report_artifact_id is not null) then
    raise exception 'PURGE DID NOT clear the report body reference';
  end if;
  raise notice 'PASS swept    | the privileged sweep still clears scope and report body';
end $$;

\echo ''
\echo 'release_rescue_hardening_v2 proof complete: every case above reported PASS.'
