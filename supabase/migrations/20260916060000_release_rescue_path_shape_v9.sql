-- AI App Release Rescue v9: `path` is a path, not a place to put the source.
--
-- v8 removed the excerpt field and taught this table to refuse it by name. A
-- boundary sweep over the result found the obvious follow-up question, which
-- nobody had asked: with `excerpt` gone, what is left in a finding whose value
-- comes from the customer's repository?
--
-- `locations[].path`. And it had no shape. In TypeScript it was a non-empty
-- string capped at 400 characters, refusing an absolute path, `..` and `://` and
-- nothing else — so four hundred characters of arbitrary text, newlines and all,
-- validated as a path, stored as a path, and rendered under a "Where" heading.
-- A source window pasted there would have travelled the whole way.
--
-- The application now enforces a path GRAMMAR (see `repositoryPathSchema`).
-- This file enforces the part of that grammar a second implementation cannot get
-- wrong: no control characters, and the same 400-character cap.
--
-- The split is deliberate, and it is not drift. A database guard that is
-- STRICTER than the application refuses reports the application considers
-- correct, and an operator holding an undeliverable report has no way to act on
-- that; the tenth audit was about exactly this failure shape. So the row guard
-- takes the subset that is unambiguous in both dialects and dangerous in any
-- dialect. `release-rescue-excerpt-removal.test.ts` asserts the application
-- refuses everything this file refuses, which is the direction that has to hold.

-- --------------------------------------------------------------------------------
-- 1. Recognising a Release Rescue report, and walking all of it
-- --------------------------------------------------------------------------------
--
-- v8 answered two questions with two known shapes: is `schemaVersion` exactly
-- `release-rescue-report/v1`, and does a key sit on a finding or on one of its
-- locations. An audit planted seventeen violations against that and sixteen went
-- in: a nested `locations[0].meta.excerpt`, an `assessments[0].evidence[0]`,
-- a capital `Excerpt`, a trailing space after the schema version, the whole
-- report one level down under a `report` key. Deduplicated, those are fourteen
-- distinct shapes, and `release_rescue_path_shape_v9_proof.sql` inserts all
-- fourteen. Both numbers are stated so neither reads as the other.
--
-- None of them had a production writer, so none of them leaked. But a guard
-- described as structural has to be structural, and "walks two levels of one
-- spelling" is not. These functions recurse, fold key case, and find the schema
-- marker wherever it sits.
--
-- A key census over a real report and the shipped sample confirms the deep walk
-- costs nothing: not one of this contract's 118 key names collides with the
-- forbidden list, case-folded. `release-rescue-excerpt-removal.test.ts` holds
-- that census so a future field cannot quietly collide.

create or replace function public.release_rescue_is_report(p_payload jsonb, p_depth int default 0)
returns boolean
language plpgsql
immutable
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_payload is null or p_depth > 12 then return false; end if;

  if jsonb_typeof(p_payload) = 'object' then
    for v_key, v_value in select * from jsonb_each(p_payload) loop
      if lower(v_key) = 'schemaversion'
         and jsonb_typeof(v_value) = 'string'
         and btrim(lower(v_value #>> '{}')) = 'release-rescue-report/v1' then
        return true;
      end if;
      if public.release_rescue_is_report(v_value, p_depth + 1) then return true; end if;
    end loop;
    return false;
  end if;

  if jsonb_typeof(p_payload) = 'array' then
    for v_value in select * from jsonb_array_elements(p_payload) loop
      if public.release_rescue_is_report(v_value, p_depth + 1) then return true; end if;
    end loop;
  end if;

  return false;
end $$;

comment on function public.release_rescue_is_report(jsonb, int) is
  'True when a payload carries the release-rescue-report/v1 marker at any depth, ignoring key case and surrounding whitespace.';

-- Every forbidden key, at any depth, whatever its capitalisation.
create or replace function public.release_rescue_walk_source_fields(
  p_value jsonb, p_at text, p_depth int)
returns text[]
language plpgsql
immutable
as $$
declare
  v_forbidden text[] := public.release_rescue_forbidden_source_fields();
  v_found text[] := '{}';
  v_key text;
  v_entry jsonb;
  v_index int := 0;
  v_name text;
begin
  if p_value is null or p_depth > 12 then return v_found; end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_entry in select * from jsonb_each(p_value) loop
      foreach v_name in array v_forbidden loop
        if lower(v_key) = lower(v_name) then
          v_found := array_append(v_found, p_at || '.' || v_key);
        end if;
      end loop;
      v_found := v_found || public.release_rescue_walk_source_fields(
        v_entry, p_at || '.' || v_key, p_depth + 1);
    end loop;
    return v_found;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_value) loop
      v_found := v_found || public.release_rescue_walk_source_fields(
        v_entry, format('%s[%s]', p_at, v_index), p_depth + 1);
      v_index := v_index + 1;
    end loop;
  end if;

  return v_found;
end $$;

create or replace function public.release_rescue_payload_source_fields(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
begin
  if p_payload is null then return '{}'; end if;
  if not public.release_rescue_is_report(p_payload) then return '{}'; end if;
  return public.release_rescue_walk_source_fields(p_payload, '$', 0);
end $$;

comment on function public.release_rescue_payload_source_fields(jsonb) is
  'Forbidden source-carrying field names anywhere in a Release Rescue report payload, matched case-insensitively. Mirrored by FORBIDDEN_SOURCE_FIELDS in src/lib/release-rescue-findings.ts.';

-- --------------------------------------------------------------------------------
-- 2. Paths that are carrying something other than a path
-- --------------------------------------------------------------------------------

create or replace function public.release_rescue_walk_shaped_paths(
  p_value jsonb, p_at text, p_depth int)
returns text[]
language plpgsql
immutable
as $$
declare
  v_found text[] := '{}';
  v_key text;
  v_entry jsonb;
  v_index int := 0;
  v_path text;
begin
  if p_value is null or p_depth > 12 then return v_found; end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_entry in select * from jsonb_each(p_value) loop
      if lower(v_key) = 'path' and jsonb_typeof(v_entry) = 'string' then
        v_path := v_entry #>> '{}';

        -- A tab, a newline or a carriage return in a file path means the value
        -- is not a file path. (A literal NUL cannot reach here at all: jsonb
        -- refuses a NUL escape on the way in, one channel closed before this.)
        if v_path ~ '[[:cntrl:]]' then
          v_found := array_append(v_found, p_at || '.' || v_key || ' (control character)');
        end if;

        -- Same cap the contract states. A path longer than this is a payload.
        if length(v_path) > 400 then
          v_found := array_append(
            v_found, format('%s.%s (%s characters)', p_at, v_key, length(v_path)));
        end if;
      end if;

      v_found := v_found || public.release_rescue_walk_shaped_paths(
        v_entry, p_at || '.' || v_key, p_depth + 1);
    end loop;
    return v_found;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_value) loop
      v_found := v_found || public.release_rescue_walk_shaped_paths(
        v_entry, format('%s[%s]', p_at, v_index), p_depth + 1);
      v_index := v_index + 1;
    end loop;
  end if;

  return v_found;
end $$;

create or replace function public.release_rescue_payload_shaped_paths(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
begin
  if p_payload is null then return '{}'; end if;
  if not public.release_rescue_is_report(p_payload) then return '{}'; end if;
  return public.release_rescue_walk_shaped_paths(p_payload, '$', 0);
end $$;

comment on function public.release_rescue_payload_shaped_paths(jsonb) is
  'Finding locations whose path is carrying something other than a path. Subset of the grammar in repositoryPathSchema, src/lib/release-rescue-findings.ts.';

-- --------------------------------------------------------------------------------
-- 3. One guard, replaced rather than a second trigger added
-- --------------------------------------------------------------------------------
--
-- `create or replace` on the v8 function, deliberately. A second trigger would
-- sort by name against the isolation and immutability triggers already on this
-- table, and trigger order here is alphabetical — a hazard this workstream has
-- already been bitten by once. One guard, one firing position, both checks.

create or replace function public.enforce_release_rescue_no_source_excerpt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_fields text[];
  v_paths text[];
begin
  v_fields := public.release_rescue_payload_source_fields(new.payload);

  if cardinality(v_fields) > 0 then
    -- The FIELD NAME is named, never its contents. This message reaches logs,
    -- and the whole point of the change is that customer source does not travel.
    raise exception
      'A Release Rescue finding points at source, it does not carry it. Refused field(s): %',
      array_to_string(v_fields, ', ');
  end if;

  v_paths := public.release_rescue_payload_shaped_paths(new.payload);

  if cardinality(v_paths) > 0 then
    -- Likewise: the LOCATION of the bad value and why it was refused. Never the
    -- value, which is the thing suspected of being source in the first place.
    raise exception
      'A Release Rescue finding location must hold a repository path. Refused: %',
      array_to_string(v_paths, ', ');
  end if;

  return new;
end $$;

-- The trigger itself is unchanged and still points at this function; recreated
-- idempotently so replaying this file alone on a fresh database is sufficient.
drop trigger if exists trg_release_rescue_no_source_excerpt on public.evidence_artifacts;
create trigger trg_release_rescue_no_source_excerpt
  before insert or update on public.evidence_artifacts
  for each row execute function public.enforce_release_rescue_no_source_excerpt();

-- --------------------------------------------------------------------------------
-- 4. Assertions
-- --------------------------------------------------------------------------------

do $$
declare
  v_report jsonb;
begin
  -- It detects a source window pasted into a path.
  v_report := jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'findings', jsonb_build_array(jsonb_build_object(
      'locations', jsonb_build_array(jsonb_build_object(
        'path', 'src/a.ts' || chr(10) || 'const password = "hunter2";',
        'startLine', 1, 'endLine', 3)))));
  if cardinality(public.release_rescue_payload_shaped_paths(v_report)) = 0 then
    raise exception 'The path guard does not detect source pasted into a path';
  end if;

  -- And an overlong one.
  v_report := jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'findings', jsonb_build_array(jsonb_build_object(
      'locations', jsonb_build_array(jsonb_build_object(
        'path', repeat('a', 401), 'startLine', 1, 'endLine', 1)))));
  if cardinality(public.release_rescue_payload_shaped_paths(v_report)) = 0 then
    raise exception 'The path guard does not detect an overlong path';
  end if;

  -- Without firing on the paths this product's own routes actually have.
  v_report := jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'findings', jsonb_build_array(jsonb_build_object(
      'locations', jsonb_build_array(
        jsonb_build_object('path', 'src/app/api/orders/[id]/route.ts', 'startLine', 1, 'endLine', 3),
        jsonb_build_object('path', 'docker-compose.yml', 'startLine', 12, 'endLine', 12),
        jsonb_build_object('path', '.env.example', 'startLine', 1, 'endLine', 1)))));
  if cardinality(public.release_rescue_payload_shaped_paths(v_report)) > 0 then
    raise exception 'The path guard fires on a well-formed report';
  end if;

  -- Another workstream's artifact is none of this guard's business.
  v_report := jsonb_build_object(
    'schemaVersion', 'catalog-evidence-packet/v1',
    'findings', jsonb_build_array(jsonb_build_object(
      'locations', jsonb_build_array(jsonb_build_object('path', repeat('a', 900))))));
  if cardinality(public.release_rescue_payload_shaped_paths(v_report)) > 0 then
    raise exception 'The path guard reached outside Release Rescue';
  end if;

  -- The sixteen shapes an audit planted through the two-level guard.
  if cardinality(public.release_rescue_payload_source_fields(
       jsonb_build_object(
         'schemaVersion', 'release-rescue-report/v1 ',   -- trailing space
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object(
             'path', 'src/a.ts',
             'meta', jsonb_build_object('Excerpt', 'DB_PASSWORD=hunter2')))))))) = 0 then
    raise exception 'The field guard misses a nested, capitalised key under a padded schema version';
  end if;

  if cardinality(public.release_rescue_payload_source_fields(
       jsonb_build_object('report', jsonb_build_object(
         'schemaVersion', 'Release-Rescue-Report/v1',    -- wrong case
         'assessments', jsonb_build_array(jsonb_build_object(
           'evidence', jsonb_build_array(jsonb_build_object(
             'snippet', 'const key = "sk_live_x";')))))))) = 0 then
    raise exception 'The field guard misses a nested report with a differently cased marker';
  end if;

  if cardinality(public.release_rescue_payload_shaped_paths(
       jsonb_build_object(
         'schemaVersion', 'release-rescue-report/v1',
         'findings', jsonb_build_object(                 -- an object, not an array
           'a', jsonb_build_object('locations', jsonb_build_object(
             'b', jsonb_build_object('path', 'src/a.ts' || chr(10) || 'pasted'))))))) = 0 then
    raise exception 'The path guard misses a location reached through objects rather than arrays';
  end if;

  -- And still nothing on a payload that is not a Release Rescue report.
  if cardinality(public.release_rescue_payload_source_fields(
       jsonb_build_object('schemaVersion', 'capability-performance-ledger/v1',
                          'excerpt', 'another contract'))) > 0 then
    raise exception 'The field guard reached outside Release Rescue';
  end if;

  -- The guard stays INVOKER after being replaced. It makes no authority
  -- decision, so it needs no elevation.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'enforce_release_rescue_no_source_excerpt'
       and p.prosecdef
  ) then
    raise exception 'The source-excerpt guard must be SECURITY INVOKER';
  end if;
end $$;
