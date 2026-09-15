# WS-REV-01 Non-Claims

Version: 1.0.0-draft
Scope: AI App Release-Readiness Review ($299) and optional Remediation Sprint ($1,250)

## Purpose

This document defines what the AI App Release-Readiness Review explicitly
**does not** claim, promise, or provide. These non-claims must appear in
every report delivered to a customer (in the `non_claims` field of the
report schema) and must be presented during intake.

---

## 1. Not a penetration test

This review is **not a penetration test.** The review examines source code,
configuration, dependencies, and observable browser behavior. It does not
attempt to exploit vulnerabilities, perform network scanning, conduct social
engineering, test physical security, or simulate adversarial attacks.

Customers who need penetration testing should engage a qualified security
firm that specializes in offensive security assessments.

---

## 2. Not a compliance certification

This review is **not a compliance certification.** It does not certify
conformance with SOC 2, ISO 27001, HIPAA, PCI DSS, GDPR, CCPA, FedRAMP,
or any other regulatory or industry standard.

The review may note areas relevant to compliance readiness (e.g., "audit
logging is absent"), but these observations are informational and do not
constitute a compliance assessment.

Customers pursuing compliance certification should engage an accredited
auditor for the applicable framework.

---

## 3. No guaranteed security

This review **does not guarantee the absence of security vulnerabilities.**
Source-code review and behavioral observation can identify many classes of
issues, but no review methodology—automated or manual—can guarantee that
all vulnerabilities have been found.

The review provides a structured, evidence-backed assessment of
production readiness at a specific point in time. It reduces risk; it does
not eliminate it.

---

## 4. Point-in-time assessment

The review reflects the state of the repository at the **specific commit SHA**
reviewed and the application behavior at the time of observation. Changes
made after the review—new code, dependency updates, configuration changes,
infrastructure modifications—are not covered.

If the customer makes significant changes after the review and before release,
a follow-up assessment is recommended.

---

## 5. Single-scope limitation

The review covers **one repository, one web application, and one critical
workflow.** It does not cover:

- Other repositories, microservices, or backend systems not in the scoped repo
- Mobile applications (native iOS/Android)
- Desktop applications
- Third-party services, APIs, or SaaS platforms the application depends on
  (though integration patterns may be noted)
- Infrastructure security (cloud provider configuration, network architecture,
  container orchestration)
- Physical security or operational security procedures

---

## 6. Not legal, regulatory, or professional advice

The review does not constitute legal advice, regulatory guidance, or
professional consulting in any licensed domain. Findings and recommendations
are technical observations, not legal opinions.

Customers should consult qualified professionals for legal, regulatory,
financial, or domain-specific compliance questions.

---

## 7. No ongoing monitoring

The review is a one-time engagement. It does not include ongoing security
monitoring, vulnerability scanning, dependency tracking, or incident response.

Customers are responsible for maintaining the security posture of their
application after the review.

---

## 8. Remediation sprint limitations

The optional $1,250 remediation sprint:

- Addresses only findings from the completed review report
- Does not guarantee that all findings will be resolved (scope is bounded by
  the sprint duration and finding complexity)
- Produces pull requests that the **customer must review and merge**
- Does not include deployment or production release
- Does not create new features, refactor architecture, or perform work outside
  the review findings
- Is subject to the same non-claims above (not a pen test, not compliance, etc.)

---

## 9. AI-assisted review transparency

When the customer opts into AI-assisted review:

- AI analysis is reviewed and verified by a human executor before inclusion
  in the report
- AI-generated observations are not presented as expert opinions
- The AI provider receives code snippets scoped to the analysis, not the full
  repository or customer identity
- AI assistance improves coverage and speed but does not change the nature
  of the review (it remains a code review, not a penetration test or
  compliance audit)

---

## 10. No revenue, customer, or market claims

This service offering:

- Does not claim existing customers, revenue, or market traction
- Does not reference customer names, logos, or case studies without explicit
  written consent
- Does not guarantee customer acquisition, retention, or satisfaction outcomes
- Does not present pricing as validated by market evidence unless such evidence
  exists and is documented

---

## Report inclusion

The following text must appear verbatim in every delivered report:

> **Important limitations**
>
> This review is not a penetration test. It is not a compliance certification
> (SOC 2, ISO 27001, HIPAA, PCI DSS, or any other standard). It does not
> guarantee the absence of security vulnerabilities.
>
> Findings are based on source-code review and observable behavior at a
> specific point in time. Changes made after the reviewed commit are not
> covered.
>
> This review covers one repository, one web application, and one critical
> workflow. It does not constitute legal, regulatory, or professional advice.
>
> Customers who need penetration testing, compliance certification, or
> ongoing security monitoring should engage qualified specialists for those
> services.
