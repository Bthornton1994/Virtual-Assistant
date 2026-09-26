-- Disposable-Postgres shim for the Release Rescue SQL proof suite.
--
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- It creates the auth/storage/role surface the migration chain and
-- supabase/qa/release_rescue_*_proof.sql files assume, so the proofs can run
-- against vanilla PostgreSQL 16 the way the isolation proof documents:
--
--   createdb release_rescue_proof
--   psql -d release_rescue_proof -f supabase/qa/release_rescue_proof_shim.sql
--   -- then apply supabase/migrations and the fifteen proofs
--
-- This is the "<supabase shim creating auth/extensions/roles>" named in
-- release_rescue_v1_isolation_proof.sql. It does not change product schema
-- semantics. It does not grant merge, deploy, payment, or production access.

\set ON_ERROR_STOP on

create extension if not exists pgcrypto;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  else
    alter role service_role with bypassrls;
  end if;
end
$roles$;

grant anon to current_user;
grant authenticated to current_user;
grant service_role to current_user;

create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role, public;
grant usage on schema extensions to anon, authenticated, service_role, public;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    current_user
  );
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'email', nullif(current_setting('request.jwt.claim.email', true), ''),
      'role', nullif(current_setting('request.jwt.claim.role', true), '')
    ))
  );
$$;

grant execute on function auth.uid() to public;
grant execute on function auth.role() to public;
grant execute on function auth.jwt() to public;

-- Vanilla PostgreSQL installs pgcrypto into public. Release Rescue qualifies
-- digest as extensions.digest (the Supabase location). The architecture
-- document records these two wrappers as the disposable-base environment gap,
-- not a product defect.
create or replace function extensions.digest(text, text)
returns bytea
language sql
immutable
parallel safe
as $$ select public.digest($1, $2) $$;

create or replace function extensions.digest(bytea, text)
returns bytea
language sql
immutable
parallel safe
as $$ select public.digest($1, $2) $$;

grant execute on function extensions.digest(text, text) to public;
grant execute on function extensions.digest(bytea, text) to public;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

grant select, insert, update on storage.buckets to authenticated, anon, service_role;
grant select, insert, update on storage.objects to authenticated, anon, service_role;
grant all on storage.buckets to service_role;
grant all on storage.objects to service_role;

alter default privileges in schema public
  grant select, insert, update on tables to anon, authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
