-- Gauntlet safety actions happen immediately at adversarial review time.
-- v1 uses one final adversarial review per execution attempt; multi-review systems
-- can aggregate evidence into a single hybrid review before this boundary.

create unique index gauntlet_one_final_review_per_run_idx on public.gauntlet_reviews (run_id);

create or replace function public.apply_gauntlet_review_safety()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare c record; p record; new_level smallint;
begin
  if new.independent is not true then return new; end if;
  select organization_id,workstream_id,status into c from public.gauntlet_cycles where id=new.cycle_id;
  if c.organization_id is null or c.organization_id is distinct from new.organization_id then raise exception 'Safety review cycle mismatch'; end if;
  select current_level,state into p from public.workstream_autonomy_profiles where organization_id=new.organization_id and workstream_id=c.workstream_id;
  if p.current_level is null then return new; end if;

  if jsonb_array_length(coalesce(new.authority_incidents,'[]'::jsonb)) > 0 then
    perform set_config('delegation.gauntlet_profile_change','autonomy_decision',true);
    update public.workstream_autonomy_profiles set state='suspended',updated_by=new.reviewed_by where organization_id=new.organization_id and workstream_id=c.workstream_id;
    perform set_config('delegation.gauntlet_profile_change','',true);
    update public.gauntlet_cycles set status='suspended' where id=new.cycle_id and status not in ('closed','suspended');
    insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(new.organization_id,new.reviewed_by,'gauntlet.autonomy_auto_suspended','workstream_autonomy_profile',c.workstream_id::text,
      jsonb_build_object('cycleId',new.cycle_id,'runId',new.run_id,'reviewId',new.id,'reason','authority_incident','fromLevel',p.current_level));
    return new;
  end if;

  if new.verdict='failed' and not new.hard_gate_pass then
    new_level := greatest(0,p.current_level-1);
    if new_level <> p.current_level then
      perform set_config('delegation.gauntlet_profile_change','autonomy_decision',true);
      update public.workstream_autonomy_profiles set current_level=new_level,updated_by=new.reviewed_by where organization_id=new.organization_id and workstream_id=c.workstream_id;
      perform set_config('delegation.gauntlet_profile_change','',true);
    end if;
    insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,metadata)
    values(new.organization_id,new.reviewed_by,'gauntlet.autonomy_auto_demoted','workstream_autonomy_profile',c.workstream_id::text,
      jsonb_build_object('cycleId',new.cycle_id,'runId',new.run_id,'reviewId',new.id,'reason','adversarial_hard_gate_failed','fromLevel',p.current_level,'toLevel',new_level));
  end if;
  return new;
end;
$$;

revoke all on function public.apply_gauntlet_review_safety() from public, anon, authenticated;
create trigger trg_gauntlet_review_safety after insert on public.gauntlet_reviews for each row execute function public.apply_gauntlet_review_safety();
