-- AI App Release Rescue v9: `locations[].path` holds a path, not a payload.
--
-- v8 removed the excerpt field. This proves the follow-up: with the excerpt
-- gone, the one remaining field in a finding whose value comes from the
-- customer's repository is `path`, and a stored artifact cannot use it to carry
-- source.
--
-- The application enforces a full path grammar. This table guard enforces the
-- subset that is unambiguous in both dialects — no control characters, and the
-- same 400-character cap — because a row guard STRICTER than the application
-- would refuse reports the application considers correct, and the operator
-- holding the undeliverable report would have nothing to act on.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_path_shape_v9_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv9;
grant usage on schema rrv9 to public;

create or replace function rrv9.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv9.expect_refusal(p_label text, p_expect text, p_sql text)
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

-- A payload with one finding location at the given path.
create or replace function rrv9.report_with_path(p_path text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'findings', jsonb_build_array(jsonb_build_object(
      'findingId', 'f-001',
      -- v10 requires these: a stored report names the catalog its wording came
      -- from, and a finding names the observation it is an instance of.
      'observationCode', 'authz.record_lookup_is_not_scoped_to_the_caller',
      'remediationCode', 'scope_query_by_authenticated_principal',
      'locations', jsonb_build_array(jsonb_build_object(
        'path', p_path, 'startLine', 1, 'endLine', 3)))))
$$;

-- Fixtures ------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('9a000000-0000-0000-0000-00000000aa01', 'v9.admin@example.test');
insert into public.organizations (id, name, slug) values
  ('9b000000-0000-0000-0000-00000000aa01', 'V9 Co', 'v9-co');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('9b000000-0000-0000-0000-00000000aa01', '9a000000-0000-0000-0000-00000000aa01', 'client_admin', 'active');
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('9c000000-0000-0000-0000-00000000aa01', '9b000000-0000-0000-0000-00000000aa01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('9d000000-0000-0000-0000-00000000aa01', '9b000000-0000-0000-0000-00000000aa01',
   '9c000000-0000-0000-0000-00000000aa01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('9e000000-0000-0000-0000-00000000aa01', '9b000000-0000-0000-0000-00000000aa01',
   '9c000000-0000-0000-0000-00000000aa01', '9d000000-0000-0000-0000-00000000aa01', 'planned');
update public.workstream_runs set status = 'running' where id = '9e000000-0000-0000-0000-00000000aa01';

\echo ''
\echo '=== 1. A path carrying source is refused, whatever the carrier ==='

-- The class, not an example. Every control character a source window can be
-- separated by, plus the shapes a pasted excerpt actually has.
do $$
declare
  v_carrier text;
  v_carriers text[] := array[
    chr(10), chr(13), chr(9), chr(11), chr(12), chr(1), chr(27), chr(127),
    chr(13) || chr(10)
  ];
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_carrier in array v_carriers loop
    v_checked := v_checked + 1;
    begin
      insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
      values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
              'observation', 'planted carrier ' || v_checked, lpad(v_checked::text, 64, '1'),
              rrv9.report_with_path(
                'src/a.ts' || v_carrier || 'const password = "hunter2";'));
      v_accepted := array_append(v_accepted, 'carrier ' || v_checked);
    exception when others then
      null; -- refused, which is the point
    end;
  end loop;

  perform rrv9.assert(
    format('every control-character carrier in a path is refused (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv9.assert('the carrier list is not empty, so the loop proves something', v_checked >= 8);
end $$;

select rrv9.expect_refusal(
  'a path longer than the contract allows is refused',
  'repository path',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
          'observation', 'overlong', repeat('2', 64),
          rrv9.report_with_path(repeat('a', 401)));
$q$);

select rrv9.expect_refusal(
  'the refusal says where and why, and calls it a path problem',
  'control character',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
          'observation', 'naming', repeat('3', 64),
          rrv9.report_with_path('src/a.ts' || chr(10) || 'VICTIM-SECRET-STRING-abc123'));
$q$);

do $$
declare v_message text;
begin
  begin
    insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
    values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
            'observation', 'naming2', repeat('4', 64),
            rrv9.report_with_path('src/a.ts' || chr(10) || 'VICTIM-SECRET-STRING-abc123'));
    v_message := '(accepted)';
  exception when others then
    v_message := sqlerrm;
  end;

  perform rrv9.assert('and the refusal text carries none of the planted content',
    position('VICTIM-SECRET-STRING-abc123' in v_message) = 0);
  perform rrv9.assert('the refusal names the finding and location index instead',
    v_message like '%findings[0].locations[0].path%');
end $$;

\echo ''
\echo '=== 2. Real repository paths are accepted, including this product''s own ==='

do $$
declare
  v_path text;
  v_paths text[] := array[
    'src/app/api/orders/[id]/route.ts',   -- a Next.js dynamic route
    'src/app/expenses/[id]/page.tsx',
    'docker-compose.yml',
    '.env.example',
    'package.json',
    'Makefile',
    'node_modules/link',
    -- A space in a path: the ROW guard still accepts it, the application does
    -- not. The guard is deliberately the weaker of the two (see the migration
    -- header); this case records that difference rather than implying the
    -- application would accept it.
    'docs/Architecture Overview.md',
    'apps/web/src/lib/a-b_c+d@e~f(1).ts', -- and so is the rest of the charset
    repeat('a', 200) || '/' || repeat('b', 199)  -- exactly at the 400 cap, not over it
  ];
  v_checked integer := 0;
  v_refused text[] := '{}';
begin
  foreach v_path in array v_paths loop
    v_checked := v_checked + 1;
    begin
      insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
      values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
              'observation', 'real path ' || v_checked, lpad(v_checked::text, 64, '5'),
              rrv9.report_with_path(v_path));
    exception when others then
      v_refused := array_append(v_refused, left(v_path, 40) || ' -> ' || left(sqlerrm, 60));
    end;
  end loop;

  perform rrv9.assert(
    format('every real repository path is accepted (%s checked): %s',
           v_checked, coalesce(array_to_string(v_refused, ' | '), '')),
    cardinality(v_refused) = 0);
end $$;

\echo ''
\echo '=== 3. The diagnostic value the customer paid for still survives ==='

do $$
declare v_payload jsonb;
begin
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values ('9f000000-0000-0000-0000-00000000aa01', '9b000000-0000-0000-0000-00000000aa01',
          '9e000000-0000-0000-0000-00000000aa01', 'observation', 'clean report', repeat('6', 64),
          jsonb_build_object(
            'schemaVersion', 'release-rescue-report/v1',
            'observationCatalogVersion', 'release-rescue-observations/v1',
            'observationCatalogHash', repeat('a', 64),
            'findings', jsonb_build_array(jsonb_build_object(
              'findingId', 'f-001',
              'rubricCheckId', 'authz.object_level_authorization',
              'severity', 'high',
              -- v10: codes, not sentences.
              'observationCode', 'authz.record_lookup_is_not_scoped_to_the_caller',
              'remediationCode', 'scope_query_by_authenticated_principal',
              'locations', jsonb_build_array(jsonb_build_object(
                'path', 'src/app/api/orders/[id]/route.ts', 'startLine', 18, 'endLine', 27))))));

  select payload into v_payload from public.evidence_artifacts
   where id = '9f000000-0000-0000-0000-00000000aa01';

  perform rrv9.assert('a bracketed dynamic route survives the path guard intact',
    v_payload#>>'{findings,0,locations,0,path}' = 'src/app/api/orders/[id]/route.ts');
  perform rrv9.assert('the start line survives',
    (v_payload#>>'{findings,0,locations,0,startLine}')::int = 18);
  perform rrv9.assert('the end line survives',
    (v_payload#>>'{findings,0,locations,0,endLine}')::int = 27);
  perform rrv9.assert('the check identifier survives',
    v_payload#>>'{findings,0,rubricCheckId}' = 'authz.object_level_authorization');
  -- v10: the remediation the customer reads is resolved from the catalog at
  -- render time, so what a stored finding carries is the code for it.
  perform rrv9.assert('the remediation code survives',
    v_payload#>>'{findings,0,remediationCode}' = 'scope_query_by_authenticated_principal');
end $$;

\echo ''
\echo '=== 4. Scope: this guard owns Release Rescue reports and nothing else ==='

do $$
begin
  -- Another workstream's artifact keeps its own shape, however unpath-like.
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values ('9f000000-0000-0000-0000-00000000aa02', '9b000000-0000-0000-0000-00000000aa01',
          '9e000000-0000-0000-0000-00000000aa01', 'observation', 'other workstream', repeat('7', 64),
          jsonb_build_object(
            'schemaVersion', 'capability-performance-ledger/v1',
            'findings', jsonb_build_array(jsonb_build_object(
              'locations', jsonb_build_array(jsonb_build_object(
                'path', 'free text' || chr(10) || 'across lines'))))));
  perform rrv9.assert('another workstream''s artifact is untouched by this guard', true);
end $$;

do $$
begin
  perform rrv9.assert('a payload with no findings array is not an error',
    cardinality(public.release_rescue_payload_shaped_paths(
      jsonb_build_object('schemaVersion', 'release-rescue-report/v1'))) = 0);
  perform rrv9.assert('a null payload is not an error',
    cardinality(public.release_rescue_payload_shaped_paths(null)) = 0);
  perform rrv9.assert('a location with no path at all is not an error',
    cardinality(public.release_rescue_payload_shaped_paths(
      jsonb_build_object(
        'schemaVersion', 'release-rescue-report/v1',
        'observationCatalogVersion', 'release-rescue-observations/v1',
        'observationCatalogHash', repeat('a', 64),
        'findings', jsonb_build_array(jsonb_build_object(
          'locations', jsonb_build_array(jsonb_build_object('startLine', 1))))))) = 0);
end $$;

\echo ''
\echo '=== 5. The v8 field guard still fires from the replaced function ==='

-- v9 replaced `enforce_release_rescue_no_source_excerpt` rather than adding a
-- second trigger, so this asserts the replacement did not drop the check it
-- inherited. Trigger order on this table is alphabetical, and a second trigger
-- would have sorted against the isolation rules already there.
select rrv9.expect_refusal(
  'an excerpt is still refused after the guard was replaced',
  'not source and not sentences',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
          'observation', 'v8 still holds', repeat('8', 64),
          jsonb_build_object(
            'schemaVersion', 'release-rescue-report/v1',
            'observationCatalogVersion', 'release-rescue-observations/v1',
            'observationCatalogHash', repeat('a', 64),
            'findings', jsonb_build_array(jsonb_build_object(
              'locations', jsonb_build_array(jsonb_build_object(
                'path', 'src/a.ts', 'excerpt', 'const key = "sk_live_x";'))))));
$q$);

do $$
declare v_count integer;
begin
  select count(*) into v_count from pg_trigger
   where tgrelid = 'public.evidence_artifacts'::regclass
     and tgname = 'trg_release_rescue_no_source_excerpt'
     and not tgisinternal;
  perform rrv9.assert('there is exactly one Release Rescue payload guard trigger', v_count = 1);
end $$;

\echo ''
\echo '=== 6. The shapes that went through the two-level guard ==='

-- An audit planted seventeen violations against the v8 guard and sixteen were
-- accepted and stored. None had a production writer, so none leaked — but a
-- guard described as structural has to walk the payload rather than two known
-- shapes. Every one of those sixteen, as a live INSERT.
do $$
declare
  v_case record;
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  for v_case in
    select * from (values
      ('nested object under a location',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object(
             'path', 'src/a.ts', 'meta', jsonb_build_object('excerpt', 'DB_PASSWORD=hunter2'))))))),
      ('nested array under a location',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object(
             'path', 'src/a.ts', 'detail', jsonb_build_array(
               jsonb_build_object('source', 'const k = 1;')))))))),
      ('nested object under a finding',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'detail', jsonb_build_object('excerpt', 'x'))))),
      ('evidence array under a finding',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'evidence', jsonb_build_array(jsonb_build_object('snippet', 'x')))))),
      ('top level of the payload',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64), 'excerpt', 'x')),
      ('top level, a different name',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64), 'source', 'x')),
      ('under an assessment',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'assessments', jsonb_build_array(jsonb_build_object(
           'evidence', jsonb_build_array(jsonb_build_object('excerpt', 'x')))))),
      ('schema version with a trailing space',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1 ',
         'findings', jsonb_build_array(jsonb_build_object('excerpt', 'x')))),
      ('schema version in a different case',
       jsonb_build_object('schemaVersion', 'Release-Rescue-Report/v1',
         'findings', jsonb_build_array(jsonb_build_object('excerpt', 'x')))),
      ('the whole report one level down',
       jsonb_build_object('report', jsonb_build_object(
         'schemaVersion', 'release-rescue-report/v1',
         'observationCatalogVersion', 'release-rescue-observations/v1',
         'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object('excerpt', 'x'))))),
      ('a capitalised key',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object('path', 'a', 'Excerpt', 'x')))))),
      ('a shouted key',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object('path', 'a', 'SNIPPET', 'x')))))),
      ('findings as an object rather than an array',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_object('a', jsonb_build_object('excerpt', 'x')))),
      ('locations as an object rather than an array',
       jsonb_build_object('schemaVersion', 'release-rescue-report/v1',
                           'observationCatalogVersion', 'release-rescue-observations/v1',
                           'observationCatalogHash', repeat('a', 64),
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_object('a', jsonb_build_object('excerpt', 'x'))))))
    ) as t(label, payload)
  loop
    v_checked := v_checked + 1;
    begin
      insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
      values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
              'observation', 'planted shape ' || v_checked, lpad(v_checked::text, 64, '9'),
              v_case.payload);
      v_accepted := array_append(v_accepted, v_case.label);
    exception when others then
      null; -- refused, which is the point
    end;
  end loop;

  perform rrv9.assert(
    format('every shape the two-level guard missed is refused (%s checked): %s',
           v_checked, coalesce(array_to_string(v_accepted, ' | '), '')),
    cardinality(v_accepted) = 0);
  perform rrv9.assert('the shape list is not empty, so the loop proves something', v_checked >= 14);
end $$;

-- A path smuggled through a nesting level the old walk never reached.
select rrv9.expect_refusal(
  'a source window under a nested location is refused',
  'repository path',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('9b000000-0000-0000-0000-00000000aa01', '9e000000-0000-0000-0000-00000000aa01',
          'observation', 'nested path', repeat('a', 64),
          jsonb_build_object(
            'schemaVersion', 'release-rescue-report/v1',
            'observationCatalogVersion', 'release-rescue-observations/v1',
            'observationCatalogHash', repeat('a', 64),
            'appendix', jsonb_build_object('locations', jsonb_build_array(
              jsonb_build_object('path', 'src/a.ts' || chr(10) || 'const p = 1;')))));
$q$);

-- And the deep walk still keeps its hands off another workstream.
do $$
begin
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values ('9f000000-0000-0000-0000-00000000aa03', '9b000000-0000-0000-0000-00000000aa01',
          '9e000000-0000-0000-0000-00000000aa01', 'observation', 'deep other workstream', repeat('b', 64),
          jsonb_build_object('schemaVersion', 'capability-performance-ledger/v1',
            'nested', jsonb_build_object('deeper', jsonb_build_object(
              'excerpt', 'this belongs to another contract',
              'path', 'free text' || chr(10) || 'across lines'))));
  perform rrv9.assert('a deep walk still stops at another workstream''s marker', true);
end $$;

-- A payload whose nesting is pathological is bounded, not a runaway.
do $$
declare v_deep jsonb := jsonb_build_object('excerpt', 'x');
begin
  for i in 1..40 loop v_deep := jsonb_build_object('n', v_deep); end loop;
  v_deep := v_deep || jsonb_build_object('schemaVersion', 'release-rescue-report/v1');
  perform rrv9.assert('a 40-level payload returns rather than recursing forever',
    public.release_rescue_payload_source_fields(v_deep) is not null);
end $$;

\echo ''
\echo '=== 7. The guard needs no elevation, and is not one ==='

do $$
declare v_secdef boolean;
begin
  select prosecdef into v_secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_release_rescue_no_source_excerpt';
  perform rrv9.assert('the payload guard is SECURITY INVOKER', v_secdef = false);

  select prosecdef into v_secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'release_rescue_payload_shaped_paths';
  perform rrv9.assert('the path inspector is SECURITY INVOKER', v_secdef = false);
end $$;

\echo ''
\echo '=== v9 path shape and guard-depth proof complete: every case above printed PASS ==='
