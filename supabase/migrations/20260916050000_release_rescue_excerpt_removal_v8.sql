-- AI App Release Rescue v8: a finding points at source, it never carries it.
--
-- Owner decision, taken after ten independent audits: raw customer source
-- excerpts are removed from every persisted artifact and every customer-facing
-- surface. A finding keeps `path`, `startLine` and `endLine`; the customer reads
-- the source in their own checkout, where it already is.
--
-- Why this is a DATABASE change and not only a TypeScript one. The previous ten
-- rounds all turned on a credential detector trying to make a copied excerpt safe
-- to ship, and the tenth reported that detector both leaking credentials and
-- permanently bricking correct reports in the same commit. Removing the field in
-- application code alone would leave the property depending on every future
-- writer remembering. The report body is an `evidence_artifacts` row, and other
-- writers can reach that table, so the refusal belongs where the row is written.
--
-- This is the structural half of the argument. Redaction stays as defence in
-- depth for transient diagnostics; it is no longer what proves a deliverable is
-- safe. What proves it is that there is no field to put source in.

-- --------------------------------------------------------------------------------
-- 1. The forbidden field names, in one place
-- --------------------------------------------------------------------------------
--
-- Kept deliberately wider than `excerpt` alone. `excerpt` is the field that
-- existed; the rest are what an executor reaches for next when the obvious name
-- is refused. `release-rescue-excerpt-removal.test.ts` asserts this list matches
-- `FORBIDDEN_SOURCE_FIELDS` in `src/lib/release-rescue-findings.ts`, so the two
-- cannot drift apart silently.

create or replace function public.release_rescue_forbidden_source_fields()
returns text[]
language sql
immutable
as $$
  select array[
    'excerpt', 'excerpts', 'snippet', 'snippets', 'code', 'codeSnippet',
    'source', 'sourceText', 'sourceWindow', 'window', 'context', 'contextLines',
    'lines', 'content', 'body', 'raw', 'rawSource', 'text', 'span', 'spans',
    'match', 'matchedText'
  ]
$$;

comment on function public.release_rescue_forbidden_source_fields() is
  'Field names that would carry customer source into a stored Release Rescue report. Mirrored by FORBIDDEN_SOURCE_FIELDS in src/lib/release-rescue-findings.ts.';

-- --------------------------------------------------------------------------------
-- 2. The refusal
-- --------------------------------------------------------------------------------
--
-- Applies only to a Release Rescue report payload. Every other artifact in this
-- table belongs to another workstream with its own shape, and this migration has
-- no business narrowing those.

create or replace function public.release_rescue_payload_source_fields(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  v_forbidden text[] := public.release_rescue_forbidden_source_fields();
  v_found text[] := '{}';
  v_finding jsonb;
  v_location jsonb;
  v_key text;
begin
  if p_payload is null then return v_found; end if;
  if coalesce(p_payload->>'schemaVersion', '') <> 'release-rescue-report/v1' then
    return v_found;
  end if;

  for v_finding in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'findings') = 'array'
           then p_payload->'findings' else '[]'::jsonb end)
  loop
    -- The finding object itself.
    foreach v_key in array v_forbidden loop
      if v_finding ? v_key then
        v_found := array_append(v_found, 'findings[].' || v_key);
      end if;
    end loop;

    -- And each of its locations, which is where the excerpt used to live.
    for v_location in
      select * from jsonb_array_elements(
        case when jsonb_typeof(v_finding->'locations') = 'array'
             then v_finding->'locations' else '[]'::jsonb end)
    loop
      foreach v_key in array v_forbidden loop
        if v_location ? v_key then
          v_found := array_append(v_found, 'findings[].locations[].' || v_key);
        end if;
      end loop;
    end loop;
  end loop;

  return v_found;
end $$;

create or replace function public.enforce_release_rescue_no_source_excerpt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_found text[];
begin
  v_found := public.release_rescue_payload_source_fields(new.payload);

  if cardinality(v_found) > 0 then
    -- The FIELD NAME is named, never its contents. This message reaches logs,
    -- and the whole point of the change is that customer source does not travel.
    raise exception
      'A Release Rescue finding points at source, it does not carry it. Refused field(s): %',
      array_to_string(v_found, ', ');
  end if;

  return new;
end $$;

drop trigger if exists trg_release_rescue_no_source_excerpt on public.evidence_artifacts;
create trigger trg_release_rescue_no_source_excerpt
  before insert or update on public.evidence_artifacts
  for each row execute function public.enforce_release_rescue_no_source_excerpt();

-- --------------------------------------------------------------------------------
-- 3. Assertions, so a later edit cannot quietly undo this
-- --------------------------------------------------------------------------------

do $$
declare
  v_missing text[] := '{}';
  v_required text[] := array['excerpt', 'snippet', 'sourceText', 'sourceWindow', 'rawSource'];
  v_key text;
begin
  -- The list still contains the names that matter.
  foreach v_key in array v_required loop
    if not (v_key = any (public.release_rescue_forbidden_source_fields())) then
      v_missing := array_append(v_missing, v_key);
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    raise exception 'The forbidden source-field list lost: %', array_to_string(v_missing, ', ');
  end if;

  -- The guard is INVOKER. It makes no authority decision, so it needs no
  -- elevation, and a definer here would be one more function reading a tenant
  -- table with the owner's reach for no reason.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'enforce_release_rescue_no_source_excerpt'
       and p.prosecdef
  ) then
    raise exception 'The source-excerpt guard must be SECURITY INVOKER';
  end if;

  -- And it actually refuses. A guard nobody has watched fail is not evidence;
  -- ten audits produced that sentence more than once.
  if cardinality(public.release_rescue_payload_source_fields(
       jsonb_build_object(
         'schemaVersion', 'release-rescue-report/v1',
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object(
             'path', 'src/a.ts', 'excerpt', 'DB_PASSWORD=hunter2'))))))) = 0 then
    raise exception 'The source-excerpt guard does not detect a planted excerpt';
  end if;

  -- Without firing on a well-formed report.
  if cardinality(public.release_rescue_payload_source_fields(
       jsonb_build_object(
         'schemaVersion', 'release-rescue-report/v1',
         'findings', jsonb_build_array(jsonb_build_object(
           'locations', jsonb_build_array(jsonb_build_object(
             'path', 'src/a.ts', 'startLine', 1, 'endLine', 3))))))) > 0 then
    raise exception 'The source-excerpt guard fires on a well-formed report';
  end if;
end $$;
