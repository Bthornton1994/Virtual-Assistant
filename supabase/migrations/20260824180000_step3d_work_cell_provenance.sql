-- Step 3D provenance hardening: round-three adversarial review found the
-- reserved-reviewer-ref trigger checked identity and existence but never the
-- CONTENT of what it was letting through, and found the two-insert phase
-- persistence pattern could leave a durable orphan artifact if the second
-- insert failed. Both are corrected here.

-- 1. Bind the reserved Gauntlet verdict to the validation artifact's own content.
--
-- reserve_work_cell_reviewer_ref (20260824090000) verified that a completed
-- 'validate' assignment existed whose output artifact carried schemaVersion
-- catalog-evidence-validation/v1. It did not verify that the row actually being
-- inserted (new.hard_gate_pass, new.verdict) agreed with that artifact's own
-- gate.hardGatePass / gate.workCellVerdict, and it accepted any deterministic
-- executor rather than requiring the validator profile specifically. An ops
-- manager could therefore insert a passing review over a failing validation, or
-- point the reserved ref at a validate assignment run under a different
-- deterministic profile. This closes both gaps: the row is now checked against
-- the validation artifact's own stored content, not merely its presence.
create or replace function public.reserve_work_cell_reviewer_ref()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_has_work_cell boolean;
  v_validate_artifact_id uuid;
  v_validate_profile_key text;
  v_stored_hard_gate_pass boolean;
  v_stored_verdict text;
begin
  v_has_work_cell := public.run_has_work_cell(new.run_id);

  if new.reviewer_ref = 'delegation-cloud-work-cell-v1' then
    if new.reviewer_kind <> 'deterministic' or not public.is_ops_manager() then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict over a completed validation artifact';
    end if;

    -- Resolve the completed validate assignment and the profile that ran it.
    select rea.output_artifact_id, ep.key
      into v_validate_artifact_id, v_validate_profile_key
    from public.run_executor_assignments rea
    join public.executor_profiles ep on ep.id = rea.executor_profile_id
    where rea.run_id = new.run_id
      and rea.phase = 'validate'
      and rea.status = 'completed'
    order by rea.created_at asc
    limit 1;

    if v_validate_artifact_id is null then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict over a completed validation artifact';
    end if;

    -- The validate phase is not merely "a deterministic executor": it must be
    -- the registered catalog evidence validator, so a differently-configured or
    -- differently-authored deterministic profile cannot stand in for it.
    if v_validate_profile_key is distinct from 'catalog-evidence-validator-v1' then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the catalog-evidence-validator-v1 executor''s validation output';
    end if;

    -- Read the gate this artifact actually stored, and require the reviewer
    -- row's own hard_gate_pass/verdict columns to agree with it exactly. This is
    -- the check the previous round omitted: existence and authorship of the
    -- validation artifact were verified, but never that the row being inserted
    -- reports the same conclusion the artifact reached.
    select
      (ea.payload -> 'gate' ->> 'hardGatePass')::boolean,
      ea.payload -> 'gate' ->> 'workCellVerdict'
      into v_stored_hard_gate_pass, v_stored_verdict
    from public.evidence_artifacts ea
    where ea.id = v_validate_artifact_id
      and ea.payload ->> 'schemaVersion' = 'catalog-evidence-validation/v1';

    if v_stored_hard_gate_pass is null or v_stored_verdict is null then
      raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict over a completed validation artifact';
    end if;

    if new.hard_gate_pass is distinct from v_stored_hard_gate_pass
       or new.verdict is distinct from v_stored_verdict then
      raise exception 'The inserted Gauntlet review disagrees with the deterministic validation artifact it claims to record (stored hardGatePass=%, workCellVerdict=%; attempted hard_gate_pass=%, verdict=%)',
        v_stored_hard_gate_pass, v_stored_verdict, new.hard_gate_pass, new.verdict;
    end if;

    return new;
  end if;

  if v_has_work_cell then
    raise exception 'This run is executed by a work cell; its single Gauntlet review is written by the deterministic work-cell verdict. Record findings in the work cell rather than as a separate review.';
  end if;
  return new;
end;
$$;
-- No new trigger statement: trg_reserve_work_cell_reviewer_ref (20260824090000)
-- already binds to this function by name, and CREATE OR REPLACE FUNCTION keeps
-- the same object identity, so the existing trigger picks up this body as soon
-- as this migration applies.

-- 2. Make successful phase persistence atomic.
--
-- ingestCatalogEvidencePacket, ingestCatalogEvidenceReview, and
-- runWorkCellValidation each inserted an evidence_artifacts row and then, in a
-- second independent statement, a run_executor_assignments row. If the second
-- insert failed for any reason (a race on the (run_id, phase) unique
-- constraint, a trigger exception, a dropped connection) the first insert had
-- already committed: a durable "accepted" artifact with no assignment behind
-- it, invisible to run_has_work_cell's assignment branch and unbound to any
-- executor's cost or authority snapshot.
--
-- record_work_cell_phase_artifact wraps both inserts in one function call, so
-- one implicit transaction covers both: any exception anywhere in the body
-- rolls back everything it did, and nothing partial is ever left behind. It
-- runs SECURITY INVOKER (the default — no security definer clause), so it
-- carries no elevated privilege of its own: RLS on both tables, and every
-- existing insert trigger on both tables (org-match, run-status, profile
-- fitness, artifact authority, content-hash shape), still apply exactly as if
-- the two inserts had been issued directly by the caller.
create or replace function public.record_work_cell_phase_artifact(
  p_run_id uuid,
  p_kind text,
  p_summary text,
  p_source_uri text,
  p_content_hash text,
  p_payload jsonb,
  p_executor_profile_id uuid,
  p_phase text,
  p_assignment_status text,
  p_authority_snapshot jsonb,
  p_input_artifact_id uuid,
  p_human_minutes numeric,
  p_ai_cost_micros bigint,
  p_tool_cost_micros bigint,
  p_assignment_metadata jsonb
)
returns table (artifact_id uuid, assignment_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_org_id uuid;
  v_artifact_id uuid;
  v_assignment_id uuid;
begin
  select organization_id into v_org_id from public.workstream_runs where id = p_run_id;
  if v_org_id is null then
    raise exception 'Workstream run % was not found', p_run_id;
  end if;

  insert into public.evidence_artifacts (
    organization_id, run_id, kind, summary, source_uri, content_hash, payload, created_by
  ) values (
    v_org_id, p_run_id, p_kind, p_summary, p_source_uri, p_content_hash, p_payload, auth.uid()
  ) returning id into v_artifact_id;

  insert into public.run_executor_assignments (
    organization_id, run_id, executor_profile_id, phase, status,
    authority_snapshot, input_artifact_id, output_artifact_id,
    human_minutes, ai_cost_micros, tool_cost_micros, metadata, created_by
  ) values (
    v_org_id, p_run_id, p_executor_profile_id, p_phase, p_assignment_status,
    p_authority_snapshot, p_input_artifact_id, v_artifact_id,
    p_human_minutes, p_ai_cost_micros, p_tool_cost_micros, p_assignment_metadata, auth.uid()
  ) returning id into v_assignment_id;

  return query select v_artifact_id, v_assignment_id;
end;
$$;

revoke all on function public.record_work_cell_phase_artifact from public;
grant execute on function public.record_work_cell_phase_artifact to authenticated;
