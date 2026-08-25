-- Capability Sovereignty CS-1: native capability vocabulary and executor mapping.
--
-- This is additive registry metadata only. It does not change the frozen Step 3D
-- protocol, select an executor, or grant authority. Executor profiles remain the
-- compatibility layer while capability qualification is introduced.

create table public.capabilities (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  display_name text not null,
  description text not null default '',
  risk_class text not null check (risk_class in ('low', 'medium', 'high', 'critical')),
  input_contract_versions jsonb not null default '[]'::jsonb,
  output_contract_versions jsonb not null default '[]'::jsonb,
  verification_contract jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'active', 'suspended', 'retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index capabilities_status_key_idx on public.capabilities (status, key);

create table public.executor_capabilities (
  executor_profile_id uuid not null references public.executor_profiles(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete restrict,
  qualification_status text not null default 'pending'
    check (qualification_status in ('pending', 'qualified', 'suspended', 'expired')),
  qualification_version text not null default 'v1',
  evidence_summary text not null default '',
  effective_from timestamptz not null default now(),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (executor_profile_id, capability_id),
  check ((qualification_status = 'suspended') = (suspended_at is not null))
);

create index executor_capabilities_capability_idx
  on public.executor_capabilities (capability_id, qualification_status);
create index executor_capabilities_qualified_idx
  on public.executor_capabilities (capability_id, executor_profile_id)
  where qualification_status = 'qualified';

create trigger trg_capabilities_updated
  before update on public.capabilities
  for each row execute function public.set_updated_at();

create trigger trg_executor_capabilities_updated
  before update on public.executor_capabilities
  for each row execute function public.set_updated_at();

alter table public.capabilities enable row level security;
alter table public.executor_capabilities enable row level security;

grant select, insert, update on public.capabilities to authenticated;
grant select, insert, update on public.executor_capabilities to authenticated;
grant all on public.capabilities, public.executor_capabilities to service_role;

-- Capability and qualification metadata is internal staffing/governance detail.
create policy capabilities_select on public.capabilities
  for select to authenticated
  using (public.is_platform_staff());
create policy capabilities_insert on public.capabilities
  for insert to authenticated
  with check (public.is_ops_manager());
create policy capabilities_update on public.capabilities
  for update to authenticated
  using (public.is_ops_manager())
  with check (public.is_ops_manager());

create policy executor_capabilities_select on public.executor_capabilities
  for select to authenticated
  using (public.is_platform_staff());
create policy executor_capabilities_insert on public.executor_capabilities
  for insert to authenticated
  with check (public.is_ops_manager());
create policy executor_capabilities_update on public.executor_capabilities
  for update to authenticated
  using (public.is_ops_manager())
  with check (public.is_ops_manager());

-- Seed only the small vocabulary required by the current proving ground and the
-- approved next phases. Unproven capabilities remain proposed and have no
-- qualified implementation.
insert into public.capabilities (
  key,
  display_name,
  description,
  risk_class,
  input_contract_versions,
  output_contract_versions,
  verification_contract,
  status
) values
  (
    'evidence_research',
    'Evidence research',
    'Prepare source-backed candidate evidence from frozen, supplied inputs.',
    'medium',
    '["catalog-evidence-input/v1"]'::jsonb,
    '["catalog-evidence-packet/v1"]'::jsonb,
    '{"kind":"deterministic","implementation":"catalog-evidence-validator/v1"}'::jsonb,
    'active'
  ),
  (
    'independent_evidence_review',
    'Independent evidence review',
    'Challenge a prepared evidence artifact without modifying the reviewed packet.',
    'high',
    '["catalog-evidence-input/v1","catalog-evidence-packet/v1"]'::jsonb,
    '["catalog-evidence-review/v1"]'::jsonb,
    '{"kind":"deterministic","implementation":"catalog-evidence-validator/v1"}'::jsonb,
    'active'
  ),
  (
    'deterministic_catalog_validation',
    'Deterministic catalog validation',
    'Parse, hash, count, and apply the catalog evidence hard gate.',
    'high',
    '["catalog-evidence-packet/v1","catalog-evidence-review/v1"]'::jsonb,
    '["catalog-evidence-validation/v1"]'::jsonb,
    '{"kind":"native","implementation":"catalog-evidence-validator/v1"}'::jsonb,
    'active'
  ),
  (
    'public_web_retrieval',
    'Public web retrieval',
    'Retrieve public HTTPS sources named by a frozen assignment and preserve provenance.',
    'medium',
    '["catalog-evidence-input/v1"]'::jsonb,
    '["catalog-evidence-packet/v1"]'::jsonb,
    '{"kind":"provenance","required":["sourceUrl","accessedAt","rawArtifactHash"]}'::jsonb,
    'active'
  ),
  (
    'software_repository_read',
    'Software repository read',
    'Inspect a source repository without modifying it.',
    'low',
    '[]'::jsonb,
    '[]'::jsonb,
    '{"kind":"human_or_deterministic","implementation":"repository-review-v1"}'::jsonb,
    'proposed'
  ),
  (
    'software_change_prepare',
    'Software change prepare',
    'Prepare a bounded source change for review without merging or deploying it.',
    'medium',
    '[]'::jsonb,
    '[]'::jsonb,
    '{"kind":"independent-review","implementation":"repository-review-v1"}'::jsonb,
    'proposed'
  ),
  (
    'software_change_verify',
    'Software change verify',
    'Verify a proposed source change with deterministic checks and independent review.',
    'high',
    '[]'::jsonb,
    '[]'::jsonb,
    '{"kind":"deterministic","implementation":"ci-and-review-v1"}'::jsonb,
    'proposed'
  ),
  (
    'structured_data_transform',
    'Structured data transform',
    'Transform structured data under a versioned input and output contract.',
    'low',
    '[]'::jsonb,
    '[]'::jsonb,
    '{"kind":"deterministic","implementation":"schema-validator-v1"}'::jsonb,
    'proposed'
  ),
  (
    'business_research',
    'Business research',
    'Prepare source-backed business research with explicit uncertainty and provenance.',
    'medium',
    '[]'::jsonb,
    '[]'::jsonb,
    '{"kind":"independent-review","implementation":"research-review-v1"}'::jsonb,
    'proposed'
  ),
  (
    'specialist_escalation',
    'Specialist escalation',
    'Route work that exceeds the current authority, evidence, or domain boundary to an accountable specialist.',
    'high',
    '[]'::jsonb,
    '[]'::jsonb,
    '{"kind":"human","implementation":"specialist-acceptance-v1"}'::jsonb,
    'proposed'
  )
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  risk_class = excluded.risk_class,
  input_contract_versions = excluded.input_contract_versions,
  output_contract_versions = excluded.output_contract_versions,
  verification_contract = excluded.verification_contract;

-- Preserve the current named executor compatibility layer while giving the
-- proven registry a capability-shaped query surface. Agent profiles remain
-- pending until qualification evidence says otherwise.
with profile_capability(profile_key, capability_key, qualification_status, qualification_version, evidence_summary) as (
  values
    (
      'hermes-loadout-researcher-v1',
      'evidence_research',
      'pending',
      'step3d-v1',
      'Frozen Step 3D prepare implementation; Runs 4-5 are evidence, not a promotion.'
    ),
    (
      'hermes-loadout-researcher-v1',
      'public_web_retrieval',
      'pending',
      'step3d-v1',
      'Public-source retrieval is bounded by the frozen catalog evidence input contract.'
    ),
    (
      'grok-loadout-reviewer-v1',
      'independent_evidence_review',
      'pending',
      'step3d-v1',
      'Frozen Step 3D review implementation; Runs 4-5 are evidence, not a promotion.'
    ),
    (
      'grok-loadout-reviewer-v1',
      'public_web_retrieval',
      'pending',
      'step3d-v1',
      'Review research remains a prepare-only implementation detail.'
    ),
    (
      'catalog-evidence-validator-v1',
      'deterministic_catalog_validation',
      'qualified',
      'catalog-evidence-validator/v1',
      'Native deterministic validator owns parsing, hashes, counts, and the hard gate.'
    ),
    (
      'delegation-cloud-public-web-researcher-v1',
      'evidence_research',
      'pending',
      'public-web-prepare-v1',
      'Optional native prepare implementation; qualification is not implied by registration.'
    ),
    (
      'delegation-cloud-public-web-researcher-v1',
      'public_web_retrieval',
      'pending',
      'public-web-prepare-v1',
      'Optional native prepare implementation; qualification is not implied by registration.'
    )
)
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
  pc.qualification_status,
  pc.qualification_version,
  pc.evidence_summary
from profile_capability pc
join public.executor_profiles ep on ep.key = pc.profile_key
join public.capabilities c on c.key = pc.capability_key
on conflict (executor_profile_id, capability_id) do nothing;
