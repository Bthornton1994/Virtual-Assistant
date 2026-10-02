-- SF-VA-003: Software Factory database boundary hardening.
-- Replay-safe. QA-only apply. Do not apply to Production from this change.
-- Does not mutate historical evidence_artifacts rows.

alter table public.software_factory_runs
  add column if not exists packet_freeze_version integer not null default 0;

update public.software_factory_runs
   set packet_freeze_version = 1
 where packet is not null
   and packet_freeze_version = 0;

drop index if exists public.software_factory_one_reserved_artifact_per_run_idx;

create unique index if not exists software_factory_packet_freeze_version_idx
  on public.evidence_artifacts (run_id, ((payload->>'freezeVersion')))
  where (payload->>'schemaVersion') = 'software-factory-packet/v1';

create unique index if not exists software_factory_owner_decision_id_idx
  on public.evidence_artifacts (run_id, ((payload->>'decisionId')))
  where (payload->>'schemaVersion') = 'software-factory-owner-decision/v1';

create or replace function public.software_factory_json_has_secrets(p_value jsonb, p_depth integer default 0)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null or p_depth > 8 then
    return false;
  end if;
  if jsonb_typeof(p_value) = 'string' then
    return (p_value #>> '{}') ~ '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,})';
  end if;
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in
      select e.key, e.value from jsonb_each(p_value) as e(key, value)
    loop
      if v_key ~* '(secret|password|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)' then
        return true;
      end if;
      if public.software_factory_json_has_secrets(v_child, p_depth + 1) then
        return true;
      end if;
    end loop;
    return false;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    for v_child in
      select a.value from jsonb_array_elements(p_value) as a(value)
    loop
      if public.software_factory_json_has_secrets(v_child, p_depth + 1) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

create or replace function public.software_factory_acceptance_criteria_covered(p_packet jsonb, p_run_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select not exists (
    select 1
      from jsonb_array_elements_text(coalesce(p_packet->'ACCEPTANCE_CRITERIA', '[]'::jsonb)) criterion
     where not exists (
       select 1
         from public.evidence_artifacts e,
              jsonb_array_elements_text(coalesce(e.payload->'satisfiedCriteria', '[]'::jsonb)) covered
        where e.run_id = p_run_id
          and covered = criterion
     )
  );
$$;

create or replace function public.software_factory_latest_owner_acceptance(p_factory_run_id uuid, p_packet_hash text)
returns public.software_factory_approvals
language sql
stable
set search_path = public
as $$
  select a.*
    from public.software_factory_approvals a
   where a.factory_run_id = p_factory_run_id
     and a.kind = 'owner_acceptance'
     and a.packet_hash = p_packet_hash
     and a.status in ('approved', 'rejected')
     and a.decided_at is not null
   order by a.decided_at desc, a.created_at desc
   limit 1;
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
  v_next_version integer;
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
    select 1 from jsonb_array_elements_text(coalesce(p_packet->'IN_SCOPE', '[]'::jsonb)) item
     where not exists (
       select 1 from jsonb_array_elements_text(v_run.frozen_in_scope) frozen
        where lower(trim(frozen)) = lower(trim(item))
     )
  ) then
    raise exception 'Packet IN_SCOPE expands frozen intake scope without owner approval';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(v_run.frozen_acceptance_criteria) frozen
     where not exists (
       select 1 from jsonb_array_elements_text(coalesce(p_packet->'ACCEPTANCE_CRITERIA', '[]'::jsonb)) item
        where item = frozen
     )
  ) then
    raise exception 'Packet ACCEPTANCE_CRITERIA dropped frozen intake criteria';
  end if;
  if public.software_factory_json_has_secrets(p_packet) then
    raise exception 'Packet looks like a credential and is forbidden in Software Factory artifacts';
  end if;
  if not p_packet ? 'claimedApprovalIds' then
    p_packet := p_packet || jsonb_build_object('claimedApprovalIds', '[]'::jsonb);
  end if;
  v_hash := public.software_factory_sha256(p_packet);
  if v_run.packet_hash is not distinct from v_hash then
    return v_hash;
  end if;
  v_next_version := v_run.packet_freeze_version + 1;
  update public.software_factory_runs
     set packet = p_packet,
         packet_hash = v_hash,
         packet_freeze_version = v_next_version,
         version = v_run.version + 1,
         updated_at = now()
   where id = v_run.id;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  perform public.software_factory_write_evidence(
    v_run,
    'other',
    'Frozen task packet ' || v_run.task_id || ' version ' || v_next_version::text,
    null,
    jsonb_build_object(
      'schemaVersion', 'software-factory-packet/v1',
      'factoryKind', 'task_packet',
      'packetHash', v_hash,
      'freezeVersion', v_next_version,
      'conclusion', 'packet_frozen',
      'satisfiedCriteria', jsonb_build_array('Structured task packet produced.'),
      'recordedAt', now()
    ) || jsonb_build_object('packet', p_packet)
  );
  perform public.software_factory_append_event(
    v_run.id,
    v_run.organization_id,
    'packet:' || v_hash || ':v' || v_next_version::text,
    'packet_frozen',
    v_run.lifecycle_status,
    v_run.lifecycle_status,
    'packet:' || v_hash,
    jsonb_build_object('packetHash', v_hash, 'freezeVersion', v_next_version)
  );
  return v_hash;
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
    select 1 from jsonb_array_elements_text(coalesce(p_source_refs, '[]'::jsonb)) ref
     where lower(trim(ref)) in ('packet','task packet')
  ) then
    raise exception 'Owner decisions cannot cite the task packet as authorization. Cite governance evidence outside the packet';
  end if;
  insert into public.software_factory_approvals (
    organization_id, factory_run_id, kind, status, requested_by, decided_by, rationale, source_refs, packet_hash, decided_at
  ) values (
    v_run.organization_id, v_run.id, p_kind, p_status, auth.uid(), auth.uid(), trim(p_rationale), coalesce(p_source_refs, '[]'::jsonb), v_run.packet_hash, now()
  ) returning id into v_approval_id;
  update public.software_factory_runs
     set merge_authorized_for_human = case when p_kind = 'merge_pr' and p_status = 'approved' then true else merge_authorized_for_human end,
         version = version + 1,
         updated_at = now()
   where id = v_run.id;
  perform public.software_factory_write_evidence(
    v_run,
    'other',
    'Owner ' || p_status || ' ' || p_kind,
    null,
    jsonb_build_object(
      'schemaVersion', 'software-factory-owner-decision/v1',
      'factoryKind', 'owner_decision',
      'decisionId', v_approval_id,
      'kind', p_kind,
      'status', p_status,
      'packetHash', v_run.packet_hash,
      'conclusion', p_status,
      'satisfiedCriteria', case when p_kind = 'owner_acceptance' and p_status = 'approved' then jsonb_build_array('Owner acceptance recorded outside the task packet.') else '[]'::jsonb end,
      'recordedAt', now()
    )
  );
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

drop function if exists public.software_factory_reject_forbidden_action(uuid, text);

create function public.software_factory_reject_forbidden_action(
  p_factory_run_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_event_id bigint;
  v_message text;
begin
  if auth.uid() is null then
    raise exception 'Forbidden-action checks require an authenticated actor';
  end if;
  select * into v_run from public.software_factory_runs where id = p_factory_run_id;
  if not found then
    raise exception 'Software Factory run not found';
  end if;
  insert into public.software_factory_events (
    organization_id, factory_run_id, idempotency_key, actor_id, actor_role, event_type, from_status, to_status, source_ref, payload
  ) values (
    v_run.organization_id,
    v_run.id,
    'forbidden:' || p_factory_run_id::text || ':' || p_action || ':' || gen_random_uuid()::text,
    auth.uid(),
    coalesce(
      public.platform_role(),
      (select m.role from public.organization_members m where m.user_id = auth.uid() and m.organization_id = v_run.organization_id and m.status = 'active' limit 1),
      'unknown'
    ),
    'forbidden_action_blocked',
    v_run.lifecycle_status,
    v_run.lifecycle_status,
    'action:' || p_action,
    jsonb_build_object('blocked', true, 'mergePerformed', false, 'action', p_action)
  ) returning id into v_event_id;
  if p_action = 'merge_pr' then
    v_message := 'Merge remains blocked. Software Factory Run Manager is prepare_only and does not merge pull requests';
  else
    v_message := 'Software Factory v1 blocks ' || p_action || ' and never performs it';
  end if;
  return jsonb_build_object(
    'ok', false,
    'blocked', true,
    'mergePerformed', false,
    'action', p_action,
    'eventId', v_event_id,
    'message', v_message
  );
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
  select status into v_status from public.workstream_runs where id = p_workstream_run_id;
  if v_status is null then
    return;
  end if;
  if v_status in ('verified', 'failed', 'cancelled') then
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
  if v_status = 'planned' and v_target = 'cancelled' then
    update public.workstream_runs
       set status = 'cancelled', completed_at = coalesce(completed_at, now())
     where id = p_workstream_run_id and status = 'planned';
    return;
  end if;
  if v_status = 'planned' and v_target in ('running','awaiting_verification','verified','failed') then
    update public.workstream_runs
       set status = 'running', started_at = coalesce(started_at, now())
     where id = p_workstream_run_id and status = 'planned';
    v_status := 'running';
  end if;
  if v_status = 'running' and v_target = 'cancelled' then
    update public.workstream_runs
       set status = 'cancelled', completed_at = coalesce(completed_at, now())
     where id = p_workstream_run_id and status = 'running';
    return;
  end if;
  if v_status = 'running' and v_target in ('awaiting_verification','verified','failed') then
    update public.workstream_runs
       set status = 'awaiting_verification'
     where id = p_workstream_run_id and status = 'running';
    v_status := 'awaiting_verification';
  end if;
  if v_status = 'awaiting_verification' and v_target in ('failed','cancelled') then
    update public.workstream_runs
       set status = v_target, completed_at = coalesce(completed_at, now())
     where id = p_workstream_run_id and status = 'awaiting_verification';
  end if;
end;
$$;

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
  factory_lifecycle text;
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
    if row(
      new.status,
      new.executor_summary,
      new.human_minutes,
      new.owner_minutes,
      new.ai_cost_micros,
      new.tool_cost_micros,
      new.started_at,
      new.completed_at,
      new.notes
    ) is distinct from row(
      old.status,
      old.executor_summary,
      old.human_minutes,
      old.owner_minutes,
      old.ai_cost_micros,
      old.tool_cost_micros,
      old.started_at,
      old.completed_at,
      old.notes
    ) then
      raise exception 'Terminal workstream runs are immutable';
    end if;
    return new;
  end if;

  select sfr.lifecycle_status into factory_lifecycle
    from public.software_factory_runs sfr
   where sfr.workstream_run_id = old.id;

  if old.status = 'planned' and new.status not in ('planned', 'running', 'cancelled') then
    raise exception 'Invalid workstream run transition: % -> %', old.status, new.status;
  elsif old.status = 'running' and new.status not in ('running', 'awaiting_verification', 'failed', 'cancelled') then
    raise exception 'Invalid workstream run transition: % -> %', old.status, new.status;
  elsif old.status = 'awaiting_verification' then
    if new.status in ('awaiting_verification', 'verified', 'failed') then
      null;
    elsif new.status = 'cancelled' and factory_lifecycle in ('deferred', 'cancelled') then
      null;
    else
      raise exception 'Invalid workstream run transition: % -> %', old.status, new.status;
    end if;
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
        if new.status = 'failed' and factory_lifecycle = 'rejected' then
          null;
        else
          raise exception 'Verified or failed review status requires an Outcome Receipt';
        end if;
      elsif new.status = 'verified' and not (receipt_status = 'passed' and receipt_done) then
        raise exception 'Verified status requires a passing Outcome Receipt with definition of done met';
      elsif new.status = 'failed' and receipt_status = 'passed' and receipt_done then
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

create or replace function public.enforce_software_factory_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.software_factory_runs%rowtype;
  v_kinds text[];
  v_owner public.software_factory_approvals%rowtype;
  v_last_evidence timestamptz;
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

  v_owner := public.software_factory_latest_owner_acceptance(v_run.id, v_run.packet_hash);
  if v_owner.id is null or v_owner.status <> 'approved' then
    raise exception 'Explicit owner acceptance must be recorded outside the task packet'
      using errcode = '23514';
  end if;
  if v_owner.decided_by is not distinct from new.verified_by then
    raise exception 'The owner who accepted this packet cannot issue its Outcome Receipt'
      using errcode = '23514';
  end if;

  if not public.software_factory_acceptance_criteria_covered(v_run.packet, new.run_id) then
    raise exception 'Acceptance criteria are not fully evidenced'
      using errcode = '23514';
  end if;

  select max(e.created_at) into v_last_evidence
    from public.evidence_artifacts e
   where e.run_id = new.run_id;
  if v_last_evidence is not null and now() - v_last_evidence > interval '72 hours' then
    raise exception 'No recent evidence has been recorded; the run is stale'
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

revoke all on function public.software_factory_json_has_secrets(jsonb, integer) from public, anon, authenticated;
revoke all on function public.software_factory_acceptance_criteria_covered(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.software_factory_latest_owner_acceptance(uuid, text) from public, anon, authenticated;
revoke all on function public.software_factory_sync_workstream(uuid, text) from public, anon, authenticated;
revoke all on function public.enforce_software_factory_receipt() from public, anon, authenticated;
revoke all on function public.software_factory_freeze_packet(uuid, jsonb) from public, anon;
revoke all on function public.software_factory_record_owner_decision(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.software_factory_reject_forbidden_action(uuid, text) from public, anon;

grant execute on function public.software_factory_freeze_packet(uuid, jsonb) to authenticated;
grant execute on function public.software_factory_record_owner_decision(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.software_factory_reject_forbidden_action(uuid, text) to authenticated;
