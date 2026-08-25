# Catalog Integrity work cell — Runs 4 and 5

Date recorded: 2026-08-25  
Environment: Delegation Cloud Preview/QA only  
Production: not touched  
Loadout catalog: not written  
OpenBot: not started  
Native public-web researcher: not used as prepare executor

This is operator evidence for the frozen Step 3D experiment (`hermes-loadout-researcher-v1` → `grok-loadout-reviewer-v1` → `catalog-evidence-validator-v1`). It is not a passing Outcome Receipt and does not authorize catalog corrections or Skill extraction.

## Frozen batch

Market: `US`

| Product ID | Catalog name |
|---|---|
| `ks-sbd-5mm` | SBD 5mm Knee Sleeves |
| `ww-a7-coneface` | A7 Coneface Wrist Wraps 24" |
| `shoe-do-win` | Do-Win Classic Lifter |
| `suit-inzer-champion` | Inzer Champion Suit Single-Ply |
| `belt-averte` | Averte Dual Prong 13mm |

## Lineage

| Attempt | Run ID | Result |
|---|---|---|
| Run 4 prepare (rejected) | `bc956465-25e0-4f1d-b986-c70fb0048f64` | Operator pasted packet/prose into the wrong field or invalid JSON. Prepare immutable. |
| Run 4 retry | `8a21319e-00eb-444d-a183-3dd6c2a6260e` | Rebound packet/review ingested. Validator hard-gate fail. Failed receipt. QA score 62. |
| Run 5 | `b6a8a948-af3c-4e2a-90b4-1cb7d0764423` | Fresh Hermes packet. Validator hard-gate fail. Submitted. Failed receipt intended. QA score 74. |

Run 5 packet content hash:

`d40e66cf9ef18e8f00fccc44c412234eca0a0b10efe91f7aae16e06e26741e44`

## Step 3B measures (Run 5)

Zero means **not measured**, not free.

| Measure | Run 5 |
|---|---|
| Claims reviewed | 57 |
| Independent verifications | 57 |
| Candidate primary sources (packet) | 28 |
| Secondary sources | 0 |
| Malformed URLs | 0 |
| Authority incidents | 0 |
| Exact / mismatch / uncertain identity | 3 / 2 / 0 |
| Conflicts (packet) | 14 (10 high-severity) |
| Unresolved/unsupported claims | 30 |
| Candidate corrections | 11 |
| Hermes product escalations | 4 |
| Reviewer accepts / rejects / inconclusive | 56 / 1 / 0 |
| Reviewer new findings | 2 (none high-severity) |
| Evidence gaps recorded | 4 |
| Human minutes | not measured |
| Owner minutes | not measured |
| AI/model cost | not measured |
| Tool cost | not measured |
| Deterministic audit vs agent self-report | Validator recomputed all metrics; packet and review structurally valid; hard gate fail from reviewer reject + escalation, not from schema |

## What improved from Run 4 to Run 5

Hermes stopped treating CANPL hardware-list absence as a CPU apparel contradiction, and did not propose replacement SKUs for Coneface or Averte. The remaining hard-gate fail is narrower: Do-Win `evidenceSupportedValue` 75 on a promotional listing, plus identity mismatches that research cannot invent away.

## Failure-case classification (operator paste)

Use on the Gauntlet cycle **4. Corrective action** form.

| Field | Value |
|---|---|
| Classification | `evidence_failure` |
| Severity | `high` |
| Retry decision | `escalate_human` |

**Root cause**

```text
The work cell completed prepare, hash-bound review, and deterministic validation. Hard gate failed because the reviewer rejected shoe-do-win-price (promotional 75.00 USD locked as evidenceSupportedValue) and required escalation. Two frozen catalog identities are not locatable products (ww-a7-coneface, belt-averte). WRPF for Inzer Champion Suit remains unresolved. These are catalog/evidence defects, not control-plane defects. Hermes CPU overclaim from Run 4 did not recur.
```

**Corrective action**

```text
Do not start Run 6 on the same five-product freeze. Human catalog decision required: drop or replace Coneface and Averte; treat Do-Win US price as promotional/sale-scoped rather than a single replacement figure. Keep prepare=hermes-loadout-researcher-v1, review=grok-loadout-reviewer-v1, validate=catalog-evidence-validator-v1. No Loadout write from this packet. No Skill extraction until a later batch without phantom SKUs, or an explicit owner decision to freeze a different product set.
```

## Decision

`USEFUL SHADOW / RETRY BEFORE SKILL`

The control plane is qualified enough to stop repeating this frozen batch. It is not a Skill candidate. CS-1 may proceed only if Hermes/Grok/validator freeze keys stay unchanged.

## Follow-on (no Run 6)

Operator tooling for CS-1 lives on `agent/capability-registry-v1-consolidated`, based on `origin/agent/capability-registry-v1`. See `docs/CAPABILITY-REGISTRY-V1.md`.

## Not authorized

- Loadout catalog edits
- Production writes
- Merging PR #26 from this note
- Replacing Runs 4–9 prepare with the native public-web researcher
- Autonomous routing or Skill/Routine creation
