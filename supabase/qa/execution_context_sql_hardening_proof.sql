-- Execution Context SQL hardening proof.
--
-- NEVER apply this file to a real Supabase project (local, QA, or Production).
-- This is not a stand-in replacement for the migration functions. It inspects
-- the LIVE catalog names created by
-- supabase/migrations/20260909190000_execution_context_sql_hardening_v1.sql.
--
-- Usage (disposable local Postgres only, after the real migration is applied):
--   psql -d <disposable> -v ON_ERROR_STOP=1 -f supabase/qa/execution_context_sql_hardening_proof.sql
--
-- If that database does not exist, SQL execution is NOT VERIFIED.

\set ON_ERROR_STOP on

select 'execution_context_sql_hardening_v1_not_applied_to_supabase' as proof_marker;

do $$
declare
  v_prosecdef boolean;
  v_execute_roles text;
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_work_cell_phase_artifact'
  ) then
    raise exception 'SQL live NOT VERIFIED: public.record_work_cell_phase_artifact is missing';
  end if;

  select p.prosecdef into v_prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'record_work_cell_phase_artifact'
   order by p.oid desc
   limit 1;
  if v_prosecdef is not false then
    raise exception 'record_work_cell_phase_artifact must be SECURITY INVOKER';
  end if;

  select string_agg(r.rolname, ',' order by r.rolname) into v_execute_roles
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_depend d on d.objid = p.oid and d.deptype = 'n'
    join pg_authid r on r.oid = d.refobjid
   where n.nspname = 'public' and p.proname = 'record_work_cell_phase_artifact';

  if has_function_privilege('anon', 'public.record_work_cell_phase_artifact(uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid, numeric, bigint, bigint, jsonb)', 'execute') then
    raise exception 'anon must not execute record_work_cell_phase_artifact';
  end if;
  if not has_function_privilege('authenticated', 'public.record_work_cell_phase_artifact(uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid, numeric, bigint, bigint, jsonb)', 'execute') then
    raise exception 'authenticated must execute record_work_cell_phase_artifact';
  end if;

  if has_function_privilege('anon', 'public.claim_execution_step(text, text, text, text, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_execution_step(text, text, text, text, text, integer)', 'execute') then
    raise exception 'claim_execution_step must be service_role only';
  end if;
  if not has_function_privilege('service_role', 'public.claim_execution_step(text, text, text, text, text, integer)', 'execute') then
    raise exception 'service_role must execute claim_execution_step';
  end if;

  if has_function_privilege('anon', 'public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_execution_attempt(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint)', 'execute') then
    raise exception 'complete_execution_attempt must be service_role only';
  end if;

  if has_function_privilege('anon', 'public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean)', 'execute') then
    raise exception 'fail_execution_attempt must be service_role only; authenticated cannot set p_allow_expired';
  end if;
  if not has_function_privilege('service_role', 'public.fail_execution_attempt(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean)', 'execute') then
    raise exception 'service_role must execute fail_execution_attempt including p_allow_expired';
  end if;

  if has_function_privilege('anon', 'public.persist_tool_invocation_observation(uuid, uuid, text, text, jsonb, uuid)', 'execute') then
    raise exception 'anon must not execute persist_tool_invocation_observation';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tool_invocation_trace_struct_valid'
  ) then
    raise exception 'tool_invocation_trace_struct_valid is missing';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'canonical_json_stringify',
        'hash_tool_invocation_trace',
        'stable_work_cell_assignment_id'
      )
  ) then
    raise exception 'SQL must not claim a canonical hash helper without proven Node parity';
  end if;
end;
$$;
