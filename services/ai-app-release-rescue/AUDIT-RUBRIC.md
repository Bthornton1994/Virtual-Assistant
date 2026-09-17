# WS-REV-01 Audit Rubric

Version: 1.0.0-draft
Scope: AI App Release-Readiness Review

## Governing principle

Every rubric category produces a score (1-5), a summary, and zero or more
findings. Every finding includes evidence the customer can independently
verify. The rubric is applied consistently across engagements.

---

## Scoring scale

| Score | Label | Definition |
|---|---|---|
| 1 | Critical gaps | Blocking issues that prevent safe production release |
| 2 | Needs work | Significant issues; fix before release |
| 3 | Acceptable | Functional with clear improvement paths |
| 4 | Good | Minor improvements possible; release-ready |
| 5 | Excellent | No findings; meets or exceeds production expectations |

---

## Category 1: Code Quality

**What we examine:**
- Project structure, module boundaries, and separation of concerns
- TypeScript strictness and type safety
- Error handling patterns (try/catch, error boundaries, fallback states)
- Code duplication and unnecessary complexity
- Dependency health (outdated packages, known vulnerabilities, abandoned deps)
- Linting and formatting configuration and enforcement
- Test presence and coverage of critical paths

**Evidence sources:** Static analysis, dependency audit, linter output, manual review

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | No type safety, no linting, critical dependencies vulnerable, no tests |
| 2 | Partial type coverage, linting present but not enforced, outdated deps with known CVEs |
| 3 | TypeScript strict mode or equivalent, linting enforced, deps reasonably current, some tests |
| 4 | Strong type coverage, clean lint, deps current, tests cover critical paths |
| 5 | Comprehensive types, zero lint warnings, deps audited, meaningful test coverage |

---

## Category 2: Authentication

**What we examine:**
- Authentication mechanism (session, JWT, OAuth, etc.)
- Session management (creation, expiry, rotation, invalidation)
- Password/credential handling (hashing, storage, reset flow)
- Multi-factor authentication availability
- Authentication bypass risks (unprotected routes, middleware gaps)
- Token storage (cookie attributes, localStorage risks)
- Auth state consistency between client and server
- Rate limiting on auth endpoints

**Evidence sources:** Code review of auth modules, route protection analysis, runtime observation

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | No auth, credentials in plaintext, sessions never expire, auth easily bypassed |
| 2 | Auth present but misconfigured: weak sessions, no CSRF protection, unprotected routes |
| 3 | Standard auth implementation, secure session handling, routes protected, basic rate limiting |
| 4 | Robust auth with proper token rotation, MFA available, comprehensive route protection |
| 5 | Defense-in-depth auth: secure defaults, MFA, brute-force protection, auth state consistency |

---

## Category 3: Data Access

**What we examine:**
- Database query patterns (parameterized vs. string concatenation)
- ORM/query builder usage and configuration
- Row-level security or equivalent tenant isolation
- Input validation and sanitization at API boundaries
- Authorization checks on data operations (not just authentication)
- Data exposure in API responses (over-fetching, sensitive field leakage)
- GraphQL/REST endpoint authorization granularity

**Evidence sources:** Code review of data layer, API endpoint analysis, query pattern analysis

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | SQL injection risks, no input validation, no authorization on data ops, PII exposed in responses |
| 2 | Parameterized queries but inconsistent validation, authorization gaps, some over-fetching |
| 3 | Consistent parameterized queries, input validation at boundaries, basic authorization checks |
| 4 | ORM with type-safe queries, comprehensive validation, fine-grained authorization, minimal data exposure |
| 5 | Defense-in-depth: RLS + app-layer auth, validated inputs, minimal API surface, no unnecessary exposure |

---

## Category 4: Secrets and Configuration

**What we examine:**
- Secret storage (environment variables, config files, vaults)
- Secrets in source control (committed `.env` files, hardcoded keys)
- Secret rotation capability
- Environment separation (dev/staging/production config isolation)
- Client-side exposure of server secrets (bundle analysis)
- `.gitignore` and secret-scanning configuration
- Third-party service credential handling

**Evidence sources:** Repository scan, `.env.example` review, bundle analysis, git history spot-check

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | Secrets committed to git, hardcoded API keys, no env separation, server keys in client bundle |
| 2 | Most secrets in env vars but some hardcoded, `.env` committed, incomplete `.gitignore` |
| 3 | Secrets in env vars, `.gitignore` covers sensitive files, env separation present |
| 4 | Clean secret handling, no history leaks, env separation enforced, secret scanning configured |
| 5 | Vault or managed secrets, rotation policy, scanning in CI, zero server secrets reachable from client |

---

## Category 5: Browser Flow

**What we examine (critical workflow):**
- The customer-defined critical workflow end-to-end
- Client-side routing and navigation correctness
- Form submission and validation (client + server)
- Error states and recovery paths
- Loading states and optimistic updates
- API error handling in the UI
- Cross-browser baseline (latest Chrome, Firefox, Safari)
- Mobile/responsive behavior on the critical path
- Content Security Policy (CSP) and security headers
- XSS, CSRF, and clickjacking protections

**Evidence sources:** Manual walkthrough, browser DevTools, security headers check, Lighthouse

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | Critical workflow broken, no error handling, XSS vulnerabilities, no security headers |
| 2 | Workflow functional but fragile: missing error states, inconsistent validation, weak headers |
| 3 | Workflow completes reliably, basic error handling, security headers present |
| 4 | Polished workflow with proper error/loading states, strong CSP, CSRF protection |
| 5 | Resilient workflow, graceful degradation, comprehensive security headers, no client-side vulnerabilities |

---

## Category 6: Accessibility

**What we examine:**
- Semantic HTML structure
- ARIA attributes (correct usage, not over-decoration)
- Keyboard navigation on the critical workflow
- Focus management (modals, route changes, dynamic content)
- Color contrast ratios (WCAG AA minimum)
- Screen reader compatibility on critical surfaces
- Form labels, error announcements, and required-field indicators
- Reduced-motion support
- Touch targets on mobile

**Evidence sources:** axe-core or Lighthouse audit, manual keyboard walkthrough, contrast checker

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | No semantic HTML, inaccessible forms, keyboard navigation broken, contrast failures |
| 2 | Some semantic structure, partial keyboard support, contrast issues on key surfaces |
| 3 | Semantic HTML, keyboard-navigable critical path, WCAG AA contrast, labeled forms |
| 4 | Comprehensive semantics, ARIA where needed, focus management, reduced-motion support |
| 5 | Exemplary a11y: screen-reader tested, skip links, live regions, AA+ contrast, motion preferences |

---

## Category 7: CI/CD

**What we examine:**
- CI pipeline presence and configuration
- Automated lint, typecheck, test, and build steps
- Branch protection and merge requirements
- Automated dependency/vulnerability scanning
- Deployment pipeline (manual vs. automated, preview deployments)
- Environment promotion strategy
- Rollback capability
- Secret injection in CI (not hardcoded in config)

**Evidence sources:** CI config files, branch protection settings, pipeline run history (if accessible)

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | No CI, manual deployment only, no branch protection, secrets in CI config |
| 2 | Basic CI but incomplete (e.g., build-only, no tests), weak branch protection |
| 3 | CI runs lint + typecheck + test + build, branch protection enabled, manual deploy |
| 4 | Full CI with dependency scanning, preview deploys, automated production deploy with gates |
| 5 | Comprehensive pipeline: security scanning, canary/staged rollouts, rollback automation, audit trail |

---

## Category 8: Deployment

**What we examine:**
- Hosting environment suitability for the application
- Environment variable management in production
- HTTPS enforcement and certificate management
- Domain and DNS configuration
- CDN and edge caching strategy
- Monitoring and error tracking (at minimum, crash reporting)
- Log management and retention
- Backup and disaster recovery posture (basic)
- Scalability considerations for expected traffic

**Evidence sources:** Deployment config, hosting dashboard (if accessible), DNS check, SSL check

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | No production deployment, or deployed without HTTPS, no monitoring, no error tracking |
| 2 | Deployed with HTTPS but no monitoring, no error tracking, manual scaling only |
| 3 | HTTPS enforced, basic error tracking, deployment target matches app requirements |
| 4 | Monitoring + error tracking, CDN configured, reasonable scaling, env vars managed securely |
| 5 | Full observability, automated scaling, CDN optimized, disaster recovery plan, zero-downtime deploys |

---

## Category 9: Evidence and Documentation

**What we examine:**
- README completeness (setup, run, test, deploy instructions)
- API documentation or schema definitions
- Architecture decision records or equivalent
- Changelog or release notes
- Contributing guidelines (if applicable)
- Inline documentation of non-obvious patterns
- Environment setup documentation
- Known limitations and technical debt tracking

**Evidence sources:** Repository documentation review, code comments review

**Scoring guide:**
| Score | Criteria |
|---|---|
| 1 | No README, no setup instructions, no documentation of any kind |
| 2 | Minimal README, setup instructions incomplete or outdated |
| 3 | README covers setup and run, basic API docs or types, some architecture notes |
| 4 | Comprehensive README, API documented, architecture decisions recorded, known issues tracked |
| 5 | Thorough documentation: onboarding guide, API reference, ADRs, runbooks, up-to-date changelog |

---

## Rubric application rules

1. **Complete coverage.** Every category must be scored. If a category is not
   applicable (e.g., no CI exists), score it and note the absence as a finding.

2. **Evidence-backed.** Every score must cite specific evidence. A score of 4
   or 5 requires positive evidence, not just the absence of findings.

3. **Consistent severity.** Use the severity scale from `REPORT-SCHEMA.md`
   consistently. A finding that affects the critical workflow is at least
   `high`. A finding that could lead to data breach is `critical`.

4. **Actionable recommendations.** Every finding at severity `medium` or above
   must include a specific, implementable recommendation.

5. **No scope creep.** Score only what is observable within the defined scope:
   one repository, one app, one critical workflow. Note when a finding suggests
   broader issues but do not investigate outside scope.

6. **Remediation eligibility.** Mark each finding's `remediation_sprint_eligible`
   field. Findings that require architectural redesign, third-party vendor
   changes, or regulatory compliance work are not eligible.
