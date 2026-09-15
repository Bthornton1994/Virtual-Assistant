# WS-REV-01 Report Schema

Version: 1.0.0-draft
Format: Customer-safe structured report

## Governing constraints

- The report is the primary deliverable of the $299 review engagement.
- It must be understandable by a technical founder or lead engineer.
- It must never contain secret values, credentials, or raw customer PII.
- Every finding must reference evidence that the customer can independently verify.
- The report explicitly states what the review is and is not (see `NON-CLAIMS.md`).

---

## 1. Report envelope

```yaml
report:
  schema_version: "1.0.0"
  engagement_id: string         # Delegation Cloud engagement ID
  organization_id: string       # Customer organization (internal reference)
  created_at: ISO-8601
  delivered_at: ISO-8601 | null
  status: draft | delivered | superseded

  scope:
    repository_url: string      # e.g., "github.com/acme/webapp" (no token)
    repository_ref: string      # Commit SHA or branch at time of review
    deployment_url: string | null
    app_type: string            # e.g., "Next.js web application"
    critical_workflow: string   # Customer-defined, e.g., "user signup → first purchase"

  reviewer:
    executor_type: human | ai_assisted | hybrid
    executor_id: string         # Internal; not exposed in customer report

  non_claims:                   # Always present; see NON-CLAIMS.md
    - "This review is not a penetration test."
    - "This review is not a compliance certification."
    - "This review does not guarantee the absence of security vulnerabilities."
    - "Findings are based on source-code review and observable behavior at a point in time."
```

---

## 2. Summary section

```yaml
summary:
  overall_readiness: ready | ready_with_caveats | not_ready
  critical_findings: integer    # Count of severity: critical
  high_findings: integer        # Count of severity: high
  medium_findings: integer
  low_findings: integer
  informational_findings: integer
  recommendation: string        # 1-3 sentence plain-language summary
  remediation_estimate: string | null  # e.g., "Addressable in the $1,250 remediation sprint"
```

The `overall_readiness` field:
- `ready` — no critical or high findings. App can ship with minor attention.
- `ready_with_caveats` — no critical findings, but high findings require action before or shortly after launch.
- `not_ready` — critical findings that should be resolved before production release.

---

## 3. Rubric scores

Each rubric category (see `AUDIT-RUBRIC.md`) produces a structured score.

```yaml
rubric_scores:
  - category: string            # e.g., "authentication"
    score: 1 | 2 | 3 | 4 | 5   # 1 = critical gaps, 5 = production-ready
    label: string               # Human-readable, e.g., "Needs work"
    summary: string             # 1-2 sentence category summary
    findings_count: integer
```

Score labels:
| Score | Label | Meaning |
|---|---|---|
| 1 | Critical gaps | Blocking issues that prevent safe release |
| 2 | Needs work | Significant issues that should be fixed before release |
| 3 | Acceptable | Functional but with improvement opportunities |
| 4 | Good | Minor improvements possible; release-ready |
| 5 | Excellent | No findings; meets or exceeds expectations |

---

## 4. Findings

Each finding is a self-contained, verifiable observation.

```yaml
findings:
  - id: string                  # e.g., "AUTH-001"
    category: string            # Rubric category
    severity: critical | high | medium | low | informational
    title: string               # Short, specific. e.g., "Session token stored in localStorage"
    description: string         # What was found, in plain language
    evidence:
      type: code_reference | config_reference | runtime_observation | dependency_report
      location: string          # File path, URL, or tool output reference
      snippet: string | null    # Relevant code/config (never contains secret values)
      observation: string | null # What was observed at runtime
    impact: string              # What could go wrong if not addressed
    recommendation: string      # Specific, actionable fix
    effort: trivial | small | medium | large  # Estimated remediation effort
    remediation_sprint_eligible: boolean
    references: string[]        # Links to relevant docs, OWASP, etc.
```

### 4.1 Finding constraints

- `snippet` must never contain actual secret values. If a secret is found in
  code, the snippet shows the pattern with the value replaced:
  `API_KEY = "REDACTED_VALUE_FOUND_IN_SOURCE"`
- `location` uses relative file paths within the repository, never absolute
  paths that reveal server structure.
- `evidence.type` must be one of the defined types. No free-form evidence.
- Every finding must have at least one evidence entry.

---

## 5. Recommendations section

```yaml
recommendations:
  immediate:                    # Before release
    - finding_id: string
      action: string
  short_term:                   # Within 2 weeks of release
    - finding_id: string
      action: string
  long_term:                    # Ongoing improvements
    - finding_id: string
      action: string

  remediation_sprint:
    eligible: boolean
    eligible_findings: string[] # Finding IDs addressable in the sprint
    estimated_scope: string     # Plain-language scope description
```

---

## 6. Appendices

```yaml
appendices:
  dependency_summary:
    total_dependencies: integer
    outdated: integer
    known_vulnerabilities:
      critical: integer
      high: integer
      medium: integer
      low: integer
    tool_used: string           # e.g., "npm audit", "Trivy"

  ci_cd_summary:
    pipeline_present: boolean
    lint_configured: boolean
    typecheck_configured: boolean
    test_configured: boolean
    build_configured: boolean
    deployment_target: string | null

  accessibility_summary:
    tool_used: string           # e.g., "axe-core", "Lighthouse"
    pages_tested: integer
    critical_violations: integer
    serious_violations: integer

  review_metadata:
    review_start: ISO-8601
    review_end: ISO-8601
    repository_ref: string      # Commit SHA reviewed
    tools_used: string[]        # Analysis tools used during review
    ai_assisted: boolean
    ai_provider: string | null  # Only if ai_assisted is true
```

---

## 7. Schema evolution

- `schema_version` follows semver.
- Adding optional fields is a minor version bump.
- Removing or renaming fields is a major version bump.
- Customers receive reports in the schema version current at engagement start.
- Older reports remain valid; the system never retroactively modifies delivered reports.

---

## 8. Delivery format

| Format | Purpose |
|---|---|
| Rendered HTML/PDF | Primary customer deliverable. Readable, printable |
| Structured YAML/JSON | Machine-readable for customer tooling integration |
| Delegation Cloud dashboard | In-app view with finding status tracking |

The customer receives both the rendered and structured formats.
The Delegation Cloud dashboard view is available for the retention period.
