-- CS-1 QA fixture. Safe to re-run.
-- Matches PR #26 schema. Does not add a second migration.
-- Does not change frozen work-cell executor keys.
-- qualification_status: pending | qualified | suspended | expired
-- executor_profiles.status retains shadow for agent profiles.

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
from (
  values
    (
      'hermes-loadout-researcher-v1',
      'evidence_research',
      'pending',
      'step3d-v1',
      'Frozen Step 3D prepare. Run 5 is evidence, not promotion. Freeze key remains hermes-loadout-researcher-v1.'
    ),
    (
      'hermes-loadout-researcher-v1',
      'public_web_retrieval',
      'pending',
      'step3d-v1',
      'Public-source retrieval bounded by the frozen catalog evidence input contract.'
    ),
    (
      'grok-loadout-reviewer-v1',
      'independent_evidence_review',
      'pending',
      'step3d-v1',
      'Frozen Step 3D review. Run 5 reviewer hard gates passed; qualification stays pending.'
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
    )
) as pc(profile_key, capability_key, qualification_status, qualification_version, evidence_summary)
join public.executor_profiles ep on ep.key = pc.profile_key
join public.capabilities c on c.key = pc.capability_key
on conflict (executor_profile_id, capability_id) do update set
  qualification_status = excluded.qualification_status,
  qualification_version = excluded.qualification_version,
  evidence_summary = excluded.evidence_summary,
  suspended_at = null;
