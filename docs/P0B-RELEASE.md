# Persistent Lifecycle Beta — release report

Date: 2026-08-19  
Branch: `agent/p0b-supabase-workspace`  
PR: https://github.com/Bthornton1994/Virtual-Assistant/pull/7  
Gate PASS SHA: `d0d350f5434000c2a11682d9d1e2ba36d15ce990`  
Cleanup SHA: `c904cb243616f96dcba000c6b16168d771a074c8`  
Dedicated project: `qbvmtgaphvpwpwemplje` (East US / Ohio)  
Project URL: https://qbvmtgaphvpwpwemplje.supabase.co  
Did **not** touch project `cvpypxzqcsdhabiejyxh`.  
Production was **not** deployed. Production environment variables were **not** changed.

## Gate verdict

**PASS** — Persistent Lifecycle Beta Gate.

The deployed Preview browser golden path completed on a new request. QA-pass status advancement and assigned-operator delivery authorization are both fixed. Harbor isolation, stale-session, demo isolation, and post-accept logout/login persistence all passed.

Do not merge PR #7 until explicitly authorized.

## Preview deployment (gate PASS)

- SHA: `d0d350f5434000c2a11682d9d1e2ba36d15ce990`
- Preview URL: https://virtual-assistant-b6vo5don3-bryant4.vercel.app
- Deployment ID: `dpl_4ZSkdbZGKtNBa7RA8V9SwTZv7cF9`
- Target: Preview only (`target: null`)

## Persistent golden-path evidence

| Item | Value |
|---|---|
| Request ID | `8830d327-d736-44e3-ad1d-f5d092c57fcd` |
| Delivery ID | `6e8d423f-91fd-447a-b15b-89b6489229c0` |
| Playbook ID | `ad257554-9a6b-4689-bd61-f48a09b139ee` |
| Playbook reuse request | `3f8f8a06-898c-471b-b25b-0fef04dafcd7` |
| Final request status | `accepted` |
| Delivery count | 1 |
| Outbound approvals | 1 `external_email`, approved |

Progression: create → clarify → plan approval → logout/login → queued → assign → operator execute → QA fail → revision → QA pass → `awaiting_action_approval` → customer approval → `ready_to_deliver` → assigned-operator delivery → `delivered` → accept → playbook → reuse.

## Bugs closed on Preview

1. **QA transition.** `createApprovalRecord()` now advances request status when it reuses an existing pending approval (`advanceStatus: false` still does not). Passed QA + pending outbound + status `qa` is no longer valid.
2. **Operator delivery.** `canDeliverRequest(actor, request)` is enforced server-side in both stores. Assigned operators can deliver; other operators, unassigned operators, and clients cannot. Manager-only controls stay manager-only.

## Migrations (0001–0009)

Applied on `qbvmtgaphvpwpwemplje` and recorded in remote migration history:

1. `0001_init.sql`
2. `0002_lifecycle.sql`
3. `0003_operating.sql`
4. `0004_production_auth.sql`
5. `0005_invites_storage.sql`
6. `0006_lifecycle_authz.sql`
7. `0007_schema_alignment.sql`
8. `0008_member_rls.sql`
9. `0009_delivery_unique.sql` — unique index `deliveries_request_id_uidx` on `deliveries(request_id)`

Live verification of 0009:

- Index exists: `CREATE UNIQUE INDEX deliveries_request_id_uidx ON public.deliveries USING btree (request_id)`
- No duplicate `request_id` rows existed before the index (3 deliveries / 3 requests)
- Repeat application insert returns the existing row (app idempotency)
- Direct insert of a second row for `8830d327-…` fails with `23505` / `deliveries_request_id_uidx`
- Golden request still has exactly one delivery: `6e8d423f-91fd-447a-b15b-89b6489229c0`

## Checks

| Check | Result |
|---|---|
| Lint | Passed |
| Typecheck | Passed |
| Vitest | 71 passed |
| Production build | Passed |
| Deployed Playwright golden path | PASS |
| Harbor isolation (browser) | PASS |
| Stale `dc_session` | PASS |
| Demo cookie isolation | PASS |
| Post-accept logout/login + refresh persistence | PASS |
| Delivery authorization unit tests | PASS |
| Local delivery UI permission spec | PASS |

## Test identities (NOT /demo)

Shared Preview Auth passwords were **rotated after the gate passed**. The retired password is no longer valid. The current secret is only in local `E2E_PASSWORD` (`.env.local`) and is not committed.

| Role | Email |
|---|---|
| client admin | client.admin@northline-test.delegation.cloud |
| client member | client.member@northline-test.delegation.cloud |
| ops manager | ops.manager@delegation-test.cloud |
| operator | operator@delegation-test.cloud |
| platform admin | platform.admin@delegation-test.cloud |
| Harbor client admin | client.admin@harbor-test.delegation.cloud |

Orgs:

- Northline Consulting Test `230533c4-a1cf-4f4e-a825-d7cf93134a30`
- Harbor Test `b684a27d-a9e9-4e80-be26-fb05868b6594`

## Password recovery

Still a **production blocker**: SMTP/transactional email and a mailbox Supabase accepts are not configured. `resetPasswordForEmail` rejects `*.delegation.cloud`.

## Remaining merge / production blockers

1. Explicit authorization to merge PR #7 (this report is not that authorization).
2. Do not deploy Production until merge is authorized and a production plan is approved.
3. Password-recovery email / SMTP.
4. Combined Production+Preview Vercel env still includes older unrelated-project values; branch-scoped Preview env for `agent/p0b-supabase-workspace` is the dedicated project. Production env must not be rewritten in this cleanup.

## Intentionally out of scope

Marketing redesign, Stripe, integrations, recurring cron, autonomous external actions, new product features.
