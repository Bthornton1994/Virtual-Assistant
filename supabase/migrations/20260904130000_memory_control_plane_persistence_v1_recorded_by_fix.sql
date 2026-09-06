-- Memory control-plane v1 compatibility patch.
-- Keep recordedBy validation aligned with the operational-memory/v1 provenance
-- contract. The original function checked a non-existent top-level key.

create or replace function public.persist_operational_memory(
  p_memory jsonb,
  p_canonical_body text
)
returns table (
  record_id uuid,
  organization_id uuid,
  memory_id text,
  revision integer,
  memory_hash text
)
language plpgsql
set search_path = public
as $$
declare
  v_org_id uuid;
  v_memory_id text;
  v_revision integer;
  v_kind text;
  v_status text;
  v_subject_key text;
  v_claim text;
  v_scope_kind text;
  v_scope_key text;
  v_sensitivity text;
  v_retention_class text;
  v_source_kind text;
  v_source_refs jsonb;
  v_source_run_id text;
  v_source_assignment_id text;
  v_observed_at timestamptz;
  v_recorded_at timestamptz;
  v_recorded_by text;
  v_approver_id text;
  v_review_after timestamptz;
  v_expires_at timestamptz;
  v_expired_at timestamptz;
  v_invalidated_at timestamptz;
  v_invalidation_reason text;
  v_conflict_set_id text;
  v_supersedes_hash text;
  v_memory_hash text;
  v_body jsonb;
  v_existing public.operational_memory_records%rowtype;
  v_max_revision integer;
  v_record_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory persistence requires the service role';
  end if;
  if p_memory is null or jsonb_typeof(p_memory) <> 'object' then
    raise exception 'Operational memory must be a JSON object';
  end if;
  if p_canonical_body is null or char_length(p_canonical_body) < 2 then
    raise exception 'Operational memory canonical body is required';
  end if;

  begin
    v_body := p_canonical_body::jsonb;
  exception when others then
    raise exception 'Operational memory canonical body is not valid JSON';
  end;

  if v_body is distinct from (p_memory - 'memoryHash') then
    raise exception 'Operational memory canonical body does not match payload';
  end if;

  v_memory_hash := p_memory->>'memoryHash';
  if v_memory_hash is null or v_memory_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Operational memory must carry a lowercase SHA-256 memoryHash';
  end if;
  if encode(extensions.digest(p_canonical_body, 'sha256'), 'hex') <> v_memory_hash then
    raise exception 'Operational memory memoryHash does not match canonical bytes';
  end if;

  if p_memory->>'schemaVersion' is distinct from 'operational-memory/v1' then
    raise exception 'Unsupported operational memory schema version';
  end if;
  if p_memory->>'memoryId' is null
     or char_length(p_memory->>'memoryId') not between 1 and 128
     or p_memory->>'memoryId' <> btrim(p_memory->>'memoryId') then
    raise exception 'Invalid operational memory memoryId';
  end if;
  if p_memory->>'subjectKey' is null
     or char_length(p_memory->>'subjectKey') not between 1 and 128
     or p_memory->>'subjectKey' <> btrim(p_memory->>'subjectKey') then
    raise exception 'Invalid operational memory subjectKey';
  end if;
  if p_memory->>'claim' is null or char_length(p_memory->>'claim') not between 1 and 2000 then
    raise exception 'Invalid operational memory claim';
  end if;
  if p_memory #>> '{provenance,recordedBy}' is null
     or char_length(p_memory #>> '{provenance,recordedBy}') not between 1 and 128
     or p_memory #>> '{provenance,recordedBy}' <> btrim(p_memory #>> '{provenance,recordedBy}') then
    raise exception 'Invalid operational memory recordedBy';
  end if;

  if p_memory #>> '{scope,organizationId}' is null
     or p_memory #>> '{scope,organizationId}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
    raise exception 'Operational memory scope organizationId must be a UUID';
  end if;
  v_org_id := (p_memory #>> '{scope,organizationId}')::uuid;

  v_memory_id := p_memory->>'memoryId';
  v_revision := (p_memory->>'revision')::integer;
  v_kind := p_memory->>'kind';
  v_status := p_memory->>'status';
  v_subject_key := p_memory->>'subjectKey';
  v_claim := p_memory->>'claim';
  v_scope_kind := p_memory #>> '{scope,scopeKind}';
  v_scope_key := p_memory #>> '{scope,scopeKey}';
  v_sensitivity := p_memory->>'sensitivity';
  v_retention_class := p_memory->>'retentionClass';
  v_source_kind := p_memory #>> '{provenance,sourceKind}';
  v_source_refs := p_memory #> '{provenance,sourceArtifactRefs}';
  v_source_run_id := nullif(p_memory #>> '{provenance,sourceRunId}', '');
  v_source_assignment_id := nullif(p_memory #>> '{provenance,sourceAssignmentId}', '');
  v_observed_at := (p_memory #>> '{provenance,observedAt}')::timestamptz;
  v_recorded_at := (p_memory #>> '{provenance,recordedAt}')::timestamptz;
  v_recorded_by := p_memory #>> '{provenance,recordedBy}';
  v_approver_id := nullif(p_memory #>> '{provenance,approverId}', '');
  v_review_after := nullif(p_memory->>'reviewAfter', '')::timestamptz;
  v_expires_at := nullif(p_memory->>'expiresAt', '')::timestamptz;
  v_expired_at := nullif(p_memory->>'expiredAt', '')::timestamptz;
  v_invalidated_at := nullif(p_memory->>'invalidatedAt', '')::timestamptz;
  v_invalidation_reason := nullif(p_memory->>'invalidationReason', '');
  v_conflict_set_id := nullif(p_memory->>'conflictSetId', '');
  v_supersedes_hash := nullif(p_memory->>'supersedesHash', '');

  if v_org_id is distinct from (p_memory #>> '{scope,organizationId}')::uuid then
    raise exception 'Operational memory organization could not be normalized';
  end if;
  if v_kind not in ('working', 'operational', 'entity', 'procedural', 'preference', 'historical')
     or v_status not in ('candidate', 'verified', 'conflicted', 'expired', 'invalidated', 'archived')
     or v_scope_kind not in ('run', 'assignment', 'organization', 'entity', 'workstream', 'global')
     or v_sensitivity not in ('public', 'internal', 'confidential', 'restricted')
     or v_retention_class not in ('run', 'short', 'standard', 'long', 'indefinite')
     or v_source_kind not in ('executor_output', 'human_decision', 'deterministic_validation', 'historical_run', 'system_import') then
    raise exception 'Operational memory enum field is invalid';
  end if;
  if v_revision is null or v_revision < 1 or v_revision > 1000000 then
    raise exception 'Operational memory revision is invalid';
  end if;
  if v_scope_key is null or char_length(v_scope_key) not between 1 and 128 or v_scope_key <> btrim(v_scope_key) then
    raise exception 'Operational memory scopeKey is invalid';
  end if;
  if v_source_refs is null or jsonb_typeof(v_source_refs) <> 'array' or jsonb_array_length(v_source_refs) < 1 then
    raise exception 'Operational memory requires source artifact references';
  end if;
  if v_recorded_at < v_observed_at then
    raise exception 'Operational memory recordedAt must not precede observedAt';
  end if;
  if v_status = 'verified' and v_approver_id is null then
    raise exception 'Verified operational memory requires an approver';
  end if;
  if v_status = 'candidate' and v_approver_id is not null then
    raise exception 'Candidate operational memory cannot carry an approver';
  end if;
  if v_status = 'conflicted' and v_conflict_set_id is null then
    raise exception 'Conflicted operational memory requires a conflict set';
  end if;
  if v_status <> 'conflicted' and v_conflict_set_id is not null then
    raise exception 'Only conflicted operational memory may carry a conflict set';
  end if;
  if v_status = 'invalidated'
     and (v_invalidated_at is null or v_invalidation_reason is null) then
    raise exception 'Invalidated operational memory requires invalidation metadata';
  end if;
  if v_status <> 'invalidated'
     and (v_invalidated_at is not null or v_invalidation_reason is not null) then
    raise exception 'Only invalidated operational memory may carry invalidation metadata';
  end if;
  if v_status = 'expired' and (v_expires_at is null or v_expired_at is null) then
    raise exception 'Expired operational memory requires expiry metadata';
  end if;
  if v_status <> 'expired' and v_expired_at is not null then
    raise exception 'Only expired operational memory may carry expiredAt';
  end if;
  if v_retention_class = 'indefinite' and v_expires_at is not null then
    raise exception 'Indefinite operational memory cannot have an expiry';
  end if;
  if v_retention_class <> 'indefinite' and v_expires_at is null then
    raise exception 'Non-indefinite operational memory requires an expiry';
  end if;
  if v_review_after is not null and v_review_after < v_recorded_at then
    raise exception 'Operational memory reviewAfter must not precede recordedAt';
  end if;
  if v_expires_at is not null and v_expires_at < v_recorded_at then
    raise exception 'Operational memory expiresAt must not precede recordedAt';
  end if;
  if v_expired_at is not null and v_expires_at is not null and v_expired_at < v_expires_at then
    raise exception 'Operational memory expiredAt must not precede expiresAt';
  end if;
  if v_invalidated_at is not null and v_invalidated_at < v_recorded_at then
    raise exception 'Operational memory invalidatedAt must not precede recordedAt';
  end if;
  if v_retention_class = 'run' and v_scope_kind not in ('run', 'assignment') then
    raise exception 'Run-retained operational memory must be run or assignment scoped';
  end if;
  if v_kind = 'working' and v_scope_kind not in ('run', 'assignment') then
    raise exception 'Working operational memory must be run or assignment scoped';
  end if;
  if v_revision = 1 and v_supersedes_hash is not null then
    raise exception 'Revision 1 cannot supersede another memory';
  end if;
  if v_revision > 1 and v_supersedes_hash is null then
    raise exception 'Memory revisions after 1 require supersedesHash';
  end if;
  if v_supersedes_hash = v_memory_hash then
    raise exception 'A memory revision cannot supersede itself';
  end if;

  if v_scope_kind = 'organization' and v_scope_key <> v_org_id::text then
    raise exception 'Organization-scoped memory must use its organization UUID as scopeKey';
  end if;
  if v_scope_kind in ('run', 'assignment', 'workstream') then
    if v_scope_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'Run, assignment, and workstream memory scopes must use UUID scope keys';
    end if;
  end if;
  if v_scope_kind = 'run' and not exists (
    select 1 from public.workstream_runs wr
    where wr.id = v_scope_key::uuid and wr.organization_id = v_org_id
  ) then
    raise exception 'Run-scoped memory must reference a run in the same organization';
  end if;
  if v_scope_kind = 'assignment' and not exists (
    select 1 from public.run_executor_assignments rea
    where rea.id = v_scope_key::uuid and rea.organization_id = v_org_id
  ) then
    raise exception 'Assignment-scoped memory must reference an assignment in the same organization';
  end if;
  if v_scope_kind = 'workstream' and not exists (
    select 1 from public.workstreams ws
    where ws.id = v_scope_key::uuid and ws.organization_id = v_org_id
  ) then
    raise exception 'Workstream-scoped memory must reference a workstream in the same organization';
  end if;

  if v_source_run_id is not null then
    if v_source_run_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'sourceRunId must be a UUID at the persistence boundary';
    end if;
    if not exists (
      select 1 from public.workstream_runs wr
      where wr.id = v_source_run_id::uuid and wr.organization_id = v_org_id
    ) then
      raise exception 'sourceRunId must reference a run in the same organization';
    end if;
  end if;
  if v_source_assignment_id is not null then
    if v_source_assignment_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'sourceAssignmentId must be a UUID at the persistence boundary';
    end if;
    if not exists (
      select 1 from public.run_executor_assignments rea
      where rea.id = v_source_assignment_id::uuid and rea.organization_id = v_org_id
    ) then
      raise exception 'sourceAssignmentId must reference an assignment in the same organization';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_source_refs) ref
    where ref->>'artifactId' is null
      or ref->>'artifactId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      or ref->>'schemaVersion' is null
      or char_length(ref->>'schemaVersion') = 0
      or ref->>'contentHash' is null
      or ref->>'contentHash' !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Every source artifact reference must carry a UUID, schemaVersion, and SHA-256 contentHash';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_source_refs) ref
    where not exists (
      select 1
      from public.evidence_artifacts ea
      where ea.id = (ref->>'artifactId')::uuid
        and ea.organization_id = v_org_id
        and ea.content_hash = ref->>'contentHash'
        and ea.payload->>'schemaVersion' = ref->>'schemaVersion'
    )
  ) then
    raise exception 'Every source artifact reference must resolve to the same-tenant immutable evidence artifact';
  end if;
  if (
    select count(*) from jsonb_array_elements(v_source_refs) ref
    where (ref->>'artifactId')::uuid is not null
  ) <> (
    select count(distinct ref->>'artifactId') from jsonb_array_elements(v_source_refs) ref
  ) then
    raise exception 'Operational memory source artifact references must be unique';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':' || v_memory_id, 0));

  if exists (
    select 1
    from public.operational_memory_erasures e
    where e.organization_id = v_org_id
      and e.memory_id_hash = encode(extensions.digest(v_memory_id, 'sha256'), 'hex')
  ) then
    raise exception 'Operational memory ID was erased and cannot be reused';
  end if;

  select * into v_existing
  from public.operational_memory_records r
  where r.organization_id = v_org_id and r.memory_hash = v_memory_hash
  limit 1;
  if found then
    if v_existing.canonical_body is distinct from p_canonical_body then
      raise exception 'Memory hash already exists with different canonical bytes';
    end if;
    return query select v_existing.id, v_existing.organization_id,
      v_existing.memory_id, v_existing.revision, v_existing.memory_hash;
    return;
  end if;

  select max(r.revision) into v_max_revision
  from public.operational_memory_records r
  where r.organization_id = v_org_id and r.memory_id = v_memory_id;
  if v_max_revision is null and v_revision <> 1 then
    raise exception 'First memory revision must be 1';
  end if;
  if v_max_revision is not null and v_revision <> v_max_revision + 1 then
    raise exception 'Memory revision must be the next append-only revision';
  end if;
  if v_revision > 1 and not exists (
    select 1 from public.operational_memory_records r
    where r.organization_id = v_org_id
      and r.memory_id = v_memory_id
      and r.revision = v_revision - 1
      and r.memory_hash = v_supersedes_hash
  ) then
    raise exception 'Memory revision must supersede the immediately previous hash';
  end if;

  perform set_config('app.memory_write_authorized', 'true', true);
  insert into public.operational_memory_records (
    organization_id, memory_id, revision, kind, status, subject_key, claim, value,
    scope_kind, scope_key, sensitivity, retention_class, source_kind,
    source_artifact_refs, source_run_id, source_assignment_id, observed_at,
    recorded_at, recorded_by, approver_id, review_after, expires_at, expired_at,
    invalidated_at, invalidation_reason, conflict_set_id, supersedes_hash,
    memory_hash, memory_payload, canonical_body
  ) values (
    v_org_id, v_memory_id, v_revision, v_kind, v_status, v_subject_key, v_claim,
    p_memory->'value', v_scope_kind, v_scope_key, v_sensitivity, v_retention_class,
    v_source_kind, v_source_refs, v_source_run_id, v_source_assignment_id,
    v_observed_at, v_recorded_at, v_recorded_by, v_approver_id, v_review_after,
    v_expires_at, v_expired_at, v_invalidated_at, v_invalidation_reason,
    v_conflict_set_id, v_supersedes_hash, v_memory_hash, p_memory, p_canonical_body
  )
  returning id into v_record_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    v_org_id,
    case when v_recorded_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then v_recorded_by::uuid else null end,
    'memory.updated', 'operational_memory',
    encode(extensions.digest(v_memory_id, 'sha256'), 'hex'),
    jsonb_build_object(
      'memoryIdHash', encode(extensions.digest(v_memory_id, 'sha256'), 'hex'),
      'memoryHash', v_memory_hash,
      'revision', v_revision,
      'status', v_status,
      'recordedBy', v_recorded_by
    )
  );

  return query select v_record_id, v_org_id, v_memory_id, v_revision, v_memory_hash;
end;
$$;

revoke all on function public.persist_operational_memory(jsonb, text) from public, anon, authenticated;
grant execute on function public.persist_operational_memory(jsonb, text) to service_role;
