-- Delegation Cloud Operational Memory Control Plane v1
--
-- This migration turns the pure memory contracts into a server-only persistence
-- boundary. Durable memory is append-only, scoped to one organization, bound to
-- existing evidence artifacts at write time, and read as the latest revision
-- only. Candidates may be persisted for shadow evaluation; only the existing
-- deterministic compiler may place verified memory into production context.
--
-- The application sends both the full JSON value and its canonical body. The
-- database checks the canonical bytes and recomputes memoryHash, so the service
-- role cannot accidentally persist a different object under a caller-supplied
-- digest. The app still owns the richer Zod contract; these SQL checks are the
-- last-resort database boundary.

create table public.operational_memory_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  memory_id text not null check (
    char_length(memory_id) between 1 and 128
    and memory_id = btrim(memory_id)
  ),
  revision integer not null check (revision > 0 and revision <= 1000000),
  kind text not null check (kind in ('working', 'operational', 'entity', 'procedural', 'preference', 'historical')),
  status text not null check (status in ('candidate', 'verified', 'conflicted', 'expired', 'invalidated', 'archived')),
  subject_key text not null check (char_length(subject_key) between 1 and 128 and subject_key = btrim(subject_key)),
  claim text not null check (char_length(claim) between 1 and 2000),
  value jsonb not null,
  scope_kind text not null check (scope_kind in ('run', 'assignment', 'organization', 'entity', 'workstream', 'global')),
  scope_key text not null check (char_length(scope_key) between 1 and 128 and scope_key = btrim(scope_key)),
  sensitivity text not null check (sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  retention_class text not null check (retention_class in ('run', 'short', 'standard', 'long', 'indefinite')),
  source_kind text not null check (source_kind in ('executor_output', 'human_decision', 'deterministic_validation', 'historical_run', 'system_import')),
  source_artifact_refs jsonb not null check (jsonb_typeof(source_artifact_refs) = 'array'),
  source_run_id text,
  source_assignment_id text,
  observed_at timestamptz not null,
  recorded_at timestamptz not null,
  recorded_by text not null check (char_length(recorded_by) between 1 and 128 and recorded_by = btrim(recorded_by)),
  approver_id text,
  review_after timestamptz,
  expires_at timestamptz,
  expired_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  conflict_set_id text,
  supersedes_hash text check (supersedes_hash is null or supersedes_hash ~ '^[0-9a-f]{64}$'),
  memory_hash text not null check (memory_hash ~ '^[0-9a-f]{64}$'),
  memory_payload jsonb not null check (
    jsonb_typeof(memory_payload) = 'object'
    and memory_payload->>'schemaVersion' = 'operational-memory/v1'
    and memory_payload->>'memoryHash' = memory_hash
  ),
  canonical_body text not null check (char_length(canonical_body) between 2 and 200000),
  created_at timestamptz not null default now(),
  unique (organization_id, memory_id, revision),
  unique (organization_id, memory_hash),
  unique (id, organization_id),
  check (
    (status <> 'verified' or approver_id is not null)
    and (status <> 'candidate' or approver_id is null)
    and (status <> 'conflicted' or conflict_set_id is not null)
    and (status = 'conflicted' or conflict_set_id is null)
    and (status <> 'expired' or (expires_at is not null and expired_at is not null))
    and (status <> 'invalidated' or (invalidated_at is not null and invalidation_reason is not null))
    and (status = 'invalidated' or (invalidated_at is null and invalidation_reason is null))
    and (status = 'expired' or expired_at is null)
    and (retention_class = 'indefinite' or expires_at is not null)
    and (retention_class = 'indefinite' or expires_at >= recorded_at)
    and (review_after is null or review_after >= recorded_at)
    and (expires_at is null or expires_at >= recorded_at)
    and (expired_at is null or expires_at is not null and expired_at >= expires_at)
    and (invalidated_at is null or invalidated_at >= recorded_at)
    and (recorded_at >= observed_at)
    and (revision = 1 or supersedes_hash is not null)
    and (revision = 1 or supersedes_hash <> memory_hash)
    and (retention_class <> 'run' or scope_kind in ('run', 'assignment'))
    and (kind <> 'working' or scope_kind in ('run', 'assignment'))
  )
);

create index operational_memory_records_scope_idx
  on public.operational_memory_records (organization_id, scope_kind, scope_key, status, revision desc);
create index operational_memory_records_subject_idx
  on public.operational_memory_records (organization_id, subject_key, kind, revision desc);
create index operational_memory_records_expiry_idx
  on public.operational_memory_records (organization_id, expires_at)
  where expires_at is not null;

create table public.operational_memory_erasures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  memory_id_hash text not null check (memory_id_hash ~ '^[0-9a-f]{64}$'),
  erased_revision_count integer not null check (erased_revision_count > 0),
  source_artifact_ref_count integer not null check (source_artifact_ref_count >= 0),
  reason text not null check (char_length(reason) between 1 and 2000),
  requested_by text not null check (char_length(requested_by) between 1 and 128 and requested_by = btrim(requested_by)),
  erased_at timestamptz not null default now(),
  unique (organization_id, memory_id_hash)
);

create index operational_memory_erasures_org_idx
  on public.operational_memory_erasures (organization_id, erased_at desc);

-- These tables are intentionally not browser-readable. User-facing memory
-- review routes must authorize the actor in server code and use the functions
-- below, rather than widening the public table surface.
alter table public.operational_memory_records enable row level security;
alter table public.operational_memory_erasures enable row level security;
revoke all on public.operational_memory_records, public.operational_memory_erasures from public, anon, authenticated;
grant select, insert, delete on public.operational_memory_records to service_role;
grant select, insert on public.operational_memory_erasures to service_role;

create or replace function public.enforce_operational_memory_record_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user <> 'service_role'
       or coalesce(current_setting('app.memory_write_authorized', true), '') <> 'true' then
      raise exception 'Operational memory records may only be inserted by the persistence RPC';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'Operational memory records are append-only; persist a new revision';
  end if;

  if current_user <> 'service_role'
     or coalesce(current_setting('app.memory_erasure_authorized', true), '') <> 'true' then
    raise exception 'Operational memory records may only be erased by the erasure RPC';
  end if;
  return old;
end;
$$;

create trigger trg_operational_memory_record_invariants
  before insert or update or delete on public.operational_memory_records
  for each row execute function public.enforce_operational_memory_record_invariants();

create or replace function public.enforce_operational_memory_erasure_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Operational memory erasure records are append-only';
  end if;
  if current_user <> 'service_role'
     or coalesce(current_setting('app.memory_erasure_authorized', true), '') <> 'true' then
    raise exception 'Operational memory erasures may only be written by the erasure RPC';
  end if;
  return new;
end;
$$;

create trigger trg_operational_memory_erasure_invariants
  before insert or update or delete on public.operational_memory_erasures
  for each row execute function public.enforce_operational_memory_erasure_invariants();

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
  if p_memory->>'recordedBy' is null
     or char_length(p_memory->>'recordedBy') not between 1 and 128
     or p_memory->>'recordedBy' <> btrim(p_memory->>'recordedBy') then
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
    select 1 from public.workstream_runs
    where id = v_scope_key::uuid and organization_id = v_org_id
  ) then
    raise exception 'Run-scoped memory must reference a run in the same organization';
  end if;
  if v_scope_kind = 'assignment' and not exists (
    select 1 from public.run_executor_assignments
    where id = v_scope_key::uuid and organization_id = v_org_id
  ) then
    raise exception 'Assignment-scoped memory must reference an assignment in the same organization';
  end if;
  if v_scope_kind = 'workstream' and not exists (
    select 1 from public.workstreams
    where id = v_scope_key::uuid and organization_id = v_org_id
  ) then
    raise exception 'Workstream-scoped memory must reference a workstream in the same organization';
  end if;

  if v_source_run_id is not null then
    if v_source_run_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'sourceRunId must be a UUID at the persistence boundary';
    end if;
    if not exists (
      select 1 from public.workstream_runs
      where id = v_source_run_id::uuid and organization_id = v_org_id
    ) then
      raise exception 'sourceRunId must reference a run in the same organization';
    end if;
  end if;
  if v_source_assignment_id is not null then
    if v_source_assignment_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      raise exception 'sourceAssignmentId must be a UUID at the persistence boundary';
    end if;
    if not exists (
      select 1 from public.run_executor_assignments
      where id = v_source_assignment_id::uuid and organization_id = v_org_id
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

  select * into v_existing
  from public.operational_memory_records
  where organization_id = v_org_id and memory_hash = v_memory_hash
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
    select 1 from public.operational_memory_records
    where organization_id = v_org_id
      and memory_id = v_memory_id
      and revision = v_revision - 1
      and memory_hash = v_supersedes_hash
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
    case when v_recorded_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
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

create or replace function public.read_operational_memories(
  p_organization_id uuid,
  p_limit integer default 5000
)
returns table (memory_payload jsonb)
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory reads require the service role';
  end if;
  if p_organization_id is null then raise exception 'Organization ID is required'; end if;
  if p_limit < 1 or p_limit > 10000 then raise exception 'Memory read limit must be between 1 and 10000'; end if;

  return query
  select latest.memory_payload
  from (
    select r.memory_payload,
           row_number() over (partition by r.memory_id order by r.revision desc) as revision_rank
    from public.operational_memory_records r
    where r.organization_id = p_organization_id
      and not exists (
        select 1 from public.operational_memory_erasures e
        where e.organization_id = r.organization_id
          and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
      )
  ) latest
  where latest.revision_rank = 1
  order by latest.memory_payload->>'memoryId'
  limit p_limit;
end;
$$;

revoke all on function public.read_operational_memories(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_operational_memories(uuid, integer) to service_role;

create or replace function public.erase_operational_memory(
  p_organization_id uuid,
  p_memory_id text,
  p_reason text,
  p_requested_by text
)
returns table (erasure_id uuid, erased_revision_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_memory_id_hash text;
  v_revision_count integer;
  v_artifact_count integer;
  v_erasure_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory erasure requires the service role';
  end if;
  if p_organization_id is null then raise exception 'Organization ID is required'; end if;
  if p_memory_id is null
     or char_length(p_memory_id) not between 1 and 128
     or p_memory_id <> btrim(p_memory_id) then
    raise exception 'Invalid memory ID';
  end if;
  if p_reason is null or char_length(p_reason) not between 1 and 2000 then
    raise exception 'A bounded erasure reason is required';
  end if;
  if p_requested_by is null
     or char_length(p_requested_by) not between 1 and 128
     or p_requested_by <> btrim(p_requested_by) then
    raise exception 'A bounded erasure requester is required';
  end if;

  v_memory_id_hash := encode(extensions.digest(p_memory_id, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_memory_id, 0));

  select count(*)::integer,
         coalesce(sum(jsonb_array_length(source_artifact_refs)), 0)::integer
    into v_revision_count, v_artifact_count
  from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  if v_revision_count = 0 then
    select e.id into v_erasure_id
    from public.operational_memory_erasures e
    where e.organization_id = p_organization_id and e.memory_id_hash = v_memory_id_hash;
    if v_erasure_id is null then
      raise exception 'Operational memory was not found';
    end if;
    return query select v_erasure_id, 0;
    return;
  end if;

  perform set_config('app.memory_erasure_authorized', 'true', true);
  insert into public.operational_memory_erasures (
    organization_id, memory_id_hash, erased_revision_count,
    source_artifact_ref_count, reason, requested_by
  ) values (
    p_organization_id, v_memory_id_hash, v_revision_count,
    v_artifact_count, p_reason, p_requested_by
  )
  returning id into v_erasure_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    case when p_requested_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
    jsonb_build_object(
      'memoryIdHash', v_memory_id_hash,
      'erasureId', v_erasure_id,
      'erasedRevisionCount', v_revision_count,
      'sourceArtifactRefCount', v_artifact_count
    )
  );

  delete from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  return query select v_erasure_id, v_revision_count;
end;
$$;

revoke all on function public.erase_operational_memory(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.erase_operational_memory(uuid, text, text, text) to service_role;

-- A runtime claim carries the exact memory hashes that were used to build its
-- context. This is deliberately written by a wrapper around the existing
-- claim RPC so the claim, binding, and event commit atomically or roll back
-- together. No worker can begin from a half-bound attempt.
-- The base runtime migration predates this event and has a closed event-type
-- check, so widen it before the wrapper can emit the binding receipt.
alter table public.execution_events
  drop constraint if exists execution_events_event_type_check;

alter table public.execution_events
  add constraint execution_events_event_type_check check (event_type in (
    'plan_proposed', 'plan_frozen', 'plan_started', 'plan_blocked',
    'plan_completed', 'plan_failed', 'plan_cancelled', 'stage_ready',
    'stage_blocked', 'attempt_started', 'attempt_heartbeat',
    'attempt_succeeded', 'attempt_failed', 'attempt_expired',
    'retry_scheduled', 'approval_requested', 'approval_approved',
    'approval_rejected', 'stage_cancelled', 'queue_refreshed',
    'memory_context_bound'
  ));

alter table public.execution_attempts
  add column if not exists memory_run_id text,
  add column if not exists memory_assignment_id text,
  add column if not exists memory_execution_context_hash text,
  add column if not exists memory_context_hash text,
  add column if not exists memory_read_receipt_hash text,
  add column if not exists memory_binding_hash text,
  add column if not exists memory_selected_ids jsonb not null default '[]'::jsonb,
  add column if not exists memory_selected_refs jsonb not null default '[]'::jsonb;

alter table public.execution_attempts
  add constraint execution_attempts_memory_hashes_check check (
    (
      memory_run_id is null
      and memory_assignment_id is null
      and memory_execution_context_hash is null
      and memory_context_hash is null
      and memory_read_receipt_hash is null
      and memory_binding_hash is null
      and memory_selected_ids = '[]'::jsonb
      and memory_selected_refs = '[]'::jsonb
    )
    or (
      memory_run_id is not null
      and memory_assignment_id is not null
      and memory_execution_context_hash is not null
      and memory_context_hash is not null
      and memory_read_receipt_hash is not null
      and memory_binding_hash is not null
      and jsonb_typeof(memory_selected_ids) = 'array'
      and jsonb_typeof(memory_selected_refs) = 'array'
      and case
        when jsonb_typeof(memory_selected_ids) = 'array'
          then jsonb_array_length(memory_selected_ids) <= 100
        else false
      end
      and case
        when jsonb_typeof(memory_selected_refs) = 'array'
          then jsonb_array_length(memory_selected_refs) <= 100
        else false
      end
    )
  ),
  add constraint execution_attempts_memory_hash_format_check check (
    (memory_execution_context_hash is null or memory_execution_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_context_hash is null or memory_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_read_receipt_hash is null or memory_read_receipt_hash ~ '^[0-9a-f]{64}$')
    and (memory_binding_hash is null or memory_binding_hash ~ '^[0-9a-f]{64}$')
  );

create index execution_attempts_memory_binding_idx
  on public.execution_attempts (organization_id, memory_binding_hash)
  where memory_binding_hash is not null;

create or replace function public.enforce_execution_attempt_memory_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.memory_binding_hash is not null
     and (
       current_user <> 'service_role'
       or coalesce(current_setting('app.execution_memory_binding_authorized', true), '') <> 'true'
     ) then
    raise exception 'Execution memory binding may only be attached by the claim RPC';
  end if;

  if tg_op = 'UPDATE'
     and row(
       new.memory_run_id, new.memory_assignment_id,
       new.memory_execution_context_hash, new.memory_context_hash,
       new.memory_read_receipt_hash, new.memory_binding_hash,
       new.memory_selected_ids, new.memory_selected_refs
     ) is distinct from row(
       old.memory_run_id, old.memory_assignment_id,
       old.memory_execution_context_hash, old.memory_context_hash,
       old.memory_read_receipt_hash, old.memory_binding_hash,
       old.memory_selected_ids, old.memory_selected_refs
     ) then
    if old.memory_binding_hash is not null then
      raise exception 'Execution memory binding is immutable after attachment';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_execution_attempt_memory_binding
  before insert or update on public.execution_attempts
  for each row execute function public.enforce_execution_attempt_memory_binding();

create or replace function public.claim_execution_step_with_memory(
  p_worker_id text,
  p_capability_key text,
  p_lease_token_hash text,
  p_memory_run_id text,
  p_memory_assignment_id text,
  p_memory_execution_context_hash text,
  p_memory_context_hash text,
  p_memory_read_receipt_hash text,
  p_memory_binding_hash text,
  p_memory_selected_refs jsonb,
  p_lease_seconds integer default 300
)
returns table (
  attempt_id uuid,
  plan_id uuid,
  step_id uuid,
  run_id uuid,
  step_key text,
  capability_key text,
  action_class text,
  executor_context jsonb,
  lease_expires_at timestamptz,
  attempt_number integer,
  memory_run_id text,
  memory_assignment_id text,
  memory_execution_context_hash text,
  memory_context_hash text,
  memory_read_receipt_hash text,
  memory_binding_hash text,
  memory_selected_ids jsonb,
  memory_selected_refs jsonb
)
language plpgsql
set search_path = public
as $$
declare
  v_claim record;
  v_organization_id uuid;
  v_memory_selected_ids jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'Execution runtime mutations require the service role';
  end if;
  if p_memory_run_id is null or char_length(p_memory_run_id) not between 1 and 128 then
    raise exception 'Memory binding runId is required';
  end if;
  if p_memory_assignment_id is null or char_length(p_memory_assignment_id) not between 1 and 128 then
    raise exception 'Memory binding assignmentId is required';
  end if;
  if p_memory_execution_context_hash is null or p_memory_execution_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_context_hash is null or p_memory_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_read_receipt_hash is null or p_memory_read_receipt_hash !~ '^[0-9a-f]{64}$'
     or p_memory_binding_hash is null or p_memory_binding_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Memory binding hashes must be lowercase SHA-256 values';
  end if;
  if p_memory_selected_refs is null or jsonb_typeof(p_memory_selected_refs) <> 'array' then
    raise exception 'Memory binding selectedMemoryRefs must be an array';
  end if;
  if jsonb_array_length(p_memory_selected_refs) > 100 then
    raise exception 'Memory binding selectedMemoryRefs exceeds the limit';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where jsonb_typeof(selected.ref) <> 'object'
       or selected.ref->>'memoryId' is null
       or char_length(selected.ref->>'memoryId') not between 1 and 128
       or selected.ref->>'memoryId' <> btrim(selected.ref->>'memoryId')
       or selected.ref->>'revision' is null
       or selected.ref->>'revision' !~ '^[0-9]+$'
       or (selected.ref->>'revision')::integer < 1
       or selected.ref->>'memoryHash' is null
       or selected.ref->>'memoryHash' !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Memory binding selectedMemoryRefs contains an invalid memoryId, revision, or memoryHash';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_memory_selected_refs)
  ) <> (
    select count(distinct selected.ref->>'memoryId')
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
  ) then
    raise exception 'Memory binding selectedMemoryRefs must be unique';
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(selected.ref->>'memoryId') order by selected.ordinality),
    '[]'::jsonb
  )
  into v_memory_selected_ids
  from jsonb_array_elements(p_memory_selected_refs) with ordinality selected(ref, ordinality);

  select claim.*
    into v_claim
  from public.claim_execution_step(
    p_worker_id,
    p_capability_key,
    p_lease_token_hash,
    p_lease_seconds
  ) claim;
  if not found then
    return;
  end if;

  select organization_id into v_organization_id
  from public.execution_attempts
  where id = v_claim.attempt_id;

  if p_memory_run_id <> v_claim.run_id::text then
    raise exception 'Memory binding runId does not match the claimed Workstream Run';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where not exists (
      select 1
      from public.operational_memory_records r
      where r.organization_id = v_organization_id
        and r.memory_id = selected.ref->>'memoryId'
        and r.revision = (selected.ref->>'revision')::integer
        and r.memory_hash = selected.ref->>'memoryHash'
        and r.status = 'verified'
        and (r.expires_at is null or r.expires_at > now())
        and (r.review_after is null or r.review_after > now())
        and not exists (
          select 1 from public.operational_memory_erasures e
          where e.organization_id = r.organization_id
            and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
        )
        and not exists (
          select 1
          from public.operational_memory_records newer
          where newer.organization_id = r.organization_id
            and newer.memory_id = r.memory_id
            and newer.revision > r.revision
        )
    )
  ) then
    raise exception 'Every selected memory reference must resolve to the latest verified, non-erased revision in the same organization';
  end if;

  perform set_config('app.execution_memory_binding_authorized', 'true', true);
  update public.execution_attempts
     set memory_run_id = p_memory_run_id,
         memory_assignment_id = p_memory_assignment_id,
         memory_execution_context_hash = p_memory_execution_context_hash,
         memory_context_hash = p_memory_context_hash,
         memory_read_receipt_hash = p_memory_read_receipt_hash,
         memory_binding_hash = p_memory_binding_hash,
         memory_selected_ids = v_memory_selected_ids,
         memory_selected_refs = p_memory_selected_refs
   where id = v_claim.attempt_id
     and status = 'running'
     and worker_id = p_worker_id
     and lease_token_hash = p_lease_token_hash;
  if not found then
    raise exception 'Claimed execution attempt disappeared before memory binding';
  end if;

  insert into public.execution_events (
    organization_id, plan_id, step_id, attempt_id, event_type,
    actor_kind, actor_ref, payload
  ) values (
    v_organization_id, v_claim.plan_id, v_claim.step_id, v_claim.attempt_id,
    'memory_context_bound', 'worker', p_worker_id,
    jsonb_build_object(
      'memoryRunId', p_memory_run_id,
      'memoryAssignmentId', p_memory_assignment_id,
      'memoryExecutionContextHash', p_memory_execution_context_hash,
      'memoryContextHash', p_memory_context_hash,
      'memoryReadReceiptHash', p_memory_read_receipt_hash,
      'memoryBindingHash', p_memory_binding_hash,
      'selectedMemoryIds', v_memory_selected_ids,
      'selectedMemoryRefs', p_memory_selected_refs
    )
  );

  return query
  select v_claim.attempt_id, v_claim.plan_id, v_claim.step_id, v_claim.run_id,
    v_claim.step_key, v_claim.capability_key, v_claim.action_class,
    v_claim.executor_context, v_claim.lease_expires_at, v_claim.attempt_number,
    p_memory_run_id, p_memory_assignment_id, p_memory_execution_context_hash,
    p_memory_context_hash, p_memory_read_receipt_hash, p_memory_binding_hash,
    v_memory_selected_ids, p_memory_selected_refs;
end;
$$;

revoke all on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) to service_role;

comment on table public.operational_memory_records is
  'Append-only, server-only revisions for operational-memory/v1. The latest revision is the only effective record.';
comment on table public.operational_memory_erasures is
  'Tombstones for controlled memory erasure. The clear memory identifier and payload are intentionally not retained.';

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

create or replace function public.read_operational_memories(
  p_organization_id uuid,
  p_limit integer default 5000
)
returns table (memory_payload jsonb)
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory reads require the service role';
  end if;
  if p_organization_id is null then raise exception 'Organization ID is required'; end if;
  if p_limit < 1 or p_limit > 10000 then raise exception 'Memory read limit must be between 1 and 10000'; end if;

  return query
  select latest.memory_payload
  from (
    select r.memory_payload,
           row_number() over (partition by r.memory_id order by r.revision desc) as revision_rank
    from public.operational_memory_records r
    where r.organization_id = p_organization_id
      and not exists (
        select 1 from public.operational_memory_erasures e
        where e.organization_id = r.organization_id
          and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
      )
  ) latest
  where latest.revision_rank = 1
  order by latest.memory_payload->>'memoryId'
  limit p_limit;
end;
$$;

revoke all on function public.read_operational_memories(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_operational_memories(uuid, integer) to service_role;

create or replace function public.erase_operational_memory(
  p_organization_id uuid,
  p_memory_id text,
  p_reason text,
  p_requested_by text
)
returns table (erasure_id uuid, erased_revision_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_memory_id_hash text;
  v_revision_count integer;
  v_artifact_count integer;
  v_erasure_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory erasure requires the service role';
  end if;
  if p_organization_id is null then raise exception 'Organization ID is required'; end if;
  if p_memory_id is null
     or char_length(p_memory_id) not between 1 and 128
     or p_memory_id <> btrim(p_memory_id) then
    raise exception 'Invalid memory ID';
  end if;
  if p_reason is null or char_length(p_reason) not between 1 and 2000 then
    raise exception 'A bounded erasure reason is required';
  end if;
  if p_requested_by is null
     or char_length(p_requested_by) not between 1 and 128
     or p_requested_by <> btrim(p_requested_by) then
    raise exception 'A bounded erasure requester is required';
  end if;

  v_memory_id_hash := encode(extensions.digest(p_memory_id, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_memory_id, 0));

  select count(*)::integer,
         coalesce(sum(jsonb_array_length(source_artifact_refs)), 0)::integer
    into v_revision_count, v_artifact_count
  from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  if v_revision_count = 0 then
    select e.id into v_erasure_id
    from public.operational_memory_erasures e
    where e.organization_id = p_organization_id and e.memory_id_hash = v_memory_id_hash;
    if v_erasure_id is null then
      raise exception 'Operational memory was not found';
    end if;
    return query select v_erasure_id, 0;
    return;
  end if;

  perform set_config('app.memory_erasure_authorized', 'true', true);
  insert into public.operational_memory_erasures (
    organization_id, memory_id_hash, erased_revision_count,
    source_artifact_ref_count, reason, requested_by
  ) values (
    p_organization_id, v_memory_id_hash, v_revision_count,
    v_artifact_count, p_reason, p_requested_by
  )
  returning id into v_erasure_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, null, 'memory.updated', 'operational_memory_erasure',
    v_memory_id_hash,
    jsonb_build_object(
      'memoryIdHash', v_memory_id_hash,
      'erasureId', v_erasure_id,
      'erasedRevisionCount', v_revision_count,
      'sourceArtifactRefCount', v_artifact_count
    )
  );

  delete from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  return query select v_erasure_id, v_revision_count;
end;
$$;

revoke all on function public.erase_operational_memory(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.erase_operational_memory(uuid, text, text, text) to service_role;

-- A runtime claim carries the exact memory hashes that were used to build its
-- context. This is deliberately written by a wrapper around the existing
-- claim RPC so the claim, binding, and event commit atomically or roll back
-- together. No worker can begin from a half-bound attempt.
-- The base runtime migration predates this event and has a closed event-type
-- check, so widen it before the wrapper can emit the binding receipt.
alter table public.execution_events
  drop constraint if exists execution_events_event_type_check;

alter table public.execution_events
  add constraint execution_events_event_type_check check (event_type in (
    'plan_proposed', 'plan_frozen', 'plan_started', 'plan_blocked',
    'plan_completed', 'plan_failed', 'plan_cancelled', 'stage_ready',
    'stage_blocked', 'attempt_started', 'attempt_heartbeat',
    'attempt_succeeded', 'attempt_failed', 'attempt_expired',
    'retry_scheduled', 'approval_requested', 'approval_approved',
    'approval_rejected', 'stage_cancelled', 'queue_refreshed',
    'memory_context_bound'
  ));

alter table public.execution_attempts
  add column if not exists memory_run_id text,
  add column if not exists memory_assignment_id text,
  add column if not exists memory_execution_context_hash text,
  add column if not exists memory_context_hash text,
  add column if not exists memory_read_receipt_hash text,
  add column if not exists memory_binding_hash text,
  add column if not exists memory_selected_ids jsonb not null default '[]'::jsonb,
  add column if not exists memory_selected_refs jsonb not null default '[]'::jsonb;

alter table public.execution_attempts
  add constraint execution_attempts_memory_hashes_check check (
    (
      memory_run_id is null
      and memory_assignment_id is null
      and memory_execution_context_hash is null
      and memory_context_hash is null
      and memory_read_receipt_hash is null
      and memory_binding_hash is null
      and memory_selected_ids = '[]'::jsonb
      and memory_selected_refs = '[]'::jsonb
    )
    or (
      memory_run_id is not null
      and memory_assignment_id is not null
      and memory_execution_context_hash is not null
      and memory_context_hash is not null
      and memory_read_receipt_hash is not null
      and memory_binding_hash is not null
      and jsonb_typeof(memory_selected_ids) = 'array'
      and jsonb_typeof(memory_selected_refs) = 'array'
      and case
        when jsonb_typeof(memory_selected_ids) = 'array'
          then jsonb_array_length(memory_selected_ids) <= 100
        else false
      end
      and case
        when jsonb_typeof(memory_selected_refs) = 'array'
          then jsonb_array_length(memory_selected_refs) <= 100
        else false
      end
    )
  ),
  add constraint execution_attempts_memory_hash_format_check check (
    (memory_execution_context_hash is null or memory_execution_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_context_hash is null or memory_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_read_receipt_hash is null or memory_read_receipt_hash ~ '^[0-9a-f]{64}$')
    and (memory_binding_hash is null or memory_binding_hash ~ '^[0-9a-f]{64}$')
  );

create index execution_attempts_memory_binding_idx
  on public.execution_attempts (organization_id, memory_binding_hash)
  where memory_binding_hash is not null;

create or replace function public.enforce_execution_attempt_memory_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.memory_binding_hash is not null
     and (
       current_user <> 'service_role'
       or coalesce(current_setting('app.execution_memory_binding_authorized', true), '') <> 'true'
     ) then
    raise exception 'Execution memory binding may only be attached by the claim RPC';
  end if;

  if tg_op = 'UPDATE'
     and row(
       new.memory_run_id, new.memory_assignment_id,
       new.memory_execution_context_hash, new.memory_context_hash,
       new.memory_read_receipt_hash, new.memory_binding_hash,
       new.memory_selected_ids, new.memory_selected_refs
     ) is distinct from row(
       old.memory_run_id, old.memory_assignment_id,
       old.memory_execution_context_hash, old.memory_context_hash,
       old.memory_read_receipt_hash, old.memory_binding_hash,
       old.memory_selected_ids, old.memory_selected_refs
     ) then
    if old.memory_binding_hash is not null then
      raise exception 'Execution memory binding is immutable after attachment';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_execution_attempt_memory_binding
  before insert or update on public.execution_attempts
  for each row execute function public.enforce_execution_attempt_memory_binding();

create or replace function public.claim_execution_step_with_memory(
  p_worker_id text,
  p_capability_key text,
  p_lease_token_hash text,
  p_memory_run_id text,
  p_memory_assignment_id text,
  p_memory_execution_context_hash text,
  p_memory_context_hash text,
  p_memory_read_receipt_hash text,
  p_memory_binding_hash text,
  p_memory_selected_refs jsonb,
  p_lease_seconds integer default 300
)
returns table (
  attempt_id uuid,
  plan_id uuid,
  step_id uuid,
  run_id uuid,
  step_key text,
  capability_key text,
  action_class text,
  executor_context jsonb,
  lease_expires_at timestamptz,
  attempt_number integer,
  memory_run_id text,
  memory_assignment_id text,
  memory_execution_context_hash text,
  memory_context_hash text,
  memory_read_receipt_hash text,
  memory_binding_hash text,
  memory_selected_ids jsonb,
  memory_selected_refs jsonb
)
language plpgsql
set search_path = public
as $$
declare
  v_claim record;
  v_organization_id uuid;
  v_memory_selected_ids jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'Execution runtime mutations require the service role';
  end if;
  if p_memory_run_id is null or char_length(p_memory_run_id) not between 1 and 128 then
    raise exception 'Memory binding runId is required';
  end if;
  if p_memory_assignment_id is null or char_length(p_memory_assignment_id) not between 1 and 128 then
    raise exception 'Memory binding assignmentId is required';
  end if;
  if p_memory_execution_context_hash is null or p_memory_execution_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_context_hash is null or p_memory_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_read_receipt_hash is null or p_memory_read_receipt_hash !~ '^[0-9a-f]{64}$'
     or p_memory_binding_hash is null or p_memory_binding_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Memory binding hashes must be lowercase SHA-256 values';
  end if;
  if p_memory_selected_refs is null or jsonb_typeof(p_memory_selected_refs) <> 'array' then
    raise exception 'Memory binding selectedMemoryRefs must be an array';
  end if;
  if jsonb_array_length(p_memory_selected_refs) > 100 then
    raise exception 'Memory binding selectedMemoryRefs exceeds the limit';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where jsonb_typeof(selected.ref) <> 'object'
       or selected.ref->>'memoryId' is null
       or char_length(selected.ref->>'memoryId') not between 1 and 128
       or selected.ref->>'memoryId' <> btrim(selected.ref->>'memoryId')
       or selected.ref->>'revision' is null
       or selected.ref->>'revision' !~ '^[0-9]+$'
       or (selected.ref->>'revision')::integer < 1
       or selected.ref->>'memoryHash' is null
       or selected.ref->>'memoryHash' !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Memory binding selectedMemoryRefs contains an invalid memoryId, revision, or memoryHash';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_memory_selected_refs)
  ) <> (
    select count(distinct selected.ref->>'memoryId')
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
  ) then
    raise exception 'Memory binding selectedMemoryRefs must be unique';
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(selected.ref->>'memoryId') order by selected.ordinality),
    '[]'::jsonb
  )
  into v_memory_selected_ids
  from jsonb_array_elements(p_memory_selected_refs) with ordinality selected(ref, ordinality);

  select claim.*
    into v_claim
  from public.claim_execution_step(
    p_worker_id,
    p_capability_key,
    p_lease_token_hash,
    p_lease_seconds
  ) claim;
  if not found then
    return;
  end if;

  select organization_id into v_organization_id
  from public.execution_attempts
  where id = v_claim.attempt_id;

  if p_memory_run_id <> v_claim.run_id::text then
    raise exception 'Memory binding runId does not match the claimed Workstream Run';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where not exists (
      select 1
      from public.operational_memory_records r
      where r.organization_id = v_organization_id
        and r.memory_id = selected.ref->>'memoryId'
        and r.revision = (selected.ref->>'revision')::integer
        and r.memory_hash = selected.ref->>'memoryHash'
        and r.status = 'verified'
        and (r.expires_at is null or r.expires_at > now())
        and (r.review_after is null or r.review_after > now())
        and not exists (
          select 1 from public.operational_memory_erasures e
          where e.organization_id = r.organization_id
            and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
        )
        and not exists (
          select 1
          from public.operational_memory_records newer
          where newer.organization_id = r.organization_id
            and newer.memory_id = r.memory_id
            and newer.revision > r.revision
        )
    )
  ) then
    raise exception 'Every selected memory reference must resolve to the latest verified, non-erased revision in the same organization';
  end if;

  perform set_config('app.execution_memory_binding_authorized', 'true', true);
  update public.execution_attempts
     set memory_run_id = p_memory_run_id,
         memory_assignment_id = p_memory_assignment_id,
         memory_execution_context_hash = p_memory_execution_context_hash,
         memory_context_hash = p_memory_context_hash,
         memory_read_receipt_hash = p_memory_read_receipt_hash,
         memory_binding_hash = p_memory_binding_hash,
         memory_selected_ids = v_memory_selected_ids,
         memory_selected_refs = p_memory_selected_refs
   where id = v_claim.attempt_id
     and status = 'running'
     and worker_id = p_worker_id
     and lease_token_hash = p_lease_token_hash;
  if not found then
    raise exception 'Claimed execution attempt disappeared before memory binding';
  end if;

  insert into public.execution_events (
    organization_id, plan_id, step_id, attempt_id, event_type,
    actor_kind, actor_ref, payload
  ) values (
    v_organization_id, v_claim.plan_id, v_claim.step_id, v_claim.attempt_id,
    'memory_context_bound', 'worker', p_worker_id,
    jsonb_build_object(
      'memoryRunId', p_memory_run_id,
      'memoryAssignmentId', p_memory_assignment_id,
      'memoryExecutionContextHash', p_memory_execution_context_hash,
      'memoryContextHash', p_memory_context_hash,
      'memoryReadReceiptHash', p_memory_read_receipt_hash,
      'memoryBindingHash', p_memory_binding_hash,
      'selectedMemoryIds', v_memory_selected_ids,
      'selectedMemoryRefs', p_memory_selected_refs
    )
  );

  return query
  select v_claim.attempt_id, v_claim.plan_id, v_claim.step_id, v_claim.run_id,
    v_claim.step_key, v_claim.capability_key, v_claim.action_class,
    v_claim.executor_context, v_claim.lease_expires_at, v_claim.attempt_number,
    p_memory_run_id, p_memory_assignment_id, p_memory_execution_context_hash,
    p_memory_context_hash, p_memory_read_receipt_hash, p_memory_binding_hash,
    v_memory_selected_ids, p_memory_selected_refs;
end;
$$;

revoke all on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) to service_role;

comment on table public.operational_memory_records is
  'Append-only, server-only revisions for operational-memory/v1. The latest revision is the only effective record.';
comment on table public.operational_memory_erasures is
  'Tombstones for controlled memory erasure. The clear memory identifier and payload are intentionally not retained.';

      then p_requested_by::uuid else null end,
    'memory.updated', 'operational_memory_erasure',
    v_memory_id_hash,
    jsonb_build_object(
      'memoryIdHash', v_memory_id_hash,
      'erasureId', v_erasure_id,
      'erasedRevisionCount', v_revision_count,
      'sourceArtifactRefCount', v_artifact_count
    )
  );

  delete from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  return query select v_erasure_id, v_revision_count;
end;
$$;

revoke all on function public.erase_operational_memory(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.erase_operational_memory(uuid, text, text, text) to service_role;

-- A runtime claim carries the exact memory hashes that were used to build its
-- context. This is deliberately written by a wrapper around the existing
-- claim RPC so the claim, binding, and event commit atomically or roll back
-- together. No worker can begin from a half-bound attempt.
-- The base runtime migration predates this event and has a closed event-type
-- check, so widen it before the wrapper can emit the binding receipt.
alter table public.execution_events
  drop constraint if exists execution_events_event_type_check;

alter table public.execution_events
  add constraint execution_events_event_type_check check (event_type in (
    'plan_proposed', 'plan_frozen', 'plan_started', 'plan_blocked',
    'plan_completed', 'plan_failed', 'plan_cancelled', 'stage_ready',
    'stage_blocked', 'attempt_started', 'attempt_heartbeat',
    'attempt_succeeded', 'attempt_failed', 'attempt_expired',
    'retry_scheduled', 'approval_requested', 'approval_approved',
    'approval_rejected', 'stage_cancelled', 'queue_refreshed',
    'memory_context_bound'
  ));

alter table public.execution_attempts
  add column if not exists memory_run_id text,
  add column if not exists memory_assignment_id text,
  add column if not exists memory_execution_context_hash text,
  add column if not exists memory_context_hash text,
  add column if not exists memory_read_receipt_hash text,
  add column if not exists memory_binding_hash text,
  add column if not exists memory_selected_ids jsonb not null default '[]'::jsonb,
  add column if not exists memory_selected_refs jsonb not null default '[]'::jsonb;

alter table public.execution_attempts
  add constraint execution_attempts_memory_hashes_check check (
    (
      memory_run_id is null
      and memory_assignment_id is null
      and memory_execution_context_hash is null
      and memory_context_hash is null
      and memory_read_receipt_hash is null
      and memory_binding_hash is null
      and memory_selected_ids = '[]'::jsonb
      and memory_selected_refs = '[]'::jsonb
    )
    or (
      memory_run_id is not null
      and memory_assignment_id is not null
      and memory_execution_context_hash is not null
      and memory_context_hash is not null
      and memory_read_receipt_hash is not null
      and memory_binding_hash is not null
      and jsonb_typeof(memory_selected_ids) = 'array'
      and jsonb_typeof(memory_selected_refs) = 'array'
      and case
        when jsonb_typeof(memory_selected_ids) = 'array'
          then jsonb_array_length(memory_selected_ids) <= 100
        else false
      end
      and case
        when jsonb_typeof(memory_selected_refs) = 'array'
          then jsonb_array_length(memory_selected_refs) <= 100
        else false
      end
    )
  ),
  add constraint execution_attempts_memory_hash_format_check check (
    (memory_execution_context_hash is null or memory_execution_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_context_hash is null or memory_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_read_receipt_hash is null or memory_read_receipt_hash ~ '^[0-9a-f]{64}$')
    and (memory_binding_hash is null or memory_binding_hash ~ '^[0-9a-f]{64}$')
  );

create index execution_attempts_memory_binding_idx
  on public.execution_attempts (organization_id, memory_binding_hash)
  where memory_binding_hash is not null;

create or replace function public.enforce_execution_attempt_memory_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.memory_binding_hash is not null
     and (
       current_user <> 'service_role'
       or coalesce(current_setting('app.execution_memory_binding_authorized', true), '') <> 'true'
     ) then
    raise exception 'Execution memory binding may only be attached by the claim RPC';
  end if;

  if tg_op = 'UPDATE'
     and row(
       new.memory_run_id, new.memory_assignment_id,
       new.memory_execution_context_hash, new.memory_context_hash,
       new.memory_read_receipt_hash, new.memory_binding_hash,
       new.memory_selected_ids, new.memory_selected_refs
     ) is distinct from row(
       old.memory_run_id, old.memory_assignment_id,
       old.memory_execution_context_hash, old.memory_context_hash,
       old.memory_read_receipt_hash, old.memory_binding_hash,
       old.memory_selected_ids, old.memory_selected_refs
     ) then
    if old.memory_binding_hash is not null then
      raise exception 'Execution memory binding is immutable after attachment';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_execution_attempt_memory_binding
  before insert or update on public.execution_attempts
  for each row execute function public.enforce_execution_attempt_memory_binding();

create or replace function public.claim_execution_step_with_memory(
  p_worker_id text,
  p_capability_key text,
  p_lease_token_hash text,
  p_memory_run_id text,
  p_memory_assignment_id text,
  p_memory_execution_context_hash text,
  p_memory_context_hash text,
  p_memory_read_receipt_hash text,
  p_memory_binding_hash text,
  p_memory_selected_refs jsonb,
  p_lease_seconds integer default 300
)
returns table (
  attempt_id uuid,
  plan_id uuid,
  step_id uuid,
  run_id uuid,
  step_key text,
  capability_key text,
  action_class text,
  executor_context jsonb,
  lease_expires_at timestamptz,
  attempt_number integer,
  memory_run_id text,
  memory_assignment_id text,
  memory_execution_context_hash text,
  memory_context_hash text,
  memory_read_receipt_hash text,
  memory_binding_hash text,
  memory_selected_ids jsonb,
  memory_selected_refs jsonb
)
language plpgsql
set search_path = public
as $$
declare
  v_claim record;
  v_organization_id uuid;
  v_memory_selected_ids jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'Execution runtime mutations require the service role';
  end if;
  if p_memory_run_id is null or char_length(p_memory_run_id) not between 1 and 128 then
    raise exception 'Memory binding runId is required';
  end if;
  if p_memory_assignment_id is null or char_length(p_memory_assignment_id) not between 1 and 128 then
    raise exception 'Memory binding assignmentId is required';
  end if;
  if p_memory_execution_context_hash is null or p_memory_execution_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_context_hash is null or p_memory_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_read_receipt_hash is null or p_memory_read_receipt_hash !~ '^[0-9a-f]{64}$'
     or p_memory_binding_hash is null or p_memory_binding_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Memory binding hashes must be lowercase SHA-256 values';
  end if;
  if p_memory_selected_refs is null or jsonb_typeof(p_memory_selected_refs) <> 'array' then
    raise exception 'Memory binding selectedMemoryRefs must be an array';
  end if;
  if jsonb_array_length(p_memory_selected_refs) > 100 then
    raise exception 'Memory binding selectedMemoryRefs exceeds the limit';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where jsonb_typeof(selected.ref) <> 'object'
       or selected.ref->>'memoryId' is null
       or char_length(selected.ref->>'memoryId') not between 1 and 128
       or selected.ref->>'memoryId' <> btrim(selected.ref->>'memoryId')
       or selected.ref->>'revision' is null
       or selected.ref->>'revision' !~ '^[0-9]+$'
       or (selected.ref->>'revision')::integer < 1
       or selected.ref->>'memoryHash' is null
       or selected.ref->>'memoryHash' !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Memory binding selectedMemoryRefs contains an invalid memoryId, revision, or memoryHash';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_memory_selected_refs)
  ) <> (
    select count(distinct selected.ref->>'memoryId')
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
  ) then
    raise exception 'Memory binding selectedMemoryRefs must be unique';
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(selected.ref->>'memoryId') order by selected.ordinality),
    '[]'::jsonb
  )
  into v_memory_selected_ids
  from jsonb_array_elements(p_memory_selected_refs) with ordinality selected(ref, ordinality);

  select claim.*
    into v_claim
  from public.claim_execution_step(
    p_worker_id,
    p_capability_key,
    p_lease_token_hash,
    p_lease_seconds
  ) claim;
  if not found then
    return;
  end if;

  select organization_id into v_organization_id
  from public.execution_attempts
  where id = v_claim.attempt_id;

  if p_memory_run_id <> v_claim.run_id::text then
    raise exception 'Memory binding runId does not match the claimed Workstream Run';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where not exists (
      select 1
      from public.operational_memory_records r
      where r.organization_id = v_organization_id
        and r.memory_id = selected.ref->>'memoryId'
        and r.revision = (selected.ref->>'revision')::integer
        and r.memory_hash = selected.ref->>'memoryHash'
        and r.status = 'verified'
        and (r.expires_at is null or r.expires_at > now())
        and (r.review_after is null or r.review_after > now())
        and not exists (
          select 1 from public.operational_memory_erasures e
          where e.organization_id = r.organization_id
            and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
        )
        and not exists (
          select 1
          from public.operational_memory_records newer
          where newer.organization_id = r.organization_id
            and newer.memory_id = r.memory_id
            and newer.revision > r.revision
        )
    )
  ) then
    raise exception 'Every selected memory reference must resolve to the latest verified, non-erased revision in the same organization';
  end if;

  perform set_config('app.execution_memory_binding_authorized', 'true', true);
  update public.execution_attempts
     set memory_run_id = p_memory_run_id,
         memory_assignment_id = p_memory_assignment_id,
         memory_execution_context_hash = p_memory_execution_context_hash,
         memory_context_hash = p_memory_context_hash,
         memory_read_receipt_hash = p_memory_read_receipt_hash,
         memory_binding_hash = p_memory_binding_hash,
         memory_selected_ids = v_memory_selected_ids,
         memory_selected_refs = p_memory_selected_refs
   where id = v_claim.attempt_id
     and status = 'running'
     and worker_id = p_worker_id
     and lease_token_hash = p_lease_token_hash;
  if not found then
    raise exception 'Claimed execution attempt disappeared before memory binding';
  end if;

  insert into public.execution_events (
    organization_id, plan_id, step_id, attempt_id, event_type,
    actor_kind, actor_ref, payload
  ) values (
    v_organization_id, v_claim.plan_id, v_claim.step_id, v_claim.attempt_id,
    'memory_context_bound', 'worker', p_worker_id,
    jsonb_build_object(
      'memoryRunId', p_memory_run_id,
      'memoryAssignmentId', p_memory_assignment_id,
      'memoryExecutionContextHash', p_memory_execution_context_hash,
      'memoryContextHash', p_memory_context_hash,
      'memoryReadReceiptHash', p_memory_read_receipt_hash,
      'memoryBindingHash', p_memory_binding_hash,
      'selectedMemoryIds', v_memory_selected_ids,
      'selectedMemoryRefs', p_memory_selected_refs
    )
  );

  return query
  select v_claim.attempt_id, v_claim.plan_id, v_claim.step_id, v_claim.run_id,
    v_claim.step_key, v_claim.capability_key, v_claim.action_class,
    v_claim.executor_context, v_claim.lease_expires_at, v_claim.attempt_number,
    p_memory_run_id, p_memory_assignment_id, p_memory_execution_context_hash,
    p_memory_context_hash, p_memory_read_receipt_hash, p_memory_binding_hash,
    v_memory_selected_ids, p_memory_selected_refs;
end;
$$;

revoke all on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) to service_role;

comment on table public.operational_memory_records is
  'Append-only, server-only revisions for operational-memory/v1. The latest revision is the only effective record.';
comment on table public.operational_memory_erasures is
  'Tombstones for controlled memory erasure. The clear memory identifier and payload are intentionally not retained.';

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

create or replace function public.read_operational_memories(
  p_organization_id uuid,
  p_limit integer default 5000
)
returns table (memory_payload jsonb)
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory reads require the service role';
  end if;
  if p_organization_id is null then raise exception 'Organization ID is required'; end if;
  if p_limit < 1 or p_limit > 10000 then raise exception 'Memory read limit must be between 1 and 10000'; end if;

  return query
  select latest.memory_payload
  from (
    select r.memory_payload,
           row_number() over (partition by r.memory_id order by r.revision desc) as revision_rank
    from public.operational_memory_records r
    where r.organization_id = p_organization_id
      and not exists (
        select 1 from public.operational_memory_erasures e
        where e.organization_id = r.organization_id
          and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
      )
  ) latest
  where latest.revision_rank = 1
  order by latest.memory_payload->>'memoryId'
  limit p_limit;
end;
$$;

revoke all on function public.read_operational_memories(uuid, integer) from public, anon, authenticated;
grant execute on function public.read_operational_memories(uuid, integer) to service_role;

create or replace function public.erase_operational_memory(
  p_organization_id uuid,
  p_memory_id text,
  p_reason text,
  p_requested_by text
)
returns table (erasure_id uuid, erased_revision_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_memory_id_hash text;
  v_revision_count integer;
  v_artifact_count integer;
  v_erasure_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception 'Operational memory erasure requires the service role';
  end if;
  if p_organization_id is null then raise exception 'Organization ID is required'; end if;
  if p_memory_id is null
     or char_length(p_memory_id) not between 1 and 128
     or p_memory_id <> btrim(p_memory_id) then
    raise exception 'Invalid memory ID';
  end if;
  if p_reason is null or char_length(p_reason) not between 1 and 2000 then
    raise exception 'A bounded erasure reason is required';
  end if;
  if p_requested_by is null
     or char_length(p_requested_by) not between 1 and 128
     or p_requested_by <> btrim(p_requested_by) then
    raise exception 'A bounded erasure requester is required';
  end if;

  v_memory_id_hash := encode(extensions.digest(p_memory_id, 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_memory_id, 0));

  select count(*)::integer,
         coalesce(sum(jsonb_array_length(source_artifact_refs)), 0)::integer
    into v_revision_count, v_artifact_count
  from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  if v_revision_count = 0 then
    select e.id into v_erasure_id
    from public.operational_memory_erasures e
    where e.organization_id = p_organization_id and e.memory_id_hash = v_memory_id_hash;
    if v_erasure_id is null then
      raise exception 'Operational memory was not found';
    end if;
    return query select v_erasure_id, 0;
    return;
  end if;

  perform set_config('app.memory_erasure_authorized', 'true', true);
  insert into public.operational_memory_erasures (
    organization_id, memory_id_hash, erased_revision_count,
    source_artifact_ref_count, reason, requested_by
  ) values (
    p_organization_id, v_memory_id_hash, v_revision_count,
    v_artifact_count, p_reason, p_requested_by
  )
  returning id into v_erasure_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, null, 'memory.updated', 'operational_memory_erasure',
    v_memory_id_hash,
    jsonb_build_object(
      'memoryIdHash', v_memory_id_hash,
      'erasureId', v_erasure_id,
      'erasedRevisionCount', v_revision_count,
      'sourceArtifactRefCount', v_artifact_count
    )
  );

  delete from public.operational_memory_records
  where organization_id = p_organization_id and memory_id = p_memory_id;

  return query select v_erasure_id, v_revision_count;
end;
$$;

revoke all on function public.erase_operational_memory(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.erase_operational_memory(uuid, text, text, text) to service_role;

-- A runtime claim carries the exact memory hashes that were used to build its
-- context. This is deliberately written by a wrapper around the existing
-- claim RPC so the claim, binding, and event commit atomically or roll back
-- together. No worker can begin from a half-bound attempt.
-- The base runtime migration predates this event and has a closed event-type
-- check, so widen it before the wrapper can emit the binding receipt.
alter table public.execution_events
  drop constraint if exists execution_events_event_type_check;

alter table public.execution_events
  add constraint execution_events_event_type_check check (event_type in (
    'plan_proposed', 'plan_frozen', 'plan_started', 'plan_blocked',
    'plan_completed', 'plan_failed', 'plan_cancelled', 'stage_ready',
    'stage_blocked', 'attempt_started', 'attempt_heartbeat',
    'attempt_succeeded', 'attempt_failed', 'attempt_expired',
    'retry_scheduled', 'approval_requested', 'approval_approved',
    'approval_rejected', 'stage_cancelled', 'queue_refreshed',
    'memory_context_bound'
  ));

alter table public.execution_attempts
  add column if not exists memory_run_id text,
  add column if not exists memory_assignment_id text,
  add column if not exists memory_execution_context_hash text,
  add column if not exists memory_context_hash text,
  add column if not exists memory_read_receipt_hash text,
  add column if not exists memory_binding_hash text,
  add column if not exists memory_selected_ids jsonb not null default '[]'::jsonb,
  add column if not exists memory_selected_refs jsonb not null default '[]'::jsonb;

alter table public.execution_attempts
  add constraint execution_attempts_memory_hashes_check check (
    (
      memory_run_id is null
      and memory_assignment_id is null
      and memory_execution_context_hash is null
      and memory_context_hash is null
      and memory_read_receipt_hash is null
      and memory_binding_hash is null
      and memory_selected_ids = '[]'::jsonb
      and memory_selected_refs = '[]'::jsonb
    )
    or (
      memory_run_id is not null
      and memory_assignment_id is not null
      and memory_execution_context_hash is not null
      and memory_context_hash is not null
      and memory_read_receipt_hash is not null
      and memory_binding_hash is not null
      and jsonb_typeof(memory_selected_ids) = 'array'
      and jsonb_typeof(memory_selected_refs) = 'array'
      and case
        when jsonb_typeof(memory_selected_ids) = 'array'
          then jsonb_array_length(memory_selected_ids) <= 100
        else false
      end
      and case
        when jsonb_typeof(memory_selected_refs) = 'array'
          then jsonb_array_length(memory_selected_refs) <= 100
        else false
      end
    )
  ),
  add constraint execution_attempts_memory_hash_format_check check (
    (memory_execution_context_hash is null or memory_execution_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_context_hash is null or memory_context_hash ~ '^[0-9a-f]{64}$')
    and (memory_read_receipt_hash is null or memory_read_receipt_hash ~ '^[0-9a-f]{64}$')
    and (memory_binding_hash is null or memory_binding_hash ~ '^[0-9a-f]{64}$')
  );

create index execution_attempts_memory_binding_idx
  on public.execution_attempts (organization_id, memory_binding_hash)
  where memory_binding_hash is not null;

create or replace function public.enforce_execution_attempt_memory_binding()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.memory_binding_hash is not null
     and (
       current_user <> 'service_role'
       or coalesce(current_setting('app.execution_memory_binding_authorized', true), '') <> 'true'
     ) then
    raise exception 'Execution memory binding may only be attached by the claim RPC';
  end if;

  if tg_op = 'UPDATE'
     and row(
       new.memory_run_id, new.memory_assignment_id,
       new.memory_execution_context_hash, new.memory_context_hash,
       new.memory_read_receipt_hash, new.memory_binding_hash,
       new.memory_selected_ids, new.memory_selected_refs
     ) is distinct from row(
       old.memory_run_id, old.memory_assignment_id,
       old.memory_execution_context_hash, old.memory_context_hash,
       old.memory_read_receipt_hash, old.memory_binding_hash,
       old.memory_selected_ids, old.memory_selected_refs
     ) then
    if old.memory_binding_hash is not null then
      raise exception 'Execution memory binding is immutable after attachment';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_execution_attempt_memory_binding
  before insert or update on public.execution_attempts
  for each row execute function public.enforce_execution_attempt_memory_binding();

create or replace function public.claim_execution_step_with_memory(
  p_worker_id text,
  p_capability_key text,
  p_lease_token_hash text,
  p_memory_run_id text,
  p_memory_assignment_id text,
  p_memory_execution_context_hash text,
  p_memory_context_hash text,
  p_memory_read_receipt_hash text,
  p_memory_binding_hash text,
  p_memory_selected_refs jsonb,
  p_lease_seconds integer default 300
)
returns table (
  attempt_id uuid,
  plan_id uuid,
  step_id uuid,
  run_id uuid,
  step_key text,
  capability_key text,
  action_class text,
  executor_context jsonb,
  lease_expires_at timestamptz,
  attempt_number integer,
  memory_run_id text,
  memory_assignment_id text,
  memory_execution_context_hash text,
  memory_context_hash text,
  memory_read_receipt_hash text,
  memory_binding_hash text,
  memory_selected_ids jsonb,
  memory_selected_refs jsonb
)
language plpgsql
set search_path = public
as $$
declare
  v_claim record;
  v_organization_id uuid;
  v_memory_selected_ids jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'Execution runtime mutations require the service role';
  end if;
  if p_memory_run_id is null or char_length(p_memory_run_id) not between 1 and 128 then
    raise exception 'Memory binding runId is required';
  end if;
  if p_memory_assignment_id is null or char_length(p_memory_assignment_id) not between 1 and 128 then
    raise exception 'Memory binding assignmentId is required';
  end if;
  if p_memory_execution_context_hash is null or p_memory_execution_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_context_hash is null or p_memory_context_hash !~ '^[0-9a-f]{64}$'
     or p_memory_read_receipt_hash is null or p_memory_read_receipt_hash !~ '^[0-9a-f]{64}$'
     or p_memory_binding_hash is null or p_memory_binding_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Memory binding hashes must be lowercase SHA-256 values';
  end if;
  if p_memory_selected_refs is null or jsonb_typeof(p_memory_selected_refs) <> 'array' then
    raise exception 'Memory binding selectedMemoryRefs must be an array';
  end if;
  if jsonb_array_length(p_memory_selected_refs) > 100 then
    raise exception 'Memory binding selectedMemoryRefs exceeds the limit';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where jsonb_typeof(selected.ref) <> 'object'
       or selected.ref->>'memoryId' is null
       or char_length(selected.ref->>'memoryId') not between 1 and 128
       or selected.ref->>'memoryId' <> btrim(selected.ref->>'memoryId')
       or selected.ref->>'revision' is null
       or selected.ref->>'revision' !~ '^[0-9]+$'
       or (selected.ref->>'revision')::integer < 1
       or selected.ref->>'memoryHash' is null
       or selected.ref->>'memoryHash' !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Memory binding selectedMemoryRefs contains an invalid memoryId, revision, or memoryHash';
  end if;
  if (
    select count(*) from jsonb_array_elements(p_memory_selected_refs)
  ) <> (
    select count(distinct selected.ref->>'memoryId')
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
  ) then
    raise exception 'Memory binding selectedMemoryRefs must be unique';
  end if;
  select coalesce(
    jsonb_agg(to_jsonb(selected.ref->>'memoryId') order by selected.ordinality),
    '[]'::jsonb
  )
  into v_memory_selected_ids
  from jsonb_array_elements(p_memory_selected_refs) with ordinality selected(ref, ordinality);

  select claim.*
    into v_claim
  from public.claim_execution_step(
    p_worker_id,
    p_capability_key,
    p_lease_token_hash,
    p_lease_seconds
  ) claim;
  if not found then
    return;
  end if;

  select organization_id into v_organization_id
  from public.execution_attempts
  where id = v_claim.attempt_id;

  if p_memory_run_id <> v_claim.run_id::text then
    raise exception 'Memory binding runId does not match the claimed Workstream Run';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_memory_selected_refs) selected(ref)
    where not exists (
      select 1
      from public.operational_memory_records r
      where r.organization_id = v_organization_id
        and r.memory_id = selected.ref->>'memoryId'
        and r.revision = (selected.ref->>'revision')::integer
        and r.memory_hash = selected.ref->>'memoryHash'
        and r.status = 'verified'
        and (r.expires_at is null or r.expires_at > now())
        and (r.review_after is null or r.review_after > now())
        and not exists (
          select 1 from public.operational_memory_erasures e
          where e.organization_id = r.organization_id
            and e.memory_id_hash = encode(extensions.digest(r.memory_id, 'sha256'), 'hex')
        )
        and not exists (
          select 1
          from public.operational_memory_records newer
          where newer.organization_id = r.organization_id
            and newer.memory_id = r.memory_id
            and newer.revision > r.revision
        )
    )
  ) then
    raise exception 'Every selected memory reference must resolve to the latest verified, non-erased revision in the same organization';
  end if;

  perform set_config('app.execution_memory_binding_authorized', 'true', true);
  update public.execution_attempts
     set memory_run_id = p_memory_run_id,
         memory_assignment_id = p_memory_assignment_id,
         memory_execution_context_hash = p_memory_execution_context_hash,
         memory_context_hash = p_memory_context_hash,
         memory_read_receipt_hash = p_memory_read_receipt_hash,
         memory_binding_hash = p_memory_binding_hash,
         memory_selected_ids = v_memory_selected_ids,
         memory_selected_refs = p_memory_selected_refs
   where id = v_claim.attempt_id
     and status = 'running'
     and worker_id = p_worker_id
     and lease_token_hash = p_lease_token_hash;
  if not found then
    raise exception 'Claimed execution attempt disappeared before memory binding';
  end if;

  insert into public.execution_events (
    organization_id, plan_id, step_id, attempt_id, event_type,
    actor_kind, actor_ref, payload
  ) values (
    v_organization_id, v_claim.plan_id, v_claim.step_id, v_claim.attempt_id,
    'memory_context_bound', 'worker', p_worker_id,
    jsonb_build_object(
      'memoryRunId', p_memory_run_id,
      'memoryAssignmentId', p_memory_assignment_id,
      'memoryExecutionContextHash', p_memory_execution_context_hash,
      'memoryContextHash', p_memory_context_hash,
      'memoryReadReceiptHash', p_memory_read_receipt_hash,
      'memoryBindingHash', p_memory_binding_hash,
      'selectedMemoryIds', v_memory_selected_ids,
      'selectedMemoryRefs', p_memory_selected_refs
    )
  );

  return query
  select v_claim.attempt_id, v_claim.plan_id, v_claim.step_id, v_claim.run_id,
    v_claim.step_key, v_claim.capability_key, v_claim.action_class,
    v_claim.executor_context, v_claim.lease_expires_at, v_claim.attempt_number,
    p_memory_run_id, p_memory_assignment_id, p_memory_execution_context_hash,
    p_memory_context_hash, p_memory_read_receipt_hash, p_memory_binding_hash,
    v_memory_selected_ids, p_memory_selected_refs;
end;
$$;

revoke all on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.claim_execution_step_with_memory(
  text, text, text, text, text, text, text, text, text, jsonb, integer
) to service_role;

comment on table public.operational_memory_records is
  'Append-only, server-only revisions for operational-memory/v1. The latest revision is the only effective record.';
comment on table public.operational_memory_erasures is
  'Tombstones for controlled memory erasure. The clear memory identifier and payload are intentionally not retained.';
