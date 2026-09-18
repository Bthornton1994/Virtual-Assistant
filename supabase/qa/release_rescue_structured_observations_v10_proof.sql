-- AI App Release Rescue v10: a stored report carries codes, not sentences.
--
-- v8 removed the source excerpt. v9 gave `path` a shape. This proves the third
-- and last class: the sentences an auditor used to write.
--
-- WHY THE FIELDS ARE GONE RATHER THAN GUARDED. Four rounds of measurement asked
-- whether a rule could decide, from a sentence, whether it had quoted a
-- credential. A rule keyed on an assignment construct was walked past by
-- `DB_PASSWORD is set to <value>` — 366 of 366 generated credentials delivered
-- in one measurement — and a rule strict enough to catch that refused 15 of 21
-- sentences an auditor legitimately needs to write. The question has no safe
-- answer, so the owner removed the fields instead of writing a fifth detector.
--
-- WHAT THIS FILE PROVES, and what it does not. It proves that a row carrying a
-- narrative field is refused by name, that no string in a stored report may be
-- multi-line or oversized, and that a report must name the catalog its wording
-- came from. It does NOT prove that a string is or is not prose — nothing here
-- asks that question, because that is the question the measurements retired.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_structured_observations_v10_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv10;
grant usage on schema rrv10 to public;

create or replace function rrv10.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv10.expect_refusal(p_label text, p_expect text, p_sql text)
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

-- A well-formed report, of the shape the application now produces: codes, ids,
-- paths and line numbers. Not one sentence in it.
create or replace function rrv10.report()
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
  ('aa000000-0000-0000-0000-0000000000a1', 'v10.admin@example.test');
insert into public.organizations (id, name, slug) values
  ('ab000000-0000-0000-0000-0000000000a1', 'V10 Co', 'v10-co');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('ab000000-0000-0000-0000-0000000000a1', 'aa000000-0000-0000-0000-0000000000a1', 'client_admin', 'active');
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('ac000000-0000-0000-0000-0000000000a1', 'ab000000-0000-0000-0000-0000000000a1', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('ad000000-0000-0000-0000-0000000000a1', 'ab000000-0000-0000-0000-0000000000a1',
   'ac000000-0000-0000-0000-0000000000a1', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('ae000000-0000-0000-0000-0000000000a1', 'ab000000-0000-0000-0000-0000000000a1',
   'ac000000-0000-0000-0000-0000000000a1', 'ad000000-0000-0000-0000-0000000000a1', 'planned');
update public.workstream_runs set status = 'running' where id = 'ae000000-0000-0000-0000-0000000000a1';

\echo ''
\echo '=== 0. The guard does not brick the report the product actually produces ==='

-- Asserted FIRST, and asserted with a real INSERT rather than by calling the
-- inspector. Three audits in this workstream found a guard that refused
-- everything, including correct reports; a $299 artifact nobody can store is a
-- worse outcome than the one this file exists to prevent.

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
        'observation', 'a well-formed structured report', repeat('0', 64), rrv10.report());

do $$
begin
  perform rrv10.assert('a well-formed structured report is stored',
    (select count(*) from public.evidence_artifacts
      where content_hash = repeat('0', 64)) = 1);
end $$;

\echo ''
\echo '=== 1. Every narrative field is refused, on a finding ==='

-- The CLASS, not an example. Every name the application refuses, crossed with
-- the place an executor would put it.

do $$
declare
  v_name text;
  v_names text[] := public.release_rescue_forbidden_narrative_fields();
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_name in array v_names loop
    v_checked := v_checked + 1;
    begin
      insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
      values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
              'observation', 'narrative on a finding ' || v_checked,
              lpad(v_checked::text, 64, '1'),
              jsonb_set(rrv10.report(), array['findings', '0', v_name],
                        '"DB_PASSWORD is set to hunter2hunter2 in docker-compose.yml."'::jsonb));
      v_accepted := array_append(v_accepted, v_name);
    exception when others then
      null; -- refused, which is the point
    end;
  end loop;

  perform rrv10.assert(
    format('every narrative field on a finding is refused (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv10.assert('the narrative list is not empty, so the loop proves something',
    v_checked >= 25);
end $$;

\echo ''
\echo '=== 2. And on an assessment, a location, an evidence entry and the report ==='

do $$
declare
  v_name text;
  v_names text[] := public.release_rescue_forbidden_narrative_fields();
  v_where text;
  v_wheres text[] := array['assessment', 'location', 'evidence', 'report'];
  v_payload jsonb;
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_where in array v_wheres loop
    foreach v_name in array v_names loop
      v_checked := v_checked + 1;
      v_payload := case v_where
        when 'assessment' then jsonb_set(rrv10.report(), array['assessments', '0', v_name], '"x"'::jsonb)
        when 'location' then jsonb_set(rrv10.report(), array['findings', '0', 'locations', '0', v_name], '"x"'::jsonb)
        when 'evidence' then jsonb_set(rrv10.report(), array['findings', '0', 'evidence', '0', v_name], '"x"'::jsonb)
        else rrv10.report() || jsonb_build_object(v_name, 'x')
      end;
      begin
        insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
        values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
                'observation', 'narrative ' || v_where || ' ' || v_checked,
                lpad(v_checked::text, 64, '2'), v_payload);
        v_accepted := array_append(v_accepted, v_where || '.' || v_name);
      exception when others then
        null;
      end;
    end loop;
  end loop;

  perform rrv10.assert(
    format('every narrative field is refused at every level (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv10.assert('all four levels were exercised', v_checked >= 100);
end $$;

\echo ''
\echo '=== 3. The refusal names the field and never the value ==='

-- The message reaches logs, traces and error reporting. A refusal that quotes
-- the credential it refused has moved the credential rather than stopped it.

do $$
declare v_message text;
begin
  begin
    insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
    values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
            'observation', 'naming', repeat('3', 64),
            jsonb_set(rrv10.report(), array['findings', '0', 'whatWeObserved'],
                      '"DB_PASSWORD is set to VICTIM-SECRET-STRING-abc123"'::jsonb));
    raise exception using errcode = 'RR001', message = 'EXPECTED-REFUSAL-NOT-RAISED';
  exception when others then
    if sqlstate = 'RR001' then raise; end if;
    v_message := sqlerrm;
  end;

  perform rrv10.assert('the refusal names the field', position('whatWeObserved' in v_message) > 0);
  perform rrv10.assert('the refusal does not carry the value',
    position('VICTIM-SECRET-STRING-abc123' in v_message) = 0);
  perform rrv10.assert('the refusal says what the contract is now',
    position('codes' in lower(v_message)) > 0);
end $$;

\echo ''
\echo '=== 4. `limitations` is refused; `limitationCodes` is not ==='

select rrv10.expect_refusal(
  'a limitations array of sentences is refused',
  'limitations',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
          'observation', 'limitations', repeat('4', 64),
          rrv10.report() || jsonb_build_object('limitations',
            jsonb_build_array('The customer excluded /www. AWS_SECRET_ACCESS_KEY=abc123def456.')));
$q$);

do $$
begin
  perform rrv10.assert('limitationCodes passes, because a code cannot carry a value',
    cardinality(public.release_rescue_payload_source_fields(rrv10.report())) = 0);
end $$;

\echo ''
\echo '=== 5. A hold reason survives, because it is this codebase own sentence ==='

-- The other direction, and the one a too-wide list would break. `reason` on an
-- unresolved hold is one of two fixed sentences this codebase owns, stored so
-- the customer can be told why their report is held. Refusing it would refuse
-- every held report, which is exactly the denial-of-service shape three audits
-- in this workstream have already found.

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
        'observation', 'a held report', repeat('5', 64),
        rrv10.report() || jsonb_build_object('unresolvedHolds', jsonb_build_array(
          jsonb_build_object(
            'path', '$.reviewedBy.displayName',
            'classification', 'credential_evidence',
            'originalHash', repeat('b', 64),
            'reason', 'Credential material was found here and removed. An authorised operator must confirm the finding can be delivered without it.'))));

do $$
begin
  perform rrv10.assert('a held report is stored, hold reason and all',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('5', 64)) = 1);
end $$;

\echo ''
\echo '=== 6. No string in a stored report is multi-line or oversized ==='

-- v9 bounded `path`, because `path` was then the only field whose value came
-- from the repository. With the narrative gone, every string is a code, an id,
-- an enum, a hash, a timestamp, a path or a name — none of them multi-line.

do $$
declare
  v_carrier text;
  v_carriers text[] := array[
    chr(10), chr(13), chr(9), chr(11), chr(12), chr(1), chr(27), chr(127),
    chr(13) || chr(10)
  ];
  v_field text;
  v_fields text[] := array['findingId', 'observationCode', 'remediationCode'];
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_field in array v_fields loop
    foreach v_carrier in array v_carriers loop
      v_checked := v_checked + 1;
      begin
        insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
        values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
                'observation', 'multi-line ' || v_checked, lpad(v_checked::text, 64, '6'),
                jsonb_set(rrv10.report(), array['findings', '0', v_field],
                          to_jsonb('f-1' || v_carrier || 'const password = "hunter2";')));
        v_accepted := array_append(v_accepted, v_field || ' via carrier ' || v_checked);
      exception when others then
        null;
      end;
    end loop;
  end loop;

  perform rrv10.assert(
    format('every control-character carrier in every code field is refused (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv10.assert('the carrier cross-product is not empty', v_checked >= 24);
end $$;

select rrv10.expect_refusal(
  'a string over the contract cap is refused wherever it sits',
  'over 400 characters',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
          'observation', 'oversized', repeat('7', 64),
          -- `rubricVersion` rather than `findingId`: v12 checks identifier
          -- fields BEFORE the string-shape rule, so an oversized findingId is
          -- now refused as a bad identifier and this case would be measuring
          -- the wrong guard. This field is neither a code nor an identifier, so
          -- the length rule is the only one that can speak.
          jsonb_set(rrv10.report(), array['rubricVersion'], to_jsonb(repeat('x', 401))));
$q$);

do $$
begin
  perform rrv10.assert('a 400-character value is accepted, so the bound is the stated one',
    cardinality(public.release_rescue_payload_string_shape(
      jsonb_set(rrv10.report(), array['rubricVersion'], to_jsonb(repeat('x', 400))))) = 0);
end $$;

\echo ''
\echo '=== 7. A stored report must name the catalog its wording came from ==='

-- The artifact no longer contains the words a customer read; it contains codes
-- that resolve to them. That makes the catalog identity part of what the report
-- MEANS, so a row that does not carry it cannot be re-rendered faithfully.

select rrv10.expect_refusal(
  'a report with no catalog hash is refused',
  'observation catalog',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
          'observation', 'no catalog', repeat('8', 64),
          rrv10.report() - 'observationCatalogHash');
$q$);

select rrv10.expect_refusal(
  'a report whose catalog hash is not a hash is refused',
  'observation catalog',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
          'observation', 'bad catalog hash', repeat('9', 64),
          jsonb_set(rrv10.report(), array['observationCatalogHash'], '"not-a-hash"'::jsonb));
$q$);

-- v11 note: this case is now refused by the CODE-SHAPE check rather than by the
-- provenance check, because v11's check runs first in the shared guard and an
-- absent code is not code-shaped. Both refuse it; the expectation is relaxed to
-- the part of the message both share, rather than pinned to whichever currently
-- wins the race. The two checks above it still exercise provenance directly.
select rrv10.expect_refusal(
  'a finding with no observation code is refused',
  'Release Rescue',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
          'observation', 'no observation code', repeat('a', 64),
          jsonb_set(rrv10.report(), array['findings', '0'],
                    (rrv10.report()->'findings'->0) - 'observationCode'));
$q$);

\echo ''
\echo '=== 8. An update cannot do what an insert could not ==='

-- Measured rather than assumed, and the measurement changed what this section
-- claims.
--
-- The guard is BEFORE INSERT OR UPDATE, and the obvious assertion is that an
-- update planting a narrative field is refused by it. It is not. Triggers on
-- this table fire in alphabetical order, and `trg_evidence_artifacts_immutable`
-- sorts before `trg_release_rescue_no_source_excerpt`, so the row is refused as
-- immutable before the narrative guard is ever consulted.
--
-- That is a stronger outcome, not a weaker one, and it is recorded as what it
-- is rather than claimed as a win for this guard. Both facts are asserted: the
-- update is refused, and the narrative guard would independently have refused
-- it had it been reached.

do $$
declare v_message text;
begin
  begin
    update public.evidence_artifacts
       set payload = jsonb_set(payload, array['findings', '0', 'whatWeObserved'], '"a sentence"'::jsonb)
     where content_hash = repeat('0', 64);
    raise exception using errcode = 'RR001', message = 'EXPECTED-REFUSAL-NOT-RAISED';
  exception when others then
    if sqlstate = 'RR001' then raise; end if;
    v_message := sqlerrm;
  end;

  perform rrv10.assert('an update planting narrative is refused', v_message is not null);
  perform rrv10.assert('it is refused as immutable, before the narrative guard is reached',
    position('immutable' in lower(v_message)) > 0);
end $$;

do $$
begin
  -- And the narrative guard is not relying on that. Asserted on the inspector
  -- directly, so the claim does not depend on trigger ordering staying put.
  perform rrv10.assert('the narrative guard would independently refuse the same payload',
    cardinality(public.release_rescue_payload_source_fields(
      jsonb_set(rrv10.report(), array['findings', '0', 'whatWeObserved'], '"a sentence"'::jsonb))) > 0);
  perform rrv10.assert('and the guard is bound to UPDATE as well as INSERT',
    (select count(*) from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relname = 'evidence_artifacts'
       and t.tgname = 'trg_release_rescue_no_source_excerpt'
       and (t.tgtype & 16) > 0) = 1);
end $$;

\echo '=== 9. The guard reaches nothing outside Release Rescue ==='

-- Every other artifact in this table belongs to another workstream with its own
-- shape, and this migration has no business narrowing those. A guard that
-- silently broke the catalog-evidence or Gauntlet paths would be a regression
-- shipped inside a fix.

insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
values ('ab000000-0000-0000-0000-0000000000a1', 'ae000000-0000-0000-0000-0000000000a1',
        'observation', 'another workstream', repeat('b', 64),
        jsonb_build_object(
          'schemaVersion', 'catalog-evidence/v1',
          'description', 'A perfectly ordinary description that this guard must not touch.',
          'notes', repeat('n', 5000),
          'excerpt', 'and even this, because the field list is scoped to Release Rescue'));

do $$
begin
  perform rrv10.assert('another workstream artifact is stored untouched',
    (select count(*) from public.evidence_artifacts where content_hash = repeat('b', 64)) = 1);
  perform rrv10.assert('and the inspectors agree it is out of scope',
    cardinality(public.release_rescue_payload_source_fields(
      jsonb_build_object('schemaVersion', 'catalog-evidence/v1', 'excerpt', 'x'))) = 0
    and cardinality(public.release_rescue_payload_string_shape(
      jsonb_build_object('schemaVersion', 'catalog-evidence/v1', 'x', repeat('n', 5000)))) = 0);
end $$;

\echo ''
\echo '=== 10. Recursion is bounded, and the guard needs no elevation ==='

do $$
declare v_deep jsonb := jsonb_build_object('whatWeObserved', 'x');
begin
  for i in 1..40 loop v_deep := jsonb_build_object('n', v_deep); end loop;
  v_deep := v_deep || jsonb_build_object('schemaVersion', 'release-rescue-report/v1');
  perform rrv10.assert('a 40-level payload returns rather than recursing forever',
    public.release_rescue_payload_source_fields(v_deep) is not null
    and public.release_rescue_payload_string_shape(v_deep) is not null);
end $$;

do $$
declare v_secdef boolean; v_name text;
begin
  foreach v_name in array array[
    'enforce_release_rescue_no_source_excerpt',
    'release_rescue_payload_source_fields',
    'release_rescue_payload_string_shape',
    'release_rescue_payload_missing_provenance',
    'release_rescue_forbidden_narrative_fields'
  ] loop
    select prosecdef into v_secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    perform rrv10.assert(format('%s is SECURITY INVOKER', v_name), v_secdef = false);
  end loop;
end $$;

\echo ''
\echo '=== v10 structured-observation proof complete: every case above printed PASS ==='
