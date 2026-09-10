# Outcome Economics Governor v1

Status: **implemented as a bounded control-plane slice; not deployed to Production**

Vision alignment: **Aligns with constraints** — `VISION.md` sections *Capability sovereignty*, *Authority is explicit and bounded*, and *Quality assurance is part of delivery*. The governor is a Delegation Cloud-owned economic control, not an executor, bot, or vendor rate card. It does not send, purchase, publish, merge, or change customer-facing autonomy.

## Why this is a governor, not a bot

A Token Officer-style review of agent token usage is useful. Delegation Cloud already owns Delegation Specs, frozen plans, Workstream Runs, Executor Envelopes, Execution Context, leases, evidence artifacts, Gauntlet validation, Outcome Receipts, capability routing, the economic envelope, and usage telemetry. Another autonomous watcher would be a second control plane.

This module is a deterministic policy function plus an in-process reservation ledger. Callers that perform a real model, tool, or executor invocation must go through `runGovernedExecution` (`docs/EXECUTION-ECONOMICS-ADAPTER-V1.md`). The governor itself:

- evaluates spend before an expensive executor call;
- reserves, commits, and releases budget against the existing economic envelope;
- records redacted economic evidence bound to an execution attempt;
- derives cost-per-verified-outcome metrics only after an independently verified receipt.

It does not wake itself, choose work, talk to a provider, write Workstream Run state, or declare success.

## What it may decide

| Decision | Meaning |
| --- | --- |
| Allow and reserve | Remaining envelope covers the estimate; loop/storm gates passed. |
| Downgrade | Expensive work lacks usage or pricing, and a cheaper eligible tier exists. Authority, review, and evidence requirements cannot be weakened. |
| Hold | Usage accounting is incomplete or a stream ended before usage returned. No reservation is taken; execution must not proceed. |
| Reject | Budget exceeded, expensive usage unavailable with no cheaper tier, unknown expensive pricing with no cheaper tier, retry storm, no-progress loop, expired clock, tenant mismatch, exhausted attempts, missed deadline, already-recorded work-cell phase, or forbidden telemetry. |
| Commit | Provider-reported usage is reconciled against the reservation. |
| Release | Unused reservation returns to remaining budget. |
| Escalate tier | Only with an allowlisted, explainable reason. It does not pick a vendor or model id. |

## What it may never decide

- Workstream Run, lease, evidence, or Outcome Receipt lifecycle.
- Gauntlet verdicts or Definition of Done.
- Provider, model, credential, or runtime selection beyond a cheap/expensive/deterministic tier.
- Autonomy increases, Skill promotion, or routing qualification.
- External actions: send, purchase, publish, deploy, merge, or permission changes.
- Whether an executor's self-declared completion is an accepted outcome.

Cursor, Grok, Claude, Codex, Hermes, humans, and future runtimes remain replaceable executors. They are not the economic authority.

## Budget reservation and reconciliation

1. `evaluatePreExecutionBudget` fail-closes on isolation, clock, telemetry, loop, and envelope checks.
2. `evaluateAndReserve` deducts estimated AI and tool micros from the in-process remaining envelope.
3. `commitReservation` consumes observed cost when usage and caller-supplied pricing exist.
4. Cheap under-reservation refunds unused micros. Expensive under-reporting does not refund; missing reasoning or cache accounting cannot commit.
5. Over-reporting above the reservation is rejected; the reservation stays held until expiry or release.
6. `releaseReservation` returns unused reserved micros. Commit and release are idempotent on the caller idempotency key.
7. When `now` is at or after `expiresAt`, reserved micros return and commits fail closed.
8. Malformed or non-finite usage (NaN, Infinity, negatives, fractions, unsafe integers, numeric strings, booleans) fail closed. Optional usage fields may be null; a present value must be a finite non-negative safe integer. Invalid usage does not commit, refund, or alter remaining budget.

Pricing is supplied by the caller as micros per token and per tool call, with an optional quote timestamp. Stale or future-dated quotes are treated as unknown pricing. Token-derived cost and billed micros must agree; disagreement is untrusted and cannot commit. This slice contains no provider SDK and no hardcoded vendor rate card.

The governor also consumes existing execution-runtime ceilings when the caller supplies them: `maxAttempts`, the evaluation clock versus `deadlineAt`, and a work-cell phase-already-recorded flag. A cheaper selected tier cannot drop frozen human approval, independent review, or required evidence schemas, and cannot raise the action class above the Delegation Spec.

## Red-team notes

| Attack | Governor response |
| --- | --- |
| Token counts disagree with billed micros | Fail closed; neither figure is trusted until they match. |
| Hidden reasoning or cache tokens on expensive work | Cannot commit. |
| Stream ends before usage | `hold`; no reservation. |
| Duplicate commit / retry billed twice | Idempotent commit returns the first reconciliation. |
| Parallel reservations in one process | Remaining envelope decreases before the second reserve. |
| Provider/model switch to expensive around cheap routing | Reject. |
| Changing prompts, same tools/step | Same loop fingerprint. |
| Progressed retry or different tool keys | Not a no-progress fail-close. |
| Cheap fail then expensive with budget left | Escalation allowed with an explicit reason. |
| Stale or manipulated pricing quote | Unknown pricing / cannot commit. |
| Malformed or non-finite usage | Fail closed; reservation stays reserved; remaining budget is unchanged. |
| Forged economic evidence | Content-hash mismatch rejected. |
| Prompt injection / bypass keys | Reject. |
| Governor as an LLM | The module is pure TypeScript policy with no provider client. |

## Cost per verified outcome, not token minimization

Raw token count is the wrong objective. A cheap model that fails and forces expensive rework can cost more than one expensive pass that verifies. Derived measurements are:

- estimated cost;
- actual observed cost when usage is reported;
- reserved versus consumed budget;
- retry and rework cost;
- cost per accepted Outcome Receipt;
- first-pass verification rate;
- expensive-escalation yield;
- wasted execution percentage.

`deriveVerifiedOutcomeEconomics` accepts ledger outcome sources `deterministic_validator` and `human_qa` only. An executor, agent review, or self-declared completion cannot mark economic success. That matches the Capability Performance Ledger: the ledger may learn only from independently verified outcomes.

## Existing contracts reused

| Contract | Use |
| --- | --- |
| `economic-envelope` | Numeric ceilings; post-commit `checkEconomicEnvelope`. |
| `capability-performance-ledger` | `LEDGER_OUTCOME_SOURCES`; cost-per-accepted-outcome meaning. |
| `catalog-evidence-hash` | Canonical SHA-256 for reservation ids, loop fingerprints, and evidence hashes. |
| `model-provider` `ModelUsage` | Provider-neutral token totals; not a router. |
| `executor-envelope` economic limits | Same micros vocabulary. |
| `execution-runtime-persistence` complete/fail metadata | Redaction gate only. |
| `evidence_artifacts` / Outcome Receipts | Future persistence target; this slice emits a hash-bound payload. |

No new database table is added. Reservations bind to `executionAttemptId`, `assignmentId`, `runId`, organization, and tenant in memory.

## Enforcement versus advisory

| Path | Status |
| --- | --- |
| `evaluateAndReserve` / `commitReservation` / `releaseReservation` | **Enforcing** when a caller invokes them. |
| Telemetry key and bypass/injection checks | **Enforcing** in the governor and on execution-attempt complete/fail metadata. |
| Attempt, deadline, and work-cell limits | **Enforcing** when `executionLimits` is supplied; the adapter always supplies them from trusted runtime/context. |
| Authority freeze on cheaper routes | **Enforcing** when frozen and proposed snapshots are supplied; the adapter always supplies them. |
| Native public-web `fetchPage` via `runGovernedExecution` | **Enforcing** in-process. Missing economics fail closed. See `docs/EXECUTION-ECONOMICS-ADAPTER-V1.md`. |
| Same-process `completeExecutionAttempt` with `economicsSession` | **Enforcing**: success cannot complete while a reservation remains `reserved`. |
| Existing `claimExecutionAttempt` / complete / fail without a session | **Advisory**. Serverless requests do not share this in-memory session. |
| Off-box leased worker spend that skips the adapter | **Advisory**. Process-local Maps are not global serverless enforcement. |
| Capability router, Gauntlet, receipts | **Unchanged**. The governor still cannot issue receipts or mark runs verified. |
| SQL remaining-budget locks | **Not present**. Concurrent safety is proved only inside one process. |

## What remains unverified without disposable PostgreSQL

This slice does not claim PostgreSQL runtime verification. There is no authorized disposable database in this change, and the live Delegation Cloud Supabase project was not contacted.

Unverified until a later SQL slice:

- durable reservations across processes;
- row-level concurrent reservation under transaction isolation;
- binding economic evidence rows to `execution_attempts` and `evidence_artifacts` in QA;
- replay after restart.

## Future SQL without a second source of truth

If a later authorized migration persists this governor, it should attach to existing attempts and evidence, not create a parallel ledger:

1. Store reservation and commit payloads as `evidence_artifacts` with `schemaVersion = outcome-economics-evidence/v1` and the existing content-hash freeze.
2. Optionally add reservation columns or an RPC on `execution_attempts` that references that artifact hash.
3. Keep `checkEconomicEnvelope` as the verified-run ceiling already enforced at Outcome Receipt time.
4. Remaining budget must be computed from committed artifacts plus open reservations for that run, not from a second totals table an executor can write.
5. Do not let an executor RPC mark `accepted` economics; only validator or human-QA receipts already accepted by the control plane may feed the performance ledger.

Until that migration exists, the TypeScript session is the only reservation ledger, and it is process-local.

## Out of scope

- PRs #78 and #79, existing migrations, and hosted Supabase.
- Provider SDKs, hardcoded pricing, customer UI, messaging, purchasing, deployment, merge, or permission changes.
- A new Software Factory planner, bot, or evidence store.
