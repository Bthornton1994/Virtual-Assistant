-- Software Factory control-plane hardening.
--
-- Filename version 20260906210000 is after the TWL reserved-writer migration
-- (20260906191128). Application-only gates on the in-memory store are not
-- enough: staff could UPDATE lifecycle to accepted, forge owner_acceptance, or
-- impersonate packet/owner evidence through generic evidence insert.
--
-- This migration makes those states unreachable at the database boundary.
-- Overlay writes go through SECURITY DEFINER RPCs. Accepted is issued only
-- when a passing Outcome Receipt survives the factory receipt trigger.

create or replace function public.software_factory_sha256(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select public.twl_prepare_proof_sha256(p_value);
$$;

create or replace function public.is_software_factory_spec(p_spec_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.delegation_specs ds
     where ds.id = p_spec_id
       and ds.action_class = 'prepare_only'
       and ds.required_inputs ? 'software-factory-run/v1'
  );
$$;

create or replace function public.is_software_factory_workstream_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workstream_runs wr
     where wr.id = p_run_id
       and public.is_software_factory_spec(wr.delegation_spec_id)
  );
$$;

revoke all on function public.is_software_factory_spec(uuid) from public;
revoke all on function public.is_software_factory_workstream_run(uuid) from public;
grant execute on function public.is_software_factory_spec(uuid) to authenticated;
grant execute on function public.is_software_factory_workstream_run(uuid) to authenticated;

create or replace function public.software_factory_allowed_transitions(p_from text)
returns text[]
language sql
immutable
as $$
  select case p_from
    when 'intake' then array['discovery','rejected','deferred','cancelled']
    when 'discovery' then array['planned','blocked','rejected','deferred','cancelled']
    when 'planned' then array['ready','blocked','deferred','cancelled']
    when 'ready' then array['in_progress','blocked','deferred','cancelled']
    when 'in_progress' then array['blocked','pr_open','deferred','cancelled']
    when 'blocked' then array['discovery','planned','ready','in_progress','pr_open','verification','cancelled','deferred','rejected']
    when 'pr_open' then array['verification','blocked','cancelled']
    when 'verification' then array['awaiting_owner','blocked','rejected']
    when 'awaiting_owner' then array['accepted','rejected','deferred','blocked']
    else array[]::text[]
  end;
$$;

create or replace function public.protect_software_factory_run()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.action_class <> 'prepare_only' or new.may_own_authoritative_state or new.merge_performed then
      raise exception 'Software Factory v1 remains prepare_only and cannot record a performed merge'
        using errcode = '23514';
    end if;
    if new.lifecycle_status = 'accepted' then
      raise exception 'Accepted cannot be inserted; it requires an owner decision and Outcome Receipt'
        using errcode = '23514';
    end if;
    if new.packet is not null and new.packet_hash is distinct from public.software_factory_sha256(new.packet) then
      raise exception 'Software Factory packet hash mismatch'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.task_id is distinct from old.task_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Software Factory run identity is immutable'
      using errcode = '23514';
  end if;
  if new.action_class <> 'prepare_only' or new.may_own_authoritative_state or new.merge_performed then
    raise exception 'Software Factory v1 remains prepare_only and cannot record a performed merge'
      using errcode = '23514';
  end if;
  if new.packet is not null and new.packet_hash is distinct from public.software_factory_sha256(new.packet) then
    raise exception 'Software Factory packet hash mismatch'
      using errcode = '23514';
  end if;
  if new.merge_authorized_for_human
     and not exists (
       select 1
         from public.software_factory_approvals a
        where a.factory_run_id = new.id
          and a.kind = 'merge_pr'
          and a.status = 'approved'
     ) then
    raise exception 'merge_authorized_for_human requires an approved owner merge decision outside the packet'
      using errcode = '23514';
  end if;
  if new.lifecycle_status is distinct from old.lifecycle_status then
    if new.lifecycle_status = 'accepted' then
      if current_user <> 'postgres' then
        raise exception 'Accepted is issued only by the Software Factory receipt writer'
          using errcode = '23514';
      end if;
      if not exists (
        select 1
          from public.software_factory_approvals a
         where a.factory_run_id = new.id
           and a.kind = 'owner_acceptance'
           and a.status = 'approved'
           and a.packet_hash is not null
           and a.packet_hash = new.packet_hash
      ) then
        raise exception 'Accepted requires owner acceptance recorded outside the task packet'
          using errcode = '23514';
      end if;
    elsif not (new.lifecycle_status = any(public.software_factory_allowed_transitions(old.lifecycle_status))) then
      raise exception 'Invalid Software Factory transition % → %', old.lifecycle_status, new.lifecycle_status
        using errcode = '23514';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'Software Factory run version must advance by one on a lifecycle change'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.protect_software_factory_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.organization_id is distinct from new.organization_id
       or old.factory_run_id is distinct from new.factory_run_id
       or old.kind is distinct from new.kind
       or old.requested_by is distinct from new.requested_by
       or old.created_at is distinct from new.created_at then
      raise exception 'Software Factory approval identity is immutable'
        using errcode = '23514';
    end if;
    if old.status <> 'pending' then
      raise exception 'Software Factory approval decisions are immutable'
        using errcode = '23514';
    end if;
  end if;
  if new.status <> 'pending' then
    if new.packet_hash is null then
      raise exception 'Software Factory owner decisions must bind to a frozen packet hash'
        using errcode = '23514';
    end if;
    if new.kind = 'owner_acceptance' then
      if exists (select 1 from public.operators o where o.user_id = new.decided_by) then
        raise exception 'Staff cannot record Software Factory owner acceptance'
          using errcode = '23514';
      end if;
      if not exists (
        select 1
          from public.organization_members m
         where m.user_id = new.decided_by
           and m.organization_id = new.organization_id
           and m.status = 'active'
           and m.role in ('client_admin', 'client_member')
      ) then
        raise exception 'Owner acceptance must be recorded by an organization owner or member'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create unique index if not exists software_factory_one_reserved_artifact_per_run_idx
  on public.evidence_artifacts (run_id, (payload->>'schemaVersion'))
  where payload->>'schemaVersion' in (
    'software-factory-packet/v1',
    'software-factory-owner-decision/v1'
  );

drop policy if exists evidence_artifacts_insert on public.evidence_artifacts;
create policy evidence_artifacts_insert on public.evidence_artifacts
  for insert to authenticated
  with check (
    public.is_platform_staff()
    and coalesce(payload->>'schemaVersion', '') not in (
      'twl-prepare-proof-assignment/v1',
      'twl-prepare-proof-pr/v1',
      'software-factory-packet/v1',
      'software-factory-owner-decision/v1'
    )
  );

create or replace function public.enforce_software_factory_artifact_writer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payload->>'schemaVersion' not in (
    'software-factory-packet/v1',
    'software-factory-owner-decision/v1'
  ) then
    return new;
  end if;
  if not public.is_software_factory_workstream_run(new.run_id) then
    raise exception 'Reserved Software Factory evidence may only be attached to a software-factory-run/v1 workstream'
      using errcode = '23514';
  end if;
  if current_user <> 'postgres' then
    raise exception 'Reserved Software Factory evidence must be written by its database-owned writer'
      using errcode = '23514';
  end if;
  if new.created_by is null then
    raise exception 'Reserved Software Factory evidence requires an authenticated creator'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_software_factory_artifact_writer on public.evidence_artifacts;
create trigger trg_software_factory_artifact_writer
  before insert on public.evidence_artifacts
  for each row execute function public.enforce_software_factory_artifact_writer();

revoke insert, update on table public.software_factory_runs from authenticated;
revoke insert, update on table public.software_factory_approvals from authenticated;
revoke insert on table public.software_factory_events from authenticated;

drop policy if exists software_factory_runs_insert on public.software_factory_runs;
drop policy if exists software_factory_runs_update on public.software_factory_runs;
drop policy if exists software_factory_events_insert on public.software_factory_events;
drop policy if exists software_factory_approvals_insert on public.software_factory_approvals;
drop policy if exists software_factory_approvals_update on public.software_factory_approvals;

create or replace function public.software_factory_append_event(
  p_factory_run_id uuid,
  p_organization_id uuid,
  p_idempotency_key text,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_source_ref text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.software_factory_events (
    organization_id,
    factory_run_id,
    idempotency_key,
    actor_id,
    actor_role,
    event_type,
    from_status,
    to_status,
    source_ref,
    payload
  ) values (
    p_organization_id,
    p_factory_run_id,
    p_idempotency_key,
    auth.uid(),
    coalesce(public.platform_role(), (
      select m.role
        from public.organization_members m
       where m.user_id = auth.uid()
         and m.organization_id = p_organization_id
         and m.status = 'active'
       limit 1
    ), 'unknown'),
    p_event_type,
    p_from_status,
    p_to_status,
    p_source_ref,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.software_factory_sync_workstream(
  p_workstream_run_id uuid,
  p_lifecycle text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_target text;
begin
  if p_workstream_run_id is null then
    return;
  end if;
  select status into v_status
    from public.workstream_runs
   where id = p_workstream_run_id;
  if v_status is null then
    return;
  end if;
  v_target := case
    when p_lifecycle in ('intake','discovery','planned') then 'planned'
    when p_lifecycle in ('ready','in_progress','blocked','pr_open') then 'running'
    when p_lifecycle in ('verification','awaiting_owner') then 'awaiting_verification'
    when p_lifecycle = 'accepted' then 'verified'
    when p_lifecycle = 'rejected' then 'failed'
    when p_lifecycle in ('deferred','cancelled') then 'cancelled'
    else v_status
  end;
  if v_status = v_target then
    return;
  end if;
  if v_status = 'planned' and v_target in ('running','awaiting_verification') then
    update public.workstream_runs
       set status = 'running',
           started_at = coalesce(started_at, now())
     where id = p_workstream_run_id
       and status = 'planned';
    v_status := 'running';
  end if;
  if v_status = 'running' and v_target = 'awaiting_verification' then
    update public.workstream_runs
       set status = 'awaiting_verification'
     where id = p_workstream_run_id
       and status = 'running';
  end if;
end;
$$;

create or replace function public.software_factory_bind_workstream_run(
  p_workstream_run_id uuid,
  p_task_id text,
  p_repository text,
  p_base_branch text,
  p_in_scope jsonb,
  p_acceptance_criteria jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.workstream_runs%rowtype;
  v_factory_id uuid;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'Only operations staff can bind a Software Factory overlay';
  end if;
  if p_task_id is null or char_length(trim(p_task_id)) < 1 or char_length(p_task_id) > 64 then
    raise exception 'A Software Factory task id is required';
  end if;
  if jsonb_typeof(p_in_scope) <> 'array' or jsonb_array_length(p_in_scope) < 1 then
    raise exception 'Frozen in-scope items are required';
  end if;
  if jsonb_typeof(p_acceptance_criteria) <> 'array' or jsonb_array_length(p_acceptance_criteria) < 1 then
    raise exception 'Frozen acceptance criteria are required';
  end if;

  select * into v_run
    from public.workstream_runs
   where id = p_workstream_run_id;
  if not found then
    raise exception 'Workstream run not found';
  end if;
  if not public.is_software_factory_spec(v_run.delegation_spec_id) then
    raise exception 'This workstream is not a software-factory-run/v1 prepare-only spec';
  end if;

  select id into v_factory_id
    from public.software_factory_runs
   where workstream_run_id = p_workstream_run_id;
  if v_factory_id is not null then
    return v_factory_id;
  end if;

  insert into public.software_factory_runs (
    organization_id,
    task_id,
    workstream_run_id,
    delegation_spec_id,
    lifecycle_status,
    action_class,
    repository,
    base_branch,
    frozen_in_scope,
    frozen_acceptance_criteria,
    connector_status,
    created_by
  ) values (
    v_run.organization_id,
    trim(p_task_id),
    v_run.id,
    v_run.delegation_spec_id,
    'intake',
    'prepare_only',
    trim(p_repository),
    trim(p_base_branch),
    p_in_scope,
    p_acceptance_criteria,
    '[
      {"key":"grok_bot","available":false,"limitation":"No approved Grok Bot connector. Coordinate the Software Factory PM through a structured human-mediated handoff."},
      {"key":"cursor_cloud_agent","available":false,"limitation":"No approved Cursor Cloud Agent connector. Cursor success claims are evidence only."},
      {"key":"github_issues_write","available":false,"limitation":"GitHub Issues write is not an approved connector. The Workstream Run is the canonical board."},
      {"key":"github_evidence","available":true,"limitation":"GitHub is an evidence provider only. Live repository mutation is not authorized."}
    ]'::jsonb,
    auth.uid()
  )
  returning id into v_factory_id;

  perform public.software_factory_append_event(
    v_factory_id,
    v_run.organization_id,
    'bind:' || v_factory_id::text,
    'primitives_provisioned',
    null,
    'intake',
    'workstream_run:' || v_run.id::text,
    jsonb_build_object('taskId', trim(p_task_id), 'repository', trim(p_repository))
  );
  return v_factory_id;
end;
$$;

create or replace function public.software_factory_transition(
  p_factory_run_id uuid,
  p_to text,
  p_expected_version integer
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_workstream_status text;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'Only operations staff can transition Software Factory lifecycle state';
  end if;
  if p_to = 'accepted' then
    raise exception 'Accepted is issued only through an Outcome Receipt after owner acceptance';
  end if;
  select * into v_run
    from public.software_factory_runs
   where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  if p_expected_version is not null and p_expected_version <> v_run.version then
    raise exception 'Optimistic concurrency conflict: Software Factory run version does not match';
  end if;
  if not (p_to = any(public.software_factory_allowed_transitions(v_run.lifecycle_status))) then
    raise exception 'Invalid Software Factory transition % → %', v_run.lifecycle_status, p_to;
  end if;
  if (p_to = 'ready' or p_to = 'in_progress') and v_run.packet is null then
    raise exception 'A structured task packet is required before Ready or In Progress';
  end if;
  if p_to = 'in_progress' then
    if not exists (
      select 1
        from public.evidence_artifacts e
       where e.run_id = v_run.workstream_run_id
         and e.payload->>'factoryKind' = 'worker_handoff'
         and e.payload->>'workerRole' = 'software_factory_pm'
    ) or not exists (
      select 1
        from public.evidence_artifacts e
       where e.run_id = v_run.workstream_run_id
         and e.payload->>'factoryKind' = 'worker_handoff'
         and e.payload->>'workerRole' in ('software_factory_developer','cursor_cloud_agent')
    ) then
      raise exception 'In Progress requires structured PM and Developer handoffs. Missing connectors must be reported as human-mediated';
    end if;
  end if;
  if p_to = 'verification' then
    if not exists (
      select 1 from public.evidence_artifacts e where e.run_id = v_run.workstream_run_id
    ) then
      raise exception 'Verification requires attached evidence';
    end if;
  end if;
  if p_to in ('ready','in_progress','pr_open','verification') then
    select status into v_workstream_status
      from public.workstream_runs
     where id = v_run.workstream_run_id;
    if v_workstream_status = 'planned' then
      raise exception 'Start the workstream run before moving Software Factory work into execution';
    end if;
  end if;

  update public.software_factory_runs
     set lifecycle_status = p_to,
         version = v_run.version + 1,
         updated_at = now()
   where id = v_run.id;

  perform public.software_factory_sync_workstream(v_run.workstream_run_id, p_to);
  perform public.software_factory_append_event(
    v_run.id,
    v_run.organization_id,
    'transition:' || v_run.id::text || ':' || v_run.lifecycle_status || ':' || p_to || ':' || (v_run.version + 1)::text,
    'lifecycle_transition',
    v_run.lifecycle_status,
    p_to,
    'transition:' || v_run.lifecycle_status || ':' || p_to,
    jsonb_build_object('from', v_run.lifecycle_status, 'to', p_to)
  );
  return p_to;
end;
$$;

create or replace function public.software_factory_write_evidence(
  p_run public.software_factory_runs,
  p_kind text,
  p_summary text,
  p_source_uri text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_run.workstream_run_id is null then
    raise exception 'Evidence can only project onto a Workstream Run';
  end if;
  v_payload := v_payload || jsonb_build_object(
    'factoryRunId', p_run.id,
    'taskId', p_run.task_id,
    'mutatesRepository', false,
    'mergePerformed', false
  );
  insert into public.evidence_artifacts (
    organization_id,
    run_id,
    kind,
    summary,
    source_uri,
    payload,
    created_by
  ) values (
    p_run.organization_id,
    p_run.workstream_run_id,
    p_kind,
    p_summary,
    p_source_uri,
    v_payload,
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.software_factory_inspect_repository(
  p_factory_run_id uuid,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'Only operations staff can record repository inspection inputs';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  return public.software_factory_write_evidence(
    v_run,
    'source',
    coalesce(nullif(trim(p_notes), ''), 'Prepare-only repository inspection recorded. No live GitHub mutation.'),
    null,
    jsonb_build_object(
      'schemaVersion', 'software-factory-evidence/v1',
      'factoryKind', 'repository_inspection',
      'conclusion', 'recorded_inspection_only',
      'satisfiedCriteria', jsonb_build_array('Repository and governing files inspected as prepare-only recorded inputs.'),
      'recordedAt', now()
    )
  );
end;
$$;

create or replace function public.software_factory_record_missing_handoffs(p_factory_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'Only operations staff can record worker handoffs';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;

  if not exists (
    select 1 from public.evidence_artifacts e
     where e.run_id = v_run.workstream_run_id
       and e.payload->>'factoryKind' = 'worker_handoff'
       and e.payload->>'workerRole' = 'software_factory_pm'
  ) then
    perform public.software_factory_write_evidence(
      v_run,
      'communication',
      'Software Factory PM planning and status must be carried by a human-mediated handoff because no approved Grok Bot connector exists.',
      null,
      jsonb_build_object(
        'schemaVersion', 'software-factory-evidence/v1',
        'factoryKind', 'worker_handoff',
        'workerRole', 'software_factory_pm',
        'connectorKey', 'grok_bot',
        'mediation', 'human_mediated',
        'missingConnector', true,
        'conclusion', 'missing_connector_human_mediated',
        'satisfiedCriteria', jsonb_build_array('Worker handoff recorded.'),
        'recordedAt', now()
      )
    );
    v_count := v_count + 1;
  end if;

  if not exists (
    select 1 from public.evidence_artifacts e
     where e.run_id = v_run.workstream_run_id
       and e.payload->>'factoryKind' = 'worker_handoff'
       and e.payload->>'workerRole' = 'software_factory_developer'
  ) then
    perform public.software_factory_write_evidence(
      v_run,
      'communication',
      'Cursor Cloud Agent execution must be coordinated by the Software Factory Developer through a human-mediated handoff because no approved connector exists.',
      null,
      jsonb_build_object(
        'schemaVersion', 'software-factory-evidence/v1',
        'factoryKind', 'worker_handoff',
        'workerRole', 'software_factory_developer',
        'connectorKey', 'cursor_cloud_agent',
        'mediation', 'human_mediated',
        'missingConnector', true,
        'conclusion', 'missing_connector_human_mediated',
        'satisfiedCriteria', jsonb_build_array('Worker handoff recorded.'),
        'recordedAt', now()
      )
    );
    v_count := v_count + 1;
  end if;
  return v_count;
end;
$$;

create or replace function public.software_factory_freeze_packet(
  p_factory_run_id uuid,
  p_packet jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_hash text;
  v_notes text;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'Only operations staff can freeze a Software Factory task packet';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  if p_packet->>'schemaVersion' <> 'software-factory-packet/v1' then
    raise exception 'Packet schemaVersion must be software-factory-packet/v1';
  end if;
  if p_packet->>'TASK_ID' is distinct from v_run.task_id then
    raise exception 'Packet TASK_ID does not match the Software Factory run';
  end if;
  if p_packet->>'REPOSITORY' is distinct from v_run.repository then
    raise exception 'Packet REPOSITORY does not match the frozen intake repository';
  end if;
  if p_packet->>'BASE_BRANCH' is distinct from v_run.base_branch then
    raise exception 'Packet BASE_BRANCH does not match the frozen intake base branch';
  end if;
  if p_packet->>'STATUS' is distinct from v_run.lifecycle_status then
    raise exception 'Packet STATUS cannot set lifecycle state; Delegation Cloud owns permitted transitions';
  end if;
  if not (coalesce(p_packet->'APPROVAL_REQUIRED', '[]'::jsonb) ? 'owner_acceptance') then
    raise exception 'Packet APPROVAL_REQUIRED must include owner_acceptance';
  end if;
  v_notes := lower(coalesce(p_packet->>'HANDOFF_NOTES','') || ' ' || coalesce(p_packet->>'BACKGROUND','') || ' ' || coalesce(p_packet->>'OBJECTIVE',''));
  if v_notes like '%self-authorized%'
     or v_notes like '%packet authorizes%'
     or v_notes like '%approved by this packet%'
     or v_notes like '%this packet approves%'
     or v_notes like '%authorized by the packet%'
     or p_packet->>'STATUS' = 'accepted' then
    raise exception 'A task packet cannot authorize itself. Owner approval must be recorded outside the packet';
  end if;
  if exists (
    select 1
      from jsonb_array_elements_text(coalesce(p_packet->'IN_SCOPE', '[]'::jsonb)) item
     where not exists (
       select 1
         from jsonb_array_elements_text(v_run.frozen_in_scope) frozen
        where lower(trim(frozen)) = lower(trim(item))
     )
  ) then
    raise exception 'Packet IN_SCOPE expands frozen intake scope without owner approval';
  end if;
  if exists (
    select 1
      from jsonb_array_elements_text(v_run.frozen_acceptance_criteria) frozen
     where not exists (
       select 1
         from jsonb_array_elements_text(coalesce(p_packet->'ACCEPTANCE_CRITERIA', '[]'::jsonb)) item
        where item = frozen
     )
  ) then
    raise exception 'Packet ACCEPTANCE_CRITERIA dropped frozen intake criteria';
  end if;

  if not p_packet ? 'claimedApprovalIds' then
    p_packet := p_packet || jsonb_build_object('claimedApprovalIds', '[]'::jsonb);
  end if;
  v_hash := public.software_factory_sha256(p_packet);

  update public.software_factory_runs
     set packet = p_packet,
         packet_hash = v_hash,
         version = v_run.version + 1,
         updated_at = now()
   where id = v_run.id;

  perform public.software_factory_write_evidence(
    v_run,
    'other',
    'Frozen task packet ' || v_run.task_id,
    null,
    jsonb_build_object(
      'schemaVersion', 'software-factory-packet/v1',
      'factoryKind', 'task_packet',
      'packetHash', v_hash,
      'conclusion', 'packet_frozen',
      'satisfiedCriteria', jsonb_build_array('Structured task packet produced.'),
      'recordedAt', now()
    ) || jsonb_build_object('packet', p_packet)
  );
  perform public.software_factory_append_event(
    v_run.id,
    v_run.organization_id,
    'packet:' || v_hash,
    'packet_frozen',
    v_run.lifecycle_status,
    v_run.lifecycle_status,
    'packet:' || v_hash,
    jsonb_build_object('packetHash', v_hash)
  );
  return v_hash;
end;
$$;

create or replace function public.software_factory_attach_evidence(
  p_factory_run_id uuid,
  p_factory_kind text,
  p_summary text,
  p_source_uri text,
  p_conclusion text,
  p_satisfied_criteria jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_kind text;
begin
  if auth.uid() is null or not public.is_platform_staff() then
    raise exception 'Only operations staff can attach Software Factory evidence';
  end if;
  if p_factory_kind in ('task_packet','owner_decision') then
    raise exception 'Reserved Software Factory evidence must be created by its guarded packet or owner-decision writer';
  end if;
  if p_factory_kind not in (
    'repository_inspection','worker_handoff','cursor_execution','pull_request','ci','test',
    'lint','typecheck','build','browser','agent_report','blocker','other'
  ) then
    raise exception 'Unsupported Software Factory evidence kind';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  v_kind := case p_factory_kind
    when 'pull_request' then 'source'
    when 'repository_inspection' then 'source'
    when 'worker_handoff' then 'communication'
    when 'cursor_execution' then 'observation'
    when 'agent_report' then 'observation'
    when 'blocker' then 'observation'
    when 'ci' then 'test'
    when 'test' then 'test'
    when 'lint' then 'test'
    when 'typecheck' then 'test'
    when 'build' then 'test'
    when 'browser' then 'test'
    else 'other'
  end;
  return public.software_factory_write_evidence(
    v_run,
    v_kind,
    trim(p_summary),
    nullif(trim(coalesce(p_source_uri, '')), ''),
    jsonb_build_object(
      'schemaVersion', 'software-factory-evidence/v1',
      'factoryKind', p_factory_kind,
      'conclusion', coalesce(nullif(trim(p_conclusion), ''), 'recorded'),
      'satisfiedCriteria', coalesce(p_satisfied_criteria, '[]'::jsonb),
      'recordedAt', now()
    )
  );
end;
$$;

create or replace function public.software_factory_record_owner_decision(
  p_factory_run_id uuid,
  p_kind text,
  p_status text,
  p_rationale text,
  p_source_refs jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_approval_id uuid;
  v_member_role text;
begin
  if auth.uid() is null then
    raise exception 'Owner decisions require an authenticated organization member';
  end if;
  if public.is_platform_staff() then
    raise exception 'Only the organization owner or a member can record owner decisions outside the task packet';
  end if;
  if p_kind is null or p_status not in ('approved','rejected') then
    raise exception 'Owner decision status must be approved or rejected';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  select m.role into v_member_role
    from public.organization_members m
   where m.user_id = auth.uid()
     and m.organization_id = v_run.organization_id
     and m.status = 'active'
     and m.role in ('client_admin','client_member')
   limit 1;
  if v_member_role is null then
    raise exception 'Cross-tenant access denied';
  end if;
  if v_run.packet_hash is null then
    raise exception 'Owner decisions must bind to a frozen task packet hash';
  end if;
  if exists (
    select 1
      from jsonb_array_elements_text(coalesce(p_source_refs, '[]'::jsonb)) ref
     where lower(trim(ref)) in ('packet','task packet')
  ) then
    raise exception 'Owner decisions cannot cite the task packet as authorization. Cite governance evidence outside the packet';
  end if;

  insert into public.software_factory_approvals (
    organization_id,
    factory_run_id,
    kind,
    status,
    requested_by,
    decided_by,
    rationale,
    source_refs,
    packet_hash,
    decided_at
  ) values (
    v_run.organization_id,
    v_run.id,
    p_kind,
    p_status,
    auth.uid(),
    auth.uid(),
    trim(p_rationale),
    coalesce(p_source_refs, '[]'::jsonb),
    v_run.packet_hash,
    now()
  )
  returning id into v_approval_id;

  update public.software_factory_runs
     set merge_authorized_for_human = case when p_kind = 'merge_pr' and p_status = 'approved' then true else merge_authorized_for_human end,
         version = version + 1,
         updated_at = now()
   where id = v_run.id;

  perform public.software_factory_append_event(
    v_run.id,
    v_run.organization_id,
    'owner_decision:' || v_approval_id::text,
    'owner_decision_recorded',
    v_run.lifecycle_status,
    v_run.lifecycle_status,
    'owner_decision:' || v_approval_id::text,
    jsonb_build_object('approvalId', v_approval_id, 'kind', p_kind, 'status', p_status, 'packetHash', v_run.packet_hash)
  );
  return v_approval_id;
end;
$$;

create or replace function public.software_factory_reject_forbidden_action(
  p_factory_run_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Forbidden-action checks require an authenticated actor';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  perform public.software_factory_append_event(
    v_run.id,
    v_run.organization_id,
    'forbidden:' || p_factory_run_id::text || ':' || p_action || ':' || extract(epoch from now())::text,
    'forbidden_action_blocked',
    v_run.lifecycle_status,
    v_run.lifecycle_status,
    'action:' || p_action,
    jsonb_build_object('blocked', true, 'mergePerformed', false, 'action', p_action)
  );
  if p_action = 'merge_pr' then
    raise exception 'Merge remains blocked. Software Factory Run Manager is prepare_only and does not merge pull requests';
  end if;
  raise exception 'Software Factory v1 blocks % and never performs it', p_action;
end;
$$;

create or replace function public.enforce_software_factory_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_kinds text[];
begin
  if not public.is_software_factory_workstream_run(new.run_id) then
    return new;
  end if;
  if new.verification_status is distinct from 'passed' or not new.definition_of_done_met then
    return new;
  end if;
  if coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only an authenticated operations manager may pass a Software Factory run'
      using errcode = '23514';
  end if;
  if new.verified_by is distinct from auth.uid() then
    raise exception 'Software Factory Outcome Receipt verified_by must equal the authenticated verifier'
      using errcode = '23514';
  end if;

  select * into v_run
    from public.software_factory_runs
   where workstream_run_id = new.run_id;
  if not found then
    raise exception 'A Software Factory overlay is required before a passing receipt'
      using errcode = '23514';
  end if;
  if v_run.lifecycle_status <> 'awaiting_owner' then
    raise exception 'A Software Factory passing receipt is issued from awaiting_owner'
      using errcode = '23514';
  end if;
  if v_run.action_class <> 'prepare_only' or v_run.merge_performed or v_run.may_own_authoritative_state then
    raise exception 'Software Factory v1 remains prepare_only and cannot record a performed merge'
      using errcode = '23514';
  end if;
  if v_run.packet is null or v_run.packet_hash is distinct from public.software_factory_sha256(v_run.packet) then
    raise exception 'Software Factory packet hash mismatch'
      using errcode = '23514';
  end if;
  if not exists (
    select 1
      from public.software_factory_approvals a
     where a.factory_run_id = v_run.id
       and a.kind = 'owner_acceptance'
       and a.status = 'approved'
       and a.packet_hash = v_run.packet_hash
       and a.decided_by is distinct from new.verified_by
  ) then
    raise exception 'Explicit owner acceptance must be recorded outside the task packet'
      using errcode = '23514';
  end if;

  select coalesce(array_agg(distinct e.payload->>'factoryKind'), array[]::text[])
    into v_kinds
    from public.evidence_artifacts e
   where e.run_id = new.run_id;

  if not (
    'repository_inspection' = any(v_kinds)
    and ('task_packet' = any(v_kinds) or v_run.packet is not null)
    and 'pull_request' = any(v_kinds)
    and 'ci' = any(v_kinds)
    and 'test' = any(v_kinds)
  ) then
    raise exception 'Required Software Factory evidence is missing'
      using errcode = '23514';
  end if;
  if v_kinds <@ array['agent_report','cursor_execution'] then
    raise exception 'A provider success claim or agent report cannot accept the run'
      using errcode = '23514';
  end if;

  update public.software_factory_runs
     set lifecycle_status = 'accepted',
         version = version + 1,
         updated_at = now()
   where id = v_run.id
     and lifecycle_status = 'awaiting_owner';

  return new;
end;
$$;

drop trigger if exists trg_software_factory_receipt_gate on public.outcome_receipts;
create trigger trg_software_factory_receipt_gate
  before insert on public.outcome_receipts
  for each row execute function public.enforce_software_factory_receipt();

revoke all on function public.software_factory_append_event(uuid, uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.software_factory_sync_workstream(uuid, text) from public, anon, authenticated;
revoke all on function public.software_factory_write_evidence(public.software_factory_runs, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.software_factory_sha256(jsonb) from public, anon, authenticated;
revoke all on function public.software_factory_bind_workstream_run(uuid, text, text, text, jsonb, jsonb) from public, anon;
revoke all on function public.software_factory_transition(uuid, text, integer) from public, anon;
revoke all on function public.software_factory_inspect_repository(uuid, text) from public, anon;
revoke all on function public.software_factory_record_missing_handoffs(uuid) from public, anon;
revoke all on function public.software_factory_freeze_packet(uuid, jsonb) from public, anon;
revoke all on function public.software_factory_attach_evidence(uuid, text, text, text, text, jsonb) from public, anon;
revoke all on function public.software_factory_record_owner_decision(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.software_factory_reject_forbidden_action(uuid, text) from public, anon;

grant execute on function public.software_factory_bind_workstream_run(uuid, text, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.software_factory_transition(uuid, text, integer) to authenticated;
grant execute on function public.software_factory_inspect_repository(uuid, text) to authenticated;
grant execute on function public.software_factory_record_missing_handoffs(uuid) to authenticated;
grant execute on function public.software_factory_freeze_packet(uuid, jsonb) to authenticated;
grant execute on function public.software_factory_attach_evidence(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.software_factory_record_owner_decision(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.software_factory_reject_forbidden_action(uuid, text) to authenticated;
