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
