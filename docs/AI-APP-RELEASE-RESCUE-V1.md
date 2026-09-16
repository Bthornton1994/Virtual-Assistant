# AI App Release Rescue v1

The architecture and security foundation for a fixed-price release-readiness review.

The offer is a **$299 review** covering **one repository, one application, and one critical workflow**, with a **$1,250 remediation sprint** available afterwards. The review reads source, configuration, and dependency manifests at a single commit and produces one signed, content-hashed report.

It is **not a penetration test, not a compliance certification, and not a security guarantee**. Those three claims are refused at intake, disclaimed on every report, and enforced in code (`findProhibitedClaims`).

This document is the security foundation. It does not authorize a launch, a payment flow, a production deployment, or any external action.

## Vision classification

**Aligns with constraints.** `VISION.md` § *Scope and non-goals* now admits bounded technical assurance work on stated terms (decision `D-009`).

The workstream fits `VISION.md` § *Quality assurance is part of delivery*, § *Use the right executor for each step*, and § *Security follows delegated authority*: a customer delegates an outcome ("tell me whether this is safe to ship"), Delegation Cloud routes it, verifies it, and a human remains accountable. Findings are drafted by an AI executor and are never authoritative on their own, which is § *Manual first, automation after proof*.

The constraints, each of which is implemented rather than promised:

- The review is **prepare-only** (`VISION.md` § *Authority is explicit and bounded*). The auditor reads and reports. A non-zero authority report fails the deterministic gate.
- Repository access is **least-privilege, intentional, logged, and removable** (§ *Security follows delegated authority*). Read-only, time-boxed at 30 days, customer-granted, customer-revocable, and never held as a credential by us.
- Customer source **never crosses organizations** (§ *Workflow memory compounds value*). Row level security on every table; no cross-tenant generalization of findings in v1.

**The vision question is now settled, on narrow terms.** `VISION.md` previously listed only operational workstreams and was silent on engineering-adjacent assurance work. It has been amended to admit it, with the constraints written into the vision itself rather than into this document: prepare-only authority; read-only, time-boxed, customer-revocable access never held as a credential; ownership established by an accountable human where the access method does not demonstrate control; deterministic severity and completion; a named human signature before delivery; remediation as a separate engagement; and a standing prohibition on describing the work as penetration testing, compliance certification, or a security guarantee.

Admission is not launch. Payment activation, production access, and any increase in executor authority remain separate owner decisions.

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

Eight application modules, all pure and deterministic, and the migration chain that enforces the same boundaries in the database:

| Module | Responsibility |
| --- | --- |
| `src/lib/release-rescue-rubric.ts` | The frozen, content-hashed rubric: 32 checks across 12 dimensions, 12 of them release-gating |
| `src/lib/release-rescue-intake.ts` | Offer terms, scope ceiling, service refusals, attestations, retention election |
| `src/lib/release-rescue-redaction.ts` | Secret detection, applied to the source the scanner reads transiently, to the intake form, and to the two guarded strings a report still holds. It no longer prepares excerpts, because none are stored, and it is no longer what proves a delivered report is safe |
| `src/lib/release-rescue-observation-catalog.ts` | Every customer-facing sentence the product can produce: observations, remediations, uncertainties, assessment rationales, limitations and clearance reasons, keyed by stable code and pinned by content hash |
| `src/lib/release-rescue-findings.ts` | The finding contract and the derived severity model |
| `src/lib/release-rescue-report.ts` | Report schema, deterministic assembly, validation, delivery gate |
| `src/lib/release-rescue-presentation.ts` | The customer-facing view, built by construction so internal identity cannot leak into it |
| `src/lib/release-rescue-snapshot-limits.ts` | Fail-closed limits on what the review will ingest |
| `src/lib/release-rescue-retention-schedule.ts` | Authorization for the scheduled retention sweep |
| `supabase/migrations/20260915120000_release_rescue_v1.sql` | Isolation, credential refusal, immutability, retention |
| `supabase/migrations/20260915183000_release_rescue_hardening_v1.sql` | Ownership evidence, snapshot record, scheduled sweep |
| `supabase/migrations/20260915193000_release_rescue_hardening_v2.sql` | Frozen scope, access-mode evidence, report invariants, privileged purge |
| `supabase/migrations/20260915213000_release_rescue_hardening_v3.sql` | Unconditional ownership gate, single purge-flag reader, live-grant requirement |
| `supabase/migrations/20260915223000_release_rescue_reviewed_commit_v4.sql` | The reviewed commit as a write-once field, pinned after the snapshot |
| `supabase/migrations/20260915234500_release_rescue_trust_boundary_v5.sql` | Composite org/run binding, caller-based ownership authorization, server-derived retention |
| `src/lib/release-rescue-field-policy.ts` | The report field coverage contract |
| `src/lib/release-rescue-credential-scanner.ts` | The bounded assignment scanner |
| `src/lib/release-rescue-secret-classification.ts` | Three-valued classification and its precedence |
| `supabase/migrations/20260916010000_release_rescue_timestamp_authority_v6.sql` | Server-owned creation time and retention derivation |
| `src/lib/release-rescue-redaction-keys.ts` | Whether a key name claims to hold a credential |

## Release-readiness audit rubric

`release-rescue-rubric/v2 scope` — 32 checks across 12 dimensions.

The offer is sold as release READINESS, not as a security review, so the rubric covers what would actually stop a release: not only the security and AI-boundary dimensions, but an unusable workflow, an untested critical path, and an application nobody else can run.

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
| Accessibility | 3 | — |
| Code quality and tests | 3 | — |
| Documentation and handover | 2 | — |

The three added dimensions are deliberately non-gating. A missing keyboard path is a real finding and a real release problem, but it is not something this review blocks a release over; gating stays with the checks where being wrong is unrecoverable.

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

**Findings point at source; they do not copy it.** There is no excerpt field, no cap to discuss and nothing to truncate. `prepareExcerpt`, `prepareStoredExcerpt` and `MAX_EXCERPT_LENGTH` were deleted with the field. A finding cites `path`, `startLine` and `endLine`, and the customer opens their own checkout. See *The excerpt decision*.

## Data isolation and retention rules

**Isolation.** Row level security on all three tables, with every `select` policy scoped to `my_org_ids()` or platform staff. Engagement, run and report references are bound to their parent's organization by composite foreign key, so a row cannot name organization A while pointing at a run or engagement owned by B.

That sentence used to be false of the engagement's own `run_id`, which was a single-column reference with no immutability rule, and a third audit turned that into a working cross-tenant deletion. It is true now, and `release_rescue_trust_boundary_v5_proof.sql` executes the attack that proved it false. `report_artifact_id` is a single-column reference whose organization and run are checked in the report trigger instead, because `evidence_artifacts` carries no `(id, organization_id)` key to point at. No table grants `delete` to `authenticated`.

Most validation triggers run `security definer`. The two that make a privilege decision — report immutability and scope freeze — run `security invoker` instead, because inside a definer function `current_user` is the function OWNER, so a privilege check written there answers for the wrong role and always passes. Both read only `NEW`, `OLD` and the purge helper, so they need no elevated rights. For the rest, beyond fixing a real defect — `authenticated` has no read grant on `public.operators`, so the reviewer-authority check could not run at all — this is the correct posture for a validation trigger: it must see **true** state, not the caller's RLS-filtered view. Under invoker rights, a cross-tenant check can be defeated by making the conflicting row invisible, so the check passes because the row it should have found simply is not there. Both functions only read and raise, run no dynamic SQL, and have a locked `search_path`.

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

Evidence artifacts are otherwise immutable, which is right for evidence and wrong for a customer's report body after their retention window closes. The migration adds one narrow carve-out to `enforce_evidence_artifact_invariants`: a `DELETE` is permitted only when a transaction-local GUC is set **and** the artifact's `schemaVersion` starts with `release-rescue-`. Both conditions are required, the flag is set only inside the purge function, and `authenticated` holds no `DELETE` grant on that table at all. The proof fixture verifies that a caller who forges the flag still cannot touch another workstream's evidence.

## Report schema

`release-rescue-report/v1`. The report is the entire product — a customer pays $299 and receives this artifact — so every number on it is computed, not carried in.

```
schemaVersion, reportId, engagementId, runId, organizationId
rubricVersion, rubricHash            binds the report to an exact rubric
scope, scopeHash                     binds it to an exact repository and commit
observationCatalogVersion, observationCatalogHash
                                     binds it to the exact wording the customer read
assessments[]                        one per rubric check: checkId, outcome,
                                     rationaleCode, and structured evidence
findings[]                           release-rescue-finding/v2
coverage{}                           DERIVED
severityCounts{}                     DERIVED
blockingFindingCount                 DERIVED
verdict                              DERIVED
limitationCodes[]                    never empty; resolved from the catalog
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

**Report integrity.** `hashReleaseRescueReport` is a canonical SHA-256 over the artifact, stored in `release_rescue_reports.report_hash`. It is re-derivABLE, but nothing in the pipeline re-derives it yet — there is no production caller, and the delivery path that would check it is not built. What the database does enforce is that the row's verdict, blocking count and coverage match the artifact payload it points at. The row is immutable apart from a single `delivered_at` stamp; reports cannot be deleted; the database refuses a `release_blocked` verdict with no blocking finding and a clean verdict alongside blocking findings.

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

**1. Secret redaction (`release-rescue-redaction.ts`).** The worst outcome of this service is a report that lifts a live credential out of a customer's repository and copies it into our database, a rendered page, and an email attachment. Fifteen detectors cover PEM private keys, AWS, GitHub (classic and fine-grained), Slack, Stripe, Anthropic, OpenAI, Google, SendGrid, npm, JWTs, credentials embedded in URLs, and generic credential assignments.

The posture is conservative: over-redacting costs a reader some context, under-redacting copies a production key into three new places. An allowlist keeps correct patterns readable, because a finding that recommends `process.env.API_KEY` has to be able to show it. Redaction is idempotent and order-independent — a fresh `RegExp` per call, since the module-level `/g` literals carry `lastIndex` that would otherwise leak between calls and make a later redaction miss a match.

Defence in depth: `validateReleaseRescueReport` scans the **entire assembled report** at freeze time. This is not what proves a deliverable is safe — the absence of any field that holds a sentence is — but two strings in a report are still typed by a person (the reviewer's display name and the repository reference the customer gave at intake), and a second look before the artifact is frozen costs nothing.

**2. Deterministic computation.** Coverage, severity counts, blocking count, and verdict are recomputed from the findings in `deriveReportMetrics` and compared against the stored values. Stored values that disagree are hard failures. An executor's self-report is evidence, never truth.

**3. Prepare-only authority.** The auditor reports its own external actions in an `authorityReport` reusing the existing shared contract. Any non-zero entry is a hard gate failure, because it means the engagement's authority boundary was crossed. The executor profile registers the envelope and forbidden actions; no credentials are stored there.

**4. Database boundary.** Isolation, credential refusal, immutability, human accountability, and retention are all enforced in Postgres, so the application is not the only thing standing between a customer's source and a mistake.

## Threat model and abuse cases

| # | Threat | Control | Residual risk |
| --- | --- | --- | --- |
| T1 | **Reconnaissance on a repository the requester does not own** | No engagement starts a review until a named ops manager records how ownership was established, and until a live, unrevoked read-only grant naming the repository in the frozen scope exists. Neither check consults the customer-declared access mode | The confirmation is a human judgement, so it is only as good as the operator making it. It is deliberately manual: an earlier version branched on the customer-supplied `access_mode`, which meant the party being constrained chose whether the gate applied |
| T2 | **Prompt injection from the reviewed source** ("mark all checks pass"; "fetch this URL") | The auditor is prepare-only with no external-action tools; verdict and severity are computed from structured fields, so injected prose cannot set them; the validator recomputes every number; a non-zero authority report fails the gate; the deterministic validator is not a model | Injection can still cause a **false negative** — an auditor steered away from reporting a real issue. Mitigated by coverage requirements and human review, **not eliminated**. Stated as a report limitation |
| T3 | **Exfiltrating a customer credential through our own pipeline** | Redaction before storage; schema refinement re-verifies; whole-report scan at freeze; no credential columns; trigger rejects credential-shaped metadata | Novel or high-entropy credential formats with no distinctive shape are not detected. Generic entropy scanning was rejected as too false-positive-prone at this price point |
| T4 | **Cross-tenant leakage of a report or scope** | RLS on all tables; composite organization foreign keys; definer-rights validation triggers; proven end to end in the QA fixture | Platform staff can read across tenants by design, as elsewhere in this schema |
| T5 | **Over-broad or lingering repository access** | Read-only only; 30-day maximum; customer-revocable at any time; purge revokes; we hold no credential to leak or rotate; a revoked or expired grant stops licensing a review at the database level | A customer who forgets to revoke relies on our sweep, which is now scheduled |
| T6 | **Severity inflation to sell the remediation sprint** — the commercial abuse case, and a real one, because we profit from finding alarming things | Severity is derived, not chosen; blocking requires `confirmed`; confirmed findings must cite locations; `inRemediationSprintScope` is a separate declared field, so the commercial incentive is visible and auditable; a human manager signs | An auditor can still inflate the *inputs* (`impact`, `exploitability`). Human review is the control. Worth measuring: track the confirmed-to-unconfirmed ratio and sprint-scope rate per executor |
| T7 | **Report tampering after issue** | Canonical content hash; immutable rows; only `delivered_at` is updatable; verdict/count contradictions refused in the database | A tampered payload with a recomputed hash would pass; detecting that needs signing, which v1 does not do |
| T8 | **Scope creep past the fixed price, or into unauthorized action** | Intake refusals; one live engagement per organization per scope; prepare-only action class; authority-report gate | — |
| T9 | **Claim inflation in the report or on the marketing surface** | `findProhibitedClaims` enforced in the report validator and exported for the marketing surface, so one list governs both; four literal-true disclaimers | Cursor must actually use the exported list. Called out in the handoff |
| T10 | **Retention drift** — keeping source longer than the customer agreed | Retention derived from the elected policy; monotonically shortening only; 60-day backstop; idempotent sweep, scheduled by pg_cron where available and by a bearer-authorized route where not | Both schedulers must actually be configured in the deployed environment; the route fails closed (503) when `CRON_SECRET` is unset, which is visible rather than silent |
| T11 | **Executor output used as authority** | Deterministic code owns every count and the verdict; the Delegation Spec remains the authority ceiling; human signature required for delivery | — |
| T12 | **Hostile repository content** — zip bombs, enormous files, symlink escapes in uploaded archives | Fail-closed limits on file count, file size, total bytes, archive size, expansion ratio, path depth and path length, applied before anything is read (`release-rescue-snapshot-limits.ts`); no file content reaches a report at all, so hostile content cannot travel through one | The limits are enforced in application code, so they bind the ingestion path this service owns and not a future one that bypasses it |

## Test plan

**Implemented and passing** — 640 Release Rescue tests across 30 suites (1,316 in the whole repository, of which 8 fail for an environmental reason recorded below), 361 live database cases across twelve proofs, and **13** Release Rescue browser tests in real Chromium against the production build.

The browser figure was **16** in three previous revisions of this sentence and that was misleading. Sixteen is the number of browser tests that were *run* — the 13 in `e2e/ai-app-release-rescue.spec.ts` plus three in two neighbouring specs. In a sentence whose other three figures are Release Rescue totals, "16 browser tests" reads as sixteen Release Rescue browser tests, and there have never been more than 13. An audit caught it in a revision that updated the other three numbers and left this one. The figure is now the spec's own count.

The database figure counts labelled `PASS <outcome> |` lines only. An earlier pass reported 306 by counting each proof's closing "every case above printed PASS" banner as a case — a stale count is a false claim, and so is a miscounted one.

Three of the six Playwright specs need live preview credentials (`E2E_PASSWORD`) and a deployed preview, neither of which this environment has or should have. They are not run here, and the 16 above does not include them.

> **Read *The structured-observation decision* before treating any of this as shippable.**
> Thirteen independent audits have run and all thirteen returned DO_NOT_MERGE.
> The first twelve turned, one way or another, on the same question: can a rule
> decide, from a sentence an auditor wrote, whether it has quoted a credential?
> Four rounds of measurement answered no in both directions. The owner's
> decision removes the question rather than answering it: a report carries
> codes, and a frozen catalog carries the words. Independent QA has not yet
> audited that result.

These counts are re-measured each pass rather than carried forward. Three successive audits found stale numbers here, and a stale count is a false claim like any other.

| Area | Coverage | Where |
| --- | --- | --- |
| **Authentication** | The session boundary itself is the existing platform's (`rls.test.ts`, `auth-redirect.test.ts`). This workstream adds identity checks at the authority boundary: the named report reviewer must hold manager authority, verified against `operators` rather than accepted as a user id | QA fixture §4; migration suite |
| **Authorization** | A customer admin may open an engagement only for their own organization; an ops manager cannot mint an access grant on a customer's behalf; a plain operator cannot issue a report; only a manager may issue or update one; the customer may revoke their own access | QA fixture §1, §3, §4; migration suite |
| **Secrets** | Structural first: a finding carries no source and no sentence, and every source-carrying and narrative field name is refused in TypeScript and in PostgreSQL. Then, as defence in depth over the two strings a person still types and over transient processing: 15 detector families; setting names preserved while values are removed; correct `process.env` usage stays readable; idempotence; call-order independence; nested JSON scanning; whole-report scan | `release-rescue-structured-observations.test.ts` (36), `release-rescue-redaction.test.ts` (28), `release-rescue-findings.test.ts`, `release-rescue-report.test.ts` |
| **Data access** | Organization B reads none of A's engagements or reports; credential-named keys, credential-shaped values, credentialed URLs, over-long windows, and write access all refused; grants are revoke-only and one-way; retention cannot be extended; the purge clears content, keeps accounting, revokes grants, is idempotent, does not reach past its own workstream, and does not leak its flag | `release_rescue_v1_isolation_proof.sql` (45 cases), migration suite (28) |
| **Report integrity** | Edited severity counts, verdict, coverage, rubric hash, and scope hash all rejected; missing or duplicated assessments and findings rejected; blocking pass on argument alone rejected; finding/assessment contradictions rejected; prohibited claims rejected; non-zero authority rejected; deterministic hashing; delivery gate refuses unsigned or invalid reports | `release-rescue-report.test.ts`, `release-rescue-findings.test.ts`, `demo-fixtures.test.ts` |

**How the database cases were verified.** `supabase/qa/release_rescue_v1_isolation_proof.sql` runs against the real migration chain on a disposable Postgres and asserts live behaviour — each case either performs an action that must succeed or attempts one that must be refused, and the script aborts if an expected refusal does not occur. This is how the `security definer` defect was found: the reviewer-authority check could not read `operators` as the calling user, so no report could ever have been issued.

**Not yet covered — required before launch:**

1. End-to-end Playwright coverage of the intake → grant → audit → review → deliver path.
2. A scheduled-sweep integration test proving retention actually fires in a deployed environment.
3. Adversarial injection corpus: a fixture repository of files that attempt to steer the auditor, asserting the verdict is unaffected.
4. Snapshot ingestion limits (file count, file size, archive expansion, symlink handling) and their tests.
5. Executor calibration measurement — confirmed-to-unconfirmed ratio and sprint-scope rate per executor, to detect severity inflation over time.

## Production hardening

### An uploaded archive is not evidence of ownership

The worst abuse of this service is buying a security report on somebody else's code. Installing a read-only app, or adding a read-only collaborator, requires an action inside the customer's own provider account on that specific repository, so only someone who already controls it can do it: the grant is itself evidence. Uploading an archive proves nothing, and the customer's attestation is a promise rather than proof.

So access modes are now classified by whether they demonstrate control (`ACCESS_MODE_DEMONSTRATES_CONTROL`), and an archive engagement cannot reach `auditing`, `report_ready`, or `delivered` until a named ops manager records **how** ownership was established, with a written note. That gate lives in the database, not only in the application, because an application-only gate is one someone can route around. The confirmation is one-way, its attribution cannot be rewritten, and the retention sweep clears the note while keeping who confirmed it and when.

An engagement whose access mode is not recorded at all also cannot start a review: an unclassified mode is not assumed safe.

### Fail-closed ingestion limits

The reviewed repository is hostile input. `release-rescue-snapshot-limits.ts` decides what may be read before anything is read:

| Limit | Value | Why |
| --- | --- | --- |
| Files | 5,000 | A larger repository is a different engagement |
| One file | 2 MB | Larger is generated, vendored, or binary |
| Snapshot | 200 MB | Bounds the whole review |
| Archive | 100 MB | Bounds the upload |
| Expansion ratio | 12x | Source compresses 3-5x; a bomb is thousands |
| Path depth / length | 24 / 400 | Bounds pathological trees |

Symlinks are **recorded and never followed**. Resolving one means deciding whether its target is inside the snapshot, and that decision is where every traversal bug in every archive extractor has ever lived; not following them has no such failure mode. Absolute paths, `..` traversal, control characters, and backslashes are refused. A file whose whole content is a credential is recorded as present and not read.

Per-entry problems skip that entry; whole-snapshot breaches refuse the **entire** snapshot rather than truncating it, because a truncated review reporting "no findings" is worse than no review — the customer believes it. Archive limits are checked against the archive's declared index, which is the only point a decompression bomb can still be refused cheaply; the declared size is attacker-controlled, so the extractor must also stop at the real limit. This function bounds the claim, the extractor bounds the reality, and neither is sufficient alone.

### The retention sweep is scheduled, and says so

A retention promise nothing executes is not a retention control. The sweep now runs on two paths that call the same idempotent function: `pg_cron` inside the database where the extension exists, and an authenticated route (`/api/internal/release-rescue/retention-sweep`) on the same daily schedule where it does not.

Every sweep writes a row to `release_rescue_retention_runs`, **including a sweep that purges nothing** — a retention control that leaves no trace when it finds nothing is indistinguishable from one that never ran. The route's authorization is a pure function tested exhaustively: no configured secret means nobody is authorized (503, distinct from 401, so a misconfigured deployment cannot hide behind what looks like a routine auth failure), a secret under 24 characters is treated as a placeholder rather than a credential, and comparison is constant-time with the length check that `timingSafeEqual` would otherwise throw on. The sweep claims rows `for update skip locked`, so overlapping schedules cannot deadlock.

### The AI-assisted opt-in is enforced, not noted

A privacy choice a customer makes at intake and the pipeline then ignores is worse than not offering the choice. `aiAssistedReviewAccepted` is now part of the intake contract, carried into the frozen scope (so it is inside the scope hash and cannot be edited after the fact), rejected as a **hard validation failure** if an agent prepared a report for an engagement that declined, blocked again at the delivery gate, and displayed on the report itself.

### Prompt injection: what is proven, and what is not

**Proven.** Injected prose cannot move a gate. Twenty tests feed hostile text — instruction overrides, fake system messages, forged JSON fields, closing-tag attacks, a right-to-left override, an exfiltration request — through every free-text field of a report and assert the verdict, severity counts, blocking count, and coverage are byte-identical to the uninjected baseline. Text claiming authority does not become authority; a prohibited claim or a credential smuggled in as injected text is still caught; a report carrying injection still requires a human signature.

**Not proven, and not solved.** None of this prevents a false NEGATIVE. An auditor steered away from a file reports nothing about it, and a report with a missing finding is structurally perfect. Coverage rules and human review reduce that risk; they do not eliminate it. Every report now carries a standing limitation saying exactly this, and a test asserts the limitations never claim the risk is prevented, eliminated, or solved.

## Reconciliation with the customer surface

This workstream was built twice in parallel: these contracts and the database
boundary here, and a customer surface in PR #96 that carried its own copies of
the rubric, the intake rules, the report schema, and a secret scanner. Two
implementations of one service's security core is worse than either alone, so
they were reduced to one: the surface stayed, its duplicate contracts were
deleted, and it now renders these.

What survived from the other implementation, because it was better:

- **Forbidden evidence file names.** Redaction protects us from credential-shaped
  text. It cannot help with a customer helpfully attaching the file that *is* the
  credential — a `.env`, an SSH private key, a service-account JSON. Those are now
  refused by name at intake (`isForbiddenEvidenceFilename`), with `.env.example`
  and other template suffixes still allowed, since a finding about committed
  secrets often needs to cite one.
- **Credentials in a query string.** `?access_token=…` is as much a leak as
  `user:pass@host`, and the original detector only caught the second. There is now
  a `credential_in_query` detector that keeps the parameter name and removes the
  value.

Integrating the two surfaced two real defects in these contracts:

- **`findProhibitedClaims` flagged its own required disclaimer.** A plain
  substring match cannot tell a claim from its denial, so "This review is not a
  penetration test" — the sentence the customer must be shown — was reported as a
  prohibited claim. It now inspects the clause around each occurrence for a
  negation, and the sentence for a referral ("customers who need penetration
  testing should engage qualified specialists"), and reports only affirmative
  claims. The correct copy was unshippable until this was fixed.
- **The intake schema demanded a commit sha the customer could not know.** At
  intake nobody has granted access yet, so the reviewed commit does not exist as
  a fact. `repositoryIntakeSchema` now carries no commit; `freezeScope(intake,
  commitSha)` pins it when the snapshot is taken, which is the moment the review
  target actually stops moving.

The intake form accepts a pasted `https://github.com/owner/name` URL and stores
only `owner/name`, after refusing any URL carrying userinfo or a credential-shaped
query. Refusing URL-shaped references in the stored contract removes the chance
of a credential arriving through a form; refusing to *accept* one in the form
would just be hostile.

The sample report on the demo page is built through the real assembler and is
asserted to pass the real validator and delivery gate. A hand-written sample
would be free to promise a shape the pipeline cannot produce.

### Carried over, and still open

- Landing-page sentences were written for accuracy against the report contract. Voice polish can still improve them, but the verdict copy must stay aligned with `VERDICT_COPY` and must not call an application ready or secure.
- The snapshot limits are a decision function. **The extractor that enforces them at read time is not built**, because this pass performs no checkout. The limits are proven in unit tests, not against a real archive.
- The retention sweep is scheduled in configuration and in the migration. **It has not run in a deployed environment**, because nothing is deployed.
- The landing page's "No executor identifiers" claim **checks out**, and this
  pass confirmed it rather than assuming it. The customer receives
  `CustomerReportView`, not the internal artifact: `toCustomerReportView` omits
  `preparedBy` apart from `executorKind`, and `findInternalIdentityLeaks` asserts
  it. One gap was real and is closed — that leak check only tested `modelId` when
  it was non-null, and every fixture set it to null, so the arm had never run. A
  test now populates it and proves it reaches neither the rendered view nor the
  JSON.

### The commit was in the wrong place, and now is not

The v3 pass recorded this rather than working around it:

> `freezeScope(intake, commitSha)` builds the frozen scope from the intake plus
> the reviewed commit — but the commit is only known once a snapshot has been
> taken, which happens after the engagement row exists, and both `scope` and
> `scope_hash` are immutable on `UPDATE`. So the intended lifecycle cannot be
> executed.

It had a second half nobody had noticed. Because the scope hash was computed over
a scope *containing* the commit, `hashScope(freezeScope(intake, sha))` could never
equal the `scope_hash` written at intake. The hash whose job is to bind a report
to its engagement bound nothing.

Both halves were the same mistake: two facts were sharing one field because they
were both called "scope".

| | Known | Frozen | Identity of |
| --- | --- | --- | --- |
| `scope` / `scope_hash` | at intake | at intake | the **agreement** — one repository, one application, one critical workflow, the exclusions, the AI-assisted choice |
| `reviewed_commit_sha` | at the snapshot | at the snapshot | the **tree** we actually read |

Two write-once moments need two fields. `20260915223000_release_rescue_reviewed_commit_v4.sql`
adds the second one, and the freeze is not loosened anywhere.

The commit can be pinned only when the snapshot that resolved it has been
recorded *and* a live, unrevoked read-only grant names the repository in the
frozen scope — so the pin means "we read this", not "someone typed forty
characters". After that it cannot be changed, cleared, or repointed, and no
review may start without it: a report that cannot name the tree it read is not
defensible.

It survives the retention purge. A 40-character hash of a tree reveals nothing
about that tree, exactly as `scope_hash` reveals nothing about the scope, and
without it a delivered report can no longer say what it reviewed. The migration
asserts that the sweep does not clear it, so a future edit to the sweep fails the
migration rather than quietly destroying the evidence.

A report row is filled in from its engagement rather than trusted: the writer does
not choose the value, a report naming a different commit is refused, and so is one
whose *body* names a different commit.

`supabase/qa/release_rescue_lifecycle_v4_proof.sql` walks one engagement from
intake to purge in order — intake, grant, snapshot, pin, review, report, delivery,
retention — asserting at every step. That shape matters: the other proofs test
each guard in isolation, which is right for a guard and is exactly why they missed
this. The contradiction existed only *between* the steps, so only a proof that
takes all of them in sequence could find it.

## Second independent audit: fixing examples is not fixing defects

A second fresh-context audit re-ran the first audit's attacks and found most of
them closed and their near neighbours open. Its criticism was one sentence, and
it was correct:

> Every fix closes the literal statement the previous audit executed, and the
> property it was an example of remains open.

Five of the eight "fixed" items were still crossable, and two of the v2 fixes had
introduced new defects of their own:

| What was fixed | What stayed open | Why it is the same defect |
| --- | --- | --- |
| The redaction detector matched on the END of the key name | `DB_PASSWORD_PROD`, `SECRET_KEY`, `PASSWORD_PROD` and `SESSION_PASSPHRASE` all leaked their values | v1 handled a keyword with nothing before it; v2 handled a keyword with a prefix. Neither asked the actual question, which is whether the NAME claims to hold a credential. A secret word can sit anywhere in a name |
| The claim guard tokenised negation | "penetration tests", "compliance certifications" and "penetration-test" all passed | The guard compared literal strings, so it was a list of spellings rather than a rule about words. Plurals, gerunds and hyphens are the same claim |
| Referral phrases were narrowed | "If you need a short answer, your application is secure" passed | Referral was scoped to the SENTENCE, so any sentence containing a referral phrase could carry any claim anywhere in it |
| The ownership gate required a grant row | Declaring `customer_installed_readonly_app` at intake skipped the gate entirely | The gate branched on `access_mode = 'customer_uploaded_archive'` — a value supplied by the party the gate exists to constrain |
| The purge flag was gated on privilege | The scope-freeze trigger still read the raw GUC, so the purge stub was forgeable | v2 built the privileged helper and left one caller reading the flag directly |

And two regressions introduced by the v2 fixes themselves:

- The unbounded `[A-Za-z0-9_]*` prefix added to the assignment detector backtracked
  quadratically. 40KB of identifier characters took **4.1 seconds** — a denial of
  service reachable from any file in a reviewed repository.
- The pre-review grant check counted grant rows at `read_only` without asking
  whether they were revoked, whether they had expired, or whether they named the
  repository under review. "Read-only, time-boxed, customer-revocable" was a
  promise the check did not keep.

### What changed, and how the fixes are shaped differently

Each fix is written against the property rather than the example:

- **Redaction** no longer describes where a secret word may sit in a key name. The
  pattern matches an assignment to any identifier-shaped key, and a separate
  function splits that key into segments — on separators and on camel-case
  boundaries — and asks whether any segment, or any adjacent pair, names a
  credential. Position, casing and separator style stop mattering. Every
  quantifier is bounded, which also removes the backtracking: the same 40KB input
  now takes 4ms.
- **The claim guard** works on a token stream carrying clause and sentence breaks,
  compares words by stem, and treats hyphens as separators with no break. Referral
  is now clause-scoped like negation, with one carve-out for a genuine multi-item
  referral: a referral licenses a later claim only when everything between them is
  other prohibited items and list glue.
- **The ownership gate** applies to every engagement. Nothing branches on
  `access_mode`, so the customer no longer chooses whether the gate runs.
- **One function reads the purge flag**, and the migration fails if a second ever
  appears — recorded as a schema assertion rather than a comment, because the v2
  regression was exactly that.
- **A grant licenses a review** only while unrevoked and unexpired, and only for
  the repository the frozen scope names.

The regression cases are property-shaped too, as the auditor advised. The database
proof loops over every access mode and every unusable grant shape rather than the
one the audit used; `src/lib/__tests__/release-rescue-properties.test.ts` generates
216 key-name shapes across six secret words, six prefixes and six suffixes, and
every inflection and hyphenation of fourteen claim phrases in both the affirmative
and the denied form.

Writing the v3 gate also surfaced a defect nothing else had: rewriting the
ownership trigger dropped the v1 rule that a recorded confirmation cannot be
changed. The v1 proof caught it on the first run.

## Third independent audit: the structural round

A third fresh-context audit reproduced five blocking findings against the
combined tree. Two of them were not textual, and its diagnosis was the one that
mattered:

> The recurring defect is not any one regex or trigger. It is that each guard is
> written as a **validity check on a value in `NEW` or on a string**, when the
> property needs a **privilege check on the caller**, a **referential-integrity
> constraint**, or a **coverage decision about which fields it applies to**.
> Sharpening the guards again will produce a sixth audit with the same sentence
> in it.

That is correct, and it applies to work in this document. So this round moves the
decisions to where they can be decided, rather than making the existing checks
stricter.

### The trust boundary

| Caller | May confirm ownership? |
| --- | --- |
| unauthenticated (`anon`) | No. RLS refuses the write entirely. |
| authenticated customer | No. |
| organization admin | **No.** Naming an operations manager does not make them one — and the org-scoped `select` policy shows them a real manager's UUID on their first legitimate engagement, which is exactly how the audit did it. |
| operations manager / platform admin | Yes, **as themselves only**. `ownership_confirmed_by` is forced to `auth.uid()`; naming anyone else is refused rather than corrected. |
| service role | Yes, naming an operator, because it *is* the server. The named person must hold manager authority, and the channel is recorded in `ownership_confirmed_via` so an audit can tell the two apart. |

The gate is `SECURITY INVOKER`, because `current_user` must be the real caller for
the server branch to mean anything. `auth.uid()` is unaffected by definer rights
(it reads a transaction GUC), and `is_ops_manager()` is an existing helper that
answers about the **caller** — which is the question the old gate never asked.

**A fail-open found while proving it.** `is_ops_manager()` returned NULL, not
false, for a non-operator, because `NULL in (...)` is NULL. RLS denies on NULL so
policies were safe, but `if not NULL` in plpgsql does not fire and execution falls
*through* the guard. The first version of the new check let an organization admin
past the "are you a manager" test and stopped them only at the next one — it
stopped them for the wrong reason. Fixed at the source, so every plpgsql caller
inherits a real boolean. That also tightened `enforce_step3d_artifact_authority`
in another workstream, which had the same shape and the same hole; it is restated
as "an operations manager **or the server**" so closing the hole does not block
the legitimate service-role writer.

### Tenancy and retention

- `(run_id, organization_id)` references `workstream_runs (id, organization_id)`.
  The unique key it needs has existed since `20260822182149`; reports already used
  it and the engagement did not, which is precisely where it mattered.
- `run_id` goes NULL → value once and is then pinned. The key stops another
  tenant's run; immutability stops repointing *within* a tenant, which the key
  alone permits.
- `purge_after` is derived from `created_at`, `delivered_at` and `retention_days`.
  Caller input is **discarded, not validated** — a validation rule is something an
  attacker probes; an ignored field is not. Shortening still works through the
  retention policy, which is the supported route.
- The sweep scopes every statement by the engagement's own organization and takes
  no caller-chosen target.

### Report field coverage

`REPORT_FIELD_POLICY` classifies every customer-reachable string as `generated`,
`guarded`, `redacted`, `rejected` or `verbatim_approved`, each with a written
reason, and the validator walks the artifact rather than a list of field names. A
string whose path carries no decision is a **hard failure**. Adding a
customer-visible field without classifying it breaks the build, which is the only
mechanism that survives the next person in a hurry.

### Credential detection

The single omnibus regex is gone. A bounded scanner reads the text once, decides
at each token whether the **key name** is credential-shaped, and only then
consults a table of assignment forms: operator, keyword (`ENV`/`ARG`/`export`), command flag,
quoted-after-key, XML attribute, XML element, `.netrc`, delimited column, YAML
block scalar.

Three consequences, and they are the reasons for the rewrite rather than side
effects of it:

1. A non-secret key can no longer swallow a secret one. The old pattern matched
   the whole assignment, so `Config: DB_PASSWORD_PROD=hunter2` matched on
   `Config`, was judged not-secret, and `String.replace` resumed *past* the real
   assignment. Ordinary prose in front of a `.env` line was enough — that one was
   never even an evasion.
2. Adding a syntax is adding a form, not widening an expression.
3. Every loop is bounded by the input length with no nesting. There is no
   expression left here that can backtrack.

There is deliberately **no general bare `KEY VALUE` rule**. "The password rotation
policy is weak" would redact "rotation", and over-redaction is not free: a
confident detection hard-fails a delivery, so a false positive blocks a report the
customer paid for. Two narrow exceptions exist, and each is narrow on purpose:
positional records (`.pgpass`, where the FORMAT is the evidence because no key
name appears on the line) and `opaque_token_near_noun`, which requires a
credential noun on the same line **and** a token of at least 12 characters
carrying both a digit and a letter.

Measured on this branch: **twelve adversarial shapes** (seven plus five) near-linear
at 20, 40 and 80KB across the two scanner test files, and **15 safe strings**
returned unchanged. Timings, best of five on this machine: the repeated-colon shape
**332ms** at 80KB, the identifier-run shape **4ms** at 80KB, and the
unauthenticated intake path **under 1ms** at 160KB. The colon shape is the
expensive one because `:` is legitimately part of a value and so cannot terminate
the run; it is bounded by a 512-character per-value cap rather than by the input
size.

Three shapes were quadratic in the *first* version of this scanner — an unbounded
`[A-Z]+` in the key splitter, a value run that `:` could not terminate, and
per-span string rebuilding. Each is fixed at its cause.

## Fourth independent audit: wrong in both directions at once

The fourth audit found the detector failing in opposite directions in the same
round, which is what forced the model below rather than another pass of tuning.

- `DB_PASS=pr0d-Xk92mQvn7Lz`, quoted from a `docker-compose.yml`, reached a
  `deliverable: true` report. `pass` and `pw` had been confined to a
  "whole key only" set, for a stated reason — `"bypass" is not "pass"` — that
  SEGMENT matching had already handled. The restriction bought nothing and cost
  the second most common credential variable name there is.
- `"Password: rotation policy is weak"` — the ordinary wording of a real finding —
  hard-failed the $299 deliverable, and the same rule told a customer who
  described their stack as `"Auth: Clerk. Payments: Stripe."` to remove the
  credential from the public intake form.

### The detector classification model

A boolean cannot express that difference, because the difference is not in the
KEY — both say "password" — but in the VALUE and its context.

| Classification | What it means | What it entitles |
| --- | --- | --- |
| `credential_evidence` | High-confidence credential syntax or value | Redact, and **refuse delivery** while present unredacted |
| `ambiguous_secret_candidate` | Could be either | Redact for safety, **do not hard-fail**, and **hold** for a named human. The report carries the reason |
| `sensitive_prose` | Security vocabulary in ordinary sentences | Preserve exactly. It is what the report is *for* |

Precedence is total and deterministic — evidence beats ambiguous beats prose — so
two signals on one span always resolve the same way, and nothing is downgraded by
finding a second, weaker reason to look at it. **An ambiguous item never passes
silently:** `clearedSecretHolds` records who released it, lives inside the
artifact so it is hashed with everything else, and the delivery gate refuses
until it is there. Clearing is for uncertainty, not for overriding a confident
detection — a `credential_evidence` hit cannot be cleared this way.

**The discriminator is the assignment SYNTAX, not the value.** This reverses what
the previous pass wrote here, and the reversal is the point of this one.

Letting value shape decide produced the worst possible failure. `DB_PASS=swordfish`
scored as ordinary prose, `sensitive_prose` drops the span entirely, and the
password was neither redacted nor held nor reported — it shipped. The commit
before that change had redacted it correctly. Ten forms regressed the same way.

So on a credential-named key in machine syntax — `=`, `:=`, `=>`, a quoted value,
`ENV K V`, a command flag, an XML attribute or element, `.netrc`, `.pgpass`, a
URL's userinfo — the classification is `credential_evidence` and nothing
downstream gets a vote. Not the value's shape, not a trailing comment, not the
sentence around it. On a `password=` line the uncertainty is about how bad the
leak is, never about whether to act.

Value shape survives in exactly one branch: the **bare colon**, because `:` is
both YAML and English punctuation and nothing else separates `db_password: hunter2`
from `Password: rotation policy is weak`. There it decides in this order — an
opaque value is evidence; sentence punctuation attached to the value, or a tail
that reads as a sentence, is prose; anything else is held as ambiguous. A quoted
value after a colon is machine syntax and leaves the branch entirely.

Detection itself is closed under the variations an audit varies. `pass` and `pw`
are segments now, with the abbreviations people actually type, and the phrase set
is **generated** from qualifier × carrier rather than listed — because listing is
exactly how `AUTH_HEADER` was missed: `auth` alone is too broad, `header` alone
is meaningless, the pair is obvious, and nobody had typed it. Three forms were
added: PHP-style argument lists (`define('DB_PASSWORD', '…')`), attached
single-letter flag values (`mysql -pSECRET`), and positional records (`.pgpass`,
where no key name appears on the line at all, so the FORMAT is the evidence).

Measured on this branch, along the axis each audit varied:

- **21 assignment forms × 14 key shapes**, value held fixed
  (`release-rescue-credential-scanner.test.ts`).
- **27 carriers × 21 values, 550 combinations executed** (the product is 567; space-bearing values are skipped in unquoted carriers), key held fixed at `DB_PASSWORD`
  (`release-rescue-scanner-value-properties.test.ts`). 14 of the values must be
  redacted and 7 are placeholders that must survive, so a detector that redacts
  everything fails as surely as one that redacts nothing.
- **11 URL and auth-header carriers** crossed with the same values.
- **6 lines of ordinary audit prose** returned byte-for-byte unchanged.

The value axis is the one audit 5 attacked, and writing it found four defects that
the form × key matrix could not see: `export K=V` spans included the `=`, so the
correct Dockerfile idiom `ENV DB_PASSWORD=${DB_PASSWORD}` was redacted as a leak;
a quoted YAML value fell back to `ambiguous`; `.netrc` was only ever tested with a
key name that format does not use; and `Auth: Clerk. Payments: Stripe.` — the
customer's own words — was still being redacted out of report bodies.

### The retention authority model

No caller-reachable timestamp decides when customer data is destroyed. Not
directly, not through another column, and not through a column that defaults to
something trustworthy.

The previous round stopped deriving `purge_after` from caller input and started
deriving it from `created_at` — an ordinary column with a `now()` default that
`authenticated` could write. An ordinary customer insert bought **3713 days** of
retention. `created_at` is now written by the server on every row, immutable
afterwards, and the derivation reads `now()` and never a column, with a schema
assertion that fails the migration if it reads that argument again.

A column-level `REVOKE` was written as defence in depth and **removed**: in
PostgreSQL a table-level `INSERT` grant is not reduced by revoking one column, so
it did nothing. The proof asserts the honest situation — a customer may still
name the column, and it makes no difference.

### Report-field coverage

Coverage is driven from the Zod **schema** as well as the artifact. The artifact
walk could not see `preparedBy.modelId`, because both fixtures set it to `null`
so no string leaf was ever emitted — and populating it, as the provenance rules
require, refused the report. Writing the schema walk reproduced the same bug one
level up: a global `seen` set silently skipped SHARED schema instances, so it
under-reported. The cycle guard tracks the current branch instead.

**62 schema paths, 62 policy entries, zero unclassified, zero stale** — the policy and the schema
agree in both directions, and a new customer-visible field fails the build until
somebody classifies it.

## Fifth independent audit: a guard nobody called, and a column anybody could write

The fifth audit returned four blocking findings. Two were regressions this
document had described as fixes, which is the part worth recording.

1. **Credential values leaked in multiple forms.** The value-shape gate described
   above. Corrected in *The detector classification model*.
2. **Ordinary security prose was still treated as a credential.**
3. **`redactSecrets` and `prepareExcerpt` had no production call site.** Grepping
   for callers returned one hit, and it was a comment. The functions were correct,
   tested, and wired to nothing: every report was assembled from raw input.
4. **`purged_at` was caller-writable.** Reproduced live — a forged stamp survived
   two retention sweeps, because the sweep skips anything already marked purged.
   A customer could keep their data past its retention date by claiming it was
   already destroyed.

### One redaction path, enforced by the type system

A comment saying "call this first" is what produced finding 3. So the path is
enforced where it cannot be forgotten:

```ts
declare const sanitized: unique symbol;
export type Sanitized<T> = T & { readonly [sanitized]: true };

export function assembleReleaseRescueReport(input: Sanitized<AssembleReportInput>): ...
```

`assembleReleaseRescueReport` accepts only a `Sanitized<T>`, and
`sanitizeReportInput` is the only function that produces one. Assembling a report
from raw input does not fail a test — it **fails to typecheck**. A test walks the whole
tree and fails if the brand is minted outside the pipeline module, or if that
module's two producers become three.

`buildReleaseRescueReport` is the production front door: it sanitizes, records
what it held, and assembles. A runtime `assertNoCredentialMaterial` backs the type
up for callers arriving through `any`. That assertion names the **path and the
classification only, never the text**, because exception messages reach logs.

A test walks the whole `src` tree and fails if the brand is minted outside
`release-rescue-pipeline.ts`, or if that module's **two** producers
(`sanitizeReportInput` and `withSanitizedHolds`) become three. Writing
it found that the earlier version of this test read one file and passed while a
second producer sat in `release-rescue-report.ts` — it proved the brand had one
producer in the only file where that was true. That second cast is now a named
helper, `withSanitizedHolds`, which takes the sanitiser's own two outputs, so
nothing unsanitised can reach the brand through it.

The end-to-end test plants five distinct secrets in real `docker-compose.yml`,
`.pgpass` and `.env` content. It asserts first that an observation quoting one of
them is REFUSED at assembly, so no artifact exists; then that the same finding,
written to describe rather than quote, reaches the artifact, the customer view,
the holds and console output carrying none of the five — and that the delivery
gate still refuses while a `credential_evidence` hold is unresolved.

### Destructive authority: `purged_at`

`20260916030000_release_rescue_destructive_authority_v7.sql` makes the column
server-owned on both `release_rescue_engagements` and `release_rescue_reports`:

- a change to `purged_at` outside the retention sweep is **refused**, not silently
  reverted;
- a row cannot be **created** already purged, on either table — the report
  immutability trigger guards UPDATE and DELETE only, so a born-purged report
  would have been accepted and then skipped by every sweep;
- a purged row cannot be **un-purged**, even inside the sweep;
- `clearedBy` on a secret-hold clearance must cast to a UUID and must hold manager
  authority, checked against `operators` in the database rather than in
  application code, because the report body is an `evidence_artifacts` row other
  writers can reach.

The purge-stamp triggers are `SECURITY INVOKER` — inside a definer function
`current_user` is the owner, so a privilege check written there answers for the
wrong role. The clearance trigger is `SECURITY DEFINER` with `set search_path = public`
because it reads the report's `evidence_artifacts` payload, which the caller may
not hold. It does **not** need definer rights to check manager authority — that
goes through `release_rescue_user_holds_manager_authority`, which is itself
definer and granted to `authenticated`. The stated reason used to be the wrong
one, and the reason it was wrong is a finding below.

The migration ends with a `do $$` block listing every destructive or
approval-sensitive column across **all three** tables — engagements, reports and
repository grants; an unlisted one **fails the migration**. That assertion caught
three columns across this pass (`updated_at` and `ownership_confirmation_note` on
engagements, `updated_at` on grants). Its first version filtered on the
engagements table alone while its own comment said "these tables", so the
mechanism covered one of the three it claimed.

`supabase/qa/release_rescue_destructive_authority_v7_proof.sql` runs **41 cases**
on live PostgreSQL, attempting the stamp as every caller class that exists —
anonymous, customer admin, other tenant, plain operator, ops manager, service
role, direct SQL with RLS out of the picture, a forged retention GUC — plus the
positive control that the sweep still purges a due report and leaves one that is
not due alone.

**Why the proof asserts row counts, not exceptions.** RLS denies by making rows
invisible, so an UPDATE that matches nothing raises nothing. A case written as
"expect a refusal" passes for the wrong reason on every role RLS covers, and says
nothing about the trigger. Each case therefore asserts the stored state and
records which of the two controls answered.

### Two pre-existing defects found while building the proof base

Neither is Release Rescue's, and neither is repaired here. Both are on
`origin/main` at `c3cf4a0` and both block replaying the migration chain onto an
empty database:

- `20260828080000_cs4_persisted_ledger_observations.sql` carries an orphaned
  duplicate of its own function body (lines 199-347) with no `create function`
  header, so `psql` cannot parse the file. Lines 1-197 are the complete, current
  definition.
- `20260903090000_execution_runtime_v1.sql` runs `create table
  public.execution_plans`, which collides with the differently-shaped table
  `0004_production_auth.sql` creates earlier in the chain.

The proof base applies 51 of 55 migrations: the two above, one that needs the
`http` extension this sandbox does not have, and one that fails only because a
function the `http` migration would have created is missing. None of the four touch Release
Rescue tables, and all ten Release Rescue proofs run against the result.

## Sixth independent audit: the axis was the key, and the fix was the regression

The sixth audit named the axis both new test files pinned: **every key in both
tables is already a lexicon word that already splits correctly, and every key sits
adjacent to its value on one short line.** Four of its five blocking findings live
there. The fifth was a detector added in the same commit that claimed to fix the
false-positive problem, and which made it considerably worse.

### 1. A run-together key name was invisible

`keyNameSegments` splits on separators and on camel-case boundaries. An ALL-CAPS
run-together name has neither, so `PGPASSWORD` reduced to one segment no lexicon
lookup matched — while `PG_PASSWORD`, one underscore apart, was credential
evidence. `PGPASSWORD` is libpq's own variable: it is what `psql`, `pg_dump`,
Docker entrypoints and CI migration steps read. `DBPASSWORD`, `MYSQLPASSWORD`,
`ROOTPASSWORD`, `SMTPPASSWORD` and `APPSECRET` behaved identically, and
`PGPASSWORD=…` reached a `deliverable: true` report with the credential intact.

That first fix was a hand-written list of words matched as SUBSTRINGS, and audit 7
found it wrong in both directions: it missed the entire token family
(`ACCESSTOKEN`, `GITHUBTOKEN`, `MYSQLPWD` — nobody had typed `token` into it),
and because `secret` is a substring of `secretary` it made `SECRETARY_EMAIL`,
`PASSWORDLESS_LOGIN` and `CREDENTIALING_VENDOR` confident evidence, which is an
unclearable hold on a plausible line of auth code.

It is now derived from the lexicon that already exists rather than a second list
beside it, and anchored at the END of the segment, which is what makes
`secretary` and `passwordless` fail: a credential name ends with what it holds.
Either the segment is `<qualifier><carrier>` from the same product that generates
the separated phrases, or it ends with a carrier word of six characters or more.
`bypass` fails both — `by` is not a qualifier — and a test asserts that it,
`compass`, `passage` and twenty other ordinary words stay out.

### 2. The new opaque-token rule shredded ordinary findings — unclearably

`opaque_token_near_noun` fired on any 12-character token with a digit and a
letter, on any line carrying a credential noun. That is every versioned code path
in this product's own prose: `"The session token is created in
src/lib/auth-v2-helpers.ts"` had the file path — the useful part of the finding —
replaced with a placeholder.

The severity came from the classification. The form hardcoded
`credential_evidence`, bypassing `classifyAssignment` entirely, and
`pendingSecretHolds` refuses to clear a confident detection — correctly, because
clearing is for uncertainty and not an override. So one ordinary sentence of
engineering prose made a $299 report **permanently undeliverable, by any human**.

Two changes. The form now classifies as `ambiguous_secret_candidate`, which is
what a heuristic with no assignment syntax actually warrants. And it requires the
token's entropy to sit in one **contiguous** run of ten or more characters mixing
digits and letters: a generated secret is a blob (`Xk92mQvn7Lz`), while a
versioned path spreads the same character classes across word-joined English
(`auth-v2-helpers.ts`, `deploy-2024-prod-runner`, `ADR-2024-011-authentication`).
Anything containing a path separator is excluded outright.

### 3. One full stop switched the detector off

The rule the fifth round added to stop `Auth: Clerk. Payments: Stripe.` being
redacted was a bypass. `pushSpan` **drops** a `sensitive_prose` span entirely, so
`password: swordfish.` produced no span at all — not redacted, not held, not
reported — while `password: swordfish` was caught. The same worked with `!` and
`?`.

Reverted. `Auth: Clerk. Payments: Stripe.` is now redacted in a report body and
held as `ambiguous_secret_candidate`: a named manager can clear it, and the public
intake form does not refuse it, because intake refuses only confident evidence.
That is a cost a human can undo. A leaked password is not. The test that asserted
the string survived byte-for-byte is gone, because that assertion is what bought
the bypass.

### 4. `truncated` had no reader

The scanner reported truncation past `MAX_SCAN_LENGTH` from the beginning and
nothing consumed it, so a credential at byte 64,001 returned
`classification: null` and `hadSecrets: false`. `redactSecrets` now carries
`scanTruncated`, and `holdsCredentialEvidence`, `containsLikelySecret` and
`prepareStoredExcerpt` all fail closed on it. The test that appeared to cover this
asserted only that the flag was set — a proof case passing for the wrong reason.

### 5. The clearance trigger read across tenants

`enforce_release_rescue_clearance_authority` is `SECURITY DEFINER`, so its reads
bypass RLS, and it selected the report artifact **by id alone**. An auditor
pointed it at another organization's `evidence_artifacts` row and had the refusal
quote that row's payload back. The pre-existing org-match guard would have caught
the insert — but triggers fire in **name order**, and
`trg_release_rescue_clearance_authority` sorts ahead of
`trg_release_rescue_report_invariants`.

The select is now scoped by `organization_id`, and the refusal no longer echoes
the offending value at all, because an exception message reaches logs. A proof
case asserts the refusal comes from the isolation rule and carries none of the
victim's content.

### What the audit also corrected in this document

Six measured claims here were wrong or stale: 22 forms where the table has 21,
eleven safe strings where it has 15, "exactly one `as Sanitized<`" where the test
asserts two, a stated reason for the clearance trigger's definer rights that was
not the reason it needed them, "these tables" for an assertion covering one, and
32 proof cases where there are now 35. Two in-code comments claimed safety
properties the code did not implement — the `truncated` contract above, and
`prepareStoredExcerpt`'s "production entry point", which had no production caller
at all. That one was recorded rather than fixed at the time. It is now moot:
*The excerpt decision* below deleted `prepareStoredExcerpt` and `prepareExcerpt`
along with the field they prepared, so there is no truncating path left to wire
in. An eleventh audit found the same class once more, in
`findForbiddenSourceField`, and that one was wired into report assembly and
validation rather than recorded.

## Seventh independent audit: fixing the class instead of the instance

Audit 7 returned six blocking findings and two regressions from audit 6's own
fixes. Its diagnosis is the one this section is organised around:

> Every cross product in the suite crosses ONE carrier with a key or a value. The
> defects live where two carriers meet. And the false-positive direction is tested
> with hand-picked lists while the credential direction uses products — which is
> how a detector that destroys ordinary findings passed every test.

Both halves were right, and both were reproduced before anything was changed.

### What it found

1. **`ACCESSTOKEN=<live token>` reached a `deliverable: true` report.** Audit 6's
   run-together fix was a hand-written list of password words matched as
   substrings. The entire token family — `ACCESSTOKEN`, `GITHUBTOKEN`,
   `SESSIONTOKEN`, `MYSQLPWD`, `bindpw` — was invisible because nobody had typed
   `token` into it.
2. **The same list made ordinary words into unclearable holds.** `secret` is a
   substring of `secretary`, so `SECRETARY_EMAIL=`, `PASSWORDLESS_LOGIN=` and
   `CREDENTIALING_VENDOR=` were confident evidence.
3. **A YAML comment dropped a credential span entirely.** `DB_PASSWORD: swordfish
   # this is the value we use in the staging config` read as prose, and prose
   drops the span. The same bypass as the reverted `valueEndsSentence` rule, one
   comment marker instead of one full stop.
4. **Three lines of routine route code became an undeliverable report.** `;` was
   in the delimited-data delimiter table, and `;` terminates a statement in every
   language this product reviews. An excerpt whose first line mentioned `getToken`
   was read as a CSV header plus two rows.
5. **`Tokens: 30-day lifetime with no rotation.`** scored as opaque — a digit and
   letters, six characters — so it was confident evidence, refusing the customer
   at intake and bricking the report. Audit 5's defect, reached by varying the
   value shape instead of the wording.
6. **A second `SECURITY DEFINER` trigger read across tenants.** Audit 6's fix
   scoped `enforce_release_rescue_clearance_authority`;
   `enforce_release_rescue_report_commit` sat four lines away doing the same
   thing, and quoted the victim tenant's private commit SHA back in its refusal.
7. **Key and value on separate lines were never associated** — which is what
   `JSON.stringify(x, null, 2)` and every YAML writer produce once a line gets
   long.
8. **The opaque-token downgrade re-opened the public intake form.** Intake refuses
   only confident evidence and cannot redact, so downgrading that form to
   ambiguous meant a live key pasted into "evidence notes" was accepted and
   stored in the clear, where the previous version refused it.

### The rule this round followed: derive, do not enumerate

Every fix above is a property, and each one is asserted as a product rather than
a list:

- **Run-together names** come from the qualifier × carrier product that already
  generates the separated phrases, anchored at the end of the segment. A test
  asserts `keyLooksSecret` for every pair in both spellings.

  That claim was too strong, and audit 8 said why: the test iterates the same two
  arrays the rule is built from, so it **cannot fail**, and it did not see
  `VERCELTOKEN`, `APIACCESSTOKEN` or `MYSQLROOTPW`. A tautology is not a
  construction. The split is recursive now, and it is the corpus assertions in
  `release-rescue-audit8-properties.test.ts` — real credential values, real
  ordinary identifiers — that constrain it. The anchoring still fixes the
  over-reach in the same stroke.
- **Composed carriers** get their own product: nine outer contexts (trailing hash
  comment, slash comment, leading comment, indentation, nesting, following key,
  preceding prose) × eight inner forms, asserting the composition is never weaker
  than either carrier alone.
- **The false-positive direction is now a product too** — six subjects × six
  predicates of ordinary audit prose, asserted against both the classifier and
  the intake form, plus four real source excerpts asserted byte-for-byte.
- **The `SECURITY DEFINER` class is checked in SQL.** The v7 proof iterates
  `pg_proc where prosecdef` and fails on a `from` or `join` read of a tenant table
  with no `organization_id` in the same statement, comments stripped first. Three
  rounds of fixing one trigger at a time is what that replaces.

  Scope, stated honestly because two earlier versions of this sentence were not:
  it is a regex over the function body, so it does **not** see a subquery, a CTE,
  dynamic SQL, or an `UPDATE`. Audit 9 planted nine shapes it misses. Its
  committed negative control asserts the four shapes it does catch, plus one
  correctly-scoped read it must not fire on, so what it covers is now written down
  in the proof rather than claimed here.

Writing those products immediately found two more gaps that no list would have:
`DBPW`, `PGPW` and `IDPW` sat one character under a floor picked by eye, and
`export const sessionSecret = config.sessionSecret;` was redacting a code
reference. Both are fixed; a dotted identifier path without digits is a
reference, and `admin.password123` still is not.

### Where intake and the report pipeline now differ, deliberately

The two surfaces have different powers, so they get different thresholds. The
report pipeline can redact and hold, so an `ambiguous_secret_candidate` is
redacted and held for a named manager. The intake form can only store what the
customer typed or refuse it, so it refuses confident evidence **and** the
opaque-token form, while still accepting every line of ordinary prose in the
product test above. One boolean for both surfaces is what produced audit 5's
false refusals and audit 7's silent acceptance, in turn.

### Non-blocking findings recorded rather than fixed

- `hasContiguousEntropyRun` excludes tokens containing `/`, so base64 and
  AWS-shaped secrets are invisible **to the near-noun prose form**. The assignment
  forms still catch them; the cost of including `/` is every file path in every
  finding.
- `sanitizeValue`, `scanForSecrets` and `prepareExcerpt` ignore `scanTruncated`.
  Unreachable today only because the report schema caps every string at 4,000
  characters — so a future field added without a `.max()` re-opens it silently.
  Worth closing, and it is a change to the walk that wants its own proof.
- The v7 column-class assertion selects by **name pattern**. A destructive column
  named `deleted` or `anonymized` matches none of the patterns and would pass. The
  document previously called this "enumerating the class"; it enumerates a naming
  convention, and that is now what it says.

## Eighth independent audit: every allowlist was a silent-drop route

Audit 8 returned nine blocking findings and **seven regressions shipped by audit
7's own fixes**. Its root-cause diagnosis is the one this round is built on, and
it is about architecture rather than any single pattern:

> `isNonSecretValue` makes `valueShape` return `placeholder`;
> `classifyAssignment` turns `placeholder` into `sensitive_prose`; and `pushSpan`
> **drops a `sensitive_prose` span entirely**. So every entry in the value
> allowlist is a silent-drop route, and each time a false positive was closed by
> adding one, a class of real credentials went silent.

That is exactly what happened. The quantity pattern added to close audit 7's
`Tokens: 30-day lifetime` false positive routed **any** digits-then-letters value
to silence, so `PGPASSWORD=123456abcdef` and `DB_PASSWORD=1qazXSW` reached a
`deliverable: true` report with the credential intact. The dotted-path pattern
added to stop a code reference being redacted also matched
`PASSPHRASE=correct.horse.battery.staple` — which is how a diceware passphrase is
written. The keyword list contained `default`, so `DB_PASSWORD=default` was
dropped.

**The rule now: the allowlist holds structural references only, never a guess.**
A `${VAR}`, a `process.env.X`, a `<placeholder>`, an `[REDACTED]` marker, a path
rooted at a known object — each of these *cannot* be a literal secret. (The call
expression left the allowlist in the audit-10 round; a call is now a property of
the value span, not a pattern.) Anything that was a guess about the value has been removed or moved to
where it belongs. `30-day` is now handled in `valueShape`, which only the
bare-colon branch consults, so `Tokens: 30-day lifetime` is still prose and
`PGPASSWORD=123456abcdef` is still evidence, because structured syntax never asks
about value shape at all.

A property test asserts the inverse of what was being tested before: for a corpus
of real credential values, **none** may match the allowlist. The old question was
"is `30-day` a secret?"; the question that matters is "can a secret be shaped like
`30-day`?"

### The other seven

- **An empty `DB_PASSWORD=` swallowed the whole next line** and stamped it
  `credential_evidence` — in a committed `.env.example`, a file this product
  explicitly accepts as evidence. Since a confident hold cannot be cleared by any
  human, an env template containing no secret made the report permanently
  undeliverable. The cross-newline reach requires the next line to be a
  *continuation*. **Superseded** — the "no operator" test was replaced by
  indentation in the audit-9 round, because it fired on `admin:Xk92mQvn7Lz` as
  readily as on a key.
- **Uppercase SQL was read as CSV.** `looksLikeSourceCode` had no `i` flag, and
  `HEADER_FIELD` permitted spaces, so `SELECT id, password, email` was a header
  and the next line's `created_at` was destroyed. The audit-7 defect, moved from
  JavaScript to SQL.
- **Real CSV escaped entirely** — a header carrying an ordinary `from` column, a
  parenthesis, or a long field disabled the form. Both directions were addressed
  by testing each FIELD rather than the line. **Superseded twice since** — that
  test broke a header with an ordinary `order date` column. See the audit-10
  section for the current rule.
- **`APIACCESSTOKEN` and `MYSQLROOTPW` were invisible.** The run-together split
  peeled exactly one qualifier, so it closed depth 2 and not depth 3 — every
  product in the suite composed two elements. It now splits recursively.
- **Nine ordinary configuration names were confident evidence**, including
  `SMTP_AUTH`, `USER_KEY`, `MAIL_SIGNATURE` and `SESSION_HEADER_NAME`. `header`
  and `signature` are no longer carriers in the qualifier product (they name a
  transport, not a secret; the pairs that *are* credentials are listed
  explicitly), `user`/`id`/`bot` are no longer qualifiers, and a name whose final
  segment is a reference noun — `_ID`, `_EMAIL`, `_FILE`, `_HOST` — is a pointer
  to a credential rather than one. `AWS_ACCESS_KEY_ID` is not the secret;
  `AWS_SECRET_ACCESS_KEY` is.
- **`const authHeader = request.headers.get("authorization")`** — the most common
  line in an AI application's auth middleware — was mangled into invalid syntax at
  `credential_evidence`. The key name is genuinely credential-bearing and stays
  so; what was wrong is that a **call expression** was treated as a literal.
- **The intake form refused a prospect over an abbreviated git SHA.** The
  identifier exclusion started at 32 characters, which admits exactly the
  7-to-12-character form git itself prints.

### The SECURITY DEFINER proof, rebuilt — and a claim withdrawn

The previous round's proof was unsound in four ways, and the audit demonstrated
each by planting a function it passed: it filtered on a name pattern (examining 8
of 15 definer functions), its "conjunct" test was satisfied by `organization_id`
appearing anywhere later **including inside a comment**, it matched `from` but not
`join`, and its table list was six hand-written names where the catalogue reports
**42** tables carrying `organization_id`.

It now examines every definer function in `public`, derives the tenant tables from
`pg_attribute`, strips comments before matching, splits on statement boundaries so
a scoped read elsewhere cannot vouch for an unscoped one, and matches `join` as
well as `from`.

**A claim is withdrawn.** The previous version of this document said that check
had been "verified against a planted violation, so it is known to be capable of
failing." It had been verified interactively and **no negative control was
committed**, which makes the sentence false as written — a property proof that has
never been seen to fail is not evidence. The four planted shapes are now committed
cases that the proof asserts it catches, plus one correctly-scoped read it must
not fire on. Writing that control immediately caught an error in the control
itself: `release_rescue_retention_runs` is global accounting and carries no
`organization_id`, so it was the wrong table to plant.

## Ninth independent audit: making suppression observable

Audit 9 found nine real credentials reaching a `deliverable: true` report, eight
of them admitted by an entry in the value allowlist, and three regressions inside
audit 8's own fixes. All nine were reproduced before anything changed.

It also named the reason this keeps happening, and this round acts on that rather
than on the instances:

> `placeholder` → `sensitive_prose` → span dropped is still the only way to say
> "not a secret". Every future false-positive fix will be made here and every one
> will be a leak. The structural repair is a fourth outcome that suppresses
> redaction but still **records** a span, so a wrong allowlist entry over-reports
> instead of going silent.

### The change: a suppression is now a thing that happened

`pushSpan` no longer returns early on `sensitive_prose`. Every span is recorded.
Suppressed spans are not redacted — the text stays readable, which is what they
are for — but they are reported on `RedactionResult.suppressed`, as a form and a
length, never the text.

That converts the recurring defect from invisible to testable. Before this, "we
assessed this and judged it harmless" and "we never looked at it" produced
identical output: nothing. Four consecutive audits found a leak whose only symptom
was an absence, and the only way to find one was to guess the exact value.

`release-rescue-audit9-properties.test.ts` now asserts the property directly over
a **generated** corpus — bodies crossed with the leading and trailing characters
that real secrets carry, plus the passwords people actually choose, plus diceware
rooted at every word the reference-path rule knows:

- no generated credential may be suppressed;
- none may survive redaction;
- none may reach a deliverable report;
- and every structural reference must be *reported* as a suppression rather than
  vanish.

The generator found its first class within minutes of being written: 225
suppressions on the first run, then 27, then 18, each a different mechanism. A
sixteen-value hand-picked list had been passing throughout.

### What the allowlist lost

Eight entries admitted a real credential and are gone or anchored:

| was | admitted | now |
| --- | --- | --- |
| `/^-/` | `-Xk92mQvn7Lz` | long flags only, `--word` |
| `/^\$\{?NAME\}?$/` | `$ecretPass` | braced, or `$WITH_UNDERSCORE` |
| `password\|secret\|token\|key\|test` | `DB_PASSWORD=password` | **removed entirely** |
| `/^<[^>]*>$/` | `<M3g@Secret>` | placeholder-shaped contents only |
| `/^[*x•.\-_]+$/i` | `xXxXxXxXxX` | one case per run |
| `your\|my\|the` prefix | `my-super-horse-staple` | must also END like a placeholder |
| rooted dotted path | `window.tiger.canvas.rope` | known root + member, or root + real API surface + member |
| call expression | `hunter2(` | `(` now terminates the value run, and a call needs a closing paren |

A value whose whole word is `password` or `secret` is a **finding**, not a
placeholder. That entry was the oldest and the most obviously wrong in hindsight.

### The three regressions, and one rule that replaced two guesses

- **`isContinuationLine` gave up every wrapped value containing a colon.** It
  looked for an assignment operator, and that fires on `admin:Xk92mQvn7Lz` — a
  `user:pass` pair — as readily as on a key. It also still let prose through, so
  `DB_PASSWORD=` followed by `Rotate this before launch.` swallowed the sentence
  and bricked the report. **Indentation** replaced both guesses: a continuation is
  indented further than its key, or it is a quoted line. That is what the formats
  themselves use, and it fixes both directions at once.
- **A per-field code test let real CSV escape** through an ordinary two-word
  column name (`order date`, `update time`). Anchoring the statement check at the
  start of the line, and requiring whitespace after the verb, separates
  `ORDER BY id` from an `order date` column and `FROM users` from a `from` column.
- **The call-expression allowlist was itself a silent drop**, and it only worked
  for one spelling out of four. `(` now terminates the value run, so
  `getToken(req)`, `get_password(user)` and `fetchToken(ctx)` are all left alone,
  and `DB_PASSWORD=hunter2(` is recorded rather than dropped.

### `<vendor>_KEY`, inverted

`key` was credential-shaped only as a whole name or after a hand-written qualifier
list — and this product's market is precisely the vendors nobody has added to that
list yet. `HMAC_KEY`, `SUPABASE_KEY`, `GROQ_KEY`, `CSRF_KEY` and `WEBHOOK_KEY`
were all invisible.

The rule is now inverted: `<anything>_KEY` is a credential **unless** the
preceding segment names a data-structure key (`cacheKey`, `partitionKey`,
`idempotencyKey`, `routeKey`). That set is small, closed, and about data
structures rather than vendors, which is the right shape for a default in a
security tool. `secret` takes no such exception: `USER_KEY` may be a map key,
`USER_SECRET` is not.

### The trend, stated plainly

Nine audits have now run and all nine returned DO_NOT_MERGE. Four consecutive
rounds shipped a regression inside the fix for the previous round's finding. The
database authority model has converged — 257 live cases, and the last three audits
found nothing in it but the two definer reads. The **detector** has not.

That is worth stating as a finding rather than as a status. The scanner is being
asked for high recall (never leak a credential) and high precision (never brick a
paid report) over arbitrary customer source, where a precision failure is
*permanent* because a `credential_evidence` hold cannot be cleared by any human.
Those are hard targets for a text scanner, and each round has traded one against
the other.

Two options exist that this pass cannot take on its own authority, and both are
recorded here for an owner decision:

1. **Stop republishing customer source.** If a finding cited `path:line` and a
   description instead of an excerpt, the entire class of defect disappears —
   there would be no customer credential in the artifact to leak. This is a
   product scope decision, not an engineering one.
2. **Let a confident hold be cleared by two named people with an audit record.**
   The unclearable invariant is correct against a *precise* detector; against this
   one it converts every false positive into a permanently undeliverable paid
   report. Changing what may be cleared is an authority change and belongs to the
   owner, not to this pass.

## Tenth independent audit: the leaks were never in the arm that was fixed

Audit 10 was blunt, and correct on every point I could reproduce — which was all
of them.

**The structural change did not hold.** Recording `sensitive_prose` spans closed
one route to silence: *a span was produced and then classified away*. The leaks
were not there. `valueSpan` scans a character RUN and stops at `#`, `&`, `(`, `;`,
a quote or a space — so a password containing any of those was captured as a
two-character prefix, and the rest sat in the text. The recorded span said "I
assessed 2 characters and judged them harmless", which is indistinguishable from
a correct suppression. Sixteen real credentials reached a `deliverable: true`
report.

**And the test written to catch exactly that was vacuous.** The gate assertion in
`release-rescue-audit9-properties.test.ts` — annotated "the one assertion that
speaks for the customer" — built its fixture with `passingAssessments()` while
attaching a finding. That is a contradiction deterministic validation rejects on
its own, so `deliverable` was false for an empty excerpt, for `"hello world"`, and
for a real password alike. It could not fail. It is fixed, and a guard now runs
beside it asserting the fixture itself is deliverable, so if this recurs the
guard fails instead of the suite passing quietly.

### The real fix: for an assignment, the line IS the value

There is no need to know where a value ends. After `=`, on a line whose purpose is
the assignment, everything to the end of the line is the value — whatever
punctuation it contains. That closes the entire mid-value class in one change
rather than by widening a terminator set, which is what the previous five rounds
were doing and why each traded a leak for a brick.

Three carve-outs, each because the line genuinely holds more than one field: a
quoted value ends at its quote; a URL or query string keeps the tight run, so
`?api_key=x&sort=name` stays two fields; an inline `{...}` structure keeps it too.
A trailing ` #` comment stays readable, and the span is capped at the same 512
characters as the run form — without that cap, 80KB on one line made the scan
quadratic, which the performance test caught at 2,328ms.

It applies only where the assignment **starts the line**. `The deploy config sets
DB_PASSWORD=<your-password> in production.` is a sentence that happens to contain
one, and taking the rest of that line redacted the prose around the placeholder.

### The false-positive side, which was worse than the leaks

The `_KEY` inversion made a large class of ordinary identifiers unclearable
`credential_evidence` — including **this repository's own source**:
`PUBLIC_WEB_RESEARCHER_KEY`, `VALIDATOR_EXECUTOR_KEY`,
`CONTEXT_SHUNT_PROVIDER_KEY`, plus `STORAGE_KEY`, `ENTER_KEY`, `STATE_KEY`. A
review that cannot quote the code it is reviewing has no product. The structural
deny-list now covers browser, UI and application-constant keys. `session` and
`registry` are deliberately **not** on it — a session signing key is a credential.

Restoring language keywords to the source-code test also matters: moving them to a
SQL-only check lost `return`, `await`, `const`, `def` and the rest, so
`return user, password` over two lines was read as a CSV header and its second
line destroyed.

Indentation is now compared in **columns**, not characters, so a tab-indented key
and a space-indented continuation are commensurable. Whether a wrapped value was
found at all had depended on which whitespace the file happened to use.

### What is still open, stated rather than closed

- `DB_PASSWORD:` followed by an **unindented** value is not associated. Either
  answer costs something: treating an unindented next line as a continuation is
  what swallowed `API_HOST=prod.example.com` and bricked a report. This is a
  genuine ambiguity and it is left as a known gap rather than guessed at.
- A value longer than 512 characters is redacted for its first 512. It still
  holds the report, so it does not ship, but a fragment persists.
- `DB_PASSWORD=Xk92 mQvn7Lz` inside prose (not at line start) still redacts only
  the first token.

### The trend, updated

Ten audits, ten DO_NOT_MERGE, and **five** consecutive rounds with a regression
inside the fix. The previous section said four; audit 10 pointed out it was
already five when written.

The database authority model has converged — 257 live cases, and the last four
audits found nothing in it beyond two `SECURITY DEFINER` reads, both now scoped.
The detector has not converged, and the failure is now demonstrably symmetric: it
has both leaked credentials and permanently bricked correct reports, in the same
commit, five times.

The two owner decisions recorded in the audit-9 section stand, and the evidence
for the first has strengthened considerably. Stating it plainly rather than
neutrally: **the recommendation is to stop putting customer source excerpts in the
artifact.** A finding that cites `path:line` and describes what was observed
carries the same diagnostic value to the customer and removes the entire defect
class, because there is no customer credential in the artifact to leak or to
redact wrongly. Everything else here is an attempt to make an unbounded text
scanner precise enough to be safe in both directions at once, and ten audits say
that is not converging.

## The excerpt decision

**Owner decision, after ten independent audits: a finding POINTS AT source and
never carries it.** Raw customer source excerpts are removed from every persisted
artifact and every customer-facing surface.

### What a finding carries now

| Kept | Removed |
| --- | --- |
| `path` — the repository-relative file | `excerpt` |
| `startLine`, `endLine` | any source window |
| `rubricCheckId` | any raw source text |
| `severity` (derived, not chosen) | any scanner span exposing source |
| `observationCode` — resolves to the observation | `whatWeObserved`, and every other prose field (see below) |
| `remediationCode` — resolves to what to do | `recommendation`, likewise |

The customer opens `src/app/api/orders/route.ts:18–27` in their own checkout,
where the source already is. Nothing diagnostic is lost; the copy is.

### Why this and not another detector round

Ten audits attacked the credential detector whose entire job was making a copied
excerpt safe to ship. Five consecutive rounds shipped a regression inside the fix
for the previous round's finding, and the tenth reported the detector **both
leaking credentials and permanently bricking correct reports in the same commit**
— a password containing `#`, `&`, `(` or a space reached a `deliverable: true`
report, while an ordinary two-line auth snippet produced an unclearable hold.

That is not a tuning problem. A text scanner asked for high recall (never leak)
and high precision (never brick a paid report) over arbitrary customer source,
where a precision failure is permanent, has no setting that satisfies both. The
decision removes the requirement rather than the symptom: **there is no customer
source in the artifact to redact wrongly or to leak.**

### Where it is enforced

Not in one place, and not by blanking a field after assembly.

| Boundary | Mechanism |
| --- | --- |
| TypeScript types | `findingLocationSchema` is `{ path, startLine, endLine }`, `.strict()`. Every excerpt site in the repository became a compile error. |
| Report builders | The assembler passes findings straight through; a location carrying source cannot be constructed. |
| Schema rejection | `FORBIDDEN_SOURCE_FIELDS` — 22 names, not just `excerpt` — so a legacy caller is refused **by name**, not with "unrecognized key". |
| Report JSON | The field does not exist to serialize. |
| Report HTML | The `<pre><code>` block is gone; a test reads `report-view.tsx` and fails if any `location.<forbidden>` reappears. |
| Database | `20260916050000_..._v8.sql` installs a trigger on `evidence_artifacts` refusing any Release Rescue payload whose findings or locations carry a forbidden key. |
| Logs and errors | The refusal names the FIELD, never its contents; a test plants a secret and asserts the rejection message does not carry it. |
| Field policy | No disposition classifies a source-carrying path, asserted rather than assumed. |

The TypeScript list and the SQL list are bound together: a test fails if a name
refused in one is not refused in the other, **in either direction** — the list
is compared as a set, so a name added to SQL alone fails too. Two lists in two
languages drift apart silently otherwise.

### What the scanner still does

It still reads source — transiently, in memory, to find the finding in the first
place. That was never the problem. What changed is that the text does not travel:
no excerpt is persisted, returned, logged, or included in a customer artifact.

**Redaction remains defence in depth, and is no longer the safety argument.** It
runs over a report's free-text fields, which a person writes.

An earlier version of this section claimed that if redaction was wrong there,
"the cost is a held report, not a leaked credential, because the field a
credential would have arrived in no longer exists." **That was false, and an
audit measured it.** With a prose prefix in front of the assignment — `The
committed configuration contains: DB_PASSWORD=Ab#hunter2hunter` — 30 of 116
generated credential values reached a *deliverable* report with the value intact.
The same 116 in a bare assignment leaked none: the span extractor stopped at the
`#`, judged the two characters it had captured a placeholder, and suppressed the
span. Removing the excerpt had relocated the text onto the field an auditor
writes when describing a hardcoded credential — the most likely finding this
product will ever produce — where the detector was weakest.

The fix is not the terminator set. That is the seventh round of the cycle the
owner ended. See *An observation describes; it does not quote* below.

### One field tightened on the way

With the excerpt gone, the widest remaining field shaped like somewhere to put
source was an assessment's evidence `reference` — 500 characters of unconstrained
free text for what is meant to be a path or a test id. It is now a single-line
pointer: no newlines, no control characters, 300 characters. A reference points;
it does not quote.

`CustomerFindingView.locations[].lines` was renamed to `lineRange` for the same
reason — `lines` is on the forbidden list, because a `lines` array is how source
is carried, and a name forbidden in one place should not be legitimate in another.

### The path was the other one, and it had no shape

An audit asked the question the first half of this decision did not: with
`excerpt` gone, which field in a finding still takes its VALUE from the
customer's repository? `locations[].path`. And it was `identifierString.max(400)`
— non-empty, no leading `/`, no `..`, no `://`, and nothing else. Four hundred
characters of anything, newlines included. A source window pasted there validated,
stored, and rendered under a "Where" heading.

`repositoryPathSchema` now enforces a grammar: a `/`-separated sequence of
non-empty segments of Unicode letters, digits and `. _ - + @ ~ ( ) [ ]`, **with
no spaces**, no segment over 255 characters and no path over 400.

The first version allowed single spaces between words so that
`docs/Architecture Overview.md` would validate. An audit put
`config app.env holds the value Xk92mQvn7Lz on line 14` in the field — a sentence
carrying a credential, which validated, stored and rendered as a path. The spaces
are gone; the stated cost is that a file name containing one is refused, and an
auditor whose customer has one cites the directory instead.

Two refusals were corrected at the same time, both pre-dating this decision:

- **Catch-all routes.** The traversal rule was `!value.includes("..")`, present
  since this workstream's first commit. It refused
  `app/api/auth/[...nextauth]/route.ts` — the most common authentication entry
  point in this product's target framework, on a dimension the rubric gates at
  weight 3. A confirmed finding must cite a location, so an auth finding on that
  route could not be recorded at all. The rule now refuses a `..` *segment*.
- **Non-ASCII file names.** The character class was ASCII-only, so `src/résumé.ts`
  and `src/日本語/page.tsx` were refused. It uses Unicode letter classes now.

The database enforces the part of that grammar a second implementation cannot get
wrong — no control characters, the same 400-character cap — and deliberately not
the whole thing. A row guard *stricter* than the application refuses reports the
application considers correct, and the operator holding the undeliverable report
has nothing to act on. A test asserts the application refuses everything the
trigger refuses, which is the direction that has to hold.

**The honest limit.** `AKIAIOSFODNN7EXAMPLE` is a legal file name, so no path
grammar can refuse it. The grammar removes the channel — a pasted window — and
the scanner covers what still fits through it; a credential-shaped path produces
a report that is not deliverable. That is asserted as an outcome, not as a claim
about which control answered.

### An observation describes; it does not quote

The prose fields are the other place customer text now lives:
`whatWeObserved`, `whyItMatters`, `recommendation`, `residualUncertainty` and an
assessment's `rationale`. They are 4,000 characters each and an auditor writes
them, and the single most likely finding this product will ever produce is "a
credential is hardcoded here".

`src/lib/release-rescue-prose.ts` refuses a **construct**, never a value:

| Refused | Because |
| --- | --- |
| an assignment to a credential-named key, with any right-hand side | an observation names the setting; it does not reproduce the line |
| a URL carrying userinfo credentials, in any case | the same rule as a finding location: cite the file and line |
| a `-----BEGIN … PRIVATE KEY-----` header, in any case | there is no safe fraction of a private key |

**There is no operator list.** The first version of this rule enumerated
operators — `:=|=>|={1,3}|!=|<=|>=` — and an audit crossed a generated corpus
with eighteen carriers against it. `DB_PASSWORD += "value"` delivered **346 of
366** values to a customer-facing report. So did `**DB_PASSWORD**=value`,
`<code>DB_PASSWORD</code>=value`, the fullwidth `＝`, and the value placed one
line down. That list had exactly the shape of the terminator set the owner
retired: correct for the examples that built it, blind one character away.

So an assignment is now **a credential-named key, then any run of non-word
characters containing an equals sign, then something assigned** — on that line or
the next non-blank one. `+=`, `||=`, `??=`, `.=`, `**=` and `＝` are covered
without being named. Comparisons that share the sign (`==`, `===`, `!=`, `<=`,
`>=`, `=>`) are excluded. HTML tags are stripped before the scan, because markup
is not content, which closes `<code>`, `<b>` and every other wrapper at once.

The only thing any branch asks about the value is whether one exists. The refusal
is a refusal — assembly throws and no artifact exists — rather than a scrub,
because blanking after assembly means the value existed in this process and in
whatever logged it.

It applies to **every executor-written field a customer reads**: a finding's
`title`, `whatWeObserved`, `whyItMatters`, `recommendation` and
`residualUncertainty`; an assessment's `rationale` and its `evidence[].reference`;
`limitations`; `scope.*.description`; `customerExclusions`; and a cleared hold's
`rationale`. An earlier version covered five of those, and an audit planted an
assignment in each of the rest and delivered every one.

**There is no bare-colon arm, and that is deliberate.** The first version had
one. It refused `- token: enforce a 30-day expiry`, `OTP: the one-time code is
six digits`, `Sessions last 24h; auth: cookie-based with no CSRF token` — and,
worst, `db_password: ${env.DB_PASSWORD_REF}`, which is the **fix this product
recommends**. A Markdown bullet list is the default output shape of every LLM
executor, and the refusal threw away the entire report, not the field. Separating
a config line from a sentence needs the tail read as prose, and the owner ruled
that out: a credential-named key must never be downgraded because of sentence
shape. Since it cannot be done safely, it is not done at all.

**That claim was published here as "measured rather than assumed", and it was
false.** This document, the commit message and the pull request all said every
colon spelling is held by the scanner, so the arm was buying false refusals and
no safety. The measurement behind it pinned the value to one alphanumeric string.

An audit re-ran it across value shapes. **12 of 35 colon forms deliver a live
credential** to a customer-facing report with zero blockers and zero holds, and
the parent commit refused six of the seven that now deliver. The discriminator is
the VALUE, not the spelling: a value carrying `#`, `$` or a space walks through
every colon form, and an alphanumeric one is held by all of them. Thirteen audits
of corpora used alphanumeric bodies, which is how that survived.

So removing the arm **did** cost safety on the colon carrier, and keeping it cost
15 of 21 ordinary auditor sentences. Neither state is acceptable, which is the
finding rather than a detail of it — see *What is actually open* below.
`release-rescue-prose.test.ts` now measures all 35 combinations and records the
12 rather than asserting a number that cannot fail.

**The stated cost.** An auditor cannot paste a line of code into an observation
when that line assigns to a credential-named identifier. `const token =
getToken(req);`, `password = get_password(user)` and `token := fetchToken(ctx)`
are refused, and none of them holds a credential. Letting them through would mean
asking whether the right-hand side looks like a secret, and that question is the
detector ten audits took apart. The refusal names the key and says what to write
instead. An assignment to a key the lexicon does not recognise — `STORAGE_KEY`,
`cacheKey`, `PORT` — is not this rule's business and passes untouched.

**The gaps this does not close, at their true size.** Each is asserted as a
measurement in `release-rescue-prose.test.ts`, so it is a number somebody can
read rather than a sentence somebody wrote:

| Gap | What stands there instead |
| --- | --- |
| a credential written with **no key at all** — "the committed value is `Xk92mQvn7Lz`" | nothing structural. It reaches a deliverable report with the value intact. |
| a key the lexicon does not recognise (`STRIPE_SK`, `NEXTAUTH`) | the same. The lexicon is the boundary of what "credential-named" means. |
| **a credential-named key joined to its value by anything other than `=`** — `DB_PASSWORD is set to <v>`, a markdown table row, a tab, `DB_PASSWORD -> <v>` | nothing. Measured at **12 of 12** carriers delivering. The rule keys on an equals sign; prose does not need one. |
| `key: value` on a bare colon | the scanner, which holds it for alphanumeric values and **not** for values carrying `#`, `$` or a space — 12 of 35 measured combinations deliver. |

These fields are free text. No rule short of refusing prose can prove a sentence
is not a quotation of the customer's source, and this one does not try: it closes
the credential constructs, not the general ability to describe code in English. A
report is still read and signed by a named human before delivery, and for the
first gap above that signature is the **only** thing standing there.

### What is actually open

Four rounds have now attacked this channel and every one has failed in **both**
directions at once. The record, measured rather than argued:

| Round | Mechanism | Result |
| --- | --- | --- |
| 10 | value-based detector | leaked credentials and bricked correct reports in the same commit |
| 12 | construct rule, enumerated operators | 346 of 366 delivered via `+=`; refused 8 of 8 ordinary sentences |
| 13 | construct rule, general bridge | 12 of 35 colon forms and 12 of 12 no-operator carriers delivered; refused 15 of 21 ordinary sentences |

The deepest measurement is the last one: `DB_PASSWORD is set to Zq7#Lm2$Pw9 in
config/app.env.` is plain English with no construct to refuse, and it publishes
the credential. **Any rule keyed on a construct is defeated by prose that has no
construct**, and any rule strict enough to catch prose refuses the sentences an
auditor has to write. That is not a gap to be narrowed by a fourth attempt; it is
the shape of the problem.

**This needs an owner decision, and one is not taken here.** The two options:

1. **Compose the observation.** The executor supplies structured facts — check,
   location, impact, exploitability, confidence — and the customer-facing prose
   is generated deterministically from them. There is then no field an executor
   can type a credential into, which is the same move the excerpt decision made.
   It costs the narrative quality of the report and is a significant redesign.
2. **Accept that the observation is human-reviewed.** Remove the machine rule
   entirely, state in the engagement terms that a named human reads every report
   before delivery and that this is the control on free text, and keep the
   scanner as defence in depth.

Until one is taken, the prose fields are **not** machine-guaranteed free of
credentials, and nothing in this document should be read as saying they are.


### Proof

`supabase/qa/release_rescue_excerpt_removal_v8_proof.sql` — **18 live PostgreSQL
cases**: every forbidden field name refused in a location, a finding-level field
refused, the refusal carrying the field name and none of the planted content, a
well-formed report accepted with path, line range, check id, severity, observation
and remediation all surviving, another workstream's artifacts untouched, and the
guard confirmed `SECURITY INVOKER`.

`supabase/qa/release_rescue_path_shape_v9_proof.sql` — **25 live PostgreSQL
cases**: nine control-character carriers refused inside a path, an overlong path
refused, the refusal naming the finding and location index and none of the
planted content, ten real repository paths accepted (including this product's own
bracketed dynamic routes and a file name with a space), and the fourteen distinct payload
shapes an audit planted through the earlier two-level guard (it reported
seventeen plants and sixteen acceptances; deduplicated they are these fourteen) — a nested object, a
nested array, an assessment's evidence, a capitalised `Excerpt`, a shouted
`SNIPPET`, a padded and a differently cased schema marker, the whole report one
level down, `findings` and `locations` as objects rather than arrays — every one
refused.

`src/lib/__tests__/release-rescue-excerpt-removal.test.ts` — **37 tests**, of
which 6 are property-shaped over a generated credential corpus (values carrying
punctuation, whitespace, quotes, delimiters, comments, multiline carriers, URLs
and common-word passwords, crossed with all 22 forbidden field names and with
real source-file carriers) and the rest are single-example assertions about the
schema, the migration text, the field-coverage policy, the delivery gate and the
artifact hash. An audit re-added `excerpt` to the schema and found that only 3 of
the then-16 went red; the two that read as the structural guarantees were
tautologies. Both were rewritten to plant the value and assert no artifact comes
out, and the suite now goes red under that mutation.

`src/lib/__tests__/release-rescue-prose.test.ts` — **deleted**, along with the
module it tested. It proved that a rule over auditor-written prose behaved a
certain way. There is no auditor-written prose, so there is no rule, so there is
nothing for it to prove. Keeping a passing suite for a retired mechanism is how a
test file becomes decoration.

`src/lib/__tests__/release-rescue-structured-observations.test.ts` — **48 tests**,
the eight property families the structured-observation decision was specified
against, plus a ninth added after the fourteenth audit: *a code field holds a
code, on the path that actually produces an artifact*. That ninth family asserts
the three layers separately — type, schema, runtime — so that fixing one and
leaving the others cannot make it pass.

The type layer is asserted with `@ts-expect-error`, not with a cast. The
fifteenth audit pointed out that the first version used `as never`, which
compiles whether or not the type refuses the value: reverting `FindingFacts` to
`string` left `tsc` at exit 0 and the whole suite green, so the layer the fix
listed first was pinned by nothing. `@ts-expect-error` fails the build when the
error it expects stops occurring, which is the only way a test can assert a
compile-time property. Reverting any of the three code fields to `string` now
fails `tsc`. Notable among them, because they are complete statements rather than
samples: every sentence the catalog can produce, checked for prohibited claims
and credentials in one pass; every observation in the catalog, built into a
report and asserted deliverable; every remediation each observation offers, the
same; and a walk of the whole customer view asserting that each sentence in it
has a named owner in this repository. The last of those found three rubric checks
with no observation entry — an auditor could not have reported an accessibility
failure at all — which under the old contract would have been invisible, because
an auditor simply wrote a sentence.

## The structured-observation decision

**Owner decision, after thirteen independent audits: a report carries CODES, and
a frozen catalog carries the WORDS.** Every customer-deliverable sentence is
composed at render time from `src/lib/release-rescue-observation-catalog.ts`,
keyed by a stable code the artifact stores. There is no field on a finding, an
assessment or a report that a caller can write a sentence into.

### Why, stated as the measurement rather than as a preference

The excerpt decision above removed the customer's *source* from the artifact. It
did not remove the auditor's *sentences about it*, and four rounds then went into
the question of whether a rule could tell a description from a quotation.

Both directions were measured, and both failed:

| Rule | What it was for | What it measured |
| --- | --- | --- |
| Construct-keyed (key + operator, never the value) | Refuse a quoted assignment without judging the right-hand side | **366 of 366** generated credentials delivered through `DB_PASSWORD is set to <value>`. A sentence with no construct has nothing to key on. A separate measurement put the prose-prefixed carrier at **30 of 116** where the bare assignment was 0 |
| Strict enough to catch that | Refuse anything that could be read as carrying a value | **15 of 21** sentences an auditor legitimately needs to write were refused. A $299 report nobody can send is not a safer report |

There is no rule between those two. The question — *is this sentence a quotation?*
— does not have a decidable answer over arbitrary prose, and each round of
sharpening moved the failure rather than removing it.

So the owner's decision removes the question. An auditor does not write a
sentence, therefore no rule needs to judge one.

### What replaced each removed field

| Was | Is | Resolved by |
| --- | --- | --- |
| `findings[].title`, `.whatWeObserved`, `.whyItMatters` | `findings[].observationCode` | `OBSERVATION_CATALOG` |
| `findings[].recommendation` | `findings[].remediationCode` | `REMEDIATION_CATALOG` |
| `findings[].residualUncertainty` | `findings[].uncertaintyCode` | `UNCERTAINTY_CATALOG` |
| `assessments[].rationale` | `assessments[].rationaleCode` | `ASSESSMENT_RATIONALE_CATALOG` |
| `assessments[].evidence[].reference` | `kind`, `path`, `startLine`, `endLine` | the same schema a finding's evidence uses |
| `limitations[]` | `limitationCodes[]` | `LIMITATION_CATALOG` |
| `clearedSecretHolds[].rationale` | `clearedSecretHolds[].reasonCode` | `CLEARANCE_REASON_CATALOG` |
| `scope.application.{name,description,primaryStack}` | removed | — |
| `scope.criticalWorkflow.{name,description,entryPoint}` | `handlesCustomerData`, `triggersExternalActions` (booleans) | — |
| `scope.customerExclusions[]` | `scope.exclusionCount` (a number) | — |

`impact` and `exploitability` moved with the words. They are fixed per
observation by the catalog and **verified** against it by `validateFinding`, so
storing them on the artifact grants no authority to set them. The only judgement
an executor still makes about severity is `confidence`, which can lower a
severity and never raise one.

That has a consequence worth naming, because the demo hit it: the way to report a
less severe instance is to name the **observation that matches the scenario**, not
to write a smaller word. `ai.model_visible_content_can_grant_authority` is
`remote_unauthenticated` and derives `critical`; `ai.tool_authority_is_not_declared`
is `requires_user_interaction` and derives `high`. Choosing between them is a
judgement about the finding. There is no field left to shop in.

### What is left that a person types

Two free-text strings, both named and both guarded.

That count has been wrong twice, in the same way both times, and the history is
worth keeping because it is the shape of the defect rather than an anecdote. The
fourteenth audit counted **eight** — the two, plus six code fields that accepted
arbitrary text. The fifteenth counted **three**, because the fix had been applied
to a hand-written list of six and `findings[].rubricCheckId` was not on it: 200
characters of arbitrary text, rendered verbatim as the header of every finding.
A general check then found **four more** of the same class that neither audit had
reported — `findingId`, `dimension`, `confidence`, `remediationEffort`.

Enumerating the fields by hand failed three times. The check is now driven from
`REPORT_FIELD_POLICY` itself: every `generated` string field on a finding or an
assessment is planted with a sentence, built, rendered, and the customer view
asserted not to contain it. A field added tomorrow is covered the day it is
classified.

1. **`reviewedBy.displayName`** — the named human reviewer's signature, rendered
   to the customer. Checked for prohibited claims and for credentials by the
   field-coverage contract — which, like the validator that calls it, is not on
   the production path today (see the disclosure below). What does run on that
   path is the sanitiser, which removes a recognised credential and raises a
   hold. A prohibited claim in a reviewer's own name is caught by the contract
   when delivery is built, and not before.
2. **`scope.repository.repositoryRef`** and `defaultBranch` — what the customer
   gave at intake, format-checked.

And one value still taken from the customer's repository: **`path`**, on a
finding location and on an evidence entry. It is bounded by a path *grammar* —
no whitespace, no control characters, bounded segments, 400 characters — so a
pasted source window is not a legal value for it. That is a structural bound,
not a judgement about the text.

### What this does and does not claim

**Proven.** A customer-deliverable report has no field that holds a sentence a
person wrote. Every word a customer reads about a finding, an assessment, a
limitation, an uncertainty or a clearance comes from a frozen catalog, pinned by
content hash on the artifact so the wording a customer was shown can be
identified afterwards.

That claim rests on two properties, and the first version of this change shipped
with only one of them. Both are now enforced and both are asserted:

1. **The removed field names are refused.** By name, at the schema, at the
   assembly boundary (which takes findings as typed values and never parses
   them), and at the database row guard. The refusal names the field and never
   the value, because it reaches logs.
2. **The codes that replaced them are closed.** This is the half that was
   missing. See *What the fourteenth audit found* below — removing the words
   accomplishes nothing if the codes accept a sentence, and for one release they
   did.

**Not claimed.** This does not make a review correct, and it does not prevent a
false negative: an auditor steered away from a file reports nothing about it, and
a report with a missing finding is structurally perfect. It also does not claim
the credential scanner proves anything about arbitrary prose — that claim is
exactly what the measurements above refuted. The scanner is retained for
transient processing, for the intake form, and for the two guarded strings.

**Human review is the accountability gate, not the credential control.** A named
manager must still sign before delivery. That requirement is unchanged and is
deliberately *not* the mechanism that keeps credentials out of a report: a report
carrying one is undeliverable even when a manager has signed it, and a test
asserts that directly.

**`validateReleaseRescueReport` and `releaseRescueDeliveryGate` have no
production call site.** An audit found this and it is recorded here rather than
quietly fixed, because the honest statement changes what the rest of this section
means. Delivery is not built — there is no route that sends a report to a
customer — so there is nothing yet for the gate to gate. The only production path
today is `buildReleaseRescueReport` → `toCustomerReportView`, which is how the
demo sample is rendered.

The consequence is that **the structural guarantee must hold at the assembler and
the presenter, not at the validator**, and that is where the enforcement was
moved. A validator nobody calls is precisely the defect this workstream found
once before, when `prepareExcerpt` and `redactSecrets` turned out to have no
production call site at all and two hundred passing tests were exercising code
the product never ran. Wiring the gate in is work for whoever builds delivery;
until then, no claim in this document depends on it.

### What the fourteenth audit found, and why it was the same defect one level up

The first implementation of this decision removed the prose fields, replaced them
with codes, and did not constrain the codes. An independent audit put an
arbitrary sentence — with a credential in it — into `uncertaintyCode` through
`composeFinding`, **the supported constructor, with no cast anywhere**, and it
rendered verbatim in the customer view.

Three things had to be true at once, and all three were:

| | What it was | Why it let the value through |
| --- | --- | --- |
| The type | `FindingFacts.uncertaintyCode?: string \| null` | `tsc` had no objection to a sentence |
| The schema | `z.enum(UNCERTAINTY_CODES as unknown as [string, ...string[]])` | the cast makes the **inferred type** plain `string`; the enum constrained nothing the compiler could see |
| The runtime | nothing on the production path checked it | `composeFinding` looked up `observationCode` and `remediationCode` in the catalog and simply passed `uncertaintyCode` through |

Every other layer then declined to catch it, each for a defensible reason:
`validateFinding` had no uncertainty check; the credential scanner found no
assignment construct, which is the carrier this document's own measurement
section records as defeating it 366 times out of 366; and
`checkReportFieldCoverage` returned `[]` because the field-coverage policy
classifies all six code fields as `generated`, **which exempts them from the
prohibited-claim guard and the credential check on the stated justification that
they are closed enums**. The exemption was sound; the premise was false.

The audit also proved the database half live: a report whose `observationCode`,
`uncertaintyCode`, `rationaleCode` and `limitationCodes` carried English
sentences — one a credential, one the prohibited claim *"this review is a
penetration test and certifies the application is secure and vulnerability
free"* — was **stored** by the v10 guard, whose own comment asserted the gap did
not exist because "there is no field to put it in". That comment was reasoning
about field *names*.

**What closed it**, at each of the three layers rather than at whichever one is
cheapest:

- `OBSERVATION_CODES` is a literal tuple, so `z.enum` infers a real union and
  **every cast is gone**. `FindingFacts` uses the catalog's union types, so the
  sentence is now a compile error at the call site.
- `composeFinding` checks `uncertaintyCode` against the catalog at runtime, and
  `assembleReleaseRescueReport` checks **all six** — it is the last point before
  an artifact exists and the one input reaches without meeting a schema.
- The presenter no longer echoes an unknown code. `?? finding.observationCode`
  was the render path of the whole defect; an unknown code is precisely the case
  where the stored string is untrusted. It degrades to a fixed sentence instead,
  so a report written against a newer catalog still renders without printing
  anything a caller supplied.
- Migration **v11** requires every code field to be *code-shaped* at the row
  boundary. It checks shape rather than catalog membership deliberately: a row
  guard stricter than the application refuses reports the application considers
  correct, which is the failure shape three audits here have already found. A
  sentence cannot be code-shaped, which is the property that was missing.

**And the tests that should have caught it now do.** The audit ran six mutations
that delete the mechanism outright and killed **zero** of 623 tests. A mutation
harness now runs against the fix — 18 mutations at the time of writing, since
grown — with a baseline of 0 failures; every one goes red in vitest except the
type-layer reverts, which fail `tsc` instead, and that includes each of the
original six. Two of
those assertions exist *only* because the first fix made them pass for the wrong
reason: widening the schema enum killed nothing once the runtime guard was added,
so defence in depth had quietly become the only defence. The schema is now
asserted closed independently of the runtime checks.

### What the fifteenth audit found: the field next to the fix

The fourteenth audit's findings were closed and the fifteenth verified every one
of them. It then found the same defect **one field over**.

`findings[].rubricCheckId` is `identifierString.max(200)` — 200 characters of
arbitrary text, type-legal with no cast — and `toCustomerReportView` rendered it
verbatim as `checkTitle`, **the header of every finding in the customer's
report**, via `?? finding.rubricCheckId`. That fallback sat three lines above the
four that had just been rewritten to stop doing exactly this. It was classified
`generated` in the field-coverage policy, exempting it from the prohibited-claim
guard and the credential check, on the justification *"Must match an id in the
frozen rubric"* — which nothing enforced. Reproduced: the string *"The production
admin password is <value>; this app is secure and free of vulnerabilities."*
rendered as a finding header, with `checkReportFieldCoverage` returning `[]`.

`findProhibitedClaims` **does** find two claims in that sentence. The exemption is
what suppressed it. That is the "exemption sound, premise false" pattern for the
second release running.

Then a general check found **four more** of the same class that neither audit had
reported: `findingId`, `dimension`, `confidence` and `remediationEffort` all
carried a planted sentence into the customer view.

**What closed it, and what changed about how.** All seven fields are now checked
at the assembly boundary — six against a registry, `findingId` against an
identifier shape, since it is minted rather than drawn from one. The presenter's
last echoing fallback is gone. v11 covers `rubricCheckId` and
`assessments[].checkId` at the row boundary; all 32 rubric ids are code-shaped,
so it costs nothing, and a test asserts that.

**The more important change is to the test, not the code.** Three rounds running,
a fix was applied to a hand-written list of fields and an audit found the next
one along. So the check is no longer a list. It reads `REPORT_FIELD_POLICY`,
takes every `generated` string field on a finding or an assessment, plants a
sentence in each, builds, renders, and asserts the customer view does not contain
it. That is what found the four the audits missed, and a field added tomorrow is
covered the day someone classifies it.

**Also corrected**: three published counts. "16 browser tests" was misleading in a
sentence of Release Rescue totals (13 is the spec's count; 16 was what was run
across three specs). `excerpt-removal` was recorded as 30 tests and is 37. And
the type layer was asserted with `as never`, which compiles whether or not the
type refuses the value — it is `@ts-expect-error` now, so reverting `FindingFacts`
to `string` fails the build.

### What the sixteenth audit found: the level above the fix

The fifteenth audit's findings were closed and the sixteenth verified them. It
then found the same defect at the level **above** `findings[]` and
`assessments[]`.

`$.engagementId` is `identifierString.max(100)`, which forbids only leading and
trailing whitespace. Internal spaces and a full sentence are type-legal with no
cast. It is classified `generated` — *"An identifier this codebase mints"* — and
nothing minted it or checked it. It is rendered as **the line directly under the
report's heading**, and carried into the JSON download.

Reproduced, through the supported entry point:

```
engagementId = "This app is secure and free of vulnerabilities."
  checkReportFieldCoverage  -> []
  hardGatePass              -> true
  deliverable               -> true
  customer view header      -> "This app is secure and free of vulnerabilities."
```

That is the sentence `findProhibitedClaims` exists to forbid, on a $299
deliverable, with the delivery gate open. The same field carried a credential in
prose form, which the scanner does not classify. Nine more fields of the same
class — `reportId`, `runId`, `organizationId`, all of `preparedBy.*`,
`reviewedBy.operatorUserId`, `clearedSecretHolds[].clearedBy` — accepted a
sentence and reached storage.

**The check that was supposed to end this pattern was itself a hand-written
list.** The fifteenth round replaced a field list with what the documentation
called a general check driven by the policy. It was driven by the policy through
a path filter:

```ts
.filter((path) => /^\$\.(findings|assessments)\[\]\.[A-Za-z]+$/.test(path))
```

Measured: **15 of 50** `generated` paths selected, **35 excluded** — every
top-level field, all of `preparedBy`, all of the holds, `limitationCodes[]`, the
nested evidence kinds. `engagementId` was one of the 35. A regex over path shapes
is a hand-written list with extra steps, and it failed the same way.

**What replaced it is a property of the value, not a list of names.**

`generated` means the value is produced by our own deterministic code: an id, a
hash, a count, an enum value, a catalog code or a timestamp. **None of those
contains whitespace, and a sentence cannot avoid it.** So
`assertGeneratedFieldsAreNotProse` walks the assembled artifact and refuses any
`generated` string containing whitespace — no field list, no path filter, and it
covers a field the day someone classifies it because it never looks at names at
all. One exception exists, `$.unresolvedHolds[].reason`, a fixed sentence this
module owns that no caller can supply; it is named in `GENERATED_PROSE_PATHS`
with its justification.

The test that pins it plants a sentence at **every** generated path the policy
declares, by walking the artifact to the matching leaf, and additionally asserts
that every declared path is *reachable* in a real report — so a fixture too thin
to exercise a path is a failure rather than a silent gap.

**A trap this created, and how it is closed.** Adding a strong general check made
four specific checks untested overnight: removing the `rubricCheckId`,
`assessments[].checkId`, `findingId` or `confidence` check killed zero tests,
because every existing payload was a sentence and the general check caught it
first. That is the same shape as the earlier round where a runtime guard made the
schema enums untested. A separate test now plants **space-free** registry misses
(`authz.not_a_real_check`, `veryconfident`, `enormous`) which the general check
cannot see, and asserts the specific check is what refuses them.

**Also fixed from that audit**: `enumerateStringFields` could stop walking arrays
entirely with all 640 tests green — the only fail-closed test planted its field
at the top level, so two tests now plant inside an array and inside a nested
array. The v11 proof never exercised the two fields v11 was extended for; it has
five new cases and is 29. And the doc said "eleven-mutation harness" while the PR
said 18.

### The database half

`supabase/migrations/20260916140000_release_rescue_structured_observations_v10.sql`
extends v8's field-name refusal with the narrative names, generalises v9's
`path`-only string bound to every string in the payload (no control characters,
400 characters), and requires catalog provenance on every stored report. All four
checks live in the single guard function v9 established, for the reason v9 gave:
triggers on `evidence_artifacts` fire in alphabetical order and this workstream
has already been bitten by that once.

Migration `20260916160000_release_rescue_code_fields_v11.sql` adds the check v10
was missing: every code field must be code-shaped. v10's own comment claimed the
gap could not exist; it was wrong, and the comment is corrected in v11's header
rather than left to be rediscovered.

`supabase/qa/release_rescue_structured_observations_v10_proof.sql` proves v10 live
in **30 labelled cases**, and `release_rescue_code_fields_v11_proof.sql` proves
v11 in **24**, every one of them the audit's own payload refused, including the whole narrative list crossed with all four
levels of the payload (100+ insert attempts), and — asserted first, deliberately —
that the report the product actually produces is still storable. Three audits in
this workstream have found a guard that refused everything; a $299 artifact nobody
can store is a worse outcome than the one the guard exists to prevent.

One of those cases changed what it claims after measurement. The obvious assertion
was that the guard refuses an UPDATE planting a narrative field. It does not:
`trg_evidence_artifacts_immutable` sorts alphabetically before it, so the row is
refused as immutable before this guard is consulted. That is recorded as what it
is rather than claimed as a win for this guard, and the narrative guard's
independent refusal is asserted separately so the claim does not rest on trigger
ordering staying put.

### What this does not authorize

Nothing about payment activation, production access, customer intake, deployment,
or executor authority changes. The engagement remains prepare-only, read-only,
tenant-isolated, retention-bound, and undeliverable without a named human
reviewer — all of which this pass re-asserts in tests rather than assuming.

## What this slice deliberately does not do

No payment activation, no executor adapter, no snapshot extractor, no live checkout, and no deployment. The customer surface, the marketing routes, the scheduled sweep configuration, and the `VISION.md` amendment ARE part of this branch.

The one pre-existing function the first migration replaces — `enforce_evidence_artifact_invariants` — keeps the 20260824090000 caller-supplied content-hash fallback verbatim, and a migration test asserts it, because regressing it would hard-fail every work-cell verification.
