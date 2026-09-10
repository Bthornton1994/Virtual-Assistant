-- Outcome economics event seam v1
--
-- NO NEW TABLES. NO NEW COLUMNS. No stored remaining counter.
-- Append-only economics events live on existing evidence_artifacts with a
-- DISTINCT schemaVersion `outcome-economics-event/v1`. This does not change
-- `outcome-economics-evidence/v1`.
--
-- Durable anchors: evidence_artifacts (events), workstream_runs (run lock),
-- run_executor_assignments (native work-cell lock). Leased execution_attempts
-- are EXPLICITLY OUT OF SCOPE in this slice: current complete_execution_attempt
-- / fail_execution_attempt callers cannot supply durable reservation IDs and
-- transactional economics finalization. Do not claim universal enforcement.
--
-- Remaining budget is computed in SQL: envelope ceiling - committed -
-- open_reserved. Never reuse workstream_runs.ai_cost_micros,
-- run_executor_assignments.ai_cost_micros, assignment metadata, or process-local
-- Maps as remaining.
--
-- Lock order (everywhere in this file):
--   1. workstream_runs FOR UPDATE
--   2. run_executor_assignments FOR UPDATE
--
-- Direct PostgREST inserts for this schema are denied, including platform staff.
-- Writes go through narrowly scoped SECURITY DEFINER RPCs only.
--
-- SQL_VERIFICATION_NOT_AVAILABLE: do not apply this file to a live
-- Delegation Cloud database from this change. Do not claim Production
-- enforcement.

-- ---------------------------------------------------------------------------
-- Indexes: partial unique on reservation/event and idempotency/event.
-- No (run_id, schemaVersion) singleton. No unique on assignment ID.
-- content_hash is not reservation identity.
-- ---------------------------------------------------------------------------

create unique index if not exists outcome_economics_event_reservation_type_idx
  on public.evidence_artifacts (
    run_id,
    (payload->>'reservationId'),
    (payload->>'eventType')
  )
  where payload->>'schemaVersion' = 'outcome-economics-event/v1';

create unique index if not exists outcome_economics_event_idempotency_type_idx
  on public.evidence_artifacts (
    run_id,
    (payload->>'idempotencyKey'),
    (payload->>'eventType')
  )
  where payload->>'schemaVersion' = 'outcome-economics-event/v1';

create index if not exists outcome_economics_event_run_reservation_idx
  on public.evidence_artifacts (run_id, (payload->>'reservationId'))
  where payload->>'schemaVersion' = 'outcome-economics-event/v1';

-- ---------------------------------------------------------------------------
-- RLS: reserved schema exclusion. Staff/operator PostgREST insert denied.
-- DEFINER writers execute as the migration owner and do not depend on this
-- authenticated policy.
-- ---------------------------------------------------------------------------

drop policy if exists evidence_artifacts_insert on public.evidence_artifacts;
create policy evidence_artifacts_insert on public.evidence_artifacts
  for insert to authenticated
  with check (
    public.is_platform_staff()
    and coalesce(payload->>'schemaVersion', '') not in (
      'twl-prepare-proof-assignment/v1',
      'twl-prepare-proof-pr/v1',
      'software-factory-packet/v1',
      'software-factory-owner-decision/v1',
      'outcome-economics-event/v1'
    )
  );

-- ---------------------------------------------------------------------------
-- Canonical hash wrapper. Reuses the existing sorted-key SHA-256 used by
-- TWL proof writers so event contentHash is computed in SQL, never trusted
-- from the caller.
-- ---------------------------------------------------------------------------

create or replace function public.outcome_economics_event_canonical_sha256(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select public.twl_prepare_proof_sha256(p_value);
$$;

revoke all on function public.outcome_economics_event_canonical_sha256(jsonb) from public;
grant execute on function public.outcome_economics_event_canonical_sha256(jsonb) to authenticated;

create or replace function public.outcome_economics_event_has_forbidden_keys(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'object' then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_value)
  loop
    if lower(v_key) in (
      'prompt', 'completion', 'content', 'payload', 'body', 'message', 'raw',
      'chainofthought', 'chain_of_thought', 'reasoning', 'credential',
      'credentials', 'secret', 'secrets', 'token', 'password', 'apikey',
      'api_key', 'leaseToken', 'leasetoken', 'leaseTokenHash', 'tokenHash'
    ) then
      return true;
    end if;
    v_child := p_value -> v_key;
    if jsonb_typeof(v_child) = 'object' and public.outcome_economics_event_has_forbidden_keys(v_child) then
      return true;
    end if;
    if jsonb_typeof(v_child) = 'array' then
      if exists (
        select 1
          from jsonb_array_elements(v_child) as e(value)
         where jsonb_typeof(e.value) = 'object'
           and public.outcome_economics_event_has_forbidden_keys(e.value)
      ) then
        return true;
      end if;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function public.outcome_economics_event_has_forbidden_keys(jsonb) from public;

create or replace function public.outcome_economics_safe_micros(p_value bigint)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_value is null or p_value < 0 or p_value > 9007199254740991 then
    raise exception 'Economics amounts must be safe non-negative integer micros';
  end if;
  return p_value;
end;
$$;

revoke all on function public.outcome_economics_safe_micros(bigint) from public;

create or replace function public.outcome_economics_envelope_ceiling(
  p_envelope jsonb,
  p_camel text,
  p_snake text
)
returns bigint
language plpgsql
stable
set search_path = public
as $$
declare
  v_camel numeric;
  v_snake numeric;
begin
  if p_envelope is null or jsonb_typeof(p_envelope) is distinct from 'object' then
    return null;
  end if;
  if p_envelope ? p_camel then
    begin
      v_camel := (p_envelope->>p_camel)::numeric;
    exception when others then
      raise exception 'Economic envelope ceiling % is not a safe integer', p_camel;
    end;
    if v_camel is null or v_camel < 0 or v_camel <> trunc(v_camel) or v_camel > 9007199254740991 then
      raise exception 'Economic envelope ceiling % is not a safe integer', p_camel;
    end if;
  end if;
  if p_envelope ? p_snake then
    begin
      v_snake := (p_envelope->>p_snake)::numeric;
    exception when others then
      raise exception 'Economic envelope ceiling % is not a safe integer', p_snake;
    end;
    if v_snake is null or v_snake < 0 or v_snake <> trunc(v_snake) or v_snake > 9007199254740991 then
      raise exception 'Economic envelope ceiling % is not a safe integer', p_snake;
    end if;
  end if;
  if v_camel is not null and v_snake is not null and v_camel is distinct from v_snake then
    raise exception 'Economic envelope camel and snake ceilings conflict';
  end if;
  if v_camel is not null then
    return v_camel::bigint;
  end if;
  if v_snake is not null then
    return v_snake::bigint;
  end if;
  return null;
end;
$$;

revoke all on function public.outcome_economics_envelope_ceiling(jsonb, text, text) from public;

create or replace function public.outcome_economics_event_is_terminal(p_event_type text)
returns boolean
language sql
immutable
as $$
  select p_event_type in ('committed', 'released', 'expired', 'owner_action_required');
$$;

-- Remaining: ceiling - committed - open_reserved.
-- open_reserved = reserved with no terminal event and expiresAt > now().
-- When the run is not running, expired rows cannot be inserted; remaining still
-- derives TTL from reserved payload expiresAt.
create or replace function public.outcome_economics_remaining_for_run(p_run_id uuid)
returns table (
  remaining_ai_cost_micros bigint,
  remaining_tool_cost_micros bigint,
  committed_ai_cost_micros bigint,
  committed_tool_cost_micros bigint,
  open_reserved_ai_cost_micros bigint,
  open_reserved_tool_cost_micros bigint,
  ceiling_ai_cost_micros bigint,
  ceiling_tool_cost_micros bigint
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_envelope jsonb;
  v_ceiling_ai bigint;
  v_ceiling_tool bigint;
  v_committed_ai bigint;
  v_committed_tool bigint;
  v_open_ai bigint;
  v_open_tool bigint;
begin
  select ds.economic_envelope
    into v_envelope
    from public.workstream_runs wr
    join public.delegation_specs ds on ds.id = wr.delegation_spec_id
   where wr.id = p_run_id;
  if not found then
    raise exception 'Workstream run % was not found', p_run_id;
  end if;

  v_ceiling_ai := public.outcome_economics_envelope_ceiling(v_envelope, 'maxAiCostMicros', 'max_ai_cost_micros');
  v_ceiling_tool := public.outcome_economics_envelope_ceiling(v_envelope, 'maxToolCostMicros', 'max_tool_cost_micros');

  select
    coalesce(sum((e.payload->>'aiCostMicros')::bigint), 0),
    coalesce(sum((e.payload->>'toolCostMicros')::bigint), 0)
    into v_committed_ai, v_committed_tool
    from public.evidence_artifacts e
   where e.run_id = p_run_id
     and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and e.payload->>'eventType' = 'committed';

  select
    coalesce(sum((r.payload->>'aiCostMicros')::bigint), 0),
    coalesce(sum((r.payload->>'toolCostMicros')::bigint), 0)
    into v_open_ai, v_open_tool
    from public.evidence_artifacts r
   where r.run_id = p_run_id
     and r.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and r.payload->>'eventType' = 'reserved'
     and coalesce(r.payload->>'expiresAt', '') <> ''
     and (r.payload->>'expiresAt')::timestamptz > now()
     and not exists (
       select 1
         from public.evidence_artifacts t
        where t.run_id = p_run_id
          and t.payload->>'schemaVersion' = 'outcome-economics-event/v1'
          and t.payload->>'reservationId' = r.payload->>'reservationId'
          and public.outcome_economics_event_is_terminal(t.payload->>'eventType')
     );

  remaining_ai_cost_micros := case
    when v_ceiling_ai is null then null
    else v_ceiling_ai - v_committed_ai - v_open_ai
  end;
  remaining_tool_cost_micros := case
    when v_ceiling_tool is null then null
    else v_ceiling_tool - v_committed_tool - v_open_tool
  end;
  committed_ai_cost_micros := v_committed_ai;
  committed_tool_cost_micros := v_committed_tool;
  open_reserved_ai_cost_micros := v_open_ai;
  open_reserved_tool_cost_micros := v_open_tool;
  ceiling_ai_cost_micros := v_ceiling_ai;
  ceiling_tool_cost_micros := v_ceiling_tool;
  return next;
end;
$$;

revoke all on function public.outcome_economics_remaining_for_run(uuid) from public;
grant execute on function public.outcome_economics_remaining_for_run(uuid) to authenticated;

create or replace function public.enforce_outcome_economics_event_writer()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_schema text := new.payload->>'schemaVersion';
  v_event_type text;
  v_reservation_id text;
  v_idempotency_key text;
begin
  if v_schema is distinct from 'outcome-economics-event/v1' then
    return new;
  end if;

  if current_user <> 'postgres' then
    raise exception 'Reserved outcome-economics-event/v1 evidence must be written by its database-owned writer';
  end if;

  if new.created_by is null then
    raise exception 'Reserved outcome-economics-event/v1 evidence requires an authenticated creator';
  end if;

  if new.kind is distinct from 'observation' then
    raise exception 'outcome-economics-event/v1 evidence must use kind observation';
  end if;

  v_event_type := new.payload->>'eventType';
  v_reservation_id := new.payload->>'reservationId';
  v_idempotency_key := new.payload->>'idempotencyKey';

  if v_reservation_id is null or btrim(v_reservation_id) = ''
     or v_idempotency_key is null or btrim(v_idempotency_key) = ''
     or v_event_type is null or btrim(v_event_type) = '' then
    raise exception 'outcome-economics-event/v1 requires reservationId, idempotencyKey, and eventType';
  end if;

  if v_event_type not in (
    'reserved', 'invocation_started', 'committed', 'released', 'expired', 'owner_action_required'
  ) then
    raise exception 'Unsupported outcome-economics-event/v1 eventType';
  end if;

  if public.outcome_economics_event_has_forbidden_keys(new.payload) then
    raise exception 'outcome-economics-event/v1 must not store prompts, completions, secrets, or raw provider content';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_outcome_economics_event_writer on public.evidence_artifacts;
create trigger trg_outcome_economics_event_writer
  before insert on public.evidence_artifacts
  for each row execute function public.enforce_outcome_economics_event_writer();

-- Internal append. Caller MUST already hold workstream_runs then assignment
-- row locks. Computes remaining and hashes in SQL. Never UPDATEs an event.
create or replace function public.outcome_economics_event_append(
  p_run public.workstream_runs,
  p_assignment public.run_executor_assignments,
  p_event_type text,
  p_reservation_id text,
  p_idempotency_key text,
  p_ai_cost_micros bigint,
  p_tool_cost_micros bigint,
  p_expires_at timestamptz,
  p_executor_key text,
  p_capability_key text,
  p_input_manifest_content_hash text,
  p_envelope_hash text,
  p_context_hash text,
  p_plan_hash text,
  p_output_artifact_id text,
  p_packet_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hex64 constant text := '^[0-9a-f]{64}$';
  v_actor uuid := auth.uid();
  v_ai bigint;
  v_tool bigint;
  v_payload jsonb;
  v_hashable jsonb;
  v_content_hash text;
  v_existing public.evidence_artifacts%rowtype;
  v_reserved public.evidence_artifacts%rowtype;
  v_terminal text;
  v_has_started boolean;
  v_artifact_id uuid;
  v_remaining record;
  v_event_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_native_assignment_id text;
begin
  if v_actor is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can write outcome-economics-event/v1 evidence';
  end if;
  if p_event_type not in (
    'reserved', 'invocation_started', 'committed', 'released', 'expired', 'owner_action_required'
  ) then
    raise exception 'Unsupported outcome-economics-event/v1 eventType';
  end if;
  if p_reservation_id is null or p_reservation_id !~ v_hex64 then
    raise exception 'Economics reservationId must be a sha256 hex digest';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ v_hex64 then
    raise exception 'Economics idempotencyKey must be a sha256 hex digest';
  end if;

  v_ai := public.outcome_economics_safe_micros(coalesce(p_ai_cost_micros, 0));
  v_tool := public.outcome_economics_safe_micros(coalesce(p_tool_cost_micros, 0));
  v_native_assignment_id := coalesce(p_assignment.metadata->>'assignmentId', '');
  if v_native_assignment_id is null or btrim(v_native_assignment_id) = '' then
    raise exception 'Native economics events require a durable assignment identity';
  end if;
  if p_assignment.organization_id is distinct from p_run.organization_id
     or p_assignment.run_id is distinct from p_run.id then
    raise exception 'Economics event assignment does not belong to the locked Workstream Run';
  end if;

  if p_run.status is distinct from 'running' then
    raise exception 'OWNER_ACTION_REQUIRED: economics events cannot be appended after the Workstream Run leaves running. Unresolved economics are preserved. Evidence may only be appended while a run is running';
  end if;

  select * into v_existing
    from public.evidence_artifacts e
   where e.run_id = p_run.id
     and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and e.payload->>'eventType' = p_event_type
     and (
       e.payload->>'reservationId' = p_reservation_id
       or e.payload->>'idempotencyKey' = p_idempotency_key
     )
   order by e.created_at
   limit 1;
  if found then
    if v_existing.payload->>'reservationId' is distinct from p_reservation_id
       or v_existing.payload->>'idempotencyKey' is distinct from p_idempotency_key
       or v_existing.payload->>'nativeAssignmentId' is distinct from v_native_assignment_id
       or v_existing.payload->>'eventType' is distinct from p_event_type then
      raise exception 'Economics event idempotency conflict';
    end if;
    if p_event_type = 'reserved'
       and (
         (v_existing.payload->>'aiCostMicros')::bigint is distinct from v_ai
         or (v_existing.payload->>'toolCostMicros')::bigint is distinct from v_tool
       ) then
      raise exception 'Economics event idempotency conflict';
    end if;
    return v_existing.id;
  end if;

  select * into v_reserved
    from public.evidence_artifacts e
   where e.run_id = p_run.id
     and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and e.payload->>'reservationId' = p_reservation_id
     and e.payload->>'eventType' = 'reserved';

  if p_event_type <> 'reserved' and not found then
    raise exception 'Economics % requires a reserved event for this reservation', p_event_type;
  end if;
  if found then
    if v_reserved.payload->>'nativeAssignmentId' is distinct from v_native_assignment_id
       or v_reserved.payload->>'organizationId' is distinct from p_run.organization_id::text
       or v_reserved.payload->>'runId' is distinct from p_run.id::text then
      raise exception 'Economics reservation does not belong to this native assignment';
    end if;
    if p_event_type <> 'reserved' then
      v_ai := public.outcome_economics_safe_micros((v_reserved.payload->>'aiCostMicros')::bigint);
      v_tool := public.outcome_economics_safe_micros((v_reserved.payload->>'toolCostMicros')::bigint);
    end if;
  end if;

  select t.payload->>'eventType' into v_terminal
    from public.evidence_artifacts t
   where t.run_id = p_run.id
     and t.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and t.payload->>'reservationId' = p_reservation_id
     and public.outcome_economics_event_is_terminal(t.payload->>'eventType')
   limit 1;

  select exists (
    select 1
      from public.evidence_artifacts s
     where s.run_id = p_run.id
       and s.payload->>'schemaVersion' = 'outcome-economics-event/v1'
       and s.payload->>'reservationId' = p_reservation_id
       and s.payload->>'eventType' = 'invocation_started'
  ) into v_has_started;

  if p_event_type = 'committed' then
    if v_terminal in ('released', 'expired', 'owner_action_required') then
      raise exception 'A reservation that is % cannot be committed', v_terminal;
    end if;
  elsif p_event_type = 'released' then
    if v_terminal = 'committed' then
      raise exception 'A committed reservation cannot be released';
    end if;
    if v_has_started then
      raise exception 'invocation_started cannot be silently released; owner_action_required is required';
    end if;
    if v_terminal in ('expired', 'owner_action_required') then
      raise exception 'A reservation that is % cannot be released', v_terminal;
    end if;
  elsif p_event_type = 'expired' then
    if v_terminal = 'committed' then
      raise exception 'A committed reservation cannot expire';
    end if;
  elsif p_event_type = 'owner_action_required' then
    if v_terminal = 'committed' then
      raise exception 'A committed reservation cannot move to owner_action_required';
    end if;
    if v_terminal = 'released' then
      raise exception 'A released reservation cannot move to owner_action_required';
    end if;
  elsif p_event_type = 'invocation_started' then
    if v_terminal is not null then
      raise exception 'A reservation that is % cannot start invocation', v_terminal;
    end if;
  elsif p_event_type = 'reserved' then
    if v_terminal is not null or v_has_started then
      raise exception 'A reservation cannot be re-opened after a later economics event';
    end if;
  end if;

  if p_event_type = 'reserved' then
    select * into v_remaining
      from public.outcome_economics_remaining_for_run(p_run.id);
    if v_remaining.ceiling_ai_cost_micros is not null
       and v_remaining.remaining_ai_cost_micros - v_ai < 0 then
      raise exception 'Economics reservation would exceed the AI cost ceiling';
    end if;
    if v_remaining.ceiling_tool_cost_micros is not null
       and v_remaining.remaining_tool_cost_micros - v_tool < 0 then
      raise exception 'Economics reservation would exceed the tool cost ceiling';
    end if;
  end if;

  if p_input_manifest_content_hash is not null and p_input_manifest_content_hash !~ v_hex64 then
    raise exception 'Economics input-manifest content hash must be a sha256 hex digest';
  end if;
  if p_envelope_hash is not null and p_envelope_hash !~ v_hex64 then
    raise exception 'Economics envelope hash must be a sha256 hex digest';
  end if;
  if p_context_hash is not null and p_context_hash !~ v_hex64 then
    raise exception 'Economics execution context hash must be a sha256 hex digest';
  end if;
  if p_plan_hash is not null and p_plan_hash !~ v_hex64 then
    raise exception 'Economics plan hash must be a sha256 hex digest';
  end if;
  if p_packet_content_hash is not null and p_packet_content_hash !~ v_hex64 then
    raise exception 'Economics packet content hash must be a sha256 hex digest';
  end if;

  v_payload := jsonb_build_object(
    'schemaVersion', 'outcome-economics-event/v1',
    'eventType', p_event_type,
    'organizationId', p_run.organization_id::text,
    'runId', p_run.id::text,
    'reservationId', p_reservation_id,
    'idempotencyKey', p_idempotency_key,
    'ownerKind', 'native_assignment',
    'nativeAssignmentId', v_native_assignment_id,
    'leasedAttemptId', null,
    'eventAt', v_event_at,
    'expiresAt', case when p_expires_at is null then to_jsonb(null::text) else to_jsonb(to_char(p_expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end,
    'aiCostMicros', v_ai,
    'toolCostMicros', v_tool,
    'executorKey', p_executor_key,
    'capabilityKey', p_capability_key,
    'inputManifestContentHash', p_input_manifest_content_hash,
    'envelopeHash', p_envelope_hash,
    'contextHash', p_context_hash,
    'planHash', p_plan_hash,
    'outputArtifactId', p_output_artifact_id,
    'packetContentHash', p_packet_content_hash
  );
  -- jsonb_build_object with a CASE that returns jsonb can nest. Normalize expiresAt.
  v_payload := v_payload || jsonb_build_object(
    'expiresAt', case
      when p_event_type = 'reserved' and p_expires_at is not null then
        to_char(p_expires_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      when v_reserved.id is not null then v_reserved.payload->>'expiresAt'
      else null
    end
  );

  if public.outcome_economics_event_has_forbidden_keys(v_payload) then
    raise exception 'outcome-economics-event/v1 must not store prompts, completions, secrets, or raw provider content';
  end if;

  v_hashable := v_payload;
  v_payload := v_payload || jsonb_build_object(
    'contentHash', public.outcome_economics_event_canonical_sha256(v_hashable)
  );

  begin
    insert into public.evidence_artifacts (
      organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
    ) values (
      p_run.organization_id,
      p_run.id,
      'observation',
      format('Outcome economics %s event for reservation %s', p_event_type, p_reservation_id),
      null,
      v_payload->>'contentHash',
      v_payload,
      v_actor
    ) returning id into v_artifact_id;
  exception
    when unique_violation then
      select * into v_existing
        from public.evidence_artifacts e
       where e.run_id = p_run.id
         and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
         and e.payload->>'eventType' = p_event_type
         and (
           e.payload->>'reservationId' = p_reservation_id
           or e.payload->>'idempotencyKey' = p_idempotency_key
         )
       limit 1;
      if not found then
        raise;
      end if;
      return v_existing.id;
  end;

  return v_artifact_id;
end;
$$;

revoke all on function public.outcome_economics_event_append(
  public.workstream_runs, public.run_executor_assignments, text, text, text,
  bigint, bigint, timestamptz, text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.outcome_economics_lock_native_parents(
  p_run_id uuid,
  p_phase text,
  p_assignment_id text
)
returns table (run public.workstream_runs, assignment public.run_executor_assignments)
language plpgsql
set search_path = public
as $$
declare
  v_run public.workstream_runs%rowtype;
  v_assignment public.run_executor_assignments%rowtype;
begin
  -- Lock order: workstream_runs then run_executor_assignments.
  select * into v_run
    from public.workstream_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'Workstream run % was not found', p_run_id;
  end if;

  select * into v_assignment
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;
  if not found then
    raise exception 'Native work-cell assignment was not found for economics locking';
  end if;
  if coalesce(v_assignment.metadata->>'assignmentId', '') is distinct from p_assignment_id then
    raise exception 'Work-cell phase claim identity does not match the economics request';
  end if;
  run := v_run;
  assignment := v_assignment;
  return next;
end;
$$;

revoke all on function public.outcome_economics_lock_native_parents(uuid, text, text) from public, anon, authenticated, service_role;

create or replace function public.reserve_outcome_economics_event(
  p_run_id uuid,
  p_phase text,
  p_assignment_id text,
  p_reservation_id text,
  p_idempotency_key text,
  p_ai_cost_micros bigint,
  p_tool_cost_micros bigint,
  p_expires_at timestamptz,
  p_executor_key text,
  p_capability_key text,
  p_input_manifest_content_hash text,
  p_envelope_hash text,
  p_context_hash text,
  p_plan_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parents record;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can reserve outcome economics events';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Economics reservation requires a future expiresAt';
  end if;

  select * into v_parents
    from public.outcome_economics_lock_native_parents(p_run_id, p_phase, p_assignment_id);
  if v_parents.assignment.status is distinct from 'running' then
    raise exception 'Economics reservation requires a running native work-cell assignment';
  end if;
  if coalesce(v_parents.assignment.metadata->>'executorKey', '') is distinct from p_executor_key
     or coalesce(v_parents.assignment.metadata->>'capabilityKey', '') is distinct from p_capability_key
     or coalesce(v_parents.assignment.metadata->>'inputManifestContentHash', '') is distinct from p_input_manifest_content_hash
     or coalesce(v_parents.assignment.metadata->>'envelopeHash', '') is distinct from p_envelope_hash
     or coalesce(v_parents.assignment.metadata->>'contextHash', '') is distinct from p_context_hash then
    raise exception 'Economics reservation identity does not match the locked assignment';
  end if;

  return public.outcome_economics_event_append(
    v_parents.run,
    v_parents.assignment,
    'reserved',
    p_reservation_id,
    p_idempotency_key,
    p_ai_cost_micros,
    p_tool_cost_micros,
    p_expires_at,
    p_executor_key,
    p_capability_key,
    p_input_manifest_content_hash,
    p_envelope_hash,
    p_context_hash,
    p_plan_hash,
    null,
    null
  );
end;
$$;

create or replace function public.start_outcome_economics_invocation(
  p_run_id uuid,
  p_phase text,
  p_assignment_id text,
  p_reservation_id text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parents record;
  v_reserved public.evidence_artifacts%rowtype;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can start outcome economics invocations';
  end if;

  select * into v_parents
    from public.outcome_economics_lock_native_parents(p_run_id, p_phase, p_assignment_id);

  select * into v_reserved
    from public.evidence_artifacts e
   where e.run_id = p_run_id
     and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and e.payload->>'reservationId' = p_reservation_id
     and e.payload->>'eventType' = 'reserved';
  if not found then
    raise exception 'invocation_started requires a reserved event';
  end if;

  return public.outcome_economics_event_append(
    v_parents.run,
    v_parents.assignment,
    'invocation_started',
    p_reservation_id,
    p_idempotency_key,
    (v_reserved.payload->>'aiCostMicros')::bigint,
    (v_reserved.payload->>'toolCostMicros')::bigint,
    null,
    v_reserved.payload->>'executorKey',
    v_reserved.payload->>'capabilityKey',
    v_reserved.payload->>'inputManifestContentHash',
    v_reserved.payload->>'envelopeHash',
    v_reserved.payload->>'contextHash',
    v_reserved.payload->>'planHash',
    null,
    null
  );
end;
$$;

create or replace function public.release_outcome_economics_event(
  p_run_id uuid,
  p_phase text,
  p_assignment_id text,
  p_reservation_id text,
  p_idempotency_key text,
  p_owner_action boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parents record;
  v_reserved public.evidence_artifacts%rowtype;
  v_started boolean;
  v_event_type text;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can release outcome economics events';
  end if;

  select * into v_parents
    from public.outcome_economics_lock_native_parents(p_run_id, p_phase, p_assignment_id);

  select * into v_reserved
    from public.evidence_artifacts e
   where e.run_id = p_run_id
     and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and e.payload->>'reservationId' = p_reservation_id
     and e.payload->>'eventType' = 'reserved';
  if not found then
    raise exception 'Economics release requires a reserved event';
  end if;

  select exists (
    select 1
      from public.evidence_artifacts e
     where e.run_id = p_run_id
       and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
       and e.payload->>'reservationId' = p_reservation_id
       and e.payload->>'eventType' = 'invocation_started'
  ) into v_started;

  if v_started then
    if p_owner_action is not true then
      raise exception 'invocation_started cannot be silently released; owner_action_required is required';
    end if;
    v_event_type := 'owner_action_required';
  else
    v_event_type := 'released';
  end if;

  return public.outcome_economics_event_append(
    v_parents.run,
    v_parents.assignment,
    v_event_type,
    p_reservation_id,
    p_idempotency_key,
    (v_reserved.payload->>'aiCostMicros')::bigint,
    (v_reserved.payload->>'toolCostMicros')::bigint,
    null,
    v_reserved.payload->>'executorKey',
    v_reserved.payload->>'capabilityKey',
    v_reserved.payload->>'inputManifestContentHash',
    v_reserved.payload->>'envelopeHash',
    v_reserved.payload->>'contextHash',
    v_reserved.payload->>'planHash',
    null,
    null
  );
end;
$$;

-- Combined finalizer: lock, verify reservations belong to the assignment,
-- verify packet identity, insert committed events, mark assignment completed,
-- commit atomically. Packet presence alone cannot complete.
create or replace function public.finalize_work_cell_phase_economics(
  p_run_id uuid,
  p_phase text,
  p_assignment_id text,
  p_output_artifact_id text,
  p_input_manifest_content_hash text,
  p_envelope_hash text,
  p_context_hash text,
  p_executor_key text,
  p_capability_key text,
  p_reservation_ids text[],
  p_packet_content_hash text,
  p_metadata_patch jsonb default '{}'::jsonb
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parents record;
  v_bound boolean;
  v_reservation_id text;
  v_reserved public.evidence_artifacts%rowtype;
  v_open_count integer;
  v_ids text[];
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can finalize native work-cell economics';
  end if;
  if p_metadata_patch is not null and jsonb_typeof(p_metadata_patch) <> 'object' then
    raise exception 'Work-cell economics finalization metadata must be a JSON object';
  end if;
  if p_metadata_patch ? 'workerId'
     or p_metadata_patch ? 'leaseToken'
     or p_metadata_patch ? 'leaseTokenHash'
     or p_metadata_patch ? 'tokenHash' then
    raise exception 'Work-cell economics finalization must not invent worker, lease, or token fields';
  end if;
  if p_assignment_id is null or btrim(p_assignment_id) = ''
     or p_output_artifact_id is null or btrim(p_output_artifact_id) = ''
     or p_input_manifest_content_hash is null or btrim(p_input_manifest_content_hash) = ''
     or p_envelope_hash is null or btrim(p_envelope_hash) = ''
     or p_context_hash is null or btrim(p_context_hash) = ''
     or p_executor_key is null or btrim(p_executor_key) = ''
     or p_capability_key is null or btrim(p_capability_key) = '' then
    raise exception 'Work-cell economics finalization requires bound claim identity';
  end if;
  if p_packet_content_hash is null or p_packet_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Work-cell economics finalization requires the packet content hash';
  end if;

  select * into v_parents
    from public.outcome_economics_lock_native_parents(p_run_id, p_phase, p_assignment_id);

  if coalesce(v_parents.assignment.metadata->>'inputManifestContentHash', '') is distinct from p_input_manifest_content_hash
     or coalesce(v_parents.assignment.metadata->>'envelopeHash', '') is distinct from p_envelope_hash
     or coalesce(v_parents.assignment.metadata->>'contextHash', '') is distinct from p_context_hash
     or coalesce(v_parents.assignment.metadata->>'executorKey', '') is distinct from p_executor_key
     or coalesce(v_parents.assignment.metadata->>'capabilityKey', '') is distinct from p_capability_key then
    raise exception 'Work-cell phase claim identity does not match the completion request';
  end if;
  if v_parents.assignment.output_artifact_id is null
     or v_parents.assignment.output_artifact_id::text is distinct from p_output_artifact_id then
    raise exception 'Work-cell phase claim output artifact does not match the completion request';
  end if;

  select exists (
    select 1
      from public.evidence_artifacts e
     where e.id = v_parents.assignment.output_artifact_id
       and e.id = p_output_artifact_id::uuid
       and e.run_id = p_run_id
       and e.payload->>'schemaVersion' = 'catalog-evidence-packet/v1'
       and e.payload->>'runId' = p_run_id::text
       and e.payload->>'executorKey' = p_executor_key
       and e.content_hash = p_packet_content_hash
       and public.outcome_economics_event_canonical_sha256(e.payload) = p_packet_content_hash
  ) into v_bound;
  if not v_bound then
    raise exception 'An unbound or unrelated catalog evidence packet cannot complete this work-cell phase claim';
  end if;

  if v_parents.assignment.status = 'completed' then
    assignment_id := v_parents.assignment.id;
    assignment_status := v_parents.assignment.status;
    return next;
    return;
  end if;
  if v_parents.assignment.status = 'failed' then
    raise exception 'A failed work-cell phase assignment cannot be completed.';
  end if;
  if v_parents.assignment.status <> 'running' then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;

  v_ids := coalesce(p_reservation_ids, '{}'::text[]);

  foreach v_reservation_id in array v_ids
  loop
    select * into v_reserved
      from public.evidence_artifacts e
     where e.run_id = p_run_id
       and e.payload->>'schemaVersion' = 'outcome-economics-event/v1'
       and e.payload->>'reservationId' = v_reservation_id
       and e.payload->>'eventType' = 'reserved';
    if not found then
      raise exception 'Economics finalization reservation does not exist';
    end if;
    if v_reserved.payload->>'nativeAssignmentId' is distinct from p_assignment_id
       or v_reserved.payload->>'ownerKind' is distinct from 'native_assignment' then
      raise exception 'Economics finalization reservation does not belong to this native assignment';
    end if;
    perform public.outcome_economics_event_append(
      v_parents.run,
      v_parents.assignment,
      'committed',
      v_reservation_id,
      v_reserved.payload->>'idempotencyKey',
      (v_reserved.payload->>'aiCostMicros')::bigint,
      (v_reserved.payload->>'toolCostMicros')::bigint,
      null,
      p_executor_key,
      p_capability_key,
      p_input_manifest_content_hash,
      p_envelope_hash,
      p_context_hash,
      v_reserved.payload->>'planHash',
      p_output_artifact_id,
      p_packet_content_hash
    );
  end loop;

  select count(*) into v_open_count
    from public.evidence_artifacts r
   where r.run_id = p_run_id
     and r.payload->>'schemaVersion' = 'outcome-economics-event/v1'
     and r.payload->>'eventType' = 'reserved'
     and r.payload->>'nativeAssignmentId' = p_assignment_id
     and not exists (
       select 1
         from public.evidence_artifacts t
        where t.run_id = p_run_id
          and t.payload->>'schemaVersion' = 'outcome-economics-event/v1'
          and t.payload->>'reservationId' = r.payload->>'reservationId'
          and public.outcome_economics_event_is_terminal(t.payload->>'eventType')
     );
  if v_open_count > 0 then
    raise exception 'Economics finalization requires every native reservation to be committed or otherwise terminal';
  end if;

  update public.run_executor_assignments
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         metadata = coalesce(metadata, '{}'::jsonb)
           || coalesce(p_metadata_patch, '{}'::jsonb)
           || jsonb_build_object(
             'economicsFinalized', jsonb_build_object(
               'schemaVersion', 'outcome-economics-event/v1',
               'finalizedAt', now(),
               'packetContentHash', p_packet_content_hash
             )
           )
   where id = v_parents.assignment.id
     and status = 'running'
     and output_artifact_id is not null
     and output_artifact_id::text = p_output_artifact_id
   returning id, status into assignment_id, assignment_status;
  if assignment_id is not null then
    return next;
    return;
  end if;
  raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
end;
$$;

revoke all on function public.reserve_outcome_economics_event(
  uuid, text, text, text, text, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public;
revoke execute on function public.reserve_outcome_economics_event(
  uuid, text, text, text, text, bigint, bigint, timestamptz, text, text, text, text, text, text
) from anon, service_role;
grant execute on function public.reserve_outcome_economics_event(
  uuid, text, text, text, text, bigint, bigint, timestamptz, text, text, text, text, text, text
) to authenticated;

revoke all on function public.start_outcome_economics_invocation(uuid, text, text, text, text) from public;
revoke execute on function public.start_outcome_economics_invocation(uuid, text, text, text, text) from anon, service_role;
grant execute on function public.start_outcome_economics_invocation(uuid, text, text, text, text) to authenticated;

revoke all on function public.release_outcome_economics_event(uuid, text, text, text, text, boolean) from public;
revoke execute on function public.release_outcome_economics_event(uuid, text, text, text, text, boolean) from anon, service_role;
grant execute on function public.release_outcome_economics_event(uuid, text, text, text, text, boolean) to authenticated;

revoke all on function public.finalize_work_cell_phase_economics(
  uuid, text, text, text, text, text, text, text, text, text[], text, jsonb
) from public;
revoke execute on function public.finalize_work_cell_phase_economics(
  uuid, text, text, text, text, text, text, text, text, text[], text, jsonb
) from anon, service_role;
grant execute on function public.finalize_work_cell_phase_economics(
  uuid, text, text, text, text, text, text, text, text, text[], text, jsonb
) to authenticated;

-- Old completion path: lock run then assignment, refuse unless committed events
-- already cover every reserved event for this assignment. Managers cannot
-- complete native-prepare without the transactional finalizer. This function
-- does not insert committed events, so commit+complete through this path is
-- not atomic; TypeScript must call finalize_work_cell_phase_economics.
create or replace function public.complete_work_cell_phase_claim(
  p_run_id uuid,
  p_phase text,
  p_metadata_patch jsonb default '{}'::jsonb,
  p_assignment_id text default null,
  p_output_artifact_id text default null,
  p_input_manifest_content_hash text default null,
  p_envelope_hash text default null,
  p_context_hash text default null,
  p_executor_key text default null,
  p_capability_key text default null
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.run_executor_assignments%rowtype;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can complete a work-cell phase claim';
  end if;

  -- Lock order: workstream_runs then run_executor_assignments.
  perform 1
    from public.workstream_runs
   where id = p_run_id
   for update;

  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if not found then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;

  if v_existing.status = 'completed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;

  raise exception 'Work-cell phase claim completion requires committed economics events from finalize_work_cell_phase_economics. Packet presence is not economics proof';
end;
$$;

create or replace function public.fail_work_cell_phase_claim(
  p_run_id uuid,
  p_phase text,
  p_reason text,
  p_stale_only boolean default false,
  p_ttl_ms integer default 120000,
  p_reservation_ids text[] default '{}'::text[]
)
returns table (assignment_id uuid, assignment_status text)
language plpgsql
set search_path = public
as $$
declare
  v_run public.workstream_runs%rowtype;
  v_existing public.run_executor_assignments%rowtype;
  v_ttl interval;
  v_bound_packet boolean;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can fail a work-cell phase claim';
  end if;
  if p_ttl_ms is null or p_ttl_ms < 0 then
    raise exception 'Work-cell claim reclaim TTL must be a non-negative duration';
  end if;
  v_ttl := make_interval(secs => p_ttl_ms / 1000.0);

  -- Lock order: workstream_runs then run_executor_assignments.
  select * into v_run
    from public.workstream_runs
   where id = p_run_id
   for update;

  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if not found then
    return;
  end if;
  if v_existing.status = 'completed' then
    raise exception 'A completed work-cell phase assignment cannot be overwritten by a claim failure.';
  end if;
  if v_existing.status = 'failed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status <> 'running' then
    raise exception 'The % phase of this run already has a recorded attempt (status: %)', p_phase, v_existing.status;
  end if;

  v_bound_packet := false;
  if v_existing.output_artifact_id is not null then
    select exists (
      select 1
        from public.evidence_artifacts e
       where e.id = v_existing.output_artifact_id
         and e.run_id = p_run_id
         and e.payload->>'schemaVersion' = 'catalog-evidence-packet/v1'
    ) into v_bound_packet;
  end if;

  if v_bound_packet or v_existing.output_artifact_id is not null then
    raise exception 'An accepted catalog evidence packet exists; refusing to fail the work-cell phase claim';
  end if;

  if p_stale_only and v_existing.created_at >= (now() - v_ttl) then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;

  update public.run_executor_assignments
     set status = 'failed',
         completed_at = coalesce(completed_at, now()),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'claimFailure', jsonb_build_object(
             'schemaVersion', 'work-cell-phase-claim-fail/v1',
             'reason', p_reason,
             'failedAt', now(),
             'economicReservationIds', to_jsonb(coalesce(p_reservation_ids, '{}'::text[])),
             'reclaimedWithoutFetch', p_stale_only
           )
         )
   where id = v_existing.id
     and status = 'running'
     and output_artifact_id is null
   returning id, status into assignment_id, assignment_status;
  if assignment_id is not null then
    return next;
    return;
  end if;

  select * into v_existing
    from public.run_executor_assignments
   where id = v_existing.id;
  if v_existing.status = 'failed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status = 'completed' then
    raise exception 'A completed work-cell phase assignment cannot be overwritten by a claim failure.';
  end if;
  raise exception 'An accepted catalog evidence packet exists; refusing to fail the work-cell phase claim';
end;
$$;

revoke all on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) from public;
revoke execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) from anon;
grant execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) to authenticated, service_role;

revoke all on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text, text, text, text, text, text, text) from public;
revoke execute on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text, text, text, text, text, text, text) from anon;
grant execute on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text, text, text, text, text, text, text) to authenticated, service_role;
