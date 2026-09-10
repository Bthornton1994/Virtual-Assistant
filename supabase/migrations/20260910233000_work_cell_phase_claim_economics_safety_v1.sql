-- Work-cell phase claim bound complete v1
--
-- REPLACE/DROP FUNCTIONS ONLY. No new tables or columns. Uses existing
-- run_executor_assignments and evidence_artifacts.
--
-- Tightens complete_work_cell_phase_claim so completion requires the exact bound
-- claim identity:
--   run ID, phase, assignment identity, output artifact ID,
--   input-manifest content hash, envelope hash, execution context hash,
--   executor key, capability key.
-- An unrelated catalog-evidence-packet/v1 row on the same run cannot
-- complete the current claim.
--
-- TypeScript must not call this RPC from stale reclaim. Packet presence is
-- not economics proof. Process-local Maps are gone after isolate death, so
-- even a successful in-process commit cannot be proven on restart.
-- OWNER_BLOCKED: process-local economics cannot safely finalize a durable
-- accepted packet across isolate death. A durable accounting seam is required
-- before automatic reclaim completion. Durable remaining budget still requires
-- committed evidence_artifacts plus open reservations on existing
-- execution_attempts — not a new totals table.
--
-- Fail still refuses to overwrite completed rows or an accepted packet bound
-- to this assignment's output_artifact_id. It does not treat an unbound
-- catalog packet on the same run as this claim's packet.
--
-- Manager-only. Do not fail completed. Do not complete failed. Do not
-- overwrite accepted packets.
--
-- SQL_VERIFICATION_NOT_AVAILABLE: do not apply this file to a live
-- Delegation Cloud database from this change.

drop function if exists public.complete_work_cell_phase_claim(uuid, text, jsonb, text);

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
  v_bound boolean;
begin
  if auth.uid() is null or coalesce(public.is_ops_manager(), false) is not true then
    raise exception 'Only operations managers can complete a work-cell phase claim';
  end if;
  if p_metadata_patch is not null and jsonb_typeof(p_metadata_patch) <> 'object' then
    raise exception 'Work-cell claim completion metadata must be a JSON object';
  end if;
  if p_metadata_patch ? 'workerId'
     or p_metadata_patch ? 'leaseToken'
     or p_metadata_patch ? 'leaseTokenHash'
     or p_metadata_patch ? 'tokenHash' then
    raise exception 'Work-cell claim completion must not invent worker, lease, or token fields';
  end if;
  if p_assignment_id is null or btrim(p_assignment_id) = ''
     or p_output_artifact_id is null or btrim(p_output_artifact_id) = ''
     or p_input_manifest_content_hash is null or btrim(p_input_manifest_content_hash) = ''
     or p_envelope_hash is null or btrim(p_envelope_hash) = ''
     or p_context_hash is null or btrim(p_context_hash) = ''
     or p_executor_key is null or btrim(p_executor_key) = ''
     or p_capability_key is null or btrim(p_capability_key) = '' then
    raise exception 'Work-cell phase claim completion requires bound claim identity';
  end if;

  select * into v_existing
    from public.run_executor_assignments
   where run_id = p_run_id and phase = p_phase
   for update;

  if not found then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;
  if coalesce(v_existing.metadata->>'assignmentId', '') is distinct from p_assignment_id then
    raise exception 'Work-cell phase claim identity does not match the completion request';
  end if;
  if coalesce(v_existing.metadata->>'inputManifestContentHash', '') is distinct from p_input_manifest_content_hash then
    raise exception 'Work-cell phase claim input-manifest content hash does not match the completion request';
  end if;
  if coalesce(v_existing.metadata->>'envelopeHash', '') is distinct from p_envelope_hash then
    raise exception 'Work-cell phase claim envelope hash does not match the completion request';
  end if;
  if coalesce(v_existing.metadata->>'contextHash', '') is distinct from p_context_hash then
    raise exception 'Work-cell phase claim execution context hash does not match the completion request';
  end if;
  if coalesce(v_existing.metadata->>'executorKey', '') is distinct from p_executor_key then
    raise exception 'Work-cell phase claim executor identity does not match the completion request';
  end if;
  if coalesce(v_existing.metadata->>'capabilityKey', '') is distinct from p_capability_key then
    raise exception 'Work-cell phase claim capability identity does not match the completion request';
  end if;
  if v_existing.output_artifact_id is null
     or v_existing.output_artifact_id::text is distinct from p_output_artifact_id then
    raise exception 'Work-cell phase claim output artifact does not match the completion request';
  end if;

  select exists (
    select 1
      from public.evidence_artifacts e
     where e.id = v_existing.output_artifact_id
       and e.id = p_output_artifact_id::uuid
       and e.run_id = p_run_id
       and e.payload->>'schemaVersion' = 'catalog-evidence-packet/v1'
       and e.payload->>'runId' = p_run_id::text
       and e.payload->>'executorKey' = p_executor_key
  ) into v_bound;
  if not v_bound then
    raise exception 'An unbound or unrelated catalog evidence packet cannot complete this work-cell phase claim';
  end if;

  if v_existing.status = 'completed' then
    assignment_id := v_existing.id;
    assignment_status := v_existing.status;
    return next;
    return;
  end if;
  if v_existing.status = 'failed' then
    raise exception 'A failed work-cell phase assignment cannot be completed.';
  end if;
  if v_existing.status <> 'running' or v_existing.output_artifact_id is null then
    raise exception 'Cannot complete a work-cell phase claim that is not running with output evidence';
  end if;

  update public.run_executor_assignments
     set status = 'completed',
         completed_at = coalesce(completed_at, now()),
         metadata = coalesce(metadata, '{}'::jsonb)
           || coalesce(p_metadata_patch, '{}'::jsonb)
   where id = v_existing.id
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

revoke all on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) from public;
revoke execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) from anon;
grant execute on function public.fail_work_cell_phase_claim(uuid, text, text, boolean, integer, text[]) to authenticated, service_role;

revoke all on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text, text, text, text, text, text, text) from public;
revoke execute on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text, text, text, text, text, text, text) from anon;
grant execute on function public.complete_work_cell_phase_claim(uuid, text, jsonb, text, text, text, text, text, text, text) to authenticated, service_role;
