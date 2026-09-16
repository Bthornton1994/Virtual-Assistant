-- AI App Release Rescue v10: a report carries codes, not sentences.
--
-- v8 removed the source excerpt and taught this table to refuse it by name. v9
-- gave `path` a shape, because with the excerpt gone `path` was the widest field
-- whose value came from the customer's repository.
--
-- A thirteenth audit asked the question neither of those answered. With the
-- excerpt gone and the path bounded, what still carries arbitrary text into a
-- paid artifact? The answer was every sentence an auditor writes: a finding's
-- `title`, `whatWeObserved`, `whyItMatters`, `recommendation` and
-- `residualUncertainty`, an assessment's `rationale`, the customer's own
-- application and workflow descriptions, the report's `limitations`, and a
-- reviewer's clearance note.
--
-- Four rounds of measurement established that no rule over such a sentence can
-- decide whether it has quoted a credential. A rule keyed on an assignment
-- construct was walked straight past by `DB_PASSWORD is set to <value>` — 366 of
-- 366 generated credentials delivered in one measurement, 30 of 116 in another —
-- and a rule strict enough to catch that refused 15 of 21 sentences an auditor
-- legitimately needs to write.
--
-- So the owner chose the structural answer rather than a fifth detector. The
-- application now composes every customer-facing sentence from a frozen
-- observation catalog, keyed by a stable code the artifact stores. This file is
-- the second implementation of that decision, on the boundary the application
-- cannot reach around: a row written by any client, any migration, any manual
-- session, or any future code path that forgets.
--
-- WHAT THIS FILE DOES NOT CLAIM. It does not decide whether a string is prose.
-- That question is the one the four rounds retired, and nothing here asks it.
-- It refuses FIELD NAMES and bounds STRING SHAPE, both of which are decidable.
-- The guarantee that arbitrary narrative cannot reach a customer comes from
-- those fields not existing, not from anything inspecting their contents.

-- --------------------------------------------------------------------------------
-- 1. The field names, extended
-- --------------------------------------------------------------------------------
--
-- Two lists, kept separate because they are refused for different reasons.
--
--   SOURCE-BEARING (v8's list): fields that carried a copy of the customer's
--   code. A finding points at source; it does not carry it.
--
--   NARRATIVE (new): fields that carried sentences somebody wrote about that
--   code. A finding carries codes; the catalog carries the words.
--
-- `reason` is deliberately absent from both. `unresolvedHolds[].reason` is a
-- fixed sentence this codebase owns, stored on the report to explain a hold to
-- the customer, and refusing it would refuse every held report.
--
-- `release-rescue-structured-observations.test.ts` asserts this list matches
-- FORBIDDEN_REPORT_TEXT_FIELDS in src/lib/release-rescue-findings.ts, so the two
-- implementations cannot drift apart silently.

create or replace function public.release_rescue_forbidden_narrative_fields()
returns text[]
language sql
immutable
as $$
  select array[
    'title', 'whatWeObserved', 'whatWeFound', 'whyItMatters',
    'recommendation', 'recommendations', 'remediation',
    'residualUncertainty', 'uncertainty',
    'rationale', 'reasoning', 'justification',
    'description', 'summary', 'detail', 'details',
    'narrative', 'explanation',
    'note', 'notes', 'comment', 'comments',
    'observation', 'observations', 'finding', 'message', 'prose',
    'limitations', 'customerExclusions', 'exclusions'
  ]
$$;

comment on function public.release_rescue_forbidden_narrative_fields() is
  'Field names that would carry executor- or customer-written narrative into a stored Release Rescue report. Mirrored by FORBIDDEN_NARRATIVE_FIELDS in src/lib/release-rescue-findings.ts.';

-- v8's function, replaced so the single walker in v9 sees both lists at once.
-- One walk, one firing position, both categories.
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
  ] || public.release_rescue_forbidden_narrative_fields()
$$;

comment on function public.release_rescue_forbidden_source_fields() is
  'Every field name a stored Release Rescue report may not carry: source-bearing (v8) and narrative (v10). Mirrored by FORBIDDEN_REPORT_TEXT_FIELDS in src/lib/release-rescue-findings.ts.';

-- --------------------------------------------------------------------------------
-- 2. String shape, everywhere rather than on `path` alone
-- --------------------------------------------------------------------------------
--
-- v9 bounded `path`, because `path` was then the only field whose value came
-- from the repository. With the narrative fields gone, EVERY string a Release
-- Rescue report holds is a code, an identifier, an enum value, a hash, a
-- timestamp, a path, a repository reference, a person's name, or one of two
-- fixed sentences this codebase owns. None of those is multi-line, and the
-- longest legitimate value measured in a real report is 124 characters.
--
-- So the bound generalises: no control characters anywhere, and 400 characters,
-- which is the cap the path grammar already states.
--
-- This is a BACKSTOP AGAINST A BLOB, not a prose detector, and it is worth being
-- precise about the difference. A 200-character sentence with a credential in it
-- passes this check. What stops that sentence is that there is no field to put
-- it in — section 1 — and this section stops the separate case of a multi-line
-- or oversized value being parked in a field that is supposed to hold a code.

create or replace function public.release_rescue_walk_string_shape(
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
  v_text text;
begin
  if p_value is null or p_depth > 12 then return v_found; end if;

  if jsonb_typeof(p_value) = 'string' then
    v_text := p_value #>> '{}';

    -- A newline, a tab or a carriage return in any field of this contract means
    -- the value is not what the field is for. (A literal NUL cannot reach here:
    -- jsonb refuses a NUL escape on the way in, one channel closed before this.)
    if v_text ~ '[[:cntrl:]]' then
      v_found := array_append(v_found, p_at || ' (control character)');
    end if;

    if length(v_text) > 400 then
      v_found := array_append(v_found, format('%s (%s characters)', p_at, length(v_text)));
    end if;

    return v_found;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_entry in select * from jsonb_each(p_value) loop
      v_found := v_found || public.release_rescue_walk_string_shape(
        v_entry, p_at || '.' || v_key, p_depth + 1);
    end loop;
    return v_found;
  end if;

  if jsonb_typeof(p_value) = 'array' then
    for v_entry in select * from jsonb_array_elements(p_value) loop
      v_found := v_found || public.release_rescue_walk_string_shape(
        v_entry, format('%s[%s]', p_at, v_index), p_depth + 1);
      v_index := v_index + 1;
    end loop;
  end if;

  return v_found;
end $$;

create or replace function public.release_rescue_payload_string_shape(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
begin
  if p_payload is null then return '{}'; end if;
  if not public.release_rescue_is_report(p_payload) then return '{}'; end if;
  return public.release_rescue_walk_string_shape(p_payload, '$', 0);
end $$;

comment on function public.release_rescue_payload_string_shape(jsonb) is
  'Strings in a Release Rescue report that are multi-line or over 400 characters. A backstop against a blob parked in a field meant to hold a code; NOT a prose detector.';

-- --------------------------------------------------------------------------------
-- 3. Catalog provenance is not optional
-- --------------------------------------------------------------------------------
--
-- The words a customer read are not in the artifact any more; they are resolved
-- from the catalog at render time. That makes the catalog's identity part of
-- what a delivered report means, and a stored report that does not name the
-- catalog it was composed against cannot be re-rendered faithfully later.
--
-- So it is a stored requirement rather than an application convention: a
-- Release Rescue report row must carry the catalog version and a 64-hex content
-- hash, and every finding must carry an observation code.

create or replace function public.release_rescue_payload_missing_provenance(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  v_missing text[] := '{}';
  v_finding jsonb;
  v_index int := 0;
begin
  if p_payload is null then return v_missing; end if;
  if not public.release_rescue_is_report(p_payload) then return v_missing; end if;

  if coalesce(p_payload->>'observationCatalogVersion', '') = '' then
    v_missing := array_append(v_missing, '$.observationCatalogVersion');
  end if;

  if coalesce(p_payload->>'observationCatalogHash', '') !~ '^[0-9a-f]{64}$' then
    v_missing := array_append(v_missing, '$.observationCatalogHash');
  end if;

  for v_finding in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'findings') = 'array'
           then p_payload->'findings' else '[]'::jsonb end)
  loop
    if coalesce(v_finding->>'observationCode', '') = '' then
      v_missing := array_append(v_missing, format('$.findings[%s].observationCode', v_index));
    end if;
    if coalesce(v_finding->>'remediationCode', '') = '' then
      v_missing := array_append(v_missing, format('$.findings[%s].remediationCode', v_index));
    end if;
    v_index := v_index + 1;
  end loop;

  return v_missing;
end $$;

comment on function public.release_rescue_payload_missing_provenance(jsonb) is
  'Catalog provenance a stored Release Rescue report must carry, so the wording a customer was shown can be identified after the fact.';

-- --------------------------------------------------------------------------------
-- 4. One guard, replaced rather than a second trigger added
-- --------------------------------------------------------------------------------
--
-- `create or replace` on v9's function, for the reason v9 gave: a second trigger
-- would sort by name against the isolation and immutability triggers already on
-- this table, trigger order here is alphabetical, and this workstream has been
-- bitten by that once. One guard, one firing position, now four checks.

create or replace function public.enforce_release_rescue_no_source_excerpt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_fields text[];
  v_paths text[];
  v_strings text[];
  v_missing text[];
begin
  v_fields := public.release_rescue_payload_source_fields(new.payload);

  if cardinality(v_fields) > 0 then
    -- The FIELD NAME is named, never its contents. This message reaches logs,
    -- and the whole point of the change is that neither customer source nor an
    -- executor's sentence travels.
    raise exception
      'A Release Rescue report carries codes, not source and not sentences. Refused field(s): %',
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

  v_strings := public.release_rescue_payload_string_shape(new.payload);

  if cardinality(v_strings) > 0 then
    raise exception
      'A Release Rescue report holds codes, identifiers and paths; no field of it is multi-line or over 400 characters. Refused: %',
      array_to_string(v_strings, ', ');
  end if;

  v_missing := public.release_rescue_payload_missing_provenance(new.payload);

  if cardinality(v_missing) > 0 then
    raise exception
      'A Release Rescue report must name the observation catalog its wording came from. Missing: %',
      array_to_string(v_missing, ', ');
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
-- 5. Assertions
-- --------------------------------------------------------------------------------
--
-- Asserted here rather than only in a proof file so that applying the migration
-- to any database proves the guard works on that database.

do $$
declare
  v_report jsonb;
  v_narrative text[] := array[
    'title', 'whatWeObserved', 'whyItMatters', 'recommendation',
    'residualUncertainty', 'rationale', 'description', 'notes'];
  v_name text;
begin
  -- A well-formed report, of the shape the application now produces.
  v_report := jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'findings', jsonb_build_array(jsonb_build_object(
      'findingId', 'f-1',
      'observationCode', 'secrets.literal_credential_in_repository',
      'remediationCode', 'rotate_and_move_to_secret_store',
      'locations', jsonb_build_array(jsonb_build_object(
        'path', 'docker-compose.yml', 'startLine', 4, 'endLine', 6)))));

  -- 1. The guard is SECURITY INVOKER, so it cannot be used to reach past RLS.
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'enforce_release_rescue_no_source_excerpt'
      and p.prosecdef
  ) then
    raise exception 'The Release Rescue report guard must be SECURITY INVOKER';
  end if;

  -- 2. The well-formed report passes every check.
  if cardinality(public.release_rescue_payload_source_fields(v_report)) <> 0
     or cardinality(public.release_rescue_payload_shaped_paths(v_report)) <> 0
     or cardinality(public.release_rescue_payload_string_shape(v_report)) <> 0
     or cardinality(public.release_rescue_payload_missing_provenance(v_report)) <> 0 then
    raise exception 'The Release Rescue report guard fires on a well-formed report';
  end if;

  -- 3. Every narrative field is refused, on the finding and on the report.
  foreach v_name in array v_narrative loop
    if cardinality(public.release_rescue_payload_source_fields(
         jsonb_set(v_report, array['findings', '0', v_name], '"anything"'::jsonb))) = 0 then
      raise exception 'The narrative guard does not refuse findings[].%', v_name;
    end if;
    if cardinality(public.release_rescue_payload_source_fields(
         v_report || jsonb_build_object(v_name, 'anything'))) = 0 then
      raise exception 'The narrative guard does not refuse a report-level %', v_name;
    end if;
  end loop;

  -- 4. `limitations` as an array of sentences is refused; `limitationCodes` is not.
  if cardinality(public.release_rescue_payload_source_fields(
       v_report || jsonb_build_object('limitations', jsonb_build_array('a sentence')))) = 0 then
    raise exception 'The narrative guard does not refuse a limitations array';
  end if;
  if cardinality(public.release_rescue_payload_source_fields(
       v_report || jsonb_build_object('limitationCodes', jsonb_build_array('read_only_no_running_system')))) <> 0 then
    raise exception 'The narrative guard wrongly refuses limitationCodes';
  end if;

  -- 5. `unresolvedHolds[].reason` survives, because it is this codebase's own
  --    sentence and refusing it would refuse every held report.
  if cardinality(public.release_rescue_payload_source_fields(
       v_report || jsonb_build_object('unresolvedHolds', jsonb_build_array(
         jsonb_build_object('path', '$.x', 'reason', 'Credential material was found here and removed.'))))) <> 0 then
    raise exception 'The narrative guard wrongly refuses an unresolved hold reason';
  end if;

  -- 6. A multi-line value anywhere is refused, not only in `path`.
  if cardinality(public.release_rescue_payload_string_shape(
       jsonb_set(v_report, array['findings', '0', 'findingId'],
                 to_jsonb('f-1' || chr(10) || 'DB_PASSWORD=hunter2')))) = 0 then
    raise exception 'The string-shape guard does not refuse a multi-line value';
  end if;

  -- 7. An oversized value anywhere is refused.
  if cardinality(public.release_rescue_payload_string_shape(
       jsonb_set(v_report, array['findings', '0', 'findingId'], to_jsonb(repeat('x', 401))))) = 0 then
    raise exception 'The string-shape guard does not refuse an oversized value';
  end if;

  -- 8. A report with no catalog provenance is refused.
  if cardinality(public.release_rescue_payload_missing_provenance(
       v_report - 'observationCatalogHash')) = 0 then
    raise exception 'The provenance guard does not refuse a report with no catalog hash';
  end if;
  if cardinality(public.release_rescue_payload_missing_provenance(
       jsonb_set(v_report, array['findings', '0'],
                 (v_report->'findings'->0) - 'observationCode'))) = 0 then
    raise exception 'The provenance guard does not refuse a finding with no observation code';
  end if;

  -- 9. Another workstream's artifact is untouched. This guard narrows nothing
  --    outside Release Rescue.
  if cardinality(public.release_rescue_payload_source_fields(
       jsonb_build_object('schemaVersion', 'catalog-evidence/v1',
                          'description', 'a perfectly ordinary description',
                          'notes', repeat('n', 5000)))) <> 0 then
    raise exception 'The narrative guard reaches outside Release Rescue';
  end if;
  if cardinality(public.release_rescue_payload_string_shape(
       jsonb_build_object('schemaVersion', 'catalog-evidence/v1',
                          'notes', repeat('n', 5000)))) <> 0 then
    raise exception 'The string-shape guard reaches outside Release Rescue';
  end if;
end $$;
