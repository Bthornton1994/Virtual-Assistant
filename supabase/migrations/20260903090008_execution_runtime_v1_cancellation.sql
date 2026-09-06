-- Execution Runtime v1 cancellation RPC.
-- The schema and worker lifecycle RPCs are installed by prior migrations.
create or replace function public.cancel_execution_plan(p_plan_id uuid, p_actor_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_plan public.execution_plans%rowtype;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  select * into v_plan from public.execution_plans where id = p_plan_id for update;
  if not found then raise exception 'Execution plan not found'; end if;
  if v_plan.status in ('completed', 'failed', 'cancelled') then return; end if;
  update public.execution_attempts set status = 'cancelled', completed_at = now()
   where plan_id = p_plan_id and status in ('claimed', 'running');
  update public.execution_plan_steps
     set status = 'cancelled', lease_worker_id = null, lease_expires_at = null, completed_at = now()
   where plan_id = p_plan_id and status not in ('succeeded', 'failed', 'blocked', 'cancelled');
  update public.execution_plans set status = 'cancelled', completed_at = now() where id = p_plan_id;
  insert into public.execution_events (organization_id, plan_id, event_type, actor_kind, actor_ref, payload)
  values (v_plan.organization_id, p_plan_id, 'plan_cancelled', 'human', p_actor_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.cancel_execution_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_execution_plan(uuid, uuid) to service_role;
