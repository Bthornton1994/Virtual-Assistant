-- CS-14 correction: preserve the failed-receipt path for an over-budget run.
-- The original guard validates assignment totals on submission, but numeric
-- ceilings must only block the authoritative verified transition. Otherwise an
-- over-budget attempt cannot be frozen and recorded as failed.

create or replace function public.enforce_workstream_run_economic_envelope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  governing_envelope jsonb;
  assigned_human_minutes numeric;
  assigned_ai_cost_micros numeric;
  assigned_tool_cost_micros numeric;
  limit_value numeric;
begin
  if tg_op <> 'UPDATE' or new.status not in ('awaiting_verification', 'verified') then
    return new;
  end if;

  select ds.economic_envelope
    into governing_envelope
    from public.delegation_specs ds
   where ds.id = new.delegation_spec_id
     and ds.organization_id = new.organization_id;

  if governing_envelope is null then
    raise exception 'Workstream run governing Delegation Spec was not found';
  end if;

  perform public.validate_economic_envelope_shape(governing_envelope);

  select
    coalesce(sum(rea.human_minutes), 0),
    coalesce(sum(rea.ai_cost_micros), 0),
    coalesce(sum(rea.tool_cost_micros), 0)
    into assigned_human_minutes, assigned_ai_cost_micros, assigned_tool_cost_micros
    from public.run_executor_assignments rea
   where rea.run_id = new.id;

  if new.human_minutes < assigned_human_minutes then
    raise exception 'Workstream run human_minutes cannot be lower than recorded executor assignment costs';
  end if;
  if new.ai_cost_micros < assigned_ai_cost_micros then
    raise exception 'Workstream run ai_cost_micros cannot be lower than recorded executor assignment costs';
  end if;
  if new.tool_cost_micros < assigned_tool_cost_micros then
    raise exception 'Workstream run tool_cost_micros cannot be lower than recorded executor assignment costs';
  end if;

  -- Do not reject an overage while submitting. A failed Outcome Receipt is the
  -- truthful terminal state for that attempt. Only a verified transition is
  -- blocked by a declared ceiling.
  if new.status <> 'verified' then
    return new;
  end if;

  if governing_envelope ? 'maxHumanMinutes' then
    limit_value := (governing_envelope ->> 'maxHumanMinutes')::numeric;
    if new.human_minutes > limit_value then
      raise exception 'Economic envelope maxHumanMinutes exceeded: actual % is greater than limit %', new.human_minutes, limit_value;
    end if;
  elsif governing_envelope ? 'max_human_minutes' then
    limit_value := (governing_envelope ->> 'max_human_minutes')::numeric;
    if new.human_minutes > limit_value then
      raise exception 'Economic envelope maxHumanMinutes exceeded: actual % is greater than limit %', new.human_minutes, limit_value;
    end if;
  end if;

  if governing_envelope ? 'maxOwnerMinutes' then
    limit_value := (governing_envelope ->> 'maxOwnerMinutes')::numeric;
    if new.owner_minutes > limit_value then
      raise exception 'Economic envelope maxOwnerMinutes exceeded: actual % is greater than limit %', new.owner_minutes, limit_value;
    end if;
  elsif governing_envelope ? 'max_owner_minutes' then
    limit_value := (governing_envelope ->> 'max_owner_minutes')::numeric;
    if new.owner_minutes > limit_value then
      raise exception 'Economic envelope maxOwnerMinutes exceeded: actual % is greater than limit %', new.owner_minutes, limit_value;
    end if;
  end if;

  if governing_envelope ? 'maxAiCostMicros' then
    limit_value := (governing_envelope ->> 'maxAiCostMicros')::numeric;
    if new.ai_cost_micros > limit_value then
      raise exception 'Economic envelope maxAiCostMicros exceeded: actual % is greater than limit %', new.ai_cost_micros, limit_value;
    end if;
  elsif governing_envelope ? 'max_ai_cost_micros' then
    limit_value := (governing_envelope ->> 'max_ai_cost_micros')::numeric;
    if new.ai_cost_micros > limit_value then
      raise exception 'Economic envelope maxAiCostMicros exceeded: actual % is greater than limit %', new.ai_cost_micros, limit_value;
    end if;
  end if;

  if governing_envelope ? 'maxToolCostMicros' then
    limit_value := (governing_envelope ->> 'maxToolCostMicros')::numeric;
    if new.tool_cost_micros > limit_value then
      raise exception 'Economic envelope maxToolCostMicros exceeded: actual % is greater than limit %', new.tool_cost_micros, limit_value;
    end if;
  elsif governing_envelope ? 'max_tool_cost_micros' then
    limit_value := (governing_envelope ->> 'max_tool_cost_micros')::numeric;
    if new.tool_cost_micros > limit_value then
      raise exception 'Economic envelope maxToolCostMicros exceeded: actual % is greater than limit %', new.tool_cost_micros, limit_value;
    end if;
  end if;

  return new;
end;
$$;
