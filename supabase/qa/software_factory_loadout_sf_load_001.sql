-- QA-only Software Factory Loadout proof overlay.
--
-- This fixture does not mutate Bthornton1994/Loadout, reopen PR #26, merge,
-- deploy, or create GitHub Issues. Apply only when Delegation Cloud QA setup
-- is explicitly authorized. Historical PR evidence is recorded by URL.

-- Intentionally empty of GitHub writes. The executable demonstration is
-- src/lib/__tests__/software-factory-run-manager.test.ts
-- ("Loadout SF-LOAD-001 proof workflow").

select
  'software_factory_run_management'::text as capability_key,
  'SF-LOAD-001'::text as task_id,
  'Bthornton1994/Loadout'::text as repository,
  'main'::text as base_branch,
  'https://github.com/Bthornton1994/Loadout/pull/26'::text as historical_pr_evidence,
  'merged_historically_unmodified'::text as evidence_disposition,
  false as merge_performed,
  false as repository_mutated,
  false as github_issues_write_available,
  'GitHub Issues write is not an approved connector; Workstream Run is the canonical board.'::text as board_limitation;
