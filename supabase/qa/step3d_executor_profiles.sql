-- Step 3D QA fixture: register the three work-cell executor profiles.
--
-- Safe to re-run. Registers capability and policy metadata only:
--   * no API keys, tokens, or credentials of any kind;
--   * no authority grant. A profile records what an executor may attempt; the
--     Delegation Spec remains the authority ceiling and the deterministic gate
--     remains the completion gate.
--
-- Both agent profiles are registered in `shadow` status. Shadow means prepare and
-- review only: they produce evidence for human review, they do not decide that a
-- claim is verified and they hold no write, publish, purchase, messaging, or
-- permission authority.

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'hermes-loadout-researcher-v1',
  'Hermes Catalog Evidence Researcher v1',
  'agent',
  'hermes',
  'researcher',
  'shadow',
  '[
    "inspect supplied catalog records",
    "public-web research",
    "manufacturer research",
    "federation research",
    "return CatalogEvidencePacketV1"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReadSuppliedCatalogRecords": true,
    "mayResearchPublicSources": true,
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
    "automations"
  ]'::jsonb,
  '{
    "schemaVersion": "catalog-evidence-packet/v1",
    "expectedAuthorityReport": "all zero",
    "notes": "Any non-zero authority-report value is a deterministic hard failure during Step 3 shadow execution."
  }'::jsonb
)
on conflict (key) do update set
  display_name = excluded.display_name,
  executor_kind = excluded.executor_kind,
  provider = excluded.provider,
  role = excluded.role,
  -- Re-running the authoritative QA fixture must restore shadow status, so a
  -- manual promotion cannot silently survive a fixture re-run.
  status = excluded.status,
  capabilities = excluded.capabilities,
  authority_envelope = excluded.authority_envelope,
  forbidden_actions = excluded.forbidden_actions,
  configuration_metadata = excluded.configuration_metadata;

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'grok-loadout-reviewer-v1',
  'Grok Independent Evidence Reviewer v1',
  'agent',
  'grok',
  'reviewer',
  'shadow',
  '[
    "receive original catalog input",
    "receive frozen Hermes packet",
    "independently research public sources",
    "challenge Hermes findings",
    "return CatalogEvidenceReviewV1"
  ]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "mayReceiveFrozenPacket": true,
    "mayResearchPublicSources": true,
    "mayReturnTypedEvidence": "catalog-evidence-review/v1",
    "mayModifyReviewedPacket": false,
    "mayTreatPeerOutputAsAuthoritative": false,
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
    "modifying the Hermes evidence packet",
    "treating Hermes output as an authoritative source"
  ]'::jsonb,
  '{
    "schemaVersion": "catalog-evidence-review/v1",
    "expectedAuthorityReport": "all zero",
    "notes": "The review is a separate immutable artifact bound to the Hermes packet by content hash. It never edits the packet."
  }'::jsonb
)
on conflict (key) do update set
  display_name = excluded.display_name,
  executor_kind = excluded.executor_kind,
  provider = excluded.provider,
  role = excluded.role,
  -- Re-running the authoritative QA fixture must restore shadow status, so a
  -- manual promotion cannot silently survive a fixture re-run.
  status = excluded.status,
  capabilities = excluded.capabilities,
  authority_envelope = excluded.authority_envelope,
  forbidden_actions = excluded.forbidden_actions,
  configuration_metadata = excluded.configuration_metadata;

insert into public.executor_profiles (
  key, display_name, executor_kind, provider, role, status,
  capabilities, authority_envelope, forbidden_actions, configuration_metadata
) values (
  'catalog-evidence-validator-v1',
  'Catalog Evidence Deterministic Validator v1',
  'deterministic',
  'delegation-cloud',
  'validator',
  'active',
  '["parse", "validate", "hash", "count", "calculate gates"]'::jsonb,
  '{
    "actionClass": "prepare_only",
    "ownsHardGate": true,
    "ownsComputedMetrics": true,
    "deterministic": true
  }'::jsonb,
  '["network access", "LLM inference", "catalog writes", "external actions"]'::jsonb,
  '{
    "implementation": "src/lib/catalog-evidence-validator.ts",
    "notes": "The only executor permitted to own the hard gate and the metric counts. Same input always yields the same result."
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
