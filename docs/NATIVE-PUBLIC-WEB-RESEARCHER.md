# Native public-web researcher (prepare-only)

Status: **Implemented as a shadow, replaceable `evidence_research` executor. Not assigned to Runs 4–9. Not deployed to Production.**

Vision classification: **Aligns with constraints.**

Governing sections: Capability sovereignty; Authority is explicit and bounded (`prepare-only`); Manual first, automation after proof; Quality assurance is part of delivery.

## Why this exists

OpenBot remains a Hybrid/benchmark candidate behind a STOP on the unmodified `v0.0.4` pin. Founder-led catalog research cannot wait on that runtime.

Delegation Cloud therefore owns a native prepare-only implementation that:

- reads a frozen `catalog-evidence-input/v1` manifest;
- GETs only public `https` URLs already named in those records;
- returns an untrusted `catalog-evidence-packet/v1`;
- never clicks, types, submits, messages, purchases, or writes catalog state;
- always reports an all-zero authority report;
- escalates when identity or high-risk claims cannot be verified from retrieved text.

The existing deterministic validator remains the hard gate. This executor does not decide that a claim is verified.

## Executor identity

- key: `delegation-cloud-public-web-researcher-v1`
- kind: `agent` (networked prepare, not a deterministic validator)
- status: `shadow`
- provider: `delegation-cloud`

Register with `supabase/qa/public_web_researcher_executor_profile.sql` on Preview/QA only. Do not apply as a Production migration.

## Security

- `https` only, public hosts only.
- Loopback, RFC1918, link-local, and metadata addresses are refused.
- Redirects are followed at most three times and re-checked.
- Fetch is GET-only with a timeout and truncated body.
- Unit tests inject a fake fetcher and never open the network.

## Frozen Runs 4–9

Unchanged. Those attempts still freeze `hermes-loadout-researcher-v1` and `grok-loadout-reviewer-v1`. A later Gauntlet attempt may opt in by setting `prepareExecutorKey` to this native key.

## OpenBot

This does not lift the OpenBot STOP. OpenBot may later compete for the same `evidence_research` capability behind the same packet contract.
