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

The ledger must consume validator or human-QA evidence. An executor must not write its own authoritative performance score. The pure module has no Supabase client, network call, routing behavior, or promotion behavior.

The persisted adapter is deliberately narrower than a score table. It reads the frozen manifest, typed packet/review/validation artifacts, and real completed phase assignments; verifies their hashes and bindings; derives observations through the pure module; and writes exactly three immutable observation artifacts while the run is still running. The database RPC binds each observation to the same run, a real completed assignment, and an existing typed source hash. A partial or duplicate write is rejected. The existing evidence trigger freezes these observations before submission.

Owner minutes and benchmark truth are not inferred into this v1 ledger. Benchmark truth remains null unless a separate validator or human-QA artifact supplies it. Missing timestamps, hashes, assignments, or bindings fail closed.

## Next gate

Before this ledger is used for qualification or routing, the control plane needs an explicit benchmark suite, a review policy for conflicting or incomplete observations, and enough accepted runs to compare at least two implementations. Persisting an observation does not qualify or promote an executor.