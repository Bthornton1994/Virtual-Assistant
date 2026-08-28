-- Grounded supplier-sourcing guard extension.
--
-- Supplier sourcing reuses the Step 3D work-cell tables and Gauntlet review
-- slot. Extend the existing guards instead of creating a parallel trust path.
-- The supplier lane remains prepare-only until a human-approved external action
-- is implemented separately.

drop index if exists public.step3d_one_typed_artifact_per_run_idx;

create unique index step3d_one_typed_artifact_per_run_idx
  on public.evidence_artifacts (run_id, (payload->>'schemaVersion'))
  where payload->>'schemaVersion' in (
    'catalog-evidence-input/v1',
    'catalog-evidence-packet/v1',
    'catalog-evidence-review/v1',
    'catalog-evidence-validation/v1',
    'supplier-sourcing-input/v1',
    'supplier-sourcing-packet/v1',
    'supplier-sourcing-review/v1',
    'supplier-sourcing-validation/v1'
  );

create or replace function public.enforce_step3d_artifact_authority()
returns trigger
language plpgsql
set search_path = public
as $$
declare declared_version text;
begin
  declared_version := new.payload->>'schemaVersion';
  if declared_version is null then return new; end if;
  if declared_version in (
    'catalog-evidence-input/v1',
    'catalog-evidence-packet/v1',
    'catalog-evidence-review/v1',
    'catalog-evidence-validation/v1',
    'catalog-evidence-rejection/v1',
    'supplier-sourcing-input/v1',
    'supplier-sourcing-packet/v1',
    'supplier-sourcing-review/v1',
    'supplier-sourcing-validation/v1',
    'supplier-sourcing-rejection/v1',
    'supplier-outreach-approval/v1',
    'supplier-outreach-result/v1'
  ) and not public.is_ops_manager() then
    raise exception 'Typed execution artifacts may only be written by an operations manager';
  end if;
  return new;
end;
$$;

create or replace function public.run_has_work_cell(p_run_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from public.run_executor_assignments rea
     where rea.run_id = p_run_id
  )
  or exists (
    select 1
      from public.evidence_artifacts ea
     where ea.run_id = p_run_id
       and ea.payload->>'schemaVersion' in (
         'catalog-evidence-input/v1',
         'catalog-evidence-packet/v1',
         'supplier-sourcing-input/v1',
         'supplier-sourcing-packet/v1'
       )
  );
$$;

create or replace function public.require_work_cell_validation_before_submit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'running' or new.status <> 'awaiting_verification' then return new; end if;
  if not public.run_has_work_cell(new.id) then return new; end if;

  if not exists (
    select 1
      from public.run_executor_assignments rea
      join public.evidence_artifacts ea on ea.id = rea.output_artifact_id
     where rea.run_id = new.id
       and rea.phase = 'validate'
       and rea.status = 'completed'
       and ea.payload->>'schemaVersion' in (
         'catalog-evidence-validation/v1',
         'supplier-sourcing-validation/v1'
       )
  ) then
    raise exception 'This run is executed by a work cell. Run deterministic validation before submitting it for verification, otherwise its Gauntlet review slot cannot be filled.';
  end if;

  return new;
end;
$$;

create or replace function public.require_gauntlet_review_for_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_review_count bigint;
  v_has_work_cell boolean;
begin
  if new.verification_status <> 'passed' or not new.definition_of_done_met then return new; end if;

  select wr.gauntlet_cycle_id into v_cycle_id
    from public.workstream_runs wr
    where wr.id = new.run_id and wr.organization_id = new.organization_id;
  if v_cycle_id is null then return new; end if;

  v_has_work_cell := public.run_has_work_cell(new.run_id);

  select count(*) into v_review_count
    from public.gauntlet_reviews gr
    where gr.run_id = new.run_id
      and gr.cycle_id = v_cycle_id
      and gr.independent
      and gr.verdict = 'passed'
      and gr.hard_gate_pass
      and jsonb_array_length(coalesce(gr.authority_incidents, '[]'::jsonb)) = 0
      and (
        not v_has_work_cell
        or (
          gr.reviewer_kind = 'deterministic'
          and gr.reviewer_ref in (
            'delegation-cloud-work-cell-v1',
            'delegation-cloud-supplier-sourcing-v1'
          )
        )
      );

  if v_review_count = 0 then
    if v_has_work_cell then
      raise exception 'A work-cell run cannot pass without its deterministic hard-gate review';
    end if;
    raise exception 'A Gauntlet run cannot pass without an independent adversarial hard-gate review';
  end if;
  return new;
end;
$$;

create or replace function public.reserve_work_cell_reviewer_ref()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_work_cell boolean;
  v_validate_artifact_id uuid;
  v_validate_profile_key text;
  v_expected_schema text;
  v_expected_profile text;
  v_stored_hard_gate_pass boolean;
  v_stored_verdict text;
begin
  v_has_work_cell := public.run_has_work_cell(new.run_id);

  if new.reviewer_ref in (
    'delegation-cloud-work-cell-v1',
    'delegation-cloud-supplier-sourcing-v1'
  ) then
    if new.reviewer_kind <> 'deterministic' or not public.is_ops_manager() then
      raise exception 'A reserved work-cell reviewer reference requires a deterministic, manager-authored verdict';
    end if;

    v_expected_schema := case new.reviewer_ref
      when 'delegation-cloud-work-cell-v1' then 'catalog-evidence-validation/v1'
      when 'delegation-cloud-supplier-sourcing-v1' then 'supplier-sourcing-validation/v1'
    end;
    v_expected_profile := case new.reviewer_ref
      when 'delegation-cloud-work-cell-v1' then 'catalog-evidence-validator-v1'
      when 'delegation-cloud-supplier-sourcing-v1' then 'supplier-sourcing-validator-v1'
    end;

    select rea.output_artifact_id, ep.key
      into v_validate_artifact_id, v_validate_profile_key
    from public.run_executor_assignments rea
    join public.executor_profiles ep on ep.id = rea.executor_profile_id
    where rea.run_id = new.run_id
      and rea.phase = 'validate'
      and rea.status = 'completed'
    order by rea.created_at asc
    limit 1;

    if v_validate_artifact_id is null
       or v_validate_profile_key is distinct from v_expected_profile then
      raise exception 'The reserved work-cell reviewer reference is not bound to its registered deterministic validator output';
    end if;

    select
      case
        when v_expected_schema = 'catalog-evidence-validation/v1'
          then (ea.payload -> 'gate' ->> 'hardGatePass')::boolean
        else (ea.payload ->> 'hardGatePass')::boolean
      end,
      case
        when v_expected_schema = 'catalog-evidence-validation/v1'
          then ea.payload -> 'gate' ->> 'workCellVerdict'
        else
          case when (ea.payload ->> 'hardGatePass')::boolean then 'passed' else 'failed' end
      end
      into v_stored_hard_gate_pass, v_stored_verdict
    from public.evidence_artifacts ea
    where ea.id = v_validate_artifact_id
      and ea.payload->>'schemaVersion' = v_expected_schema;

    if v_stored_hard_gate_pass is null or v_stored_verdict is null
       or new.hard_gate_pass is distinct from v_stored_hard_gate_pass
       or new.verdict is distinct from v_stored_verdict then
      raise exception 'The inserted Gauntlet review disagrees with the deterministic validation artifact it claims to record';
    end if;

    return new;
  end if;

  if v_has_work_cell then
    raise exception 'This run is executed by a work cell; its single Gauntlet review is written by the deterministic work-cell verdict';
  end if;
  return new;
end;
$$;
