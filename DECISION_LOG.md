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

## D-009 — First Golden Path is Loadout Catalog Integrity v1, prepare-only and shadow-mode

Date: 2026-09-08  
Status: active  
Decision: Delegation Cloud’s first Golden Path is Loadout Catalog Integrity v1 (D-007). The initial scope is prepare-only and shadow-mode. It may produce reviewed, evidence-backed integrity findings and prepared recommendations, but it may not mutate the catalog, contact suppliers, send messages, merge code, deploy, change permissions, or perform any external action. The first implementation must reuse existing Delegation Specs, Workstream Runs, Step 3D work cells, Execution Runtime leases, evidence artifacts, independent verification, approvals, and Outcome Receipts. No second Run Manager, lease authority, evidence store, memory system, desktop, mobile surface, plugin, relay, hosted memory provider, or customer-facing agent fleet is authorized.

Source: owner decision 2026-09-08, [D-007](DECISION_LOG.md), [Golden Path freeze](docs/GOLDEN-PATH-LOADOUT-CATALOG-INTEGRITY-V1.md), [Step 3D work cell](docs/STEP-3D-WORK-CELL.md).
