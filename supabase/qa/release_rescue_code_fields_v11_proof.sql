-- AI App Release Rescue v11: a code field holds a code, proven live.
--
-- An independent audit stored this payload against the v10 guard, on the real
-- migration chain, and it was ACCEPTED:
--
--   observationCode: "DB_PASSWORD is set to Xk92mQvn7Lz on line 14 of docker-compose.yml"
--   uncertaintyCode: "The admin console password is Xk92mQvn7Lz and the DB user is svc_ledger."
--   rationaleCode:   "Their Redis auth string is r3d15-Pr0d-Xk92mQvn7Lz, we reused it to test."
--   limitationCodes: ["This review is a penetration test and certifies the application is
--                      secure and vulnerability free."]
--
-- v10 refused narrative field NAMES and said nothing about the VALUES of the
-- code fields that replaced them. Its own comment asserted the gap did not
-- exist: "there is no field to put it in — section 1". Section 1 is a name list.
--
-- This matters more than an ordinary gap because `REPORT_FIELD_POLICY`
-- classifies all six code fields as `generated`, which EXEMPTS them from the
-- prohibited-claim guard and from the credential check, on the stated
-- justification that they are closed enums. The last line of that payload is the
-- exact sentence the offer is forbidden to say, stored and renderable.
--
-- Every case below is the audit's payload, refused.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_code_fields_v11_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv11;
grant usage on schema rrv11 to public;

create or replace function rrv11.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv11.expect_refusal(p_label text, p_expect text, p_sql text)
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

create or replace function rrv11.report()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'limitationCodes', jsonb_build_array('read_only_no_running_system'),
    'assessments', jsonb_build_array(jsonb_build_object(
      'checkId', 'secrets.no_secrets_in_version_control',
      'outcome', 'fail',
      'rationaleCode', 'control_missing_on_a_reachable_path',
      'evidence', jsonb_build_array(jsonb_build_object(
        'kind', 'configuration_reference', 'path', 'docker-compose.yml',
        'startLine', 4, 'endLine', 6)))),
    'findings', jsonb_build_array(jsonb_build_object(
      'findingId', 'f-001',
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
  ('ba000000-0000-0000-0000-0000000000b1', 'v11.admin@example.test');
insert into public.organizations (id, name, slug) values
  ('bb000000-0000-0000-0000-0000000000b1', 'V11 Co', 'v11-co');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('bb000000-0000-0000-0000-0000000000b1', 'ba000000-0000-0000-0000-0000000000b1', 'client_admin', 'active');
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('bc000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-0000000000b1', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('bd000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-0000000000b1',
   'bc000000-0000-0000-0000-0000000000b1', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('be000000-0000-0000-0000-0000000000b1', 'bb000000-0000-0000-0000-0000000000b1',
   'bc000000-0000-0000-0000-0000000000b1', 'bd000000-0000-0000-0000-0000000000b1', 'planned');
update public.workstream_runs set status = 'running' where id = 'be000000-0000-0000-0000-0000000000b1';

\echo ''
\echo '=== 0. The report the product produces is still storable ==='

-- Asserted FIRST, with a real INSERT. Three audits in this workstream have found
-- a guard that refused everything; a $299 artifact nobody can store is a worse
-- outcome than the one this guard exists to prevent.

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
        'observation', 'a well-formed structured report', repeat('0', 64), rrv11.report());

do $$
begin
  perform rrv11.assert('a well-formed structured report is stored',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('0', 64)) = 1);
  perform rrv11.assert('a null uncertaintyCode is correct for a confirmed finding and passes',
    cardinality(public.release_rescue_payload_bad_codes(rrv11.report())) = 0);
end $$;

\echo ''
\echo '=== 1. The exact payload the audit stored is now refused, field by field ==='

select rrv11.expect_refusal(
  'a sentence in observationCode is refused',
  'must hold a catalog code',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'audit payload 1', repeat('1', 64),
          jsonb_set(rrv11.report(), array['findings', '0', 'observationCode'],
            '"DB_PASSWORD is set to Xk92mQvn7Lz on line 14 of docker-compose.yml"'::jsonb));
$q$);

select rrv11.expect_refusal(
  'a sentence in uncertaintyCode is refused',
  'must hold a catalog code',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'audit payload 2', repeat('2', 64),
          jsonb_set(rrv11.report(), array['findings', '0', 'uncertaintyCode'],
            '"The admin console password is Xk92mQvn7Lz and the DB user is svc_ledger."'::jsonb));
$q$);

select rrv11.expect_refusal(
  'a sentence in rationaleCode is refused',
  'must hold a catalog code',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'audit payload 3', repeat('3', 64),
          jsonb_set(rrv11.report(), array['assessments', '0', 'rationaleCode'],
            '"Their Redis auth string is r3d15-Pr0d-Xk92mQvn7Lz, we reused it to test."'::jsonb));
$q$);

select rrv11.expect_refusal(
  'the prohibited claim in limitationCodes is refused',
  'must hold a catalog code',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'audit payload 4', repeat('4', 64),
          jsonb_set(rrv11.report(), array['limitationCodes'],
            '["This review is a penetration test and certifies the application is secure and vulnerability free."]'::jsonb));
$q$);

select rrv11.expect_refusal(
  'a sentence in clearedSecretHolds[].reasonCode is refused',
  'must hold a catalog code',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'audit payload 5', repeat('5', 64),
          rrv11.report() || jsonb_build_object('clearedSecretHolds', jsonb_build_array(
            jsonb_build_object('path', '$.x', 'clearedContentHash', repeat('b', 64),
                               'clearedBy', 'ops-1', 'clearedAt', '2026-09-16T00:00:00Z',
                               'reasonCode', 'I looked at it and the value was Xk92mQvn7Lz.'))));
$q$);

\echo ''
\echo '=== 2. The refusal names the field and never the value ==='

do $$
declare v_message text;
begin
  begin
    insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
    values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
            'observation', 'naming', repeat('6', 64),
            jsonb_set(rrv11.report(), array['findings', '0', 'uncertaintyCode'],
              '"The password is VICTIM-SECRET-STRING-abc123 and it is not rotated."'::jsonb));
    raise exception using errcode = 'RR001', message = 'EXPECTED-REFUSAL-NOT-RAISED';
  exception when others then
    if sqlstate = 'RR001' then raise; end if;
    v_message := sqlerrm;
  end;

  perform rrv11.assert('the refusal names the field',
    position('$.findings[0].uncertaintyCode' in v_message) > 0);
  perform rrv11.assert('the refusal does not carry the value',
    position('VICTIM-SECRET-STRING-abc123' in v_message) = 0);
end $$;

\echo ''
\echo '=== 3. The class, not the examples: no code field accepts anything with a space ==='

-- A sentence needs a space. The five code fields crossed with a corpus of
-- carriers, driven as a product rather than a hand-picked list.

do $$
declare
  v_value text;
  v_values text[] := array[
    'DB_PASSWORD is set to Xk92mQvn7Lz',
    'The admin password is Xk92mQvn7Lz.',
    'this review is a penetration test',
    'a b',
    'Uppercase_Code',
    'code-with-hyphen',
    'code/with/slash',
    'code:with:colon',
    'code with trailing space ',
    ' leading',
    '',
    'x'
  ];
  v_field text;
  v_fields text[] := array['observationCode', 'remediationCode', 'uncertaintyCode'];
  v_checked integer := 0;
  v_accepted text[] := '{}';
  v_payload jsonb;
begin
  foreach v_field in array v_fields loop
    foreach v_value in array v_values loop
      v_checked := v_checked + 1;
      v_payload := jsonb_set(rrv11.report(), array['findings', '0', v_field], to_jsonb(v_value));
      -- `x` is code-shaped and must be ACCEPTED by this guard: shape is not
      -- membership, and the database deliberately does not hold the catalog.
      if v_value = 'x' then
        if cardinality(public.release_rescue_payload_bad_codes(v_payload)) <> 0 then
          v_accepted := array_append(v_accepted, 'WRONGLY REFUSED code-shaped: ' || v_field);
        end if;
      elsif cardinality(public.release_rescue_payload_bad_codes(v_payload)) = 0 then
        v_accepted := array_append(v_accepted, v_field || ' <- ' || left(v_value, 24));
      end if;
    end loop;
  end loop;

  perform rrv11.assert(
    format('no code field accepts a non-code, and code-shaped values still pass (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv11.assert('the cross-product is not empty, so the loop proves something', v_checked >= 30);
end $$;

do $$
declare
  v_value text;
  v_values text[] := array[
    'This review is a penetration test.',
    'a b',
    'Uppercase',
    'has-hyphen'
  ];
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_value in array v_values loop
    v_checked := v_checked + 1;
    if cardinality(public.release_rescue_payload_bad_codes(
         jsonb_set(rrv11.report(), array['limitationCodes'], jsonb_build_array(to_jsonb(v_value))))) = 0 then
      v_accepted := array_append(v_accepted, left(v_value, 24));
    end if;
    v_checked := v_checked + 1;
    if cardinality(public.release_rescue_payload_bad_codes(
         jsonb_set(rrv11.report(), array['assessments', '0', 'rationaleCode'], to_jsonb(v_value)))) = 0 then
      v_accepted := array_append(v_accepted, 'rationaleCode <- ' || left(v_value, 24));
    end if;
  end loop;

  perform rrv11.assert(
    format('limitationCodes and rationaleCode refuse every non-code (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
end $$;

\echo ''
\echo '=== 4. A missing code is refused, not silently accepted ==='

do $$
declare v_field text;
begin
  foreach v_field in array array['observationCode', 'remediationCode'] loop
    perform rrv11.assert(format('a finding with no %s is refused', v_field),
      cardinality(public.release_rescue_payload_bad_codes(
        jsonb_set(rrv11.report(), array['findings', '0'],
                  (rrv11.report()->'findings'->0) - v_field))) > 0);
  end loop;

  perform rrv11.assert('an assessment with no rationaleCode is refused',
    cardinality(public.release_rescue_payload_bad_codes(
      jsonb_set(rrv11.report(), array['assessments', '0'],
                (rrv11.report()->'assessments'->0) - 'rationaleCode'))) > 0);

  perform rrv11.assert('a non-string in limitationCodes is refused',
    cardinality(public.release_rescue_payload_bad_codes(
      jsonb_set(rrv11.report(), array['limitationCodes'], '[42]'::jsonb))) > 0);
end $$;

\echo ''
\echo '=== 5. The v10 checks still hold alongside it ==='

-- One guard, five checks. Adding the fifth must not have displaced the others;
-- this workstream has shipped a regression inside a fix six times.

select rrv11.expect_refusal(
  'v10: a narrative field name is still refused',
  'not source and not sentences',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'v10 narrative', repeat('7', 64),
          jsonb_set(rrv11.report(), array['findings', '0', 'whatWeObserved'], '"a sentence"'::jsonb));
$q$);

select rrv11.expect_refusal(
  'v10: catalog provenance is still required',
  'observation catalog',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'v10 provenance', repeat('8', 64),
          rrv11.report() - 'observationCatalogHash');
$q$);

select rrv11.expect_refusal(
  'v9: a path carrying source is still refused',
  'repository path',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
          'observation', 'v9 path', repeat('9', 64),
          jsonb_set(rrv11.report(), array['findings', '0', 'locations', '0', 'path'],
                    to_jsonb('src/a.ts' || chr(10) || 'const p = "hunter2";')));
$q$);

\echo ''
\echo '=== 6. The guard reaches nothing outside Release Rescue ==='

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('bb000000-0000-0000-0000-0000000000b1', 'be000000-0000-0000-0000-0000000000b1',
        'observation', 'another workstream', repeat('b', 64),
        jsonb_build_object(
          'schemaVersion', 'catalog-evidence/v1',
          'findings', jsonb_build_array(jsonb_build_object(
            'observationCode', 'A whole sentence, in a workstream this guard does not own.'))));

do $$
begin
  perform rrv11.assert('another workstream artifact is stored untouched',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('b', 64)) = 1);
  perform rrv11.assert('and the inspector agrees it is out of scope',
    cardinality(public.release_rescue_payload_bad_codes(
      jsonb_build_object('schemaVersion', 'catalog-evidence/v1',
                         'limitationCodes', jsonb_build_array('a whole sentence')))) = 0);
end $$;

\echo ''
\echo '=== 7. The guard needs no elevation, and is not one ==='

do $$
declare v_secdef boolean; v_name text;
begin
  foreach v_name in array array[
    'release_rescue_is_code_shaped',
    'release_rescue_payload_bad_codes',
    'enforce_release_rescue_no_source_excerpt'
  ] loop
    select prosecdef into v_secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    perform rrv11.assert(format('%s is SECURITY INVOKER', v_name), v_secdef = false);
  end loop;
end $$;

\echo ''
\echo '=== v11 code-field proof complete: every case above printed PASS ==='
