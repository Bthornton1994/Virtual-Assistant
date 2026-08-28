-- Grounded supplier outreach persistence guard.
--
-- Supplier outreach is an external-execution boundary. The current release has
-- no qualified delivery connector, so approval may be recorded only after a
-- passing sourcing Outcome Receipt and sent delivery results remain blocked.
-- A future connector migration must replace the sent-result branch explicitly.

create or replace function public.enforce_supplier_outreach_artifact_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_run_status text;
  v_run_org uuid;
  v_schema text;
begin
  v_schema := new.payload->>'schemaVersion';

  if v_schema = 'supplier-outreach-approval/v1' then
    select wr.status, wr.organization_id
      into v_run_status, v_run_org
      from public.workstream_runs wr
     where wr.id = new.run_id;

    if v_run_org is null or v_run_org is distinct from new.organization_id then
      raise exception 'Supplier outreach approval must reference a run in the same organization';
    end if;

    if v_run_status <> 'verified' then
      raise exception 'Supplier outreach approval requires a verified sourcing run';
    end if;

    if new.payload->>'actionClass' <> 'external_execution' then
      raise exception 'Supplier outreach approval must declare the external_execution action class';
    end if;
  elsif v_schema = 'supplier-outreach-result/v1' then
    if new.payload->>'deliveryStatus' = 'sent' then
      raise exception 'No supplier outreach delivery connector is qualified to record a sent result';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_supplier_outreach_artifact_guard on public.evidence_artifacts;
create trigger trg_supplier_outreach_artifact_guard
  before insert or update of payload, run_id, organization_id
  on public.evidence_artifacts
  for each row
  execute function public.enforce_supplier_outreach_artifact_guard();

-- One approved draft per exact candidate per run. The UI check is advisory;
-- this index makes the invariant hold under concurrent submissions as well.
create unique index if not exists evidence_artifacts_supplier_outreach_approval_unique
  on public.evidence_artifacts (
    organization_id,
    run_id,
    (payload->>'candidateId')
  )
  where payload->>'schemaVersion' = 'supplier-outreach-approval/v1';
