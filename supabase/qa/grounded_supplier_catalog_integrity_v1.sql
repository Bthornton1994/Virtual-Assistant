-- QA-only dogfood fixture for Step 4A: Grounded Supplier & Catalog Integrity v1.
-- This file intentionally lives outside supabase/migrations so Production
-- migration runs cannot create the internal Grounded tenant.
--
-- Safe-use guard: requires the known Northline QA fixture and QA ops manager.
-- No supplier is asserted, no product is verified, and no execution attempt is
-- created. The first Gauntlet cycle remains in observation until the actual
-- Grounded repository baseline is attached.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_workstream_id uuid;
  v_spec_id uuid;
  v_cycle_id uuid;
begin
  if not exists (
    select 1 from public.organizations where slug = 'northline-consulting-test'
  ) then
    raise exception 'Refusing Grounded QA seed: Northline QA fixture not present';
  end if;

  select id
    into v_manager_id
    from auth.users
   where email = 'ops.manager@delegation-test.cloud'
   limit 1;

  if v_manager_id is null then
    raise exception 'Refusing Grounded QA seed: QA ops manager not present';
  end if;

  insert into public.organizations (name, slug, industry, company_size, timezone)
  values (
    'Grounded Internal QA',
    'grounded-internal-qa',
    'Sensory marketplace internal dogfood',
    'Internal',
    'America/Los_Angeles'
  )
  on conflict (slug) do update set name = excluded.name
  returning id into v_org_id;

  select id
    into v_workstream_id
    from public.workstreams
   where organization_id = v_org_id
     and name = 'Supplier & Catalog Integrity'
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
      'Supplier & Catalog Integrity',
      'Keep Grounded catalog safety, compliance, supplier, fulfillment, availability, shipping, and return information current and evidence-backed while preserving prototype/unverified status whenever evidence is incomplete.',
      'Baseline first; no customer-facing SLA until supplier and review latency are measured.',
      '["Run deterministic supplier/catalog audit","Collect primary supplier/manufacturer evidence","Prepare evidence-backed metadata corrections","Preserve unresolved items as unverified","Re-run full repository verification"]'::jsonb,
      '["production_ready_products","supplier_verified_products","compliance_verified_products","inventory_known_products","blocker_products","human_minutes_per_run","owner_minutes_per_run","qa_pass_rate","cost_per_verified_outcome"]'::jsonb,
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
      created_by
    ) values (
      v_org_id,
      v_workstream_id,
      1,
      'draft',
      'Produce a complete, reproducible Grounded supplier and catalog integrity assessment and prepare evidence-backed corrections without inventing supplier relationships, silently enabling commerce, or converting unknowns into facts.',
      '["Run deterministic supplier/catalog audit","Record exact repository commit and report counts","Every production-ready candidate has verified compliance evidence","Every production-ready candidate has reviewed supplier identity and source reference","Fulfillment mode and seller of record are explicit","Availability observation time and inventory state are explicit","Shipping behavior and return responsibility are explicit","Unsupported or ambiguous records remain unverified/candidate","No product is promoted to production-ready without the full contract","Repository changes stay on a dedicated branch","Lint, typecheck, unit tests, build, and E2E gate pass","Reviewable evidence, economics, and unresolved exceptions are attached"]'::jsonb,
      'Manual baseline in Step 4A; later scheduled/source-change triggers only after repeated evidence shows the workflow is reliable.',
      '["Grounded repository commit","Grounded static product catalog","product compliance/supply model","primary manufacturer documentation","supplier/partner product source","current availability observation","shipping policy","return policy","recall/compliance sources as applicable"]'::jsonb,
      'prepare_only',
      '["Read Grounded repository and public sources","Run deterministic integrity checks","Collect candidate supplier/manufacturer/compliance evidence","Prepare evidence-backed patches on a dedicated branch when explicitly requested","Never create or imply a supplier relationship","Never mark a product verified without the required evidence contract","Never merge or publish","Never enable Production commerce","Never place orders, hold inventory, spend money, send external messages, or change permissions"]'::jsonb,
      '["Human acceptance of supplier/compliance evidence","Human acceptance of any production-ready metadata change","Human merge decision","Owner decision for vendor relationship, pricing, fulfillment, or commercial-policy change"]'::jsonb,
      '["Deterministic audit output is attached","Repository SHA is recorded","Production-ready candidates pass compliance, supply provenance, fulfillment, seller-of-record, live inventory, shipping, and returns checks","No unknown value is treated as verified","Full repository verification passes","Independent adversarial review challenges evidence before a passing Outcome Receipt"]'::jsonb,
      '["Escalate conflicting supplier/manufacturer/compliance sources","Preserve unverified/candidate status when evidence is insufficient","Treat out-of-stock as non-production-ready","Stop before vendor contact, contracting, purchasing, publishing, merge, Production commerce, or permission changes"]'::jsonb,
      'Baseline measured before setting a customer-facing SLA.',
      '{"phase":"4A-foundation","track_human_minutes":true,"track_owner_minutes":true,"track_ai_cost_micros":true,"track_tool_cost_micros":true}'::jsonb,
      '{"tenant":"internal portfolio dogfood","public_sources_only":true,"no_credentials_in_evidence":true,"no_customer_data":true}'::jsonb,
      v_manager_id
    ) returning id into v_spec_id;

    update public.delegation_specs
       set status = 'active',
           activated_by = v_manager_id,
           activated_at = now()
     where id = v_spec_id;
  end if;

  insert into public.workstream_autonomy_profiles (
    organization_id,
    workstream_id,
    current_level,
    max_level,
    state,
    updated_by
  ) values (
    v_org_id,
    v_workstream_id,
    0,
    4,
    'active',
    v_manager_id
  )
  on conflict (organization_id, workstream_id) do nothing;

  select id
    into v_cycle_id
    from public.gauntlet_cycles
   where organization_id = v_org_id
     and workstream_id = v_workstream_id
   order by sequence asc
   limit 1;

  if v_cycle_id is null then
    insert into public.gauntlet_cycles (
      organization_id,
      workstream_id,
      delegation_spec_id,
      sequence,
      status,
      recurrence_mode,
      trigger_kind,
      trigger_ref,
      objective_snapshot,
      hypothesis,
      created_by
    ) values (
      v_org_id,
      v_workstream_id,
      v_spec_id,
      1,
      'observing',
      'recurring',
      'manual',
      'Bthornton1994/Grounded#34',
      'Produce a complete, reproducible Grounded supplier and catalog integrity assessment and prepare evidence-backed corrections without inventing supplier relationships, silently enabling commerce, or converting unknowns into facts.',
      'A fail-closed supplier/catalog baseline can identify exactly what Grounded does not yet know, and repeated evidence-backed runs can reduce those unknowns without increasing unsupported certainty or owner coordination.',
      v_manager_id
    ) returning id into v_cycle_id;
  end if;
end
$$;

select
  o.id as organization_id,
  w.id as workstream_id,
  ds.id as delegation_spec_id,
  ds.status as spec_status,
  ds.action_class,
  gc.id as gauntlet_cycle_id,
  gc.sequence,
  gc.status as cycle_status,
  ap.current_level,
  ap.state as autonomy_state
from public.organizations o
join public.workstreams w on w.organization_id = o.id
join public.delegation_specs ds
  on ds.organization_id = o.id
 and ds.workstream_id = w.id
 and ds.status = 'active'
join public.gauntlet_cycles gc
  on gc.delegation_spec_id = ds.id
 and gc.sequence = 1
join public.workstream_autonomy_profiles ap
  on ap.organization_id = o.id
 and ap.workstream_id = w.id
where o.slug = 'grounded-internal-qa';
