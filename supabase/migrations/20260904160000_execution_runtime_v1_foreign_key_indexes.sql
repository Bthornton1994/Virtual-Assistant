-- Execution Runtime v1 foreign-key covering indexes.
-- Keep FK checks and tenant-scoped joins index-backed without changing
-- authority, row visibility, or lifecycle semantics.

create index if not exists execution_plans_created_by_idx
  on public.execution_plans (created_by);
create index if not exists execution_plans_delegation_spec_idx
  on public.execution_plans (delegation_spec_id);
create index if not exists execution_plans_frozen_by_idx
  on public.execution_plans (frozen_by);

create index if not exists execution_plan_steps_plan_org_idx
  on public.execution_plan_steps (plan_id, organization_id);
create index if not exists execution_plan_steps_run_org_idx
  on public.execution_plan_steps (run_id, organization_id);
create index if not exists execution_plan_steps_created_by_idx
  on public.execution_plan_steps (created_by);

create index if not exists execution_attempts_plan_org_idx
  on public.execution_attempts (plan_id, organization_id);
create index if not exists execution_attempts_step_org_idx
  on public.execution_attempts (step_id, organization_id);
create index if not exists execution_attempts_run_org_idx
  on public.execution_attempts (run_id, organization_id);

create index if not exists execution_approval_plan_org_idx
  on public.execution_approval_requests (plan_id, organization_id);
create index if not exists execution_approval_step_org_idx
  on public.execution_approval_requests (step_id, organization_id);
create index if not exists execution_approval_requested_by_idx
  on public.execution_approval_requests (requested_by);
create index if not exists execution_approval_decided_by_idx
  on public.execution_approval_requests (decided_by);

create index if not exists execution_events_plan_org_idx
  on public.execution_events (plan_id, organization_id);
create index if not exists execution_events_step_org_idx
  on public.execution_events (step_id, organization_id);
create index if not exists execution_events_attempt_org_idx
  on public.execution_events (attempt_id, organization_id);
create index if not exists execution_plan_snapshots_legacy_organization_idx
  on public.execution_plan_snapshots_legacy (organization_id);
