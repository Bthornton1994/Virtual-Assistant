-- AI App Release Rescue v13: an approval records why, and over which bytes.
--
-- `reviewed_by` and `reviewed_at` have been NOT NULL since v1, and the trigger
-- installed there checks the named reviewer actually holds manager authority.
-- That establishes WHO approved and WHEN. It has never recorded WHY, and it has
-- never recorded WHAT — which version of the artifact the approval covers.
--
-- The application bound a delivery decision to the bytes it was about to render,
-- which sounds like the missing half and is not. That hash was recomputed from
-- those same bytes at display time, so it could not disagree with them. It
-- always matched. An edit made to a report AFTER a human signed it — a verdict
-- flipped, a blocking finding dropped, a limitation removed — passed every check
-- in the system, because nothing recorded what the human had actually read.
--
-- `reviewedBy` now carries two more fields:
--
--   reasonCode           a code from the review-decision catalog. A code and not
--                        a sentence, for the same reason a clearance reason is a
--                        code: this field sits on the signature line of a
--                        customer's report, beside a display name an audit once
--                        caught carrying "Reviewed by ThisAppIsSecure".
--
--   approvedContentHash  sha256 of the report WITHOUT `reviewedBy` — a signature
--                        cannot cover itself. Supplied by the reviewer's side
--                        from the artifact they were shown, and verified against
--                        the stored report.
--
-- Section 3 binds all four signature fields on the artifact to the accounting
-- row, identity included. Binding only the two new ones would have left the
-- customer-visible attribution free to name someone other than the manager whose
-- authority was actually checked.
--
-- EXISTING RECORDS ARE NOT BACKFILLED, and that is the substance of this file
-- rather than an omission in it. A reason and an attestation are things a human
-- did or did not record. Writing a default into either would manufacture an
-- approval nobody gave, which is precisely the failure the fields exist to
-- prevent. A report signed before this migration cannot be repaired; it has to
-- be reviewed and signed again.
--
-- So the two new columns are NULLABLE, their delivery constraint is NOT VALID —
-- pre-existing rows are left exactly as they are, and every insert and update
-- from here on is checked — and section 4 reports how many un-attested rows
-- exist rather than pretending there are none.

-- --------------------------------------------------------------------------------
-- 1. The attestation on the row
-- --------------------------------------------------------------------------------

alter table public.release_rescue_reports
  add column if not exists review_reason_code text,
  add column if not exists review_approved_content_hash text;

comment on column public.release_rescue_reports.review_reason_code is
  'Why the named reviewer released this report, as a code from the review-decision catalog. Null on rows signed before v13; such a row can never be delivered.';
comment on column public.release_rescue_reports.review_approved_content_hash is
  'sha256 of the report payload excluding its own reviewedBy record: the bytes the reviewer attested to. Null on rows signed before v13.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'release_rescue_reports_review_reason_shape'
  ) then
    alter table public.release_rescue_reports
      add constraint release_rescue_reports_review_reason_shape
      check (review_reason_code is null or public.release_rescue_is_code_shaped(review_reason_code))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'release_rescue_reports_review_hash_shape'
  ) then
    alter table public.release_rescue_reports
      add constraint release_rescue_reports_review_hash_shape
      check (review_approved_content_hash is null
             or review_approved_content_hash ~ '^[0-9a-f]{64}$')
      not valid;
  end if;

  -- The delivery rule. A report may sit un-attested forever; it may not be
  -- DELIVERED un-attested. `delivered_at` is the one column v2 permits an update
  -- to stamp, so this is the constraint that arm has to satisfy.
  if not exists (
    select 1 from pg_constraint where conname = 'release_rescue_reports_delivery_needs_attestation'
  ) then
    alter table public.release_rescue_reports
      add constraint release_rescue_reports_delivery_needs_attestation
      check (
        delivered_at is null
        or (review_reason_code is not null and review_approved_content_hash is not null)
      )
      not valid;
  end if;
end $$;

-- --------------------------------------------------------------------------------
-- 2. The attestation in the payload
-- --------------------------------------------------------------------------------
--
-- The row columns are the index; the artifact is the record. This is the guard
-- that holds when something writes an `evidence_artifacts` payload without going
-- through the application's assembler — the same reason v9 through v12 each
-- mirror an application rule at the row boundary.

create or replace function public.release_rescue_payload_unattested_signature(p_payload jsonb)
returns text[]
language plpgsql
immutable
as $$
declare
  v_bad text[] := '{}';
  v_signature jsonb;
begin
  if p_payload is null then return v_bad; end if;
  if not public.release_rescue_is_report(p_payload) then return v_bad; end if;

  v_signature := p_payload->'reviewedBy';

  -- An UNSIGNED report is not a defect. A report is assembled as a draft, shown
  -- to a reviewer, and signed after that; the gap between those two steps is the
  -- normal state of a report, and it is the delivery gate's job to refuse it,
  -- not this guard's. Only a signature that exists is checked for completeness.
  --
  -- The `is null` arm is not redundant. `jsonb_typeof` of an ABSENT key returns
  -- SQL NULL, so `jsonb_typeof(...) <> 'object'` is NULL rather than true and the
  -- `if` fell through — every stored report that omits `reviewedBy` entirely was
  -- flagged as an incomplete signature. Four existing QA proofs caught it, all at
  -- once, because this file's own draft fixture used an explicit JSON null and a
  -- missing key is a different shape.
  if v_signature is null or jsonb_typeof(v_signature) <> 'object' then return v_bad; end if;

  if not public.release_rescue_is_code_shaped(v_signature->>'reasonCode') then
    v_bad := array_append(v_bad, '$.reviewedBy.reasonCode');
  end if;

  if coalesce(v_signature->>'approvedContentHash', '') !~ '^[0-9a-f]{64}$' then
    v_bad := array_append(v_bad, '$.reviewedBy.approvedContentHash');
  end if;

  return v_bad;
end $$;

comment on function public.release_rescue_payload_unattested_signature(jsonb) is
  'Fields a Release Rescue reviewer signature is missing. A signature that records no reason and covers no bytes is a record that somebody signed something, which is not an approval.';

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
  v_signature text[];
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

  v_signature := public.release_rescue_payload_unattested_signature(new.payload);

  if cardinality(v_signature) > 0 then
    raise exception
      'A Release Rescue reviewer signature must record why it was given and which bytes it covers. Missing: %',
      array_to_string(v_signature, ', ');
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

-- --------------------------------------------------------------------------------
-- 3. The row agrees with the artifact it indexes
-- --------------------------------------------------------------------------------
--
-- Two places holding the same fact is two places for them to disagree. The row
-- columns exist so the database can enforce the delivery rule without opening a
-- jsonb payload on every write; this trigger is what stops them drifting from
-- the artifact they summarise, exactly as `report_hash` is bound to its payload.

create or replace function public.enforce_release_rescue_review_attestation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_signature jsonb;
  v_reviewed_at timestamptz;
begin
  if new.report_artifact_id is null then return new; end if;

  -- Scoped to the report's own organization and NOT by id alone, for the reason
  -- recorded on `enforce_release_rescue_clearance_authority` in v7: this
  -- function is `security definer`, so RLS does not apply to its reads.
  select payload into v_payload
    from public.evidence_artifacts
   where id = new.report_artifact_id
     and organization_id = new.organization_id;
  if v_payload is null then return new; end if;

  v_signature := v_payload->'reviewedBy';
  -- `v_signature is null` FIRST, for the reason recorded on the payload guard
  -- above: `jsonb_typeof` of an absent key is SQL NULL, so the comparison alone
  -- is NULL rather than true and this branch does not fire.
  --
  -- That defect was fixed in the guard and left here, in the same file, in the
  -- same expression. Two existing QA proofs caught it — their report bodies carry
  -- no `reviewedBy` key at all — and it is worth stating plainly: fixing one
  -- occurrence of a defect is not fixing the defect.
  if v_signature is null or jsonb_typeof(v_signature) <> 'object' then
    -- A draft. The row's attestation columns must be empty too, or the row
    -- claims an approval the artifact does not carry.
    if new.review_reason_code is not null or new.review_approved_content_hash is not null then
      raise exception
        'This report row records a reviewer attestation that the report artifact does not carry';
    end if;
    return new;
  end if;

  if new.review_reason_code is distinct from (v_signature->>'reasonCode')
     or new.review_approved_content_hash is distinct from (v_signature->>'approvedContentHash') then
    raise exception
      'The reviewer attestation on this report row does not match the one in the report artifact';
  end if;

  -- ALL FOUR signature fields, not two.
  --
  -- The first version of this trigger bound the reason and the hash and left the
  -- IDENTITY unbound, which an automated review caught before this migration had
  -- run anywhere. `reviewed_by` on the row is the field v1's trigger checks for
  -- manager authority; `reviewedBy.operatorUserId` and `displayName` in the
  -- artifact are what a customer's report shows as the signature. Binding only
  -- two of the four let those disagree: a row naming an authorized manager could
  -- point at an artifact attributing the review to any id, any name and any
  -- time, and the database and the delivery gate would both accept it.
  --
  -- The authority check and the customer-visible attribution have to be about
  -- the same person, or the authority check is decoration.
  if new.reviewed_by::text is distinct from (v_signature->>'operatorUserId') then
    raise exception
      'The reviewer named in the report artifact is not the reviewer recorded on this report row';
  end if;

  -- Parsed rather than compared as text, so the same instant written with a
  -- different offset or precision is not a spurious refusal. A value that is not
  -- a timestamp at all is refused by name instead of as a cast error.
  begin
    v_reviewed_at := (v_signature->>'reviewedAt')::timestamptz;
  exception when others then
    raise exception 'The review timestamp in the report artifact is not a timestamp';
  end;

  -- `reviewed_at` defaults to now(), which is exactly how a row and its artifact
  -- drift apart without anyone choosing to let them. A signed report has to state
  -- its own review time.
  if new.reviewed_at is distinct from v_reviewed_at then
    raise exception
      'The review timestamp in the report artifact does not match the one on this report row';
  end if;

  return new;
end $$;

drop trigger if exists trg_release_rescue_review_attestation on public.release_rescue_reports;
create trigger trg_release_rescue_review_attestation
  before insert or update on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_review_attestation();

-- --------------------------------------------------------------------------------
-- 4. Existing records, counted rather than assumed
-- --------------------------------------------------------------------------------

do $$
declare
  v_unattested bigint;
  v_delivered bigint;
begin
  select count(*) into v_unattested
    from public.release_rescue_reports
   where review_reason_code is null or review_approved_content_hash is null;

  select count(*) into v_delivered
    from public.release_rescue_reports
   where delivered_at is not null
     and (review_reason_code is null or review_approved_content_hash is null);

  -- Reported, never repaired. An un-attested row keeps its history and loses its
  -- deliverability; the constraints above are NOT VALID precisely so that this
  -- migration cannot be the thing that decides otherwise.
  raise notice
    'release_rescue v13: % report row(s) carry no reviewer attestation and are not deliverable; % of them were delivered before v13 and are recorded as such.',
    v_unattested, v_delivered;
end $$;

-- --------------------------------------------------------------------------------
-- 5. The column census, re-run with the new columns and a wider net
-- --------------------------------------------------------------------------------
--
-- v7 asserted that every destructive or approval-sensitive column on these three
-- tables has a recorded control. Its filter matched `reviewed%`, which the two
-- columns this file adds do not — they are `review_%`. An assertion that cannot
-- see the next column added is the same defect as no assertion, so the pattern
-- widens to `review%` here and the new columns are registered.

do $$
declare
  v_known_reports text[] := array[
    'purged_at',          -- sweep only (v7, both arms)
    'created_at',         -- server-written (v6)
    'delivered_at',       -- the one permitted update, then immutable (v2)
    'reviewed_at', 'reviewed_by',                   -- manager authority (v1)
    'review_reason_code', 'review_approved_content_hash', -- attestation, write-once with the row (v13)
    'reviewed_commit_sha', 'reviewed_commit_pinned_at', -- pinned to the engagement (v4)
    'scope_hash',         -- immutable, bound to the frozen scope (v3)
    'organization_id', 'run_id', 'engagement_id',   -- immutable identity (v5)
    'report_artifact_id', -- cleared by the purge, never repointed (v2)
    'status'
  ];
  v_unowned text;
begin
  select string_agg(column_name, ', ') into v_unowned
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'release_rescue_reports'
     and (column_name like '%_at' or column_name like '%purge%' or column_name like '%retention%'
          or column_name like '%ownership%' or column_name like 'scope%'
          or column_name like 'review%' or column_name like '%revok%'
          or column_name = 'status')
     and not (column_name = any (v_known_reports));

  if v_unowned is not null then
    raise exception
      'These destructive or approval-sensitive columns on release_rescue_reports have no recorded control: %',
      v_unowned;
  end if;
end $$;
