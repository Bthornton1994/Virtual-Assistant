-- AI App Release Rescue v8: no customer source reaches a stored artifact.
--
-- The owner decision this proves: a finding POINTS AT source and never carries
-- it. Ten audits attacked the credential detector that existed to make a copied
-- excerpt safe to ship. This proof is about the field being gone, which is a
-- property a detector cannot be wrong about.
--
-- NEVER apply this file to a real Supabase project.

\set ON_ERROR_STOP on
\pset pager off
set client_min_messages = notice;

select 'release_rescue_excerpt_removal_v8_proof_not_applied_to_supabase' as proof_marker;

create schema if not exists rrv8;
grant usage on schema rrv8 to public;

create or replace function rrv8.assert(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not p_condition then
    raise exception using errcode = 'RR004', message = 'ASSERTION FAILED: ' || p_label;
  end if;
  raise notice 'PASS state    | %', p_label;
end $$;

create or replace function rrv8.expect_refusal(p_label text, p_expect text, p_sql text)
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

-- Fixtures ------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('8a000000-0000-0000-0000-00000000aa01', 'v8.admin@example.test');
insert into public.organizations (id, name, slug) values
  ('8b000000-0000-0000-0000-00000000aa01', 'V8 Co', 'v8-co');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('8b000000-0000-0000-0000-00000000aa01', '8a000000-0000-0000-0000-00000000aa01', 'client_admin', 'active');
insert into public.workstreams (id, organization_id, name, objective, sla) values
  ('8c000000-0000-0000-0000-00000000aa01', '8b000000-0000-0000-0000-00000000aa01', 'W', 'O', '5d');
insert into public.delegation_specs (id, organization_id, workstream_id, status, objective, action_class) values
  ('8d000000-0000-0000-0000-00000000aa01', '8b000000-0000-0000-0000-00000000aa01',
   '8c000000-0000-0000-0000-00000000aa01', 'active', 'O', 'prepare_only');
insert into public.workstream_runs (id, organization_id, workstream_id, delegation_spec_id, status) values
  ('8e000000-0000-0000-0000-00000000aa01', '8b000000-0000-0000-0000-00000000aa01',
   '8c000000-0000-0000-0000-00000000aa01', '8d000000-0000-0000-0000-00000000aa01', 'planned');
update public.workstream_runs set status = 'running' where id = '8e000000-0000-0000-0000-00000000aa01';

\echo ''
\echo '=== 1. A report payload carrying source is refused, by field name ==='

-- Every forbidden name, looped. A guard written against one spelling is what the
-- previous ten rounds kept producing.
do $$
declare
  v_key text;
  v_checked integer := 0;
  v_accepted text[] := '{}';
begin
  foreach v_key in array public.release_rescue_forbidden_source_fields() loop
    v_checked := v_checked + 1;
    begin
      insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
      values ('8b000000-0000-0000-0000-00000000aa01', '8e000000-0000-0000-0000-00000000aa01',
              'observation', 'planted ' || v_key, repeat('1', 64),
              jsonb_build_object(
                'schemaVersion', 'release-rescue-report/v1',
                'findings', jsonb_build_array(jsonb_build_object(
                  'locations', jsonb_build_array(
                    jsonb_build_object('path', 'src/a.ts', v_key, 'DB_PASSWORD=hunter2'))))));
      v_accepted := array_append(v_accepted, v_key);
    exception when others then
      null; -- refused, which is the point
    end;
  end loop;

  perform rrv8.assert(
    format('every forbidden source field is refused in a location (%s checked)', v_checked),
    cardinality(v_accepted) = 0);
  perform rrv8.assert('the list is not empty, so the loop above proves something', v_checked >= 20);
end $$;

select rrv8.expect_refusal(
  'an excerpt on the finding itself is refused too',
  'points at source',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('8b000000-0000-0000-0000-00000000aa01', '8e000000-0000-0000-0000-00000000aa01',
          'observation', 'finding-level', repeat('2', 64),
          jsonb_build_object(
            'schemaVersion', 'release-rescue-report/v1',
            'findings', jsonb_build_array(jsonb_build_object(
              'findingId', 'f-001', 'excerpt', 'const key = "sk_live_x";'))));
$q$);

select rrv8.expect_refusal(
  'the refusal names the field, never its contents',
  'excerpt',
  $q$
  insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
  values ('8b000000-0000-0000-0000-00000000aa01', '8e000000-0000-0000-0000-00000000aa01',
          'observation', 'naming', repeat('3', 64),
          jsonb_build_object(
            'schemaVersion', 'release-rescue-report/v1',
            'findings', jsonb_build_array(jsonb_build_object(
              'locations', jsonb_build_array(jsonb_build_object(
                'path', 'src/a.ts', 'excerpt', 'VICTIM-SECRET-STRING-abc123'))))));
$q$);

do $$
declare v_message text;
begin
  begin
    insert into public.evidence_artifacts (organization_id, run_id, kind, summary, content_hash, payload)
    values ('8b000000-0000-0000-0000-00000000aa01', '8e000000-0000-0000-0000-00000000aa01',
            'observation', 'naming2', repeat('4', 64),
            jsonb_build_object(
              'schemaVersion', 'release-rescue-report/v1',
              'findings', jsonb_build_array(jsonb_build_object(
                'locations', jsonb_build_array(jsonb_build_object(
                  'path', 'src/a.ts', 'excerpt', 'VICTIM-SECRET-STRING-abc123'))))));
    v_message := '(accepted)';
  exception when others then
    v_message := sqlerrm;
  end;
  perform rrv8.assert('and the refusal text carries none of the planted content',
                      position('VICTIM-SECRET-STRING-abc123' in v_message) = 0);
end $$;

\echo ''
\echo '=== 2. A well-formed report is accepted, and stays useful ==='

do $$
declare v_payload jsonb;
begin
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values ('8f000000-0000-0000-0000-00000000aa01', '8b000000-0000-0000-0000-00000000aa01',
          '8e000000-0000-0000-0000-00000000aa01', 'observation', 'clean report', repeat('5', 64),
          jsonb_build_object(
            'schemaVersion', 'release-rescue-report/v1',
            'reviewedCommitSha', repeat('a', 40),
            'findings', jsonb_build_array(jsonb_build_object(
              'findingId', 'f-001',
              'rubricCheckId', 'authz.object_level_authorization',
              'severity', 'high',
              'whatWeObserved', 'The order lookup returns records the caller does not own.',
              'recommendation', 'Scope the query by the authenticated organization.',
              'locations', jsonb_build_array(jsonb_build_object(
                'path', 'src/app/api/orders/route.ts', 'startLine', 18, 'endLine', 27))))));

  select payload into v_payload from public.evidence_artifacts
   where id = '8f000000-0000-0000-0000-00000000aa01';

  perform rrv8.assert('a report with path and lines is accepted', v_payload is not null);

  -- The diagnostic value the customer is paying for survives.
  perform rrv8.assert('the file path survives',
    v_payload#>>'{findings,0,locations,0,path}' = 'src/app/api/orders/route.ts');
  perform rrv8.assert('the start line survives',
    (v_payload#>>'{findings,0,locations,0,startLine}')::int = 18);
  perform rrv8.assert('the end line survives',
    (v_payload#>>'{findings,0,locations,0,endLine}')::int = 27);
  perform rrv8.assert('the check identifier survives',
    v_payload#>>'{findings,0,rubricCheckId}' = 'authz.object_level_authorization');
  perform rrv8.assert('the severity survives', v_payload#>>'{findings,0,severity}' = 'high');
  perform rrv8.assert('the observation survives',
    length(v_payload#>>'{findings,0,whatWeObserved}') > 20);
  perform rrv8.assert('the remediation guidance survives',
    length(v_payload#>>'{findings,0,recommendation}') > 20);
end $$;

\echo ''
\echo '=== 3. The guard is scoped to Release Rescue, and to UPDATE as well ==='

do $$
begin
  -- Another workstream's artifact keeps its own shape. This migration has no
  -- business narrowing contracts it does not own.
  insert into public.evidence_artifacts (id, organization_id, run_id, kind, summary, content_hash, payload)
  values ('8f000000-0000-0000-0000-00000000aa02', '8b000000-0000-0000-0000-00000000aa01',
          '8e000000-0000-0000-0000-00000000aa01', 'observation', 'other workstream', repeat('6', 64),
          jsonb_build_object('schemaVersion', 'capability-performance-ledger/v1',
                             'excerpt', 'this belongs to another contract'));
  perform rrv8.assert('another workstream''s artifact is untouched by this guard', true);
end $$;

-- An UPDATE is refused, and the refusal here comes from the PRE-EXISTING
-- immutability trigger, which sorts ahead of this one and rejects any edit to a
-- stored artifact at all. That is a stronger answer than the excerpt guard would
-- have given, and pinning the excerpt guard's wording would make this case pass
-- for the wrong reason. So this asserts the outcome and records which control
-- answered; the guard's own UPDATE arm is proven below with the immutability
-- rule out of the way.
do $$
declare v_message text; v_payload jsonb;
begin
  begin
    update public.evidence_artifacts
       set payload = jsonb_set(payload, '{findings,0,locations,0,excerpt}', '"DB_PASSWORD=hunter2"')
     where id = '8f000000-0000-0000-0000-00000000aa01';
    v_message := '(accepted)';
  exception when others then
    v_message := sqlerrm;
  end;

  select payload into v_payload from public.evidence_artifacts
   where id = '8f000000-0000-0000-0000-00000000aa01';

  perform rrv8.assert(
    format('an UPDATE cannot add an excerpt to an accepted report (%s)', left(v_message, 48)),
    v_message <> '(accepted)');
  perform rrv8.assert('and the stored payload still carries no excerpt',
    v_payload#>'{findings,0,locations,0}' ? 'excerpt' = false);
end $$;

-- The guard's own UPDATE arm, exercised directly on the function rather than
-- through a table whose immutability rule answers first.
do $$
begin
  perform rrv8.assert(
    'the guard detects an excerpt added by an update, on its own',
    cardinality(public.release_rescue_payload_source_fields(
      jsonb_set(
        jsonb_build_object(
          'schemaVersion', 'release-rescue-report/v1',
          'findings', jsonb_build_array(jsonb_build_object(
            'locations', jsonb_build_array(jsonb_build_object('path', 'src/a.ts'))))),
        '{findings,0,locations,0,excerpt}', '"DB_PASSWORD=hunter2"'))) > 0);
end $$;

\echo ''
\echo '=== 4. The guard needs no elevation, and is not one ==='

do $$
declare v_secdef boolean;
begin
  select prosecdef into v_secdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_release_rescue_no_source_excerpt';
  perform rrv8.assert('the source-excerpt guard is SECURITY INVOKER', v_secdef = false);
end $$;

\echo ''
\echo '=== v8 excerpt removal proof complete: every case above printed PASS ==='
