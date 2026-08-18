# Persistent Lifecycle Beta — release report

Date: 2026-08-18  
Branch: `agent/p0b-supabase-workspace`  
Dedicated project: `qbvmtgaphvpwpwemplje` (East US / Ohio, ACTIVE_HEALTHY)  
Project URL: https://qbvmtgaphvpwpwemplje.supabase.co  
Did **not** touch the other listed project `cvpypxzqcsdhabiejyxh`.

## Gate status

**Persistent database lifecycle: passed on the dedicated project.**

**Deployed-browser gate: not passed.**

Playwright against Preview returned `/login?error=unavailable` for every production identity. That means the running Preview deployment does not have `NEXT_PUBLIC_SUPABASE_URL` + publishable key (and/or the server cannot construct a Supabase client).

PR: https://github.com/Bthornton1994/Virtual-Assistant/pull/7  
SHA: `3116de6d577fa24193efbe8af28d1300c03e9b65`  
Preview: https://virtual-assistant-git-agent-p0b-supabase-workspace-bryant4.vercel.app  
Deployment: `dpl_JnWJCs1KdNH9LX2CDRenVYtWB4rK`  

Production was not deployed. Shared preview password was **not** rotated because browser validation did not pass.

## What was applied

Migrations pushed to `qbvmtgaphvpwpwemplje`:

1. `0001_init.sql`
2. `0002_lifecycle.sql`
3. `0003_operating.sql`
4. `0004_production_auth.sql`
5. `0005_invites_storage.sql`
6. `0006_lifecycle_authz.sql`
7. `0007_schema_alignment.sql`
8. `0008_member_rls.sql` — fixes `organization_members` RLS recursion

Live types written to `src/lib/data/database.types.ts` via `supabase gen types typescript --linked`.

## Live schema evidence

Every required table exists with **RLS enabled**:

organizations, organization_members, profiles, operators, skills, operator_skills, workstream_templates, workstreams, requests, request_steps, request_assignments, execution_plans, clarifications, approvals, comments, attachments, qa_reviews, deliveries (DeliveryPackage; view `delivery_packages`), playbooks, playbook_versions, operating_memory, audit_events, leads, invitations, internal_notes, plus support tables.

Foreign keys, status/role/kind checks, unique org slugs, and org ownership columns verified via `pg_constraint`.

## Test identities (NOT /demo)

Password: `Preview-Gate-2026!` (`E2E_PASSWORD`)

| Role | Email | User id |
|---|---|---|
| client admin | client.admin@northline-test.delegation.cloud | c6af719b-1d9b-4824-bca1-667203676f99 |
| client member | client.member@northline-test.delegation.cloud | 478ec7d7-a6fa-4446-a780-de7a8a8a722b |
| ops manager | ops.manager@delegation-test.cloud | c0b2ab6c-c56d-4435-89fd-f972ce552609 |
| operator | operator@delegation-test.cloud | c20d3a88-defa-4a1b-a1de-be9ab424ac45 |
| platform admin | platform.admin@delegation-test.cloud | 56e97055-9ddd-4cf9-a09b-af890f861fb8 |
| Harbor client admin | client.admin@harbor-test.delegation.cloud | 84ea87e6-9378-4e10-a1be-2af1d79c01a9 |

Orgs:

- Northline Consulting Test `230533c4-a1cf-4f4e-a825-d7cf93134a30`
- Harbor Test `b684a27d-a9e9-4e80-be26-fb05868b6594`

## Persistent golden path

`node scripts/golden-lifecycle.mjs` **PASS** (run twice; second after 0008):

- create → plan approval → queued → assign → execute → QA fail → revision → QA pass
- external delivery **blocked** without approval
- customer outbound approval → delivery → accept → playbook → reuse playbook
- re-auth: accepted status survived a new login
- latest request: `721e255a-1ccc-4c85-87c3-0bdb67e25cc0`
- playbook: `9c03523e-c3d0-4475-8116-1ca16ae743e8`

## Tenant isolation

Authenticated Northline client:

- cannot SELECT Harbor request
- cannot INSERT into Harbor
- cannot UPDATE/DELETE Harbor request
- cannot SELECT Harbor memberships after 0008

Playwright: Harbor admin sees Harbor plants and **zero** “Conference follow-up” (Northline).

## Playwright

Local (localhost + `.env.local`): 4 passed.

Deployed Preview (`PLAYWRIGHT_BASE_URL=https://virtual-assistant-git-agent-p0b-supabase-workspace-bryant4.vercel.app`):

| Spec | Result |
|---|---|
| persistent production login | **failed** — `/login?error=unavailable` |
| Harbor isolation (browser) | **failed** — same unavailable login |
| preview multi-role golden path | **failed** — same unavailable login |

Screenshots: `docs/evidence/preview-login-unavailable.png`, `docs/evidence/preview-golden-login-unavailable.png`.

## Password recovery

- `/login/forgot` and `/login/reset` exist
- callback routes `type=recovery` to `/login/reset`
- `auth.admin.generateLink({ type: "recovery" })` returns a recovery action link
- `resetPasswordForEmail` rejects `*.delegation.cloud` as “invalid” (Supabase email validation). Email delivery is not configured. Completing a mailbox click still needs Auth SMTP / an address Supabase accepts.

## Checks

| Check | Result |
|---|---|
| Lint | Passed |
| Typecheck | Passed |
| Vitest | 61 passed |
| Production build | Passed (loads `.env.local`) |
| Golden path against live DB | PASS |
| Live RLS A vs B | PASS |
| Playwright | 4 passed, 1 skipped |

## Remaining (exact)

1. **Vercel Preview secrets** — this session cannot write them (Vercel CLI logged out; MCP has no env-write tool). Set Preview only:
   - `NEXT_PUBLIC_SUPABASE_URL=https://qbvmtgaphvpwpwemplje.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable, not service)
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
   - `NEXT_PUBLIC_SITE_URL` = preview URL
2. **Auth email / password recovery** is a **production blocker** until SMTP/transactional email and a real mailbox are configured. `resetPasswordForEmail` currently rejects `*.delegation.cloud`.
3. Do not promote to production until the deployed-browser golden path on Preview passes.

## Intentionally out of scope

Marketing redesign, Stripe, integrations, recurring cron, autonomous external actions.
