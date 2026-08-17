# Delegation Cloud

Stop managing tasks. Start delegating outcomes.

A multi-tenant managed delegation platform for founder-led businesses. Customers submit outcomes and recurring workstreams. An internal operations team fulfills them with humans, AI, and automation.

This is **not** a freelancer marketplace and **not** an hourly virtual-assistant directory.

## Stack

- Next.js App Router (TypeScript)
- Tailwind CSS + shadcn-style primitives
- Supabase Postgres, Auth, Storage (schema + RLS shipped)
- Stripe architecture (demo activation if keys are absent)
- Provider-agnostic AI (`src/lib/ai.ts`) with SpaceXAI/xAI when `XAI_API_KEY` is set, otherwise deterministic mocks
- Vercel-ready

## Run locally

```bash
npm install
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

Without Supabase env vars the app uses a seeded in-memory store so the product is operational immediately.

## Supabase

1. Create a project.
2. Copy `.env.example` to `.env.local`.
3. Run `supabase/migrations/0001_init.sql` then `supabase/seed.sql`.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.

Row-level security is the database authorization boundary. `src/proxy.ts` only routes unauthenticated visitors away from `/app` and `/ops`.

## Scripts

```bash
npm test
npm run build
```

## Product boundaries

- Sensitive execution cannot enter `in_progress` without an approved approval (application + SQL trigger).
- AI must not independently send, purchase, publish, commit, transfer funds, or change access.
- Customer objects always carry `organization_id`.
