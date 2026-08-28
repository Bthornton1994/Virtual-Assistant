# Capability Performance Review v1

CS-4 compares implementations from attributed performance evidence without turning comparison into routing or promotion.

The review policy is a pure, deterministic boundary. It consumes capability-performance-ledger/v1 observations, derives the existing ledger rows, and emits an evidence disposition:

- comparison_ready: the declared implementation and evidence thresholds are met;
- collect_more_evidence: evidence is incomplete or a non-authority threshold is not met;
- escalate_human_review: benchmark truth conflicts or an authority incident requires accountable review.

It never returns a winner, changes a qualification state, or grants execution authority.

## Input contract

A review request names:

- one registered capability key;
- one output contract version;
- a versioned policy;
- attributed capability-performance-ledger/v1 observations.

Each observation is parsed and hash-validated by the existing ledger schema before aggregation. The review rejects:

- observations for a different capability or contract;
- duplicate run/implementation/contract or assignment identities;
- malformed observations;
- invalid policy thresholds.

## Policy safeguards

A policy declares:

- minimum implementation count, at least two;
- minimum total runs, accepted outcomes, and benchmark-evaluated runs per implementation;
- minimum hard-gate pass rate;
- zero-authority-incident ceiling;
- maximum false-acceptance and false-rejection rates;
- maximum correction and rollback/retry rates;
- whether complete evidence is required.

Missing benchmark truth is incomplete evidence when the policy's benchmark minimum is not met. A null false-acceptance or false-rejection rate remains not-applicable when its benchmark denominator is zero; it is never silently treated as zero error.

If different implementations report different non-null benchmark truth for the same run, the review emits a human-review escalation. The policy does not guess which implementation is correct.

## Output boundary

The generated result is validated against a strict output schema and hash-bound. It is source-bound to:

- policy key and version;
- capability and contract;
- sorted implementation keys;
- per-implementation metrics and failure codes;
- benchmark-truth conflicts;
- deterministic review hash.

Every result states requiresManagerApproval: true and authorityGranted: false. A comparison-ready result is evidence for a later manager decision, not a routing instruction.

## Next gate

The performance ledger and review policy still require real stored evidence from at least two implementations for the same capability and contract. The next decision must be made by a manager after inspecting the immutable source artifacts, not by this module.

This slice does not start CS-5 context-provider adoption. That bakeoff remains gated on a demonstrated context-provider workstream and identical unseen tasks.
