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

See `docs/PRODUCTION-BETA.md` before any Production write.

| Environment | Purpose | Vercel env | Notes |
|---|---|---|---|
| Preview / testing | Apply migrations, provision test users, run Playwright | Preview (branch-scoped) | `qbvmtgaphvpwpwemplje`. Safe to reset. **Not production.** |
| Production | Paying customers only | Production | **New project, not yet created.** No Northline/Harbor fixtures. Do not write Production env until that project exists and this mapping is reviewed. |

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
