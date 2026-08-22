create index delegation_specs_workstream_org_fk_idx
  on public.delegation_specs (workstream_id, organization_id);

create index workstream_runs_spec_org_fk_idx
  on public.workstream_runs (delegation_spec_id, organization_id);

create index workstream_runs_workstream_org_fk_idx
  on public.workstream_runs (workstream_id, organization_id);

create index evidence_artifacts_run_org_fk_idx
  on public.evidence_artifacts (run_id, organization_id);

create index outcome_receipts_run_org_fk_idx
  on public.outcome_receipts (run_id, organization_id);
