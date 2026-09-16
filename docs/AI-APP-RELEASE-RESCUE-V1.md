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

**Excerpts are proof, not copies.** Capped at 480 characters and redacted before storage. `prepareExcerpt` redacts *then* truncates: truncating first could cut a credential in half and leave a fragment that no detector recognises but that still narrows the key for anyone holding the rest.

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

**Implemented and passing** — 499 Release Rescue tests across 26 suites (1,167 in the whole repository), 255 live database cases across eight proofs, and 12 browser tests in real Chromium against the production build.

These counts are re-measured each pass rather than carried forward. Three successive audits found stale numbers here, and a stale count is a false claim like any other.

| Area | Coverage | Where |
| --- | --- | --- |
| **Authentication** | The session boundary itself is the existing platform's (`rls.test.ts`, `auth-redirect.test.ts`). This workstream adds identity checks at the authority boundary: the named report reviewer must hold manager authority, verified against `operators` rather than accepted as a user id | QA fixture §4; migration suite |
| **Authorization** | A customer admin may open an engagement only for their own organization; an ops manager cannot mint an access grant on a customer's behalf; a plain operator cannot issue a report; only a manager may issue or update one; the customer may revoke their own access | QA fixture §1, §3, §4; migration suite |
| **Secrets** | 15 detector families; setting names preserved while values are removed; correct `process.env` usage stays readable; idempotence; call-order independence; redact-before-truncate so no fragment survives; nested JSON scanning; schema refusal of unredacted excerpts; whole-report scan | `release-rescue-redaction.test.ts` (28), `release-rescue-findings.test.ts`, `release-rescue-report.test.ts` |
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
`.pgpass` and `.env` content and asserts none of them reaches the artifact, the
stored excerpts, the customer view, the holds, or console output — and that the
delivery gate refuses while a `credential_evidence` hold is unresolved.

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

`supabase/qa/release_rescue_destructive_authority_v7_proof.sql` runs **39 cases**
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

The proof base applies 49 of 53 migrations (the two above, plus two that need the
`http` extension this sandbox does not have). None of the four touch Release
Rescue tables, and all eight Release Rescue proofs run against the result.

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
`prepareStoredExcerpt`'s "production entry point", which **still has no production
caller**. That one is recorded rather than fixed: report strings reach the
sanitiser through the generic walk, and wiring the truncating path in is a change
to the excerpt path that wants its own proof.

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
  asserts `keyLooksSecret` for **every** pair in both spellings — over 500 of
  them — so the token family is covered by construction rather than by having
  been thought of. The anchoring is what fixes the over-reach in the same stroke.
- **Composed carriers** get their own product: nine outer contexts (trailing hash
  comment, slash comment, leading comment, indentation, nesting, following key,
  preceding prose) × eight inner forms, asserting the composition is never weaker
  than either carrier alone.
- **The false-positive direction is now a product too** — six subjects × six
  predicates of ordinary audit prose, asserted against both the classifier and
  the intake form, plus four real source excerpts asserted byte-for-byte.
- **The `SECURITY DEFINER` class is enumerated in SQL.** The v7 proof iterates
  `pg_proc where prosecdef` and fails on any function reading a tenant table
  without an `organization_id` conjunct. Three rounds of fixing one trigger at a
  time is what that replaces. It was verified against a planted violation, so it
  is known to be capable of failing.

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

## What this slice deliberately does not do

No payment activation, no executor adapter, no snapshot extractor, no live checkout, and no deployment. The customer surface, the marketing routes, the scheduled sweep configuration, and the `VISION.md` amendment ARE part of this branch.

The one pre-existing function the first migration replaces — `enforce_evidence_artifact_invariants` — keeps the 20260824090000 caller-supplied content-hash fallback verbatim, and a migration test asserts it, because regressing it would hard-fail every work-cell verification.
