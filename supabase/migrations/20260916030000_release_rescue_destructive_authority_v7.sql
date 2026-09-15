-- AI App Release Rescue v7: the destructive fields belong to the server.
--
-- v5 closed `purge_after` and opened `created_at`. v6 closed `created_at` and
-- left `purged_at`. Three rounds, one shape, three columns — because each round
-- enumerated a column instead of enumerating the CLASS.
--
-- The class is: a field whose value decides whether customer data is destroyed,
-- or whether a destructive or approval-sensitive action is authorised. Every such
-- field on these tables is listed here, and each is either server-written or
-- validated against an accountable identity. Adding one without deciding which
-- fails the assertion at the bottom.
--
-- `purged_at` mattered most, because the sweep selects `where purged_at is null`.
-- A customer setting it on their own row did not merely delay the purge — it
-- removed the row from the sweep's reach permanently, since the predicate can
-- never become true again. Their scope, their grant and their evidence artifacts
-- survived two sweeps in the audit's reproduction.
--
-- Additive only; earlier migrations are not edited.

-- --------------------------------------------------------------------------------
-- 1. `purged_at` is written by the sweep, and by nothing else
-- --------------------------------------------------------------------------------
--
-- `release_rescue_in_retention_purge()` is the privileged answer to "are we inside
-- the sweep?": it requires the caller to hold EXECUTE on the sweep function, which
-- `authenticated` does not. The flag alone is a forgeable GUC; the privilege is
-- not. The trigger is SECURITY INVOKER so `current_user` is the real caller.

create or replace function public.enforce_release_rescue_purge_stamp_authority()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.purged_at is not null and not public.release_rescue_in_retention_purge() then
      raise exception 'An engagement cannot be created already purged';
    end if;
    return new;
  end if;

  if new.purged_at is distinct from old.purged_at then
    if not public.release_rescue_in_retention_purge() then
      -- Refused, not silently reverted: a caller writing this column is either
      -- confused or attacking, and a silent revert teaches neither of them
      -- anything. The customer-facing route to deletion is the retention policy.
      raise exception
        'Purge status is recorded by the retention sweep. Shorten retention through the retention policy instead';
    end if;
    if old.purged_at is not null then
      raise exception 'A purged engagement cannot be un-purged';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_purge_stamp_authority on public.release_rescue_engagements;
create trigger trg_release_rescue_purge_stamp_authority
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_purge_stamp_authority();

-- The same column on the report accounting row, for the same reason.
create or replace function public.enforce_release_rescue_report_purge_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- INSERT is covered too. The report immutability trigger only guards UPDATE and
  -- DELETE, so a row born with `purged_at` already set would have been accepted,
  -- and the sweep skips anything already stamped -- the artifact would then sit
  -- past its retention date looking, to every count, like it had been cleared.
  if tg_op = 'INSERT' then
    if new.purged_at is not null and not public.release_rescue_in_retention_purge() then
      raise exception 'A report cannot be created already purged';
    end if;
    return new;
  end if;

  if new.purged_at is distinct from old.purged_at then
    if not public.release_rescue_in_retention_purge() then
      raise exception 'Report purge status is recorded by the retention sweep';
    end if;
    if old.purged_at is not null then
      raise exception 'A purged report cannot be un-purged';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_rescue_report_purge_stamp on public.release_rescue_reports;
create trigger trg_release_rescue_report_purge_stamp
  before insert or update on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_report_purge_stamp();

-- --------------------------------------------------------------------------------
-- 2. A secret-hold clearance names an accountable operator
-- --------------------------------------------------------------------------------
--
-- `clearedBy` was `identifierString.max(100)` — any non-blank string. The party
-- producing the report supplied its own clearances, and a clearance is what
-- releases held material to a customer. The schema for `reviewed_by` has required
-- manager authority since v1; this gives clearance the same standard.
--
-- Checked in the database rather than only in application code, because the
-- report body is an `evidence_artifacts` row that other writers can reach.

create or replace function public.enforce_release_rescue_clearance_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_hold jsonb;
  v_cleared_by uuid;
begin
  if new.report_artifact_id is null then return new; end if;

  select payload into v_payload from public.evidence_artifacts where id = new.report_artifact_id;
  if v_payload is null then return new; end if;

  for v_hold in select * from jsonb_array_elements(coalesce(v_payload->'clearedSecretHolds', '[]'::jsonb))
  loop
    begin
      v_cleared_by := (v_hold->>'clearedBy')::uuid;
    exception when others then
      raise exception 'Secret-hold clearance must name an operator by id, not "%"', v_hold->>'clearedBy';
    end;

    if not public.release_rescue_user_holds_manager_authority(v_cleared_by) then
      raise exception
        'Secret-hold clearances may only be recorded by an ops manager or platform admin';
    end if;

    if coalesce(v_hold->>'clearedContentHash', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'A secret-hold clearance must name the content it released, by hash';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_clearance_authority on public.release_rescue_reports;
create trigger trg_release_rescue_clearance_authority
  before insert or update on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_clearance_authority();

-- --------------------------------------------------------------------------------
-- 3. The class, asserted
-- --------------------------------------------------------------------------------
--
-- Every destructive or approval-sensitive column on the engagement, with the
-- control that owns it. A new one fails this block until somebody decides.

do $$
declare
  v_known text[] := array[
    'purge_after',        -- derived (v5/v6 retention timing)
    'purged_at',          -- sweep only (this migration)
    'created_at',         -- server-written (v6)
    'delivered_at',       -- lifecycle, monotonic via retention timing
    'retention_policy',   -- customer choice, shortening only (v1)
    'retention_days',     -- derived from the policy (v1)
    'status',             -- gated by ownership, grant and commit triggers
    'ownership_confirmation', 'ownership_confirmed_by', 'ownership_confirmed_at',
    'ownership_confirmed_via',                      -- caller-authorised (v5)
    'reviewed_commit_sha', 'reviewed_commit_pinned_at', -- write-once (v4)
    'scope', 'scope_hash', 'organization_id', 'run_id', -- immutable (v2/v3/v5)
    'ownership_confirmation_note',  -- customer content; cleared by the purge (v1)
    'updated_at'                    -- bookkeeping; decides nothing destructive
  ];
  v_unowned text;
begin
  select string_agg(column_name, ', ') into v_unowned
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'release_rescue_engagements'
     and (column_name like '%_at' or column_name like '%purge%' or column_name like '%retention%'
          or column_name like '%ownership%' or column_name like 'scope%' or column_name = 'status')
     and not (column_name = any (v_known));

  if v_unowned is not null then
    raise exception
      'These destructive or approval-sensitive columns have no recorded control: %', v_unowned;
  end if;

  -- The purge-stamp guard must be invoker, or `release_rescue_in_retention_purge`
  -- answers for the function owner and every caller looks like the sweep.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enforce_release_rescue_purge_stamp_authority',
                         'enforce_release_rescue_report_purge_stamp')
       and p.prosecdef
  ) then
    raise exception 'A purge-stamp guard is SECURITY DEFINER and would answer for the wrong role';
  end if;
end;
$$;
