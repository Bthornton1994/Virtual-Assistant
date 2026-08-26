-- Registry privilege hardening.
--
-- Supabase project default privileges can grant newly-created public tables more
-- capabilities than an explicit positive GRANT removes. Reset these registry
-- tables to least privilege after CS-1 and CS-12 exist.

revoke all privileges
  on table public.capabilities, public.executor_capabilities, public.native_skills
  from anon, authenticated, public;

grant select, insert, update
  on table public.capabilities, public.executor_capabilities, public.native_skills
  to authenticated;

grant all privileges
  on table public.capabilities, public.executor_capabilities, public.native_skills
  to service_role;
