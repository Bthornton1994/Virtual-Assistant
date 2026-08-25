# Capability Performance Ledger v1

CS-4 defines a pure aggregation boundary for comparing implementations. It consumes attributed outcome evidence and returns rows keyed by capability, executor, and contract version. It does not write a score, promote an executor, or become an authoritative database table.

## Evidence inputs

Each observation must include:

- run, assignment, capability, executor, and contract identifiers;
- outcome status and deterministic hard-gate result;
- optional benchmark truth (`accept` or `reject`);
- authority-incident, evidence-completeness, correction, and rollback/retry flags;
- human intervention minutes, AI cost, tool cost, and latency;
- the evidence source and a SHA-256 source-artifact hash.

Malformed observations are rejected rather than repaired. Missing benchmark truth produces `null` false-acceptance and false-rejection rates. It is not treated as a zero-error result.

## Derived metrics

Rows include run counts, hard-gate and accepted-outcome rates, benchmark false-acceptance and false-rejection rates, authority incidents, evidence completeness, correction and rollback/retry rates, human intervention, AI/tool/total cost, cost per accepted outcome, median latency, and p95 latency.

Rows are sorted by capability key, contract version, and executor key. The aggregation is deterministic for the same observations.

## Authority boundary

The ledger must consume validator or human-QA evidence. An executor must not write its own authoritative performance score. This module has no Supabase client, no network call, and no integration with the current Step 3D assignments.

## Next gate

Before this ledger is used for qualification or routing, the control plane needs a persisted evidence adapter that preserves source hashes, an explicit benchmark suite, and a review policy for conflicting or incomplete observations.