-- QA-only first observation for Grounded Supplier & Catalog Integrity v1.
-- Run only after grounded_supplier_catalog_integrity_v1.sql has created the
-- internal QA tenant and observation cycle.
--
-- This records what the repository proves. It does not verify a supplier,
-- change a product, create a Workstream Run, or advance the Gauntlet cycle.

do $$
declare
  v_manager_id uuid;
  v_org_id uuid;
  v_cycle_id uuid;
begin
  select id
    into v_manager_id
    from auth.users
   where email = 'ops.manager@delegation-test.cloud'
   limit 1;

  select id
    into v_org_id
    from public.organizations
   where slug = 'grounded-internal-qa'
   limit 1;

  if v_manager_id is null or v_org_id is null then
    raise exception 'Refusing Grounded baseline seed: QA workstream fixture is not present';
  end if;

  select gc.id
    into v_cycle_id
    from public.gauntlet_cycles gc
    join public.workstreams w on w.id = gc.workstream_id
   where gc.organization_id = v_org_id
     and w.name = 'Supplier & Catalog Integrity'
     and gc.sequence = 1
     and gc.status = 'observing'
   limit 1;

  if v_cycle_id is null then
    raise exception 'Refusing Grounded baseline seed: observing cycle 1 is not present';
  end if;

  if not exists (
    select 1
      from public.gauntlet_observations
     where cycle_id = v_cycle_id
       and signal_type = 'repository_baseline'
       and source_uri = 'https://github.com/Bthornton1994/Grounded/pull/34'
  ) then
    insert into public.gauntlet_observations (
      organization_id,
      cycle_id,
      signal_type,
      summary,
      source_uri,
      payload,
      created_by
    ) values (
      v_org_id,
      v_cycle_id,
      'repository_baseline',
      'Grounded currently contains 36 catalog products. None are compliance-verified, supplier-verified, marked verified-for-sale, associated with known live inventory, or production-ready. The catalog therefore remains fail-closed. Unknown/unverified prototype records are review work, not integrity contradictions; blocker status is reserved for records that claim commercial readiness while required evidence is missing, invalid, expired, or out of stock.',
      'https://github.com/Bthornton1994/Grounded/pull/34',
      jsonb_build_object(
        'repository', 'Bthornton1994/Grounded',
        'branch', 'agent/grounded-supplier-catalog-integrity-v1',
        'head_sha', '837487cd678c85b65dc84d9b9e1c0ac5479bb512',
        'audit', 'npm run audit:catalog',
        'total_products', 36,
        'compliance_verified', 0,
        'supplier_verified', 0,
        'commerce_marked_verified_for_sale', 0,
        'inventory_known', 0,
        'production_ready', 0,
        'blocker_products', 0,
        'issue_counts', jsonb_build_object(
          'compliance_unverified', 36,
          'supplier_unverified', 36,
          'supplier_name_missing', 0,
          'supplier_source_missing', 0,
          'fulfillment_unknown', 0,
          'seller_of_record_unknown', 0,
          'availability_check_missing', 0,
          'availability_valid_until_missing', 0,
          'availability_invalid_or_expired', 0,
          'shipping_summary_missing', 0,
          'return_responsibility_missing', 0,
          'inventory_unknown', 36,
          'inventory_out_of_stock', 0,
          'verified_sale_contract_incomplete', 0
        ),
        'interpretation', 'The first Step 4 objective is evidence collection and truthful classification, not maximizing verified counts. Zero production-ready products is the correct baseline while supplier/compliance evidence is absent.',
        'authority', jsonb_build_object(
          'action_class', 'prepare_only',
          'no_supplier_assertion', true,
          'no_product_promotion', true,
          'no_external_contact', true,
          'no_purchase', true,
          'no_merge', true,
          'no_production_commerce_change', true
        )
      ),
      v_manager_id
    );
  end if;
end
$$;

select
  go.id as observation_id,
  go.cycle_id,
  go.signal_type,
  go.summary,
  go.source_uri,
  go.payload
from public.gauntlet_observations go
join public.gauntlet_cycles gc on gc.id = go.cycle_id
join public.organizations o on o.id = gc.organization_id
where o.slug = 'grounded-internal-qa'
  and go.signal_type = 'repository_baseline'
order by go.created_at asc;
