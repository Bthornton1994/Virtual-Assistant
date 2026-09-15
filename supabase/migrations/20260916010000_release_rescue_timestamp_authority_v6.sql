-- AI App Release Rescue v6: server time is the only time that counts.
--
-- A fourth independent audit found that v5 closed one caller-named destruction
-- moment and opened another through a different column.
--
-- v5 stopped deriving `purge_after` from caller input, which was right. But it
-- derived it from `created_at` — an ordinary column with a `now()` DEFAULT, which
-- `authenticated` may write on INSERT, and which no trigger protected. An
-- ordinary customer insert with `created_at = now() + interval '10 years'`
-- produced a `purge_after` 3713 days out, observed:
--
--     created_at  2036-09-15 20:09:23+00
--     purge_after 2036-11-14 20:09:23+00
--     retained    10 years 1 mon 28 days
--
-- The v1 trigger it superseded had been anchored on `now()` and was correct. v5's
-- own commit message says caller input is "discarded, not validated"; that was
-- true of the field it was written about and false of the field it started
-- reading.
--
-- The property, stated once so there is nothing left to re-derive: NO TIMESTAMP
-- THAT DECIDES WHEN CUSTOMER DATA IS DESTROYED MAY COME FROM A CALLER. Not
-- directly, not through another column, not through a column that defaults to
-- something trustworthy. The retention clock reads `now()`, the stored retention
-- policy, and the lifecycle state, and nothing else.
--
-- Additive only; earlier migrations are not edited.

-- --------------------------------------------------------------------------------
-- 1. `created_at` is written by the server, on every row, always
-- --------------------------------------------------------------------------------
--
-- Overwritten rather than rejected. A rejection is a rule an attacker probes for
-- gaps; a column whose value is simply replaced has no gap to find. The same
-- reasoning v5 applied to `purge_after`, applied to the column v5 then trusted.
--
-- Immutable afterwards, because an engagement's creation time is audit evidence:
-- v5 let it be moved to 2031 after the fact with no refusal, which made the
-- engagement's own history unreliable even where retention was unaffected.

create or replace function public.enforce_release_rescue_created_at_authority()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    return new;
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Engagement creation time is recorded by the server and cannot be rewritten';
  end if;
  return new;
end;
$$;

-- Fires before `trg_release_rescue_retention_timing` (c < r), so the derivation
-- below always reads a server-written value.
drop trigger if exists trg_release_rescue_created_at_authority on public.release_rescue_engagements;
create trigger trg_release_rescue_created_at_authority
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_created_at_authority();

-- Belt and braces: `authenticated` has no business naming the column at all.
-- The trigger already overwrites it, so this changes nothing an honest client
-- does; it removes the column from the surface an attacker can even mention.
revoke insert (created_at) on table public.release_rescue_engagements from authenticated;

-- --------------------------------------------------------------------------------
-- 2. The retention clock reads server time
-- --------------------------------------------------------------------------------
--
-- The backstop is anchored on `now()` again. `created_at` is a server value now,
-- so the two agree at INSERT; they are separated anyway because the derivation
-- must not depend on a column staying trustworthy. Depending on a guarantee
-- another trigger provides is how v5 broke.

create or replace function public.derive_release_rescue_purge_after(
  p_created_at timestamptz,
  p_delivered_at timestamptz,
  p_retention_days integer
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  -- p_created_at is accepted for signature compatibility with v5 and is
  -- deliberately NOT used: the backstop is measured from server time, not from
  -- any column. A caller who could move the anchor could move the deadline.
  select least(
    now() + interval '60 days',
    case
      when p_delivered_at is null then now() + interval '60 days'
      else p_delivered_at + make_interval(days => greatest(least(coalesce(p_retention_days, 0), 30), 0))
    end
  );
$$;

comment on function public.derive_release_rescue_purge_after(timestamptz, timestamptz, integer) is
  'Retention deadline from server time, the elected policy and the lifecycle state. The first argument is unused on purpose: no caller-reachable column may move this deadline.';

create or replace function public.enforce_release_rescue_retention_timing()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_derived timestamptz;
begin
  if tg_op = 'INSERT' then
    new.purge_after := public.derive_release_rescue_purge_after(null, new.delivered_at, new.retention_days);
    return new;
  end if;

  v_derived := public.derive_release_rescue_purge_after(null, new.delivered_at, new.retention_days);

  -- Monotonically earlier, never later than the derivation allows. A purged row
  -- keeps the deadline it was purged against.
  if old.purged_at is not null then
    new.purge_after := old.purge_after;
    return new;
  end if;
  new.purge_after := least(coalesce(old.purge_after, v_derived), v_derived);
  return new;
end;
$$;

-- --------------------------------------------------------------------------------
-- 3. Assertions
-- --------------------------------------------------------------------------------

do $$
declare
  v_body text;
begin
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'derive_release_rescue_purge_after';

  -- The derivation must not read its own first argument. Stated as a schema
  -- assertion because "we removed that dependency" is exactly the kind of claim
  -- that quietly comes back.
  if v_body ~ 'coalesce\(p_created_at' or v_body ~ 'p_created_at \+' then
    raise exception 'The retention derivation reads a caller-reachable creation timestamp again';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.release_rescue_engagements'::regclass
       and tgname = 'trg_release_rescue_created_at_authority'
  ) then
    raise exception 'The creation-time authority trigger is missing';
  end if;

  -- Trigger order decides which value the derivation sees. Postgres fires
  -- BEFORE triggers in name order, so this must sort first.
  if 'trg_release_rescue_created_at_authority' >= 'trg_release_rescue_retention_timing' then
    raise exception 'The creation-time trigger no longer fires before the retention derivation';
  end if;
end;
$$;
