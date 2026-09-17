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

## D-012 — OPEN: the policy required before the release can leave DO_NOT_MERGE

Date: 2026-09-17  
Status: **open — owner decision required**  
Decision: **None taken.** This entry records the exact decision that is missing, so that its absence is visible in the register rather than inferred from a PR body.

`npm test` on `remediation/release-rescue-pipeline-authority` reports 1,546 passing and **8 failing**. All eight are in `src/lib/__tests__/software-context-shunt-cli.test.ts`, they fail identically on `main`, and `git diff c3cf4a0..HEAD` is empty for that file and its subject — they are not this branch's to fix. They are nonetheless real failures and the suite is not green.

The release gate as written requires a green suite. Three options exist and none may be taken by an executor:

1. Adopt a written verification policy naming `software-context-shunt-cli` as environmentally excluded, with the exclusion scoped to a named list of tests, an owner, and a review date. The suite would then be green against a policy rather than against zero failures.
2. Fix the eight failures on `main` first and rebase, which blocks this release on unrelated work.
3. Merge with a red suite under an explicit, time-bounded owner waiver, as D-008 did for a different unavailability.

Until one is chosen, **`DO_NOT_MERGE` stands**, and no report, commit message, or pull request on this branch may describe the suite as green. An executor may not choose between these, may not silently exclude the failures, and may not reinterpret a red suite as passing.

Source: PR [#97](https://github.com/Bthornton1994/Virtual-Assistant/pull/97), `src/lib/__tests__/software-context-shunt-cli.test.ts`, [D-008](#d-008--bounded-owner-authorized-merge-while-ci-was-unavailable).
