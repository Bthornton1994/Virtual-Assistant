-- Preserve terminal-run immutability while allowing the application to re-select the
-- same final state after the receipt trigger has already finalized it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_workstream_run_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  spec_status text;
  spec_workstream uuid;
  request_org uuid;
  receipt_status text;
  receipt_done boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'planned' then
      raise exception 'New workstream runs must start in planned status';
    end if;

    select status, workstream_id
      into spec_status, spec_workstream
      from public.delegation_specs
      where id = new.delegation_spec_id
        and organization_id = new.organization_id;

    if spec_status is null then
      raise exception 'Delegation Spec does not belong to this organization';
    end if;
    if spec_status <> 'active' then
      raise exception 'A workstream run requires an active Delegation Spec';
    end if;
    if new.workstream_id is distinct from spec_workstream then
      raise exception 'Workstream run must use the Delegation Spec workstream';
    end if;

    if new.request_id is not null then
      select organization_id into request_org from public.requests where id = new.request_id;
      if request_org is distinct from new.organization_id then
        raise exception 'Linked request must belong to the same organization';
      end if;
    end if;

    return new;
  end if;

  if row(new.id, new.organization_id, new.workstream_id, new.request_id, new.delegation_spec_id, new.initiated_by, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.workstream_id, old.request_id, old.delegation_spec_id, old.initiated_by, old.created_at) then
    raise exception 'Workstream run identity and source links are immutable';
  end if;

  if old.status in ('verified', 'failed', 'cancelled') then
    if row(
      new.status,
      new.executor_summary,
      new.human_minutes,
      new.owner_minutes,
      new.ai_cost_micros,
      new.tool_cost_micros,
      new.started_at,
      new.completed_at,
      new.notes
    ) is distinct from row(
      old.status,
      old.executor_summary,
      old.human_minutes,
      old.owner_minutes,
      old.ai_cost_micros,
      old.tool_cost_micros,
      old.started_at,
      old.completed_at,
      old.notes
    ) then
      raise exception 'Terminal workstream runs are immutable';
    end if;
    return new;
  end if;

  if old.status = 'planned' and new.status not in ('planned', 'running', 'cancelled') then
    raise exception 'Invalid workstream run transition: % -> %', old.status, new.status;
  elsif old.status = 'running' and new.status not in ('running', 'awaiting_verification', 'failed', 'cancelled') then
    raise exception 'Invalid workstream run transition: % -> %', old.status, new.status;
  elsif old.status = 'awaiting_verification' and new.status not in ('awaiting_verification', 'verified', 'failed') then
    raise exception 'Invalid workstream run transition: % -> %', old.status, new.status;
  end if;

  if old.status = 'awaiting_verification' then
    if row(new.executor_summary, new.human_minutes, new.owner_minutes, new.ai_cost_micros, new.tool_cost_micros, new.started_at, new.notes)
       is distinct from
       row(old.executor_summary, old.human_minutes, old.owner_minutes, old.ai_cost_micros, old.tool_cost_micros, old.started_at, old.notes) then
      raise exception 'A submitted workstream run is frozen pending verification';
    end if;

    if new.status in ('verified', 'failed') then
      select verification_status, definition_of_done_met
        into receipt_status, receipt_done
        from public.outcome_receipts
        where run_id = old.id;

      if receipt_status is null then
        raise exception 'Verified or failed review status requires an Outcome Receipt';
      end if;
      if new.status = 'verified' and not (receipt_status = 'passed' and receipt_done) then
        raise exception 'Verified status requires a passing Outcome Receipt with definition of done met';
      end if;
      if new.status = 'failed' and receipt_status = 'passed' and receipt_done then
        raise exception 'A passing Outcome Receipt cannot finalize the run as failed';
      end if;
    end if;
  end if;

  if old.status = 'planned' and new.status = 'running' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status in ('failed', 'cancelled') and new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;
