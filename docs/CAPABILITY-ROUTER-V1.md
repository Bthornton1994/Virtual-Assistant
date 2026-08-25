# Capability Router v1

CS-3 starts with a pure, deterministic policy function. It records why an implementation was selected or why the request was blocked. It does not read or write Supabase, mutate assignments, call a provider, or grant authority.

## Eligibility policy

For a requested capability, contract pair, authority class, and data-sensitivity class, the policy filters:

- unregistered or inactive capabilities;
- non-qualified, suspended, or unhealthy implementations;
- input or output contract mismatches;
- implementations whose authority or data-sensitivity ceiling is too low;
- implementations over the cost ceiling or latency SLA.

Automatic selection is deterministic: estimated cost, then estimated latency, then executor key. The decision includes the eligible keys and every rejection reason, making the result reproducible from its input.

## Manual pinning

A manual executor pin is honored when it is eligible, even if another implementation is cheaper. An ineligible manual pin blocks the request rather than silently falling back to another executor. This preserves incident recovery and experimental repeatability.

## Frozen work-cell boundary

This module is not wired to the Step 3D work cell. The Hermes, Grok, and native validator assignments remain frozen. A future adapter must explicitly translate a non-frozen assignment into a router request; capability lookup must not override a frozen executor key.

## No autonomous authority

The router returns a decision artifact. It does not create a run, select credentials, invoke a model, update qualification, or make the decision authoritative. Those actions remain outside this module and require the existing Delegation control plane.

## Exit evidence still required

CS-3 is policy scaffolding, not proof that routing should be enabled in production. Before enabling it for a live workstream, the repository needs stored qualification evidence, a reproducible comparison of at least two implementations, and an explicit adapter that preserves manual pinning.