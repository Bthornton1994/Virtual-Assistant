-- Step 3D advisor hardening discovered during live QA qualification.
--
-- The shared work-cell predicate does not need elevated privileges. Keeping it
-- SECURITY DEFINER exposed a cross-tenant boolean RPC surface and triggered the
-- Supabase security advisor. Make it RLS-aware instead, and explicitly remove
-- anonymous EXECUTE from both Step 3D RPCs.

create or replace function public.run_has_work_cell(p_run_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.run_executor_assignments rea
    where rea.run_id = p_run_id
  ) or exists (
    select 1
    from public.evidence_artifacts ea
    where ea.run_id = p_run_id
      and ea.payload->>'schemaVersion' in (
        'catalog-evidence-input/v1',
        'catalog-evidence-packet/v1'
      )
  );
$$;

revoke all on function public.run_has_work_cell(uuid) from public;
revoke execute on function public.run_has_work_cell(uuid) from anon;
grant execute on function public.run_has_work_cell(uuid) to authenticated, service_role;

-- The phase-recording RPC is intentionally authenticated-only. Supabase can
-- carry an explicit anon EXECUTE grant even after PUBLIC is revoked, so remove
-- that role explicitly and then state the intended grants.
revoke all on function public.record_work_cell_phase_artifact(
  uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid,
  numeric, bigint, bigint, jsonb
) from public;
revoke execute on function public.record_work_cell_phase_artifact(
  uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid,
  numeric, bigint, bigint, jsonb
) from anon;
grant execute on function public.record_work_cell_phase_artifact(
  uuid, text, text, text, text, jsonb, uuid, text, text, jsonb, uuid,
  numeric, bigint, bigint, jsonb
) to authenticated, service_role;

-- Cover the created_by foreign key introduced by Step 3D.
create index if not exists run_executor_assignments_created_by_idx
  on public.run_executor_assignments (created_by)
  where created_by is not null;
