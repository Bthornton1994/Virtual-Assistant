# Delegation Cloud Supabase

## Finding (2026-09-04)

Inspected:

- Vercel project `virtual-assistant` (`prj_OdcAAY0XPnHNw0vwoU0924yC3anb`, team `bryant4`)
- Dedicated Delegation Cloud QA/Preview Supabase project `qbvmtgaphvpwpwemplje`
- QA project status: `ACTIVE_HEALTHY`, region `us-east-2`, PostgreSQL 17.6
- QA migration history and live catalog, without exposing secret values

The dedicated QA/Preview project is now mapped and healthy. It contains established QA fixtures and legacy `public.execution_plans` data, so the release added a compatibility migration that preserves the old request-scoped snapshots as `public.execution_plan_snapshots_legacy` before installing the new durable Execution Runtime `public.execution_plans` relation.

Applied to QA:

- legacy execution-plan snapshot compatibility rename;
- split Execution Runtime v1 schema and RPC migrations;
- memory control-plane persistence and ordered compatibility patches;
- covering indexes for runtime foreign keys.
- executor authority-ceiling enforcement in the worker claim RPC.

Verified in QA:

- structural proof passed at 2026-09-04 22:01 UTC, including RLS, browser-role denial, service-role grants, invariants, atomic binding, and `memory_context_bound` compatibility;
- disposable persistence proof passed with two revisions, idempotency, lineage, audit emission, erasure, non-resurrection, and source-artifact preservation;
- disposable Execution Runtime proof passed for idempotent plan creation, duplicate-claim prevention, lease heartbeat credential checks, completion, terminal failure, expiry reaping, cancellation, approval release, and fail-closed executor/spec authority checks;
- all disposable runtime, run, artifact, memory, tombstone, and audit sentinel rows were rolled back and remain absent.

No Production Supabase project is mapped, migrated, or changed. The QA project must not be treated as Production.

## Advisor status

The final QA advisor pass reports no security lint for the memory tables and no unindexed-foreign-key lint for the new runtime relations. The remaining QA warnings are pre-existing project-level items: exposed `SECURITY DEFINER` helper functions used by existing RLS policies, disabled leaked-password protection, broad legacy permissive-policy findings, and unused indexes on newly installed relations before workload exists. Resolve or formally accept those items before Production go-live; this release does not silently alter unrelated authorization helpers.

## Required mapping

| Environment | Purpose | Vercel env | Notes |
|---|---|---|---|
| Preview / testing | Apply migrations, provision test users, run Playwright | Preview | Dedicated DC project. Safe to reset only with an intentional QA reset plan. |
| Production | Paying customers only | Production | Separate project. No Northline seed. |

Required variables (Preview first):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is the current publishable/anon key used by `@supabase/ssr`. Keep that name until the workspace is migrated to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Server-only: `SUPABASE_SERVICE_ROLE_KEY` — invite/provision and storage admin. Never send it to the browser.

## After a project exists

```
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase gen types typescript --linked > src/lib/data/database.types.ts
```

For this repository, a clean environment should apply the files under `supabase/migrations/` in filename order. QA-only proof executions are run from `supabase/qa/` and must never be copied into Production migration history.

## Memory control-plane release gate

After the dedicated Preview/QA project is mapped, apply the repository migrations and run the server-side structural proof:

```
npx supabase link --project-ref <qa-ref>
npx supabase db push
psql "$QA_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/qa/memory_control_plane_v1_proof.sql
psql "$QA_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/qa/memory_control_plane_v1_persistence_proof.sql
psql "$QA_DATABASE_URL" -v ON_ERROR_STOP=1 \\
  -f supabase/qa/execution_runtime_v1_proof.sql
```

The memory tables are intentionally server-only: browser roles receive no direct table grants, and the RPCs enforce organization ownership, source-artifact identity, append-only revisions, erasure tombstones, and atomic execution binding. The structural proof is read-only. The disposable end-to-end fixture must run only in the mapped QA project inside an explicit rollback transaction before promotion.

Production promotion additionally requires a separately mapped project, a successful QA migration/proof run, a verified backup/restore point, logs and alerts for persistence/erasure/claim failures, retention/erasure operations, and a documented rollback or forward-fix plan. Do not point the repository's hardcoded schema verifier or any QA fixture at an unrelated Supabase project.
