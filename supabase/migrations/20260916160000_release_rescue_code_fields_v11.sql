-- AI App Release Rescue v11: a code field holds a code.
--
-- v10 removed the narrative FIELD NAMES from a stored report and bounded every
-- string's shape. An independent audit then asked the question v10 had not, and
-- its own comment had answered wrongly:
--
--   > "A 200-character sentence with a credential in it passes this check. What
--   > stops that sentence is that there is no field to put it in — section 1."
--
-- Section 1 is a field-NAME list. It says nothing about the VALUES of the fields
-- that replaced the narrative ones. The audit proved it live against the real
-- migration chain: a report whose `observationCode`, `uncertaintyCode`,
-- `rationaleCode` and `limitationCodes` carried English sentences — one of them
-- a credential, one of them the prohibited claim "this review is a penetration
-- test and certifies the application is secure and vulnerability free" — was
-- STORED, by the guard that had just accepted the well-formed report beside it.
--
-- That mattered more than an ordinary gap, because the application's
-- field-coverage policy classifies all six code fields as `generated` and
-- therefore exempts them from the prohibited-claim guard AND the credential
-- check. The exemption's stated justification is "a closed enum". This file is
-- what makes that justification true at the row boundary.
--
-- WHAT THIS FILE CHECKS, precisely. That each of the six fields holds a value in
-- CODE SHAPE: lowercase ASCII letters, digits, underscore and dot, 1 to 120
-- characters, no spaces. It deliberately does NOT hold the code LIST — the
-- application owns the catalog, the catalog changes with the product, and a
-- database guard stricter than the application refuses reports the application
-- considers correct, which is the failure shape three audits in this workstream
-- have already found. A shape check cannot be a sentence, which is the property
-- that was missing, and the application enforces membership.

-- --------------------------------------------------------------------------------
-- 1. Code shape
-- --------------------------------------------------------------------------------

create or replace function public.release_rescue_is_code_shaped(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
     and length(p_value) between 1 and 120
     and p_value ~ '^[a-z0-9_.]+$'
$$;

comment on function public.release_rescue_is_code_shaped(text) is
  'Whether a value has the shape of a Release Rescue catalog code: lowercase ASCII, digits, underscore and dot, 1-120 characters, no spaces. A sentence cannot satisfy this. Membership in the catalog is enforced by the application.';

create or replace function public.release_rescue_payload_bad_codes(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  v_bad text[] := '{}';
  v_entry jsonb;
  v_value jsonb;
  v_index int;
  v_field text;
begin
  if p_payload is null then return v_bad; end if;
  if not public.release_rescue_is_report(p_payload) then return v_bad; end if;

  -- findings[]: observationCode and remediationCode are required; uncertaintyCode
  -- is nullable, and null is correct for a confirmed finding.
  v_index := 0;
  for v_entry in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'findings') = 'array'
           then p_payload->'findings' else '[]'::jsonb end)
  loop
    foreach v_field in array array['observationCode', 'remediationCode'] loop
      if not public.release_rescue_is_code_shaped(v_entry->>v_field) then
        v_bad := array_append(v_bad, format('$.findings[%s].%s', v_index, v_field));
      end if;
    end loop;

    if jsonb_typeof(v_entry->'uncertaintyCode') not in ('null', 'undefined')
       and v_entry->'uncertaintyCode' is not null
       and not public.release_rescue_is_code_shaped(v_entry->>'uncertaintyCode') then
      v_bad := array_append(v_bad, format('$.findings[%s].uncertaintyCode', v_index));
    end if;

    v_index := v_index + 1;
  end loop;

  -- assessments[].rationaleCode
  v_index := 0;
  for v_entry in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'assessments') = 'array'
           then p_payload->'assessments' else '[]'::jsonb end)
  loop
    if not public.release_rescue_is_code_shaped(v_entry->>'rationaleCode') then
      v_bad := array_append(v_bad, format('$.assessments[%s].rationaleCode', v_index));
    end if;
    v_index := v_index + 1;
  end loop;

  -- limitationCodes[] is an array of bare codes.
  v_index := 0;
  for v_value in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'limitationCodes') = 'array'
           then p_payload->'limitationCodes' else '[]'::jsonb end)
  loop
    if jsonb_typeof(v_value) <> 'string'
       or not public.release_rescue_is_code_shaped(v_value #>> '{}') then
      v_bad := array_append(v_bad, format('$.limitationCodes[%s]', v_index));
    end if;
    v_index := v_index + 1;
  end loop;

  -- clearedSecretHolds[].reasonCode — the path that exists to RELEASE withheld
  -- material, so the one where a free-text value is least acceptable.
  v_index := 0;
  for v_entry in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'clearedSecretHolds') = 'array'
           then p_payload->'clearedSecretHolds' else '[]'::jsonb end)
  loop
    if not public.release_rescue_is_code_shaped(v_entry->>'reasonCode') then
      v_bad := array_append(v_bad, format('$.clearedSecretHolds[%s].reasonCode', v_index));
    end if;
    v_index := v_index + 1;
  end loop;

  return v_bad;
end $$;

comment on function public.release_rescue_payload_bad_codes(jsonb) is
  'Code fields in a Release Rescue report whose value is not code-shaped. Closes the gap v10 left: v10 refused narrative field NAMES and said nothing about the VALUES of the code fields that replaced them.';

-- --------------------------------------------------------------------------------
-- 2. Folded into the one guard, as v9 and v10 established
-- --------------------------------------------------------------------------------

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
  v_codes text[];
begin
  v_fields := public.release_rescue_payload_source_fields(new.payload);

  if cardinality(v_fields) > 0 then
    raise exception
      'A Release Rescue report carries codes, not source and not sentences. Refused field(s): %',
      array_to_string(v_fields, ', ');
  end if;

  v_paths := public.release_rescue_payload_shaped_paths(new.payload);

  if cardinality(v_paths) > 0 then
    raise exception
      'A Release Rescue finding location must hold a repository path. Refused: %',
      array_to_string(v_paths, ', ');
  end if;

  v_codes := public.release_rescue_payload_bad_codes(new.payload);

  if cardinality(v_codes) > 0 then
    -- The FIELD is named and the value never is. This message reaches logs, and
    -- a value that is not code-shaped is exactly the one suspected of being a
    -- sentence with a credential in it.
    raise exception
      'A Release Rescue code field must hold a catalog code, not text. Refused: %',
      array_to_string(v_codes, ', ');
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

drop trigger if exists trg_release_rescue_no_source_excerpt on public.evidence_artifacts;
create trigger trg_release_rescue_no_source_excerpt
  before insert or update on public.evidence_artifacts
  for each row execute function public.enforce_release_rescue_no_source_excerpt();

-- --------------------------------------------------------------------------------
-- 3. Assertions
-- --------------------------------------------------------------------------------

do $$
declare
  v_report jsonb;
begin
  v_report := jsonb_build_object(
    'schemaVersion', 'release-rescue-report/v1',
    'observationCatalogVersion', 'release-rescue-observations/v1',
    'observationCatalogHash', repeat('a', 64),
    'limitationCodes', jsonb_build_array('read_only_no_running_system'),
    'assessments', jsonb_build_array(jsonb_build_object(
      'checkId', 'secrets.no_secrets_in_version_control',
      'outcome', 'fail',
      'rationaleCode', 'control_missing_on_a_reachable_path')),
    'findings', jsonb_build_array(jsonb_build_object(
      'findingId', 'f-1',
      'observationCode', 'secrets.literal_credential_in_repository',
      'remediationCode', 'rotate_and_move_to_secret_store',
      'uncertaintyCode', null,
      'locations', jsonb_build_array(jsonb_build_object(
        'path', 'docker-compose.yml', 'startLine', 4, 'endLine', 6)))));

  -- 1. The well-formed report passes. Asserted first: three audits in this
  --    workstream have found a guard that refused everything.
  if cardinality(public.release_rescue_payload_bad_codes(v_report)) <> 0 then
    raise exception 'The code-shape guard fires on a well-formed report';
  end if;

  -- 2. The exact four values the audit stored are now refused.
  if cardinality(public.release_rescue_payload_bad_codes(jsonb_set(
       v_report, array['findings', '0', 'observationCode'],
       '"DB_PASSWORD is set to Xk92mQvn7Lz on line 14 of docker-compose.yml"'::jsonb))) = 0 then
    raise exception 'The code-shape guard does not refuse a sentence in observationCode';
  end if;
  if cardinality(public.release_rescue_payload_bad_codes(jsonb_set(
       v_report, array['findings', '0', 'uncertaintyCode'],
       '"The admin console password is Xk92mQvn7Lz and the DB user is svc_ledger."'::jsonb))) = 0 then
    raise exception 'The code-shape guard does not refuse a sentence in uncertaintyCode';
  end if;
  if cardinality(public.release_rescue_payload_bad_codes(jsonb_set(
       v_report, array['assessments', '0', 'rationaleCode'],
       '"Their Redis auth string is r3d15 and we reused it to test."'::jsonb))) = 0 then
    raise exception 'The code-shape guard does not refuse a sentence in rationaleCode';
  end if;
  if cardinality(public.release_rescue_payload_bad_codes(jsonb_set(
       v_report, array['limitationCodes'],
       '["This review is a penetration test and certifies the application is secure."]'::jsonb))) = 0 then
    raise exception 'The code-shape guard does not refuse a sentence in limitationCodes';
  end if;

  -- 3. A null uncertaintyCode is correct for a confirmed finding and must pass.
  if cardinality(public.release_rescue_payload_bad_codes(v_report)) <> 0 then
    raise exception 'The code-shape guard refuses a null uncertaintyCode';
  end if;

  -- 4. A missing code is refused, not silently accepted.
  if cardinality(public.release_rescue_payload_bad_codes(jsonb_set(
       v_report, array['findings', '0'],
       (v_report->'findings'->0) - 'remediationCode'))) = 0 then
    raise exception 'The code-shape guard does not refuse a missing remediationCode';
  end if;

  -- 5. It reaches nothing outside Release Rescue.
  if cardinality(public.release_rescue_payload_bad_codes(
       jsonb_build_object('schemaVersion', 'catalog-evidence/v1',
                          'findings', jsonb_build_array(jsonb_build_object(
                            'observationCode', 'a whole sentence, in another workstream'))))) <> 0 then
    raise exception 'The code-shape guard reaches outside Release Rescue';
  end if;

  -- 6. Still SECURITY INVOKER.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('release_rescue_is_code_shaped', 'release_rescue_payload_bad_codes',
                        'enforce_release_rescue_no_source_excerpt')
      and p.prosecdef
  ) then
    raise exception 'The Release Rescue code guard must be SECURITY INVOKER';
  end if;
end $$;
