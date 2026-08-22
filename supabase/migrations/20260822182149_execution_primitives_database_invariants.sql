-- Step 2 hardening: make the database, not the UI, enforce the execution contract.

-- Tenant-consistent identity keys for composite foreign keys.
alter table public.workstreams
  add constraint workstreams_id_organization_key unique (id, organization_id);

alter table public.delegation_specs
  alter column workstream_id set not null,
  add constraint delegation_specs_id_organization_key unique (id, organization_id);

alter table public.workstream_runs
  alter column workstream_id set not null,
  add constraint workstream_runs_id_organization_key unique (id, organization_id);

alter table public.delegation_specs drop constraint delegation_specs_workstream_id_fkey;
alter table public.delegation_specs
  add constraint delegation_specs_workstream_organization_fkey
  foreign key (workstream_id, organization_id)
  references public.workstreams(id, organization_id)
  on delete cascade;

alter table public.workstream_runs drop constraint workstream_runs_delegation_spec_id_fkey;
alter table public.workstream_runs
  add constraint workstream_runs_spec_organization_fkey
  foreign key (delegation_spec_id, organization_id)
  references public.delegation_specs(id, organization_id)
  on delete restrict;

alter table public.workstream_runs drop constraint workstream_runs_workstream_id_fkey;
alter table public.workstream_runs
  add constraint workstream_runs_workstream_organization_fkey
  foreign key (workstream_id, organization_id)
  references public.workstreams(id, organization_id)
  on delete restrict;

alter table public.evidence_artifacts drop constraint evidence_artifacts_run_id_fkey;
alter table public.evidence_artifacts
  add constraint evidence_artifacts_run_organization_fkey
  foreign key (run_id, organization_id)
  references public.workstream_runs(id, organization_id)
  on delete cascade;

alter table public.outcome_receipts drop constraint outcome_receipts_run_id_fkey;
alter table public.outcome_receipts
  add constraint outcome_receipts_run_organization_fkey
  foreign key (run_id, organization_id)
  references public.workstream_runs(id, organization_id)
  on delete restrict;

-- Draft editing and activation are distinct authority paths.
drop policy delegation_specs_update on public.delegation_specs;

create policy delegation_specs_update_draft on public.delegation_specs
  for update to authenticated
  using ((public.is_org_admin(organization_id) or public.is_ops_manager()) and status = 'draft')
  with check (
    (public.is_org_admin(organization_id) or public.is_ops_manager())
    and status = 'draft'
    and activated_by is null
    and activated_at is null
  );

create policy delegation_specs_activate on public.delegation_specs
  for update to authenticated
  using (public.is_ops_manager() and status = 'draft')
  with check (
    public.is_ops_manager()
    and status = 'active'
    and activated_by = (select auth.uid())
    and activated_at is not null
  );

create or replace function public.enforce_delegation_spec_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if row(new.id, new.organization_id, new.workstream_id, new.version, new.created_by, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.workstream_id, old.version, old.created_by, old.created_at) then
    raise exception 'Delegation Spec identity and version metadata are immutable';
  end if;

  if old.status <> 'draft' then
    raise exception 'Activated Delegation Specs are immutable in Step 2; create a new version instead';
  end if;

  if new.status = 'retired' then
    raise exception 'Delegation Spec retirement/version rollover is not enabled in Step 2';
  end if;

  if new.status = 'active' then
    if row(
      new.objective,
      new.definition_of_done,
      new.trigger_description,
      new.required_inputs,
      new.action_class,
      new.authority_rules,
      new.approval_points,
      new.verification_rules,
      new.exception_policy,
      new.sla,
      new.economic_envelope,
      new.data_policy
    ) is distinct from row(
      old.objective,
      old.definition_of_done,
      old.trigger_description,
      old.required_inputs,
      old.action_class,
      old.authority_rules,
      old.approval_points,
      old.verification_rules,
      old.exception_policy,
      old.sla,
      old.economic_envelope,
      old.data_policy
    ) then
      raise exception 'A Delegation Spec cannot be edited during activation';
    end if;

    if new.activated_by is null or new.activated_at is null then
      raise exception 'Activation requires actor and timestamp';
    end if;
  elsif new.status = 'draft' then
    if new.activated_by is not null or new.activated_at is not null then
      raise exception 'Draft Delegation Specs cannot carry activation metadata';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_delegation_spec_invariants
  before update on public.delegation_specs
  for each row execute function public.enforce_delegation_spec_invariants();

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
    raise exception 'Terminal workstream runs are immutable';
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

create trigger trg_workstream_run_invariants
  before insert or update on public.workstream_runs
  for each row execute function public.enforce_workstream_run_invariants();

create or replace function public.enforce_evidence_artifact_invariants()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  run_status text;
  request_org uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Evidence artifacts are immutable';
  end if;

  select status into run_status
    from public.workstream_runs
    where id = new.run_id
      and organization_id = new.organization_id;

  if run_status is null then
    raise exception 'Evidence run does not belong to this organization';
  end if;
  if run_status <> 'running' then
    raise exception 'Evidence may only be appended while a run is running';
  end if;

  if new.request_id is not null then
    select organization_id into request_org from public.requests where id = new.request_id;
    if request_org is distinct from new.organization_id then
      raise exception 'Evidence request must belong to the same organization';
    end if;
  end if;

  new.content_hash := encode(
    extensions.digest(
      concat_ws('|', new.kind, new.summary, coalesce(new.source_uri, ''), coalesce(new.payload, '{}'::jsonb)::text),
      'sha256'
    ),
    'hex'
  );

  return new;
end;
$$;

create trigger trg_evidence_artifact_invariants
  before insert or update or delete on public.evidence_artifacts
  for each row execute function public.enforce_evidence_artifact_invariants();

create or replace function public.validate_outcome_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_status text;
  spec_id uuid;
  verification_rules jsonb;
  evidence_count bigint;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Outcome Receipts are immutable';
  end if;

  select status, delegation_spec_id
    into run_status, spec_id
    from public.workstream_runs
    where id = new.run_id
      and organization_id = new.organization_id;

  if run_status is null then
    raise exception 'Outcome Receipt run does not belong to this organization';
  end if;
  if run_status <> 'awaiting_verification' then
    raise exception 'Outcome Receipts may only be issued for runs awaiting verification';
  end if;
  if new.verification_status = 'passed' and not new.definition_of_done_met then
    raise exception 'A passing Outcome Receipt requires definition of done to be met';
  end if;

  select ds.verification_rules into verification_rules
    from public.delegation_specs ds
    where ds.id = spec_id
      and ds.organization_id = new.organization_id;

  if new.verification_status = 'passed'
     and jsonb_array_length(coalesce(verification_rules, '[]'::jsonb)) > 0 then
    select count(*) into evidence_count
      from public.evidence_artifacts
      where run_id = new.run_id;
    if evidence_count = 0 then
      raise exception 'This Delegation Spec requires evidence before verification can pass';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_outcome_receipt_validate
  before insert or update or delete on public.outcome_receipts
  for each row execute function public.validate_outcome_receipt();

create or replace function public.finalize_workstream_run_from_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.workstream_runs
    set status = case
      when new.verification_status = 'passed' and new.definition_of_done_met then 'verified'
      else 'failed'
    end,
    completed_at = new.verified_at
    where id = new.run_id
      and organization_id = new.organization_id;
  return new;
end;
$$;

create trigger trg_outcome_receipt_finalize_run
  after insert on public.outcome_receipts
  for each row execute function public.finalize_workstream_run_from_receipt();
