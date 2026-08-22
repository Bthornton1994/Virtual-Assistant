-- Preserve recovery immutability for direct writes while honoring the parent FK cascade contract.

create or replace function public.enforce_autonomy_recovery_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p record;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'Autonomy recovery records are immutable';
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Autonomy recovery records are immutable';
  end if;

  if btrim(new.reason) = '' then raise exception 'Autonomy recovery requires an explicit reason'; end if;
  select current_level, state into p
    from public.workstream_autonomy_profiles
    where organization_id = new.organization_id and workstream_id = new.workstream_id;
  if p.current_level is null then raise exception 'Autonomy recovery requires an existing profile'; end if;
  if p.state <> 'suspended' then raise exception 'Only a suspended autonomy profile can be recovered'; end if;
  new.from_level := p.current_level;
  new.to_level := 0;
  return new;
end;
$$;
