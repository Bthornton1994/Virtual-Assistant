# Execution Economics Adapter v1

Status: **implemented as a bounded in-process adapter; not deployed to Production**

Vision alignment: **Aligns with constraints** — `VISION.md` sections *Capability sovereignty*, *Authority is explicit and bounded*, and *Quality assurance is part of delivery*. The adapter does not add action classes, receipts, customer-facing autonomy, or a second control plane.

## Why this adapter exists

PR #80 added the Outcome Economics Governor. This adapter puts that governor around real in-process calls. Native public-web `fetchPage` cannot run unless `evaluateAndReserve` allows it. It reuses Execution Context, Executor Envelope hashing, `authorizeToolClass`, `checkExecutionLease`, work-cell `getAssignment`, the existing `run_executor_assignments` unique `(run_id, phase)` slot as a pre-fetch claim, and complete/fail metadata keys `economicReservationId` / `economicReservationIds`. It does not create a second budget, lease, planner, queue, evidence, receipt, or memory store. It does not add a provider SDK.

## Implementation decision record (binding provenance, claim lifecycle, deferred commit)

This stacked slice closes three remaining in-process holes against **existing** contracts. It does not add a second assignment table, a second lease table, a Skill registry, a global economics ledger, or a new authority class.

### Finding 1 — close self-certified binding provenance

A module `WeakSet` of factory-created objects proved only that `runGovernedExecution` received an object the factory minted. It did **not** prove that factory *inputs* came from persisted Delegation Cloud state. A caller could construct assignment + Delegation Spec snapshot + Execution Context + envelope, hash them, call the exported factory, and execute.

This slice:

- Moves `mintTrustedGovernedBinding` to `src/lib/execution-economics-binding-internal.ts` and does **not** re-export it from `execution-economics-adapter.ts`.
- Seals native projections with a **module-private `Symbol`** (not `Symbol.for`) plus a WeakSet. `bindNativePublicWebEconomics` accepts only a `PersistedWorkCellProjection` sealed after work-cell persistence reads (`loadRun` / `getProfile` / `requireInputManifest` / `bindWorkCellPhase`) via `sealPersistedWorkCellProjectionFromWorkCellLoader`.
- Tests that need a native projection use the explicitly named `createPersistedWorkCellProjectionForTests` test double. That double is not a production route API.
- A structurally valid homemade binding or lookalike projection cannot reach `execute()` through the exported generic adapter path.

The internal-caller boundary is process-local “minted after loader.” It is **not** cryptographic authenticity, not a SQL proof, and not a global Map. HTTP routes must not import the internal module.

### Finding 2 — close stranded running claims

The pre-fetch claim INSERTs `running` before economics and fetch. A handled failure after that INSERT must not leave an unexplained `running` row. This slice uses the **existing** `run_executor_assignments` row:

- Handled post-claim failures call `fail_work_cell_phase_claim` (`running` → `failed`) with claim-failure metadata. Completed rows and accepted packets are not overwritten.
- A failed request does not fetch again on the same `(run_id, phase)`. Unique `(run_id, phase)` still blocks a second INSERT. Retry belongs to a new Gauntlet attempt (typically a new `run_id`).
- Crash-before-any-handler still leaves `running`. A second authenticated prepare may **reclaim** that row when `created_at` is older than the existing native prepare window (`NATIVE_PUBLIC_WEB_RESERVATION_TTL_MS`). If a **bound** accepted catalog packet exists for this claim, reclaim does **not** complete: economics commitment is unknown, the assignment stays `running`, and the result is explicit `OWNER_ACTION_REQUIRED`. Packet presence is not economics proof. If no bound packet, it fails the slot. Reclaim does not INSERT and does not fetch. Same-run retry stays fail-closed.
- Draft SQL `fail_work_cell_phase_claim` / `complete_work_cell_phase_claim` is the fail/complete path TypeScript calls. Direct assignment-status `UPDATE` is not authoritative. **SQL_VERIFICATION_NOT_AVAILABLE**.

Crash reclaim is bounded, authenticated (manager-only native prepare), and cannot allow two active fetches. It does not invent a second lease table.

### Finding 3 — deferred reservation finalization is all-or-none

Sequential `commitReservation` could commit URL 1 then fail URL 2, leaving mixed committed/reserved process-local state. `commitDeferredGovernedReservations` now snapshots in-process Maps (`remaining*`, `released*`, reservation states, commit maps) and restores every mutation in the batch if any commit fails. Assignment completion happens only after a successful all-or-none commit; commit failure cannot leave a successful assignment with an incomplete commit set. Rejection-path commit failure rolls back to reserved and then releases reserved IDs; it does not release already-committed spend as if it were still reserved.

Snapshot/rollback is **not** a SQL transaction. Process-local Maps remain process-local.

### Finding 4 — one authoritative fail/complete path, and the commit→complete crash window

PR #85 added draft SQL `fail_work_cell_phase_claim` / `complete_work_cell_phase_claim` while TypeScript still `UPDATE`d `run_executor_assignments` directly. Two implementations are not a control. This slice:

- Routes production TypeScript through those RPCs (`runNativePublicWebPrepare` → `failWorkCellPhaseClaim` / `completeWorkCellPhaseClaim` → `db.rpc(...)`). Direct status `UPDATE` is no longer the fail/complete path.
- Makes complete idempotent when the same `(run_id, phase)` identity is already `completed`, and refuses to complete a `failed` row.
- Refuses to fail a `completed` row or a running row that already has an accepted catalog evidence packet / output artifact.
- After packet persist, if economics commit fails: **do not** complete, **do not** fail. Leave `running`. Return `OWNER_ACTION_REQUIRED` with reservation IDs. Packet presence is not a committed usage event.
- After a **confirmed** same-process commit, complete the assignment via `complete_work_cell_phase_claim` with the exact bound identity. If complete fails, leave `running`, **do not** fail the accepted packet, and retry complete once in this isolate. A later isolate cannot assume that commit succeeded.
- Stale reclaim after TTL: if a **bound** packet/output exists for this claim, **block** (leave `running`, owner action). Do not complete. If no bound packet, `running` → `failed` without fetching.

Fail-closed fetch is unchanged: no second fetch for the same run/phase; failed, completed, or unrecoverable claims block fetch; reclaim never fetches.

**Crash window classification (OWNER_BLOCKED for remaining-budget reconstruction):** if the isolate dies after process-local `commitDeferredGovernedReservations` and before `complete_work_cell_phase_claim` returns, the Maps are gone. The durable packet may exist with a still-`running` assignment. Reclaim **must not** complete that assignment from `evidence_artifacts`. Packet/output evidence is not durable economics commitment. This slice does **not** reconstruct isolate-death economics. Process-local commits are not a durable economics event.

Exact durable seam still required, attached to existing contracts, **not** a new totals table:

- remaining budget from committed `evidence_artifacts`
- plus open reservations on existing `execution_attempts`

Until that seam exists and is runtime-verified against PostgreSQL, isolate-death economics stay **OWNER_BLOCKED**. Assignment claim/fail/complete handling in this process is closed; cross-process atomic finalization of spend is not.

### Finding 5 — packet persistence is not economics commitment

These states are explicit and must not be collapsed:

1. **Packet persisted** — a bound `catalog-evidence-packet/v1` artifact is durable on this claim (`output_artifact_id`).
2. **Economics commit succeeded** — `commitDeferredGovernedReservations` returned ok in this isolate. Maps are not a durable ledger.
3. **Assignment completion succeeded** — `run_executor_assignments.status = completed` after that confirmed commit and exact-identity RPC.
4. **Economics commit unknown after process death** — Maps are gone. A bound packet may exist. Do not assume commit succeeded.

A packet being present never proves economics commitment. `complete_work_cell_phase_claim` requires the exact bound identity fields already persisted on the claim (run, phase, assignment, output artifact, input-manifest content hash, envelope hash, context hash, executor, capability). It rejects an unrelated catalog packet on the same run.

Draft SQL: `supabase/migrations/20260910220000_work_cell_phase_claim_finalization_v1.sql` (prior fail/complete RPCs) and `supabase/migrations/20260910233000_work_cell_phase_claim_economics_safety_v1.sql` (bound-identity complete; no packet-as-economics). **SQL_VERIFICATION_NOT_AVAILABLE**.

## Implementation decision record (pre-fetch claim, batch accounting, trusted binding)

This prior slice closed three in-process holes against **existing** contracts. It does not add a second assignment table, a second lease table, a Skill registry, or a global economics ledger.

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

If persist fails after fetch, spend is **not** committed. Handled failures without an accepted packet mark the claim `failed`. After an accepted packet is durable, fail is forbidden: the assignment stays `running` until a **same-process confirmed commit** is followed by complete. Stale reclaim does **not** complete from packet existence. A crash-left `running` row still blocks another fetch. Same-run retry stays fail-closed.

Deferred commits are all-or-none in this process: a later commit failure rolls back earlier in-batch mutations so mixed committed/reserved state is not left behind. That rollback is not a SQL transaction.

### How generic callers obtain trusted binding provenance

`runGovernedExecution` no longer accepts an independently supplied `expectedEnvelopeHash`, freeze snapshot, and runtime tuple. Callers must pass a **factory-minted** `TrustedGovernedBinding`. Minting is process-local and lives on the internal module: a module-private Symbol plus WeakSet records objects created only by `mintTrustedGovernedBinding` (internal) / `bindNativePublicWebEconomics` after a sealed work-cell projection. A lookalike object with matching 64-hex hashes is rejected. Hash equality is **not** cryptographic authenticity. A TypeScript cast is **not** authenticity. A WeakSet or matching 64-hex is **not** authenticity of persisted DC state; the seal only means “this object was minted by the loader (or the named test double) in this process.”

The factory derives envelope, context, hashes, and frozen authority from a persistence-backed work-cell projection (validated Workstream Run, active Delegation Spec, frozen input manifest, registered executor profile, validated capability/authority, existing Execution Context and Envelope rules). Native prepare seals that projection only after those reads.

**Internal trust precondition:** there is no HTTP route that accepts raw hashes/snapshots and calls `runGovernedExecution`. The only production native caller is `runNativePublicWebPrepare` → sealed projection → `bindNativePublicWebEconomics` → `prepareAuthorizedPublicWebEvidencePacket`. Generic in-process tests import the internal mint explicitly. Off-box workers remain advisory.

This slice does **not** implement PR #83 Skill fields, nullable Skill columns, or a verification-command registry. Freeze-time Skill binding can later attach to the same minted binding without a second registry.

### What remains process-local or SQL-unverified

- Reservation Maps are still process-local. Cross-request economics remain advisory except for the durable **assignment claim** that blocks a second native fetch.
- The claim INSERT/UPDATE SQL is not runtime-verified against PostgreSQL in this change.
- RLS, concurrent two-session unique-violation behavior, and crash-restart reclaim against PostgreSQL are unverified.
- In-process snapshot/rollback of deferred commits is not a SQL transaction.
- Committed process-local spend after a **successful** persist and all-or-none commit is represented on the assignment metadata in this process; a different isolate cannot see the Maps.

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
4. Seal a persistence-backed work-cell projection, then mint `TrustedGovernedBinding` from that projection. Do not accept a caller-supplied envelope hash or a caller-built binding object as trust.
5. Re-derive frozen authority from the minted contracts. Weak frozen + weak proposed cannot pass the cheaper-route check.
6. For `callKind === "tool"`, require an explicit `ToolClass` and call `authorizeToolClass` inside `runGovernedExecution` before reservation. `toolKeys` are not tool classes. `credential_use` is rejected when it is outside the envelope.
7. For `callKind === "executor_process"`, require an explicit authorized tool class or reject. Do not invent a new authority class.
8. If a lease is presented, `checkExecutionLease(expected, presented, clock)` uses a **separate** trusted expected lease captured at mint time. A non-null lease without that expected identity fails closed. Native public-web keeps `lease: null`.
9. Build execution limits from the minted runtime, including `workCellPhaseAlreadyRecorded`.
10. `evaluateAndReserve` runs for **every** URL **before** any `fetchPage`.

Native catalog path: `inputManifestContentHash` is the frozen input-manifest content hash. `canonicalPlanHash` stays null. This slice does not invent an execution plan. Idempotency keys bind whichever trusted hash applies.

## After the call

- Native multi-URL: valid usage **commits only after** observation/packet or rejection persistence, and only as an all-or-none in-process batch. Assignment `completed` is written only after that commit succeeds.
- Failure, cancellation, timeout, abort, and native `{error}` fetch results release **that** URL. They do not commit as successful usage.
- If `usageOnSuccess` throws **before** commit, remaining reserved IDs are released.
- Malformed, incomplete, stale, non-finite, contradictory, or over-reported usage that reaches `commitReservation` cannot commit (PR #80 fail-closed: NaN/Infinity stay reserved, no refund). Omitted token fields remain null; explicit `0` remains `0`. Cheap + null tokens consume the reserved amount rather than refunding.
- Duplicate commit/release stay idempotent on the existing governor keys.
- Fail-path release requires the reservation to exist, match session org/tenant, and match `reservation.executionAttemptId`.

## Native phase-recorded gate

`runNativePublicWebPrepare` calls `getAssignment(db, run.id, "prepare")` and `workCellPhaseAlreadyRecordedFromAssignment` **before** bind, claim, economics, and fetch. A prior failed, blocked, completed, planned, or running prepare assignment blocks another fetch. A stale `running` claim may be reclaimed without fetching: if a bound accepted packet exists, leave `running` and return `OWNER_ACTION_REQUIRED` (economics unknown); otherwise fail. The resulting row still blocks retry on this run. After a successful claim INSERT, this request proceeds with `workCellPhaseAlreadyRecorded: false` because **this** claim owns the slot. Packet uniqueness remains and is not sufficient alone. Handled post-claim failures without an accepted packet mark `failed`. A stale running claim with a bound accepted packet is blocked for owner action, not completed. Completion requires the exact bound identity (run, phase, assignment, output artifact, input-manifest content hash, envelope hash, context hash, executor, capability) plus a confirmed process-local commit. An unrelated catalog packet on the same run cannot complete the current claim.

## Remaining limitations (not global serverless enforcement)

Reservations live in `EconomicsSession` Maps inside one Node isolate. Concurrent serverless requests, other workers, and a restarted process do not share remaining budget. Cross-request **fetch** is closed only by the durable assignment claim, not by the Maps. Off-box workers remain **advisory** unless a durable authorized economics seam exists. Isolate death after process-local commit and before complete is **OWNER_BLOCKED** for remaining-budget accounting.

PR #79 remains a separate parked draft. This adapter does not modify it. PR #83 remains a separate docs-only Skill-binding draft; this adapter does not copy it. This slice does not amend PR #85 or PR #86.

## Future durable-accounting requirement

A later authorized SQL seam must be separately designed, authorized, and runtime-verified. It should attach to existing `execution_attempts` and `evidence_artifacts` (`outcome-economics-evidence/v1`), not a second totals table. Remaining budget must be computed from committed artifacts plus open reservations. Executors still must not own that write. Until that seam exists and is verified against PostgreSQL, do not claim global enforcement.

## Out of scope

- Merging, deploying, or marking this PR ready.
- Provider rate cards or SDKs.
- Creating or modifying a Supabase account, project, branch, migration, database, or hosted environment.
- Contacting the live Delegation Cloud database.
- Changing PR #79, PR #82, PR #83, PR #84, PR #85, or PR #86.
- Inventing an execution plan or a second plan store.
- Runtime Skill binding, nullable Skill fields, or a verification-command registry.
