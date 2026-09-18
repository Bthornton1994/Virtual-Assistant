-- AI App Release Rescue v14: the lifecycle has an order, a run has one
-- engagement, and a signature names the person who signed.
--
-- Three findings the audit ledger recorded as confirmed and awaiting an owner
-- decision, and one outstanding item from the pull request. The owner decided
-- all four on 2026-09-18 (DECISION_LOG.md D-014 to D-017); this file is the
-- database half of each.
--
--   S-009  The engagement lifecycle had strong preconditions on the states that
--          carry the customer's source and no ORDER between states. Measured on
--          the real chain: intake -> access_granted with no grant, access_granted
--          -> intake, and cancelled -> scoped all succeeded. The order is now a
--          graph the database enforces:
--
--            intake -> scoped -> access_granted -> auditing -> report_ready -> delivered
--
--          with cancellation from every state before delivery, a manager-authorized
--          RECOVERY as the only way back from cancelled (to intake, with a reason
--          code), the retention sweep as the only way to purged, and no way out of
--          delivered on the normal path. Every transition is logged.
--
--   S-010  Nothing made a workstream run exclusive to one engagement, and the
--          sweep deleted evidence by (run, organization) — so purging one
--          engagement could delete another's unexpired evidence. A run now
--          belongs to one engagement, a report must name its engagement's run,
--          and the sweep refuses to delete if the invariant is ever found broken.
--
--   Reviewer  `reviewed_by` was checked for manager authority and never compared
--          to the caller. An interactive caller could sign a report as someone
--          else. It is bound to `auth.uid()` now, the way v5 bound ownership
--          confirmation, and the same binding applies to a report artifact's
--          signature and clearances when an operator writes one directly.
--
-- Additive only; earlier migrations are not edited. Trigger names carry a digit
-- so they sort — and fire — ahead of the existing gates: whether a move is on
-- the graph at all is decided before whether the target state's preconditions
-- hold, so a caller hears "not a permitted transition" rather than a
-- precondition message about a state they may not enter anyway.

-- --------------------------------------------------------------------------------
-- 1. A run belongs to one engagement (S-010)
-- --------------------------------------------------------------------------------

-- Counted rather than assumed. If any run is shared, this migration fails with
-- the count and nothing below is applied: silently keeping a non-unique index
-- would be recording a decision as taken while leaving it unenforced.
do $$
declare
  v_shared bigint;
begin
  select count(*) into v_shared
    from (
      select run_id
        from public.release_rescue_engagements
       where run_id is not null
       group by run_id
      having count(*) > 1
    ) shared;

  if v_shared > 0 then
    raise exception
      'release_rescue v14: % workstream run(s) are referenced by more than one engagement. A run belongs to one engagement (D-015); resolve the sharing before applying this migration.',
      v_shared;
  end if;
end $$;

-- The plain index from v1 is replaced, not kept beside the unique one: same
-- column, same predicate, and a second index that enforces nothing is reader load.
drop index if exists public.release_rescue_engagements_run_idx;
create unique index if not exists release_rescue_engagements_run_unique_idx
  on public.release_rescue_engagements (run_id) where run_id is not null;

-- A report names its engagement's run, not a run of its own choosing. Without
-- this the report row could point at any run in the organization, and the
-- artifact check in v1 (artifact.run_id = report.run_id) would bind it to the
-- wrong one consistently.
create or replace function public.enforce_release_rescue_report_run_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engagement_run uuid;
begin
  if tg_op = 'UPDATE' then
    if new.run_id is distinct from old.run_id or new.engagement_id is distinct from old.engagement_id then
      raise exception 'A report cannot be repointed at another run or engagement after it is issued';
    end if;
    return new;
  end if;

  -- Scoped to the report's own organization and not by id alone (v7).
  select run_id into v_engagement_run
    from public.release_rescue_engagements
   where id = new.engagement_id
     and organization_id = new.organization_id;

  if v_engagement_run is null then
    raise exception 'A report cannot be issued for an engagement whose workstream run was never pinned';
  end if;
  if new.run_id is distinct from v_engagement_run then
    raise exception 'Report run does not match the run pinned on its engagement';
  end if;

  return new;
end $$;

drop trigger if exists trg_release_rescue_report_run_binding on public.release_rescue_reports;
create trigger trg_release_rescue_report_run_binding
  before insert or update on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_report_run_binding();

-- The sweep, redefined in full (a function is replaced whole). Two changes from
-- v5: the evidence delete is preceded by a check that the run is this
-- engagement's alone, and the check fails CLOSED — the sweep aborts rather than
-- deletes. The unique index above makes the check unreachable; it is here so
-- that dropping the index can never quietly widen a destructive operation.
create or replace function public.purge_expired_release_rescue_data(p_invoked_by text default 'manual')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engagement record;
  v_purged integer := 0;
  v_sharing integer;
begin
  if p_invoked_by not in ('pg_cron', 'http_schedule', 'manual') then
    raise exception 'Unknown retention sweep caller "%"', p_invoked_by;
  end if;

  perform set_config('delegation.retention_purge', 'on', true);

  for v_engagement in
    select id, run_id, organization_id
      from public.release_rescue_engagements
     where purged_at is null
       and purge_after is not null
       and purge_after <= now()
     order by purge_after
     for update skip locked
  loop
    update public.release_rescue_reports
       set report_artifact_id = null,
           purged_at = now()
     where engagement_id = v_engagement.id
       and organization_id = v_engagement.organization_id
       and purged_at is null;

    if v_engagement.run_id is not null then
      -- The composite key (v5) already confines every engagement on this run to
      -- the run's organization, so the organization conjunct loses nothing and
      -- keeps this read scoped like every other definer read (v7).
      select count(*) into v_sharing
        from public.release_rescue_engagements
       where run_id = v_engagement.run_id
         and organization_id = v_engagement.organization_id
         and id <> v_engagement.id;

      if v_sharing > 0 then
        -- No identifier is echoed. This message reaches the scheduler's logs.
        raise exception
          'Retention sweep refused: an engagement''s workstream run is shared with another engagement, so its evidence cannot be scoped to one engagement';
      end if;

      -- With the run exclusive to this engagement, "this run's Release Rescue
      -- evidence in this organization" IS "this engagement's evidence".
      delete from public.evidence_artifacts
       where run_id = v_engagement.run_id
         and organization_id = v_engagement.organization_id
         and coalesce(payload->>'schemaVersion', '') like 'release-rescue-%';
    end if;

    update public.release_rescue_repository_grants
       set revoked_at = now(),
           revocation_reason = 'retention_purge'
     where engagement_id = v_engagement.id
       and organization_id = v_engagement.organization_id
       and revoked_at is null;

    update public.release_rescue_engagements
       set scope = jsonb_build_object('purged', true),
           attestations = '{}'::jsonb,
           ownership_confirmation_note = '',
           snapshot_rejected_paths = '[]'::jsonb,
           status = 'purged',
           purged_at = now()
     where id = v_engagement.id
       and organization_id = v_engagement.organization_id;

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

-- --------------------------------------------------------------------------------
-- 2. The lifecycle graph (S-009)
-- --------------------------------------------------------------------------------

-- The normal path, as data. One row per permitted edge, one edge per line, so
-- that src/lib/__tests__/release-rescue-migration.test.ts can read this list and
-- compare it with ENGAGEMENT_TRANSITIONS in src/lib/release-rescue-lifecycle.ts.
--
-- Not on this list, and handled by the trigger below with their own authority:
--   cancelled -> intake   manager-authorized recovery
--   *         -> purged   the retention sweep
create or replace function public.release_rescue_engagement_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_from, p_to) in (
    ('intake', 'scoped'),
    ('intake', 'cancelled'),
    ('scoped', 'access_granted'),
    ('scoped', 'cancelled'),
    ('access_granted', 'auditing'),
    ('access_granted', 'cancelled'),
    ('auditing', 'report_ready'),
    ('auditing', 'cancelled'),
    ('report_ready', 'delivered'),
    ('report_ready', 'cancelled')
  );
$$;

comment on function public.release_rescue_engagement_transition_allowed(text, text) is
  'Whether from -> to is a normal-path engagement transition. Recovery (cancelled -> intake) and purge (* -> purged) are not normal-path moves and are decided by enforce_release_rescue_lifecycle_graph with their own authority.';

-- The recovery record. Written by the recovery transition and by nothing else;
-- cleared when the engagement is cancelled again, so a cancelled engagement's
-- record is always empty and a recovery must supply a fresh one. History is in
-- the transition log, which nothing but the trigger writes.
alter table public.release_rescue_engagements
  add column if not exists recovery_reason_code text
    check (recovery_reason_code is null or public.release_rescue_is_code_shaped(recovery_reason_code)),
  add column if not exists recovery_authorized_by uuid references auth.users(id) on delete restrict,
  add column if not exists recovery_authorized_at timestamptz,
  add column if not exists recovery_authorized_via text
    check (recovery_authorized_via is null
           or recovery_authorized_via in ('authenticated_operator', 'service_role')),
  add column if not exists recovery_count integer not null default 0 check (recovery_count >= 0);

comment on column public.release_rescue_engagements.recovery_reason_code is
  'Why a cancelled engagement was reopened, as a code from the recovery catalog. Set by the recovery transition; cleared by cancellation.';
comment on column public.release_rescue_engagements.recovery_authorized_by is
  'The ops manager or platform admin who authorized the most recent recovery. Forced to auth.uid() for an interactive caller; named and authority-checked for the server.';
comment on column public.release_rescue_engagements.recovery_authorized_via is
  'Which trusted channel authorized the recovery. Set by the trigger, never by the caller.';
comment on column public.release_rescue_engagements.recovery_count is
  'How many times this engagement has been reopened from cancelled. Server-written.';

create index if not exists release_rescue_engagements_recovery_authorized_by_idx
  on public.release_rescue_engagements (recovery_authorized_by) where recovery_authorized_by is not null;

-- Every status change, recorded. No customer content: statuses, identifiers, a
-- code and a timestamp, so the log survives the retention purge as accounting.
create table if not exists public.release_rescue_engagement_transitions (
  id uuid primary key default gen_random_uuid(),
  -- Total order across the table. `recorded_at` is transaction time, which two
  -- moves in one transaction share.
  sequence_no bigint generated always as identity,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  from_status text not null check (from_status in (
    'intake', 'scoped', 'access_granted', 'auditing', 'report_ready', 'delivered', 'cancelled', 'purged'
  )),
  to_status text not null check (to_status in (
    'intake', 'scoped', 'access_granted', 'auditing', 'report_ready', 'delivered', 'cancelled', 'purged'
  )),
  -- auth.uid() at the time of the move; null for the server and the sweep.
  actor_user_id uuid references auth.users(id) on delete set null,
  via text not null check (via in ('authenticated_operator', 'service_role', 'retention_purge')),
  recovery_reason_code text
    check (recovery_reason_code is null or public.release_rescue_is_code_shaped(recovery_reason_code)),
  recorded_at timestamptz not null default now(),
  constraint release_rescue_engagement_transitions_engagement_fkey
    foreign key (engagement_id, organization_id)
    references public.release_rescue_engagements (id, organization_id) on delete cascade
);

create index if not exists release_rescue_engagement_transitions_engagement_idx
  on public.release_rescue_engagement_transitions (engagement_id, sequence_no);
create index if not exists release_rescue_engagement_transitions_org_idx
  on public.release_rescue_engagement_transitions (organization_id, recorded_at desc);
create index if not exists release_rescue_engagement_transitions_engagement_org_fk_idx
  on public.release_rescue_engagement_transitions (engagement_id, organization_id);
create index if not exists release_rescue_engagement_transitions_actor_idx
  on public.release_rescue_engagement_transitions (actor_user_id) where actor_user_id is not null;

alter table public.release_rescue_engagement_transitions enable row level security;
-- SELECT only. The log is written by a trigger running with definer rights; no
-- role signed in through the API may insert, update or delete a row of it.
grant select on public.release_rescue_engagement_transitions to authenticated;
grant all on public.release_rescue_engagement_transitions to service_role;

drop policy if exists release_rescue_engagement_transitions_select on public.release_rescue_engagement_transitions;
create policy release_rescue_engagement_transitions_select on public.release_rescue_engagement_transitions
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

-- 2a. The graph, the recovery and the purge: WHO may make WHICH move.
--
-- SECURITY INVOKER, for the reason recorded on v5's ownership gate: the
-- service-role branch reads `current_user`, which under definer rights is the
-- function owner and would make every caller look like the server.
create or replace function public.enforce_release_rescue_lifecycle_graph()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_recovery_record_changed boolean;
begin
  if tg_op = 'INSERT' then
    -- The graph has one entry.
    if new.status is distinct from 'intake' then
      raise exception 'An engagement enters the lifecycle at intake; it cannot be created as "%"', new.status;
    end if;
    if new.recovery_reason_code is not null
       or new.recovery_authorized_by is not null
       or new.recovery_authorized_at is not null
       or new.recovery_authorized_via is not null
       or new.recovery_count <> 0 then
      raise exception 'An engagement cannot be created carrying a recovery record';
    end if;
    return new;
  end if;

  v_recovery_record_changed :=
       new.recovery_reason_code is distinct from old.recovery_reason_code
    or new.recovery_authorized_by is distinct from old.recovery_authorized_by
    or new.recovery_authorized_at is distinct from old.recovery_authorized_at
    or new.recovery_authorized_via is distinct from old.recovery_authorized_via
    or new.recovery_count is distinct from old.recovery_count;

  -- No status change. The recovery record is not a free-standing field.
  if new.status is not distinct from old.status then
    if v_recovery_record_changed then
      raise exception
        'The recovery record is written by a manager-authorized recovery of a cancelled engagement and by nothing else';
    end if;
    return new;
  end if;

  -- Purge: reachable from every state, by the sweep alone. The privilege check
  -- is the one v2 introduced — the flag counts only for a caller who could have
  -- run the sweep — so this cannot be satisfied by setting a GUC.
  if new.status = 'purged' then
    if not public.release_rescue_in_retention_purge() then
      raise exception 'An engagement is marked purged by the retention sweep, not by a caller';
    end if;
    if v_recovery_record_changed then
      raise exception 'The retention purge does not rewrite the recovery record';
    end if;
    return new;
  end if;

  if old.status = 'purged' then
    raise exception 'A purged engagement has no further lifecycle';
  end if;

  -- Recovery: cancelled -> intake, by an accountable manager, for a stated reason.
  -- The engagement RESTARTS: every gate between intake and a review applies again.
  if old.status = 'cancelled' then
    if new.status <> 'intake' then
      raise exception
        'Engagement lifecycle: a cancelled engagement can only be reopened at intake, by a manager-authorized recovery ("%" -> "%" refused)',
        old.status, new.status;
    end if;

    if not public.release_rescue_is_code_shaped(new.recovery_reason_code) then
      raise exception
        'Reopening a cancelled engagement requires a recovery reason code from the recovery catalog';
    end if;

    if public.caller_is_server() then
      -- Server-side flow. It must still name a real manager: the server asserts
      -- WHO authorized the recovery, not THAT someone did.
      if new.recovery_authorized_by is null then
        raise exception 'Reopening a cancelled engagement must name the manager who authorized it';
      end if;
      if not public.release_rescue_user_holds_manager_authority(new.recovery_authorized_by) then
        raise exception 'A cancelled engagement may only be reopened by an ops manager or platform admin';
      end if;
      new.recovery_authorized_via := 'service_role';
    else
      -- Interactive flow. The caller is the authorizer, and nothing they put in
      -- the column is consulted except to refuse a mismatch.
      if auth.uid() is null then
        raise exception 'Reopening a cancelled engagement requires an authenticated operator';
      end if;
      if not coalesce(public.is_ops_manager(), false) then
        raise exception
          'A cancelled engagement may only be reopened by an ops manager or platform admin acting as themselves';
      end if;
      if new.recovery_authorized_by is distinct from auth.uid() then
        raise exception
          'Recovery records the caller. It cannot be attributed to another person';
      end if;
      new.recovery_authorized_via := 'authenticated_operator';
    end if;

    -- Server-written, whatever the caller supplied.
    new.recovery_authorized_at := now();
    new.recovery_count := old.recovery_count + 1;
    return new;
  end if;

  if old.status = 'delivered' then
    raise exception
      'Engagement lifecycle: a delivered engagement does not reopen ("%" -> "%" refused)',
      old.status, new.status;
  end if;

  if not public.release_rescue_engagement_transition_allowed(old.status, new.status) then
    raise exception 'Engagement lifecycle: "%" -> "%" is not a permitted transition', old.status, new.status;
  end if;

  if new.status = 'cancelled' then
    -- The recovery that brought this engagement back, if any, is spent. The log
    -- keeps it; the row's record is emptied so the next recovery has to be a
    -- fresh authorization and cannot ride on a stale one.
    new.recovery_reason_code := null;
    new.recovery_authorized_by := null;
    new.recovery_authorized_at := null;
    new.recovery_authorized_via := null;
    new.recovery_count := old.recovery_count;
    return new;
  end if;

  -- A forward move. The recovery record is not touched by it.
  if v_recovery_record_changed then
    raise exception
      'The recovery record is written by a manager-authorized recovery of a cancelled engagement and by nothing else';
  end if;

  return new;
end $$;

drop trigger if exists trg_release_rescue_0_lifecycle_graph on public.release_rescue_engagements;
create trigger trg_release_rescue_0_lifecycle_graph
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_lifecycle_graph();

-- 2b. What must be TRUE to enter a state, beyond the order.
--
-- These make the state names honest: an engagement is `access_granted` only
-- while a live grant exists, `report_ready` only once a report has been issued
-- for it, `delivered` only once that report has been stamped delivered and the
-- engagement's own retention clock has started. The review-start gates on
-- `auditing` (ownership, access mode, live grant, pinned commit) are unchanged
-- and still fire from v1 through v5.
--
-- SECURITY DEFINER because it reads grants and reports and must see true state
-- rather than the caller's RLS-filtered view (v1). It only reads and raises.
create or replace function public.enforce_release_rescue_lifecycle_preconditions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_ref text;
  v_count integer;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'access_granted' then
    v_scope_ref := new.scope #>> '{repository,repositoryRef}';
    if v_scope_ref is null then
      raise exception 'The frozen scope must name the repository before access can be recorded as granted';
    end if;

    select count(*) into v_count
      from public.release_rescue_repository_grants g
     where g.engagement_id = new.id
       and g.organization_id = new.organization_id
       and g.access_level = 'read_only'
       and g.repository_ref = v_scope_ref
       and g.revoked_at is null
       and g.expires_at > now();

    if v_count = 0 then
      raise exception
        'An engagement is access_granted only once a live, unrevoked read-only grant names the repository in the frozen scope';
    end if;

  elsif new.status = 'report_ready' then
    select count(*) into v_count
      from public.release_rescue_reports r
     where r.engagement_id = new.id
       and r.organization_id = new.organization_id
       and r.purged_at is null;

    if v_count = 0 then
      raise exception 'An engagement is report_ready only once a signed report has been issued for it';
    end if;

  elsif new.status = 'delivered' then
    if new.delivered_at is null then
      raise exception 'A delivered engagement must stamp delivered_at, which starts its retention clock';
    end if;

    select count(*) into v_count
      from public.release_rescue_reports r
     where r.engagement_id = new.id
       and r.organization_id = new.organization_id
       and r.delivered_at is not null;

    if v_count = 0 then
      raise exception 'An engagement is delivered only once its report has been stamped delivered';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_release_rescue_1_lifecycle_preconditions on public.release_rescue_engagements;
create trigger trg_release_rescue_1_lifecycle_preconditions
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_lifecycle_preconditions();

-- 2c. The log. AFTER the row is written, with definer rights so that no role
-- signed in through the API needs — or has — an INSERT grant on the log.
--
-- `via` is derived from facts the trigger can see, not from anything the caller
-- wrote: a purge is a purge; a recovery carries the channel the graph trigger
-- established under invoker rights; any other move is attributed to the JWT
-- subject if there is one and to the server if there is not.
create or replace function public.record_release_rescue_engagement_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_via text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  v_via := case
    when new.status = 'purged' then 'retention_purge'
    when old.status = 'cancelled' and new.status = 'intake' then new.recovery_authorized_via
    when auth.uid() is not null then 'authenticated_operator'
    else 'service_role'
  end;

  insert into public.release_rescue_engagement_transitions
    (organization_id, engagement_id, from_status, to_status, actor_user_id, via, recovery_reason_code)
  values
    (new.organization_id, new.id, old.status, new.status,
     coalesce(auth.uid(), case when old.status = 'cancelled' and new.status = 'intake'
                                 then new.recovery_authorized_by end),
     v_via,
     case when old.status = 'cancelled' and new.status = 'intake' then new.recovery_reason_code end);

  return null;
end $$;

drop trigger if exists trg_release_rescue_engagement_transition_log on public.release_rescue_engagements;
create trigger trg_release_rescue_engagement_transition_log
  after update on public.release_rescue_engagements
  for each row execute function public.record_release_rescue_engagement_transition();

-- --------------------------------------------------------------------------------
-- 3. The reviewer is the caller
-- --------------------------------------------------------------------------------
--
-- The trust model is v5's, applied to the signature:
--
--   authenticated customer      may not sign a report at all (RLS, v1).
--   operations manager /        signs for themselves only: `reviewed_by` must be
--   platform admin              auth.uid(). Naming another manager is refused.
--   service role                may name a reviewer, because it IS the server —
--                               a server-side flow that has already authenticated
--                               the operator. The named person must still hold
--                               manager authority, and the channel is recorded.
--
-- SECURITY INVOKER, so `current_user` is the real caller.

alter table public.release_rescue_reports
  add column if not exists reviewed_via text
    check (reviewed_via is null or reviewed_via in ('authenticated_operator', 'service_role'));

comment on column public.release_rescue_reports.reviewed_via is
  'Which trusted channel bound the reviewer identity. Set by the trigger, never by the caller. Null on rows written before v14.';

create or replace function public.enforce_release_rescue_reviewer_is_caller()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_via is distinct from old.reviewed_via then
      raise exception 'Who signed a report, and through which channel, cannot be rewritten';
    end if;
    return new;
  end if;

  if public.caller_is_server() then
    if not public.release_rescue_user_holds_manager_authority(new.reviewed_by) then
      raise exception 'Report reviewer must be an ops manager or platform admin';
    end if;
    new.reviewed_via := 'service_role';
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Signing a report requires an authenticated operator';
  end if;
  if not coalesce(public.is_ops_manager(), false) then
    raise exception 'A report may only be signed by an ops manager or platform admin acting as themselves';
  end if;
  if new.reviewed_by is distinct from auth.uid() then
    -- Refused rather than corrected, as with ownership confirmation: a caller
    -- who names someone else is either confused or attacking.
    raise exception 'A report records the reviewer who signs it. It cannot be attributed to another person';
  end if;
  new.reviewed_via := 'authenticated_operator';

  return new;
end $$;

drop trigger if exists trg_release_rescue_reviewer_is_caller on public.release_rescue_reports;
create trigger trg_release_rescue_reviewer_is_caller
  before insert or update on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_reviewer_is_caller();

-- The same rule for the artifact an operator writes directly. The report ROW is
-- manager-only and v13 binds row to artifact, so a forged artifact signature
-- could not reach a customer through the row; this closes the artifact itself,
-- because platform staff may INSERT into evidence_artifacts and a report body
-- attributing its signature or its clearances to someone else is a caller-supplied
-- identity whichever table it lands in. The server path is unaffected.
create or replace function public.enforce_release_rescue_artifact_signature_is_caller()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_signature jsonb;
  v_hold jsonb;
begin
  -- The cheap test first: the server path pays nothing for the deep walk.
  if public.caller_is_server() then return new; end if;
  if not public.release_rescue_is_report(new.payload) then return new; end if;

  v_signature := new.payload->'reviewedBy';
  -- `is not null` first: jsonb_typeof of an absent key is SQL NULL (S-002, S-007).
  if v_signature is not null and jsonb_typeof(v_signature) = 'object' then
    if auth.uid() is null or (v_signature->>'operatorUserId') is distinct from auth.uid()::text then
      raise exception
        'A report artifact written by an operator records that operator as its reviewer. It cannot be attributed to another person';
    end if;
  end if;

  for v_hold in
    select * from jsonb_array_elements(coalesce(new.payload->'clearedSecretHolds', '[]'::jsonb))
  loop
    if auth.uid() is null or (v_hold->>'clearedBy') is distinct from auth.uid()::text then
      raise exception
        'A secret-hold clearance written by an operator records that operator. It cannot be attributed to another person';
    end if;
  end loop;

  return new;
end $$;

drop trigger if exists trg_release_rescue_artifact_signature_is_caller on public.evidence_artifacts;
create trigger trg_release_rescue_artifact_signature_is_caller
  before insert on public.evidence_artifacts
  for each row execute function public.enforce_release_rescue_artifact_signature_is_caller();

-- --------------------------------------------------------------------------------
-- 4. The column census, re-run with this file's columns registered
-- --------------------------------------------------------------------------------
--
-- v7 asserted that every destructive or approval-sensitive column has a recorded
-- control, and v13 widened its filter when it added columns the filter could not
-- see. The same again: `recover%` is added to the pattern and the new columns
-- are registered with the control that owns each.

do $$
declare
  v_known_engagements text[] := array[
    'purge_after',        -- derived (v5/v6 retention timing)
    'purged_at',          -- sweep only (v7)
    'created_at',         -- server-written (v6)
    'delivered_at',       -- lifecycle, monotonic via retention timing; required on entering delivered (v14)
    'retention_policy',   -- customer choice, shortening only (v1)
    'retention_days',     -- derived from the policy (v1)
    'status',             -- the lifecycle graph (v14) and the review-start gates (v1-v5)
    'ownership_confirmation', 'ownership_confirmed_by', 'ownership_confirmed_at',
    'ownership_confirmed_via',                      -- caller-authorised (v5)
    'reviewed_commit_sha', 'reviewed_commit_pinned_at', -- write-once (v4)
    'scope', 'scope_hash', 'organization_id', 'run_id', -- immutable (v2/v3/v5); run unique (v14)
    'ownership_confirmation_note',  -- customer content; cleared by the purge (v1)
    'recovery_reason_code', 'recovery_authorized_by', 'recovery_authorized_at',
    'recovery_authorized_via', 'recovery_count',    -- written by the recovery transition only (v14)
    'updated_at'                    -- bookkeeping; decides nothing destructive
  ];
  v_known_reports text[] := array[
    'purged_at',          -- sweep only (v7, both arms)
    'created_at',         -- server-written (v6)
    'delivered_at',       -- the one permitted update, then immutable (v2)
    'reviewed_at', 'reviewed_by',                   -- manager authority (v1); bound to the caller (v14)
    'reviewed_via',                                 -- set by the trigger, never by the caller (v14)
    'review_reason_code', 'review_approved_content_hash', -- attestation, write-once with the row (v13)
    'reviewed_commit_sha', 'reviewed_commit_pinned_at', -- pinned to the engagement (v4)
    'scope_hash',         -- immutable, bound to the frozen scope (v3)
    'organization_id', 'run_id', 'engagement_id',   -- immutable identity (v5); run bound to the engagement (v14)
    'report_artifact_id', -- cleared by the purge, never repointed (v2)
    'status'
  ];
  v_known_grants text[] := array[
    'created_at', 'expires_at', 'revoked_at', 'granted_at',
    'organization_id', 'engagement_id', 'updated_at'
  ];
  v_known_transitions text[] := array[
    'recorded_at',        -- server default; the table is trigger-written only (v14)
    'recovery_reason_code', -- copied from the recovery transition (v14)
    'organization_id', 'engagement_id'
  ];
  v_unowned text;
  v_table record;
begin
  for v_table in
    select * from (values
      ('release_rescue_engagements', v_known_engagements),
      ('release_rescue_reports', v_known_reports),
      ('release_rescue_repository_grants', v_known_grants),
      ('release_rescue_engagement_transitions', v_known_transitions)
    ) as t(name, known)
  loop
    select string_agg(column_name, ', ') into v_unowned
      from information_schema.columns
     where table_schema = 'public'
       and table_name = v_table.name
       and (column_name like '%_at' or column_name like '%purge%' or column_name like '%retention%'
            or column_name like '%ownership%' or column_name like 'scope%'
            or column_name like 'review%' or column_name like '%revok%'
            or column_name like 'recover%' or column_name = 'status')
       and not (column_name = any (v_table.known));

    if v_unowned is not null then
      raise exception
        'These destructive or approval-sensitive columns on % have no recorded control: %',
        v_table.name, v_unowned;
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------------
-- 5. Assertions, so a later edit fails the migration rather than the customer
-- --------------------------------------------------------------------------------

do $$
declare
  v_problem text;
  v_body text;
begin
  -- Caller-deciding functions must be invoker, or `current_user` is the owner.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enforce_release_rescue_lifecycle_graph',
                         'enforce_release_rescue_reviewer_is_caller',
                         'enforce_release_rescue_artifact_signature_is_caller')
       and p.prosecdef
  ) then
    raise exception 'A caller-deciding function is SECURITY DEFINER and would answer for the wrong role';
  end if;

  -- Every security-definer function in this workstream locks search_path.
  select string_agg(p.proname, ', ') into v_problem
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'release\_rescue%' or p.proname like 'enforce\_release\_rescue%'
          or p.proname like 'record\_release\_rescue%'
          or p.proname = 'purge_expired_release_rescue_data')
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search\_path=%'
     );
  if v_problem is not null then
    raise exception 'These security-definer functions do not lock search_path: %', v_problem;
  end if;

  -- The run is exclusive to one engagement.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'release_rescue_engagements'
       and indexname = 'release_rescue_engagements_run_unique_idx'
       and indexdef like 'CREATE UNIQUE INDEX%'
  ) then
    raise exception 'The engagement run index is not unique; a run could belong to two engagements';
  end if;

  -- The graph refuses what S-009 measured as accepted, and admits the order.
  if not public.release_rescue_engagement_transition_allowed('intake', 'scoped')
     or not public.release_rescue_engagement_transition_allowed('report_ready', 'delivered')
     or not public.release_rescue_engagement_transition_allowed('auditing', 'cancelled') then
    raise exception 'The lifecycle graph refuses a transition on the normal path';
  end if;
  if public.release_rescue_engagement_transition_allowed('intake', 'access_granted')
     or public.release_rescue_engagement_transition_allowed('access_granted', 'intake')
     or public.release_rescue_engagement_transition_allowed('cancelled', 'scoped')
     or public.release_rescue_engagement_transition_allowed('cancelled', 'intake')
     or public.release_rescue_engagement_transition_allowed('delivered', 'report_ready')
     or public.release_rescue_engagement_transition_allowed('delivered', 'cancelled')
     or public.release_rescue_engagement_transition_allowed('intake', 'purged') then
    raise exception 'The lifecycle graph admits a transition that is not on the normal path';
  end if;

  -- The sweep still does not clear the reviewed commit (carried forward from v4,
  -- because this file redefines the sweep).
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_expired_release_rescue_data';
  if v_body ~* 'reviewed_commit_sha\s*=' then
    raise exception 'The retention sweep clears reviewed_commit_sha, which is accounting evidence and must survive';
  end if;
  if v_body !~ 'Retention sweep refused' then
    raise exception 'The retention sweep no longer refuses to delete evidence on a shared run';
  end if;

  -- The lifecycle triggers fire before the existing gates.
  if exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.release_rescue_engagements'::regclass
       and not t.tgisinternal
       and t.tgname < 'trg_release_rescue_0_lifecycle_graph'
  ) then
    raise exception 'A trigger on release_rescue_engagements sorts ahead of the lifecycle graph';
  end if;
end $$;
