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
-- 1b. The same tenant scope, on the other definer trigger that reads the artifact
-- --------------------------------------------------------------------------------
--
-- `enforce_release_rescue_report_commit` is also SECURITY DEFINER, also sorts
-- ahead of the org-match guard, and also read `evidence_artifacts` by id alone --
-- then quoted the row's `reviewedCommitSha` back in its refusal. An auditor
-- pointed a report at another tenant's artifact and read that tenant's private
-- commit SHA out of the error message.
--
-- The previous round scoped the clearance trigger and stopped there, which fixed
-- the instance and left the class. This scopes the other one, and the proof below
-- now asserts the property across every definer function rather than naming them.
--
-- Redefined in full rather than patched, because a trigger function is replaced
-- whole. The only changes are the organization_id conjunct and the refusal text.

create or replace function public.enforce_release_rescue_report_commit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engagement_commit text;
  v_payload_commit text;
begin
  if tg_op = 'INSERT' then
    select reviewed_commit_sha into v_engagement_commit
      from public.release_rescue_engagements
     where id = new.engagement_id
       and organization_id = new.organization_id;

    if v_engagement_commit is null then
      raise exception 'A report cannot be issued for an engagement whose reviewed commit was never pinned';
    end if;

    if new.reviewed_commit_sha is null then
      new.reviewed_commit_sha := v_engagement_commit;
    elsif new.reviewed_commit_sha is distinct from v_engagement_commit then
      raise exception 'Report reviewed commit does not match the commit pinned on its engagement';
    end if;

    if new.report_artifact_id is not null then
      select payload->>'reviewedCommitSha' into v_payload_commit
        from public.evidence_artifacts
       where id = new.report_artifact_id
         and organization_id = new.organization_id;

      if v_payload_commit is not null and v_payload_commit is distinct from v_engagement_commit then
        -- Neither value is echoed. Both are another party's data the moment this
        -- function is pointed somewhere it should not reach.
        raise exception 'The report body names a different commit from the one its engagement pinned';
      end if;
    end if;

    return new;
  end if;

  if new.reviewed_commit_sha is distinct from old.reviewed_commit_sha then
    raise exception 'A report cannot be repointed at a different commit after it is issued';
  end if;

  return new;
end;
$$;

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

  -- Scoped to the report's own organization, and NOT only by id.
  --
  -- This function is `security definer`, so the select runs with the owner's
  -- reach and RLS does not apply to it. Reading by id alone therefore read any
  -- tenant's artifact: an audit pointed this trigger at another organization's
  -- `evidence_artifacts` row and had the refusal below quote its payload back.
  -- The pre-existing org-match guard would have caught the insert, but triggers
  -- fire in name order and `trg_release_rescue_clearance_authority` sorts ahead
  -- of `trg_release_rescue_report_invariants`, so this ran first.
  select payload into v_payload
    from public.evidence_artifacts
   where id = new.report_artifact_id
     and organization_id = new.organization_id;
  if v_payload is null then return new; end if;

  for v_hold in select * from jsonb_array_elements(coalesce(v_payload->'clearedSecretHolds', '[]'::jsonb))
  loop
    begin
      v_cleared_by := (v_hold->>'clearedBy')::uuid;
    exception when others then
      -- The offending value is NOT echoed. An exception message reaches logs, and
      -- this one is raised while reading a stored artifact payload.
      raise exception 'Secret-hold clearance must name an operator by id';
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
  -- The report and grant tables, which this migration also guards. The first
  -- version of this block filtered `table_name = 'release_rescue_engagements'`
  -- alone while the comment above it said "these tables" -- so the mechanism
  -- installed to stop an unowned column appearing covered one of the three it
  -- claimed. Nothing was actually unguarded; the assertion just could not have
  -- told us.
  v_known_reports text[] := array[
    'purged_at',          -- sweep only (this migration, both arms)
    'created_at',         -- server-written (v6)
    'delivered_at',       -- the one permitted update, then immutable (v2)
    'reviewed_at', 'reviewed_by',                   -- manager authority (v1)
    'reviewed_commit_sha', 'reviewed_commit_pinned_at', -- pinned to the engagement (v4)
    'scope_hash',         -- immutable, bound to the frozen scope (v3)
    'organization_id', 'run_id', 'engagement_id',   -- immutable identity (v5)
    'report_artifact_id', -- cleared by the purge, never repointed (v2)
    'status'
  ];
  v_known_grants text[] := array[
    'created_at',         -- server-written
    'expires_at',         -- the time box; never edited, only revoked (v1)
    'revoked_at',         -- write-once; a revoked grant cannot be reopened (v1)
    'granted_at',
    'organization_id', 'engagement_id',             -- immutable identity
    'updated_at'          -- bookkeeping; decides nothing destructive
  ];
  v_unowned text;
  v_table record;
begin
  for v_table in
    select * from (values
      ('release_rescue_engagements', v_known),
      ('release_rescue_reports', v_known_reports),
      ('release_rescue_repository_grants', v_known_grants)
    ) as t(name, known)
  loop
    select string_agg(column_name, ', ') into v_unowned
      from information_schema.columns
     where table_schema = 'public'
       and table_name = v_table.name
       and (column_name like '%_at' or column_name like '%purge%' or column_name like '%retention%'
            or column_name like '%ownership%' or column_name like 'scope%'
            or column_name like 'reviewed%' or column_name like '%revok%'
            or column_name = 'status')
       and not (column_name = any (v_table.known));

    if v_unowned is not null then
      raise exception
        'These destructive or approval-sensitive columns on % have no recorded control: %',
        v_table.name, v_unowned;
    end if;
  end loop;

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
