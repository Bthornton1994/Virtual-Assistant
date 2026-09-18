-- AI App Release Rescue v4: the reviewed commit gets its own write-once field.
--
-- The defect this closes was recorded, not worked around, in the v3 pass:
--
--   `freezeScope(intake, commitSha)` built the frozen scope from the intake plus
--   the reviewed commit. The commit is only known once a snapshot has been taken,
--   which happens after the engagement row exists, and both `scope` and
--   `scope_hash` are immutable on UPDATE. So the intended lifecycle could not be
--   executed: the row would have to be written with a commit nobody had yet, or
--   amended after it was frozen, and the schema refuses the amendment.
--
-- It had a second half nobody had noticed. Because the scope hash was computed
-- over a scope CONTAINING the commit, `hashScope(freezeScope(intake, sha))` could
-- never equal the `scope_hash` written at intake. The hash that exists to bind a
-- report to its engagement bound nothing.
--
-- The fix is not to loosen the freeze. It is to notice that two facts were sharing
-- one field because they were both called "scope":
--
--   * WHAT we agreed to review  — one repository, one application, one critical
--     workflow, the exclusions, the AI-assisted choice. Known at intake, frozen
--     at intake, hashed at intake.
--   * WHICH VERSION we reviewed — the commit. Not known at intake. Known exactly
--     once, at the snapshot. Never changes after that.
--
-- Two write-once moments need two fields. This migration adds the second one.
--
-- The commit is NOT customer content: a 40-character hash of a tree reveals
-- nothing about that tree, in the way `scope_hash` reveals nothing about the
-- scope. So it survives the retention purge, as accounting evidence of what was
-- reviewed, and the purge is forbidden from clearing it.
--
-- Additive only; earlier migrations are not edited.

-- --------------------------------------------------------------------------------
-- 1. The field
-- --------------------------------------------------------------------------------

alter table public.release_rescue_engagements
  add column if not exists reviewed_commit_sha text
    check (reviewed_commit_sha is null or reviewed_commit_sha ~ '^[0-9a-f]{40}$'),
  add column if not exists reviewed_commit_pinned_at timestamptz;

comment on column public.release_rescue_engagements.reviewed_commit_sha is
  'The commit actually reviewed. Write-once, pinned after the snapshot and before the review starts. Survives the retention purge as accounting evidence; it is a hash, not customer content.';

alter table public.release_rescue_reports
  add column if not exists reviewed_commit_sha text
    check (reviewed_commit_sha is null or reviewed_commit_sha ~ '^[0-9a-f]{40}$');

comment on column public.release_rescue_reports.reviewed_commit_sha is
  'Copied from the engagement at issue and checked against it. A report that names a different commit than the engagement pinned is refused.';

-- --------------------------------------------------------------------------------
-- 2. The lifecycle point
-- --------------------------------------------------------------------------------
--
-- "The correct lifecycle point" is stated once, here, rather than re-derived at
-- each call site. A snapshot has been taken when the limits that were applied to
-- it have been recorded, which is what `snapshot_limits_version` means. Pinning a
-- commit before that would be pinning a commit nobody has read.

create or replace function public.release_rescue_snapshot_recorded(p_limits_version text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_limits_version is not null and length(trim(p_limits_version)) > 0;
$$;

create or replace function public.enforce_release_rescue_reviewed_commit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_live_grants integer;
begin
  -- a. Never at intake. The commit does not exist yet, and a row that arrives
  --    already carrying one is asserting a snapshot that never happened.
  if tg_op = 'INSERT' and new.reviewed_commit_sha is not null then
    raise exception
      'The reviewed commit cannot be set at intake. It is pinned after the snapshot is taken';
  end if;

  -- b. Write-once, and that includes the purge. The commit is accounting
  --    evidence of what was reviewed, like scope_hash, and neither is customer
  --    content. A purge that erased it would leave a delivered report unable to
  --    say what it had read.
  if tg_op = 'UPDATE'
     and old.reviewed_commit_sha is not null
     and new.reviewed_commit_sha is distinct from old.reviewed_commit_sha then
    raise exception 'The reviewed commit is pinned once and cannot be changed or cleared';
  end if;

  -- c. Pinning it requires the snapshot it names, and the live access that
  --    produced the snapshot. Both are already conditions for starting a review;
  --    requiring them here too is what makes the pin mean "we read this", rather
  --    than "someone typed forty characters".
  if tg_op = 'UPDATE' and old.reviewed_commit_sha is null and new.reviewed_commit_sha is not null then
    if not public.release_rescue_snapshot_recorded(new.snapshot_limits_version) then
      raise exception
        'The reviewed commit cannot be pinned before the snapshot is recorded (snapshot_limits_version is unset)';
    end if;

    select count(*) into v_live_grants
      from public.release_rescue_repository_grants g
     where g.engagement_id = new.id
       and g.organization_id = new.organization_id
       and g.access_level = 'read_only'
       and g.repository_ref = new.scope #>> '{repository,repositoryRef}'
       and g.revoked_at is null
       and g.expires_at > now();

    if v_live_grants = 0 then
      raise exception
        'The reviewed commit cannot be pinned without a live, unrevoked read-only grant naming the repository in the frozen scope';
    end if;

    if new.reviewed_commit_pinned_at is null then
      new.reviewed_commit_pinned_at := now();
    end if;
  end if;

  -- d. When it was pinned is attribution, and attribution is never rewritten.
  if tg_op = 'UPDATE' and old.reviewed_commit_pinned_at is not null
     and new.reviewed_commit_pinned_at is distinct from old.reviewed_commit_pinned_at then
    raise exception 'When the reviewed commit was pinned cannot be rewritten';
  end if;

  -- e. And no review starts without it. This is the half that makes the field
  --    load-bearing rather than decorative: a report is only defensible if it can
  --    name the tree it read.
  if public.release_rescue_status_starts_review(new.status) and new.reviewed_commit_sha is null then
    raise exception
      'A review cannot start before the reviewed commit is pinned from the snapshot';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_reviewed_commit on public.release_rescue_engagements;
create trigger trg_release_rescue_reviewed_commit
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_reviewed_commit();

-- --------------------------------------------------------------------------------
-- 3. The purge may not take it
-- --------------------------------------------------------------------------------
--
-- Rule (b) above already refuses the clear. This is the same rule stated where a
-- future author of the sweep will meet it: the purge's own UPDATE lists the
-- columns it clears, and this assertion fails the migration if the reviewed
-- commit is ever added to that list.

do $$
declare
  v_body text;
begin
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_expired_release_rescue_data';

  if v_body is null then
    raise exception 'The retention sweep is missing; this migration expects it from 20260915183000';
  end if;
  if v_body ~* 'reviewed_commit_sha\s*=' then
    raise exception 'The retention sweep clears reviewed_commit_sha, which is accounting evidence and must survive';
  end if;
end;
$$;

-- --------------------------------------------------------------------------------
-- 4. A report names the commit its engagement pinned
-- --------------------------------------------------------------------------------
--
-- Without this the new field would be an unbound decoration: a report could name
-- any commit, or none, and nothing would notice. The row must agree with the
-- engagement, and where the body states a commit it must agree with both.

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
  -- The two operations are separated deliberately. An earlier draft checked the
  -- engagement on both, which made the "cannot be repointed" branch unreachable:
  -- any changed value already failed the mismatch check first, so the rule that
  -- was supposed to hold a delivered report still had no case that could reach
  -- it. Splitting them gives each branch the situation it is actually for.
  if tg_op = 'INSERT' then
    select reviewed_commit_sha into v_engagement_commit
      from public.release_rescue_engagements
     where id = new.engagement_id;

    if v_engagement_commit is null then
      raise exception 'A report cannot be issued for an engagement whose reviewed commit was never pinned';
    end if;

    if new.reviewed_commit_sha is null then
      -- Filled in rather than refused: the value is not the writer's to choose,
      -- so there is nothing for them to get right or wrong.
      new.reviewed_commit_sha := v_engagement_commit;
    elsif new.reviewed_commit_sha is distinct from v_engagement_commit then
      raise exception
        'Report reviewed commit "%" does not match the commit pinned on its engagement ("%")',
        new.reviewed_commit_sha, v_engagement_commit;
    end if;

    if new.report_artifact_id is not null then
      select payload->>'reviewedCommitSha' into v_payload_commit
        from public.evidence_artifacts
       where id = new.report_artifact_id;

      if v_payload_commit is not null and v_payload_commit is distinct from v_engagement_commit then
        raise exception
          'The report body names commit "%" but its engagement pinned "%"',
          v_payload_commit, v_engagement_commit;
      end if;
    end if;

    return new;
  end if;

  -- UPDATE. The only legitimate writes to an issued report are the delivery
  -- stamp and the retention purge, and neither touches the commit. Setting it to
  -- NULL is a change like any other, so the purge cannot quietly drop it here
  -- either.
  if new.reviewed_commit_sha is distinct from old.reviewed_commit_sha then
    raise exception 'A report cannot be repointed at a different commit after it is issued';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_report_commit on public.release_rescue_reports;
create trigger trg_release_rescue_report_commit
  before insert or update on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_report_commit();

-- --------------------------------------------------------------------------------
-- 5. The frozen scope no longer carries a commit
-- --------------------------------------------------------------------------------
--
-- Stated as a constraint rather than a convention, because the whole defect was a
-- commit living in the wrong place. A scope that carries one is either written by
-- a caller still on the old contract or an attempt to make the agreement identity
-- depend on the tree, and both are refused.
--
-- NOT VALID: existing rows are left alone. This migration does not rewrite
-- history, and the purge stub has no repository key to trip over either way.

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'release_rescue_engagements_scope_has_no_commit'
       and conrelid = 'public.release_rescue_engagements'::regclass
  ) then
    alter table public.release_rescue_engagements
      add constraint release_rescue_engagements_scope_has_no_commit
      check (scope #> '{repository,commitSha}' is null) not valid;
  end if;
end;
$$;
