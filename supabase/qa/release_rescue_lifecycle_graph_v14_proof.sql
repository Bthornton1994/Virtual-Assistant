-- AI App Release Rescue v14: the lifecycle graph, run exclusivity, and the
-- reviewer-is-caller binding, executed.
--
-- Three findings and one outstanding item that the ledger recorded as confirmed
-- by execution and awaiting an owner decision (S-009, S-010, and the reviewer
-- binding; S-011 is application-only and has its own vitest suite). The owner
-- decided them on 2026-09-18. This proof reproduces each original finding
-- against the chain WITH v14 applied and asserts it is now refused, and then
-- exercises what the decision admits.
--
-- The lifecycle case is a MATRIX, not a list of examples. S-009's three examples
-- were three cells of a 8x7 table; every cell is tried here, from a fresh
-- engagement driven to the FROM state through the real lifecycle, and the set of
-- cells that succeed is compared to the graph the owner decided. A list of
-- examples would have been the reviewer's list again.
--
-- NEVER apply this file to a real Supabase project.
--
-- Usage (disposable local Postgres with the full migration chain applied):
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_lifecycle_graph_v14_proof.sql

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_lifecycle_graph_v14_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv14;
grant usage on schema rrv14 to public;

create or replace function rrv14.expect_refusal(p_label text, p_expect text, p_sql text)
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

create or replace function rrv14.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

create or replace function rrv14.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

-- Identities ------------------------------------------------------------------

insert into auth.users (id, email) values
  ('14a00000-0000-0000-0000-000000000001', 'v14.customer.admin@example.test'),
  ('14a00000-0000-0000-0000-000000000002', 'v14.ops.manager@example.test'),
  ('14a00000-0000-0000-0000-000000000003', 'v14.second.manager@example.test'),
  ('14a00000-0000-0000-0000-000000000004', 'v14.plain.operator@example.test'),
  ('14a00000-0000-0000-0000-000000000005', 'v14.other.customer@example.test');

insert into public.organizations (id, name, slug) values
  ('14b00000-0000-0000-0000-000000000001', 'Graph Co', 'graph-co-v14'),
  ('14b00000-0000-0000-0000-000000000002', 'Other Co', 'other-co-v14');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('14b00000-0000-0000-0000-000000000001', '14a00000-0000-0000-0000-000000000001', 'client_admin', 'active'),
  ('14b00000-0000-0000-0000-000000000002', '14a00000-0000-0000-0000-000000000005', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role) values
  ('14a00000-0000-0000-0000-000000000002', 'Ops Manager', 'ops_manager'),
  ('14a00000-0000-0000-0000-000000000003', 'Second Manager', 'ops_manager'),
  ('14a00000-0000-0000-0000-000000000004', 'Plain Operator', 'operator');

insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('14c00000-0000-0000-0000-000000000001', '14b00000-0000-0000-0000-000000000001', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('14d00000-0000-0000-0000-000000000001', '14b00000-0000-0000-0000-000000000001',
   '14c00000-0000-0000-0000-000000000001', 'active', 'O', 'prepare_only');

-- A fresh running run per call, so every engagement the matrix builds has a run
-- of its own (S-010 makes that a requirement, not a convenience).
create sequence if not exists rrv14.run_seq;
create or replace function rrv14.new_run()
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status)
  values (v_id, '14b00000-0000-0000-0000-000000000001',
          '14c00000-0000-0000-0000-000000000001', '14d00000-0000-0000-0000-000000000001', 'planned');
  update public.workstream_runs set status = 'running' where id = v_id;
  return v_id;
end $$;

-- A report body the guards accept, addressed to one engagement and run.
create or replace function rrv14.report_body(p_engagement uuid, p_run uuid, p_reviewer uuid, p_display text default 'Ops Manager')
returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'reportId', gen_random_uuid()::text,
    'engagementId', p_engagement::text,
    'runId', p_run::text,
    'organizationId', '14b00000-0000-0000-0000-000000000001',
    'verdict', 'conditional_release',
    'blockingFindingCount', 0,
    'coverage', jsonb_build_object('totalChecks', 32, 'assessedChecks', 32),
    'reviewedCommitSha', repeat('9', 40),
    'reviewedBy', jsonb_build_object(
      'operatorUserId', p_reviewer::text,
      'displayName', p_display,
      'reviewedAt', '2026-09-18T10:00:00.000Z',
      'reasonCode', 'reviewed_findings_and_verdict_match_the_recorded_observations',
      'approvedContentHash', repeat('c', 64)),
    'limitationCodes', jsonb_build_array('read_only_no_running_system'),
    'assessments', jsonb_build_array(),
    'findings', jsonb_build_array())
$$;

-- Issue a signed report for an engagement, as the server naming the ops manager.
create or replace function rrv14.issue_report(p_engagement uuid, p_run uuid, p_scope_hash text)
returns uuid language plpgsql as $$
declare
  v_artifact uuid := gen_random_uuid();
  v_report uuid := gen_random_uuid();
begin
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values (v_artifact, '14b00000-0000-0000-0000-000000000001', p_run, 'observation', 'report body',
          encode(extensions.digest(v_artifact::text, 'sha256'), 'hex'),
          rrv14.report_body(p_engagement, p_run, '14a00000-0000-0000-0000-000000000002'));

  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values (v_report, '14b00000-0000-0000-0000-000000000001', p_engagement, p_run, v_artifact,
          'release-rescue-report/v1', encode(extensions.digest(v_report::text, 'sha256'), 'hex'),
          'release-rescue-rubric/v1', repeat('4', 64), p_scope_hash, 'conditional_release', 0,
          32, 32, 'auditor',
          '14a00000-0000-0000-0000-000000000002', '2026-09-18T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
  return v_report;
end $$;

-- Build a fresh, fully prepared engagement and drive it to p_status through the
-- real lifecycle: grant, ownership, snapshot, pinned commit, report. Every state
-- the matrix starts from is a state the product can actually reach.
create or replace function rrv14.engagement_at(p_status text)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_run uuid := rrv14.new_run();
  v_scope_hash text := encode(extensions.digest(v_id::text, 'sha256'), 'hex');
  v_order text[] := array['intake', 'scoped', 'access_granted', 'auditing', 'report_ready', 'delivered'];
  v_target integer := array_position(v_order, p_status);
  v_step text;
begin
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode,
     created_by)
  values (v_id, '14b00000-0000-0000-0000-000000000001', v_run,
          '{"repository":{"repositoryRef":"graph/app","accessMode":"customer_installed_readonly_app","provider":"github"},"aiAssistedReviewAccepted":false}'::jsonb,
          v_scope_hash, 'minimum_7_day', 7, 'customer_installed_readonly_app',
          '14a00000-0000-0000-0000-000000000001');

  insert into public.release_rescue_repository_grants
    (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at, granted_by)
  values ('14b00000-0000-0000-0000-000000000001', v_id, 'github', 'graph/app',
          'customer_installed_readonly_app', now() + interval '7 days',
          '14a00000-0000-0000-0000-000000000001');

  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = '14a00000-0000-0000-0000-000000000002',
         ownership_confirmation_note = 'Repository owner matches the contracting organisation.',
         snapshot_limits_version = 'release-rescue-snapshot-limits/v1',
         snapshot_file_count = 10,
         snapshot_total_bytes = 1000
   where id = v_id;
  update public.release_rescue_engagements set reviewed_commit_sha = repeat('9', 40) where id = v_id;

  if p_status in ('cancelled', 'purged') then
    -- Reached from intake, which is one of the states either may be entered from.
    update public.release_rescue_engagements set status = 'cancelled' where id = v_id;
    if p_status = 'purged' then
      -- Made due the way every proof since v5 does it: `created_at` is
      -- server-written and immutable (v6), so the 60-day backstop cannot be
      -- simulated; a zero-day election at a delivery stamp can.
      update public.release_rescue_engagements
         set delivered_at = now(), retention_policy = 'purge_on_delivery', retention_days = 0
       where id = v_id;
      perform public.purge_expired_release_rescue_data('manual');
    end if;
    return v_id;
  end if;

  if v_target is null then
    raise exception 'rrv14.engagement_at: unknown status %', p_status;
  end if;

  for i in 2 .. v_target loop
    v_step := v_order[i];
    if v_step = 'report_ready' then
      perform rrv14.issue_report(v_id, v_run, v_scope_hash);
    end if;
    if v_step = 'delivered' then
      update public.release_rescue_reports set delivered_at = now() where engagement_id = v_id;
      update public.release_rescue_engagements set status = 'delivered', delivered_at = now() where id = v_id;
    else
      update public.release_rescue_engagements set status = v_step where id = v_id;
    end if;
  end loop;

  -- An auditing engagement may already have its report issued; the matrix cell
  -- auditing -> report_ready needs one to exist, and the product allows it.
  if p_status = 'auditing' then
    perform rrv14.issue_report(v_id, v_run, v_scope_hash);
  end if;
  -- A report_ready engagement's report may already be delivered; the cell
  -- report_ready -> delivered needs it to be.
  if p_status = 'report_ready' then
    update public.release_rescue_reports set delivered_at = now() where engagement_id = v_id;
  end if;

  return v_id;
end $$;

\echo ''
\echo '=== S-009 (1). Every engagement enters at intake ==='

select rrv14.expect_refusal(
  'an engagement cannot be created already auditing',
  'enters the lifecycle at intake',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, status)
  values ('14b00000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"graph/app"}}'::jsonb, repeat('1', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app', 'auditing');
$q$);

select rrv14.expect_refusal(
  'nor already delivered',
  'enters the lifecycle at intake',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode, status)
  values ('14b00000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"graph/app"}}'::jsonb, repeat('2', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app', 'delivered');
$q$);

select rrv14.expect_refusal(
  'nor carrying a recovery record it never earned',
  'cannot be created carrying a recovery record',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode,
     recovery_reason_code, recovery_authorized_by)
  values ('14b00000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"graph/app"}}'::jsonb, repeat('3', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app',
          'cancelled_in_error_by_operator', '14a00000-0000-0000-0000-000000000002');
$q$);

\echo ''
\echo '=== S-009 (2). The matrix: 8 states x 7 targets, each from a real engagement ==='
--
-- Run as the superuser, which is the SERVER channel, with no recovery record
-- supplied and no sweep running. Under those conditions exactly the ten
-- normal-path edges succeed. Recovery and purge are exercised separately below
-- with the authority each requires.

do $$
declare
  v_states text[] := array['intake', 'scoped', 'access_granted', 'auditing', 'report_ready', 'delivered', 'cancelled', 'purged'];
  v_expected text[] := array[
    'intake>scoped', 'intake>cancelled',
    'scoped>access_granted', 'scoped>cancelled',
    'access_granted>auditing', 'access_granted>cancelled',
    'auditing>report_ready', 'auditing>cancelled',
    'report_ready>delivered', 'report_ready>cancelled'
  ];
  v_from text;
  v_to text;
  v_id uuid;
  v_accepted text[] := '{}';
  v_refused text[] := '{}';
  v_tried integer := 0;
  v_cell text;
  v_status_after text;
  v_message text;
begin
  foreach v_from in array v_states loop
    foreach v_to in array v_states loop
      if v_from = v_to then continue; end if;
      v_cell := v_from || '>' || v_to;
      v_tried := v_tried + 1;
      v_id := rrv14.engagement_at(v_from);

      begin
        update public.release_rescue_engagements
           set status = v_to,
               delivered_at = case when v_to = 'delivered' then now() else delivered_at end
         where id = v_id;
        v_accepted := array_append(v_accepted, v_cell);
      exception when others then
        v_message := sqlerrm;
        v_refused := array_append(v_refused, v_cell);
        -- Every refusal of a cell OFF the graph must be the graph's own refusal,
        -- not a precondition tripping first. Cells ON the graph are never here.
        if not (v_cell = any (v_expected))
           and v_message !~* '(not a permitted transition|does not reopen|only be reopened at intake|recovery reason code|no further lifecycle|retention sweep, not by a caller)' then
          raise exception 'WRONG-REFUSAL for cell %: %', v_cell, v_message;
        end if;
      end;

      -- And the row is where the outcome says it is.
      select status into v_status_after from public.release_rescue_engagements where id = v_id;
      if v_cell = any (v_accepted) and v_status_after <> v_to then
        raise exception 'cell % reported accepted but the row reads %', v_cell, v_status_after;
      end if;
      if v_cell = any (v_refused) and v_status_after <> v_from then
        raise exception 'cell % reported refused but the row moved to %', v_cell, v_status_after;
      end if;
    end loop;
  end loop;

  perform rrv14.assert(format('all %s off-diagonal cells were tried', v_tried), v_tried = 56);
  perform rrv14.assert(
    format('exactly the ten normal-path edges are accepted: %s', array_to_string(v_accepted, ' ')),
    (select array_agg(x order by x) from unnest(v_accepted) x)
      = (select array_agg(x order by x) from unnest(v_expected) x));
  perform rrv14.assert(format('and the other %s are refused', cardinality(v_refused)), cardinality(v_refused) = 46);

  -- The three S-009 reproductions, named, so the ledger row can cite them.
  perform rrv14.assert('S-009 reproduction: intake -> access_granted is refused', 'intake>access_granted' = any (v_refused));
  perform rrv14.assert('S-009 reproduction: access_granted -> intake is refused', 'access_granted>intake' = any (v_refused));
  perform rrv14.assert('S-009 reproduction: cancelled -> scoped is refused', 'cancelled>scoped' = any (v_refused));
  perform rrv14.assert('delivered has no exit on the normal path',
    not exists (select 1 from unnest(v_accepted) x where x like 'delivered>%'));
  perform rrv14.assert('purged has no exit at all',
    not exists (select 1 from unnest(v_accepted) x where x like 'purged>%'));
  perform rrv14.assert('nothing reaches purged outside the sweep',
    not exists (select 1 from unnest(v_accepted) x where x like '%>purged'));
end $$;

\echo ''
\echo '=== S-009 (3). Reopening a cancelled engagement is a manager-authorized recovery ==='

do $$
declare v_id uuid := rrv14.engagement_at('cancelled');
begin
  perform set_config('rrv14.cancelled', v_id::text, false);
end $$;

select rrv14.expect_refusal(
  'the customer admin cannot reopen their own cancelled engagement',
  'acting as themselves',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000001';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'customer_asked_to_resume_before_purge',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000001'
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor by naming an ops manager as the authorizer',
  'acting as themselves',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000001';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'customer_asked_to_resume_before_purge',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000002'
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'an ops manager cannot attribute the recovery to a different manager',
  'cannot be attributed to another person',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'cancelled_in_error_by_operator',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000003'
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor reopen it without a reason code',
  'recovery reason code',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000002'
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor with a sentence where the code goes',
  'recovery reason code',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'The customer called and asked us to continue.',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000002'
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor reopen it anywhere but intake',
  'only be reopened at intake',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  update public.release_rescue_engagements
     set status = 'access_granted',
         recovery_reason_code = 'cancelled_in_error_by_operator',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000002'
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_ok('an ops manager reopens it, as themselves, for a stated reason', format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'cancelled_in_error_by_operator',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000002',
         -- Whatever the caller supplies for the server-written fields is discarded.
         recovery_authorized_at = '2000-01-01T00:00:00Z',
         recovery_count = 99
   where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

do $$
declare v record; v_log record;
begin
  select * into v from public.release_rescue_engagements where id = current_setting('rrv14.cancelled')::uuid;
  perform rrv14.assert('the engagement is back at intake', v.status = 'intake');
  perform rrv14.assert('the recovery names the caller', v.recovery_authorized_by = '14a00000-0000-0000-0000-000000000002');
  perform rrv14.assert('through the interactive channel', v.recovery_authorized_via = 'authenticated_operator');
  perform rrv14.assert('with the stated reason', v.recovery_reason_code = 'cancelled_in_error_by_operator');
  perform rrv14.assert('the recovery time is server-written', v.recovery_authorized_at > now() - interval '1 minute');
  perform rrv14.assert('the recovery count is server-written', v.recovery_count = 1);

  select * into v_log from public.release_rescue_engagement_transitions
   where engagement_id = v.id and from_status = 'cancelled' and to_status = 'intake';
  perform rrv14.assert('the recovery is logged', v_log.id is not null);
  perform rrv14.assert('with its reason', v_log.recovery_reason_code = 'cancelled_in_error_by_operator');
  perform rrv14.assert('its channel', v_log.via = 'authenticated_operator');
  perform rrv14.assert('and its actor', v_log.actor_user_id = '14a00000-0000-0000-0000-000000000002');
end $$;

select rrv14.expect_refusal(
  'a recovered engagement restarts: it cannot jump to auditing',
  'not a permitted transition',
  format($q$
  update public.release_rescue_engagements set status = 'auditing' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'the recovery record cannot be edited outside a recovery',
  'by nothing else',
  format($q$
  update public.release_rescue_engagements
     set recovery_reason_code = 'customer_asked_to_resume_before_purge' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor carried along on a forward move',
  'by nothing else',
  format($q$
  update public.release_rescue_engagements
     set status = 'scoped', recovery_authorized_by = '14a00000-0000-0000-0000-000000000003' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_ok('it walks forward again through the same gates', format($q$
  update public.release_rescue_engagements set status = 'scoped' where id = '%s';
  update public.release_rescue_engagements set status = 'access_granted' where id = '%s';
  $q$, current_setting('rrv14.cancelled'), current_setting('rrv14.cancelled')));

select rrv14.expect_ok('and may be cancelled again, which spends the recovery', format($q$
  update public.release_rescue_engagements set status = 'cancelled' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

do $$
declare v record;
begin
  select * into v from public.release_rescue_engagements where id = current_setting('rrv14.cancelled')::uuid;
  perform rrv14.assert('cancellation clears the recovery record on the row',
    v.recovery_reason_code is null and v.recovery_authorized_by is null
    and v.recovery_authorized_at is null and v.recovery_authorized_via is null);
  perform rrv14.assert('but keeps the count', v.recovery_count = 1);
  perform rrv14.assert('and the log still holds the first recovery',
    exists (select 1 from public.release_rescue_engagement_transitions
             where engagement_id = v.id and to_status = 'intake'
               and recovery_reason_code = 'cancelled_in_error_by_operator'));
end $$;

select rrv14.expect_refusal(
  'a second recovery cannot ride on the spent record: the reason must be supplied again',
  'recovery reason code',
  format($q$
  update public.release_rescue_engagements
     set status = 'intake', recovery_authorized_by = '14a00000-0000-0000-0000-000000000002' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'the server channel cannot name a plain operator as the authorizer',
  'ops manager or platform admin',
  format($q$
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'customer_asked_to_resume_before_purge',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000004' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor nobody',
  'must name the manager',
  format($q$
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'customer_asked_to_resume_before_purge' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_ok('the server channel reopens it naming a real manager', format($q$
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'customer_asked_to_resume_before_purge',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000003' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

do $$
declare v record;
begin
  select * into v from public.release_rescue_engagements where id = current_setting('rrv14.cancelled')::uuid;
  perform rrv14.assert('the second recovery is recorded through the server channel', v.recovery_authorized_via = 'service_role');
  perform rrv14.assert('and counted', v.recovery_count = 2);
  perform rrv14.assert('the log holds both recoveries',
    (select count(*) from public.release_rescue_engagement_transitions
      where engagement_id = v.id and from_status = 'cancelled' and to_status = 'intake') = 2);
end $$;

\echo ''
\echo '=== S-009 (4). Delivered does not reopen, whoever asks ==='

do $$
declare v_id uuid := rrv14.engagement_at('delivered');
begin
  perform set_config('rrv14.delivered', v_id::text, false);
end $$;

select rrv14.expect_refusal(
  'a manager cannot reopen a delivered engagement, even with a recovery record',
  'does not reopen',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  update public.release_rescue_engagements
     set status = 'intake',
         recovery_reason_code = 'cancelled_in_error_by_operator',
         recovery_authorized_by = '14a00000-0000-0000-0000-000000000002'
   where id = '%s';
  $q$, current_setting('rrv14.delivered')));

select rrv14.expect_refusal(
  'nor cancel it after delivery',
  'does not reopen',
  format($q$
  update public.release_rescue_engagements set status = 'cancelled' where id = '%s';
  $q$, current_setting('rrv14.delivered')));

\echo ''
\echo '=== S-009 (5). Purged is the sweep''s state ==='

select rrv14.expect_refusal(
  'a customer admin cannot mark their engagement purged',
  'retention sweep, not by a caller',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000001';
  update public.release_rescue_engagements set status = 'purged' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

select rrv14.expect_refusal(
  'nor with the purge flag forged',
  'retention sweep, not by a caller',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000001';
  select set_config('delegation.retention_purge', 'on', true);
  update public.release_rescue_engagements set status = 'purged' where id = '%s';
  $q$, current_setting('rrv14.cancelled')));

do $$
declare v_id uuid; v_purged integer; v_log record;
begin
  v_id := rrv14.engagement_at('cancelled');
  update public.release_rescue_engagements
     set delivered_at = now(), retention_policy = 'purge_on_delivery', retention_days = 0
   where id = v_id;
  select public.purge_expired_release_rescue_data('manual') into v_purged;
  perform rrv14.assert('the sweep purges a cancelled engagement that has come due', v_purged >= 1);
  perform rrv14.assert('and it reads purged',
    (select status from public.release_rescue_engagements where id = v_id) = 'purged');
  select * into v_log from public.release_rescue_engagement_transitions
   where engagement_id = v_id and to_status = 'purged';
  perform rrv14.assert('the purge is logged as the sweep''s', v_log.via = 'retention_purge');
end $$;

\echo ''
\echo '=== S-009 (6). The log is written by the trigger and by nothing else ==='

do $$
declare v_denied boolean := false; v_id uuid := current_setting('rrv14.cancelled')::uuid;
begin
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
    insert into public.release_rescue_engagement_transitions
      (organization_id, engagement_id, from_status, to_status, via)
    values ('14b00000-0000-0000-0000-000000000001', v_id, 'intake', 'delivered', 'authenticated_operator');
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  perform rrv14.assert('an ops manager cannot write a transition log row', v_denied);

  v_denied := false;
  begin
    set local role authenticated;
    set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
    delete from public.release_rescue_engagement_transitions where engagement_id = v_id;
  exception when insufficient_privilege then v_denied := true;
  end;
  reset role;
  perform rrv14.assert('nor delete one', v_denied);
end $$;

do $$
declare v_own integer; v_other integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000001';
  select count(*) into v_own from public.release_rescue_engagement_transitions
   where organization_id = '14b00000-0000-0000-0000-000000000001';
  reset role;

  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000005';
  select count(*) into v_other from public.release_rescue_engagement_transitions
   where organization_id = '14b00000-0000-0000-0000-000000000001';
  reset role;

  perform rrv14.assert('a customer admin sees their own organization''s lifecycle history', v_own > 0);
  perform rrv14.assert('and another organization''s admin sees none of it', v_other = 0);
end $$;

\echo ''
\echo '=== S-010 (1). A run belongs to one engagement ==='

do $$
declare v_id uuid := rrv14.engagement_at('scoped'); v_run uuid;
begin
  select run_id into v_run from public.release_rescue_engagements where id = v_id;
  perform set_config('rrv14.run', v_run::text, false);
  perform set_config('rrv14.owner', v_id::text, false);
end $$;

select rrv14.expect_refusal(
  'RLS-mediated: a second engagement cannot name a run another engagement holds',
  'release_rescue_engagements_run_unique_idx',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000001';
  insert into public.release_rescue_engagements
    (organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('14b00000-0000-0000-0000-000000000001', '%s',
          '{"repository":{"repositoryRef":"graph/second"}}'::jsonb, repeat('5', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app');
  $q$, current_setting('rrv14.run')));

select rrv14.expect_refusal(
  'direct SQL, no RLS: the unique index refuses it just the same',
  'release_rescue_engagements_run_unique_idx',
  format($q$
  insert into public.release_rescue_engagements
    (organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('14b00000-0000-0000-0000-000000000001', '%s',
          '{"repository":{"repositoryRef":"graph/second"}}'::jsonb, repeat('6', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app');
  $q$, current_setting('rrv14.run')));

select rrv14.expect_refusal(
  'nor may an unpinned engagement pin a run another engagement holds',
  'release_rescue_engagements_run_unique_idx',
  format($q$
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('14e00000-0000-0000-0000-000000000001', '14b00000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"graph/unpinned"}}'::jsonb, repeat('7', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app');
  update public.release_rescue_engagements set run_id = '%s'
   where id = '14e00000-0000-0000-0000-000000000001';
  $q$, current_setting('rrv14.run')));

\echo ''
\echo '=== S-010 (2). A report names its engagement''s run ==='

do $$
declare
  v_id uuid := rrv14.engagement_at('auditing');
  v_run uuid;
  v_other_run uuid := rrv14.new_run();
  v_artifact uuid := gen_random_uuid();
begin
  select run_id into v_run from public.release_rescue_engagements where id = v_id;
  -- A body on a DIFFERENT run, so the report row can be pointed at it.
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values (v_artifact, '14b00000-0000-0000-0000-000000000001', v_other_run, 'observation', 'body on another run',
          repeat('b', 64), rrv14.report_body(v_id, v_other_run, '14a00000-0000-0000-0000-000000000002'));
  perform set_config('rrv14.auditing', v_id::text, false);
  perform set_config('rrv14.other_run', v_other_run::text, false);
  perform set_config('rrv14.other_artifact', v_artifact::text, false);
end $$;

select rrv14.expect_refusal(
  'a report on a run the engagement does not hold is refused',
  'does not match the run pinned on its engagement',
  format($q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('14b00000-0000-0000-0000-000000000001', '%s', '%s', '%s',
          'release-rescue-report/v1', repeat('d', 64), 'release-rescue-rubric/v1', repeat('4', 64),
          (select scope_hash from public.release_rescue_engagements where id = '%s'),
          'conditional_release', 0, 32, 32, 'auditor',
          '14a00000-0000-0000-0000-000000000002', '2026-09-18T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
  $q$, current_setting('rrv14.auditing'), current_setting('rrv14.other_run'),
       current_setting('rrv14.other_artifact'), current_setting('rrv14.auditing')));

\echo ''
\echo '=== S-010 (3). The sweep purges one engagement''s evidence and no other''s ==='

do $$
declare
  v_due uuid := rrv14.engagement_at('report_ready');
  v_live uuid := rrv14.engagement_at('report_ready');
  v_due_run uuid; v_live_run uuid;
  v_purged integer;
  v_due_left integer; v_live_left integer;
begin
  select run_id into v_due_run from public.release_rescue_engagements where id = v_due;
  select run_id into v_live_run from public.release_rescue_engagements where id = v_live;

  update public.release_rescue_engagements set status = 'delivered', delivered_at = now() where id = v_due;
  update public.release_rescue_engagements
     set retention_policy = 'purge_on_delivery', retention_days = 0 where id = v_due;

  select public.purge_expired_release_rescue_data('manual') into v_purged;
  perform rrv14.assert('the sweep purged the due engagement', v_purged >= 1);

  select count(*) into v_due_left from public.evidence_artifacts
   where run_id = v_due_run and coalesce(payload->>'schemaVersion', '') like 'release-rescue-%';
  select count(*) into v_live_left from public.evidence_artifacts
   where run_id = v_live_run and coalesce(payload->>'schemaVersion', '') like 'release-rescue-%';

  perform rrv14.assert('the due engagement''s report body is gone', v_due_left = 0);
  perform rrv14.assert('S-010 reproduction: the other engagement''s unexpired evidence is untouched', v_live_left = 1);
  perform rrv14.assert('and the other engagement is not purged',
    (select purged_at from public.release_rescue_engagements where id = v_live) is null);
end $$;

-- Fail closed. The unique index makes a shared run impossible; this drops it
-- inside a transaction, manufactures the impossible state, and asserts the sweep
-- refuses to delete rather than reach the second engagement's evidence. Rolled
-- back afterwards, so the index is intact for everything that follows.
begin;
drop index public.release_rescue_engagements_run_unique_idx;

do $$
declare
  v_a uuid := rrv14.engagement_at('report_ready');
  v_b uuid;
  v_run uuid;
begin
  select run_id into v_run from public.release_rescue_engagements where id = v_a;
  update public.release_rescue_engagements set status = 'delivered', delivered_at = now() where id = v_a;
  update public.release_rescue_engagements
     set retention_policy = 'purge_on_delivery', retention_days = 0 where id = v_a;

  -- The second engagement on the SAME run, which only the dropped index forbade.
  v_b := gen_random_uuid();
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values (v_b, '14b00000-0000-0000-0000-000000000001', v_run,
          '{"repository":{"repositoryRef":"graph/shared"}}'::jsonb, repeat('8', 64),
          'minimum_7_day', 7, 'customer_installed_readonly_app');
end $$;

select rrv14.expect_refusal(
  'with the index gone and a run shared, the sweep refuses rather than deletes',
  'Retention sweep refused',
  $q$ select public.purge_expired_release_rescue_data('manual'); $q$);

rollback;

do $$
begin
  perform rrv14.assert('the unique index is back after the rollback',
    exists (select 1 from pg_indexes where indexname = 'release_rescue_engagements_run_unique_idx'));
end $$;

\echo ''
\echo '=== Reviewer (1). An interactive signer signs as themselves ==='

do $$
declare
  v_id uuid := rrv14.engagement_at('auditing');
  v_run uuid;
  v_artifact uuid := gen_random_uuid();
begin
  select run_id into v_run from public.release_rescue_engagements where id = v_id;
  -- A body signed by the SECOND manager, on the server channel, so the row
  -- cases below fail on the row's binding and not on v13's row/artifact match.
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values (v_artifact, '14b00000-0000-0000-0000-000000000001', v_run, 'observation', 'second manager body',
          repeat('e', 64), rrv14.report_body(v_id, v_run, '14a00000-0000-0000-0000-000000000003', 'Second Manager'));
  perform set_config('rrv14.sign_engagement', v_id::text, false);
  perform set_config('rrv14.sign_run', v_run::text, false);
  perform set_config('rrv14.sign_artifact', v_artifact::text, false);
end $$;

select rrv14.expect_refusal(
  'the first manager cannot issue a report signed by the second',
  'cannot be attributed to another person',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('14b00000-0000-0000-0000-000000000001', '%s', '%s', '%s',
          'release-rescue-report/v1', repeat('e', 63) || '1', 'release-rescue-rubric/v1', repeat('4', 64),
          (select scope_hash from public.release_rescue_engagements where id = '%s'),
          'conditional_release', 0, 32, 32, 'auditor',
          '14a00000-0000-0000-0000-000000000003', '2026-09-18T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
  $q$, current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run'),
       current_setting('rrv14.sign_artifact'), current_setting('rrv14.sign_engagement')));

select rrv14.expect_ok('the second manager issues it, as themselves', format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000003';
  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash,
     reviewed_via)
  values ('14f00000-0000-0000-0000-000000000001', '14b00000-0000-0000-0000-000000000001', '%s', '%s', '%s',
          'release-rescue-report/v1', repeat('e', 63) || '2', 'release-rescue-rubric/v1', repeat('4', 64),
          (select scope_hash from public.release_rescue_engagements where id = '%s'),
          'conditional_release', 0, 32, 32, 'auditor',
          '14a00000-0000-0000-0000-000000000003', '2026-09-18T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64),
          -- The caller's claim about the channel is overwritten by the trigger.
          'service_role');
  $q$, current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run'),
       current_setting('rrv14.sign_artifact'), current_setting('rrv14.sign_engagement')));

do $$
declare v record;
begin
  select * into v from public.release_rescue_reports where id = '14f00000-0000-0000-0000-000000000001';
  perform rrv14.assert('the row names the caller', v.reviewed_by = '14a00000-0000-0000-0000-000000000003');
  perform rrv14.assert('through the interactive channel, whatever the caller claimed', v.reviewed_via = 'authenticated_operator');
end $$;

-- v2's immutability trigger sorts ahead of the binding and refuses first; the
-- binding's own "cannot be rewritten" arm stands behind it for the purge branch,
-- which is the one write v2 lets through.
select rrv14.expect_refusal(
  'the channel cannot be rewritten afterwards',
  'only permitted report update',
  $q$
  update public.release_rescue_reports set reviewed_via = 'service_role'
   where id = '14f00000-0000-0000-0000-000000000001';
  $q$);

select rrv14.expect_refusal(
  'the server channel still cannot name a plain operator as the reviewer',
  'ops manager or platform admin',
  format($q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('14b00000-0000-0000-0000-000000000001', '%s', '%s', '%s',
          'release-rescue-report/v1', repeat('e', 63) || '3', 'release-rescue-rubric/v1', repeat('4', 64),
          (select scope_hash from public.release_rescue_engagements where id = '%s'),
          'conditional_release', 0, 32, 32, 'auditor',
          '14a00000-0000-0000-0000-000000000004', '2026-09-18T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
  $q$, current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run'),
       current_setting('rrv14.sign_artifact'), current_setting('rrv14.sign_engagement')));

do $$
declare v_via text;
begin
  -- The server channel is what rrv14.issue_report uses throughout this proof.
  select reviewed_via into v_via from public.release_rescue_reports
   where engagement_id = current_setting('rrv14.auditing')::uuid limit 1;
  perform rrv14.assert('a report the server issued records the server channel', v_via = 'service_role');
end $$;

\echo ''
\echo '=== Reviewer (2). An interactive report artifact names its writer ==='

select rrv14.expect_refusal(
  'a manager cannot write a report body signed by another manager',
  'cannot be attributed to another person',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('14b00000-0000-0000-0000-000000000001', '%s', 'observation', 'forged signature',
          repeat('f', 63) || '1',
          rrv14.report_body('%s', '%s', '14a00000-0000-0000-0000-000000000003', 'Second Manager'));
  $q$, current_setting('rrv14.sign_run'), current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run')));

select rrv14.expect_refusal(
  'nor one whose clearance names another manager',
  'clearance written by an operator records that operator',
  format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('14b00000-0000-0000-0000-000000000001', '%s', 'observation', 'forged clearance',
          repeat('f', 63) || '2',
          rrv14.report_body('%s', '%s', '14a00000-0000-0000-0000-000000000002')
            || jsonb_build_object('clearedSecretHolds', jsonb_build_array(jsonb_build_object(
                 'path', 'findings[0].locations[0].path',
                 'clearedBy', '14a00000-0000-0000-0000-000000000003',
                 'reasonCode', 'confirmed_placeholder_or_example_value',
                 'clearedContentHash', repeat('9', 64)))));
  $q$, current_setting('rrv14.sign_run'), current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run')));

select rrv14.expect_ok('a manager writes a report body signed by themselves', format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('14b00000-0000-0000-0000-000000000001', '%s', 'observation', 'own signature',
          repeat('f', 63) || '3',
          rrv14.report_body('%s', '%s', '14a00000-0000-0000-0000-000000000002'));
  $q$, current_setting('rrv14.sign_run'), current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run')));

select rrv14.expect_ok('and an unsigned draft carries no identity to bind', format($q$
  set local role authenticated;
  set local request.jwt.claim.sub = '14a00000-0000-0000-0000-000000000002';
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('14b00000-0000-0000-0000-000000000001', '%s', 'observation', 'draft',
          repeat('f', 63) || '4',
          rrv14.report_body('%s', '%s', '14a00000-0000-0000-0000-000000000002') - 'reviewedBy');
  $q$, current_setting('rrv14.sign_run'), current_setting('rrv14.sign_engagement'), current_setting('rrv14.sign_run')));

\echo ''
\echo '=== Schema properties ==='

do $$
begin
  perform rrv14.assert('the lifecycle graph trigger runs with invoker rights',
    not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'enforce_release_rescue_lifecycle_graph'));
  perform rrv14.assert('so does the reviewer binding',
    not (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'enforce_release_rescue_reviewer_is_caller'));
  perform rrv14.assert('the lifecycle triggers fire before every other engagement trigger',
    not exists (select 1 from pg_trigger t
                 where t.tgrelid = 'public.release_rescue_engagements'::regclass
                   and not t.tgisinternal
                   and t.tgname < 'trg_release_rescue_0_lifecycle_graph'));
  perform rrv14.assert('the plain run index from v1 is gone',
    not exists (select 1 from pg_indexes where indexname = 'release_rescue_engagements_run_idx'));
end $$;

\echo ''
\echo '=== v14 proof complete: every case above printed PASS ==='
