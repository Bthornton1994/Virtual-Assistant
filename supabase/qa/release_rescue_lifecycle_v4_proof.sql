-- AI App Release Rescue v4: the complete engagement lifecycle, executed.
--
-- The other proofs test guards in isolation: each case sets up the one state a
-- guard cares about and attempts the one thing it must refuse. That is the right
-- shape for a guard, and it is exactly why it missed the defect this proof
-- exists for.
--
-- The v3 pass recorded a defect it could not see from any single guard: the
-- intended lifecycle could not be EXECUTED. `freezeScope(intake, commitSha)` put
-- the reviewed commit inside a scope that is frozen and hashed at intake, while
-- the commit is only resolved at the snapshot, which is later. Every guard was
-- individually correct and the sequence was impossible. No isolated case could
-- have found that, because the contradiction only exists between the steps.
--
-- So this proof does the one thing the others do not: it walks a single
-- engagement from intake to purge, in order, and asserts at every step.
--
--   intake -> grant -> snapshot -> commit pin -> review -> report -> delivery -> purge
--
-- and, since v14, through every status the lifecycle graph requires on the way:
--
--   intake -> scoped -> access_granted -> auditing -> report_ready -> delivered -> purged
--
-- NEVER apply this file to a real Supabase project.
--
-- Usage (disposable local Postgres with the full migration chain applied):
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_lifecycle_v4_proof.sql

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_lifecycle_v4_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrl4;
-- The isolation step runs as `authenticated`, and it still has to call the
-- assertion helpers to report what it saw.
grant usage on schema rrl4 to public;

create or replace function rrl4.expect_refusal(p_label text, p_expect text, p_sql text)
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

create or replace function rrl4.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS allowed  | %', p_label;
end $$;

create or replace function rrl4.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

-- Identities ------------------------------------------------------------------

insert into auth.users (id, email) values
  ('aaaa4000-0000-0000-0000-000000000001', 'customer.admin@example.test'),
  ('aaaa4000-0000-0000-0000-000000000002', 'ops.manager@example.test'),
  ('aaaa4000-0000-0000-0000-000000000003', 'other.customer@example.test');

insert into public.organizations (id, name, slug) values
  ('bbbb4000-0000-0000-0000-000000000001', 'Acme', 'acme-lifecycle'),
  ('bbbb4000-0000-0000-0000-000000000002', 'Other Co', 'other-co-lifecycle');

insert into public.organization_members (organization_id, user_id, role, status) values
  ('bbbb4000-0000-0000-0000-000000000001', 'aaaa4000-0000-0000-0000-000000000001', 'client_admin', 'active'),
  ('bbbb4000-0000-0000-0000-000000000002', 'aaaa4000-0000-0000-0000-000000000003', 'client_admin', 'active');

insert into public.operators (user_id, name, platform_role)
values ('aaaa4000-0000-0000-0000-000000000002', 'Ops Manager', 'ops_manager');

insert into public.workstreams (id, organization_id, name, objective, sla)
values ('cccc4000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
        'Release Rescue', 'Review release readiness', '5 business days');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class)
values ('dddd4000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
        'cccc4000-0000-0000-0000-000000000001', 'active', 'Release readiness review', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status)
values ('eeee4000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
        'cccc4000-0000-0000-0000-000000000001', 'dddd4000-0000-0000-0000-000000000001', 'planned');
update public.workstream_runs set status = 'running' where id = 'eeee4000-0000-0000-0000-000000000001';

\echo ''
\echo '=== STEP 1. Intake. The agreement is frozen; the commit does not exist yet ==='

select rrl4.expect_ok('the customer opens an engagement with the agreed scope', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa4000-0000-0000-0000-000000000001';
  insert into public.release_rescue_engagements
    (id, organization_id, run_id, scope, scope_hash, retention_policy, retention_days,
     access_mode, created_by)
  values ('ffff4000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
          'eeee4000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"acme/checkout","accessMode":"customer_installed_readonly_app","defaultBranch":"main","provider":"github"},"aiAssistedReviewAccepted":false}'::jsonb,
          repeat('a', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app',
          'aaaa4000-0000-0000-0000-000000000001');
$q$);

-- THE DEFECT, stated as a test.
--
-- This is the write the old contract required and the schema refused. If this
-- ever succeeds, the commit has leaked back into the frozen scope and the
-- lifecycle is broken again in the same way.
select rrl4.expect_refusal(
  'a frozen scope may not carry a commit, because none exists at intake',
  'scope_has_no_commit',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('bbbb4000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"acme/checkout","commitSha":"1111111111111111111111111111111111111111"}}'::jsonb,
          repeat('b', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');
$q$);

select rrl4.expect_refusal(
  'nor may an engagement arrive already claiming a reviewed commit',
  'cannot be set at intake',
  $q$
  insert into public.release_rescue_engagements
    (organization_id, scope, scope_hash, retention_policy, retention_days, access_mode,
     reviewed_commit_sha)
  values ('bbbb4000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"acme/checkout"}}'::jsonb,
          repeat('c', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app', repeat('d', 40));
$q$);

-- v14: the lifecycle is an ordered graph. A review starts from access_granted
-- and nowhere else, so a jump from intake is refused as an illegal move before
-- any precondition is consulted.
select rrl4.expect_refusal(
  'no review starts from intake: the lifecycle graph admits no jump to auditing',
  'not a permitted transition',
  $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('the engagement is scoped', $q$
  update public.release_rescue_engagements set status = 'scoped'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

-- At scoped nothing is in place yet, so the FIRST gate refuses: there is no
-- grant. The commit-specific gate is exercised in step 3, once everything else
-- is satisfied and the missing commit is the only thing left. Asserting the
-- commit message here would have asserted the wrong guard.
select rrl4.expect_refusal(
  'and access is not recorded as granted, because nothing has been granted yet',
  'live, unrevoked read-only grant',
  $q$
  update public.release_rescue_engagements set status = 'access_granted'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== STEP 2. Access. The customer grants, in their own provider ==='

select rrl4.expect_ok('the customer grants time-boxed read-only access', $q$
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa4000-0000-0000-0000-000000000001';
  insert into public.release_rescue_repository_grants
    (id, organization_id, engagement_id, provider, repository_ref, grant_method, expires_at, granted_by)
  values ('1111a000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
          'ffff4000-0000-0000-0000-000000000001', 'github', 'acme/checkout',
          'customer_installed_readonly_app', now() + interval '7 days',
          'aaaa4000-0000-0000-0000-000000000001');
$q$);

select rrl4.expect_ok('with a live grant naming the repository, access is recorded as granted', $q$
  update public.release_rescue_engagements set status = 'access_granted'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('an ops manager records how ownership was established', $q$
  update public.release_rescue_engagements
     set ownership_confirmation = 'provider_ownership_verified_by_operator',
         ownership_confirmed_by = 'aaaa4000-0000-0000-0000-000000000002',
         ownership_confirmation_note = 'Repository owner matches the contracting organisation.'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== STEP 3. Snapshot, then the commit it resolved. The pin has one moment ==='

select rrl4.expect_refusal(
  'the commit cannot be pinned before the snapshot that resolved it',
  'before the snapshot is recorded',
  $q$
  update public.release_rescue_engagements set reviewed_commit_sha = repeat('e', 40)
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

-- Everything else is now in place: a live grant, an ownership confirmation, an
-- access mode that agrees with the scope. The ONLY thing missing is the commit,
-- so this is the case that isolates the new gate.
select rrl4.expect_refusal(
  'with access and ownership settled, the missing commit is what still blocks the review',
  'reviewed commit is pinned',
  $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('the snapshot is recorded with the limits that bounded it', $q$
  update public.release_rescue_engagements
     set snapshot_limits_version = 'release-rescue-snapshot-limits/v1',
         snapshot_file_count = 1840,
         snapshot_total_bytes = 41000000,
         snapshot_rejected_paths = '[{"path":"vendor/big.bin","reason":"file_too_large"}]'::jsonb
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('and now the commit is pinned', $q$
  update public.release_rescue_engagements
     set reviewed_commit_sha = '9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

do $$
declare v_at timestamptz;
begin
  select reviewed_commit_pinned_at into v_at from public.release_rescue_engagements
   where id = 'ffff4000-0000-0000-0000-000000000001';
  perform rrl4.assert('the pin records when it happened', v_at is not null);
end $$;

select rrl4.expect_refusal(
  'the pinned commit cannot be changed',
  'pinned once and cannot be changed',
  $q$
  update public.release_rescue_engagements set reviewed_commit_sha = repeat('f', 40)
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_refusal(
  'nor cleared',
  'pinned once and cannot be changed',
  $q$
  update public.release_rescue_engagements set reviewed_commit_sha = null
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_refusal(
  'nor may the customer forge a pin without a live grant on a second engagement',
  'live, unrevoked read-only grant',
  $q$
  insert into public.release_rescue_engagements
    (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
  values ('ffff4000-0000-0000-0000-000000000009', 'bbbb4000-0000-0000-0000-000000000001',
          '{"repository":{"repositoryRef":"victim/private"}}'::jsonb,
          repeat('9', 64), 'minimum_7_day', 7, 'customer_installed_readonly_app');
  update public.release_rescue_engagements
     set snapshot_limits_version = 'release-rescue-snapshot-limits/v1'
   where id = 'ffff4000-0000-0000-0000-000000000009';
  update public.release_rescue_engagements set reviewed_commit_sha = repeat('8', 40)
   where id = 'ffff4000-0000-0000-0000-000000000009';
$q$);

select rrl4.expect_refusal(
  'the pin timestamp is attribution and is not rewritten',
  'cannot be rewritten',
  $q$
  update public.release_rescue_engagements set reviewed_commit_pinned_at = now() - interval '10 days'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== STEP 4. The scope and its hash are still frozen, at every step ==='

select rrl4.expect_refusal(
  'pinning a commit did not make the scope writable',
  'scope is frozen at intake',
  $q$
  update public.release_rescue_engagements
     set scope = '{"repository":{"repositoryRef":"victim/private"}}'::jsonb
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_refusal(
  'nor may the commit be smuggled back into the frozen scope',
  'scope is frozen at intake',
  $q$
  update public.release_rescue_engagements
     set scope = jsonb_set(scope, '{repository,commitSha}', '"9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642"'::jsonb)
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

-- Checked inline rather than through the helper, because the two frozen-scope
-- guards have overlapping messages: the v1 scope_hash guard says "Engagement
-- scope is frozen at intake" and the v3 scope-content guard says the same words
-- followed by "and cannot be rewritten". A substring expectation could not tell
-- which one fired, and the whole point here is that the HASH guard is the one
-- still standing.
do $$
declare v_message text;
begin
  begin
    update public.release_rescue_engagements set scope_hash = repeat('7', 64)
     where id = 'ffff4000-0000-0000-0000-000000000001';
    raise exception using errcode = 'RR001', message = 'EXPECTED-REFUSAL-NOT-RAISED: scope hash';
  exception when others then
    if sqlstate = 'RR001' then raise; end if;
    v_message := sqlerrm;
  end;

  perform rrl4.assert('the scope hash guard is what refuses a scope-hash rewrite',
                      v_message = 'Engagement scope is frozen at intake');
end $$;

\echo ''
\echo '=== STEP 5. The review runs, and the report is bound to the pinned commit ==='

select rrl4.expect_ok('with ownership, a live grant and a pinned commit, the review starts', $q$
  update public.release_rescue_engagements set status = 'auditing'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('2222a000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
        'eeee4000-0000-0000-0000-000000000001', 'observation', 'Release Rescue report body',
        repeat('1', 64),
        '{"schemaVersion":"release-rescue-report/v1","observationCatalogVersion":"release-rescue-observations/v1","observationCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verdict":"conditional_release","blockingFindingCount":0,"reviewedCommitSha":"9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642","reviewedBy":{"operatorUserId":"aaaa4000-0000-0000-0000-000000000002","displayName":"Ops Manager","reviewedAt":"2026-09-17T10:00:00.000Z","reasonCode":"reviewed_findings_and_verdict_match_the_recorded_observations","approvedContentHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"coverage":{"totalChecks":32,"assessedChecks":32}}'::jsonb);

-- A body naming a DIFFERENT commit. The report row that points at it must be
-- refused, or the pin would be decoration.
insert into public.evidence_artifacts
  (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('2222a000-0000-0000-0000-000000000002', 'bbbb4000-0000-0000-0000-000000000001',
        'eeee4000-0000-0000-0000-000000000001', 'observation', 'Body naming another commit',
        repeat('2', 64),
        '{"schemaVersion":"release-rescue-report/v1","observationCatalogVersion":"release-rescue-observations/v1","observationCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verdict":"conditional_release","blockingFindingCount":0,"reviewedCommitSha":"0000000000000000000000000000000000000000","coverage":{"totalChecks":32,"assessedChecks":32}}'::jsonb);

select rrl4.expect_refusal(
  'a report naming a commit the engagement did not pin is refused',
  'does not match the commit pinned on its engagement',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by,
     reviewed_at, review_reason_code, review_approved_content_hash,
     reviewed_commit_sha)
  values ('bbbb4000-0000-0000-0000-000000000001', 'ffff4000-0000-0000-0000-000000000001',
          'eeee4000-0000-0000-0000-000000000001', '2222a000-0000-0000-0000-000000000001',
          'release-rescue-report/v1', repeat('3', 64), 'release-rescue-rubric/v1', repeat('4', 64),
          repeat('a', 64), 'conditional_release', 0, 32, 32, 'auditor',
          'aaaa4000-0000-0000-0000-000000000002', '2026-09-17T10:00:00.000Z',
          -- v13: the row's attestation must match the one in the artifact, and a
          -- report without one cannot reach step 7's delivery stamp at all.
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64),
          repeat('0', 40));
$q$);

select rrl4.expect_refusal(
  'a report whose BODY names another commit is refused too',
  'names a different commit from the one its engagement pinned',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by)
  values ('bbbb4000-0000-0000-0000-000000000001', 'ffff4000-0000-0000-0000-000000000001',
          'eeee4000-0000-0000-0000-000000000001', '2222a000-0000-0000-0000-000000000002',
          'release-rescue-report/v1', repeat('5', 64), 'release-rescue-rubric/v1', repeat('4', 64),
          repeat('a', 64), 'conditional_release', 0, 32, 32, 'auditor',
          'aaaa4000-0000-0000-0000-000000000002');
$q$);

select rrl4.expect_ok('the report is issued, and the commit is filled in from the engagement', $q$
  insert into public.release_rescue_reports
    (id, organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key, reviewed_by,
     reviewed_at, review_reason_code, review_approved_content_hash)
  values ('3333a000-0000-0000-0000-000000000001', 'bbbb4000-0000-0000-0000-000000000001',
          'ffff4000-0000-0000-0000-000000000001', 'eeee4000-0000-0000-0000-000000000001',
          '2222a000-0000-0000-0000-000000000001', 'release-rescue-report/v1', repeat('6', 64),
          'release-rescue-rubric/v1', repeat('4', 64), repeat('a', 64), 'conditional_release', 0,
          32, 32, 'auditor', 'aaaa4000-0000-0000-0000-000000000002',
          -- v13: matches the signature in artifact 2222a000-...-0001, identity and
          -- timestamp included. Without it this row cannot be stamped delivered.
          '2026-09-17T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
$q$);

do $$
declare v_report text; v_engagement text;
begin
  select r.reviewed_commit_sha, e.reviewed_commit_sha into v_report, v_engagement
    from public.release_rescue_reports r
    join public.release_rescue_engagements e on e.id = r.engagement_id
   where r.id = '3333a000-0000-0000-0000-000000000001';

  perform rrl4.assert('the report carries the engagement''s pinned commit, not a chosen one',
                      v_report = v_engagement
                      and v_report = '9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642');
end $$;

select rrl4.expect_refusal(
  'a report cannot be repointed at another commit after it is issued',
  'cannot be repointed',
  $q$
  update public.release_rescue_reports set reviewed_commit_sha = repeat('a', 40)
   where id = '3333a000-0000-0000-0000-000000000001';
$q$);

-- v14: the engagement records that a report exists, and may not skip the state.
select rrl4.expect_refusal(
  'the engagement cannot go straight from auditing to delivered',
  'not a permitted transition',
  $q$
  update public.release_rescue_engagements set status = 'delivered', delivered_at = now()
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('with a report issued, the engagement is report_ready', $q$
  update public.release_rescue_engagements set status = 'report_ready'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

\echo ''
\echo '=== STEP 6. Tenant isolation, at the step where the commit now exists ==='

do $$
declare
  v_commits integer;
  v_reports integer;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa4000-0000-0000-0000-000000000003';

  select count(*) into v_commits from public.release_rescue_engagements
   where reviewed_commit_sha is not null;
  select count(*) into v_reports from public.release_rescue_reports;

  reset role;

  perform rrl4.assert('another tenant sees no pinned commit of ours', v_commits = 0);
  perform rrl4.assert('nor any of our reports', v_reports = 0);
end $$;

-- Row level security refuses by making the row invisible, not by raising. So
-- this is asserted on the row count and on the value afterwards: an UPDATE that
-- silently matches nothing is the refusal, and the commit is unchanged.
do $$
declare
  v_rows integer;
  v_commit text;
begin
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa4000-0000-0000-0000-000000000003';

  update public.release_rescue_engagements set reviewed_commit_sha = repeat('b', 40)
   where id = 'ffff4000-0000-0000-0000-000000000001';
  get diagnostics v_rows = row_count;

  reset role;

  select reviewed_commit_sha into v_commit from public.release_rescue_engagements
   where id = 'ffff4000-0000-0000-0000-000000000001';

  perform rrl4.assert('another tenant''s pin attempt matches no row', v_rows = 0);
  perform rrl4.assert('and our pinned commit is untouched',
                      v_commit = '9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642');
end $$;

\echo ''
\echo '=== STEP 7. Delivery ==='

-- v14: the engagement is delivered only once its report has been stamped, and
-- only with its own retention clock started.
select rrl4.expect_refusal(
  'the engagement is not delivered before its report is',
  'only once its report has been stamped delivered',
  $q$
  update public.release_rescue_engagements set status = 'delivered', delivered_at = now()
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('the report is stamped delivered', $q$
  update public.release_rescue_reports set delivered_at = now()
   where id = '3333a000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_refusal(
  'and the engagement is not delivered without its own delivered_at',
  'must stamp delivered_at',
  $q$
  update public.release_rescue_engagements set status = 'delivered'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_ok('delivery is stamped once', $q$
  update public.release_rescue_engagements set status = 'delivered', delivered_at = now()
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

select rrl4.expect_refusal(
  'a delivered engagement does not reopen',
  'does not reopen',
  $q$
  update public.release_rescue_engagements set status = 'report_ready'
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

do $$
declare v_path text;
begin
  select string_agg(from_status || '>' || to_status, ' ' order by sequence_no) into v_path
    from public.release_rescue_engagement_transitions
   where engagement_id = 'ffff4000-0000-0000-0000-000000000001';
  perform rrl4.assert('every step was logged, in order: ' || v_path,
                      v_path = 'intake>scoped scoped>access_granted access_granted>auditing auditing>report_ready report_ready>delivered');
end $$;

\echo ''
\echo '=== STEP 8. Retention. Content goes; the accounting evidence stays ==='

-- Hardening v5 made `purge_after` server-derived, so the engagement becomes due
-- the way a real one does: a zero-day retention election at delivery. It was
-- already delivered in step 7, so only the election changes.
update public.release_rescue_engagements
   set retention_policy = 'purge_on_delivery', retention_days = 0
 where id = 'ffff4000-0000-0000-0000-000000000001';

do $$
declare v_purged integer;
begin
  select public.purge_expired_release_rescue_data('manual') into v_purged;
  perform rrl4.assert('the sweep purged exactly this engagement', v_purged = 1);
end $$;

do $$
declare
  v_commit text;
  v_scope_hash text;
  v_scope jsonb;
  v_status text;
  v_report record;
  v_bodies integer;
begin
  select reviewed_commit_sha, scope_hash, scope, status
    into v_commit, v_scope_hash, v_scope, v_status
    from public.release_rescue_engagements
   where id = 'ffff4000-0000-0000-0000-000000000001';

  -- What must SURVIVE: the identity of what was reviewed. Neither value is
  -- customer content; both are hashes, and without them a delivered report can no
  -- longer say what it read.
  perform rrl4.assert('the pinned commit survives the purge as accounting evidence',
                      v_commit = '9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642');
  perform rrl4.assert('so does the scope hash', v_scope_hash = repeat('a', 64));

  -- What must GO: the customer's content.
  perform rrl4.assert('the scope content is cleared', v_scope = jsonb_build_object('purged', true));
  perform rrl4.assert('and the engagement is marked purged', v_status = 'purged');

  select * into v_report from public.release_rescue_reports
   where id = '3333a000-0000-0000-0000-000000000001';
  perform rrl4.assert('the report accounting row survives', v_report.id is not null);
  perform rrl4.assert('with its verdict', v_report.verdict = 'conditional_release');
  perform rrl4.assert('with its commit', v_report.reviewed_commit_sha = '9f2c1b7e4d5a308c6b1e0f72a4d9c83b5e017642');
  perform rrl4.assert('and with its body pointer cleared', v_report.report_artifact_id is null);

  select count(*) into v_bodies from public.evidence_artifacts
   where id = '2222a000-0000-0000-0000-000000000001';
  perform rrl4.assert('the report body itself is gone', v_bodies = 0);
end $$;

select rrl4.expect_refusal(
  'the purge did not make the commit writable either',
  'pinned once and cannot be changed',
  $q$
  update public.release_rescue_engagements set reviewed_commit_sha = repeat('c', 40)
   where id = 'ffff4000-0000-0000-0000-000000000001';
$q$);

do $$
declare v_purged integer;
begin
  select public.purge_expired_release_rescue_data('manual') into v_purged;
  perform rrl4.assert('a second sweep is idempotent', v_purged = 0);
end $$;

\echo ''
\echo '=== Lifecycle proof complete: intake -> grant -> snapshot -> pin -> review -> report -> delivery -> purge ==='
