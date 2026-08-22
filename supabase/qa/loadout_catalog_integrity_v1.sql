-- QA-only dogfood fixture for Step 3A.
-- This file is intentionally outside supabase/migrations so Production schema
-- migration runs do not create an internal Loadout tenant.
--
-- Safe-use guard: this script requires the known Northline QA fixture and the
-- QA ops-manager account. It is not intended for Production.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
begin
  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing Loadout QA seed: Northline QA fixture not present';
  end if;

  select id
    into v_manager_id
    from auth.users
   where email = 'ops.manager@delegation-test.cloud'
   limit 1;

  if v_manager_id is null then
    raise exception 'Refusing Loadout QA seed: QA ops manager not present';
  end if;

  insert into public.organizations (name, slug, industry, company_size, timezone)
  values ('Loadout Internal QA', 'loadout-internal-qa', 'Powerlifting equipment marketplace', 'Internal dogfood', 'America/Los_Angeles')
  on conflict (slug) do update set name = excluded.name
  returning id into v_org_id;

  select id
    into v_workstream_id
    from public.workstreams
   where organization_id = v_org_id
     and name = 'Catalog Integrity'
   order by created_at asc
   limit 1;

  if v_workstream_id is null then
    insert into public.workstreams (
      organization_id,
      name,
      objective,
      sla,
      recurring_tasks,
      metrics,
      owner_user_id,
      status,
      health_score,
      hours_returned
    ) values (
      v_org_id,
      'Catalog Integrity',
      'Keep Loadout catalog claims explicitly classified by evidence status and prepare evidence-backed corrections without silently changing commercial or federation claims.',
      'Baseline on demand; later cadence only after manual proof',
      '["Generate deterministic integrity report","Review unsupported/stale claims","Collect exact source evidence","Prepare proposed catalog changes","Submit for independent verification"]'::jsonb,
      '["verified claim count","stale claim count","unverified claim count","demo-only claim count","commercial-ready product count","human minutes per run","owner minutes per run","QA pass rate"]'::jsonb,
      v_manager_id,
      'active',
      70,
      0
    ) returning id into v_workstream_id;
  end if;

  select id
    into v_spec_id
    from public.delegation_specs
   where organization_id = v_org_id
     and workstream_id = v_workstream_id
     and version = 1
   limit 1;

  if v_spec_id is null then
    insert into public.delegation_specs (
      organization_id,
      workstream_id,
      version,
      status,
      objective,
      definition_of_done,
      trigger_description,
      required_inputs,
      action_class,
      authority_rules,
      approval_points,
      verification_rules,
      exception_policy,
      sla,
      economic_envelope,
      data_policy,
      created_by,
      activated_by,
      activated_at
    ) values (
      v_org_id,
      v_workstream_id,
      1,
      'active',
      'Produce a complete, reproducible integrity assessment of every material catalog claim and prepare evidence-backed corrections while preserving explicit unknown/demo status when evidence is absent.',
      '["Every current product is included in the report","Every tracked price, approval, specification, rating, and performance claim receives exactly one effective evidence status","Unsupported ratings and performance scores remain demo-only","No claim is treated as verified without a named source URL and observation date inside its freshness window","No blocker-level integrity issue remains unresolved","A machine-readable report is preserved as execution evidence","No catalog claim is changed, merged, published, or commercialized by this v1 workstream"]'::jsonb,
      'Manual on-demand baseline. Do not schedule until at least two reviewed runs establish stable behavior.',
      '["Loadout main/PR source tree","src/data/products.ts","src/data/catalog-evidence.ts","Loadout VISION.md","Catalog Integrity deterministic audit output","GitHub CI result"]'::jsonb,
      'prepare_only',
      '["Read Loadout repository and public sources","Run deterministic catalog-integrity checks","Classify existing claims by evidence status","Collect and attach source evidence","Prepare proposed evidence-ledger or catalog patches on a branch","Create draft issues or pull requests when explicitly requested"]'::jsonb,
      '["Any change to published product claims","Any federation approval assertion becoming authoritative","Any price becoming a live commercial quote","Any conversion of demo ratings/performance scores into factual claims","Merge to main","GitHub Pages publication","Affiliate/vendor relationship change","External communication or spending"]'::jsonb,
      '["Independent QA must inspect the machine-readable integrity report","A passing run requires at least one evidence artifact","Report counts must reconcile with the current product catalog","Verified records must satisfy source/date/freshness rules","Current reference-catalog disclosures must remain intact","Repository verification gate must pass"]'::jsonb,
      '["Conflicting manufacturer/federation sources","Product identity is ambiguous","Source cannot be tied to the exact model/variant","Federation rule or approved-equipment status is unclear","A source is older than the workstream freshness threshold","The deterministic audit emits a blocker","A proposed change would alter commerce, affiliate terms, or product positioning"]'::jsonb,
      'Complete baseline assessment in one reviewed work session; no autonomous cadence in v1',
      '{"record_human_minutes":true,"record_owner_minutes":true,"record_ai_cost_micros":true,"record_tool_cost_micros":true,"promotion_requires_declining_coordination":true}'::jsonb,
      '{"retain_source_urls":true,"retain_observed_dates":true,"retain_report_hash":true,"no_cross_tenant_confidential_learning":true}'::jsonb,
      v_manager_id,
      v_manager_id,
      now()
    ) returning id into v_spec_id;
  end if;

  if not exists (
    select 1
      from public.workstream_runs
     where delegation_spec_id = v_spec_id
       and status in ('planned', 'running', 'awaiting_verification')
  ) then
    insert into public.workstream_runs (
      organization_id,
      workstream_id,
      delegation_spec_id,
      status,
      initiated_by,
      executor_summary,
      notes
    ) values (
      v_org_id,
      v_workstream_id,
      v_spec_id,
      'planned',
      v_manager_id,
      '{"mode":"human_baseline","agent_authority":"none","repository":"Bthornton1994/Loadout","workstream":"Catalog Integrity v1"}'::jsonb,
      'Step 3A baseline. Remain planned until the Loadout verification artifact exists; then execute, attach evidence, record actual economics, and independently verify.'
    );
  end if;
end
$$;
