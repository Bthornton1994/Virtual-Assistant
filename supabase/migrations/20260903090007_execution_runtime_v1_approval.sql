-- Execution Runtime v1 approval decision RPC.
-- The schema and worker lifecycle RPCs are installed by prior migrations.
create or replace function public.decide_execution_approval(
  p_approval_id uuid,
  p_decision text,
  p_decided_by uuid,
  p_decision_note text default ''
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_approval public.execution_approval_requests%rowtype;
  v_step public.execution_plan_steps%rowtype;
  v_event_type text;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Approval decision must be approved or rejected'; end if;
  select * into v_approval from public.execution_approval_requests where id = p_approval_id for update;
  if not found or v_approval.status <> 'pending' then raise exception 'Approval request is not pending'; end if;
  select * into v_step from public.execution_plan_steps where id = v_approval.step_id for update;
  if not found or v_step.status <> 'awaiting_approval' then raise exception 'Approval step is no longer awaiting approval'; end if;

  update public.execution_approval_requests
     set status = p_decision, decided_by = p_decided_by,
         decision_note = coalesce(p_decision_note, ''), decided_at = now()
   where id = p_approval_id;
  update public.execution_plan_steps
     set status = case when p_decision = 'approved' then 'ready' else 'blocked' end,
         completed_at = case when p_decision = 'rejected' then now() else null end,
         last_failure_class = case when p_decision = 'rejected' then 'authority_limit' else null end,
         last_failure_summary = case when p_decision = 'rejected' then 'Required human approval was rejected.' else null end
   where id = v_step.id;
  v_event_type := case when p_decision = 'approved' then 'approval_approved' else 'approval_rejected' end;
  insert into public.execution_events (organization_id, plan_id, step_id, event_type, actor_kind, actor_ref, payload)
  values (v_approval.organization_id, v_approval.plan_id, v_approval.step_id,
          v_event_type, 'human', p_decided_by::text,
          jsonb_build_object('approvalId', p_approval_id, 'decisionNote', p_decision_note));
  perform public.refresh_execution_plan_queue(v_approval.plan_id);
  return p_approval_id;
end;
$$;

revoke all on function public.decide_execution_approval(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_execution_approval(uuid, text, uuid, text) to service_role;
