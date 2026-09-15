# WS-REV-01 Data Boundaries

Version: 1.0.0-draft
Scope: AI App Release-Readiness Review ($299) and optional Remediation Sprint ($1,250)

## Governing principle

Customer data stays inside the engagement boundary. Nothing crosses
tenants, and nothing persists beyond what the customer authorized.

---

## 1. Data classification

| Classification | Examples | Handling |
|---|---|---|
| **Engagement metadata** | Engagement ID, timestamps, status, assigned executor, rubric scores | Stored in Delegation Cloud, scoped to `organization_id`. Retained for audit |
| **Customer source code** | Repository files accessed during review | Read-only access during review. Not copied into Delegation Cloud storage. Cached analysis artifacts (AST summaries, dependency graphs) are engagement-scoped and purged at close |
| **Report artifacts** | Audit report, evidence screenshots, rubric scorecards | Stored in Delegation Cloud, scoped to engagement. Content-hashed and frozen at delivery |
| **Access tokens** | Repository read-only PAT or deploy key | Encrypted at rest, engagement-scoped, auto-revoked at close |
| **Customer PII** | Engagement contact name, email | Minimal collection. Stored in organization membership, not in engagement artifacts |
| **Customer secrets** | API keys, database credentials, env var values | **Never ingested.** Review examines secret-handling patterns, not secret values. If a secret value is encountered, it is redacted immediately and the exposure is flagged in the report |

---

## 2. Organization isolation

| Boundary | Enforcement |
|---|---|
| Engagement → organization | Every engagement row carries `organization_id`. Foreign-key constraint |
| Engagement → engagement | Artifacts, analysis cache, and report data are keyed by engagement ID. No cross-engagement queries outside `platform_admin` audit |
| Tenant → tenant | RLS policies enforce `my_org_ids()`. An operator assigned to Org A cannot query Org B's engagements |
| AI context → tenant | If AI-assisted review is enabled, prompts carry only the engagement ID and code snippets. No organization name, customer identity, or cross-tenant context enters the prompt |

---

## 3. Data lifecycle

### 3.1 During active review

| Data | Location | Access |
|---|---|---|
| Source code | Customer's repository (remote) | Read-only via scoped token |
| Analysis artifacts | Delegation Cloud ephemeral storage | Assigned executor only |
| Draft report | Delegation Cloud engagement storage | Assigned executor + QA reviewer |

### 3.2 At delivery

| Data | Action |
|---|---|
| Access token | Revoked. Encrypted record purged |
| Ephemeral analysis cache | Purged within 24 hours of delivery |
| Final report | Frozen (content-hashed). Retained in engagement storage |
| Rubric scores | Retained as structured data for engagement record |
| Audit log entries | Retained per platform audit policy |

### 3.3 Post-engagement retention

| Data | Retention | Justification |
|---|---|---|
| Final report | 12 months or until customer requests deletion | Customer may re-download; supports remediation sprint reference |
| Rubric scores (structured) | 12 months | Aggregate (anonymized) quality metrics |
| Engagement metadata | Platform audit retention period | Operational accountability |
| Source code | **Not retained.** Access ends at engagement close | Customer owns their code |
| Analysis artifacts | **Purged at close** | Derived data; not needed after report delivery |
| Access tokens | **Purged at close** | Credential hygiene |

### 3.4 Customer deletion request

On request, Delegation Cloud deletes:
- The final report and all engagement artifacts
- All rubric scores and structured data
- All audit log entries referencing the engagement
- Any cached analysis artifacts (if still within purge window)

Deletion is confirmed in writing. Anonymized aggregate counts (e.g., "one
engagement completed in Q3") may be retained for internal operational metrics
but contain no customer-identifiable information.

---

## 4. Cross-boundary prohibitions

| Boundary | Rule |
|---|---|
| Customer code → Delegation Cloud training data | **Prohibited.** Customer code is never used to train, fine-tune, or improve Delegation Cloud models or systems |
| Customer code → marketing material | **Prohibited.** No repository names, code snippets, architecture details, or findings appear in marketing without explicit written customer consent |
| Engagement findings → other customers | **Prohibited.** Findings are scoped to the engagement. Generic lessons (e.g., "many apps miss CSP headers") may inform the rubric but never reference a specific customer |
| Customer identity → AI provider | **Prohibited.** AI prompts carry engagement ID, not customer name, organization, or contact information |
| Report → public disclosure | **Prohibited.** The report is delivered to the customer only. Delegation Cloud does not publish, share, or reference the report externally |

---

## 5. Remediation sprint data boundaries

The remediation sprint inherits all boundaries above, plus:

| Additional boundary | Rule |
|---|---|
| Write scope | Executor writes only to a named feature branch in the scoped repository. No direct writes to `main`, `production`, or protected branches |
| PR content | Pull requests contain only changes that address findings from the delivered report. No unrelated changes |
| Merge authority | **Customer merges.** The executor never merges a PR |
| Extended token lifetime | Up to 14 calendar days (vs. 7 for review-only). Same auto-revocation at sprint close |
| Code authored by executor | Becomes customer-owned on merge. Delegation Cloud retains no copy |

---

## 6. Incident handling

If a data-boundary violation is detected:

1. **Immediate containment** — revoke affected tokens, isolate the engagement
2. **Notification** — inform the customer within 24 hours with a description of what was accessed
3. **Root cause** — document the violation in the engagement audit log
4. **Remediation** — purge any improperly retained data, patch the control failure
5. **Post-incident** — update the rubric, security model, or tooling to prevent recurrence
