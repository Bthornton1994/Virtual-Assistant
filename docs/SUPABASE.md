# Delegation Cloud Supabase

## Finding (2026-08-18)

Inspected:

- Vercel project `virtual-assistant` (`prj_OdcAAY0XPnHNw0vwoU0924yC3anb`, team `bryant4`)
- Local env files (none present)
- Process environment (no `SUPABASE_*` or `SUPABASE_ACCESS_TOKEN`)
- Local Supabase CLI config (`~/.supabase` has telemetry only)
- Vercel project metadata via MCP (no secret values returned)

**No dedicated Delegation Cloud Supabase project is configured in this environment.**

No project URL, ref, tables, or migration history could be verified.

I did **not** open or mutate any other Supabase project that might exist under the account. Unrelated application data must not be reused.

Migrations in-repo: `0001_init` … `0006_lifecycle_authz`. They have not been applied because there is no dedicated project to apply them to.

Preview identities are provisioned with `node scripts/provision-preview.mjs` after the project exists.

Live RLS proof: `node scripts/rls-proof.mjs`.

## Required mapping

| Environment | Purpose | Vercel env | Notes |
|---|---|---|---|
| Preview / testing | Apply migrations, provision test users, run Playwright | Preview | Dedicated DC project. Safe to reset. |
| Production | Paying customers only | Production | Separate project. No Northline seed. |

Required variables (Preview first):

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
```

`NEXT_PUBLIC_SUPABASE_ANON_KEY` is the current publishable/anon key used by `@supabase/ssr`. Keep that name until the workspace is migrated to `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Server-only: `SUPABASE_SERVICE_ROLE_KEY` — invite/provision and storage admin. Never send to the browser.

## After a project exists

```
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase gen types typescript --linked > src/lib/data/database.types.ts
```


## Memory control-plane release gate

After the dedicated Preview/QA project is mapped, apply the repository migrations and run the server-side structural proof:

```
npx supabase link --project-ref <qa-ref>
npx supabase db push
psql "$QA_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/qa/memory_control_plane_v1_proof.sql
psql "$QA_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/qa/memory_control_plane_v1_persistence_proof.sql
```

The memory tables are intentionally server-only: browser roles receive no direct table grants, and the RPCs enforce organization ownership, source-artifact identity, append-only revisions, erasure tombstones, and atomic execution binding. The proof above is read-only; the disposable end-to-end fixture must run in the mapped QA project inside an explicit rollback transaction before promotion.

Production promotion requires a separately mapped project, a successful QA migration/proof run, a verified backup/restore point, logs and alerts for persistence/erasure/claim failures, and a documented rollback or forward-fix plan. Do not point the repository's hardcoded schema verifier or any QA fixture at an unrelated Supabase project.
