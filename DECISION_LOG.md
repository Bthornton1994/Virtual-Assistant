# Delegation Cloud Decision Log

## D-001 — Delegation Cloud owns the control plane

Date: 2026-08-21  
Status: active  
Decision: External models, agents, runtimes, providers, context engines, and skills remain replaceable implementations behind Delegation Cloud-owned contracts. They do not own authority, lifecycle state, evidence truth, or autonomy policy.

Source: [VISION.md](VISION.md), [Capability Sovereignty doctrine](docs/CAPABILITY-SOVEREIGNTY.md).

## D-002 — Evidence precedes autonomy

Date: 2026-08-22  
Status: active  
Decision: A workstream must produce inspectable evidence, independent review, deterministic validation, accepted outcomes, and measured exceptions/costs before authority can increase.

Source: [Gauntlet Loop](docs/GAUNTLET-LOOP.md), [Step 3E Skill Qualification](docs/STEP-3E-SKILL-QUALIFICATION.md).

## D-003 — Preserve failed and inconclusive work

Date: 2026-08-22  
Status: active  
Decision: Failed attempts, unresolved facts, rejected candidates, and inconclusive impact are retained as evidence. They are not repaired retrospectively or relabeled as success.

Source: [Step 3D QA Qualification](docs/STEP-3D-QA-QUALIFICATION.md), [Gauntlet Loop](docs/GAUNTLET-LOOP.md).

## D-004 — Grounded remains fail-closed

Date: 2026-08-28  
Status: active  
Decision: Grounded product visibility, inventory claims, supplier partnerships, supplier outreach, purchases, and production commerce remain blocked until real product/supplier/compliance/fulfillment evidence and the required human reviews exist.

Source: [Grounded supplier PR #54](https://github.com/Bthornton1994/Virtual-Assistant/pull/54), Grounded safety workstream status supplied in the current project record.

## D-005 — QA metadata stays out of Grounded and Production

Date: 2026-08-28  
Status: active  
Decision: Supplier-sourcing fixtures, profiles, attempts, reviews, validations, and receipts belong only in Delegation Cloud QA. They must not be written to Grounded Supabase or a Production environment.

Source: [Grounded supplier PR #54](https://github.com/Bthornton1994/Virtual-Assistant/pull/54).

## D-006 — Grounded supplier workstream remains unqualified

Date: 2026-08-28  
Status: active  
Decision: PR #54 was merged under explicit owner authorization on 2026-08-28, but the merge only integrated the fail-closed supplier-sourcing workflow. It did not authorize supplier outreach, purchases, catalog changes, commercial claims, production commerce, or qualification of Grok.

Source: [PR #54](https://github.com/Bthornton1994/Virtual-Assistant/pull/54), QA run `f41e4d68-fe53-4f9c-8a35-bce022af5135`.

## D-007 — Loadout is the first portfolio proving ground

Date: 2026-08-28  
Status: active  
Decision: Loadout Catalog Integrity is the first portfolio workstream. Its initial authority is human-reviewed baseline followed by shadow/prepare-only execution. No unsupported catalog claim is promoted.

Source: [portfolio playbook](docs/AUTONOMOUS-PORTFOLIO-EXECUTION-PLAYBOOK.md), Loadout [workstream blueprint](https://github.com/Bthornton1994/Loadout/blob/main/docs/CATALOG-INTEGRITY-WORKSTREAM.md).


## D-008 — Bounded owner-authorized merge while CI was unavailable

Date: 2026-08-28  
Status: active  
Decision: The owner authorized merging PRs #53–#58 in Virtual-Assistant and PR #24 in Loadout while GitHub Actions was unavailable. This was a bounded source-integration decision only. It did not waive post-merge verification, production, external-action, supplier, catalog, commerce, legal, or autonomy gates.

Source: [Virtual-Assistant main](https://github.com/Bthornton1994/Virtual-Assistant/commit/85000a45560e9291d68ea32b609fb087fcdebf2b), [Loadout main](https://github.com/Bthornton1994/Loadout/commit/af42f7afdbbc5af8d88451d4a2fbfd618b9711ae), [Virtual-Assistant Actions run](https://github.com/Bthornton1994/Virtual-Assistant/actions/runs/33179339710), [Loadout Actions run](https://github.com/Bthornton1994/Loadout/actions/runs/33179347590).

## D-009 — Bounded technical assurance work is in scope

Date: 2026-09-15  
Status: active  
Decision: Delegation Cloud may sell bounded technical assurance work where the delegated outcome is a verified judgment, not a change to the customer's systems. The release-readiness review is the first such workstream. Admission is conditional on the constraints written into `VISION.md` § Scope and non-goals: prepare-only authority, read-only and revocable access with ownership established by an accountable human where the access method does not demonstrate control, deterministic computation of severity and completion, a named human signature before delivery, remediation as a separate engagement, and a standing prohibition on describing the work as penetration testing, compliance certification, or a security guarantee.

This admits one workstream on stated terms. It does not make Delegation Cloud a security consultancy, and it does not authorize launch, payment activation, production access, or any increase in executor authority.

Source: [VISION.md](VISION.md), [AI App Release Rescue v1](docs/AI-APP-RELEASE-RESCUE-V1.md).

## D-010 — A finding points at customer source and never carries it

Date: 2026-09-16  
Status: active  
Decision: Raw customer source excerpts are removed from every persisted artifact and every customer-facing surface of the release-readiness review. A finding carries `path`, `startLine`, `endLine`, `rubricCheckId`, a derived `severity`, and catalog codes that resolve to the observation and the remediation. It carries no `excerpt`, no source window, and no scanner span that exposes source. The customer opens the cited location in their own checkout, where the source already is.

Ten independent audits attacked the credential detector whose only job was making a copied excerpt safe to ship. Five consecutive rounds shipped a regression inside the fix for the previous round's finding, and the tenth reported the detector both leaking credentials and permanently bricking correct reports in the same commit — sixteen real credentials reached a `deliverable: true` report through a span that recorded "I assessed 2 characters and judged them harmless". Removing the copy removes the defect class rather than narrowing it: there is no customer credential in the artifact to leak or to redact wrongly.

The alternative considered and rejected was letting a confident hold be cleared by two named people with an audit record. That is an authority change; this is a product scope change, and it costs the customer nothing diagnostic.

This decision was taken and implemented but was recorded only in `docs/AI-APP-RELEASE-RESCUE-V1.md` for four rounds. An owner decision that governs what reaches a customer belongs in this register.

Source: [AI App Release Rescue v1 § The excerpt decision](docs/AI-APP-RELEASE-RESCUE-V1.md), `src/lib/release-rescue-findings.ts`, `supabase/migrations/20260916050000_release_rescue_excerpt_removal_v8.sql`.

## D-011 — A report carries codes, and a frozen catalog carries the words

Date: 2026-09-16  
Status: active  
Decision: Every customer-deliverable sentence in the release-readiness review is composed at render time from `src/lib/release-rescue-observation-catalog.ts`, keyed by a stable code the artifact stores. There is no field on a finding, an assessment, or a report that a caller can write a sentence into.

D-010 removed the customer's source from the artifact. It did not remove the auditor's sentences about it, and four rounds went into whether a rule could tell a description from a quotation. Both directions were measured and both failed: a construct-keyed rule delivered 366 of 366 generated credentials through `DB_PASSWORD is set to <value>`, and a rule strict enough to catch that refused 15 of 21 sentences an auditor legitimately needs to write. There is no rule between those two, because "is this sentence a quotation?" has no decidable answer over arbitrary prose.

The decision removes the question rather than sharpening the rule. An auditor does not write a sentence, so no rule needs to judge one. It costs the narrative quality of the report and was a significant redesign.

Recorded here for the same reason as D-010: it was taken, implemented, and left out of this register.

Source: [AI App Release Rescue v1 § The structured-observation decision](docs/AI-APP-RELEASE-RESCUE-V1.md), `src/lib/release-rescue-observation-catalog.ts`, `supabase/migrations/20260916140000_release_rescue_structured_observations_v10.sql`.

## D-012 — The release environment is GitHub Actions `verify` on the exact candidate SHA

Date: 2026-09-17 (opened) · 2026-09-18 (decided)  
Status: **decided — owner-directed** · Review by: **2026-10-17**  
Decision: **GitHub Actions `verify` on the exact candidate SHA is the authoritative release environment. Local failures caused solely by unsupported Git 2.43 do not block when CI `verify` passes. Any GitHub Actions failure remains a blocker.**

Recorded on 2026-09-18 from the owner's implementation order, issued through the Chief of Staff (Bryant Thornton), which carried this wording verbatim and directed that this entry be amended to it. The audit ledger's open-decisions table is aligned in the same commit. The standard this register held D-009 and D-013 to — the owner's decision in the owner's words, in this file — is the standard met here; the executor recording it chose none of the words above.

What the decision settles, exactly: the question the entry below narrowed to on 2026-09-17 — *does the release gate read CI, or the development container?* — is answered **CI**, and only for failures whose sole cause is the container's Git 2.43 lacking `--no-lazy-fetch`. Any other local failure, and any GitHub Actions failure of any kind, blocks as before. The eight tests named below are the complete list this decision covers; the exception is not open-ended, and it is reviewed by 2026-10-17.

What it does NOT do: it does not lift `DO_NOT_MERGE`, which the pull request continues to hold; it does not authorize a merge, a deployment, payment activation, production access, or any increase in executor authority; and it does not make the local suite green — locally the eight tests still fail, and every report must continue to say both halves.

---

The record below is the entry as it stood while the decision was open. It is kept unedited, because it is the evidence the decision was made on.

Decision as of 2026-09-17: **None taken.** This entry records the exact decision that is missing, so that its absence is visible in the register rather than inferred from a PR body.

`npm test` on `remediation/release-rescue-pipeline-authority` reports **1,570 passing and 8 failing**. All eight are in `src/lib/__tests__/software-context-shunt-cli.test.ts`, they fail identically on `main`, and `git diff c3cf4a0..HEAD` is empty for that file, for `scripts/software-context-shunt.mjs`, and for `src/lib/software-context-shunt.ts` — they are not this branch's to fix. They are nonetheless real failures and the suite is not green.

### The exception, stated exactly

**Scope — these eight tests in this one file, and nothing else.** Any other failure, in this file or any other, is outside this exception and blocks the release on its own.

| | Test name, verbatim |
| --- | --- |
| 1 | `reads an immutable blob, not dirty working-tree content, without mutations` |
| 2 | `runs as a real Node command with structured stdout and no dynamic install` |
| 3 | `refuses invalid UTF-8, symlink, or oversized blob: binary.ts` |
| 4 | `refuses invalid UTF-8, symlink, or oversized blob: linked.ts` |
| 5 | `refuses invalid UTF-8, symlink, or oversized blob: oversized.ts` |
| 6 | `keeps a UTF-8 byte-order mark in the source hash` |
| 7 | `accepts exactly the file-size boundary without emitting an oversized result` |
| 8 | `requires an explicit continuation after a no-match result` |

All eight are in `describe("software context CLI: actual Git boundary")`.

**Cause — measured, not inferred.** `scripts/software-context-shunt.mjs` invokes Git with `--no-lazy-fetch` on every call, and refuses outright if a preflight `git --no-lazy-fetch --version` fails. This container ships **Git 2.43.0**, which does not have that option:

```
$ git --version
git version 2.43.0
$ git --no-lazy-fetch --version
unknown option: --no-lazy-fetch          # exit 129
```

So the adapter's own runtime precondition is unmet and it returns exit 2 for every invocation. Each of the eight tests asserts an exit code or a receipt that a working Git would produce. The flag is a deliberate part of the adapter's threat model — it stops a partial clone reaching the network to fetch a missing object — so **lowering the requirement is a security change, not a test fix**, and is not an executor's call.

**Owner:** the repository owner, as the only party who may set a verification policy (`AGENTS.md`: an executor may never own verification gates).

**Measured on CI, and the premise did not survive it.** On 2026-09-17 at 22:47Z, `verify` was assigned a runner for the first time and ran on `ea9e81a`. **All thirteen tests in that file passed.** The runner reports `git version 2.55.0`; this container has 2.43.0. The diagnosis above is confirmed exactly — and with it, the claim that these eight failures are what keeps the suite red is **false for CI**. They are a property of the development container, not of the branch.

The suite was still red on that run, for one unrelated test: a near-quadratic path in the credential scanner that this container's timings had been hiding behind a threshold. That is a real defect, it is fixed, and it was never part of this exception. It is recorded as S-004 and S-005 in the audit ledger.

So this exception has narrowed rather than widened. It governs eight failures that are visible only here, and it is no longer the thing standing between this branch and a green CI run.

**And on 2026-09-17 at 23:17Z, `verify` passed in full on `7969a76`** — lint, typecheck, `npm test` and `npm run build`, every step green, first attempt. That is the first green run this branch has ever had.

This does not close D-012, and an executor may not treat it as closing it. What it does is replace the question. The original question was what to do about a red suite. The question now is narrower and is still the owner's:

> Does the release gate read CI, or does it read the development container?

If CI, this gate is satisfied on the current head and D-012 can close as moot. If the container must also be green, the eight failures stand and the exception above is the record of them. An executor may not choose which of those two the gate means — that is a verification policy, and `AGENTS.md` reserves verification gates to accountable humans.

`DO_NOT_MERGE` therefore still stands. It is held by this entry and by the pull request, not by the state of CI.

**Expiration:** this exception expires when any one of these becomes true, whichever is first:
- the container's Git reaches a version carrying `--no-lazy-fetch` and the eight tests pass unchanged;
- the eight failures are fixed on `main` and this branch is rebased;
- **2026-10-17** — one month from this entry. After that date the exception is void and the eight failures block the release again with no exception recorded, rather than lapsing quietly into an assumption.

**What this exception does NOT do.** It does not make the suite green, it does not lift `DO_NOT_MERGE`, and it does not authorize a merge. It records exactly which failures are known, why, whose decision is outstanding, and when the record goes stale. The decision itself is still open.

The release gate as written requires a green suite. Three options exist and none may be taken by an executor:

1. Adopt a written verification policy naming `software-context-shunt-cli` as environmentally excluded, with the exclusion scoped to a named list of tests, an owner, and a review date. The suite would then be green against a policy rather than against zero failures.
2. Fix the eight failures on `main` first and rebase, which blocks this release on unrelated work.
3. Merge with a red suite under an explicit, time-bounded owner waiver, as D-008 did for a different unavailability.

Until one is chosen, **`DO_NOT_MERGE` stands**, and no report, commit message, or pull request on this branch may describe the suite as green. An executor may not choose between these, may not silently exclude the failures, and may not reinterpret a red suite as passing.

Option 1 is the one the exception above is written FOR: it supplies the named list, the cause, the owner and the review date that option would need. Recording those is not the same as electing it, and this executor has not.

Source: PR [#97](https://github.com/Bthornton1994/Virtual-Assistant/pull/97), `src/lib/__tests__/software-context-shunt-cli.test.ts`, [D-008](#d-008--bounded-owner-authorized-merge-while-ci-was-unavailable).

---

## D-013 — A reviewer's approval records why it was given and which bytes it covers

Date: 2026-09-17  
Status: **decided — owner-directed**  
Decision: `reviewedBy` carries a `reasonCode` from a frozen catalog and an `approvedContentHash`. Both are required, both are enforced at the delivery gate, and existing records are not backfilled.

The register listed this as an open question in `docs/AI-APP-RELEASE-RESCUE-AUDIT-LEDGER.md`: whether `reviewedBy` should carry a reason and a hash of the artifact approved, noting that closing it was a schema change and a migration. The owner directed both.

What was wrong. `reviewedBy` recorded an operator id, a display name and a timestamp — who and when, and nothing else. `decideReleaseRescueDelivery` bound its decision to a content hash, which looked like the missing half and was not: it recomputed that hash from the same bytes it was about to render, so it could not disagree with them. **It always matched.** An edit made to a report after a human approved it — a verdict flipped, a blocking finding dropped, a limitation removed — passed every check in the system.

What was decided, and the constraints that decided it:

- **The reason is a code, not a sentence.** The same judgement as [D-011](#d-011--a-report-carries-codes-and-a-frozen-catalog-carries-the-words) and the same one already applied to secret-hold clearances. This field sits on the signature line of a customer's report, beside a display name an audit caught carrying `Reviewed by ThisAppIsSecure`.
- **The hash covers the report WITHOUT `reviewedBy`.** A signature cannot cover itself: the full content hash changes the moment the signature is attached, so a reviewer attesting to it would be attesting to a value that cannot exist until after they have signed. Everything else is in scope — findings, severities, counts, coverage, verdict, scope, holds, clearances, limitations, provenance.
- **The hash comes from the reviewer's side.** It is the hash of the artifact they were shown, sent back with the approval and verified against the stored report. Deriving it here would reinstate the check that could not fail.
- **Existing records are not backfilled, and this is the substance of the migration rather than an omission in it.** A reason and an attestation are things a human did or did not record; writing a default into either would manufacture an approval nobody gave. A report signed before `v13` cannot be repaired — it has to be reviewed and signed again. The new columns are nullable, the delivery constraint is `NOT VALID` so pre-existing rows keep their history and lose only their deliverability, and the migration reports how many un-attested rows exist rather than assuming none.
- **A reviewer's own text is refused rather than redacted.** Findings come from a repository we are reading and are expected to contain credential material, so the pipeline removes it and records a hold. A reviewer's name comes from our operator, and there is nothing to salvage by rewriting it.

This decision changes an artifact contract and a database schema. It does not lift `DO_NOT_MERGE`, does not make the suite green, and does not authorize a merge, a deployment, payment activation, production access, or any increase in executor authority.

Source: `supabase/migrations/20260917200000_release_rescue_reviewer_attestation_v13.sql`, `supabase/qa/release_rescue_reviewer_attestation_v13_proof.sql`, `src/lib/release-rescue-report.ts`, `src/lib/__tests__/release-rescue-review-attestation.test.ts`, PR [#97](https://github.com/Bthornton1994/Virtual-Assistant/pull/97).
