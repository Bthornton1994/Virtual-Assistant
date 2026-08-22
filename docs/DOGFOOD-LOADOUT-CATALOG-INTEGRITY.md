# Dogfood Workstream: Loadout Catalog Integrity v1

Status: **Step 3A active in dedicated QA**

Date: 2026-08-22

This document records the first portfolio workstream operated under the Delegation Cloud execution contract. It is an internal QA/dogfood exercise, not a customer tenant and not Production authorization.

## Purpose

Prove that Delegation Cloud can govern a real recurring business responsibility using:

`Delegation Spec → Workstream Run → Evidence → independent verification → Outcome Receipt`

without granting an agent broad repository, merge, publishing, or commercial authority.

The underlying Loadout workstream is defined in `Bthornton1994/Loadout` PR #20.

## Workstream

**Name:** Catalog Integrity

**Objective:** Produce a complete, reproducible integrity assessment of material Loadout catalog claims and prepare evidence-backed corrections while preserving explicit unknown/demo status when evidence is absent.

**Authority:** `prepare_only`

### Allowed

- read Loadout repository data and public sources;
- run deterministic integrity checks;
- classify claims by evidence status;
- collect source evidence;
- prepare evidence-ledger or catalog patches on a branch;
- prepare draft issues/PRs when explicitly requested.

### Not allowed

- merge to `main`;
- publish GitHub Pages changes;
- make a federation approval authoritative without evidence;
- turn estimated prices into live commercial quotes;
- turn demo ratings/performance values into factual claims;
- create/change affiliate or vendor relationships;
- communicate externally;
- spend money.

## QA identity

Dedicated internal QA organization slug:

`loadout-internal-qa`

Current QA workstream/spec identifiers are test-environment identifiers only and must not be copied into Production configuration.

## First process failure

The first setup run entered `awaiting_verification` before the machine-readable repository artifact existed.

Delegation Cloud did **not** retroactively treat that as complete. It received a failed Outcome Receipt with the exception that the run had frozen before required evidence was available.

This is a desired system behavior: a useful execution may still fail its contract.

## Clean retry result

The next run executed after the Loadout repository gate generated a machine-readable baseline artifact.

Measured catalog state:

| Measure | Result |
| --- | ---: |
| Products | 38 |
| Tracked claims | 271 |
| Verified claims | 0 |
| Stale claims | 0 |
| Unverified factual claims | 195 |
| Demo-only rating/performance claims | 76 |
| Commercial-ready products | 0 |
| Blocker-level integrity errors | 0 |

Loadout GitHub Actions run `32592598004` passed dependency installation, lint, typecheck, unit tests, artifact upload, and static-export build.

Baseline artifact digest:

`sha256:e6a399f9d87ee92ddb01df4228ea84adeeb3d3fc2085572ab915554cada7679c`

The clean retry received a **passing Outcome Receipt** with definition of done met. The QA score represents adherence to the baseline execution contract, not a claim that the catalog data itself is 100% accurate or commercially ready.

## Economic-data limitation

Human minutes, owner minutes, AI cost, and tool cost were not instrumented for this initial setup/baseline run. They remain recorded as zero with an explicit note that zero means **not measured**, not free execution.

Do not use this run for unit-economics conclusions.

Step 3B must add usable cost/coordination telemetry before the workstream can support claims about declining delivery cost.

## Promotion rule

Do not schedule or grant Grok Bot shadow-mode initiative from a single successful baseline.

At least one additional reviewed repository execution must:

1. reproduce the baseline or explain every legitimate delta;
2. emit the machine-readable artifact;
3. produce no unresolved blocker-level integrity issue;
4. preserve Loadout's reference/demo disclosures;
5. pass the full repository verification gate.

After that, Grok may enter **shadow/prepare mode only**. It still receives no merge, publish, external-communication, commercial, or spending authority.

## What Step 3B should measure

For each agent shadow run record:

- claims reviewed;
- candidate sources found;
- source acceptance rate;
- false-positive/incorrect-source count;
- ambiguous cases escalated;
- human review minutes;
- owner minutes;
- AI/model cost;
- tool cost;
- corrections required before acceptance;
- evidence status changes proposed;
- whether the deterministic audit agrees with the agent output.

The workstream earns additional autonomy only if review burden and correction rates fall while evidence quality remains stable or improves.
