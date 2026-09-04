-- Operational Memory Control Plane v1 structural QA proof.
-- Run only against the dedicated QA/Preview Supabase project after applying
-- 20260904120000_memory_control_plane_persistence_v1.sql.
-- This proof is intentionally read-only. The end-to-end write/read/erase probe
-- belongs in an isolated project fixture because the persistence RPC requires
-- real same-tenant organizations, runs, assignments, and evidence artifacts.

do $$
declare
  v_rls boolean;
begin
  if to_regclass('public.operational_memory_records') is null then
    raise exception 'Missing operational_memory_records';
  end if;
  if to_regclass('public.operational_memory_erasures') is null then
    raise exception 'Missing operational_memory_erasures';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'operational_memory_records';
  if coalesce(v_rls, false) is not true then
    raise exception 'operational_memory_records must have RLS enabled';
  end if;

  select c.relrowsecurity into v_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'operational_memory_erasures';
  if coalesce(v_rls, false) is not true then
    raise exception 'operational_memory_erasures must have RLS enabled';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('operational_memory_records', 'operational_memory_erasures')
      and grantee in ('public', 'anon', 'authenticated')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRIGGER')
  ) then
    raise exception 'Operational memory tables must not be directly granted to browser roles';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.persist_operational_memory(jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute persist_operational_memory';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.read_operational_memories(uuid,integer)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute read_operational_memories';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.erase_operational_memory(uuid,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute erase_operational_memory';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.claim_execution_step_with_memory(text,text,text,text,text,text,text,text,text,jsonb,integer)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute the atomic memory claim wrapper';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'operational_memory_records'
      and t.tgname = 'trg_operational_memory_record_invariants'
      and not t.tgisinternal
  ) then
    raise exception 'Missing append-only operational memory trigger';
  end if;

  if not exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'execution_attempts'
      and a.attname = 'memory_binding_hash'
      and not a.attisdropped
  ) then
    raise exception 'Execution attempts must carry memory_binding_hash';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'claim_execution_step_with_memory'
  ) then
    raise exception 'Missing atomic memory claim wrapper';
  end if;
end;
$$;

select
  'memory_control_plane_v1_structural_proof' as proof,
  true as passed,
  now() as verified_at;
