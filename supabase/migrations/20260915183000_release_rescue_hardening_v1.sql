-- AI App Release Rescue hardening: ownership confirmation, snapshot limits, and
-- a scheduled retention sweep.
--
-- Additive only. The 20260915120000 migration is already applied elsewhere and
-- is not edited here.

-- --------------------------------------------------------------------------------
-- 1. An uploaded archive is not evidence of ownership
-- --------------------------------------------------------------------------------
--
-- Installing a read-only app, or adding a read-only collaborator, requires an
-- action inside the customer's own provider account on that specific repository.
-- Only someone who already controls it can do that, so the grant is itself proof.
--
-- Uploading an archive proves nothing. Anyone can download a public repository,
-- or be handed a private one, and upload the zip. The customer's attestation is a
-- promise, not proof, and the worst abuse of this service is buying a security
-- report on somebody else's code. So an archive engagement additionally requires
-- a named human here to record HOW ownership was established, before the review
-- may start.

alter table public.release_rescue_engagements
  add column if not exists access_mode text
    check (access_mode in (
      'customer_installed_readonly_app', 'customer_added_readonly_collaborator', 'customer_uploaded_archive'
    )),
  add column if not exists ownership_confirmation text
    check (ownership_confirmation is null or ownership_confirmation in (
      'provider_ownership_verified_by_operator',
      'signed_authorization_letter_on_file',
      'existing_contracted_customer_of_record'
    )),
  add column if not exists ownership_confirmed_by uuid references auth.users(id) on delete restrict,
  add column if not exists ownership_confirmed_at timestamptz,
  add column if not exists ownership_confirmation_note text not null default '';

create index if not exists release_rescue_engagements_ownership_confirmed_by_idx
  on public.release_rescue_engagements (ownership_confirmed_by) where ownership_confirmed_by is not null;

-- Statuses at which the review has effectively begun. Reaching any of these
-- without established ownership is the failure this guard exists to prevent.
create or replace function public.release_rescue_status_starts_review(p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('auditing', 'report_ready', 'delivered');
$$;

create or replace function public.enforce_release_rescue_ownership_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Ownership confirmation is one-way and attributable.
  if tg_op = 'UPDATE' and old.ownership_confirmation is not null
     and new.ownership_confirmation is distinct from old.ownership_confirmation then
    raise exception 'Ownership confirmation cannot be changed once recorded';
  end if;

  -- Validated at the moment of RECORDING, not on every later update.
  --
  -- The retention sweep clears the note, because free text a human wrote about a
  -- customer's repository is customer content and must not outlive the retention
  -- window. What survives is the accounting: which confirmation type, by whom,
  -- and when. Enforcing the note on every update would make those two controls
  -- contradict each other, and the purge would fail against this trigger.
  if new.ownership_confirmation is not null
     and (tg_op = 'INSERT' or old.ownership_confirmation is null) then
    if new.ownership_confirmed_by is null then
      raise exception 'Ownership confirmation must name the person who made it';
    end if;
    select platform_role into v_role from public.operators where user_id = new.ownership_confirmed_by;
    if v_role is null or v_role not in ('ops_manager', 'platform_admin') then
      raise exception 'Ownership may only be confirmed by an ops manager or platform admin';
    end if;
    if new.ownership_confirmed_at is null then
      new.ownership_confirmed_at := now();
    end if;
    if length(trim(new.ownership_confirmation_note)) = 0 then
      raise exception 'Ownership confirmation must record how ownership was established';
    end if;
  end if;

  -- Attribution is never dropped, purge or not.
  if tg_op = 'UPDATE' and old.ownership_confirmation is not null then
    if new.ownership_confirmed_by is distinct from old.ownership_confirmed_by
       or new.ownership_confirmed_at is distinct from old.ownership_confirmed_at then
      raise exception 'Who confirmed ownership, and when, cannot be rewritten';
    end if;
  end if;

  -- The gate itself.
  if public.release_rescue_status_starts_review(new.status)
     and new.access_mode = 'customer_uploaded_archive'
     and new.ownership_confirmation is null then
    raise exception
      'An uploaded archive is not evidence of ownership. Record an ownership confirmation before this review starts';
  end if;

  -- An access mode we do not recognise cannot be assumed safe.
  if public.release_rescue_status_starts_review(new.status) and new.access_mode is null then
    raise exception 'The engagement must record its access mode before the review starts';
  end if;

  return new;
end;
$$;

-- Replay-safe: this migration may be re-applied over an environment that already
-- has it, following the convention set by 20260906191128.
drop trigger if exists trg_release_rescue_ownership_evidence on public.release_rescue_engagements;
create trigger trg_release_rescue_ownership_evidence
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_ownership_evidence();

-- --------------------------------------------------------------------------------
-- 2. Snapshot limits, recorded with the engagement
-- --------------------------------------------------------------------------------
--
-- The limits themselves are enforced in application code before anything is read
-- (release-rescue-snapshot-limits.ts). What is stored here is the OUTCOME: which
-- limit set was applied and what the snapshot actually contained. Without that a
-- report cannot say what it did and did not look at.

alter table public.release_rescue_engagements
  add column if not exists snapshot_limits_version text,
  add column if not exists snapshot_file_count integer
    check (snapshot_file_count is null or snapshot_file_count >= 0),
  add column if not exists snapshot_total_bytes bigint
    check (snapshot_total_bytes is null or snapshot_total_bytes >= 0),
  add column if not exists snapshot_rejected_paths jsonb not null default '[]'::jsonb;

-- --------------------------------------------------------------------------------
-- 3. Schedule the retention sweep
-- --------------------------------------------------------------------------------
--
-- A retention promise nothing executes is not a retention control. pg_cron is
-- scheduled here when the extension is available, so the sweep runs inside the
-- database on the same schedule regardless of whether any application host is
-- up. When pg_cron is absent the migration still applies, and the HTTP route
-- (/api/internal/release-rescue/retention-sweep) remains the scheduled path.
--
-- Both paths call the same idempotent function, so running both is harmless.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
      perform cron.unschedule('release-rescue-retention-sweep')
        where exists (select 1 from cron.job where jobname = 'release-rescue-retention-sweep');
      perform cron.schedule(
        'release-rescue-retention-sweep',
        '17 3 * * *',
        $cron$select public.purge_expired_release_rescue_data();$cron$
      );
      raise notice 'Release Rescue retention sweep scheduled via pg_cron';
    exception when others then
      raise notice 'pg_cron present but not schedulable here (%). The HTTP route remains the scheduled path.', sqlerrm;
    end;
  else
    raise notice 'pg_cron unavailable. The HTTP route remains the scheduled path for the retention sweep.';
  end if;
end $$;

-- Observability for the sweep, so "it is scheduled" is a checkable claim rather
-- than a belief. Written by the purge function itself.
create table if not exists public.release_rescue_retention_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  engagements_purged integer not null check (engagements_purged >= 0),
  invoked_by text not null check (invoked_by in ('pg_cron', 'http_schedule', 'manual'))
);

create index if not exists release_rescue_retention_runs_ran_at_idx
  on public.release_rescue_retention_runs (ran_at desc);

alter table public.release_rescue_retention_runs enable row level security;
grant select on public.release_rescue_retention_runs to authenticated;
grant all on public.release_rescue_retention_runs to service_role;

-- Staff-only: retention activity is operational detail, and the row count would
-- otherwise leak the shape of other tenants' engagements.
drop policy if exists release_rescue_retention_runs_select on public.release_rescue_retention_runs;
create policy release_rescue_retention_runs_select on public.release_rescue_retention_runs
  for select to authenticated using (public.is_platform_staff());

-- Replace the purge function so every sweep records that it ran, including a
-- sweep that found nothing. A retention control that leaves no trace when it
-- finds nothing is indistinguishable from one that never ran.
--
-- The zero-argument version is dropped rather than left alongside: with a
-- defaulted parameter on the new one, a bare purge_expired_release_rescue_data()
-- call would be ambiguous and fail to resolve.
drop function if exists public.purge_expired_release_rescue_data();

create or replace function public.purge_expired_release_rescue_data(p_invoked_by text default 'manual')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engagement record;
  v_purged integer := 0;
begin
  if p_invoked_by not in ('pg_cron', 'http_schedule', 'manual') then
    raise exception 'Unknown retention sweep caller "%"', p_invoked_by;
  end if;

  perform set_config('delegation.retention_purge', 'on', true);

  for v_engagement in
    select id, run_id
      from public.release_rescue_engagements
     where purged_at is null
       and purge_after is not null
       and purge_after <= now()
     order by purge_after
     -- A second sweep starting while this one runs skips rows already claimed
     -- rather than blocking on them, so overlapping schedules cannot deadlock.
     for update skip locked
  loop
    update public.release_rescue_reports
       set report_artifact_id = null,
           purged_at = now()
     where engagement_id = v_engagement.id
       and purged_at is null;

    if v_engagement.run_id is not null then
      delete from public.evidence_artifacts
       where run_id = v_engagement.run_id
         and coalesce(payload->>'schemaVersion', '') like 'release-rescue-%';
    end if;

    update public.release_rescue_repository_grants
       set revoked_at = now(),
           revocation_reason = 'retention_purge'
     where engagement_id = v_engagement.id
       and revoked_at is null;

    update public.release_rescue_engagements
       set scope = jsonb_build_object('purged', true),
           attestations = '{}'::jsonb,
           ownership_confirmation_note = '',
           snapshot_rejected_paths = '[]'::jsonb,
           status = 'purged',
           purged_at = now()
     where id = v_engagement.id;

    v_purged := v_purged + 1;
  end loop;

  insert into public.release_rescue_retention_runs (engagements_purged, invoked_by)
  values (v_purged, p_invoked_by);

  perform set_config('delegation.retention_purge', 'off', true);
  return v_purged;
end;
$$;

revoke all on function public.purge_expired_release_rescue_data(text) from public;
revoke all on function public.purge_expired_release_rescue_data(text) from anon, authenticated;
grant execute on function public.purge_expired_release_rescue_data(text) to service_role;
