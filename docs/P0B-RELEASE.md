# Persistent Lifecycle Beta — release report

Date: 2026-08-18  
Branch: `agent/p0b-supabase-workspace`  
Base: `646cef0` (PR #6 merged)  
Gate complete: **no**

The product code now routes production actors to `SupabaseWorkspace` and keeps `MemoryStore` exclusive to `/demo` and tests. The gate is **not** complete because no dedicated Delegation Cloud Supabase project was available in this environment, so migrations, live RLS, real Auth identities, and the persistent multi-role golden path were not executed against Postgres.

## What passed

| Check | Result |
|---|---|
| Lint | Passed |
| Typecheck | Passed |
| Unit / integration (Vitest) | 60 passed across 9 files |
| Production build | Passed (`next build`) |
| Playwright demo isolation | 2 passed |
| Playwright production golden path | **Skipped** — `E2E_*` identities not configured |
| Production actor → MemoryStore fallback | Unit-tested: throws `DomainError` without Supabase env; constructs `SupabaseWorkspace` when env is present |
| Lead capture memory fallback | Removed. `persistLead` fails closed without service role |
| Password recovery UI | `/login/forgot` + `/login/reset` + callback recovery routing |
| Invitation path (code) | Admin invite + membership activation on first login |
| AI validation before persist | `src/lib/ai-validate.ts` used by `SupabaseWorkspace.createRequest` / playbook generation |

## What remains blocked (required for gate)

1. **Dedicated Supabase project** — none is configured locally or visible in Vercel secrets from this environment. Unrelated projects were not touched.
2. **Migrations 0001–0006 applied** to a fresh preview database.
3. **Types generated from a live schema** — `src/lib/data/database.types.ts` is a hand-written stub until `supabase gen types --linked` can run.
4. **Preview Auth users** — client admin, ops manager, operator (and a second-org client for RLS). Script: `node scripts/provision-preview.mjs`.
5. **Live RLS A vs B** — script: `node scripts/rls-proof.mjs`. Not executed.
6. **Full multi-role lifecycle on Supabase** including refresh, re-auth, and restart survival.
7. **Unauthorized object access** proven against live RLS, not only application `assertOrgAccess`.
8. **External / sensitive actions blocked without approval** on live DB (SQL triggers exist in 0001/0002/0006; unapplied).
9. **Vercel Preview deploy + production-like smoke** against Preview env with real keys. Not done: branch changes are local until pushed, and Preview has no Supabase env.

## Migrations in repo (not applied)

- `0001_init.sql` — core tables, RLS helpers, tenant policies, sensitive-execution trigger
- `0002_lifecycle.sql` — lifecycle statuses, approvals, clarifications, deliveries, playbook extras
- `0003_operating.sql` — operating memory
- `0004_production_auth.sql` — profiles, leads, execution_plans
- `0005_invites_storage.sql` — invitations, private attachments bucket
- `0006_lifecycle_authz.sql` — invite self-activate, profile bootstrap, external-delivery trigger

## Test identities

| Surface | Identity | Status |
|---|---|---|
| Demo only | `founder@northline.demo` / `demo` | Isolated `dc_demo_session`. Not production. |
| Demo only | Maya / Noah / Samira seeded personas | Isolated demo |
| Production E2E | `E2E_CLIENT_EMAIL`, `E2E_MANAGER_EMAIL`, `E2E_OPERATOR_EMAIL`, `E2E_OTHER_CLIENT_EMAIL` | Not provisioned |

## Intentionally out of scope

- Marketing redesign
- Stripe / self-serve billing
- Recurring cron execution
- Autonomous external actions
- HubSpot / CRM / email integrations
- Analytics expansion
- New dashboards
- Production deploy (do not ship this gate to production until the persistent path is proven)

## Known issues

- Playwright production spec is a UI walk; it cannot pass until Preview Supabase + identities exist.
- `database.types.ts` is not generated from a live project.
- `getWorkspace` still fails closed without env — correct, but means `/login` production users cannot operate until Preview/Production env is set.
- Book-a-call lead capture now fails closed without `SUPABASE_SERVICE_ROLE_KEY` (no ephemeral list).

## How to finish the gate

1. Create a **dedicated** Delegation Cloud Supabase project for Preview (separate from Production).
2. Set Preview env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.
3. `npx supabase link --project-ref <ref>` then `npx supabase db push`.
4. `npx supabase gen types typescript --linked > src/lib/data/database.types.ts`
5. `node scripts/provision-preview.mjs`
6. `node scripts/rls-proof.mjs`
7. Push this branch for a Vercel Preview deploy. Smoke `/login` with the provisioned client, manager, and operator.
8. `PLAYWRIGHT_BASE_URL=<preview> npm run test:e2e` with `E2E_*` set.
9. Confirm one request survives refresh, logout/login, and a new serverless instance.
10. Only then mark the gate complete. Do not promote to production until a later acceptance gate.
