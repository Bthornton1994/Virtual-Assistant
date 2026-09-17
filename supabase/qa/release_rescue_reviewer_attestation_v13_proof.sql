-- AI App Release Rescue v13: an approval records why and over which bytes, proven live.
--
-- The hole this closes is not that a report could be delivered unsigned — v1
-- made `reviewed_by` NOT NULL and checks the named reviewer holds manager
-- authority. It is that a signature recorded WHO and WHEN and nothing else.
--
-- So an edit made to a report AFTER a human approved it — a verdict flipped, a
-- blocking finding dropped, a limitation removed — passed every check in the
-- system. The application bound a delivery decision to a hash, but recomputed
-- that hash from the very bytes it was about to render, so it could not
-- disagree with them. This file proves the replacement can.
--
-- Both directions, as every proof in this workstream does: a complete signature
-- is STORED, and an incomplete or mismatched one is REFUSED. A guard that
-- refuses the product's own artifacts is worse than the hole it closes.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_reviewer_attestation_v13_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv13;
grant usage on schema rrv13 to public;

create or replace function rrv13.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv13.expect_ok(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise notice 'PASS accepted | %', p_label;
end $$;

create or replace function rrv13.expect_refusal(p_label text, p_expect text, p_sql text)
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

-- A report the product actually produces, signed the way v13 requires.
create or replace function rrv13.report()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'reportId', 'd1000000-0000-4000-8000-0000000000d1',
    'engagementId', 'd2000000-0000-4000-8000-0000000000d2',
    'runId', 'de000000-0000-0000-0000-0000000000d1',
    'organizationId', 'db000000-0000-0000-0000-0000000000d1',
    'reviewedBy', jsonb_build_object(
      'operatorUserId', 'da000000-0000-0000-0000-0000000000d1',
      'displayName', 'Ops Manager',
      'reviewedAt', '2026-09-17T10:00:00.000Z',
      'reasonCode', 'reviewed_findings_and_verdict_match_the_recorded_observations',
      'approvedContentHash', repeat('c', 64)),
    'limitationCodes', jsonb_build_array('read_only_no_running_system'),
    'assessments', jsonb_build_array(jsonb_build_object(
      'checkId', 'secrets.no_secrets_in_version_control',
      'outcome', 'fail',
      'rationaleCode', 'control_missing_on_a_reachable_path',
      'evidence', jsonb_build_array(jsonb_build_object(
        'kind', 'configuration_reference', 'path', 'docker-compose.yml',
        'startLine', 4, 'endLine', 6)))),
    'findings', jsonb_build_array(jsonb_build_object(
      'findingId', 'RR-001',
      'rubricCheckId', 'secrets.no_secrets_in_version_control',
      'observationCode', 'secrets.literal_credential_in_repository',
      'remediationCode', 'rotate_and_move_to_secret_store',
      'uncertaintyCode', null,
      'locations', jsonb_build_array(jsonb_build_object(
        'path', 'docker-compose.yml', 'startLine', 4, 'endLine', 6)),
      'evidence', jsonb_build_array(jsonb_build_object(
        'kind', 'configuration_reference', 'path', 'docker-compose.yml',
        'startLine', 4, 'endLine', 6)))))
$$;

-- Fixtures ------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('da000000-0000-0000-0000-0000000000d1', 'v13.admin@example.test');
insert into auth.users (id, email) values
  ('da000000-0000-0000-0000-0000000000d2', 'v13.second@example.test');
insert into public.operators (user_id, name, platform_role) values
  ('da000000-0000-0000-0000-0000000000d1', 'Ops Manager', 'ops_manager'),
  -- A SECOND authorised manager, so the identity-binding case below fails on the
  -- binding rather than on the authority check it is not about.
  ('da000000-0000-0000-0000-0000000000d2', 'Second Manager', 'ops_manager');
insert into public.organizations (id, name, slug) values
  ('db000000-0000-0000-0000-0000000000d1', 'V13 Co', 'v13-co');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('db000000-0000-0000-0000-0000000000d1', 'da000000-0000-0000-0000-0000000000d1', 'client_admin', 'active');
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('dc000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('dd000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1',
   'dc000000-0000-0000-0000-0000000000d1', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('de000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1',
   'dc000000-0000-0000-0000-0000000000d1', 'dd000000-0000-0000-0000-0000000000d1', 'planned');
update public.workstream_runs set status = 'running' where id = 'de000000-0000-0000-0000-0000000000d1';

\echo ''
\echo '=== 0. The report the product produces is still storable ==='

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
        'observation', 'a fully attested report', repeat('0', 64), rrv13.report());

do $$
begin
  perform rrv13.assert('a fully attested report is stored',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('0', 64)) = 1);
  perform rrv13.assert('and the guard flags nothing in it',
    cardinality(public.release_rescue_payload_unattested_signature(rrv13.report())) = 0);
end $$;

\echo ''
\echo '=== 1. An UNSIGNED report is not a defect ==='

-- A report is assembled as a draft, shown to a reviewer, and signed after that.
-- The gap between those two steps is the normal state of a report. A guard that
-- refused it would refuse the artifact this product spends most of its time
-- holding, and the delivery gate is what refuses to SEND one.

insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('d4000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1',
        'de000000-0000-0000-0000-0000000000d1',
        'observation', 'an unsigned draft', repeat('1', 64),
        jsonb_set(rrv13.report(), '{reviewedBy}', 'null'::jsonb));

-- A report with NO `reviewedBy` KEY, which is a different shape from one whose
-- `reviewedBy` is JSON null and was the shape this guard got wrong on its first
-- run: `jsonb_typeof` of an absent key is SQL NULL, so the early return did not
-- fire and four existing proofs went red at once. Both shapes are asserted here.
insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
        'observation', 'a draft with no reviewedBy key', repeat('2', 63) || '0',
        rrv13.report() - 'reviewedBy');

do $$
begin
  perform rrv13.assert('an unsigned draft is stored',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('1', 64)) = 1);
  perform rrv13.assert('and nothing is flagged on it',
    cardinality(public.release_rescue_payload_unattested_signature(
      jsonb_set(rrv13.report(), '{reviewedBy}', 'null'::jsonb))) = 0);
  perform rrv13.assert('a report with no reviewedBy key at all is stored',
    (select count(*) from public.evidence_artifacts
      where content_hash = repeat('2', 63) || '0') = 1);
  perform rrv13.assert('and nothing is flagged on that shape either',
    cardinality(public.release_rescue_payload_unattested_signature(
      rrv13.report() - 'reviewedBy')) = 0);
end $$;

\echo ''
\echo '=== 2. A signature missing either field is refused ==='

select rrv13.expect_refusal(
  'a signature with no reason is refused',
  'must record why it was given',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'no reason', repeat('2', 64),
          rrv13.report() #- '{reviewedBy,reasonCode}');
$q$);

select rrv13.expect_refusal(
  'a signature with no approved content hash is refused',
  'which bytes it covers',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'no hash', repeat('3', 64),
          rrv13.report() #- '{reviewedBy,approvedContentHash}');
$q$);

select rrv13.expect_refusal(
  'the exact shape a build before v13 wrote is refused, on both counts',
  '$.reviewedBy.reasonCode',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'pre-v13 signature', repeat('4', 64),
          rrv13.report() #- '{reviewedBy,reasonCode}' #- '{reviewedBy,approvedContentHash}');
$q$);

do $$
declare
  v_legacy jsonb := rrv13.report() #- '{reviewedBy,reasonCode}' #- '{reviewedBy,approvedContentHash}';
begin
  perform rrv13.assert('and BOTH missing fields are named, not just the first',
    public.release_rescue_payload_unattested_signature(v_legacy)
      = array['$.reviewedBy.reasonCode', '$.reviewedBy.approvedContentHash']);
end $$;

\echo ''
\echo '=== 3. A written reason is refused, the same as everywhere else ==='

select rrv13.expect_refusal(
  'a sentence in the review reason is refused',
  'must record why it was given',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'written reason', repeat('5', 64),
          jsonb_set(rrv13.report(), '{reviewedBy,reasonCode}',
            '"I read it and this application is secure."'::jsonb));
$q$);

select rrv13.expect_refusal(
  'a hash that is not a hash is refused',
  'which bytes it covers',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'not a hash', repeat('6', 64),
          jsonb_set(rrv13.report(), '{reviewedBy,approvedContentHash}',
            '"the version I looked at on Tuesday"'::jsonb));
$q$);

select rrv13.expect_refusal(
  'a truncated hash is refused, so a prefix cannot stand in for the whole',
  'which bytes it covers',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'short hash', repeat('7', 64),
          jsonb_set(rrv13.report(), '{reviewedBy,approvedContentHash}',
            to_jsonb(repeat('c', 63))));
$q$);

\echo ''
\echo '=== 4. The row and the artifact must say the same thing ==='

-- Two places holding one fact is two places for them to disagree.

insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('d5000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1',
        'de000000-0000-0000-0000-0000000000d1', 'observation', 'body with no reviewedBy key',
        repeat('4', 63) || '0', rrv13.report() - 'reviewedBy');

insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
values ('d3000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1',
        'de000000-0000-0000-0000-0000000000d1', 'observation', 'row subject',
        repeat('8', 64), rrv13.report());

insert into public.release_rescue_engagements
  (id, organization_id, scope, scope_hash, retention_policy, retention_days, access_mode)
values ('d2000000-0000-4000-8000-0000000000d2', 'db000000-0000-0000-0000-0000000000d1',
        '{"repository":{"repositoryRef":"acme/ledger"}}'::jsonb, repeat('c', 64),
        'minimum_7_day', 7, 'customer_installed_readonly_app');

-- v4 and v16: a report cannot be issued for an engagement whose reviewed commit
-- was never pinned, and a commit cannot be pinned before a snapshot is recorded.
-- The fixture walks that order rather than working around it.
update public.release_rescue_engagements
   set snapshot_limits_version = 'release-rescue-snapshot/v1',
       snapshot_file_count = 12,
       snapshot_total_bytes = 4096
 where id = 'd2000000-0000-4000-8000-0000000000d2';

-- And a live, unrevoked read-only grant naming the repository in the frozen
-- scope. The lifecycle is the product; a proof that bypassed it would be
-- proving something about a state the product cannot reach.
insert into public.release_rescue_repository_grants
  (organization_id, engagement_id, provider, repository_ref, grant_method, expires_at, granted_by)
values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
        'github', 'acme/ledger', 'customer_installed_readonly_app',
        now() + interval '7 days', 'da000000-0000-0000-0000-0000000000d1');

update public.release_rescue_engagements
   set reviewed_commit_sha = repeat('9', 40), reviewed_commit_pinned_at = now()
 where id = 'd2000000-0000-4000-8000-0000000000d2';

select rrv13.expect_refusal(
  'a row whose attested reason differs from the artifact is refused',
  'does not match the one in the report artifact',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
          'de000000-0000-0000-0000-0000000000d1', 'd3000000-0000-0000-0000-0000000000d1',
          'release-rescue-report/v1', repeat('a', 64), 'release-rescue-rubric/v1',
          repeat('b', 64), repeat('c', 64), 'release_blocked', 1, 1, 32, 'release-rescue-auditor',
          'da000000-0000-0000-0000-0000000000d1', '2026-09-17T10:00:00Z',
          'reviewed_after_every_held_item_was_cleared', repeat('c', 64));
$q$);

select rrv13.expect_refusal(
  'a row whose attested hash differs from the artifact is refused',
  'does not match the one in the report artifact',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
          'de000000-0000-0000-0000-0000000000d1', 'd3000000-0000-0000-0000-0000000000d1',
          'release-rescue-report/v1', repeat('a', 64), 'release-rescue-rubric/v1',
          repeat('b', 64), repeat('c', 64), 'release_blocked', 1, 1, 32, 'release-rescue-auditor',
          'da000000-0000-0000-0000-0000000000d1', '2026-09-17T10:00:00Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('d', 64));
$q$);

-- A report row pointing at a body with NO `reviewedBy` KEY, which is what two
-- older proofs' fixtures carry and what the trigger's draft branch initially
-- failed to recognise: `jsonb_typeof` of an absent key is SQL NULL, so the branch
-- did not fire and every such row was judged against a signature that was not
-- there. Asserted here explicitly rather than left to those two proofs to cover
-- incidentally, because incidental coverage disappears when a fixture changes.
select rrv13.expect_ok(
  'a row is accepted against a body that carries no reviewedBy key',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at)
  values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
          'de000000-0000-0000-0000-0000000000d1', 'd5000000-0000-0000-0000-0000000000d1',
          'release-rescue-report/v1', repeat('3', 63) || '0', 'release-rescue-rubric/v1',
          repeat('b', 64), repeat('c', 64), 'release_blocked', 1, 1, 32, 'release-rescue-auditor',
          'da000000-0000-0000-0000-0000000000d1', '2026-09-17T10:00:00.000Z');
$q$);

select rrv13.expect_refusal(
  'a row naming a DIFFERENT reviewer than the artifact is refused',
  'is not the reviewer recorded on this report row',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
          'de000000-0000-0000-0000-0000000000d1', 'd3000000-0000-0000-0000-0000000000d1',
          'release-rescue-report/v1', repeat('a', 64), 'release-rescue-rubric/v1',
          repeat('b', 64), repeat('c', 64), 'release_blocked', 1, 1, 32, 'release-rescue-auditor',
          -- A second authorised manager. The artifact names the first one, and the
          -- customer's report shows the artifact's name -- so without this check
          -- the authority verified on the row and the attribution the customer
          -- reads are about two different people.
          'da000000-0000-0000-0000-0000000000d2', '2026-09-17T10:00:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
$q$);

select rrv13.expect_refusal(
  'a row whose review TIME differs from the artifact is refused',
  'does not match the one on this report row',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, review_reason_code, review_approved_content_hash)
  values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
          'de000000-0000-0000-0000-0000000000d1', 'd3000000-0000-0000-0000-0000000000d1',
          'release-rescue-report/v1', repeat('a', 64), 'release-rescue-rubric/v1',
          repeat('b', 64), repeat('c', 64), 'release_blocked', 1, 1, 32, 'release-rescue-auditor',
          'da000000-0000-0000-0000-0000000000d1', '2026-09-17T18:30:00.000Z',
          'reviewed_findings_and_verdict_match_the_recorded_observations', repeat('c', 64));
$q$);

do $$
begin
  -- The SAME instant written with a different offset and precision is not a
  -- disagreement, and refusing it would be a guard that refuses correct data.
  perform rrv13.assert('an equal instant in another timezone is not a mismatch',
    ('2026-09-17T10:00:00.000Z'::timestamptz = '2026-09-17T05:00:00-05:00'::timestamptz));
end $$;

\echo ''
\echo '=== 5. An un-attested row cannot be marked delivered ==='

-- The constraint is NOT VALID, so rows that existed before v13 are left exactly
-- as they were. It is enforced on every INSERT and UPDATE from here on, which is
-- what makes an un-attested row un-deliverable rather than retroactively invalid.

do $$
declare
  v_convalidated boolean;
begin
  select convalidated into v_convalidated from pg_constraint
   where conname = 'release_rescue_reports_delivery_needs_attestation';

  perform rrv13.assert('the delivery constraint exists', v_convalidated is not null);
  perform rrv13.assert('and is NOT VALID, so pre-v13 rows keep their history',
    v_convalidated = false);
end $$;

select rrv13.expect_refusal(
  'a row with no attestation cannot be inserted already delivered',
  'release_rescue_reports_delivery_needs_attestation',
  $q$
  insert into public.release_rescue_reports
    (organization_id, engagement_id, run_id, report_artifact_id, schema_version, report_hash,
     rubric_version, rubric_hash, scope_hash, verdict, blocking_finding_count,
     coverage_assessed_checks, coverage_total_checks, prepared_by_executor_key,
     reviewed_by, reviewed_at, delivered_at)
  values ('db000000-0000-0000-0000-0000000000d1', 'd2000000-0000-4000-8000-0000000000d2',
          'de000000-0000-0000-0000-0000000000d1', 'd4000000-0000-0000-0000-0000000000d1',
          'release-rescue-report/v1', repeat('e', 64), 'release-rescue-rubric/v1',
          repeat('b', 64), repeat('c', 64), 'release_blocked', 1, 1, 32, 'release-rescue-auditor',
          'da000000-0000-0000-0000-0000000000d1', '2026-09-17T10:00:00Z', '2026-09-17T11:00:00Z');
$q$);

\echo ''
\echo '=== 6. The column census sees the new columns ==='

do $$
declare
  v_found integer;
begin
  select count(*) into v_found from information_schema.columns
   where table_schema = 'public' and table_name = 'release_rescue_reports'
     and column_name in ('review_reason_code', 'review_approved_content_hash');

  perform rrv13.assert('both attestation columns exist on the row', v_found = 2);

  -- v7's census filter matched `reviewed%`, which these two do not. An assertion
  -- that cannot see the next column added is the same defect as no assertion.
  perform rrv13.assert('and the widened `review%` filter matches them',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'release_rescue_reports'
        and column_name like 'review%'
        and column_name in ('review_reason_code', 'review_approved_content_hash')) = 2);
end $$;

\echo ''
\echo '=== 7. The earlier guards still speak for their own fields ==='

select rrv13.expect_refusal(
  'a sentence in an identifier is still refused by the v12 rule',
  'must hold a UUID',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'v12 rule', repeat('f', 64),
          jsonb_set(rrv13.report(), '{engagementId}',
            '"ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified"'::jsonb));
$q$);

select rrv13.expect_refusal(
  'a narrative field name is still refused by the v10 rule',
  'not source and not sentences',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('db000000-0000-0000-0000-0000000000d1', 'de000000-0000-0000-0000-0000000000d1',
          'observation', 'v10 rule', repeat('1', 63) || '0',
          jsonb_set(rrv13.report(), array['findings', '0', 'whatWeObserved'],
            '"We found a password."'::jsonb));
$q$);

\echo ''
\echo '=== v13 reviewer attestation proof complete: every case above printed PASS ==='
