-- QA-only Phase 0 fixture for the bounded OpenBot shadow pilot.
--
-- Safe to re-run. This registers non-sensitive capability and provenance metadata
-- only. It grants no authority, changes no run, and starts no executor.
--
-- Phase 0 does not apply this file to any environment.

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'openbot-governed-research-shadow-v1',
  'OpenBot Governed Research Shadow v1',
  'agent',
  'openbot',
  'researcher',
  'shadow',
  '[
    "receive frozen supplied inputs",
    "navigate and read public web pages through a governed browser",
    "return candidate CatalogEvidencePacketV1",
    "return adapter trace, provenance, authority report, and economics"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReadSuppliedCatalogRecords": true,
    "mayResearchPublicSources": true,
    "mayNavigatePublicWeb": true,
    "mayReadPublicWeb": true,
    "mayActivatePageElements": false,
    "mayTypeIntoPages": false,
    "mayUseFilesystem": false,
    "mayUseShell": false,
    "mayUseMcp": false,
    "mayRequestHumanSecrets": false,
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
    "browser activation or clicking",
    "typing into browser pages",
    "workspace file listing",
    "workspace file reads",
    "workspace file writes",
    "shell commands",
    "MCP tool calls",
    "human secret entry",
    "customer or Production credentials",
    "customer data",
    "treating CopilotKit state as authoritative",
    "editing or retrying Runs 4 through 9",
    "same-attempt repair or resubmission"
  ]'::jsonb,
  '{
    "schemaVersion": "catalog-evidence-packet/v1",
    "adapterContractVersion": "openbot-shadow-adapter/v1",
    "adapterContractPath": "experiments/openbot-shadow/adapter-contract.schema.json",
    "expectedAuthorityReport": "all zero",
    "upstreamRepository": "https://github.com/CopilotKit/OpenBot",
    "upstreamVersion": "v0.0.4",
    "upstreamCommit": "6826e11afd52f03c30af2d873203792acad95f63",
    "deploymentMode": "external-postgres-loopback",
    "policyMode": "enforce",
    "policyPath": "experiments/openbot-shadow/policy.json",
    "policyHash": "06759cfc784d9b00d631370063f40946e8cac01bd4df72c1d4955bd9ab38216a",
    "runtimeProvider": "openbot",
    "computerRuntime": "not-yet-selected-for-local-lab",
    "modelProvider": "not-yet-selected-for-local-lab",
    "modelId": "not-yet-selected-for-local-lab",
    "configHash": null,
    "mcpEnabled": false,
    "shellEnabled": false,
    "fileAccessEnabled": false,
    "humanSecretEntryEnabled": false,
    "customerCredentialsPresent": false,
    "customerDataPresent": false,
    "copilotKitStateAuthoritative": false,
    "eligibleForRuns4To9": false,
    "notes": "QA-only shadow declaration. An assignment must replace every placeholder with a frozen configuration snapshot before a local lab run."
  }'::jsonb
)
on conflict (key) do update set
  display_name = excluded.display_name,
  executor_kind = excluded.executor_kind,
  provider = excluded.provider,
  role = excluded.role,
  -- Re-running the fixture must restore shadow status. Qualification is earned
  -- through evidence and cannot survive as an unreviewed manual promotion.
  status = excluded.status,
  capabilities = excluded.capabilities,
  authority_envelope = excluded.authority_envelope,
  forbidden_actions = excluded.forbidden_actions,
  configuration_metadata = excluded.configuration_metadata;
