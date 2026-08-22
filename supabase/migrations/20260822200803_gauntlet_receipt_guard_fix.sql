create or replace function public.require_gauntlet_review_for_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_review_count bigint;
begin
  if new.verification_status <> 'passed' or not new.definition_of_done_met then return new; end if;

  select wr.gauntlet_cycle_id into v_cycle_id
    from public.workstream_runs wr
    where wr.id = new.run_id and wr.organization_id = new.organization_id;
  if v_cycle_id is null then return new; end if;

  select count(*) into v_review_count
    from public.gauntlet_reviews gr
    where gr.run_id = new.run_id
      and gr.cycle_id = v_cycle_id
      and gr.independent
      and gr.verdict = 'passed'
      and gr.hard_gate_pass
      and jsonb_array_length(coalesce(gr.authority_incidents, '[]'::jsonb)) = 0;

  if v_review_count = 0 then
    raise exception 'A Gauntlet run cannot pass without an independent adversarial hard-gate review';
  end if;
  return new;
end;
$$;
