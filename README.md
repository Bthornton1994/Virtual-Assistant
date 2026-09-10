# Delegation Cloud

Stop managing tasks. Start delegating outcomes.

Delegation Cloud is a multi-tenant managed delegation platform for founder-led businesses. Customers submit business outcomes and recurring workstreams. An internal operations team fulfills those requests with human operators, AI, and automation.

This is **not** a freelancer marketplace, **not** an hourly virtual-assistant directory, and **not** a chatbot with unsupervised authority.

Read `VISION.md` before changing intake, routing, approvals, automation, or scope.

## Product vision

The customer explains the result they need. Delegation Cloud determines whether a human operator, specialist, AI system, automation, or combination should do the work, coordinates execution, verifies quality, obtains the required approval, delivers the result, and learns the workflow for next time.

Success is measured by dependable completed outcomes and reduced management burden — not hours sold, messages exchanged, or the number of workers attached to an account.

The long-term path, documented in `VISION.md`:

**managed delegation → workflow intelligence → automation → autonomous workstreams → human exception layer**

The MVP is the first stage: human-assisted software that proves intake, routing, queues, assignment, approvals, comments, attachments, delivery, and accountability. Automation is earned after a workflow is understood.

## Architecture

```
src/app/(marketing)   public site
src/app/(auth)        login / signup
src/app/(app)         customer workspace at /app/*
src/app/(ops)         internal operations at /ops/*
src/proxy.ts          request-level routing only
src/lib/domain.ts     roles, statuses, action classes, transitions
src/lib/store.ts      authorization-aware data layer + demo seed
src/lib/ai.ts         provider-agnostic AI (mock unless XAI_API_KEY)
src/lib/stripe.ts     checkout architecture (mocked without Stripe keys)
supabase/migrations   Postgres schema + RLS
```

- **Next.js App Router** (TypeScript) + Tailwind + shadcn-style primitives
- **Supabase** Postgres, Auth, and Storage when env vars are present
- **Demo store** when Supabase is not configured, so the product is operational immediately
- **Vercel** is the intended host
- Privileged secrets (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `XAI_API_KEY`) are server-only

`src/proxy.ts` is not the authorization boundary. Every read and mutation is checked again in server code. Postgres RLS is the database boundary.

## Local setup

```bash
npm install
cp .env.example .env.local   # optional; the demo store works without it
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Demo password for every seeded account: `demo`

| Email | Role |
| --- | --- |
| founder@northline.demo | client_admin |
| teammate@northline.demo | client_member |
| op@delegation.cloud | operator |
| manager@delegation.cloud | ops_manager |
| admin@delegation.cloud | platform_admin |

Northline Advisory is a **seeded demonstration organization**, not a public case study.

### Verify before you ship

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Or `npm run verify` to run all four.

## Environment variables

Copy `.env.example`. All values are optional for local demo mode.

| Variable | Where it may appear | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server | Anon key; RLS still applies |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Admin client. Never import from a Client Component. |
| `XAI_API_KEY` | Server only | SpaceXAI / xAI. If unset, AI functions return deterministic mocks. |
| `XAI_MODEL` | Server only | Defaults to `grok-4.6` |
| `STRIPE_SECRET_KEY` | Server only | Live checkout. If unset, billing activates a mock subscription. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Browser | Publishable Stripe key |
| `STRIPE_WEBHOOK_SECRET` | Server only | Webhook verification (prepared) |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_FIRM` | Server only | Price IDs |
| `NEXT_PUBLIC_APP_URL` | Browser + server | Canonical origin |

## Database setup

1. Create a Supabase project.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor (or `supabase db push`).
3. Run `supabase/seed.sql` for the eight workstream templates.
4. Create Auth users that match `organization_members.user_id` and `operators.user_id`.
5. Create a private Storage bucket named `attachments` (the migration inserts it when Storage is available).

Every customer-owned row carries `organization_id`. RLS policies use `my_org_ids()` for members and `platform_role()` for internal staff. A trigger rejects `in_progress` on `sensitive_execution` unless an approved approval row exists.

Until those env vars are set, `src/lib/store.ts` seeds Northline Advisory and Harbor & Co. in memory. Harbor exists so tenant isolation can be demonstrated; it is not a customer logo.

## Deployment

1. Push the repository to GitHub.
2. Import the project in Vercel (Next.js preset).
3. Set the environment variables above. Do not add `SUPABASE_SERVICE_ROLE_KEY` to a client-visible prefix.
4. Deploy. `src/proxy.ts` is picked up as the Next.js 16 proxy/middleware.
5. Point production Auth redirect URLs at `https://<your-domain>/auth/callback` once you enable hosted Supabase Auth.

Payments may stay mocked in the first production deploy. Activate Stripe price IDs when you are ready to charge.

## Security model

- **Tenant isolation.** Users see only organizations in which they have an active membership, unless they are internal staff.
- **Defense in depth.** Proxy routing + server `requireClient` / `requireOps` + store checks + RLS.
- **Least privilege.** Integrations request named scopes. Operators see assigned work, not another tenant’s files.
- **Bounded authority.** Four action classes. Sensitive execution cannot enter `in_progress` without an explicit customer approval (application + SQL trigger).
- **Audit.** Login-sensitive events, request create/status, assignments, approvals, external execution, data export, permission changes, integration access, and AI actions write to `audit_events`.
- **Execution economics.** Delegation Specs may declare numeric ceilings; malformed limits, work-cell cost under-reporting, and over-limit successful verification are rejected at the application and database boundaries. See `docs/ECONOMIC-ENVELOPE-GUARD-V1.md`. Pre-execution reservation and usage reconciliation live in the Outcome Economics Governor (`docs/OUTCOME-ECONOMICS-GOVERNOR-V1.md`). The in-process adapter (`docs/EXECUTION-ECONOMICS-ADAPTER-V1.md`) surrounds native public-web fetch and optional same-process complete/fail; process-local Maps are not global serverless enforcement until an authorized SQL seam exists.
- **Secrets.** Service-role and model keys never ship to the browser (`src/lib/supabase/admin.ts` refuses `window`).
- **Out of scope.** Healthcare, legal practice, regulated finance, custody of funds, and silent high-risk actions.

## Role model

| Role | Surface | Can |
| --- | --- | --- |
| `client_admin` | `/app` | Own the organization, invite members, request work, decide approvals, publish playbooks, export audit, change billing |
| `client_member` | `/app` | Request work, comment, decide approvals, accept or cancel. Cannot invite or publish playbooks |
| `operator` | `/ops` | Work assigned (and unassigned) queue items. Cannot assign other operators or decide customer approvals |
| `ops_manager` | `/ops` | Assign, change status and scope, split steps, request approval, run QA, see all tenants |
| `platform_admin` | `/ops` (and customer surfaces when needed) | Platform controls. Still cannot skip sensitive-execution approval |

## Roadmap

Aligned with `VISION.md`. Do not skip stages.

1. **Managed delegation (MVP, now).** Intake, execution plans, workstreams, playbooks, approvals, ops queue, QA, demo seed, RLS, audit.
2. **Workflow intelligence.** Stronger playbook capture from delivered work, tenant-safe retrieval, correction history.
3. **Automation.** Bounded, logged automation of proven prepare-only and low-risk steps.
4. **Autonomous workstreams.** Recurring workstreams that run inside stated authority, with autonomy that can be revoked.
5. **Human exception layer.** Operators and specialists concentrated on judgment, quality, and consequential authority.

Near-term product work that still sits inside stage 1: live Supabase Auth wiring for new signups, Storage uploads beyond metadata, Stripe webhooks, and a hosted production project.

## Delegation Cloud governance

This repository is also the first dogfooding tenant for the Delegation Cloud operating model. Governance artifacts record strategy, current state, measurable metrics, authority boundaries, decisions, experiments, and risks without granting any executor new authority.

- [Strategy](STRATEGY.md)
- [Current state](CURRENT_STATE.md)
- [KPI tree](KPI_TREE.yaml)
- [Authority matrix](AUTHORITY_MATRIX.yaml)
- [Decision log](DECISION_LOG.md)
- [Experiment log](EXPERIMENT_LOG.md)
- [Risk register](RISK_REGISTER.md)

## Product boundaries

- AI must not independently send, purchase, publish, commit, transfer funds, or change access.
- Numerical workload figures in the delegation audit are **estimates**.
- Northline Advisory is demo seed data, not a testimonial.
