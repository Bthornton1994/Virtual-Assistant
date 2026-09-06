\set ON_ERROR_STOP on
\pset pager off

-- End-to-end QA proof for the memory persistence boundary.
--
-- Preconditions:
--   * This is the dedicated Delegation Cloud QA project.
--   * The existing QA fixture contains the organization, manager user,
--     workstream, and active Delegation Spec below.
--   * The migration 20260904120000_memory_control_plane_persistence_v1.sql
--     has already been applied.
--
-- The proof runs under service_role because the memory RPCs are deliberately
-- server-only. Every disposable row is rolled back before the script exits.
-- Never run this against Production or an unrelated Supabase project.

begin;
set local role service_role;

do $proof$
declare
  v_org_id uuid := 'bd832a07-729f-4ce3-b961-8b82fdb46f35';
  v_manager_id uuid := 'c0b2ab6c-c56d-4435-89fd-f972ce552609';
  v_spec_id uuid := '37bf390f-43bf-48db-af38-63fab1a91ac9';
  v_workstream_id uuid := '2a984b48-3601-4cd4-90b4-0efa9183a4ab';
  v_run_id uuid := 'c7e50001-0000-4000-8000-000000000001';
  v_artifact_id uuid := 'c7e50001-0000-4000-8000-000000000002';
  v_memory_id text := 'memory-qa-cp-v1';
  v_source_payload jsonb;
  v_source_hash text;
  v_canonical_body text;
  v_memory jsonb;
  v_memory_hash text;
  v_canonical_body_v2 text;
  v_memory_v2 jsonb;
  v_memory_hash_v2 text;
  v_record_id uuid;
  v_revision integer;
  v_returned_hash text;
  v_second_record_id uuid;
  v_second_revision integer;
  v_erasure_id uuid;
  v_second_erasure_id uuid;
  v_erased_count integer;
  v_second_erased_count integer;
  v_read_count integer;
  v_read_revision integer;
  v_audit_count integer;
begin
  if not exists (select 1 from public.organizations where id = v_org_id)
     or not exists (select 1 from public.workstreams where id = v_workstream_id and organization_id = v_org_id)
     or not exists (
       select 1 from public.delegation_specs
       where id = v_spec_id and organization_id = v_org_id
     ) then
    raise exception 'Required Delegation Cloud QA fixture is missing';
  end if;

  if exists (select 1 from public.workstream_runs where id = v_run_id)
     or exists (select 1 from public.evidence_artifacts where id = v_artifact_id)
     or exists (
       select 1 from public.operational_memory_records
       where organization_id = v_org_id and memory_id = v_memory_id
     )
     or exists (
       select 1 from public.operational_memory_erasures
       where organization_id = v_org_id
         and memory_id_hash = encode(extensions.digest(v_memory_id, 'sha256'), 'hex')
     )
     or exists (
       select 1 from public.audit_events
       where organization_id = v_org_id
         and entity_id = encode(extensions.digest(v_memory_id, 'sha256'), 'hex')
         and entity_type in ('operational_memory', 'operational_memory_erasure')
     ) then
    raise exception 'Memory control-plane QA sentinel IDs already exist; refusing to run';
  end if;

  insert into public.workstream_runs (
    id, organization_id, workstream_id, delegation_spec_id, status, initiated_by
  ) values (
    v_run_id, v_org_id, v_workstream_id, v_spec_id, 'planned', v_manager_id
  );
  update public.workstream_runs
     set status = 'running',
         started_at = '2026-09-04T00:00:00Z'
   where id = v_run_id;

  v_source_payload := jsonb_build_object(
    'schemaVersion', 'memory-proof/v1',
    'memoryId', v_memory_id,
    'purpose', 'persistence',
    'nonce', 'c7e5-memory-proof'
  );
  v_source_hash := encode(
    extensions.digest(
      concat_ws(
        '|',
        'source',
        'Disposable memory control-plane source artifact',
        'qa://memory-control-plane/v1',
        v_source_payload::text
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.evidence_artifacts (
    id, organization_id, run_id, kind, summary, source_uri,
    content_hash, payload, observed_at, created_by
  ) values (
    v_artifact_id, v_org_id, v_run_id, 'source',
    'Disposable memory control-plane source artifact',
    'qa://memory-control-plane/v1',
    v_source_hash, v_source_payload, '2026-09-04T00:00:01Z', v_manager_id
  );

  -- Keys are ordered with the same canonical JSON ordering used by
  -- src/lib/catalog-evidence-hash.ts. Dynamic values are constrained UUIDs or
  -- hashes, so the format string cannot introduce JSON metacharacters.
  v_canonical_body := format(
    '{"claim":"A QA memory requires a reviewable next step.","conflictSetId":null,"expiredAt":null,"expiresAt":"2026-10-01T00:00:00.000Z","invalidatedAt":null,"invalidationReason":null,"kind":"operational","memoryId":"memory-qa-cp-v1","provenance":{"approverId":null,"observedAt":"2026-09-04T00:00:02.000Z","recordedAt":"2026-09-04T00:00:03.000Z","recordedBy":"c0b2ab6c-c56d-4435-89fd-f972ce552609","sourceArtifactRefs":[{"artifactId":"c7e50001-0000-4000-8000-000000000002","contentHash":%s,"schemaVersion":"memory-proof/v1"}],"sourceAssignmentId":null,"sourceKind":"human_decision","sourceRunId":null},"retentionClass":"standard","revision":1,"reviewAfter":"2026-09-20T00:00:00.000Z","schemaVersion":"operational-memory/v1","scope":{"organizationId":"bd832a07-729f-4ce3-b961-8b82fdb46f35","scopeKey":"bd832a07-729f-4ce3-b961-8b82fdb46f35","scopeKind":"organization"},"sensitivity":"internal","status":"candidate","subjectKey":"memory.policy","supersedesHash":null,"value":{"note":"Disposable QA memory","purpose":"persistence"}}',
    to_json(v_source_hash)::text
  );
  v_memory_hash := encode(extensions.digest(v_canonical_body, 'sha256'), 'hex');
  v_memory := v_canonical_body::jsonb || jsonb_build_object('memoryHash', v_memory_hash);

  select p.record_id, p.revision, p.memory_hash
    into v_record_id, v_revision, v_returned_hash
  from public.persist_operational_memory(v_memory, v_canonical_body) p;

  if v_record_id is null or v_revision <> 1 or v_returned_hash <> v_memory_hash then
    raise exception 'QA_PROOF_FAILED: initial memory persistence returned the wrong record';
  end if;

  select p.record_id, p.revision
    into v_second_record_id, v_second_revision
  from public.persist_operational_memory(v_memory, v_canonical_body) p;

  if v_second_record_id <> v_record_id or v_second_revision <> 1 then
    raise exception 'QA_PROOF_FAILED: identical memory persistence was not idempotent';
  end if;

  select count(*), max((r.memory_payload->>'revision')::integer)
    into v_read_count, v_read_revision
  from public.read_operational_memories(v_org_id, 100) r;

  if v_read_count <> 1 or v_read_revision <> 1 then
    raise exception 'QA_PROOF_FAILED: initial read did not return the latest revision';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where organization_id = v_org_id
    and entity_type = 'operational_memory'
    and entity_id = encode(extensions.digest(v_memory_id, 'sha256'), 'hex');
  if v_audit_count <> 1 then
    raise exception 'QA_PROOF_FAILED: initial persistence did not emit exactly one audit event';
  end if;

  v_canonical_body_v2 := replace(
    v_canonical_body,
    '"A QA memory requires a reviewable next step."',
    '"A QA memory remains scoped to its organization."'
  );
  v_canonical_body_v2 := replace(v_canonical_body_v2, '"revision":1', '"revision":2');
  v_canonical_body_v2 := replace(
    v_canonical_body_v2,
    '"supersedesHash":null',
    format('"supersedesHash":%s', to_json(v_memory_hash)::text)
  );
  v_memory_v2 := jsonb_set(v_memory, '{claim}', to_jsonb('A QA memory remains scoped to its organization.'::text));
  v_memory_v2 := jsonb_set(v_memory_v2, '{revision}', to_jsonb(2), true);
  v_memory_v2 := jsonb_set(v_memory_v2, '{supersedesHash}', to_jsonb(v_memory_hash), true);
  v_memory_hash_v2 := encode(extensions.digest(v_canonical_body_v2, 'sha256'), 'hex');
  v_memory_v2 := jsonb_set(v_memory_v2, '{memoryHash}', to_jsonb(v_memory_hash_v2), true);

  select p.revision, p.memory_hash
    into v_revision, v_returned_hash
  from public.persist_operational_memory(v_memory_v2, v_canonical_body_v2) p;

  if v_revision <> 2 or v_returned_hash <> v_memory_hash_v2 then
    raise exception 'QA_PROOF_FAILED: second memory revision was not appended with its new hash';
  end if;

  select count(*), max((r.memory_payload->>'revision')::integer)
    into v_read_count, v_read_revision
  from public.read_operational_memories(v_org_id, 100) r
  where r.memory_payload->>'memoryId' = v_memory_id;

  if v_read_count <> 1 or v_read_revision <> 2 then
    raise exception 'QA_PROOF_FAILED: latest-revision read did not select revision 2';
  end if;

  if exists (
    select 1
    from public.read_operational_memories(v_org_id, 100) r
    where r.memory_payload->>'memoryHash' = v_memory_hash
  ) then
    raise exception 'QA_PROOF_FAILED: stale revision remained readable';
  end if;

  select e.erasure_id, e.erased_revision_count
    into v_erasure_id, v_erased_count
  from public.erase_operational_memory(
    v_org_id, v_memory_id, 'Disposable QA erasure proof', v_manager_id::text
  ) e;

  if v_erasure_id is null or v_erased_count <> 2 then
    raise exception 'QA_PROOF_FAILED: erasure did not remove both revisions';
  end if;
  if exists (
    select 1 from public.operational_memory_records
    where organization_id = v_org_id and memory_id = v_memory_id
  ) then
    raise exception 'QA_PROOF_FAILED: clear memory revisions remained after erasure';
  end if;
  if (select count(*) from public.operational_memory_erasures
      where organization_id = v_org_id
        and memory_id_hash = encode(extensions.digest(v_memory_id, 'sha256'), 'hex')) <> 1 then
    raise exception 'QA_PROOF_FAILED: erasure tombstone was not written';
  end if;
  if (select count(*) from public.read_operational_memories(v_org_id, 100)
      where memory_payload->>'memoryId' = v_memory_id) <> 0 then
    raise exception 'QA_PROOF_FAILED: erased memory remained readable';
  end if;

  select count(*) into v_audit_count
  from public.audit_events
  where organization_id = v_org_id
    and entity_type in ('operational_memory', 'operational_memory_erasure')
    and entity_id = encode(extensions.digest(v_memory_id, 'sha256'), 'hex');
  if v_audit_count <> 3 then
    raise exception 'QA_PROOF_FAILED: two persistence revisions plus erasure did not emit three audit events';
  end if;

  begin
    perform public.persist_operational_memory(v_memory, v_canonical_body);
    raise exception 'QA_PROOF_FAILED: an erased memory ID was allowed to be reused';
  exception when others then
    if sqlerrm not like 'Operational memory ID was erased and cannot be reused' then
      raise;
    end if;
  end;

  select e.erasure_id, e.erased_revision_count
    into v_second_erasure_id, v_second_erased_count
  from public.erase_operational_memory(
    v_org_id, v_memory_id, 'Disposable QA erasure proof repeat', v_manager_id::text
  ) e;

  if v_second_erasure_id <> v_erasure_id or v_second_erased_count <> 0 then
    raise exception 'QA_PROOF_FAILED: repeated erasure was not idempotent';
  end if;

  if (select count(*) from public.evidence_artifacts where id = v_artifact_id) <> 1 then
    raise exception 'QA_PROOF_FAILED: shared source evidence was deleted by memory erasure';
  end if;
end
$proof$;

rollback;

select
  'memory_control_plane_v1_persistence_fixture' as proof,
  true as passed,
  'transaction rolled back; disposable run, artifact, memory, tombstone, and audit rows were not retained' as isolation;
