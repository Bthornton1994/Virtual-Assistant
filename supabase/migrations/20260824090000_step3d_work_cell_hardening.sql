-- Step 3D hardening: two control-plane defects found by adversarial review of the
-- work-cell implementation. Both are in pre-existing objects, so they are corrected
-- here rather than by editing an already-applied migration.

-- 1. Stop the evidence-artifact trigger from discarding a caller-supplied hash.
--
-- enforce_evidence_artifact_invariants (20260822182149) ended with an
-- unconditional `new.content_hash := digest(kind|summary|source_uri|payload)`.
-- That silently overwrote whatever the application supplied.
--
-- For Step 3D this was fatal rather than cosmetic. The work cell binds a review
-- to a packet by the packet's canonical hash — sha256 over deterministically
-- canonicalized JSON — and re-derives that hash from the stored payload at
-- verdict time to prove the artifact has not been tampered with. With the
-- overwrite in place the stored hash was a different digest over a different
-- preimage, so the re-derivation could never match and EVERY work cell would
-- have hard-failed the moment it ran for real.
--
-- The digest now applies only when the caller supplied no usable hash, which
-- preserves the original guarantee (every artifact carries a 64-hex hash) while
-- letting a canonical, reproducible hash survive.
create or replace function public.enforce_evidence_artifact_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_record record;
  request_org uuid;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Evidence artifacts are immutable';
  end if;

  select organization_id, status into run_record
    from public.workstream_runs where id = new.run_id;
  if run_record.organization_id is null then
    raise exception 'Evidence must belong to an existing workstream run';
  end if;
  if run_record.organization_id is distinct from new.organization_id then
    raise exception 'Evidence organization must match its workstream run';
  end if;
  if run_record.status <> 'running' then
    raise exception 'Evidence may only be appended while a run is running';
  end if;

  if new.request_id is not null then
    select organization_id into request_org from public.requests where id = new.request_id;
    if request_org is distinct from new.organization_id then
      raise exception 'Evidence request must belong to the same organization';
    end if;
  end if;

  -- Fallback only. A caller that computed a real content hash keeps it.
  if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
    new.content_hash := encode(
      extensions.digest(
        concat_ws('|', new.kind, new.summary, coalesce(new.source_uri, ''), coalesce(new.payload, '{}'::jsonb)::text),
        'sha256'
      ),
      'hex'
    );
  end if;

  return new;
end;
$$;

-- 2. Close the manual-review route around the work-cell gate.
--
-- The receipt guard passes a run as soon as ANY independent review row reads
-- verdict='passed' with a clean hard gate. The ops UI still offers the original
-- manual adversarial-review form for a run awaiting verification, and it is
-- available in exactly the same window as the work-cell verdict button. A
-- manager could therefore record a manual passing review on a work-cell run and
-- obtain a passing Outcome Receipt without the deterministic gate ever running —
-- the same class of hole as writing two disagreeing review rows.
--
-- When a run has a work cell, only the work cell's own authoritative row may
-- satisfy the guard. Runs with no work cell are unaffected.
create or replace function public.require_gauntlet_review_for_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cycle_id uuid;
  v_review_count bigint;
  v_has_work_cell boolean;
begin
  if new.verification_status <> 'passed' or not new.definition_of_done_met then return new; end if;

  select wr.gauntlet_cycle_id into v_cycle_id
    from public.workstream_runs wr
    where wr.id = new.run_id and wr.organization_id = new.organization_id;
  if v_cycle_id is null then return new; end if;

  select exists (
    select 1 from public.run_executor_assignments rea where rea.run_id = new.run_id
  ) into v_has_work_cell;

  select count(*) into v_review_count
    from public.gauntlet_reviews gr
    where gr.run_id = new.run_id
      and gr.cycle_id = v_cycle_id
      and gr.independent
      and gr.verdict = 'passed'
      and gr.hard_gate_pass
      and jsonb_array_length(coalesce(gr.authority_incidents, '[]'::jsonb)) = 0
      and (
        not v_has_work_cell
        or (gr.reviewer_kind = 'deterministic' and gr.reviewer_ref = 'delegation-cloud-work-cell-v1')
      );

  if v_review_count = 0 then
    if v_has_work_cell then
      raise exception 'A work-cell run cannot pass without the deterministic work-cell hard-gate review';
    end if;
    raise exception 'A Gauntlet run cannot pass without an independent adversarial hard-gate review';
  end if;
  return new;
end;
$$;

-- 3. Reserve the work cell's reviewer_ref so a hand-entered review cannot
--    impersonate the deterministic verdict and occupy the one review slot
--    (gauntlet_one_final_review_per_run_idx allows exactly one row per run).
create or replace function public.reserve_work_cell_reviewer_ref()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reviewer_ref = 'delegation-cloud-work-cell-v1'
     and (new.reviewer_kind <> 'deterministic' or not exists (
       select 1 from public.run_executor_assignments rea
       where rea.run_id = new.run_id and rea.phase = 'validate'
     )) then
    raise exception 'The reviewer reference delegation-cloud-work-cell-v1 is reserved for the deterministic work-cell verdict';
  end if;
  return new;
end;
$$;

create trigger trg_reserve_work_cell_reviewer_ref
  before insert on public.gauntlet_reviews
  for each row execute function public.reserve_work_cell_reviewer_ref();
