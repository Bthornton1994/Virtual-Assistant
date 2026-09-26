-- AI App Release Rescue v5: the trust boundary, rebuilt.
--
-- A third independent audit reproduced five blocking findings. Two of them are
-- structural rather than textual, and they are fixed here, together, before
-- anything else is touched:
--
--   B3  An organization admin could cause ANOTHER organization's evidence to be
--       deleted by the platform's own retention sweep. `run_id` was a
--       single-column foreign key with no immutability rule, the sweep deleted
--       evidence keyed on that column, and `purge_after` was caller-supplied at
--       INSERT with a past value accepted.
--
--   B1  The ownership gate validated the role of the person NAMED in
--       `ownership_confirmed_by`. It never asked who was calling. A customer
--       wrote an ops manager's UUID into the column and the gate passed — and the
--       org-scoped SELECT policy hands them that UUID on their first legitimate
--       engagement.
--
-- Both are the same class of mistake, and it is the class the audit named: a
-- guard written as a VALIDITY CHECK ON A VALUE IN `NEW`, where the property needs
-- a privilege check on the caller (B1) or a referential-integrity constraint
-- (B3). Sharpening the checks again would produce the same audit a sixth time.
-- So this migration moves the decisions to where they can be decided:
--
--   * relationships become constraints the database enforces, not fields a
--     trigger inspects;
--   * authorization becomes a question about `auth.uid()` and `current_user`,
--     not about a UUID the caller supplied;
--   * retention timing becomes server-derived state, not caller input.
--
-- Additive only; earlier migrations are not edited.

-- --------------------------------------------------------------------------------
-- 1. Organization and run are bound by the database, not by a trigger
-- --------------------------------------------------------------------------------
--
-- `release_rescue_reports` already had the composite pair. The engagement — the
-- row the sweep actually walks — did not, which is precisely where it mattered.
-- `workstream_runs` carries `unique (id, organization_id)` from 20260822182149,
-- so the composite reference is available and always was.
--
-- ON DELETE RESTRICT, not SET NULL: the old single-column rule would have nulled
-- `run_id` and orphaned an engagement's evidence from the sweep that is supposed
-- to remove it. A run that an engagement points at is not deletable.

alter table public.release_rescue_engagements
  drop constraint if exists release_rescue_engagements_run_id_fkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'release_rescue_engagements_run_organization_fkey'
       and conrelid = 'public.release_rescue_engagements'::regclass
  ) then
    alter table public.release_rescue_engagements
      add constraint release_rescue_engagements_run_organization_fkey
      foreign key (run_id, organization_id)
      references public.workstream_runs (id, organization_id) on delete restrict;
  end if;
end;
$$;

-- The same binding for the grant, so a grant cannot name a repository under one
-- organization's engagement while belonging to another. (The composite
-- engagement reference already exists; this asserts it rather than assuming it.)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'release_rescue_grants_engagement_fkey'
       and conrelid = 'public.release_rescue_repository_grants'::regclass
  ) then
    raise exception 'The grant composite engagement foreign key is missing; v1 is expected to provide it';
  end if;
end;
$$;

-- --------------------------------------------------------------------------------
-- 2. Identity is immutable once written
-- --------------------------------------------------------------------------------
--
-- The composite key stops an engagement naming another organization's run. This
-- stops it being REPOINTED later — including at a run inside the same
-- organization that belongs to unrelated work, which the key alone permits.
--
-- `run_id` may go from NULL to a value exactly once, because the run is created
-- when the review starts and the engagement exists before that.

create or replace function public.enforce_release_rescue_identity_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'Engagement organization is immutable';
  end if;

  if old.run_id is not null and new.run_id is distinct from old.run_id then
    raise exception 'Engagement run is pinned once and cannot be reassigned';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_identity_immutable on public.release_rescue_engagements;
create trigger trg_release_rescue_identity_immutable
  before update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_identity_immutable();

-- --------------------------------------------------------------------------------
-- 3. Retention timing is server state, not caller input
-- --------------------------------------------------------------------------------
--
-- `purge_after` was `least(coalesce(NEW.purge_after, now() + 60d), now() + 60d)`,
-- which accepts any value in the past. Supplying `now() - 1 day` made the
-- engagement immediately due for the sweep, which is the trigger the cross-tenant
-- deletion pulled.
--
-- The value is now DERIVED and the caller's input is discarded. There is no
-- legitimate reason for a client to name the moment their data is destroyed: they
-- choose a retention POLICY, and the policy determines the moment.
--
-- It still only ever moves earlier, so shortening retention still works, and it
-- still cannot be extended.

create or replace function public.derive_release_rescue_purge_after(
  p_created_at timestamptz,
  p_delivered_at timestamptz,
  p_retention_days integer
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select least(
    coalesce(p_created_at, now()) + interval '60 days',
    case
      when p_delivered_at is null then coalesce(p_created_at, now()) + interval '60 days'
      else p_delivered_at + make_interval(days => greatest(coalesce(p_retention_days, 0), 0))
    end
  );
$$;

create or replace function public.enforce_release_rescue_retention_timing()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_derived timestamptz;
begin
  if tg_op = 'INSERT' then
    -- Whatever the caller supplied is discarded, not validated. A validation
    -- rule is a thing an attacker probes; an ignored field is not.
    new.purge_after := public.derive_release_rescue_purge_after(
      coalesce(new.created_at, now()), new.delivered_at, new.retention_days);
    return new;
  end if;

  v_derived := public.derive_release_rescue_purge_after(
    old.created_at, new.delivered_at, new.retention_days);

  -- Monotonically earlier, and never later than the derivation allows.
  new.purge_after := least(coalesce(old.purge_after, v_derived), v_derived);
  return new;
end;
$$;

-- Runs AFTER the v1 invariants trigger (which also touches purge_after) because
-- of the name ordering, so this derivation is the last word.
drop trigger if exists trg_release_rescue_retention_timing on public.release_rescue_engagements;
create trigger trg_release_rescue_retention_timing
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_retention_timing();

-- --------------------------------------------------------------------------------
-- 4. The sweep cannot reach outside the engagement it is purging
-- --------------------------------------------------------------------------------
--
-- Defence in depth on top of the composite key: even if the relationship were
-- weakened again, the delete is scoped by the engagement's own organization, so
-- a run belonging to another tenant matches nothing.
--
-- The sweep takes no caller-supplied target. `p_invoked_by` is a label for the
-- audit row and is validated against a closed set; it selects nothing.

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
      delete from public.evidence_artifacts
       where run_id = v_engagement.run_id
         -- The organization scope is the point. Without it, the sweep's reach is
         -- whatever `run_id` happens to hold.
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
-- 5. Ownership confirmation is authorized by the CALLER
-- --------------------------------------------------------------------------------
--
-- The trust model, stated once, for every caller class:
--
--   unauthenticated (anon)      may not write engagements at all (RLS).
--   authenticated customer      may not confirm ownership. Ever.
--   organization admin          may not confirm ownership. Naming an operations
--                               manager does not make them one, and the UUID is
--                               visible to them on their own rows.
--   operations manager /        may confirm ownership, for themselves only:
--   platform admin              `ownership_confirmed_by` is FORCED to auth.uid().
--   service role                may confirm ownership naming an operator, because
--                               it IS the server — a server-side flow that has
--                               already authenticated the operator. The named
--                               person must still hold manager authority, and the
--                               channel is recorded so an audit can tell the two
--                               apart.
--
-- SECURITY INVOKER, deliberately. `current_user` must be the real caller for the
-- service-role branch to mean anything; inside a definer function it would be the
-- owner and every caller would look like the server. `auth.uid()` is unaffected
-- either way (it reads a transaction GUC), and `public.is_ops_manager()` is an
-- existing definer helper that answers about the CALLER — which is exactly the
-- question the old gate failed to ask.

alter table public.release_rescue_engagements
  add column if not exists ownership_confirmed_via text
    check (ownership_confirmed_via is null
           or ownership_confirmed_via in ('authenticated_operator', 'service_role'));

comment on column public.release_rescue_engagements.ownership_confirmed_via is
  'Which trusted channel authorized the ownership confirmation. Set by the trigger, never by the caller.';

-- A definer helper for the service-role branch: `authenticated` cannot read
-- public.operators, and the trigger is invoker, so the lookup needs its own
-- elevation. It answers only yes/no about one user and leaks nothing else.
create or replace function public.release_rescue_user_holds_manager_authority(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.operators
     where user_id = p_user_id
       and platform_role in ('ops_manager', 'platform_admin')
  );
$$;

revoke all on function public.release_rescue_user_holds_manager_authority(uuid) from public;
grant execute on function public.release_rescue_user_holds_manager_authority(uuid) to authenticated, service_role;

create or replace function public.caller_is_server()
returns boolean
language sql
stable
set search_path = public
as $$
  -- `current_user` is meaningful only under INVOKER rights. Every caller of this
  -- helper must therefore be an invoker-rights function; under definer rights it
  -- would answer "yes, the server" for every caller alive, which is a fail-open.
  -- The assertion block at the end of this migration enforces that.
  select coalesce(
    pg_has_role(current_user, 'service_role', 'MEMBER')
      or current_user in ('postgres', 'supabase_admin'),
    false);
$$;

-- --------------------------------------------------------------------------------
-- 5b. `is_ops_manager()` must never answer NULL
-- --------------------------------------------------------------------------------
--
-- Found by this migration's own proof, and worth stating plainly because it is a
-- fail-open in a helper the whole schema leans on.
--
-- `platform_role()` returns NULL for a user who is not an operator, and
-- `NULL in ('ops_manager','platform_admin')` is NULL, not false. In an RLS policy
-- that is safe: a NULL `USING` clause denies. In plpgsql it is not: `if not NULL`
-- is NULL, the branch does not fire, and execution falls THROUGH the guard.
--
-- So the first version of the ownership check below let an organization admin
-- past the "are you a manager" test and only stopped them at the next one. It
-- happened to stop them; it stopped them for the wrong reason, and a guard that
-- passes by accident is one refactor away from not passing at all.
--
-- Fixed at the source, so every future plpgsql caller inherits a real boolean.
-- Existing RLS callers are unaffected: NULL and false deny identically there.

create or replace function public.is_ops_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.platform_role() in ('ops_manager', 'platform_admin'), false);
$$;

create or replace function public.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_role() is not null;
$$;

create or replace function public.enforce_release_rescue_ownership_evidence()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_setting_confirmation boolean;
begin
  v_setting_confirmation :=
    new.ownership_confirmation is not null
    and (tg_op = 'INSERT' or old.ownership_confirmation is null);

  -- One-way and attributable. (Carried forward from v1.)
  if tg_op = 'UPDATE' and old.ownership_confirmation is not null
     and new.ownership_confirmation is distinct from old.ownership_confirmation then
    raise exception 'Ownership confirmation cannot be changed once recorded';
  end if;

  if v_setting_confirmation then
    if length(trim(coalesce(new.ownership_confirmation_note, ''))) = 0 then
      raise exception 'Ownership confirmation must record how ownership was established';
    end if;

    if public.caller_is_server() then
      -- Server-side flow. It must still name a real manager: the server asserts
      -- WHO confirmed, not THAT anyone did.
      if new.ownership_confirmed_by is null then
        raise exception 'Ownership confirmation must name the person who made it';
      end if;
      if not public.release_rescue_user_holds_manager_authority(new.ownership_confirmed_by) then
        raise exception 'Ownership may only be confirmed by an ops manager or platform admin';
      end if;
      new.ownership_confirmed_via := 'service_role';
    else
      -- Interactive flow. The caller is the confirmer, and nothing they put in
      -- the column is consulted.
      if auth.uid() is null then
        raise exception 'Ownership confirmation requires an authenticated operator';
      end if;
      -- coalesce even though the helper is fixed above: a guard that depends on
      -- a distant function's null-handling is a guard waiting to fail open.
      if not coalesce(public.is_ops_manager(), false) then
        raise exception
          'Ownership may only be confirmed by an ops manager or platform admin acting as themselves';
      end if;
      if new.ownership_confirmed_by is distinct from auth.uid() then
        -- Refused rather than silently corrected: a caller who names someone else
        -- is either confused or attacking, and both deserve to be told.
        raise exception
          'Ownership confirmation records the caller. It cannot be attributed to another person';
      end if;
      new.ownership_confirmed_via := 'authenticated_operator';
    end if;

    if new.ownership_confirmed_at is null then
      new.ownership_confirmed_at := now();
    end if;
  end if;

  -- Attribution is never dropped or rewritten, purge or not.
  if tg_op = 'UPDATE' and old.ownership_confirmation is not null then
    if new.ownership_confirmed_by is distinct from old.ownership_confirmed_by
       or new.ownership_confirmed_at is distinct from old.ownership_confirmed_at
       or new.ownership_confirmed_via is distinct from old.ownership_confirmed_via then
      raise exception 'Who confirmed ownership, and when, cannot be rewritten';
    end if;
  end if;

  -- The gate. Unconditional on the customer-declared access mode (v3), and now
  -- resting on a confirmation only a trusted caller could have written.
  if public.release_rescue_status_starts_review(new.status)
     and new.ownership_confirmation is null then
    raise exception
      'No review starts before an operator records how ownership of this repository was established';
  end if;

  if public.release_rescue_status_starts_review(new.status) and new.access_mode is null then
    raise exception 'The engagement must record its access mode before the review starts';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_ownership_evidence on public.release_rescue_engagements;
create trigger trg_release_rescue_ownership_evidence
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_ownership_evidence();

-- --------------------------------------------------------------------------------
-- 5c. The same fail-open, in another workstream
-- --------------------------------------------------------------------------------
--
-- `enforce_step3d_artifact_authority` (20260827132000) is written
-- `... and not public.is_ops_manager() then raise`. With the helper returning
-- NULL for a non-operator, that branch never fired, so ANY authenticated caller
-- could write a typed execution artifact. Fixing the helper closes that hole —
-- and would also have blocked the legitimate writer, because a service-role or
-- superuser caller has no `auth.uid()` either and now reads as a plain false.
--
-- So the guard is restated to say what it actually means. This is the only edit
-- in this migration outside the Release Rescue workstream, and it is here because
-- fixing the helper without it would trade a security hole for an outage.

create or replace function public.enforce_step3d_artifact_authority()
returns trigger
language plpgsql
set search_path = public
as $$
declare declared_version text;
begin
  declared_version := new.payload->>'schemaVersion';
  if declared_version is null then return new; end if;
  if declared_version in (
    'catalog-evidence-input/v1',
    'catalog-evidence-packet/v1',
    'catalog-evidence-review/v1',
    'catalog-evidence-validation/v1',
    'catalog-evidence-rejection/v1',
    'supplier-sourcing-input/v1',
    'supplier-sourcing-packet/v1',
    'supplier-sourcing-review/v1',
    'supplier-sourcing-validation/v1',
    'supplier-sourcing-rejection/v1',
    'supplier-outreach-approval/v1',
    'supplier-outreach-result/v1'
  ) and not (coalesce(public.is_ops_manager(), false) or public.caller_is_server()) then
    raise exception 'Typed execution artifacts may only be written by an operations manager or the server';
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------------
-- 6. Assertions, so a later edit fails the migration rather than the customer
-- --------------------------------------------------------------------------------

do $$
declare
  v_problem text;
begin
  -- The ownership gate must not be security definer: under definer rights
  -- `current_user` is the owner and the service-role branch would match everyone.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('enforce_release_rescue_ownership_evidence',
                         'enforce_step3d_artifact_authority',
                         'caller_is_server',
                         'enforce_release_rescue_identity_immutable',
                         'enforce_release_rescue_retention_timing')
       and p.prosecdef
  ) then
    raise exception 'A caller-deciding function is SECURITY DEFINER and would answer for the wrong role';
  end if;

  -- Every security-definer function in this workstream must lock search_path.
  select string_agg(p.proname, ', ') into v_problem
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'release\_rescue%' or p.proname like 'enforce\_release\_rescue%'
          or p.proname = 'purge_expired_release_rescue_data')
     and p.prosecdef
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search\_path=%'
     );
  if v_problem is not null then
    raise exception 'These security-definer functions do not lock search_path: %', v_problem;
  end if;

  -- A boolean authorization helper that can answer NULL is a fail-open in any
  -- plpgsql caller. Proven here rather than assumed.
  if (select public.is_ops_manager()) is null then
    raise exception 'is_ops_manager() can return NULL, which falls through a plpgsql guard';
  end if;

  -- The engagement must carry the composite run reference.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.release_rescue_engagements'::regclass
       and contype = 'f'
       and confrelid = 'public.workstream_runs'::regclass
       and cardinality(conkey) = 2
  ) then
    raise exception 'The engagement run reference is not composite; cross-tenant binding is unenforced';
  end if;
end;
$$;
