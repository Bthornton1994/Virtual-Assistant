-- AI App Release Rescue v12: an identifier field holds an identifier.
--
-- v11 made a CODE field hold a code. An independent audit then asked the same
-- question one field over, about the fields that are neither codes nor prose:
-- the identifiers. `reportId`, `engagementId`, `runId`, `organizationId`,
-- `findings[].findingId`, `clearedSecretHolds[].clearedBy` and
-- `reviewedBy.operatorUserId`.
--
-- The application's field-coverage policy classifies all seven as `generated`,
-- which exempts them from the prohibited-claim guard AND the credential check.
-- The justification was a BOUND: at most four segments of at most twenty-four
-- characters. The audit composed a value inside that bound —
--
--   ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified
--
-- — four segments, each under twenty-four. It assembled, it passed the delivery
-- gate, and it rendered in the header of the customer's report as the
-- engagement id. Both halves of the bound held. The value was still a sentence.
--
-- The application now states what these values ARE rather than what they may not
-- exceed: a UUID, which is what every identifier column in this schema is, or
-- one of the five identifiers `src/lib/release-rescue-demo-identity.ts` declares
-- for the demo report; and `RR-` plus three digits for a finding's label, which
-- is numbered within its report rather than minted. This file is the same rule
-- at the row boundary, for the same reason v11 exists: the row guard is what
-- holds when something writes an artifact without going through assembly.
--
-- WHAT THIS FILE CHECKS, precisely. That each of those seven fields holds a
-- value of one of those forms. It is an exact mirror of the application rule,
-- not a stricter one — a database guard stricter than the application refuses
-- reports the application considers correct, which is the failure shape three
-- audits in this workstream have already found. A test asserts the demo list
-- here and the demo list in TypeScript are the same five strings.

-- --------------------------------------------------------------------------------
-- 1. Identifier shape
-- --------------------------------------------------------------------------------

create or replace function public.release_rescue_is_identifier(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null
     and (
       p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or p_value in (
         'demo-harbor-ledger',
         'demo-engagement',
         'demo-run',
         'demo-organization',
         'demo-operator'
       )
     )
$$;

comment on function public.release_rescue_is_identifier(text) is
  'Whether a value is a Release Rescue identifier: a lowercase UUID, or one of the five identifiers the codebase declares for the demo report. A sentence cannot satisfy this, at any punctuation or length.';

create or replace function public.release_rescue_is_finding_label(p_value text)
returns boolean
language sql
immutable
as $$
  select p_value is not null and p_value ~ '^RR-[0-9]{3}$'
$$;

comment on function public.release_rescue_is_finding_label(text) is
  'Whether a value is a Release Rescue finding label: RR- followed by exactly three digits. Findings are numbered within the report that carries them.';

create or replace function public.release_rescue_payload_bad_identifiers(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  v_bad text[] := '{}';
  v_entry jsonb;
  v_index int;
  v_field text;
begin
  if p_payload is null then return v_bad; end if;
  if not public.release_rescue_is_report(p_payload) then return v_bad; end if;

  -- The four top-level identifiers. Every one of them is a uuid column in
  -- public.release_rescue_reports and its parents.
  --
  -- A field is checked only when it is PRESENT. Absence is a different
  -- question, and answering it here would make this guard stricter than the
  -- application — the failure shape three audits in this workstream have
  -- already found. The property at issue is that a claim cannot ride in an
  -- identifier field, not that every report carries every identifier.
  foreach v_field in array array['reportId', 'engagementId', 'runId', 'organizationId'] loop
    if p_payload ? v_field and not public.release_rescue_is_identifier(p_payload->>v_field) then
      v_bad := array_append(v_bad, format('$.%s', v_field));
    end if;
  end loop;

  -- reviewedBy.operatorUserId — auth.users(id), so a uuid. The block is
  -- optional: a report is assembled before it is reviewed.
  if jsonb_typeof(p_payload->'reviewedBy') = 'object'
     and p_payload->'reviewedBy' ? 'operatorUserId'
     and not public.release_rescue_is_identifier(p_payload->'reviewedBy'->>'operatorUserId') then
    v_bad := array_append(v_bad, '$.reviewedBy.operatorUserId');
  end if;

  -- findings[].findingId — a label, not a minted id.
  v_index := 0;
  for v_entry in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'findings') = 'array'
           then p_payload->'findings' else '[]'::jsonb end)
  loop
    if v_entry ? 'findingId' and not public.release_rescue_is_finding_label(v_entry->>'findingId') then
      v_bad := array_append(v_bad, format('$.findings[%s].findingId', v_index));
    end if;
    v_index := v_index + 1;
  end loop;

  -- clearedSecretHolds[].clearedBy — the operator who released withheld
  -- material, which makes it the identifier that most needs to be one.
  v_index := 0;
  for v_entry in
    select * from jsonb_array_elements(
      case when jsonb_typeof(p_payload->'clearedSecretHolds') = 'array'
           then p_payload->'clearedSecretHolds' else '[]'::jsonb end)
  loop
    if v_entry ? 'clearedBy' and not public.release_rescue_is_identifier(v_entry->>'clearedBy') then
      v_bad := array_append(v_bad, format('$.clearedSecretHolds[%s].clearedBy', v_index));
    end if;
    v_index := v_index + 1;
  end loop;

  return v_bad;
end $$;

comment on function public.release_rescue_payload_bad_identifiers(jsonb) is
  'Identifier fields in a Release Rescue report whose value is not an identifier. Closes the gap v11 left: v11 made a code field hold a code and said nothing about the seven fields that hold identifiers.';

-- --------------------------------------------------------------------------------
-- 2. Folded into the one guard, as v9, v10 and v11 established
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
  v_ids text[];
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
    raise exception
      'A Release Rescue code field must hold a catalog code, not text. Refused: %',
      array_to_string(v_codes, ', ');
  end if;

  v_ids := public.release_rescue_payload_bad_identifiers(new.payload);

  if cardinality(v_ids) > 0 then
    -- The FIELD is named and the value never is, as everywhere else in this
    -- guard. A value that is not an identifier is the one under suspicion.
    raise exception
      'A Release Rescue identifier field must hold a UUID or a declared demo identifier. Refused: %',
      array_to_string(v_ids, ', ');
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
begin
  -- The audit's own payload, in the form that passed the bound it replaced.
  if public.release_rescue_is_identifier('ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified') then
    raise exception 'v12: the four-segment claim the audit composed is still accepted as an identifier.';
  end if;

  if public.release_rescue_is_identifier('ThisAppIsSecure') then
    raise exception 'v12: a compressed claim is still accepted as an identifier.';
  end if;

  if public.release_rescue_is_identifier('AdminPasswordIs-Xk92mQvn7Lz') then
    raise exception 'v12: a credential in identifier clothing is still accepted.';
  end if;

  -- And the values a real report produces, which is the half a tightening
  -- breaks. The old bound refused every one of these UUIDs.
  if not public.release_rescue_is_identifier('6d1f6f6e-9f5d-4a63-9a6a-52a1b9c0d7e1') then
    raise exception 'v12: a UUID is refused, and every identifier column here is a uuid.';
  end if;

  if not public.release_rescue_is_identifier('demo-harbor-ledger') then
    raise exception 'v12: the demo report id is refused.';
  end if;

  if not public.release_rescue_is_finding_label('RR-001') then
    raise exception 'v12: a finding label is refused.';
  end if;

  if public.release_rescue_is_finding_label('RR-1') then
    raise exception 'v12: a finding label of the wrong width is accepted.';
  end if;
end $$;
