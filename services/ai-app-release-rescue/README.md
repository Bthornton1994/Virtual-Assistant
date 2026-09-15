# WS-REV-01 — AI App Release-Readiness Review

**$299 fixed-price** release-readiness review with an optional **$1,250 remediation sprint**.

Scope: one repository, one web application, one critical workflow.
Target turnaround: 48 hours from access granted to draft report.

## Artifacts

| File | Purpose | Priority |
|---|---|---|
| [SECURITY-MODEL.md](SECURITY-MODEL.md) | Auth, data access, secrets, engagement lifecycle security, threat model | Highest |
| [DATA-BOUNDARIES.md](DATA-BOUNDARIES.md) | Data classification, organization isolation, lifecycle, cross-boundary prohibitions | Highest |
| [REPORT-SCHEMA.md](REPORT-SCHEMA.md) | Customer-safe structured report format, finding schema, delivery formats | Highest |
| [SERVICE-ARCHITECTURE.md](SERVICE-ARCHITECTURE.md) | Engagement flow, Delegation Spec structure, routing, QA, billing | High |
| [AUDIT-RUBRIC.md](AUDIT-RUBRIC.md) | 9-category rubric with scoring guides and evidence requirements | High |
| [NON-CLAIMS.md](NON-CLAIMS.md) | What the service explicitly does not claim, promise, or provide | High |

## Customer-facing demo (this branch)

Local, payment-inactive surfaces for Bryant’s offer review. They use the contracts above and do **not** activate Stripe, store access tokens, or write customer records.

| Route | Purpose |
|---|---|
| `/ai-app-release-rescue` | Landing: $299 review, $1,250 sprint, scope, limitations, rubric |
| `/ai-app-release-rescue/intake` | Intake for one repo, one web app, one workflow |
| `/ai-app-release-rescue/demo` | Demo hub (synthetic data only) |
| `/ai-app-release-rescue/demo/report` | Customer-safe report renderer against `REPORT-SCHEMA.md` |

## Status

- **Stage:** Architecture artifacts plus customer-facing demo UI (draft)
- **Authority class:** `prepare_only` (review) / `low_risk_execution` (remediation)
- **Workstream stage:** Stage 1 — Managed delegation
- **Vision alignment:** Aligns — managed delegation with explicit authority, bounded scope, evidence-backed delivery

## Constraints

- Does not touch StageForge or Loadout
- Does not claim revenue, customers, or market evidence
- Does not activate payments, send outreach, or expose secrets
- Does not merge or deploy
- Executor authority is bounded by Delegation Spec; no implicit authority
