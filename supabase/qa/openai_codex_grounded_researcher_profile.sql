-- QA fixture: Codex prepare-only catalog evidence researcher for the Grounded portability run.
-- Safe to re-run. No credentials. Shadow only. No Production deployment or writes.
--
-- This profile identifies the executor that actually performs the prepare phase.
-- It reuses catalog-evidence-packet/v1 and adds no authority to the Delegation Spec.

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'openai-codex-grounded-researcher-v1',
  'OpenAI Codex Grounded Catalog Researcher v1',
  'agent',
  'openai',
  'researcher',
  'shadow',
  '[
    "inspect supplied catalog records",
    "research public primary sources",
    "research manufacturer, compliance, supplier, availability, shipping, and return evidence",
    "return CatalogEvidencePacketV1"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReadSuppliedCatalogRecords": true,
    "mayResearchPublicSources": true,
    "mayNavigatePublicWeb": true,
    "mayActivatePageElements": false,
    "mayTypeIntoPages": false,
    "mayReturnTypedEvidence": "catalog-evidence-packet/v1",
    "mayDecideVerified": false,
    "mayOwnAuthoritativeState": false
  }'::jsonb,
  '[
    "catalog changes",
    "product promotion",
    "supplier assertions",
    "external messages",
    "supplier or vendor contact",
    "purchases",
    "account creation",
    "permission changes",
    "production writes",
    "repository changes during the governed prepare phase",
    "Skill creation or modification",
    "Routine creation or modification",
    "automations"
  ]'::jsonb,
  '{
    "schemaVersion": "catalog-evidence-packet/v1",
    "protocolVersion": "openai-codex-grounded-catalog-prepare/v1",
    "runtimeProvider": "openai",
    "runtimeSurface": "chatgpt-work-mode",
    "modelFamily": "gpt-5",
    "configurationHash": null,
    "network": "public-web-search-and-read",
    "expectedAuthorityReport": "all zero",
    "notes": "QA-only Grounded portability experiment. The executor produces untrusted evidence; deterministic validation and independent review retain all gate authority."
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
