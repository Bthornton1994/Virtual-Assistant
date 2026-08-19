# Production Beta Readiness Gate

Branch: `agent/production-beta-readiness`  
Date: 2026-08-19  
Predecessor: Persistent Lifecycle Beta (PR #7) PASS on Preview.

This release does **not** rebuild the request state machine. It makes Delegation Cloud safe to onboard the first legitimate founding customer.

**No Production cutover in this document.** Do not write Vercel Production environment variables until the mapping below is reviewed and a clean Production Supabase project exists.

## Architecture decisions

### 1. Separate Production Supabase project

`qbvmtgaphvpwpwemplje` stays **Preview / internal QA**. It contains Northline/Harbor fixtures and rotated test passwords. It must never receive paying customers.

Production requires a **new** dedicated Supabase project:

- Empty of fixture tenants
- Migrations `0001`–`0009` applied from a clean state
- RLS proof against that empty project, then against the first provisioned customer
- Auth SMTP configured on **that** project (invitation + password recovery)
- Private `attachments` bucket (created by `0005`)

Do not reuse Preview test users, orgs, or request IDs in Production.

### 2. Vercel environment split

| Target | Supabase | Notes |
|---|---|---|
| Preview (`agent/*` and PR previews) | `qbvmtgaphvpwpwemplje` | Branch-scoped Preview env already points here for P0B. |
| Production | **new project, TBD** | Combined Production+Preview env still contains older unrelated-project values. Do not rewrite Production until the new project URL and keys are in hand. |

Required Production variables (review before write):

```
NEXT_PUBLIC_SUPABASE_URL              # new production project only
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  # production publishable; never service role
NEXT_PUBLIC_SUPABASE_ANON_KEY         # optional fallback to the same publishable key
SUPABASE_SERVICE_ROLE_KEY             # server-only; invites, storage admin, provisioning
NEXT_PUBLIC_SITE_URL                  # production hostname
```

Transactional email (Production project / provider, not Preview leftovers):

```
TRANSACTIONAL_EMAIL_FROM
RESEND_API_KEY                        # only after confirming this key is Delegation Cloud's
```

Do **not** assume existing Vercel `RESEND_API_KEY` / `SENTRY_DSN` values belong to this product. They may be leftover from another app on the same Vercel project. Treat them as untrusted until reviewed.

### 3. Customer provisioning is internal-only

No public self-signup. Ops manager or platform admin creates the organization and invites the client admin. The invited person sets credentials through the Auth invite/recovery links.

### 4. Files are private, tenant-prefixed objects

Storage path: `{organizationId}/{requestId}/{filename}`.  
Signed downloads only after `assertOrgAccess`.  
Type and size validated before upload. Fail closed if Storage is unconfigured.

### 5. Email is required for invitations and recovery; notifications must not invent success

- Invitations: `auth.admin.inviteUserByEmail` (requires Auth SMTP on the target project).
- Password recovery: `resetPasswordForEmail` with `NEXT_PUBLIC_SITE_URL` callback.
- Decision-needed and delivery-ready mail: send only when a reviewed transactional sender is configured; otherwise log the miss. Lifecycle mutations still persist.

`*.delegation.cloud` addresses are rejected by hosted Auth email validation. Founding-customer mailboxes must be real domains Auth will deliver to.

### 6. Observability is fail-closed logging, not a new product surface

Structured JSON logs for auth, database, lifecycle, and AI fallbacks. Optional Sentry when a **reviewed** `SENTRY_DSN` is present. Consequential UI surfaces a real error instead of a blank digest.

## Implementation order (this branch)

1. Decisions (this file) — no Production env writes
2. Internal provisioning (code + tests)
3. Private request attachments (code + tests)
4. Observability + fail-closed action errors
5. Email helper that refuses to pretend a send happened
6. Cross-tenant authorization tests for provision and files
7. Production project + env mapping **review** (blocked until credentials exist)
8. Apply `0001`–`0009` to the new project
9. Production RLS proof
10. SMTP + real mailbox
11. Deploy Production
12. Sanitized golden path on an internal QA tenant that is **not** Northline/Harbor Preview data

## Blockers (irreversible cutover is forbidden until these are gone)

| Blocker | Why it is blocking |
|---|---|
| No Production Supabase project | Cannot apply `0001`–`0009`, prove RLS, or host Auth for paying customers. |
| Production Vercel env still mixed | Older unrelated keys would send production traffic to the wrong database. |
| Auth SMTP unset | Invitations and password recovery cannot complete. |
| No reviewed transactional sender | Decision/delivery notifications cannot be promised. |
| No reviewed Production `SITE_URL` | Recovery and invite redirects would hit Preview or a stale hostname. |
| Sanitized Production E2E not run | Gate incomplete until a non-fixture tenant walks the lifecycle on Production. |

## Explicitly out of scope

Stripe, HubSpot, Gmail, Slack, recurring cron, autonomous external execution, marketing/UI redesign.
