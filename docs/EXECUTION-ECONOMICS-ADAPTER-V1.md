# Execution Economics Adapter v1

Status: **implemented as a bounded in-process adapter; not deployed to Production**

Vision alignment: **Aligns with constraints** — `VISION.md` sections *Capability sovereignty*, *Authority is explicit and bounded*, and *Quality assurance is part of delivery*. The adapter does not add action classes, receipts, customer-facing autonomy, or a second control plane.

## Why this adapter exists

PR #80 added the Outcome Economics Governor. This adapter puts that governor around real in-process calls. Native public-web `fetchPage` cannot run unless `evaluateAndReserve` allows it. It reuses Execution Context, Executor Envelope hashing, `authorizeToolClass`, `checkExecutionLease`, work-cell `getAssignment`, the existing `run_executor_assignments` unique `(run_id, phase)` slot as a pre-fetch claim, and complete/fail metadata keys `economicReservationId` / `economicReservationIds`. It does not create a second budget, lease, planner, queue, evidence, receipt, or memory store. It does not add a provider SDK.

## Implementation decision record (pre-fetch claim, batch accounting, trusted binding)

This slice closes three in-process holes against **existing** contracts. It does not add a second assignment table, a second lease table, a Skill registry, or a global economics ledger.

### Which existing durable contract closes the pre-fetch race

`claim_execution_step` is **not** used. Native public-web prepare has no `execution_plan` / `execution_plan_steps` row. This slice does not invent a fake plan.

The durable contract is the existing `run_executor_assignments` unique constraint on `(run_id, phase)`. Native prepare previously **read** that row (`getAssignment`) and only **wrote** it at persist time via `record_work_cell_phase_artifact`. Two concurrent requests could both observe no row, both `fetchPage`, and only collide at persist. Persist-time uniqueness does not close a pre-fetch race.

The claim is an INSERT of one `running` assignment into that same table, with no output artifact, **before** economics reservation and **before** the first `fetchPage`. PostgreSQL unique `(run_id, phase)` makes the insert the atomic claim. The loser receives unique-violation / already-recorded and fails closed without reserving and without fetching. Retries of a still-`running`, `completed`, `failed`, `planned`, or identity-mismatched row also fail closed. They are not treated as “same identity, continue fetching.”

Claim metadata binds: organization/tenant, run, phase, stable assignment identity, input-manifest content hash, executor key, capability key, envelope hash, and context hash. No worker/lease/token fields. No new table.

`record_work_cell_phase_artifact` is replaced **in place** (same signature, same tables) so a later packet/rejection persist **updates** that `running` row instead of inserting a second assignment. Operator paste ingest still inserts when no claim row exists. SQL is draft in-repo only: **SQL_VERIFICATION_NOT_AVAILABLE**.

Tests inject a claim function whose in-memory Map simulates the unique constraint. Production uses the durable INSERT. Call-graph order is claimed in `runNativePublicWebPrepare` source: `getAssignment` → `bindWorkCellPhase` → `claimWorkCellPhase` → economics bind → `prepareAuthorizedPublicWebEvidencePacket`.

### How batch reservation/accounting becomes truthful

Process-local `EconomicsSession` Maps cannot two-phase-commit with SQL. This slice therefore **does not commit before durable representation**:

1. **Reserve all URLs** (or skip fetch if any reserve rejects, releasing the ones that succeeded).
2. **Then fetch.** Fetch-level `{error}` / timeout / abort remains the existing partial-packet contract: that URL is released, `fetch_failed` is recorded, other URLs continue.
3. **Do not commit** inside the per-URL loop.
4. After a valid trace, persist observation + packet **or** persist a rejection artifact.
5. **Then commit** reserved observations whose outcome was represented. On persist failure, **release** remaining reserved IDs (do not commit-and-lose). Non-fetch failures (usage observer throw, postflight, packet validation, persist) release still-reserved IDs and must not silently drop earlier reservation IDs from metadata.

Assignment metadata stores **all** reservation IDs under `economicReservationIds`, and keeps `economicReservationId` as the last id for existing single-id readers. That is representation, not a second ledger.

If persist fails after fetch, spend is **not** committed. The durable `running` claim (when the DB path ran) still blocks another fetch. A later owner decision may add reclaim/timeout; this slice fail-closes.

### How generic callers obtain trusted binding provenance

`runGovernedExecution` no longer accepts an independently supplied `expectedEnvelopeHash`, freeze snapshot, and runtime tuple. Callers must pass a **factory-minted** `TrustedGovernedBinding`. Minting is process-local: a module `WeakSet` records objects created only by `mintTrustedGovernedBinding` / `bindNativePublicWebEconomics`. A lookalike object with matching 64-hex hashes is rejected. Hash equality is **not** cryptographic authenticity. A TypeScript cast is **not** authenticity.

The factory derives envelope, context, hashes, and frozen authority from assignment + Delegation Spec snapshot + input artifact refs (or from `bindWorkCellPhase`, which loads those from persistence). Native prepare mints only after loading the Workstream Run, frozen input manifest, executor profile, and Delegation Spec.

**Internal trust precondition:** there is no HTTP route that accepts raw hashes/snapshots and calls `runGovernedExecution`. The only production caller is native public-web prepare via `runNativePublicWebPrepare` → `prepareAuthorizedPublicWebEvidencePacket`. Generic in-process tests must mint. Off-box workers remain advisory.

This slice does **not** implement PR #83 Skill fields, nullable Skill columns, or a verification-command registry. Freeze-time Skill binding can later attach to the same minted binding without a second registry.

### What remains process-local or SQL-unverified

- Reservation Maps are still process-local. Cross-request economics remain advisory except for the durable **assignment claim** that blocks a second native fetch.
- The claim INSERT/UPDATE SQL is not runtime-verified against PostgreSQL in this change.
- RLS, concurrent two-session unique-violation behavior, and crash-restart reclaim are unverified.
- Committed process-local spend after a **successful** persist is represented on the assignment metadata in this process; a different isolate cannot see the Maps.

## Actual call boundary wired

| Call | Where | Adapter behavior |
| --- | --- | --- |
| Native public-web **tool** fetch | `prepareAuthorizedPublicWebEvidencePacket` → reserve-all `runGovernedExecution` → `fetchPage(url)` → persist → commit | **Enforcing.** Binding must be factory-minted. `toolClass: "public_read"` is authorized before reserve. HTTP/timeout/abort `{error}` results release that URL without committing and may return a partial packet. Missing economics fail closed. Commit is deferred until packet or rejection is persisted. |
| Production native prepare | `runNativePublicWebPrepare` | **Enforcing.** Reads `getAssignment` then **claims** `(run_id, phase)` before economics and fetch. Packet uniqueness remains and is not the sole pre-fetch gate. Trusted hash is the frozen **input-manifest content hash**, not a plan hash. Lease stays null. |
| In-process **model** | `runGovernedExecution({ callKind: "model" })` | **Enforcing when the caller uses a factory-minted binding.** This repository has no LLM client. Homemade hash tuples fail closed. |
| In-process **executor process** | `runGovernedExecution({ callKind: "executor_process" })` | **Enforcing when used.** Economics presence does not authorize arbitrary process work. An explicit authorized `ToolClass` is required, or the combination is rejected. |
| Leased `completeExecutionAttempt` | `src/lib/execution-runtime-persistence.ts` | **Enforcing** only when the same process passes `economicsSession`. Refuses success while a reservation for that attempt remains `reserved`. **Advisory** without a session. |
| Leased `failExecutionAttempt` | same | **Enforcing** attempt-bound release when a same-process session and reservation id are present. A reservation for another attempt is not released. Ordinary fail without a session stays the existing path. |
| Off-box worker model/tool spend | not in this repo | **Advisory.** Process-local Maps cannot see another isolate. |

The governor still cannot issue Outcome Receipts or mark Workstream Runs verified.

## Guarantees in the call graph

Before `fetchPage` on the native path:

1. Validate Execution Context from persisted spec/profile/manifest (`bindWorkCellPhase`).
2. Fail closed if a prepare assignment already exists (`getAssignment`).
3. **Claim** unique `(run_id, phase)` before reservation and fetch.
4. Mint `TrustedGovernedBinding` from that validated projection. Do not accept a caller-supplied envelope hash as trust.
5. Re-derive frozen authority from the minted contracts. Weak frozen + weak proposed cannot pass the cheaper-route check.
6. For `callKind === "tool"`, require an explicit `ToolClass` and call `authorizeToolClass` inside `runGovernedExecution` before reservation. `toolKeys` are not tool classes. `credential_use` is rejected when it is outside the envelope.
7. For `callKind === "executor_process"`, require an explicit authorized tool class or reject. Do not invent a new authority class.
8. If a lease is presented, `checkExecutionLease(expected, presented, clock)` uses a **separate** trusted expected lease captured at mint time. A non-null lease without that expected identity fails closed. Native public-web keeps `lease: null`.
9. Build execution limits from the minted runtime, including `workCellPhaseAlreadyRecorded`.
10. `evaluateAndReserve` runs for **every** URL **before** any `fetchPage`.

Native catalog path: `inputManifestContentHash` is the frozen input-manifest content hash. `canonicalPlanHash` stays null. This slice does not invent an execution plan. Idempotency keys bind whichever trusted hash applies.

## After the call

- Native multi-URL: valid usage **commits only after** observation/packet or rejection persistence.
- Failure, cancellation, timeout, abort, and native `{error}` fetch results release **that** URL. They do not commit as successful usage.
- If `usageOnSuccess` throws **before** commit, remaining reserved IDs are released.
- Malformed, incomplete, stale, non-finite, contradictory, or over-reported usage that reaches `commitReservation` cannot commit (PR #80 fail-closed: NaN/Infinity stay reserved, no refund). Omitted token fields remain null; explicit `0` remains `0`. Cheap + null tokens consume the reserved amount rather than refunding.
- Duplicate commit/release stay idempotent on the existing governor keys.
- Fail-path release requires the reservation to exist, match session org/tenant, and match `reservation.executionAttemptId`.

## Native phase-recorded gate

`runNativePublicWebPrepare` calls `getAssignment(db, run.id, "prepare")` and `workCellPhaseAlreadyRecordedFromAssignment` **before** bind, claim, economics, and fetch. A prior failed, blocked, completed, planned, or running prepare assignment blocks another fetch. After a successful claim INSERT, this request proceeds with `workCellPhaseAlreadyRecorded: false` because **this** claim owns the slot. Packet uniqueness remains and is not sufficient alone.

## Remaining limitations (not global serverless enforcement)

Reservations live in `EconomicsSession` Maps inside one Node isolate. Concurrent serverless requests, other workers, and a restarted process do not share remaining budget. Cross-request **fetch** is closed only by the durable assignment claim, not by the Maps. Off-box workers remain **advisory** unless a durable authorized economics seam exists.

PR #79 remains a separate parked draft. This adapter does not modify it. PR #83 remains a separate docs-only Skill-binding draft; this adapter does not copy it.

## Future durable-accounting requirement

A later authorized SQL seam must be separately designed, authorized, and runtime-verified. It should attach to existing `execution_attempts` and `evidence_artifacts` (`outcome-economics-evidence/v1`), not a second totals table. Remaining budget must be computed from committed artifacts plus open reservations. Executors still must not own that write. Until that seam exists and is verified against PostgreSQL, do not claim global enforcement.

## Out of scope

- Merging, deploying, or marking this PR ready.
- Provider rate cards or SDKs.
- Creating or modifying a Supabase account, project, branch, migration, database, or hosted environment.
- Contacting the live Delegation Cloud database.
- Changing PR #79, PR #82, or PR #83.
- Inventing an execution plan or a second plan store.
- Runtime Skill binding, nullable Skill fields, or a verification-command registry.
