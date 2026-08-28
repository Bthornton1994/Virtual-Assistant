-- Step 2 hardening: validate declared economic ceilings and prevent an
-- authoritative run from passing after it exceeds its governing limits.
--
-- Existing envelopes contain recording flags such as record_human_minutes. Those
-- keys remain accepted. The camelCase max* keys and the legacy snake_case
-- aliases below are interpreted as numeric ceilings. Other unknown keys remain
-- metadata for forward compatibility.

create or replace function public.validate_economic_envelope_shape(p_envelope jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  item_key text;
  item_value jsonb;
  value_number numeric;
begin
  if p_envelope is null or jsonb_typeof(p_envelope) <> 'object' then
    raise exception 'economic_envelope must be a JSON object';
  end if;

  for item_key, item_value in
    select key, value
      from jsonb_each(p_envelope)
     where key in (
       'maxHumanMinutes',
       'max_human_minutes',
       'maxOwnerMinutes',
       'max_owner_minutes',
       'maxAiCostMicros',
       'max_ai_cost_micros',
       'maxToolCostMicros',
       'max_tool_cost_micros'
     )
  loop
    if jsonb_typeof(item_value) <> 'number' then
      raise exception 'economic_envelope.% must be a JSON number', item_key;
    end if;

    begin
      value_number := (item_value #>> '{}')::numeric;
    exception when others then
      raise exception 'economic_envelope.% must be a finite non-negative number', item_key;
    end;

    if value_number < 0 then
      raise exception 'economic_envelope.% must be non-negative', item_key;
    end if;

    if item_key in (
      'maxAiCostMicros',
      'max_ai_cost_micros',
      'maxToolCostMicros',
      'max_tool_cost_micros'
    ) and value_number <> trunc(value_number) then
      raise exception 'economic_envelope.% must be a non-negative integer', item_key;
    end if;
  end loop;

  if p_envelope ? 'maxHumanMinutes'
     and p_envelope ? 'max_human_minutes'
     and (p_envelope ->> 'maxHumanMinutes')::numeric <> (p_envelope ->> 'max_human_minutes')::numeric then
    raise exception 'economic_envelope maxHumanMinutes conflicts with max_human_minutes';
  end if;
  if p_envelope ? 'maxOwnerMinutes'
     and p_envelope ? 'max_owner_minutes'
     and (p_envelope ->> 'maxOwnerMinutes')::numeric <> (p_envelope ->> 'max_owner_minutes')::numeric then
    raise exception 'economic_envelope maxOwnerMinutes conflicts with max_owner_minutes';
  end if;
  if p_envelope ? 'maxAiCostMicros'
     and p_envelope ? 'max_ai_cost_micros'
     and (p_envelope ->> 'maxAiCostMicros')::numeric <> (p_envelope ->> 'max_ai_cost_micros')::numeric then
    raise exception 'economic_envelope maxAiCostMicros conflicts with max_ai_cost_micros';
  end if;
  if p_envelope ? 'maxToolCostMicros'
     and p_envelope ? 'max_tool_cost_micros'
     and (p_envelope ->> 'maxToolCostMicros')::numeric <> (p_envelope ->> 'max_tool_cost_micros')::numeric then
    raise exception 'economic_envelope maxToolCostMicros conflicts with max_tool_cost_micros';
  end if;
end;
$$;

revoke all on function public.validate_economic_envelope_shape(jsonb) from public;
grant execute on function public.validate_economic_envelope_shape(jsonb) to authenticated, service_role;

create or replace function public.enforce_delegation_spec_economic_envelope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.validate_economic_envelope_shape(new.economic_envelope);
  return new;
end;
$$;

create trigger trg_delegation_spec_economic_envelope
  before insert or update on public.delegation_specs
  for each row execute function public.enforce_delegation_spec_economic_envelope();

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
  -- A run may be recorded as failed after an overage. Only an authoritative
  -- verified status is blocked, so the overage remains visible and reviewable.
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

  -- Assignment costs are already recorded as immutable execution evidence.
  -- A work-cell run may include additional owner overhead, but it may never
  -- report totals below the phase costs actually persisted.
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

create trigger trg_workstream_run_economic_envelope
  before update on public.workstream_runs
  for each row execute function public.enforce_workstream_run_economic_envelope();
