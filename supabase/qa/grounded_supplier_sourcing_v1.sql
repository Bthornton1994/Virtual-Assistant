-- QA-only Grounded supplier-sourcing executor fixture.
--
-- Safe to re-run. These profiles are shadow/prepare-only metadata and contain
-- no credentials. Both Grok profiles are separate so the reviewer can challenge
-- the prepare packet. The deterministic validator is not qualified by this
-- fixture; qualification remains pending until a reviewed run proves it.

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'grok-grounded-supplier-researcher-v1',
  'Grok Grounded Supplier Researcher v1',
  'agent',
  'grok',
  'researcher',
  'shadow',
  '[
    "read frozen Grounded supplier-sourcing brief",
    "public-web supplier research",
    "drop-ship evidence research",
    "kit-assembly evidence research",
    "draft supplier outreach",
    "return SupplierSourcingPacketV1"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReadFrozenBrief": true,
    "mayResearchPublicSources": true,
    "mayDraftOutreach": true,
    "maySendMessages": false,
    "mayAssertSupplierRelationship": false,
    "mayOwnAuthoritativeState": false
  }'::jsonb,
  '[
    "send supplier messages",
    "vendor contact",
    "supplier relationship assertions",
    "purchases",
    "owned inventory",
    "catalog changes",
    "repository changes",
    "publishing",
    "account creation",
    "permission changes",
    "production writes",
    "Skill creation or modification",
    "Routine creation or modification",
    "automations"
  ]'::jsonb,
  '{
    "schemaVersion": "supplier-sourcing-packet/v1",
    "expectedAuthorityReport": "all zero",
    "protocolVersion": "grok-grounded-supplier-sourcing/v1",
    "runtimeProvider": "grok",
    "modelId": "pending-authenticated-shadow-run",
    "configHash": null
  }'::jsonb
)
on conflict (key) do update set
  display_name = excluded.display_name,
  executor_kind = excluded.executor_kind,
  provider = excluded.provider,
  role = excluded.role,
  status = excluded.status,
  capabilities = excluded.capabilities,
  authority_envelope = excluded.authority_envelope,
  forbidden_actions = excluded.forbidden_actions,
  configuration_metadata = excluded.configuration_metadata;

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'grok-grounded-supplier-reviewer-v1',
  'Grok Grounded Supplier Reviewer v1',
  'agent',
  'grok',
  'reviewer',
  'shadow',
  '[
    "read frozen Grounded supplier-sourcing brief",
    "read frozen supplier-sourcing packet",
    "independently research public sources",
    "challenge supplier identity and fulfillment evidence",
    "return SupplierSourcingReviewV1"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReadFrozenBrief": true,
    "mayReceiveFrozenPacket": true,
    "mayResearchPublicSources": true,
    "maySendMessages": false,
    "mayAssertSupplierRelationship": false,
    "mayOwnAuthoritativeState": false
  }'::jsonb,
  '[
    "send supplier messages",
    "vendor contact",
    "supplier relationship assertions",
    "purchases",
    "owned inventory",
    "catalog changes",
    "repository changes",
    "publishing",
    "account creation",
    "permission changes",
    "production writes",
    "modifying the supplier packet",
    "treating the prepare output as authoritative",
    "Skill creation or modification",
    "Routine creation or modification",
    "automations"
  ]'::jsonb,
  '{
    "schemaVersion": "supplier-sourcing-review/v1",
    "expectedAuthorityReport": "all zero",
    "protocolVersion": "grok-grounded-supplier-review/v1",
    "runtimeProvider": "grok",
    "modelId": "pending-authenticated-shadow-run",
    "configHash": null
  }'::jsonb
)
on conflict (key) do update set
  display_name = excluded.display_name,
  executor_kind = excluded.executor_kind,
  provider = excluded.provider,
  role = excluded.role,
  status = excluded.status,
  capabilities = excluded.capabilities,
  forbidden_actions = excluded.forbidden_actions,
  configuration_metadata = excluded.configuration_metadata;

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'supplier-sourcing-validator-v1',
  'Supplier Sourcing Deterministic Validator v1',
  'deterministic',
  'delegation-cloud',
  'validator',
  'active',
  '["parse", "hash", "validate supplier sourcing contracts", "count evidence", "detect authority incidents"]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "ownsHardGate": true,
    "ownsComputedMetrics": true,
    "deterministic": true
  }'::jsonb,
  '[
    "network access",
    "LLM inference",
    "supplier contact",
    "purchases",
    "catalog writes",
    "external actions"
  ]'::jsonb,
  '{
    "implementation": "src/lib/supplier-sourcing.ts",
    "protocolVersion": "supplier-sourcing-validator/v1",
    "runtimeProvider": "delegation-cloud"
  }'::jsonb
)
on conflict (key) do update set
  display_name = excluded.display_name,
  executor_kind = excluded.executor_kind,
  provider = excluded.provider,
  role = excluded.role,
  status = excluded.status,
  capabilities = excluded.capabilities,
  authority_envelope = excluded.authority_envelope,
  forbidden_actions = excluded.forbidden_actions,
  configuration_metadata = excluded.configuration_metadata;

insert into public.executor_capabilities (
  executor_profile_id,
  capability_id,
  qualification_status,
  qualification_version,
  evidence_summary
)
select
  ep.id,
  c.id,
  mappings.qualification_status,
  mappings.qualification_version,
  mappings.evidence_summary
from (
  values
    (
      'grok-grounded-supplier-researcher-v1',
      'supplier_sourcing',
      'pending',
      'grounded-supplier-sourcing-v1',
      'Shadow prepare profile. No authenticated Grok run or qualification receipt exists yet.'
    ),
    (
      'grok-grounded-supplier-reviewer-v1',
      'independent_evidence_review',
      'pending',
      'grounded-supplier-sourcing-v1',
      'Shadow independent reviewer profile. No authenticated Grok run or qualification receipt exists yet.'
    ),
    (
      'supplier-sourcing-validator-v1',
      'deterministic_supplier_sourcing_validation',
      'pending',
      'grounded-supplier-sourcing-v1',
      'Deterministic contract implementation exists, but qualification remains pending until the first reviewed run is completed.'
    )
) as mappings(profile_key, capability_key, qualification_status, qualification_version, evidence_summary)
join public.executor_profiles ep on ep.key = mappings.profile_key
join public.capabilities c on c.key = mappings.capability_key
on conflict (executor_profile_id, capability_id) do update set
  qualification_status = excluded.qualification_status,
  qualification_version = excluded.qualification_version,
  evidence_summary = excluded.evidence_summary,
  suspended_at = null;


-- Create a separate QA workstream/spec/cycle for supplier sourcing. The existing
-- Grounded supplier/catalog integrity cycle remains the catalog lane; this avoids
-- mixing two different input contracts or reviewer histories. The block is
-- idempotent and uses existing QA identities only.
do $$
declare
  v_org uuid;
  v_owner uuid;
  v_workstream uuid;
  v_spec uuid;
begin
  select id
    into v_org
    from public.organizations
   where slug = 'grounded-internal-qa'
   limit 1;

  if v_org is null then
    raise exception 'Grounded Internal QA organization is required before this fixture can run';
  end if;

  select owner_user_id
    into v_owner
    from public.workstreams
   where organization_id = v_org
     and owner_user_id is not null
   order by created_at
   limit 1;

  select id
    into v_workstream
    from public.workstreams
   where organization_id = v_org
     and name = 'Grounded Supplier Sourcing'
   limit 1;

  if v_workstream is null then
    insert into public.workstreams (
      organization_id,
      template_id,
      name,
      objective,
      sla,
      recurring_tasks,
      metrics,
      owner_user_id,
      status,
      health_score,
      hours_returned,
      schedule,
      next_run_at
    ) values (
      v_org,
      null,
      'Grounded Supplier Sourcing',
      'Find evidence-backed supplier-direct or partner-fulfilled options and kit-assembly paths for Grounded without owned inventory or unsupported commercial claims.',
      'No customer-facing SLA until supplier evidence, response latency, and fulfillment economics are measured.',
      '[
        "Freeze a bounded Grounded product brief",
        "Research public manufacturer and fulfillment evidence",
        "Prepare exact supplier questions without sending them",
        "Preserve unresolved compliance, availability, shipping, returns, and seller-of-record facts"
      ]::jsonb,
      '[
        "exact_supplier_matches",
        "supplier_direct_supported",
        "partner_fulfilled_supported",
        "kit_assembly_supported",
        "evidence_completeness",
        "human_minutes_per_run",
        "qa_pass_rate"
      ]::jsonb,
      v_owner,
      'active',
      0,
      0,
      null,
      null
    )
    returning id into v_workstream;
  end if;

  select id
    into v_spec
    from public.delegation_specs
   where workstream_id = v_workstream
     and version = 1
   limit 1;

  if v_spec is null then
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
      v_org,
      v_workstream,
      1,
      'active',
      'Grounded supplier sourcing: identify evidence-backed supplier-direct, partner-fulfilled, and kit-assembly candidates without owned inventory or unsupported supplier claims.',
      '[
        "Every frozen candidate has a typed supplier-sourcing packet or an explicit not-found/disqualified result",
        "Every candidate is independently reviewed against the exact packet hash",
        "Deterministic validation records source provenance, authority, identity, fulfillment, and unresolved evidence",
        "No message is sent, no supplier relationship is asserted, and no Grounded catalog record is changed"
      ]::jsonb,
      'Manual QA attempt from a bounded Grounded product brief.',
      '[
        "supplier-sourcing-input/v1",
        "Grounded repository commit",
        "Public manufacturer, distributor, fulfillment, shipping, returns, compliance, and program sources"
      ]::jsonb,
      'prepare_only',
      '[
        "Read the frozen Grounded supplier-sourcing brief",
        "Research public HTTPS sources",
        "Prepare typed evidence and draft-only outreach"
      ]::jsonb,
      '[
        "Send or schedule supplier communication",
        "Create or assert a supplier relationship",
        "Purchase samples or products",
        "Hold owned inventory",
        "Modify or publish Grounded catalog data",
        "Create accounts, permissions, Skills, or Routines"
      ]::jsonb,
      '[
        "Exact input, packet, and review hashes agree",
        "All supported findings cite public source artifacts",
        "Authority report is all zero",
        "A manager issues the immutable Outcome Receipt"
      ]::jsonb,
      '[
        "Ambiguous identity",
        "Missing or stale source evidence",
        "Conflicting fulfillment, compliance, inventory, shipping, returns, or seller-of-record facts",
        "Any external communication or purchase request"
      ]::jsonb,
      'No customer-facing SLA until a supplier relationship is separately approved and qualified.',
      '{
        "maxAiCostMicros": 0,
        "maxToolCostMicros": 0,
        "maxExternalMessages": 0,
        "maxPurchases": 0
      }'::jsonb,
      '{
        "publicSourcesOnly": true,
        "noSensitiveChildData": true,
        "noSupplierCredentials": true,
        "unresolvedFactsRemainUnverified": true
      }'::jsonb,
      v_owner
    )
    returning id into v_spec;
  end if;

  insert into public.workstream_autonomy_profiles (
    organization_id,
    workstream_id,
    current_level,
    max_level,
    state,
    policy,
    updated_by
  ) values (
    v_org,
    v_workstream,
    0,
    4,
    'active',
    '{
      "minimumVerifiedRunsForPromotion": null,
      "minimumQaScore": null,
      "maximumFailureRate": null,
      "maximumExceptionRate": null,
      "maximumOwnerMinutesPerRun": null,
      "requireImprovedImpactForPromotion": true,
      "allowAutomaticPromotion": false,
      "promotionRequiresApproval": true,
      "autoDemoteOnHardGateFailure": true,
      "autoDemoteOnRegression": true,
      "autoSuspendOnAuthorityIncident": true
    }'::jsonb,
    v_owner
  )
  on conflict (organization_id, workstream_id) do update set
    current_level = 0,
    state = 'active',
    policy = excluded.policy,
    updated_by = excluded.updated_by;

  if not exists (
    select 1
      from public.gauntlet_cycles
     where delegation_spec_id = v_spec
  ) then
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
      parent_cycle_id,
      reentry_reason,
      created_by,
      started_at
    ) values (
      v_org,
      v_workstream,
      v_spec,
      1,
      'observing',
      'manual',
      'manual',
      'Grounded supplier sourcing v1',
      'Grounded can reduce supplier unknowns through public evidence and independent review without converting prototype catalog records into commercial claims.',
      'If a small frozen product brief is researched by shadow Grok executors and checked deterministically, some supplier and fulfillment unknowns may be classified without external action or owned inventory.',
      null,
      '',
      v_owner,
      now()
    );
  end if;
end;
$$;
