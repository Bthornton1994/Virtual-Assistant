-- AI App Release Rescue hardening v3: close the PROPERTIES, not the examples.
--
-- The second independent audit made one criticism, and it was correct: each v2
-- fix closed the literal statement the first audit had executed, while the
-- property that statement was an example of stayed open. Three of them were
-- demonstrated again against a live database:
--
--   1. The archive ownership gate fired on `access_mode = 'customer_uploaded_archive'`,
--      a value the customer chooses. Declaring a different mode skipped it.
--   2. The scope-freeze trigger read the raw `delegation.retention_purge` GUC,
--      which any role may set_config, so the purge stub was forgeable.
--   3. The pre-review grant check counted grant rows without asking whether they
--      were live or whether they named the repository under review.
--
-- Each fix below is written against the property. Additive only; earlier
-- migrations are not edited.

-- --------------------------------------------------------------------------------
-- 1. Ownership is established for EVERY engagement, not for a label
-- --------------------------------------------------------------------------------
--
-- The previous gate asked "is this an uploaded archive?" and only then asked for
-- ownership evidence. `access_mode` is supplied by the customer at intake, so the
-- question was answered by the party the gate exists to constrain.
--
-- The generalisation is the fix: no review starts on ANY engagement until a named
-- operator holding manager authority has recorded how ownership was established.
-- The access mode stops being load-bearing, because nothing branches on it.
--
-- This is the same standard the delivery gate already applies at the other end of
-- the engagement (a named human reviewer), applied at the point where reading a
-- stranger's source begins. It is deliberately manual: "we will not review code
-- you do not own" is one of two boundaries this service cannot cross, and a
-- boundary enforced by a customer-supplied enum is not enforced.

create or replace function public.enforce_release_rescue_ownership_evidence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Ownership confirmation is one-way and attributable. (Carried forward from
  -- hardening v1 unchanged; this function replaces that one wholesale.)
  if tg_op = 'UPDATE' and old.ownership_confirmation is not null
     and new.ownership_confirmation is distinct from old.ownership_confirmation then
    raise exception 'Ownership confirmation cannot be changed once recorded';
  end if;

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

  -- The gate, now unconditional on the customer-declared mode.
  if public.release_rescue_status_starts_review(new.status)
     and new.ownership_confirmation is null then
    raise exception
      'No review starts before an operator records how ownership of this repository was established';
  end if;

  -- An access mode we do not recognise cannot be assumed safe.
  if public.release_rescue_status_starts_review(new.status) and new.access_mode is null then
    raise exception 'The engagement must record its access mode before the review starts';
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------------
-- 2. One privileged answer to "are we inside the purge?"
-- --------------------------------------------------------------------------------
--
-- v2 introduced `release_rescue_in_retention_purge()` precisely because the raw
-- GUC is forgeable, then left the scope-freeze trigger reading the raw GUC. So a
-- caller with UPDATE rights could still set the flag and overwrite a frozen scope
-- with the purge stub, destroying the record of what was reviewed.
--
-- The helper is now the only reader of that GUC in the schema. The trigger is
-- SECURITY INVOKER for the same reason the report immutability trigger is: inside
-- a SECURITY DEFINER function current_user is the OWNER, so a privilege check
-- written there answers for the wrong role and always passes.

create or replace function public.enforce_release_rescue_scope_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.scope is distinct from old.scope then
    if public.release_rescue_in_retention_purge()
       and new.scope = jsonb_build_object('purged', true) then
      return new;
    end if;
    raise exception 'Engagement scope is frozen at intake and cannot be rewritten';
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------------------------------
-- 3. A grant counts only while it is live and only for the repository under review
-- --------------------------------------------------------------------------------
--
-- The v2 check counted any grant row for the engagement at `read_only`. It did
-- not ask whether the customer had revoked it, whether it had expired, or whether
-- it named the repository the scope says is being reviewed. All three are the
-- same property: the grant must be the access this review is actually relying on,
-- at the moment the review starts.
--
-- "Read-only, time-boxed, customer-revocable" is a promise in the offer document.
-- A check that ignores revocation and expiry is that promise not being kept.

create or replace function public.enforce_release_rescue_access_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_mode text;
  v_scope_ref text;
  v_live_grants integer;
begin
  if tg_op = 'UPDATE' and new.access_mode is distinct from old.access_mode and old.access_mode is not null then
    raise exception 'Engagement access mode is fixed at intake and cannot be changed';
  end if;

  v_scope_mode := new.scope #>> '{repository,accessMode}';
  if v_scope_mode is not null and new.access_mode is not null and v_scope_mode is distinct from new.access_mode then
    raise exception 'Engagement access mode "%" contradicts the frozen scope ("%")', new.access_mode, v_scope_mode;
  end if;

  if public.release_rescue_status_starts_review(new.status) then
    v_scope_ref := new.scope #>> '{repository,repositoryRef}';
    if v_scope_ref is null then
      raise exception 'The frozen scope must name the repository before the review starts';
    end if;

    select count(*) into v_live_grants
      from public.release_rescue_repository_grants g
     where g.engagement_id = new.id
       and g.organization_id = new.organization_id
       and g.access_level = 'read_only'
       and g.repository_ref = v_scope_ref
       and g.revoked_at is null
       and g.expires_at > now();

    if v_live_grants = 0 then
      raise exception
        'A review cannot start without a live, unrevoked read-only grant naming the repository in the frozen scope';
    end if;
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------------
-- 4. Nothing else may read the purge flag directly
-- --------------------------------------------------------------------------------
--
-- Recorded as a schema-level assertion rather than a comment, because the v2
-- regression was exactly this: the helper existed and one site kept reading the
-- raw GUC. This fails the migration if a third site is ever added.
do $$
declare
  v_offenders text;
begin
  select string_agg(p.proname, ', ')
    into v_offenders
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'release\_rescue%' or p.proname like 'enforce\_release\_rescue%')
     and p.proname <> 'release_rescue_in_retention_purge'
     and pg_get_functiondef(p.oid) like '%delegation.retention_purge%';

  if v_offenders is not null then
    raise exception 'These functions read the forgeable purge GUC directly: %', v_offenders;
  end if;
end;
$$;
