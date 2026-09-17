# WS-REV-01 Service Architecture

Version: 1.0.0-draft
Service: AI App Release-Readiness Review

## 1. Service definition

| Property | Value |
|---|---|
| Service ID | `WS-REV-01` |
| Name | AI App Release-Readiness Review |
| Price | $299 fixed (review) + optional $1,250 (remediation sprint) |
| Scope | One repository, one web application, one critical workflow |
| Target turnaround | 48 hours from access granted to draft report |
| Authority class | `prepare_only` (review) / `low_risk_execution` (remediation) |
| Workstream stage | Stage 1 — Managed delegation |

---

## 2. Service promise

A founder or lead engineer receives a structured, evidence-backed assessment
of their AI-powered web application's production readiness. The review covers
architecture, security, code quality, accessibility, deployment, and the
critical user workflow they care about most.

The customer does not manage the review process. They provide access, confirm
scope, and receive a report with prioritized, actionable findings.

---

## 3. Engagement flow

```
Customer                     Delegation Cloud                  Executor
   │                              │                              │
   ├─ Request review ────────────►│                              │
   │                              ├─ Create engagement           │
   │                              ├─ Confirm scope ─────────────►│
   │◄─ Scope confirmation ────────┤                              │
   │                              │                              │
   ├─ Grant repo access ─────────►│                              │
   │                              ├─ Store token (encrypted)     │
   │                              ├─ Create Delegation Spec      │
   │                              ├─ Assign executor ───────────►│
   │                              │                              │
   │                              │    ┌─ Clone (read-only)      │
   │                              │    ├─ Run rubric             │
   │                              │    ├─ Collect evidence       │
   │                              │    ├─ Score categories       │
   │                              │    └─ Draft report           │
   │                              │                              │
   │                              │◄── Submit draft ─────────────┤
   │                              ├─ Internal QA                 │
   │◄─ Draft report ──────────────┤                              │
   │                              │                              │
   ├─ Accept / request changes ──►│                              │
   │                              ├─ Finalize report             │
   │◄─ Final report ──────────────┤                              │
   │                              ├─ Revoke token                │
   │                              ├─ Close engagement            │
   │                              │                              │
   ├─ (Optional) Accept sprint ──►│                              │
   │                              ├─ New Delegation Spec         │
   │                              ├─ Assign executor ───────────►│
   │                              │    (remediation scope)       │
   │                              │                              │
```

---

## 4. Delegation Spec structure

Each engagement produces a Delegation Spec that governs executor authority.

### 4.1 Review Delegation Spec

```yaml
delegation_spec:
  id: string
  engagement_id: string
  workstream: "WS-REV-01"
  authority_class: prepare_only
  scope:
    repository: string          # Single repo URL
    access_level: read_only
    deployment_url: string | null
    critical_workflow: string
  constraints:
    max_duration_hours: 48
    hard_ceiling_days: 7
    ai_assisted: boolean        # Customer opt-in
    no_write_operations: true
    no_external_communication: true
    no_deployment: true
  deliverable:
    type: structured_report
    schema_version: "1.0.0"
  executor_requirements:
    minimum_rubric_coverage: all_categories
    evidence_required: per_finding
```

### 4.2 Remediation Delegation Spec

```yaml
delegation_spec:
  id: string
  engagement_id: string
  workstream: "WS-REV-01-REMEDIATION"
  authority_class: low_risk_execution
  scope:
    repository: string
    access_level: read_write
    branch_restriction: "rescue/{engagement_id}"
    findings_scope: string[]    # Finding IDs from the review report
  constraints:
    max_duration_hours: 120
    hard_ceiling_days: 14
    no_merge: true              # Customer merges
    no_deployment: true
    no_main_branch_write: true
    customer_approval_per_pr: true
  deliverable:
    type: pull_requests
    report_update: true
```

---

## 5. Executor routing

| Criterion | Routing decision |
|---|---|
| Standard review | Qualified operator with code-review experience |
| AI-assisted review (customer opt-in) | Operator + AI executor pair. AI produces initial analysis; operator reviews, verifies, and owns the report |
| Remediation sprint | Qualified operator or executor with implementation authority for the reviewed stack |
| Escalation | If the app involves regulated domains (healthcare, finance), the review notes the limitation and recommends specialized assessment. See `NON-CLAIMS.md` |

Executor qualification for WS-REV-01:
- Demonstrated experience with the reviewed stack (Next.js, React, Node.js, etc.)
- Familiarity with the full audit rubric
- Completion of at least one supervised review before solo assignment

---

## 6. Quality assurance

### 6.1 Pre-delivery QA checklist

| Check | Owner |
|---|---|
| All rubric categories scored | Executor |
| Every finding has evidence | Executor |
| No secret values in report | Automated scan + QA reviewer |
| Report schema validates | Automated validation |
| Non-claims section present and unmodified | QA reviewer |
| Severity ratings are consistent with evidence | QA reviewer |
| Recommendations are specific and actionable | QA reviewer |
| Spelling, grammar, and clarity | QA reviewer |

### 6.2 Remediation QA

| Check | Owner |
|---|---|
| Each PR addresses a specific finding | QA reviewer |
| No unrelated changes in PRs | QA reviewer |
| PR descriptions reference finding IDs | Executor |
| Tests pass (where tests exist) | Automated (CI) |
| No new findings introduced | QA reviewer |

---

## 7. Integration with Delegation Cloud

### 7.1 Platform primitives used

| Primitive | Usage |
|---|---|
| Engagement (workstream instance) | One per review request |
| Delegation Spec | Authority contract for each phase |
| Audit events | All access, transitions, and deliveries logged |
| Evidence artifacts | Report and findings stored with content hashes |
| Organization scope | Engagement bound to `organization_id` |
| Approval flow | Used for remediation PR approvals |

### 7.2 Surfaces

| Surface | Functionality |
|---|---|
| `/app` (customer workspace) | Request review, track status, receive report, approve remediation PRs |
| `/ops` (operations) | Manage engagement queue, assign executors, run QA, deliver reports |

### 7.3 Billing

| Item | Mechanism |
|---|---|
| $299 review | Single charge at engagement creation. Refundable if review not started |
| $1,250 remediation | Charged only on customer acceptance of sprint upsell. Scoped to review findings |
| Payment processing | Via existing Stripe integration (mocked until keys configured) |

---

## 8. SLA and operational targets

| Metric | Target |
|---|---|
| Time to draft report | 48 hours from access granted |
| Time to final report | 24 hours after customer review feedback |
| Remediation sprint duration | 5 business days from access granted |
| Token revocation after close | Within 1 hour of engagement close |
| Customer response time | Best effort during business hours |

These are operational targets, not contractual SLAs. See `NON-CLAIMS.md` for
what the service does not guarantee.

---

## 9. Constraints and non-goals

- This service does not replace a penetration test, security audit by a
  certified firm, or compliance certification.
- This service does not provide ongoing monitoring or maintenance.
- The review is point-in-time: it reflects the repository state at the
  reviewed commit SHA.
- Executor authority is bounded by the Delegation Spec. No implicit authority.
- This service does not touch StageForge, Loadout, or other internal
  platform systems.
