# Delegation Cloud Risk Register

As of: 2026-08-28

| ID | Risk | Severity | Current control | Status |
| --- | --- | --- | --- | --- |
| R-001 | An executor could be treated as the source of authoritative truth. | Critical | Deterministic lifecycle, validation, hash bindings, and human approval remain outside executor output. | Controlled |
| R-002 | A passing technical receipt could be mistaken for business success. | High | Separate impact review; current supplier cycle remains in impact_review. | Open |
| R-003 | Shared Grok/cloud-computer credentials could cross tenant or project boundaries. | Critical | Shadow/prepare-only profiles; no production credential grant; tenant-scoped connector design required. | Open |
| R-004 | Unsupported supplier or product claims could reach Grounded catalog or customers. | Critical | Fail-closed Grounded catalog, exact identity/evidence requirements, no outreach or catalog mutation. | Controlled |
| R-005 | Unqualified external actions could create legal, financial, or reputational commitments. | Critical | No mapped supplier-outreach executor; approval and authority guards; zero actions in latest QA run. | Controlled |
| R-006 | Production could be deployed with demo storage, incorrect environment values, or incomplete recovery. | Critical | Production environment remains unprovisioned/not promoted; separate production plan required. | Open |
| R-007 | CI failure could be mistaken for a code result or bypassed silently. | High | Record CI state separately; use local/preview verification where available; never claim green CI without a run. | Open |
| R-008 | Workstream economics could be overstated from task volume or estimated hours. | High | KPI tree requires measured owner/human minutes and AI/tool costs; null is not zero. | Open |
| R-009 | Skill or autonomy could be promoted from too few or failed runs. | High | Step 3E requires repeated accepted receipts, independent review, deterministic validation, economics, and manager approval. | Controlled |
| R-010 | Portfolio expansion could outrun proof of the initial workstream. | High | Loadout remains the first proving ground; Grounded is a separate bounded portability test; CareReserve remains later. | Controlled |
| R-011 | Auth, RLS, concurrency, or stale-state defects could leak data or corrupt lifecycle state. | Critical | Server authorization, RLS, database invariants, stale-state tests, and pre-production QA; final production security review remains. | Open |
| R-012 | Model/provider/runtime changes could break reproducibility or historical evidence. | High | Frozen configuration/provenance and capability contracts; provider changes require a new qualification observation. | Controlled |

Immediate escalation triggers:

- authority or tenant-isolation incident;
- unbound or conflicting evidence;
- unexpected external action;
- production or payment credential requirement;
- security, authentication, or migration failure;
- cost or retry anomaly;
- any request to bypass a human approval or release gate.

No risk is closed merely because a build or test passes.
