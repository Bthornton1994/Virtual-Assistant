-- QA fixture: native prepare-only public-web researcher.
-- Safe to re-run. No credentials. Shadow only. Does not change Runs 4-9 executor keys.

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'delegation-cloud-public-web-researcher-v1',
  'Delegation Cloud Public Web Researcher v1',
  'agent',
  'delegation-cloud',
  'researcher',
  'shadow',
  '[
    "inspect supplied catalog records",
    "fetch public https pages named in frozen records",
    "return CatalogEvidencePacketV1"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReadSuppliedCatalogRecords": true,
    "mayResearchPublicSources": true,
    "mayNavigatePublicWeb": false,
    "mayActivatePageElements": false,
    "mayTypeIntoPages": false,
    "mayReturnTypedEvidence": "catalog-evidence-packet/v1",
    "mayDecideVerified": false,
    "mayOwnAuthoritativeState": false
  }'::jsonb,
  '[
    "repository changes",
    "catalog changes",
    "external messages",
    "vendor contact",
    "purchases",
    "account creation",
    "permission changes",
    "production writes",
    "Skill creation or modification",
    "Routine creation or modification",
    "automations",
    "private-host access",
    "shell",
    "MCP"
  ]'::jsonb,
  '{
    "schemaVersion": "catalog-evidence-packet/v1",
    "protocolVersion": "delegation-cloud-public-web-prepare/v1",
    "runtimeProvider": "delegation-cloud",
    "network": "public-https-get-only",
    "expectedAuthorityReport": "all zero",
    "notes": "Does not replace hermes-loadout-researcher-v1 on frozen Runs 4-9. Opt-in via prepareExecutorKey."
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
