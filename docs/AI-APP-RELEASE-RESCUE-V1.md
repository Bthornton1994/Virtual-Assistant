# AI App Release Rescue v1

The architecture and security foundation for a fixed-price release-readiness review.

The offer is a **$299 review** covering **one repository, one application, and one critical workflow**, with a **$1,250 remediation sprint** available afterwards. The review reads source, configuration, and dependency manifests at a single commit and produces one signed, content-hashed report.

It is **not a penetration test, not a compliance certification, and not a security guarantee**. Those three claims are refused at intake, disclaimed on every report, and enforced in code (`findProhibitedClaims`).

This document is the security foundation. It does not authorize a launch, a payment flow, a production deployment, or any external action.

## Vision classification

**Aligns with constraints.**

The workstream fits `VISION.md` § *Quality assurance is part of delivery*, § *Use the right executor for each step*, and § *Security follows delegated authority*: a customer delegates an outcome ("tell me whether this is safe to ship"), Delegation Cloud routes it, verifies it, and a human remains accountable. Findings are drafted by an AI executor and are never authoritative on their own, which is § *Manual first, automation after proof*.

The constraints, each of which is implemented rather than promised:

- The review is **prepare-only** (`VISION.md` § *Authority is explicit and bounded*). The auditor reads and reports. A non-zero authority report fails the deterministic gate.
- Repository access is **least-privilege, intentional, logged, and removable** (§ *Security follows delegated authority*). Read-only, time-boxed at 30 days, customer-granted, customer-revocable, and never held as a credential by us.
- Customer source **never crosses organizations** (§ *Workflow memory compounds value*). Row level security on every table; no cross-tenant generalization of findings in v1.

**One tension the owner should resolve.** `VISION.md` § *Scope and non-goals* lists the initial workstreams as "executive operations, inbox, sales support, meetings, research, customer operations, content operations, and back-office operations." A technical release-readiness review is not among them, and its buyer is a technical founder rather than the operator accountable for administrative throughput. The vision is **silent** on whether Delegation Cloud sells engineering-adjacent assurance work.

This foundation is built so that answering "no" costs little: the workstream is self-contained behind its own contracts and tables. **It should not be launched until the owner decides whether this workstream belongs in the product.** I have not edited `VISION.md`; that is an owner decision.

## Architecture

The workstream owns no new primitives it could borrow. It rides the existing ones:

| Concern | Existing primitive reused |
| --- | --- |
| Authority ceiling | `delegation_specs` (`action_class = 'prepare_only'`) |
| Execution | `workstream_runs` |
| Findings and report body | `evidence_artifacts`, discriminated by `payload->>'schemaVersion'` |
| Verification | `outcome_receipts`, Gauntlet receipt guard |
| Executor staffing and authority envelope | `executor_profiles`, `run_executor_assignments` |

Three tables are new, because nothing existing carries their meaning:

- `release_rescue_engagements` — the frozen scope, the retention election, and the purge deadline.
- `release_rescue_repository_grants` — the fact that access was granted, its window, and its revocation.
- `release_rescue_reports` — the accounting row binding a report body to its engagement, rubric, hash, verdict, and human reviewer.

Six application modules, all pure and deterministic:

| Module | Responsibility |
| --- | --- |
| `src/lib/release-rescue-rubric.ts` | The frozen, content-hashed rubric: 24 checks across 9 dimensions, 12 of them release-gating |
| `src/lib/release-rescue-intake.ts` | Offer terms, scope ceiling, service refusals, attestations, retention election |
| `src/lib/release-rescue-redaction.ts` | Secret detection and fail-closed redaction of evidence excerpts |
| `src/lib/release-rescue-findings.ts` | The finding contract and the derived severity model |
| `src/lib/release-rescue-report.ts` | Report schema, deterministic assembly, validation, delivery gate |
| `supabase/migrations/20260915120000_release_rescue_v1.sql` | Isolation, credential refusal, immutability, retention |

## Release-readiness audit rubric

`release-rescue-rubric/v1` — 24 checks, 9 dimensions, total coverage weight 57.

Each check has one question, a set of acceptable evidence kinds, a coverage weight (1–3), and a `blocking` flag. The rubric is hashed at module load; every report records `rubricVersion` and `rubricHash`, so editing the rubric without a version bump makes previously issued reports visibly stop matching instead of silently drifting.

| Dimension | Checks | Gating checks |
| --- | --- | --- |
| Secrets and credentials | 3 | committed secrets, client-reachable secrets |
| Authentication and session | 3 | server-enforced boundary, session integrity |
| Authorization and tenancy | 3 | object-level authorization, tenant isolation at the data layer |
| AI boundary | 4 | untrusted input is not authority, tool authority bounded, output sink handling |
| Data handling and retention | 3 | — |
| Input validation and abuse | 2 | boundary validation |
| Dependency and supply chain | 1 | — |
| Release operations | 3 | environment separation, migration and rollback |
| Observability and incident response | 2 | — |

Weight is **coverage** weight — how much of a dimension was actually examined. It is deliberately not a security score. A single number claiming "your app is 84% secure" is exactly the false precision this offer promises not to sell.

Two rules give the rubric teeth:

- **Every check needs an assessment**, including `not_assessed` with a stated reason. A silently absent check is rejected by the validator, and coverage counts a missing row as unassessed so it cannot flatter the report.
- **A gating check cannot be passed on argument alone.** `reasoned_argument` is not artifact evidence; passing a blocking check requires a code, configuration, test, policy, manifest, or runtime reference that a second reader can open. This is what stops "I reviewed the auth code and it looked fine" from clearing a release gate.

## Customer intake boundaries

`evaluateIntake(input, now)` is the only door. It is pure and takes `now` as a parameter, so two callers cannot disagree about the same submission.

**Scope ceiling.** Exactly one repository, one application, one critical workflow. A fixed price is only honest against a fixed scope.

**Refused services.** `penetration_test`, `compliance_certification`, `security_guarantee`, `production_environment_access`, `third_party_vendor_assessment`, and `remediation_implementation` are declined with a stated reason. Refusing `remediation_implementation` from the review is deliberate twice over: it is the separate paid sprint, and it keeps the reviewer independent of the remediation it may go on to recommend.

Out-of-scope asks **decline without rejecting the engagement** — a customer who wants a review and also asks whether we do pentesting should get the review and a clear no. A submission requesting nothing in scope is refused outright.

**Attestations** are all `z.literal(true)`, so an intake missing any of them does not parse:

| Attestation | Why it is a hard gate |
| --- | --- |
| `authorizedToGrantRepositoryAccess` | The primary control against auditing someone else's code |
| `accessGrantedIsReadOnly` | Matches the only access level the schema permits |
| `noProductionCredentialsProvided` | We do not take production credentials, ever |
| `noEndUserPersonalDataProvided` | The snapshot is code, not customer records |
| `understandsNotPenetrationTest` / `NotComplianceCertification` / `NoSecurityGuarantee` | The customer meets the limits before paying, not in the report footer |
| `understandsFindingsRequireCustomerAction` | The review identifies; the customer fixes |

**Repository reference shape.** `owner/name` only. A URL field would invite `https://user:token@host/owner/repo` — a credential arriving through an intake form and landing in a database column. The shape is refused rather than scrubbed, which removes the opportunity instead of trying to clean up after it.

**Commit pinning.** A full 40-character lowercase SHA is required. A review that cannot name what it reviewed is not reproducible and cannot be defended later.

## Repository and artifact handling

**We never hold the customer's repository credential.** Access is granted by the customer, inside their own provider, by one of three methods: installing a read-only app, adding a read-only collaborator, or uploading an archive. What we store is the *fact* of the grant.

Enforced at the database boundary:

- `access_level` is constrained to `'read_only'`. There is no write mode.
- No credential, token, secret, key, or password column exists on any table. A migration test asserts this, so adding one fails CI.
- `metadata` is JSONB, which is exactly where someone would put a credential under time pressure, so a trigger rejects credential-named keys *and* credential-shaped values (AWS, GitHub classic and fine-grained, Slack, Stripe, Anthropic, Google, PEM, JWT).
- Every grant expires. Maximum window 30 days, enforced in the trigger and again at intake.
- A grant is a historical fact: it may only be **revoked**, never edited, and revocation is one-way.
- Revocation is available to the customer at any time without asking us. `VISION.md` requires delegated access to be removable; that has to mean removable by the person who granted it.

**Artifacts.** Findings and the report body are ordinary immutable `evidence_artifacts` rows, following the Step 3D precedent — `authenticated` holds only `select` and `insert` on that table, which is precisely the immutability these artifacts need. No parallel evidence store was added.

**Excerpts are proof, not copies.** Capped at 480 characters and redacted before storage. `prepareExcerpt` redacts *then* truncates: truncating first could cut a credential in half and leave a fragment that no detector recognises but that still narrows the key for anyone holding the rest.

## Data isolation and retention rules

**Isolation.** Row level security on all three tables, with every `select` policy scoped to `my_org_ids()` or platform staff. Child rows are bound to their parent's organization by composite foreign key, so a row cannot name organization A while pointing at an engagement owned by B. No table grants `delete` to `authenticated`.

The validation triggers run `security definer`. Beyond fixing a real defect — `authenticated` has no read grant on `public.operators`, so the reviewer-authority check could not run at all — this is the correct posture for a validation trigger: it must see **true** state, not the caller's RLS-filtered view. Under invoker rights, a cross-tenant check can be defeated by making the conflicting row invisible, so the check passes because the row it should have found simply is not there. Both functions only read and raise, run no dynamic SQL, and have a locked `search_path`.

**Retention** is a stored deadline with an idempotent sweep, not a sentence in a policy document.

| Election | Days retained after delivery |
| --- | --- |
| `purge_on_delivery` | 0 |
| `minimum_7_day` | 7 |
| `standard_30_day` | 30 |

- `retention_days` is derived from the elected policy in the trigger. Two fields that can disagree about how long we keep a customer's source is a bug waiting to become a privacy incident.
- Retention may be **shortened, never extended**. `purge_after` may only move earlier.
- An engagement that stalls before delivery still expires: an absolute 60-day backstop is stamped at insert.
- `purge_expired_release_rescue_data()` is `security definer`, revoked from `anon` and `authenticated`, granted only to `service_role`, and idempotent — a second sweep returns 0, so it is safe to schedule.

**What the purge removes, and what survives.** The sweep deletes the Release Rescue evidence artifacts, clears the engagement's scope content and attestations, and revokes any live grant. The `release_rescue_reports` **accounting row survives** with its hashes, verdict, and counts. After a purge we can still prove an engagement happened and what verdict was issued while holding none of the customer's source-derived content.

Evidence artifacts are otherwise immutable, which is right for evidence and wrong for a customer's source excerpts after their retention window closes. The migration adds one narrow carve-out to `enforce_evidence_artifact_invariants`: a `DELETE` is permitted only when a transaction-local GUC is set **and** the artifact's `schemaVersion` starts with `release-rescue-`. Both conditions are required, the flag is set only inside the purge function, and `authenticated` holds no `DELETE` grant on that table at all. The proof fixture verifies that a caller who forges the flag still cannot touch another workstream's evidence.

## Report schema

`release-rescue-report/v1`. The report is the entire product — a customer pays $299 and receives this artifact — so every number on it is computed, not carried in.

```
schemaVersion, reportId, engagementId, runId, organizationId
rubricVersion, rubricHash            binds the report to an exact rubric
scope, scopeHash                     binds it to an exact repository and commit
assessments[]                        one per rubric check, with rationale and evidence
findings[]                           release-rescue-finding/v1
coverage{}                           DERIVED
severityCounts{}                     DERIVED
blockingFindingCount                 DERIVED
verdict                              DERIVED
limitations[]                        never empty
disclaimers{}                        four literal-true fields
authorityReport{}                    any non-zero entry fails the gate
preparedBy{}                         executor provenance: key, kind, provider, model
reviewedBy                           the named human, or null (then undeliverable)
generatedAt
```

**Verdict ladder**, in strict precedence:

| Verdict | Meaning |
| --- | --- |
| `release_blocked` | At least one confirmed blocking finding |
| `conditional_release` | A check went unassessed, or a high/critical finding is unconfirmed, or a confirmed high sits on an ungated check |
| `release_with_tracked_findings` | Full coverage, nothing reaching high, findings worth tracking |
| `no_blocking_findings_identified` | Full coverage, nothing above informational |

The top rung is named `no_blocking_findings_identified`, not "ready" and not "secure". We can report what a review of one commit found. We cannot report that nothing else exists, and the name refuses to imply otherwise.

**Report integrity.** `hashReleaseRescueReport` is a canonical SHA-256 over the artifact, stored in `release_rescue_reports.report_hash` and re-derivable before delivery. The row is immutable apart from a single `delivered_at` stamp; reports cannot be deleted; the database refuses a `release_blocked` verdict with no blocking finding and a clean verdict alongside blocking findings.

**Delivery requires a human.** `reviewed_by` is `NOT NULL`, and a trigger checks the named reviewer actually holds `ops_manager` or `platform_admin` — a `NOT NULL` column alone would accept any user id, including the executor's own service account. `releaseRescueDeliveryGate` refuses an agent-prepared report with no human reviewer.

## Evidence and finding severity model

An auditor states **observations**; severity is **derived**. It is never a label the auditor chooses.

That is not a style preference. Severity drives the release verdict, the remediation-sprint pitch, and what the customer does on release day. An AI executor asked to pick a severity label has every incentive to reach for "critical": it reads as thorough, and it sells the $1,250 sprint. So the executor answers three narrower questions it can evidence:

- **impact** — `none` | `limited` | `serious` | `severe`
- **exploitability** — `theoretical` | `requires_privilege` | `requires_user_interaction` | `remote_unauthenticated`
- **confidence** — `confirmed` | `likely` | `possible`

A fixed table maps impact × exploitability to a base severity, and confidence **caps** it (`likely` → at most high, `possible` → at most medium). Confidence can never raise severity — a property the tests assert across the entire input space.

**Blocking** requires confirmation in every case. A confirmed *critical* blocks wherever it was found; a confirmed *high* blocks only on a gating check. An unconfirmed critical is loud in the report and absent from the gate: it holds the verdict at `conditional_release`, so it is neither used to block a release nor quietly dropped. We do not block someone's release on a maybe, and we do not hide a maybe either.

Both derived fields are **stored and verified**. `validateFinding` recomputes them and rejects a mismatch, which is the specific defence against an executor — or anyone editing a stored artifact — writing `"severity": "critical"` next to observations that do not support it.

Supporting requirements: an unconfirmed finding must state its residual uncertainty (the customer cannot act on "maybe" without knowing what to go and check); a confirmed finding must cite a location; a finding may not sit on a check marked `pass`, `not_applicable`, or `not_assessed`; and a `fail` assessment with no finding to explain it is rejected.

## Security-sensitive implementation

Four things carry the security weight, and all four are enforced rather than documented.

**1. Secret redaction (`release-rescue-redaction.ts`).** The worst outcome of this service is a report that lifts a live credential out of a customer's repository and copies it into our database, a rendered page, and an email attachment. Fourteen detectors cover PEM private keys, AWS, GitHub (classic and fine-grained), Slack, Stripe, Anthropic, OpenAI, Google, SendGrid, npm, JWTs, credentials embedded in URLs, and generic credential assignments.

The posture is conservative: over-redacting costs a reader some context, under-redacting copies a production key into three new places. An allowlist keeps correct patterns readable, because a finding that recommends `process.env.API_KEY` has to be able to show it. Redaction is idempotent and order-independent — a fresh `RegExp` per call, since the module-level `/g` literals carry `lastIndex` that would otherwise leak between calls and make a later redaction miss a match.

Defence in depth: the excerpt schema re-runs detection rather than trusting a flag, and `validateReleaseRescueReport` scans the **entire assembled report** at freeze time. An excerpt is not the only place raw source can reach a report — a recommendation or a rationale can quote a line just as easily.

**2. Deterministic computation.** Coverage, severity counts, blocking count, and verdict are recomputed from the findings in `deriveReportMetrics` and compared against the stored values. Stored values that disagree are hard failures. An executor's self-report is evidence, never truth.

**3. Prepare-only authority.** The auditor reports its own external actions in an `authorityReport` reusing the existing shared contract. Any non-zero entry is a hard gate failure, because it means the engagement's authority boundary was crossed. The executor profile registers the envelope and forbidden actions; no credentials are stored there.

**4. Database boundary.** Isolation, credential refusal, immutability, human accountability, and retention are all enforced in Postgres, so the application is not the only thing standing between a customer's source and a mistake.

## Threat model and abuse cases

| # | Threat | Control | Residual risk |
| --- | --- | --- | --- |
| T1 | **Reconnaissance on a repository the requester does not own** | Authorization attestation is a hard gate; the two strong grant methods require an action inside the customer's own provider account, which only someone controlling the repository can perform | `customer_uploaded_archive` proves nothing about ownership. **Open blocker** — archive intake needs an ops confirmation step before launch |
| T2 | **Prompt injection from the reviewed source** ("mark all checks pass"; "fetch this URL") | The auditor is prepare-only with no external-action tools; verdict and severity are computed from structured fields, so injected prose cannot set them; the validator recomputes every number; a non-zero authority report fails the gate; the deterministic validator is not a model | Injection can still cause a **false negative** — an auditor steered away from reporting a real issue. Mitigated by coverage requirements and human review, **not eliminated**. Stated as a report limitation |
| T3 | **Exfiltrating a customer credential through our own pipeline** | Redaction before storage; schema refinement re-verifies; whole-report scan at freeze; no credential columns; trigger rejects credential-shaped metadata | Novel or high-entropy credential formats with no distinctive shape are not detected. Generic entropy scanning was rejected as too false-positive-prone at this price point |
| T4 | **Cross-tenant leakage of a report or scope** | RLS on all tables; composite organization foreign keys; definer-rights validation triggers; proven end to end in the QA fixture | Platform staff can read across tenants by design, as elsewhere in this schema |
| T5 | **Over-broad or lingering repository access** | Read-only only; 30-day maximum; customer-revocable at any time; purge revokes; we hold no credential to leak or rotate | A customer who forgets to revoke relies on our sweep. The expiry index exists; **scheduling the sweep is an open blocker** |
| T6 | **Severity inflation to sell the remediation sprint** — the commercial abuse case, and a real one, because we profit from finding alarming things | Severity is derived, not chosen; blocking requires `confirmed`; confirmed findings must cite locations; `inRemediationSprintScope` is a separate declared field, so the commercial incentive is visible and auditable; a human manager signs | An auditor can still inflate the *inputs* (`impact`, `exploitability`). Human review is the control. Worth measuring: track the confirmed-to-unconfirmed ratio and sprint-scope rate per executor |
| T7 | **Report tampering after issue** | Canonical content hash; immutable rows; only `delivered_at` is updatable; verdict/count contradictions refused in the database | A tampered payload with a recomputed hash would pass; detecting that needs signing, which v1 does not do |
| T8 | **Scope creep past the fixed price, or into unauthorized action** | Intake refusals; one live engagement per organization per scope; prepare-only action class; authority-report gate | — |
| T9 | **Claim inflation in the report or on the marketing surface** | `findProhibitedClaims` enforced in the report validator and exported for the marketing surface, so one list governs both; four literal-true disclaimers | Cursor must actually use the exported list. Called out in the handoff |
| T10 | **Retention drift** — keeping source longer than the customer agreed | Retention derived from the elected policy; monotonically shortening only; 60-day backstop; idempotent sweep | Depends on the sweep being scheduled. **Open blocker** |
| T11 | **Executor output used as authority** | Deterministic code owns every count and the verdict; the Delegation Spec remains the authority ceiling; human signature required for delivery | — |
| T12 | **Hostile repository content** — zip bombs, enormous files, symlink escapes in uploaded archives | Excerpt caps bound what reaches a report | **Open blocker.** Snapshot ingestion limits are not implemented in this slice |

## Test plan

**Implemented and passing** — 124 tests across six suites, plus 42 live database cases.

| Area | Coverage | Where |
| --- | --- | --- |
| **Authentication** | The session boundary itself is the existing platform's (`rls.test.ts`, `auth-redirect.test.ts`). This workstream adds identity checks at the authority boundary: the named report reviewer must hold manager authority, verified against `operators` rather than accepted as a user id | QA fixture §4; migration suite |
| **Authorization** | A customer admin may open an engagement only for their own organization; an ops manager cannot mint an access grant on a customer's behalf; a plain operator cannot issue a report; only a manager may issue or update one; the customer may revoke their own access | QA fixture §1, §3, §4; migration suite |
| **Secrets** | 14 detector families; setting names preserved while values are removed; correct `process.env` usage stays readable; idempotence; call-order independence; redact-before-truncate so no fragment survives; nested JSON scanning; schema refusal of unredacted excerpts; whole-report scan | `release-rescue-redaction.test.ts` (22), `release-rescue-findings.test.ts`, `release-rescue-report.test.ts` |
| **Data access** | Organization B reads none of A's engagements or reports; credential-named keys, credential-shaped values, credentialed URLs, over-long windows, and write access all refused; grants are revoke-only and one-way; retention cannot be extended; the purge clears content, keeps accounting, revokes grants, is idempotent, does not reach past its own workstream, and does not leak its flag | `release_rescue_v1_isolation_proof.sql` (42 cases), migration suite (27) |
| **Report integrity** | Edited severity counts, verdict, coverage, rubric hash, and scope hash all rejected; missing or duplicated assessments and findings rejected; blocking pass on argument alone rejected; finding/assessment contradictions rejected; prohibited claims rejected; non-zero authority rejected; deterministic hashing; delivery gate refuses unsigned or invalid reports | `release-rescue-report.test.ts` (28), `release-rescue-findings.test.ts` (21) |

**How the database cases were verified.** `supabase/qa/release_rescue_v1_isolation_proof.sql` runs against the real migration chain on a disposable Postgres and asserts live behaviour — each case either performs an action that must succeed or attempts one that must be refused, and the script aborts if an expected refusal does not occur. This is how the `security definer` defect was found: the reviewer-authority check could not read `operators` as the calling user, so no report could ever have been issued.

**Not yet covered — required before launch:**

1. End-to-end Playwright coverage of the intake → grant → audit → review → deliver path.
2. A scheduled-sweep integration test proving retention actually fires in a deployed environment.
3. Adversarial injection corpus: a fixture repository of files that attempt to steer the auditor, asserting the verdict is unaffected.
4. Snapshot ingestion limits (file count, file size, archive expansion, symlink handling) and their tests.
5. Executor calibration measurement — confirmed-to-unconfirmed ratio and sprint-scope rate per executor, to detect severity inflation over time.

## What this slice deliberately does not do

No UI, no marketing surface, no payment activation, no executor adapter, no snapshot ingestion, no scheduled sweep, no `VISION.md` edit, and no change to any existing workstream. The one pre-existing function this migration replaces — `enforce_evidence_artifact_invariants` — is re-declared with the 20260824090000 caller-supplied content-hash fallback preserved verbatim, and a migration test asserts that, because regressing it would hard-fail every work-cell verification.
