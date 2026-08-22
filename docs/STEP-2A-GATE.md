# Step 2A Authenticated Golden-Path Gate

Status: **PASS**

Date: 2026-08-22

Environment: dedicated QA Supabase project only (`qbvmtgaphvpwpwemplje`).

## Purpose

Close the remaining release gate for the Step 2 execution primitives by proving the full execution contract through real authenticated user sessions and Row Level Security rather than service-role or direct SQL writes.

## Golden path proven

The QA harness authenticated as the existing test roles and verified:

1. temporary QA credentials could be issued through Supabase Auth Admin;
2. manager, operator, Northline client-admin, and Harbor client-admin sessions authenticated as the expected users;
3. the manager session resolved to `ops_manager`;
4. a Northline Delegation Spec was created in `draft`;
5. a non-manager operator could not activate that spec;
6. the manager could activate it;
7. a Workstream Run was created in `planned`;
8. the run transitioned to `running` and received `started_at`;
9. evidence was appended while running and received a database-generated 64-character SHA-256 hash;
10. measured economics were persisted and the run transitioned to `awaiting_verification`;
11. the non-manager operator could not issue an Outcome Receipt;
12. the manager issued a passing Outcome Receipt and the database finalized the run as `verified`;
13. Northline could read its own spec/run/evidence/receipt;
14. Harbor could not read any of those Northline records;
15. after manager sign-out and re-login, the verified run, evidence, receipt, and economics still persisted.

All 15 checks returned true from the QA harness.

## Persisted proof

- Delegation Spec: `bdd002fd-1492-4cf3-a9bf-ebed09f63414` (`active`)
- Workstream Run: `28014c63-8e57-4f91-a0d6-494866590826` (`verified`)
- Evidence Artifact: `b54da7ec-1a1e-448a-9fb3-a473167877a8` (SHA-256 hash length 64)
- Outcome Receipt: `41e5f364-89a4-46ec-a3fb-3c1c8e0cd44a` (`passed`, definition of done met, QA score 100)

Measured run economics persisted as:

- human minutes: `1.25`
- owner minutes: `0.50`
- AI cost: `1200` micros
- tool cost: `300` micros

## Harness history and cleanup

The first QA invocation failed before any Step 2 records were created because the temporary password generator exceeded Supabase Auth's 72-character password limit. The harness was corrected and retried successfully. The failed attempt remains documented rather than hidden.

After PASS:

- all temporary QA sessions were globally signed out;
- all four test accounts showed zero active refresh tokens;
- their passwords were rotated again to unknown random QA-only values;
- the privileged QA Edge Function harness was replaced by an inert `410` response and `verify_jwt=true`;
- the temporary `pg_net` extension was removed;
- the Supabase security advisor returned to the pre-existing warning set with no new Step 2A extension warning;
- Vercel reported no runtime errors in the two-hour verification window.

## Production boundary

No Step 2A lifecycle writes were executed against the Vercel Production target or a Production Supabase project. The authenticated golden path was intentionally confined to the dedicated QA Supabase project.

Merging PR #7 into `main` automatically caused Vercel's Git integration to create a Production-target deployment. That deployment was not triggered by the Step 2A gate and was not used for the QA lifecycle test.

## Conclusion

**Step 2A is closed.** The Delegation Spec → Workstream Run → Evidence → Outcome Receipt contract has been proven under real authenticated roles, RLS, tenant isolation, persistence, and manager-only verification authority.
