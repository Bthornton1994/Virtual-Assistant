# Execution Economics Adapter v1

Status: **implemented as a bounded in-process adapter; not deployed to Production**

Vision alignment: **Aligns with constraints** — `VISION.md` sections *Capability sovereignty*, *Authority is explicit and bounded*, and *Quality assurance is part of delivery*. The adapter does not add action classes, receipts, customer-facing autonomy, or a second control plane.

## Why this adapter exists

PR #80 added the Outcome Economics Governor. This adapter puts that governor around real in-process calls. Native public-web `fetchPage` cannot run unless `evaluateAndReserve` allows it. It reuses Execution Context, Executor Envelope hashing, `authorizeToolClass`, `checkExecutionLease`, work-cell `getAssignment`, and complete/fail metadata key `economicReservationId`. It does not create a second budget, lease, planner, queue, evidence, receipt, or memory store. It does not add a provider SDK.

## Actual call boundary wired

| Call | Where | Adapter behavior |
| --- | --- | --- |
| Native public-web **tool** fetch | `prepareAuthorizedPublicWebEvidencePacket` → `runGovernedExecution` → `fetchPage(url)` | **Enforcing.** Envelope hash is checked against `binding.envelopeHash`. Frozen authority is re-derived and compared. `toolClass: "public_read"` is authorized inside `runGovernedExecution` before reserve. HTTP/timeout/abort `{error}` results throw, release, and record `fetch_failed` without committing. Missing economics fail closed. |
| Production native prepare | `runNativePublicWebPrepare` | **Enforcing** for the in-process fetch. Reads `getAssignment` for the prepare phase **before** bind, economics, and fetch. Packet existence is still checked and is not the sole pre-fetch gate. Trusted hash on this path is the frozen **input-manifest content hash**, not a plan hash. Lease stays null. |
| In-process **model** | `runGovernedExecution({ callKind: "model" })` | **Enforcing when the caller uses it** and supplies a trusted expected envelope hash. This repository has no LLM client. |
| In-process **executor process** | `runGovernedExecution({ callKind: "executor_process" })` | **Enforcing when used.** Economics presence does not authorize arbitrary process work. An explicit authorized `ToolClass` is required, or the combination is rejected. |
| Leased `completeExecutionAttempt` | `src/lib/execution-runtime-persistence.ts` | **Enforcing** only when the same process passes `economicsSession`. Refuses success while a reservation for that attempt remains `reserved`. **Advisory** without a session. |
| Leased `failExecutionAttempt` | same | **Enforcing** attempt-bound release when a same-process session and reservation id are present. A reservation for another attempt is not released. Ordinary fail without a session stays the existing path. |
| Off-box worker model/tool spend | not in this repo | **Advisory.** Process-local Maps cannot see another isolate. |

The governor still cannot issue Outcome Receipts or mark Workstream Runs verified.

## Guarantees in the call graph

Before `execute()`:

1. Validate Execution Context.
2. Validate the Executor Envelope and recompute `hashExecutorEnvelope`. Compare to a **trusted expected** envelope hash (`binding.envelopeHash` on the native path; an explicit `expectedEnvelopeHash` on `runGovernedExecution`). Do not hash a mutated envelope and treat that new hash as trusted. Generic callers without a trusted expected hash fail closed.
3. Re-derive frozen authority from the validated context, validated envelope, Delegation Spec snapshot, and the trusted hash pair on runtime (`inputManifestContentHash` and/or `canonicalPlanHash`). Compare the caller-supplied freeze to the re-derived value with canonical JSON. Weak frozen + weak proposed cannot pass the cheaper-route check.
4. For `callKind === "tool"`, require an explicit `ToolClass` and call `authorizeToolClass` inside `runGovernedExecution` before reservation. `toolKeys` are not tool classes. `credential_use` is rejected when it is outside the envelope.
5. For `callKind === "executor_process"`, require an explicit authorized tool class or reject. Do not invent a new authority class.
6. If a lease is presented, `checkExecutionLease(expected, presented, clock)` uses a **separate** trusted expected lease. A non-null lease without that expected identity fails closed. `TrustedExecutionRuntimeState` is not itself a source of lease trust. Native public-web keeps `lease: null`.
7. Build execution limits from trusted runtime + context, including `workCellPhaseAlreadyRecorded`.
8. A cheaper route cannot drop approval, independent review, evidence schemas, or raise action class. The comparison uses the **re-derived** freeze.
9. `evaluateAndReserve` runs **before** `execute()`.

Native catalog path: `inputManifestContentHash` is the frozen input-manifest content hash. `canonicalPlanHash` stays null. This slice does not invent an execution plan. Idempotency keys bind whichever trusted hash applies.

## After the call

- Valid provider usage commits.
- Failure, cancellation, timeout, abort, and native `{error}` fetch results release. They do not commit as successful usage.
- If `usageOnSuccess` throws **before** commit, the reservation is released and remaining budget is restored.
- Malformed, incomplete, stale, non-finite, contradictory, or over-reported usage that reaches `commitReservation` cannot commit (PR #80 fail-closed: NaN/Infinity stay reserved, no refund). Omitted token fields remain null; explicit `0` remains `0`. Cheap + null tokens consume the reserved amount rather than refunding.
- Duplicate commit/release stay idempotent on the existing governor keys.
- Fail-path release requires the reservation to exist, match session org/tenant, and match `reservation.executionAttemptId`.

## Native phase-recorded gate

`runNativePublicWebPrepare` calls `getAssignment(db, run.id, "prepare")` and `workCellPhaseAlreadyRecordedFromAssignment` **before** bind, economics reservation, and fetch. A prior failed, blocked, completed, or otherwise persisted prepare assignment blocks another fetch. Packet uniqueness remains and is not sufficient alone.

## Remaining limitations (not global serverless enforcement)

Reservations live in `EconomicsSession` Maps inside one Node isolate. Concurrent serverless requests, other workers, and a restarted process do not share remaining budget. Cross-request and off-box workers remain **advisory** unless a durable authorized seam exists.

**Concurrent native prepares are not closed.** Packet uniqueness and `(run_id, phase)` assignment uniqueness still reject a second persist. There is no existing atomic claim/lease primitive that prevents a second `fetchPage` before persist. `claim_execution_step` is the leased execution-attempt path, not work-cell prepare. This slice does not add a database primitive, a second store, or an in-memory mutex claimed as cross-request locking. Treat extra fetch-before-persist under concurrency as an unresolved design blocker. Do not describe unverified SQL as proven.

PR #79 remains a separate parked draft. This adapter does not modify it.

## Future durable-accounting requirement

A later authorized SQL seam must be separately designed, authorized, and runtime-verified. It should attach to existing `execution_attempts` and `evidence_artifacts` (`outcome-economics-evidence/v1`), not a second totals table. Remaining budget must be computed from committed artifacts plus open reservations. Executors still must not own that write. Until that seam exists and is verified against PostgreSQL, do not claim global enforcement.

## Out of scope

- Merging, deploying, or marking this PR ready.
- Provider rate cards or SDKs.
- Creating or modifying a Supabase account, project, branch, migration, database, or hosted environment.
- Contacting the live Delegation Cloud database.
- Changing PR #79 or unrelated PR metadata.
- Inventing an execution plan or a second plan store.
