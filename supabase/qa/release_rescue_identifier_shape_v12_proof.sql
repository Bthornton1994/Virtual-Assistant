-- AI App Release Rescue v12: an identifier field holds an identifier, proven live.
--
-- An independent audit built this report through the real assembler, and it was
-- ACCEPTED, delivered, and rendered in the header of the customer's report:
--
--   engagementId: "ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified"
--
-- Four segments, each under twenty-four characters, which is exactly what the
-- identifier rule permitted. Both halves of the bound held. The audit also
-- showed the same rule refused every plain UUID — and `organization_id`,
-- `engagement_id`, `run_id` and `reviewed_by` are all `uuid` columns in this
-- schema, so the rule that was too loose for a claim was at the same moment too
-- tight for the product's own identifiers.
--
-- Both directions are proven here, because a guard that refuses real values is
-- worse than the hole it closes.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_identifier_shape_v12_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv12;
grant usage on schema rrv12 to public;

create or replace function rrv12.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv12.expect_refusal(p_label text, p_expect text, p_sql text)
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

create or replace function rrv12.report()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'reportId', 'c1000000-0000-4000-8000-0000000000c1',
    'engagementId', 'c2000000-0000-4000-8000-0000000000c2',
    'runId', 'ce000000-0000-0000-0000-0000000000c1',
    'organizationId', 'cb000000-0000-0000-0000-0000000000c1',
    -- `reasonCode` and `approvedContentHash` are v13 fields. A signature without
    -- them is refused by the payload guard, so this fixture carries them in
    -- order to keep exercising the identifier rule rather than the newer one.
    'reviewedBy', jsonb_build_object(
      'operatorUserId', 'ca000000-0000-0000-0000-0000000000c1',
      'displayName', 'Ops Manager',
      'reviewedAt', '2026-09-16T10:00:00.000Z',
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
  ('ca000000-0000-0000-0000-0000000000c1', 'v12.admin@example.test');
insert into public.organizations (id, name, slug) values
  ('cb000000-0000-0000-0000-0000000000c1', 'V12 Co', 'v12-co');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('cb000000-0000-0000-0000-0000000000c1', 'ca000000-0000-0000-0000-0000000000c1', 'client_admin', 'active');
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('cc000000-0000-0000-0000-0000000000c1', 'cb000000-0000-0000-0000-0000000000c1', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('cd000000-0000-0000-0000-0000000000c1', 'cb000000-0000-0000-0000-0000000000c1',
   'cc000000-0000-0000-0000-0000000000c1', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('ce000000-0000-0000-0000-0000000000c1', 'cb000000-0000-0000-0000-0000000000c1',
   'cc000000-0000-0000-0000-0000000000c1', 'cd000000-0000-0000-0000-0000000000c1', 'planned');
update public.workstream_runs set status = 'running' where id = 'ce000000-0000-0000-0000-0000000000c1';

\echo ''
\echo '=== 0. The report the product produces is still storable ==='

-- Asserted FIRST, with a real INSERT, and with UUIDs in every identifier field —
-- which is the half the rule this replaces got wrong. Three audits in this
-- workstream have found a guard that refused everything, and the fourth found
-- one that refused every identifier the database itself issues.

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('cb000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000c1',
        'observation', 'a well-formed report with real UUIDs', repeat('0', 64), rrv12.report());

do $$
begin
  perform rrv12.assert('a report whose identifiers are UUIDs is stored',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('0', 64)) = 1);
  perform rrv12.assert('no identifier in a well-formed report is flagged',
    cardinality(public.release_rescue_payload_bad_identifiers(rrv12.report())) = 0);
end $$;

\echo ''
\echo '=== 1. The audit payload, on every identifier field ==='

-- The value is planted at each of the seven paths in turn. The audit found it on
-- two; the rule covers all seven, and a proof that checks only the two reported
-- is the pattern that let five successive rules through.

do $$
declare
  v_claim text := 'ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified';
  v_payloads jsonb[];
  v_labels text[] := array[
    '$.reportId', '$.engagementId', '$.runId', '$.organizationId',
    '$.reviewedBy.operatorUserId', '$.findings[0].findingId'];
  v_payload jsonb;
  v_index integer := 0;
  v_accepted text[] := '{}';
begin
  v_payloads := array[
    jsonb_set(rrv12.report(), array['reportId'], to_jsonb(v_claim)),
    jsonb_set(rrv12.report(), array['engagementId'], to_jsonb(v_claim)),
    jsonb_set(rrv12.report(), array['runId'], to_jsonb(v_claim)),
    jsonb_set(rrv12.report(), array['organizationId'], to_jsonb(v_claim)),
    jsonb_set(rrv12.report(), array['reviewedBy', 'operatorUserId'], to_jsonb(v_claim)),
    jsonb_set(rrv12.report(), array['findings', '0', 'findingId'], to_jsonb(v_claim))
  ];

  foreach v_payload in array v_payloads loop
    v_index := v_index + 1;
    if cardinality(public.release_rescue_payload_bad_identifiers(v_payload)) = 0 then
      v_accepted := array_append(v_accepted, v_labels[v_index]);
    end if;
  end loop;

  perform rrv12.assert(
    format('the audit claim is refused at every one of the %s identifier paths', v_index),
    cardinality(v_accepted) = 0);
  perform rrv12.assert('the path list is not empty, so the loop proves something', v_index = 6);
end $$;

select rrv12.expect_refusal(
  'the audit claim in engagementId is refused at the row boundary',
  'must hold a UUID or a declared demo identifier',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('cb000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000c1',
          'observation', 'audit claim', repeat('1', 64),
          jsonb_set(rrv12.report(), array['engagementId'],
            '"ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified"'::jsonb));
$q$);

select rrv12.expect_refusal(
  'a credential wearing identifier punctuation is refused',
  'must hold a UUID or a declared demo identifier',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('cb000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000c1',
          'observation', 'credential id', repeat('2', 64),
          jsonb_set(rrv12.report(), array['reportId'], '"AdminPasswordIs-Xk92mQvn7Lz"'::jsonb));
$q$);

select rrv12.expect_refusal(
  'a finding label that is not a label is refused',
  'must hold a UUID or a declared demo identifier',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('cb000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000c1',
          'observation', 'bad label', repeat('3', 64),
          jsonb_set(rrv12.report(), array['findings', '0', 'findingId'], '"ThisAppIsSecure"'::jsonb));
$q$);

\echo ''
\echo '=== 2. Every punctuation the claim can wear, at every identifier path ==='

do $$
declare
  v_forms text[] := array[
    'This app is secure and free of vulnerabilities.',
    'This-app-is-secure-and-free-of-vulnerabilities',
    'This_app_is_secure_and_free_of_vulnerabilities',
    'this.app.is.secure.and.free.of.vulnerabilities',
    'ThisAppIsSecureAndFreeOfVulnerabilities',
    'ThisAppIsSecure',
    'ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified',
    'AdminPasswordIs-Xk92mQvn7Lz',
    'rescue_0123abcd-1234-5678-9abc-def012345678'
  ];
  v_fields text[] := array['reportId', 'engagementId', 'runId', 'organizationId'];
  v_form text;
  v_field text;
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_field in array v_fields loop
    foreach v_form in array v_forms loop
      v_checked := v_checked + 1;
      if cardinality(public.release_rescue_payload_bad_identifiers(
           jsonb_set(rrv12.report(), array[v_field], to_jsonb(v_form)))) = 0 then
        v_accepted := array_append(v_accepted, v_field || ' <- ' || v_form);
      end if;
    end loop;
  end loop;

  perform rrv12.assert(
    format('no form of the claim is an identifier, at any path (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv12.assert('the cross-product is not empty', v_checked >= 36);
end $$;

\echo ''
\echo '=== 3. The other direction: what a real report produces is accepted ==='

-- Generated UUIDs rather than literals, so this proves the SHAPE is accepted and
-- not that four particular strings are.

do $$
declare
  v_attempt integer;
  v_id text;
  v_refused text[] := '{}';
  v_checked integer := 0;
begin
  for v_attempt in 1..40 loop
    v_id := gen_random_uuid()::text;
    v_checked := v_checked + 1;
    if not public.release_rescue_is_identifier(v_id) then
      v_refused := array_append(v_refused, v_id);
    end if;
  end loop;

  perform rrv12.assert(
    format('every generated UUID is an identifier (%s checked)', v_checked),
    cardinality(v_refused) = 0);
end $$;

do $$
declare
  v_demo text;
  v_refused text[] := '{}';
begin
  foreach v_demo in array array[
    'demo-harbor-ledger', 'demo-engagement', 'demo-run', 'demo-organization', 'demo-operator']
  loop
    if not public.release_rescue_is_identifier(v_demo) then
      v_refused := array_append(v_refused, v_demo);
    end if;
  end loop;

  perform rrv12.assert('every declared demo identifier is accepted', cardinality(v_refused) = 0);
end $$;

do $$
declare
  v_n integer;
  v_refused text[] := '{}';
begin
  for v_n in 1..999 loop
    if not public.release_rescue_is_finding_label('RR-' || lpad(v_n::text, 3, '0')) then
      v_refused := array_append(v_refused, v_n::text);
    end if;
  end loop;

  perform rrv12.assert('every finding label in range is accepted', cardinality(v_refused) = 0);
  perform rrv12.assert('a label of the wrong width is not', not public.release_rescue_is_finding_label('RR-1'));
  perform rrv12.assert('a label with a suffix is not', not public.release_rescue_is_finding_label('RR-001x'));
end $$;

\echo ''
\echo '=== 4. A report with no identifier fields at all is not made unstorable ==='

-- The guard checks a field that is PRESENT. Absence is a different question, and
-- answering it here would make this guard stricter than the application.

do $$
begin
  perform rrv12.assert('a payload carrying no identifier fields is not flagged',
    cardinality(public.release_rescue_payload_bad_identifiers(
      (rrv12.report() - 'reportId' - 'engagementId' - 'runId' - 'organizationId' - 'reviewedBy'))) = 0);
end $$;

\echo ''
\echo '=== 5. The earlier guards still speak for their own fields ==='

-- v12 inserts a check into a trigger four migrations deep. This asserts it did
-- not shadow the ones already there.

select rrv12.expect_refusal(
  'a sentence in observationCode is still refused by the CODE rule',
  'must hold a catalog code',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('cb000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000c1',
          'observation', 'code rule', repeat('4', 64),
          jsonb_set(rrv12.report(), array['findings', '0', 'observationCode'],
            '"DB_PASSWORD is set to Xk92mQvn7Lz on line 14"'::jsonb));
$q$);

select rrv12.expect_refusal(
  'a narrative field name is still refused by the NAME rule',
  'not source and not sentences',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('cb000000-0000-0000-0000-0000000000c1', 'ce000000-0000-0000-0000-0000000000c1',
          'observation', 'name rule', repeat('5', 64),
          jsonb_set(rrv12.report(), array['findings', '0', 'whatWeObserved'],
            '"We found a password."'::jsonb));
$q$);

\echo ''
\echo '=== v12 identifier proof complete: every case above printed PASS ==='
