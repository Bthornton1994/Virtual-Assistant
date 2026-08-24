# Step 3D: Verified Multi-Executor Work Cell

Status: **Implemented in code and schema. Not deployed to Production. No Production database writes performed.**

Date: 2026-08-23

This document defines the first multi-executor **work cell**: several replaceable executors carrying a single Workstream Run, with Delegation Cloud retaining sole ownership of every authoritative state transition.

It does not replace `VISION.md`, which remains the governing product constitution, nor `docs/GAUNTLET-LOOP.md`, which remains the execution-control loop. A work cell is a staffing arrangement inside one Gauntlet attempt. It grants no authority the Delegation Spec has not already granted.

## Vision analysis

**Aligns with constraints.**

Governing sections:

- `VISION.md` — Authority, approvals, human accountability, and manual proof before automation. Step 3D adds no authority: both agent executors are registered `shadow`, hold `prepare_only` action class, and any non-zero authority action is a deterministic hard failure.
- Strategic thesis §7 *Proof-carrying work* — "Nothing is complete merely because an agent or operator says it is complete." The deterministic validator, not the reviewing agent, owns `hard_gate_pass`.
- Strategic thesis §11 *Executors are interchangeable; responsibility is not* — the executor registry is generic (`executor_profiles`), not Loadout-specific, and Delegation Cloud owns the outcome regardless of which executor performed the step.
- Strategic thesis §13 *The customer should never have to manage an AI workforce* — the roster is staff-only under RLS; customers see workstreams and outcomes, not agents.
- `docs/GAUNTLET-LOOP.md` §4 *Adversarial verification* — the reviewer's job is to try to disprove completion. Step 3D makes that a typed, hash-bound artifact rather than prose.

Constraints observed: no new authority, no automatic promotion, no duplicate evidence system, no secrets in the registry, no Production deployment or writes.

## Architecture

```text
Delegation Spec  (authority ceiling — unchanged)
  └─ Gauntlet Cycle
      └─ Workstream Run  ← one attempt
          └─ WORK CELL
              ├─ manifest  frozen BEFORE any evidence exists
              │              Evidence Artifact  payload.schemaVersion = catalog-evidence-input/v1
              │              expected product batch + market + both executor keys, by inputHash
              │
              ├─ prepare   executor named by the manifest (agent, shadow)
              │              output → Evidence Artifact  payload.schemaVersion = catalog-evidence-packet/v1
              │              frozen by sha256 content hash
              │
              ├─ review    executor named by the manifest (agent, shadow)
              │              input  ← the frozen packet artifact
              │              output → Evidence Artifact  payload.schemaVersion = catalog-evidence-review/v1
              │              bound to the packet by evidencePacketHash — never edits it
              │
              └─ validate  executor: catalog-evidence-validator-v1 (deterministic, active)
                             output → Evidence Artifact  payload.schemaVersion = catalog-evidence-validation/v1
                             owns: hardGatePass, hardFailures, warnings, every metric count
                                    │
                                    ▼
                        ONE Gauntlet review row (reviewer_kind 'deterministic')
                          verdict incorporates the reviewer's conclusions
                                    │
                                    ▼
                        Outcome Receipt (existing DB guard: blocked without a clean hard gate)
```

A rejected executor output produces a fifth artifact type,
`catalog-evidence-rejection/v1`. It is explicitly untrusted — it never becomes a
packet or a review — but it preserves the attempt, its raw-output hash, and the
hard failures, so a failed executor run can still be classified and costed.

### Reused, not duplicated

Step 3D adds no parallel evidence or receipt system. It reuses `delegation_specs`, `workstream_runs`, `evidence_artifacts`, `outcome_receipts`, `gauntlet_reviews`, and the whole Gauntlet lifecycle.

No `catalog_evidence_packets` table exists. Both typed artifacts are ordinary rows in `evidence_artifacts`, discriminated by `payload->>'schemaVersion'`. `evidence_artifacts` already grants only `select` and `insert` to `authenticated` — no `update`, no `delete` — which is exactly the immutability these artifacts require. A dedicated table would have added a second evidence store without adding an invariant.

### New schema

`supabase/migrations/20260823120000_step3d_work_cell.sql`

**`executor_profiles`** — the generic executor registry. Keyed by a stable `key`, typed by `executor_kind` (`agent` / `deterministic` / `human`), gated by `status` (`shadow` / `active` / `suspended` / `retired`), and carrying `capabilities`, `authority_envelope`, `forbidden_actions`, and `configuration_metadata` as JSONB. It stores **no API keys, tokens, or credentials**. Not org-scoped: it is internal staffing detail, readable only by platform staff and writable only by operations managers.

**`run_executor_assignments`** — one row per (run, phase). Carries `authority_snapshot` (the profile's envelope frozen at assignment time, so a later profile edit cannot rewrite what governed a past run), `input_artifact_id`, `output_artifact_id`, and per-executor economics (`human_minutes`, `ai_cost_micros`, `tool_cost_micros`).

Both tables are **staff-only for SELECT at the database boundary**, not merely hidden by the ops UI. Assignment rows expose which agent ran, under what authority, at what internal AI and tool cost — the AI workforce the customer is explicitly not supposed to manage (`VISION.md`; strategic thesis §13). If customers ever need work-cell status, the answer is a separate sanitized projection, not widening these policies.

Database-enforced invariants:

- an assignment must share its run's organization;
- a `suspended` or `retired` profile cannot be assigned new work;
- **the `validate` phase requires a `deterministic` executor** — an AI worker cannot own a verification gate at the database boundary, not merely by convention;
- assignment identity and the frozen authority snapshot are immutable;
- a `completed` or `failed` assignment is terminal, and a recorded output artifact cannot be replaced;
- referenced input/output artifacts must belong to the same run;
- `unique (run_id, phase)` — a second pass at a phase belongs to a new Gauntlet attempt, never a silent overwrite;
- an evidence artifact declaring either typed `schemaVersion` must carry a 64-hex sha256 `content_hash`, because an unhashed packet cannot be provably referenced by a review.

## Evidence packet contract

`CatalogEvidencePacketV1` — `src/lib/catalog-evidence-packet.ts`, `schemaVersion: "catalog-evidence-packet/v1"`.

Top level: `runId`, `executorKey`, `generatedAt`, `market`, `products[]`, `authorityReport`.

Each product carries `productId`, `identity` (`exact` / `uncertain` / `mismatch` plus a reason), `primarySources[]`, `secondarySources[]`, `priceEvidence`, `claimFindings[]`, `federationEvidence[]`, `candidateCorrections[]`, and `escalation`.

Every schema object is `.strict()`. That is load-bearing: it is what makes hard rule 14 structural — a packet that tries to carry its own batch aggregate counts is rejected as an unrecognized key rather than having its self-reported numbers quietly believed.

Two interpretive choices worth recording:

- **Primary-source `sourceType` is a closed enum; secondary-source `sourceType` is free text.** The primary enum is what hard rules 7–9 reason about, so it must be closed. The spec enumerated no secondary list, and secondary sources are context, not gate inputs.
- **URL fields accept any non-empty string at the schema layer.** Content validation lives entirely in the deterministic validator, so schema and validator cannot disagree about what counts as malformed. A Markdown link fails as a *validator* hard failure with a specific message, not as an opaque schema error.

## Review contract

`CatalogEvidenceReviewV1` — `src/lib/catalog-evidence-review.ts`, `schemaVersion: "catalog-evidence-review/v1"`.

References `runId`, `evidencePacketHash`, `reviewerExecutorKey`, `reviewedAt`. Provides claim-level review — `claimReviews[]` with `claimId`, `verdict` (`accept` / `reject` / `inconclusive`), `independentVerificationPerformed`, `reason`, `independentSourceUrls[]`, `severity` — plus `newFindings[]`, `evidenceGaps[]`, `challengedAssumptions[]`, `escalationRequired`, `escalationReason`, and its own `authorityReport`.

**The reviewer can never modify the Hermes packet.** This is structural, not procedural: the review schema has no field capable of holding packet content, and `.strict()` rejects any attempt to add one. The only link between the two artifacts is the content hash.

## Hashing

`src/lib/catalog-evidence-hash.ts` canonicalizes JSON deterministically — recursively sorting object keys, preserving array order, dropping `undefined` — then SHA-256s the result. Two processes handed the same logical packet always agree on its identity regardless of key order.

The hash is stored on the artifact (`evidence_artifacts.content_hash`). The review references it. That is what proves *which exact* Hermes output Grok reviewed. At verdict time the validator recomputes the hash from the stored payload: if the stored artifact no longer hashes to its recorded identity, that is a hard failure, not a warning.

## Deterministic gates

`src/lib/catalog-evidence-validator.ts` calls no LLM and reaches no network. Given the same input it always returns the same `{ hardGatePass, hardFailures, warnings, metrics }`.

**Every metric is computed by code and never accepted from an agent**: `productCount`, `exactIdentityCount`, `uncertainIdentityCount`, `mismatchIdentityCount`, `conflictCount`, `highSeverityConflictCount`, `unsupportedOrUnresolvedCount`, `correctionCount`, `escalationCount`, `primarySourceCount`, `secondarySourceCount`, `missingPrimarySourceCount`, `authorityIncidentCount`, `malformedUrlCount`, `schemaViolationCount`.

Packet hard rules:

| # | Rule |
|---|------|
| 1 | Schema must parse. |
| 2 | Required product IDs appear exactly once. |
| 3 | No unexpected product IDs when an expected set is supplied. |
| 4 | URLs must be plain `https://` URLs. |
| 5 | Markdown-formatted URLs are rejected. |
| 6 | A source claiming `accessedDuringRun` must carry a real URL. |
| 7 | `approved-list` status requires federation-approved-list evidence. |
| 8 | `rule-compliant` / `rule-noncompliant` requires a federation rulebook source. |
| 9 | `manufacturer-claimed-compliant` requires manufacturer evidence. |
| 10 | A candidate correction must cite evidence contained in the packet. |
| 11 | A high-confidence, non-null correction is rejected while identity is `uncertain` or `mismatch`. Nullifying an unsupported claim is explicitly allowed. |
| 12 | Every high-severity contradiction produces an escalation or a supported correction. |
| 13 | Any non-zero authority-report value is a hard failure during Step 3 shadow execution. |
| 14 | Packets may not carry their own batch aggregate counts (structural, via `.strict()`). |
| 15 | Market-mismatched price evidence raises a **warning**, not a failure. |
| 16 | Family- or category-scoped approval raises a **warning** that it does not establish exact-configuration compliance. |

Additional packet rules added after architectural review:

- claim IDs must be **globally unique** across the packet, because the review contract addresses claims by bare `claimId`;
- the packet must declare the run, executor, and market it was actually ingested for;
- **federation conclusions must be bound to the right evidence** (below);
- **price evidence** is conditional: when `priceType` is `unavailable`, the price, comparison price, variant scope, and source URL may all be null, so a genuinely unresolved product is representable without fabricating a source. For any other price type all four are required, and a `sale` must name — and actually be below — the price it is discounted from.

### Federation binding

This is the rule that encodes the semantic failure seen in Hermes runs 1–3. For a conclusion of `approved-list`, `rule-compliant`, `rule-noncompliant`, or `manufacturer-claimed-compliant`:

- every cited `sourceUrl` must resolve to a **declared primary source on the same product**;
- a **secondary source can never** satisfy it;
- the cited source must be of the matching type (approved-list → `federation-approved-list`, rule-compliant/noncompliant → `federation-rulebook`, manufacturer-claimed → `manufacturer`);
- the cited source must have `accessedDuringRun: true`;
- for the two federation-scoped document types, the source's own `federation` field must **match the federation being concluded about**.

So an IPF rulebook cannot establish USAPL rule-compliance, and an IPF approved list cannot establish a CPU or USAPL named approval. Cross-federation recognition is never inferred: if USAPL adopts the IPF list, that is its own `federationEvidence` entry citing a **USAPL** source that says so. `unknown` and `not-applicable` assert nothing and need no backing.

Review hard rules: `evidencePacketHash` must match the frozen artifact; the review must declare the right run and reviewer; every referenced `claimId` must exist and be reviewed **exactly once**; fabricated claim IDs are rejected; every high-severity Hermes claim must receive a review with `independentVerificationPerformed: true`; an `accept` or `reject` verdict must cite at least one **valid** independent source; a sourceless `inconclusive` is allowed only when `evidenceGaps` names the claim; Markdown and non-https URLs are rejected; the authority report must be zero; the reviewer cannot alter the packet.

The market-mismatch and family-scope rules stay warnings rather than failures because both describe evidence that is real but narrower than it looks. Failing them would push executors toward suppressing the disclosure; warning on them keeps the narrower scope visible to the human reviewer, which is the behavior `VISION.md` actually wants.

## The hard gate: benchmark quality vs. execution verification

Two questions are kept strictly apart, because conflating them was a real defect in the first implementation.

**Benchmark quality** — *did the reviewer do good work?* A reviewer that catches a genuine defect is performing well. `summarizeWorkCellBenchmark` measures this: claims reviewed, independent verifications, rejections, new findings, and whether the reviewer surfaced something structural validation missed.

**Execution verification** — *is this attempt ready to be called done?* A caught defect means **no**. The attempt goes to corrective action.

A reviewer's conclusion therefore blocks verification even when the review artifact is perfectly valid. `hardGatePass` is false whenever any of these hold:

| Blocker | Why |
| :--- | :--- |
| Packet or review fails structural validation | The artifact itself is not sound |
| No independent review ingested | Nothing has challenged the work |
| Any authority incident (either executor) | Out-of-envelope action |
| Reviewer rejected any claim | The work was disproven |
| Reviewer returned any inconclusive | Step 3D treats every inconclusive as material: this workstream has no track record, so "could not confirm" is not a basis for a verified receipt |
| Reviewer set `escalationRequired` | A human must decide |
| Reviewer raised a high-severity new finding | A real defect the packet missed |
| The packet's own `escalation.required` | The executor itself said a human must decide, so the outcome is not finished |

### Why exactly one Gauntlet review row

The pre-existing receipt guard passes a run as soon as **any** independent review row has `verdict='passed' AND hard_gate_pass AND` no authority incidents. The first implementation wrote two rows — a deterministic one and an agent one — and the deterministic row could read `passed` while the agent row read `failed`. That let a passing Outcome Receipt through on an attempt the reviewer had rejected.

The work cell now writes **one** authoritative row whose verdict already incorporates the complete reviewer semantics. There is deliberately no second row that could satisfy the guard on its own. This also makes the operation atomic and idempotent: a single insert, guarded by an existence check on `reviewer_ref`.

Two further routes around the gate were found by adversarial review of that fix and closed in `supabase/migrations/20260824090000_step3d_work_cell_hardening.sql`:

- **The manual review form.** The original hand-entered adversarial-review form is available in exactly the same window as the work-cell verdict button, and a manual `passed` row satisfied the guard just as well. The guard now requires that, when a run has a work cell, the passing review be the work cell's own deterministic row. Runs with no work cell are unaffected. A trigger also reserves the `delegation-cloud-work-cell-v1` reviewer reference so a hand-entered row cannot impersonate the deterministic verdict — which matters because `gauntlet_one_final_review_per_run_idx` allows exactly one review row per run, so whoever writes first occupies the slot.

- **The content-hash overwrite.** `enforce_evidence_artifact_invariants` ended with an unconditional `new.content_hash := digest(...)`, silently discarding whatever the application supplied. For Step 3D this was fatal rather than cosmetic: the work cell binds a review to a packet by the packet's *canonical* hash and re-derives that hash from the stored payload at verdict time, so the stored value being a different digest over a different preimage meant the re-derivation could never match and **every work cell would have hard-failed on first real use**. The digest is now a fallback for when no usable hash was supplied.

### Side doors around the federation rules

Adversarial review also found that the federation binding could be sidestepped by asserting compliance somewhere other than `federationEvidence`. Three fixes:

- `candidateCorrections` is no longer a side door. A correction to a field that asserts federation compliance (`FEDERATION_BEARING_FIELDS` — domain configuration a new catalog must extend) now requires a `federationEvidence` entry for that federation that actually passed source binding. Withdrawing a claim (`null` or `false`) is always allowed.
- `declaredEvidenceUrls` is built from declared **sources** only. Folding in `claimFindings` URLs let an executor park an arbitrary URL in a finding and then cite it as the evidence for a high-confidence correction.
- A `status: "unknown"` entry can no longer act as exact-configuration backing. Because `unknown` skips every binding rule, a free unsourced decoy entry could silence the family-scope warning. Only positively asserting statuses count, and federation names are compared case- and whitespace-insensitively.

## Authority boundaries

| Executor | Kind | Status | May | May not |
|---|---|---|---|---|
| `hermes-loadout-researcher-v1` | agent | shadow | inspect supplied catalog records, research public/manufacturer/federation sources, return `CatalogEvidencePacketV1` | repository changes, catalog changes, external messages, vendor contact, purchases, account creation, permission changes, production writes, Skill or Routine creation/modification, automations |
| `grok-loadout-reviewer-v1` | agent | shadow | receive the original catalog input and the frozen packet, research independently, challenge findings, return `CatalogEvidenceReviewV1` | everything above, **plus** modifying the Hermes packet and treating Hermes output as an authoritative source |
| `catalog-evidence-validator-v1` | deterministic | active | parse, validate, hash, count, calculate gates | network access, LLM inference, catalog writes, external actions |

Registered by the re-runnable QA fixture `supabase/qa/step3d_executor_profiles.sql`. It stores capability and policy metadata only — never a credential.

## Why AI workers cannot own state

An AI worker's report is an *observation*, not a *fact*. It can be confident and wrong, and confidence is not evidence. So in this architecture an AI executor may produce evidence and judgments, and may never own:

- **authoritative state transitions** — the Gauntlet stage machine and the run lifecycle are enforced by database triggers;
- **counts** — every metric is recomputed by `catalog-evidence-validator.ts` from the artifact itself; `.strict()` prevents a packet from carrying its own aggregates;
- **economic calculations** — costs are recorded per assignment by the operator, not self-reported by the executor;
- **autonomy decisions** — the existing autonomy controller decides, and promotion stays approval-gated;
- **verification gates** — `hard_gate_pass` comes from the deterministic validator plus the reviewer's conclusions, never from either agent's own claim about whether it passed. A reviewer that accepts everything over evidence the validator rejects still produces `hardGatePass: false`; a reviewer that rejects a claim also produces `hardGatePass: false`, no matter how clean the packet looked.

Two independent AI workers agreeing is not proof. It is two observations. The deterministic layer is what turns observations into a gate.

Note what this deliberately does *not* claim: the validator proves the evidence packet is *well-formed, internally consistent, and inside its authority envelope*. It does not prove the catalog data is correct. A packet can pass every hard gate and still be wrong about the world, which is exactly why human review remains in the loop and why both agents remain in `shadow`.

## Manual Run 4 procedure

Run 4 is the first work-cell execution. It is manual on purpose: Delegation Cloud can prepare and evaluate the cell, but it does not execute Hermes or Grok on the owner's behalf.

Prerequisites, in order:

1. Apply `supabase/migrations/20260823120000_step3d_work_cell.sql` to the **QA** environment only, after review and explicit authorization.
2. Apply `supabase/migrations/20260824090000_step3d_work_cell_hardening.sql` to the same QA environment. **Both are required.** Without the second, the content-hash overwrite makes every work cell hard-fail and the manual review form can bypass the gate.
3. Apply `supabase/qa/step3d_executor_profiles.sql` to the same QA environment.
4. Confirm the three profiles exist and that both agents are `shadow`.
5. Sanity-check the hash fix before trusting any run: insert an evidence artifact with a known 64-hex `content_hash` and confirm the stored value is the one supplied, not a digest of the row.

Then:

4. Create a Gauntlet attempt for the Catalog Integrity workstream in the usual way and start the run.
5. Open the run page → **Work Cell** → *0. Frozen input manifest*. Enter the market, the exact expected product IDs, and the two executor keys. Freeze it. **This happens before any executor runs** — it is the run's provenance, and every later stage reads the batch and executor identities from it.
6. Run the Hermes task externally under its documented shadow constraints. Preserve the raw output verbatim.
7. Paste the raw JSON into *1. Frozen evidence packet*. Record measured human minutes and AI/tool cost. There is no expected-products box and no executor-key box: both come from the manifest.
   - If the validator rejects it, **nothing is stored as evidence**. A `catalog-evidence-rejection/v1` artifact records the attempt, its raw-output hash, and the failures. The rejection is the result: correct the executor's method, not the packet.
8. Copy the frozen packet hash shown on the card. Give Grok the original catalog input and the frozen packet, and require the returned review to carry that hash in `evidencePacketHash`.
9. Paste the raw review JSON into *2. Independent review*. It is accepted only if the hash, run ID, and reviewer key all match.
10. Run *3. Deterministic validation*. This opens only once both executor artifacts exist. Read the report: hard failures, warnings, computed metrics, and the reviewer benchmark.
11. Submit the run for verification with measured economics.
12. Use **Record work-cell verdict into the Gauntlet**. This re-runs the validator over the frozen artifacts and writes one authoritative Gauntlet review.
13. Issue the Outcome Receipt as usual. The existing database guard still blocks a passing receipt without a clean independent hard gate and zero authority incidents.

Expect Run 4 to fail verification if the reviewer catches anything. That is the system working: the benchmark records a good reviewer, and the attempt goes to corrective action.

Record for Run 4, as Step 3B required and Run 3 could not supply: claims reviewed, candidate sources found, source acceptance rate, incorrect-source count, ambiguous cases escalated, human review minutes, owner minutes, AI cost, tool cost, corrections required before acceptance, and whether the deterministic audit agrees with the agent output. Zero must continue to mean *not measured*, never *free*.

## How this generalizes beyond Loadout

Nothing in the work-cell machinery is catalog-specific:

- `executor_profiles` and `run_executor_assignments` name phases (`prepare` / `review` / `validate`) and executor kinds, not domains. The Grounded supplier workstream, a CRM-hygiene workstream, or a research workstream can register their own executors against the same tables with no migration.
- The three-phase shape — *prepare typed evidence → independently review it → deterministically gate it* — is the reusable pattern. Only the typed contracts are domain-specific.
- A new domain therefore needs three things and no schema change: a `<domain>-evidence-packet/v1` Zod contract, a matching review contract, and a deterministic validator whose metrics are computed rather than reported. Register the executors, and the Gauntlet, evidence, receipt, and autonomy machinery already applies.
- The executor identities live in the frozen manifest rather than in code, so a non-Loadout domain freezes its own researcher and reviewer with no change to the ingestion path.
- The hash-binding pattern (a reviewer references the reviewed artifact by content hash and structurally cannot edit it) is domain-neutral and is the part most worth reusing verbatim.

What does **not** generalize is the specific gate list. Rules 7–9 and 15–16 encode powerlifting-federation and retail-pricing semantics. A new domain must derive its own hard rules from its own failure modes; copying Loadout's rules into an unrelated domain would produce a gate that looks rigorous and tests nothing.

## What Step 3D does not prove

- **It has never run against a live database.** Every invariant above is enforced in code and in SQL that has been reviewed and unit-tested as text, not executed. The adversarial review that produced the hardening migration found a defect — the content-hash overwrite — that no amount of TypeScript testing could have surfaced, because it lived in a trigger. Assume more of that class remains until QA runs.
- It does not prove Hermes or Grok produce good evidence. It proves their output can be typed, frozen, independently challenged, and deterministically gated.
- It does not prove the Loadout catalog is accurate.
- It does not establish unit economics. Per-assignment cost fields exist; they are only meaningful once measured.
- It does not earn any autonomy. Both agents remain `shadow`, promotion remains approval-gated, and one clean run is still one run.
