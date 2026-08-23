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
              ├─ prepare   executor: Hermes (agent, shadow)
              │              output → Evidence Artifact  payload.schemaVersion = catalog-evidence-packet/v1
              │              frozen by sha256 content hash
              │
              ├─ review    executor: Grok (agent, shadow)
              │              input  ← the frozen packet artifact
              │              output → Evidence Artifact  payload.schemaVersion = catalog-evidence-review/v1
              │              bound to the packet by evidencePacketHash — never edits it
              │
              └─ validate  executor: catalog-evidence-validator-v1 (deterministic, active)
                             output → Evidence Artifact  payload.schemaVersion = catalog-evidence-validation/v1
                             owns: hardGatePass, hardFailures, warnings, every metric count
                                    │
                                    ▼
                        Gauntlet Reviews (existing model)
                          reviewer_kind 'deterministic'  ← validator verdict
                          reviewer_kind 'agent'          ← Grok verdict, hard gate from the validator
                                    │
                                    ▼
                        Outcome Receipt (existing DB guard: blocked without a clean hard gate)
```

### Reused, not duplicated

Step 3D adds no parallel evidence or receipt system. It reuses `delegation_specs`, `workstream_runs`, `evidence_artifacts`, `outcome_receipts`, `gauntlet_reviews`, and the whole Gauntlet lifecycle.

No `catalog_evidence_packets` table exists. Both typed artifacts are ordinary rows in `evidence_artifacts`, discriminated by `payload->>'schemaVersion'`. `evidence_artifacts` already grants only `select` and `insert` to `authenticated` — no `update`, no `delete` — which is exactly the immutability these artifacts require. A dedicated table would have added a second evidence store without adding an invariant.

### New schema

`supabase/migrations/20260823120000_step3d_work_cell.sql`

**`executor_profiles`** — the generic executor registry. Keyed by a stable `key`, typed by `executor_kind` (`agent` / `deterministic` / `human`), gated by `status` (`shadow` / `active` / `suspended` / `retired`), and carrying `capabilities`, `authority_envelope`, `forbidden_actions`, and `configuration_metadata` as JSONB. It stores **no API keys, tokens, or credentials**. Not org-scoped: it is internal staffing detail, readable only by platform staff and writable only by operations managers.

**`run_executor_assignments`** — one row per (run, phase). Org-scoped and RLS'd consistently with the rest of execution. Carries `authority_snapshot` (the profile's envelope frozen at assignment time, so a later profile edit cannot rewrite what governed a past run), `input_artifact_id`, `output_artifact_id`, and per-executor economics (`human_minutes`, `ai_cost_micros`, `tool_cost_micros`).

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

Review hard rules: `evidencePacketHash` must match the frozen artifact; every referenced `claimId` must exist; fabricated claim IDs are rejected; every high-severity Hermes claim must receive an independent review; Markdown and non-https URLs are rejected; the authority report must be zero; the reviewer cannot alter the packet.

Rules 15 and 16 are warnings rather than failures because both describe evidence that is real but narrower than it looks. Failing them would push executors toward suppressing the disclosure; warning on them keeps the narrower scope visible to the human reviewer, which is the behavior `VISION.md` actually wants.

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
- **verification gates** — `hard_gate_pass` comes from the deterministic validator. `src/lib/work-cell-policy.ts` exists specifically to make this unbypassable: a reviewer that accepts everything over evidence the validator rejects still produces `hardGatePass: false` and an `agentVerdict` that cannot read `passed`.

Two independent AI workers agreeing is not proof. It is two observations. The deterministic layer is what turns observations into a gate.

Note what this deliberately does *not* claim: the validator proves the evidence packet is *well-formed, internally consistent, and inside its authority envelope*. It does not prove the catalog data is correct. A packet can pass every hard gate and still be wrong about the world, which is exactly why human review remains in the loop and why both agents remain in `shadow`.

## Manual Run 4 procedure

Run 4 is the first work-cell execution. It is manual on purpose: Delegation Cloud can prepare and evaluate the cell, but it does not execute Hermes or Grok on the owner's behalf.

Prerequisites, in order:

1. Apply `supabase/migrations/20260823120000_step3d_work_cell.sql` to the **QA** environment only, after review and explicit authorization.
2. Apply `supabase/qa/step3d_executor_profiles.sql` to the same QA environment.
3. Confirm the three profiles exist and that both agents are `shadow`.

Then:

4. Create a Gauntlet attempt for the Catalog Integrity workstream in the usual way and start the run.
5. Run the Hermes task externally under its documented shadow constraints. Preserve the raw output verbatim.
6. Open the run page → **Work Cell** → *1. Frozen evidence packet*. Paste the raw JSON. Optionally supply the expected product IDs to enforce exact batch coverage. Record measured human minutes and AI/tool cost.
   - If the validator rejects it, **nothing is stored**. The rejection is the result: correct the executor's method, not the packet.
7. Copy the frozen packet hash shown on the card. Give Grok the original catalog input and the frozen packet, and require the returned review to carry that hash in `evidencePacketHash`.
8. Paste the raw review JSON into *2. Independent review*. It is accepted only if the hash matches.
9. Run *3. Deterministic validation*. Read the report: hard failures, warnings, and computed metrics.
10. Submit the run for verification with measured economics.
11. Use **Record work-cell verdict into the Gauntlet**. This re-runs the validator over the frozen artifacts and writes the `deterministic` and `agent` Gauntlet reviews.
12. Issue the Outcome Receipt as usual. The existing database guard still blocks a passing receipt without a clean independent hard gate and zero authority incidents.

Record for Run 4, as Step 3B required and Run 3 could not supply: claims reviewed, candidate sources found, source acceptance rate, incorrect-source count, ambiguous cases escalated, human review minutes, owner minutes, AI cost, tool cost, corrections required before acceptance, and whether the deterministic audit agrees with the agent output. Zero must continue to mean *not measured*, never *free*.

## How this generalizes beyond Loadout

Nothing in the work-cell machinery is catalog-specific:

- `executor_profiles` and `run_executor_assignments` name phases (`prepare` / `review` / `validate`) and executor kinds, not domains. The Grounded supplier workstream, a CRM-hygiene workstream, or a research workstream can register their own executors against the same tables with no migration.
- The three-phase shape — *prepare typed evidence → independently review it → deterministically gate it* — is the reusable pattern. Only the typed contracts are domain-specific.
- A new domain therefore needs three things and no schema change: a `<domain>-evidence-packet/v1` Zod contract, a matching review contract, and a deterministic validator whose metrics are computed rather than reported. Register the executors, and the Gauntlet, evidence, receipt, and autonomy machinery already applies.
- The hash-binding pattern (a reviewer references the reviewed artifact by content hash and structurally cannot edit it) is domain-neutral and is the part most worth reusing verbatim.

What does **not** generalize is the specific gate list. Rules 7–9 and 15–16 encode powerlifting-federation and retail-pricing semantics. A new domain must derive its own hard rules from its own failure modes; copying Loadout's rules into an unrelated domain would produce a gate that looks rigorous and tests nothing.

## What Step 3D does not prove

- It does not prove Hermes or Grok produce good evidence. It proves their output can be typed, frozen, independently challenged, and deterministically gated.
- It does not prove the Loadout catalog is accurate.
- It does not establish unit economics. Per-assignment cost fields exist; they are only meaningful once measured.
- It does not earn any autonomy. Both agents remain `shadow`, promotion remains approval-gated, and one clean run is still one run.
