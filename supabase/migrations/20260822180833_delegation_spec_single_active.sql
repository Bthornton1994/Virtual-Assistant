-- A workstream can have at most one active Delegation Spec at a time.
-- Activated specs are intentionally immutable under RLS in Step 2.
create unique index delegation_specs_one_active_per_workstream
  on public.delegation_specs (organization_id, workstream_id)
  where status = 'active' and workstream_id is not null;
