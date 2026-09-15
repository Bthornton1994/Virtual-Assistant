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
| `src/lib/release-rescue-redaction.ts` | Secret detection and fail-closed redaction of evidence excerpts |
| `src/lib/release-rescue-findings.ts` | The finding contract and the derived severity model |
| `src/lib/release-rescue-report.ts` | Report schema, deterministic assembly, validation, delivery gate |
| `src/lib/release-rescue-presentation.ts` | The customer-facing view, built by construction so internal identity cannot leak into it |
| `src/lib/release-rescue-snapshot-limits.ts` | Fail-closed limits on what the review will ingest |
| `src/lib/release-rescue-retention-schedule.ts` | Authorization for the scheduled retention sweep |
| `supabase/migrations/20260915120000_release_rescue_v1.sql` | Isolation, credential refusal, immutability, retention |
| `supabase/migrations/20260915183000_release_rescue_hardening_v1.sql` | Ownership evidence, snapshot record, scheduled sweep |
| `supabase/migrations/20260915193000_release_rescue_hardening_v2.sql` | Frozen scope, access-mode evidence, report invariants, privileged purge |
| `supabase/migrations/20260915213000_release_rescue_hardening_v3.sql` | Unconditional ownership gate, single purge-flag reader, live-grant requirement |

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

**Excerpts are proof, not copies.** Capped at 480 characters and redacted before storage. `prepareExcerpt` redacts *then* truncates: truncating first could cut a credential in half and leave a fragment that no detector recognises but that still narrows the key for anyone holding the rest.

## Data isolation and retention rules

**Isolation.** Row level security on all three tables, with every `select` policy scoped to `my_org_ids()` or platform staff. Engagement and run references are bound to their parent's organization by composite foreign key, so a row cannot name organization A while pointing at an engagement owned by B. `report_artifact_id` is a single-column reference whose organization and run are checked in the report trigger instead, because `evidence_artifacts` carries no `(id, organization_id)` key to point at. No table grants `delete` to `authenticated`.

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

Defence in depth: the excerpt schema re-runs detection rather than trusting a flag, and `validateReleaseRescueReport` scans the **entire assembled report** at freeze time. An excerpt is not the only place raw source can reach a report — a recommendation or a rationale can quote a line just as easily.

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
| T12 | **Hostile repository content** — zip bombs, enormous files, symlink escapes in uploaded archives | Fail-closed limits on file count, file size, total bytes, archive size, expansion ratio, path depth and path length, applied before anything is read (`release-rescue-snapshot-limits.ts`); excerpt caps bound what reaches a report | The limits are enforced in application code, so they bind the ingestion path this service owns and not a future one that bypasses it |

## Test plan

**Implemented and passing** — 226 tests across fourteen suites, 42 live database cases for isolation and 24 for hardening, and 8 browser tests in real Chromium against the production build.

| Area | Coverage | Where |
| --- | --- | --- |
| **Authentication** | The session boundary itself is the existing platform's (`rls.test.ts`, `auth-redirect.test.ts`). This workstream adds identity checks at the authority boundary: the named report reviewer must hold manager authority, verified against `operators` rather than accepted as a user id | QA fixture §4; migration suite |
| **Authorization** | A customer admin may open an engagement only for their own organization; an ops manager cannot mint an access grant on a customer's behalf; a plain operator cannot issue a report; only a manager may issue or update one; the customer may revoke their own access | QA fixture §1, §3, §4; migration suite |
| **Secrets** | 15 detector families; setting names preserved while values are removed; correct `process.env` usage stays readable; idempotence; call-order independence; redact-before-truncate so no fragment survives; nested JSON scanning; schema refusal of unredacted excerpts; whole-report scan | `release-rescue-redaction.test.ts` (22), `release-rescue-findings.test.ts`, `release-rescue-report.test.ts` |
| **Data access** | Organization B reads none of A's engagements or reports; credential-named keys, credential-shaped values, credentialed URLs, over-long windows, and write access all refused; grants are revoke-only and one-way; retention cannot be extended; the purge clears content, keeps accounting, revokes grants, is idempotent, does not reach past its own workstream, and does not leak its flag | `release_rescue_v1_isolation_proof.sql` (42 cases), migration suite (27) |
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

### Known design defect: the commit is in the wrong place

`freezeScope(intake, commitSha)` builds the frozen scope from the intake plus the
reviewed commit — but the commit is only known once a snapshot has been taken,
which happens after the engagement row exists, and both `scope` and `scope_hash`
are immutable on `UPDATE`. So the intended lifecycle cannot be executed: the row
would have to be written with a commit nobody has yet, or amended after it is
frozen, and the schema refuses the amendment.

This is latent rather than live, because no production writer to
`release_rescue_engagements` exists in this branch. It is recorded here rather
than worked around, because the workaround is the wrong fix: loosening the freeze
would reopen the guarantee the v2 and v3 rounds were spent closing.

The right resolution is that the commit is a property of the SNAPSHOT, not of the
intake scope. `reviewed_commit_sha` belongs on the engagement as a
write-once-before-review column beside the other snapshot fields, with the scope
holding only what the customer agreed to at intake. That is a schema change with
its own migration, proof cases and caller updates, and it is deliberately not
folded into this hardening pass.

## Independent audit, and what it found

A fresh-context QA audit of this branch executed eight working attacks against the shipped schema and contracts. All eight are fixed and each is now a regression case in `supabase/qa/release_rescue_hardening_v2_proof.sql` or a unit test. They are recorded here because the fixes only make sense alongside what they answer.

| Defeated guarantee | How it was broken | Fix |
| --- | --- | --- |
| "We will not review code you do not own" | `access_mode` was a plain column a customer could `UPDATE`; relabelling an archive engagement as an app install opened the ownership gate in one statement | Access mode is immutable after intake, must agree with the frozen scope, and a review cannot start without a recorded repository grant |
| Same, by another route | A customer could `INSERT` directly at `auditing` declaring any mode, with no grant in existence | The gate now requires the grant row, not the label |
| "Scope is frozen at intake" | Only `scope_hash` was guarded. The `scope` itself was rewritable, so the reviewed repository, the workflow, and the AI-assisted choice could all be changed while the hash stayed constant | The scope content is immutable; only the retention purge may replace it, and only with its stub |
| "We will not overclaim" | Negation was matched as a substring, so "**Not**hing is left unchecked in our penetration test" read as a denial; referral markers included "engage", exempting every sentence containing "engagement" | Tokenised matching, narrowed referral phrases, a wider phrase list, and a test that runs the real checker over every marketing file |
| "We will not leak your secrets" | The assignment detector required `\b` before the key name, and `\b` does not match between `_` and a letter — so `NEXTAUTH_SECRET=`, `AWS_SECRET_ACCESS_KEY=` and every other prefixed environment variable passed through. That is the shape of a `.env` file, the thing a committed-secrets finding most wants to quote | Matched on the end of the key name instead, with quoted values and more key shapes |
| The retention promise | Vercel Cron issues a **GET**; the route implemented POST only and answered GET with 405, so the scheduled sweep could never fire. The test asserted the file *contained the string* `"export async function POST"` and passed with the wiring broken | The scheduler's method is a shared constant, the handler is bound to it, and the test imports the real module |
| "A delivered report is immutable" | `delegation.retention_purge` is a custom GUC any role can set. The purge branch was gated on the flag alone, so a caller with UPDATE rights could set it themselves and unbind a delivered report | The flag only counts when the caller holds EXECUTE on the sweep — and the trigger is `SECURITY INVOKER`, because inside a definer function `current_user` is the owner and the check would answer for the wrong role |
| Prospect privacy | `/demo/[id]` rendered a prospect's name, work email and private repository name to anyone who guessed the id, which came from `Math.random` plus a timestamp | The page authorizes against the cookie, ids are `randomUUID`, and a browser test opens the URL in a second context and asserts nothing is visible |

Two smaller ones worth naming: the archive-facts input was the only value in the snapshot limiter not schema-validated, and `NaN` made every `>` comparison false, so the module failed **open** against its own header; and the customer-facing presenter copied stored severity rather than deriving it, so "severity is derived, never chosen" held only for callers who remembered to validate first. Both now fail closed.

The audit also found the proof helpers accepted *any* error, so a typo or a missing table read as a security refusal. They now re-raise the error classes that mean a broken test, and the v2 proof additionally requires the guard's own message — which immediately caught one of my own cases refusing for the wrong reason.

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

## What this slice deliberately does not do

No payment activation, no executor adapter, no snapshot extractor, no live checkout, and no deployment. The customer surface, the marketing routes, the scheduled sweep configuration, and the `VISION.md` amendment ARE part of this branch.

The one pre-existing function the first migration replaces — `enforce_evidence_artifact_invariants` — keeps the 20260824090000 caller-supplied content-hash fallback verbatim, and a migration test asserts it, because regressing it would hard-fail every work-cell verification.
