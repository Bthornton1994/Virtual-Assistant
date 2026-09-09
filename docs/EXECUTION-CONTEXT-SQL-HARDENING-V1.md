# Execution Context SQL hardening v1

Status: **draft stacked on PR #78. No production migration applied.**

Vision alignment: **Aligns with constraints** — `VISION.md` “Security follows delegated authority.” This slice rejects more unbound or untraced staff writes. It does not add authority, receipts, Gauntlet semantics, tables, or columns.

## Why this is the fallback

TypeScript hashes observation traces with `canonicalJsonStringify` + `sha256Hex` + `hashToolInvocationTrace`. PostgreSQL `jsonb::text` is not that canonicalization. This environment has no live Postgres, so Node-versus-SQL fixture parity cannot be proven.

This migration therefore **does not recompute the canonical content hash in SQL** and must not be described as doing so. A 64-hex `content_hash` that matches a pointer is not proof that the stored payload is the hashed canonical bytes.

## Approved paths and remaining trust boundaries

| Path | Actor | What SQL proves | What remains outside SQL |
| --- | --- | --- | --- |
| `persistObservationArtifact` → `persist_tool_invocation_observation` | Authenticated staff (RLS) or `service_role` | Structural `tool-invocation-trace/v1` contract; `content_hash` is non-null 64-hex; `created_by` matches caller when authenticated; org/run bind; no worker/lease/token fields | Canonical hash of the payload. TS writes the digest. SQL does not recompute it. |
| Direct `INSERT` of `kind=observation` + `tool-invocation-trace/v1` | Authenticated | **Fail-closed.** Trigger rejects unless the approved GUC is set by the persist helper. | — |
| Direct `INSERT` of the same kind | `service_role` | Structural contract + 64-hex `content_hash`. Used by server-side runtime. | Same hash-binding limitation. |
| `record_work_cell_phase_artifact` | Authenticated (RLS) or `service_role` | Observation exists, same org/run, structural contract, production class valid for phase, pointers bind, `assignmentId` is 64-hex (not a persistence UUID), executor/capability/phase/org/run bind, capability active and qualified, authority cannot exceed the Delegation Spec, `mayOwnAuthoritativeState` is false, no worker/lease/token/secret fields. Authenticated consume requires `created_by = auth.uid()`. | Exact `stableWorkCellAssignmentId` derivation (canonical JSON + SHA-256) stays on TS `persistPhaseArtifact` / `translateWorkCellAssignment`. |
| `claim_execution_step` | `service_role` only | Worker/capability/lease shape; hashes are 64-hex; writes them once. | Canonical execution-step identity and envelope/context hashes stay on server `bindClaimedStep`. SQL does not independently derive them. |
| `complete_execution_attempt` | `service_role` only | Stored hashes required and matched; `assignmentId` 64-hex; observation structural contract; `productionClass = leased_executor_execution`; same org/run; lease not expired/cancelled/taken-over; empty/malformed traces rejected. Success does not create a receipt or verify a run. | Same claim-time hash derivation limitation. Stored hashes are never overwritten. |
| `fail_execution_attempt` | `service_role` only | Stored hashes required; caller metadata cannot overwrite them. **`p_allow_expired` exists** and is for the service-role reaper only (`reap_execution_leases` passes `true`). | Ordinary authenticated callers cannot execute this function (revoke + `current_user` check). They cannot set `p_allow_expired`. |

PR #78’s description said “No `p_allow_expired`.” The migration it shipped still defines `p_allow_expired boolean default false` and the reaper calls it with `true`. This follow-up documents the actual contract. Do not remove the parameter.

## What this does not do

- No new tables or columns.
- No second evidence, receipt, planner, lease, or memory store.
- No receipt or Gauntlet semantic change.
- No customer UI.
- No production Supabase apply.
- No claim that SQL independently recomputes `canonicalJsonStringify` or `stableWorkCellAssignmentId`.
