# WS-REV-01 Security Model

Version: 1.0.0-draft
Scope: AI App Release-Readiness Review ($299) and optional Remediation Sprint ($1,250)

## Governing authority

This service operates under `VISION.md` and `AUTHORITY_MATRIX.yaml`.
It is a **prepare-only** workstream: it produces evidence artifacts and
recommendations. It does not modify customer systems, deploy code, send
external messages, transfer funds, or change access.

---

## 1. Authentication and identity

### 1.1 Customer identity

| Property | Requirement |
|---|---|
| Intake channel | Authenticated Delegation Cloud session (`client_admin` or `client_member`) |
| Organization binding | Every review engagement is scoped to exactly one `organization_id` |
| Repository grant | Customer provides a read-only access token or grants read access to a specific repository. No write access is requested or accepted |
| Token lifetime | Scoped to the engagement. Revoked or rotated at delivery or 7 calendar days, whichever comes first |

### 1.2 Executor identity

| Property | Requirement |
|---|---|
| Review executor | Assigned operator or qualified AI executor operating under a Delegation Spec |
| Authority class | `prepare_only` — research, inspect, draft. No external action |
| Executor isolation | Executor sees only the scoped repository and engagement metadata. No cross-tenant visibility |

### 1.3 Internal staff

| Role | Access |
|---|---|
| `operator` | Assigned engagement only. Cannot access other tenants' reviews |
| `ops_manager` | May assign, re-scope, or escalate. Cannot bypass approval gates |
| `platform_admin` | Audit access. Cannot skip sensitive-execution approval |

---

## 2. Data access controls

### 2.1 What the service reads

| Data source | Access | Justification |
|---|---|---|
| Customer repository (source code) | Read-only, single repo | Architecture and code-quality audit |
| CI/CD configuration | Read-only, within repo | Deployment and pipeline review |
| Package manifests and lockfiles | Read-only, within repo | Dependency and vulnerability review |
| Environment config templates | Read-only, within repo | Secrets-handling and config review |
| Browser-accessible deployment (if provided) | Read-only HTTP, no auth bypass | Accessibility and runtime behavior |

### 2.2 What the service never reads

- Production databases or data stores
- Customer secrets, API keys, or credentials (values)
- Customer user PII beyond the engagement contact
- Other repositories not named in the engagement scope
- Internal Slack, email, or communication systems
- Financial records, billing data, or payment instruments

### 2.3 Write operations

The service produces **zero writes** to customer systems:

- No commits, branches, or PRs to the customer repository
- No deployments or infrastructure changes
- No secret rotation or credential management
- No database migrations or data mutations
- No CI/CD pipeline modifications

All output is written to Delegation Cloud-owned storage, scoped to the
engagement and organization.

---

## 3. Secrets and configuration

### 3.1 Customer-provided access tokens

| Control | Implementation |
|---|---|
| Storage | Encrypted at rest in Delegation Cloud's secrets store, scoped to engagement ID |
| Access | Available only to the assigned executor during active review |
| Logging | Token use is logged (access timestamp, operation) but token values are never logged |
| Expiry | Automatic revocation at engagement close or 7-day hard ceiling |
| Rotation | Customer may rotate at any time; the engagement pauses until a new token is provided |

### 3.2 Delegation Cloud internal secrets

| Secret | Boundary |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never sent to browser. Never used for customer-repo access |
| `XAI_API_KEY` | Server-only. Used for AI-assisted analysis if enabled. Customer code is not sent to third-party AI unless the engagement explicitly authorizes it |
| Executor credentials | Scoped per-engagement. No ambient credentials |

### 3.3 AI provider data handling

| Control | Requirement |
|---|---|
| Code sent to AI | Only when engagement authorizes AI-assisted review. Logged per-request |
| Prompt/response retention | Follows the AI provider's data-processing terms. Delegation Cloud does not cache prompts beyond the engagement |
| Customer opt-out | Customer may restrict review to human-only execution at intake |
| Provider isolation | AI provider receives code snippets, not the full repository. No customer identity or organization metadata is sent |

---

## 4. Engagement lifecycle security

```
intake → scope_confirmed → access_granted → review_active →
  draft_report → customer_review → delivered → access_revoked
```

| Transition | Gate |
|---|---|
| `intake → scope_confirmed` | Customer confirms repository URL, deployment URL (optional), and scope |
| `scope_confirmed → access_granted` | Customer provides read-only token. Token stored encrypted |
| `access_granted → review_active` | Operator or executor assigned. Delegation Spec created with `prepare_only` authority |
| `review_active → draft_report` | All rubric sections scored. Evidence artifacts hashed and frozen |
| `draft_report → customer_review` | Internal QA passed. Customer receives report for review |
| `customer_review → delivered` | Customer accepts or requests clarification. Final report frozen |
| `delivered → access_revoked` | Token revoked. Engagement artifacts retained per data-boundaries policy |

---

## 5. Threat model (scoped)

| Threat | Mitigation |
|---|---|
| Executor accesses wrong tenant | Organization-scoped assignment. RLS on all engagement data |
| Token persists after engagement | Automatic revocation at delivery or 7-day ceiling |
| Customer code leaks to another customer | Engagement isolation. No cross-tenant artifact storage |
| AI provider retains customer code | Opt-in AI review. Snippet-level granularity. Provider DPA required |
| Report contains actual secrets | Report schema forbids secret values. Automated scan before delivery |
| Executor modifies customer code | `prepare_only` authority. Read-only token. No write operations |
| Remediation sprint exceeds scope | Separate Delegation Spec with explicit authority, customer-approved |

---

## 6. Remediation sprint (optional $1,250 upsell)

The remediation sprint has a **different authority class** from the review.

| Property | Review ($299) | Remediation ($1,250) |
|---|---|---|
| Authority class | `prepare_only` | `low_risk_execution` (bounded) |
| Repository access | Read-only | Read-write to a dedicated branch only |
| Customer approval | At intake | At intake + per-PR approval before merge |
| Scope | One repo, one app, one workflow | Findings from the review report only |
| Deliverable | Report | Pull requests + updated report |
| Merge authority | None | Customer merges. Executor never merges |

The remediation sprint requires a separate Delegation Spec with:
- Explicit scope: only the findings from the completed review
- Branch restriction: executor works on a named branch, never `main`/`production`
- No deployment authority
- Customer approves every PR before merge
- Access revoked at sprint close or 14-day ceiling
