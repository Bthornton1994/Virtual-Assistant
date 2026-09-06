-- Preserve the original request-scoped plan snapshot relation before Execution Runtime v1
-- claims the public.execution_plans name for its durable runtime plan.
--
-- The initial application schema (0004_production_auth) created
-- public.execution_plans(request_id, organization_id, plan, created_at). Runtime v1
-- is a different contract keyed by id/run/step state. Renaming the legacy
-- relation preserves existing QA data and keeps the two contracts explicit.
do $$
begin
  if to_regclass('public.execution_plans') is null then
    return;
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'execution_plans'
      and c.relkind <> 'r'
  ) then
    raise exception 'public.execution_plans exists but is not a table; refusing runtime compatibility rename';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'execution_plans'
      and column_name = 'request_id'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'execution_plans'
      and column_name = 'plan'
  )
  and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'execution_plans'
      and column_name = 'run_id'
  ) then
    if to_regclass('public.execution_plan_snapshots_legacy') is not null then
      raise exception 'Both legacy execution plan relations already exist; refusing to merge or overwrite data';
    end if;

    alter table public.execution_plans
      rename to execution_plan_snapshots_legacy;

    comment on table public.execution_plan_snapshots_legacy is
      'Legacy request-scoped plan snapshots retained for compatibility. Execution Runtime v1 uses public.execution_plans.';

  create index if not exists execution_plan_snapshots_legacy_organization_idx
    on public.execution_plan_snapshots_legacy (organization_id);
  end if;
end;
$$;
