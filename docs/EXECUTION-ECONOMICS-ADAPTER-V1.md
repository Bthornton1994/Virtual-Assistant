# Execution Economics Adapter v1

Status: **implemented as a bounded in-process adapter; not deployed to Production**

Vision alignment: **Aligns with constraints** — `VISION.md` sections *Capability sovereignty*, *Authority is explicit and bounded*, and *Quality assurance is part of delivery*. The adapter does not add action classes, receipts, customer-facing autonomy, or a second control plane.

## Why this adapter exists

PR #80 added the Outcome Economics Governor. Until this slice, `evaluateAndReserve` was not called around a real model, tool, or executor invocation. PR #78 already authorized `public_read` before native `fetchPage`. This adapter puts the governor around that fetch, and around a generic in-process seam for model and executor-process calls.

It reuses the existing governor, Execution Context, Executor Envelope, Execution Runtime lease check, and complete/fail metadata key `economicReservationId`. It does not create a second budget, lease, planner, queue, evidence, receipt, or memory store. It does not add a provider SDK.

## Actual call boundary wired

| Call | Where | Adapter behavior |
| --- | --- | --- |
| Native public-web **tool** fetch | `prepareAuthorizedPublicWebEvidencePacket` → `fetchPage(url)` | **Enforcing.** `authorizeToolClass` still runs first. `runGovernedExecution` then `evaluateAndReserve` before `fetchPage`. Reject/hold/expired context/lease/limits/weakened authority do not fetch. Success commits; throw/abort/timeout releases. Missing economics fail closed. |
| Production native prepare | `runNativePublicWebPrepare` | **Enforcing** for the in-process fetch. Builds trusted limits, frozen authority, and a process-local session from the Delegation Spec envelope, frozen plan hash, and Execution Context. Does not accept attempt, deadline, or cancellation from executor input. |
| In-process **model** or **executor process** | `runGovernedExecution({ callKind: "model" \| "executor_process" })` | **Enforcing when the caller uses it.** This repository has no LLM client. Off-box leased workers that skip the adapter are not globally blocked. |
| Leased `completeExecutionAttempt` | `src/lib/execution-runtime-persistence.ts` | **Enforcing** only when the same process passes `economicsSession`. Refuses success while a reservation for that attempt remains `reserved`. **Advisory** without a session (serverless Maps are empty). |
| Leased `failExecutionAttempt` | same | **Enforcing** release when a same-process session and reservation id are present. Ordinary fail without a session stays the existing path. |
| Off-box worker model/tool spend | not in this repo | **Advisory.** Process-local Maps cannot see another isolate. |

The governor still cannot issue Outcome Receipts or mark Workstream Runs verified.

## Trusted inputs versus executor input

Before each governed call the adapter:

1. Validates Execution Context.
2. Builds `ExecutionLimitSnapshot` from trusted runtime + context (attempt, maxAttempts, deadline, work-cell phase-already-recorded, evaluation clock, cancellation).
3. Treats `assignment.deadline` as an expired context only when it is strictly after `createdAt` (work-cell native assignments currently freeze `deadline = createdAt`; the live deadline is the trusted runtime snapshot).
4. Binds frozen authority to the Delegation Spec version and canonical plan hash, copying action class, approval, independent review, evidence schemas, and `mayOwnAuthoritativeState: false`.
5. Takes proposed authority from the selected route. A cheaper route cannot drop approval, review, evidence, lease, or authority.
6. Requires an allowlisted escalation reason for expensive routing.
7. Calls `evaluateAndReserve` **before** `execute()`.

Executor-supplied attempt numbers, deadlines, clocks, cancellation flags, and authority snapshots are not accepted as the source of those values. Tests that pass a weakened proposed snapshot do so as an explicit control-plane override to prove rejection.

## After the call

- Valid provider usage commits.
- Failure, cancellation, timeout, or abort releases (or the governor expires the reservation when `now >= expiresAt`).
- Malformed, incomplete, stale, non-finite, contradictory, or over-reported usage cannot commit (PR #80 fail-closed). The adapter then refuses to treat the attempt as a successful completion while the reservation remains `reserved`.
- Duplicate commit/release stay idempotent on the existing governor keys.
- Reservation identity may be attached as `economicReservationId` on existing complete/fail metadata. Redaction still forbids prompts, completions, payloads, bodies, messages, and chain-of-thought.

## Process-local limitation (not global serverless enforcement)

Reservations live in `EconomicsSession` Maps inside one Node isolate. Concurrent serverless requests, other workers, and a restarted process do not share them. Completing an execution attempt from another request without passing that session cannot prove the spend was reserved.

This slice does **not** implement durable cross-request budget locking.

## Future durable-accounting requirement

A later authorized SQL seam must be separately designed, authorized, and runtime-verified. It should attach to existing `execution_attempts` and `evidence_artifacts` (`outcome-economics-evidence/v1`), not a second totals table. Remaining budget must be computed from committed artifacts plus open reservations. Executors still must not own that write. Until that seam exists and is verified against PostgreSQL, do not claim global enforcement.

PR #79 remains a separate draft SQL-hardening change. This adapter does not modify it, apply migrations, or contact hosted Supabase.

## Out of scope

- Merging, deploying, or marking this PR ready.
- Provider rate cards or SDKs.
- Creating or modifying a Supabase account, project, branch, migration, database, or hosted environment.
- Contacting the live Delegation Cloud database.
- Changing PR #79 or unrelated PR metadata.
