-- Keep recovery and its audit evidence in one database transaction.

create or replace function public.audit_autonomy_recovery()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  select p.id into v_profile_id
    from public.workstream_autonomy_profiles p
    where p.organization_id = new.organization_id
      and p.workstream_id = new.workstream_id;

  if v_profile_id is null then
    raise exception 'Autonomy recovery audit requires an existing profile';
  end if;

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    new.organization_id,
    new.recovered_by,
    'gauntlet.autonomy_recovered',
    'autonomy_profile',
    v_profile_id,
    jsonb_build_object(
      'recoveryId', new.id,
      'workstreamId', new.workstream_id,
      'fromLevel', new.from_level,
      'toLevel', new.to_level,
      'reason', new.reason
    )
  );

  return new;
end;
$$;

drop trigger if exists trg_autonomy_recovery_audit on public.autonomy_recoveries;
create trigger trg_autonomy_recovery_audit
  after insert on public.autonomy_recoveries
  for each row execute function public.audit_autonomy_recovery();
