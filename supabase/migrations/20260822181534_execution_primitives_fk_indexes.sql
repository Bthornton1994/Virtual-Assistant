create index delegation_specs_workstream_fk_idx on public.delegation_specs (workstream_id) where workstream_id is not null;
create index delegation_specs_created_by_idx on public.delegation_specs (created_by) where created_by is not null;
create index delegation_specs_activated_by_idx on public.delegation_specs (activated_by) where activated_by is not null;
create index workstream_runs_workstream_fk_idx on public.workstream_runs (workstream_id) where workstream_id is not null;
create index workstream_runs_initiated_by_idx on public.workstream_runs (initiated_by) where initiated_by is not null;
create index evidence_artifacts_request_idx on public.evidence_artifacts (request_id) where request_id is not null;
create index evidence_artifacts_created_by_idx on public.evidence_artifacts (created_by) where created_by is not null;
create index outcome_receipts_verified_by_idx on public.outcome_receipts (verified_by) where verified_by is not null;
