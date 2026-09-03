# Execution Runtime v1

Status: **implemented as a bounded control-plane foundation; not deployed to Production**

## Breakthrough

Auto-Company demonstrates a useful operational loop: wake, choose a small team, execute toward a concrete artifact, preserve a cross-cycle handoff, recover from transient failure, and expose operator controls. Its public implementation is a local daemon around CLI agents, not evidence of production-grade unattended autonomy. See the [Auto-Company README](https://github.com/MaxMiksa/Auto-Company), [loop](https://github.com/MaxMiksa/Auto-Company/blob/main/scripts/core/auto-loop.sh), and [team skill](https://github.com/MaxMiksa/Auto-Company/blob/main/.claude/skills/team/SKILL.md).

The Delegation Cloud extraction is therefore:

> A sovereign outcome runtime that keeps a bounded workstream alive, routes each stage to a qualified implementation, records leases and evidence, stops at authority boundaries, and learns only from verified delivery.

This is an execution-plane addition to Delegation Cloud. It does not replace the Delegation Spec, capability registry, executor envelope, Workstream Run, evidence artifacts, Outcome Receipt, specialist pipeline, operational memory, or Gauntlet.

## Capability extraction

| External pattern | Delegation Cloud-owned capability |
| --- | --- |
| Continuous wake loop | Durable plan and queue lifecycle with claim, heartbeat, timeout, cancellation, and replay |
| Cross-cycle `consensus.md` baton | Typed, hash-bound plan state and durable queue-refresh events |
| Dynamic 2-5 agent squad | Smallest qualified capability set selected by the existing router |
| Forced convergence | Dependency graph, Definition of Done, attempt budget, deadline, and explicit stop state |
| Claude/Codex engine switch | Replaceable runtime adapter boundary with executor configuration provenance |
| Rate-limit and circuit-breaker handling | Bounded retry policy, backoff, expired-lease reaping, and blocked escalation |
| Local start/stop/status dashboard | Delegation Cloud operator control plane over queue, evidence, approvals, economics, and exceptions |

The runtime stores implementation names as provenance. It never makes a provider, model, CLI, agent framework, or local machine the source of authority or product truth.

Claims are capability-scoped: a worker may claim only the capability it presents, and
the database requires an active `executor_profiles` row plus an active capability with
a `qualified` `executor_capabilities` mapping. An unqualified, suspended, shadow, or
retired implementation receives no work.

## State model

### Plan

An `execution_plan` belongs to exactly one organization, Workstream Run, and Delegation Spec version. It is proposed first and becomes immutable in contract content when frozen. Its canonical plan hash binds:

- organization, run, Delegation Spec identity, and both plan/spec versions;
- objective and authority class;
- data-policy snapshot;
- ordered stages and dependencies;
- input and output contract versions;
- approval and side-effect declarations;
- attempt budgets and deadlines.

The database also rejects a plan whose authority class exceeds the active
Delegation Spec's action-class ceiling, even if the caller is operations staff.

### Stage

An `execution_plan_step` is a bounded capability request with a hard deadline. A step can be:

`pending -> ready -> leased -> running -> awaiting_approval -> awaiting_verification -> succeeded`

or it can become `blocked`, `failed`, or `cancelled`. A retry returns the stage to `ready` with a new append-only attempt. It never overwrites the previous attempt.

The database and runtime reject:

- dependency cycles;
- unknown dependencies;
- duplicate stage keys or sequence numbers;
- stages above the plan's authority ceiling;
- external or sensitive actions without approval;
- any executor claiming authoritative state ownership;
- work whose dependencies have not succeeded.
- work whose deadline has elapsed; expired work is blocked and escalated rather than run late.

### Attempt and lease

An `execution_attempt` records the executor, configuration snapshot, authority snapshot, context hash, economics, failure classification, and output artifact references. A lease is bound to:

- one attempt;
- one stage;
- one worker identity;
- one hash of a lease token;
- one expiration time.

Heartbeats and completion require all of those values to match and require the lease to remain live. The plaintext token is never stored.

### Events

`execution_events` is append-only operational history. It records plan, stage, lease, heartbeat, approval, retry, failure, cancellation, and completion events. Event metadata is an audit projection, not hidden reasoning or a substitute for evidence.

## Worker boundary

`src/lib/execution-runtime-persistence.ts` is the server-only bridge. It exposes
plan creation/freeze/cancel, queue refresh, claim, heartbeat, completion, failure,
lease reaping, and approval decisions. It hashes ephemeral lease tokens before the
RPC call and uses the existing `supabaseAdmin` project-ref guard. An adapter still
has to construct and validate the existing Executor Envelope and Result contracts;
the runtime cannot turn an arbitrary CLI, model, or website scrape into an approved
executor.

## Recovery policy

Retries are determined by deterministic policy, not by a worker's confidence:

| Failure class | Default response |
| --- | --- |
| Security incident | Stop the Workstream Run, block the plan, and require human review |
| Authority, policy, source ambiguity, or cost limit | Block and escalate to a human |
| Business strategy failure | Block and re-plan |
| Bad input | Correct inputs before retry |
| Evidence or QA failure | Retry with a different qualified executor when budget remains |
| Executor, integration, or external dependency failure | Retry with bounded backoff when budget remains |
| Unknown failure | Block and require classification |

The attempt budget is finite. Backoff is deterministic and capped. Exhausted attempts become terminal failures rather than an infinite autonomous loop.

## Red-team findings and countermeasures

### 1. A worker performs an unauthorized side effect

**Countermeasure:** plan and stage records carry action class, data sensitivity, approval requirement, and `mayOwnAuthoritativeState = false`. Database checks reject unapproved external or sensitive steps. Runtime v1 schedules work but does not itself grant a connector, credential, send, purchase, publish, commit, deployment, or access-change capability. A classified security incident fails the Workstream Run closed so sibling plans cannot continue claiming work.

### 2. A stale worker completes after another worker reclaimed the job

**Countermeasure:** completion and heartbeat are lease-token and worker-bound. Expired leases are reaped into a new attempt. A stale token cannot mutate the current attempt.

### 3. A stage is claimed after its SLA deadline

**Countermeasure:** the queue excludes expired stages, refresh blocks pending/ready/approval-held stages at the deadline, and heartbeat/completion reject a late lease. A reaper classifies a late running attempt as a cost/deadline escalation instead of extending it.

### 4. Two workers process the same stage

**Countermeasure:** the claim operation locks the queue row with `FOR UPDATE SKIP LOCKED`, creates the attempt, and updates the stage in one transaction. The stage and attempt identities are unique.

### 5. A dependent stage runs early

**Countermeasure:** readiness is derived from dependency status. A stage is not claimable until every dependency is `succeeded`. Failed, blocked, or cancelled dependencies block descendants.

### 6. A worker retries forever or silently repairs a failed result

**Countermeasure:** every retry has a persisted attempt, classification, decision, and maximum. A failed artifact remains evidence. The same stage is never silently overwritten.

### 7. A tenant crosses an organization boundary

**Countermeasure:** every runtime table carries `organization_id`, composite organization-consistent foreign keys, indexes for tenant predicates, and RLS. The server layer verifies actor access before calling runtime operations. Runtime detail remains staff-only until a deliberate customer-safe projection exists.

### 8. A plan is changed after execution starts

**Countermeasure:** the plan hash and contract fields are immutable after freezing. A new plan version is required for a materially different objective, authority envelope, dependency graph, or executor contract.

### 9. A worker reports success without proof

**Countermeasure:** executor success is not Outcome Receipt success. The runtime only records output references. Existing deterministic validators, independent review, evidence artifacts, receipt guards, and Gauntlet rules remain responsible for verification.

### 10. A model or CLI leaks credentials through prompt or event data

**Countermeasure:** runtime records credential references and configuration provenance only. It does not store secrets or plaintext lease tokens. Adapter implementations must enforce the existing execution context and approved data policy before invocation.

### 11. State rollback is mistaken for side-effect rollback

**Countermeasure:** cancellation, failure, and plan rollback only control future runtime transitions. They do not claim to undo an external action. External execution remains separately approved, receipt-backed, and reversible only where the connector itself supports verified reversal.

### 12. A synthetic fallback is mistaken for a real result

**Countermeasure:** blocked, inconclusive, and unavailable are first-class results. The runtime does not convert stubs, example URLs, missing artifacts, or unexecuted adapters into a successful receipt.

### 13. Autonomy is promoted because the loop is busy

**Countermeasure:** activity is not success. The Gauntlet remains the authority for verified completion, business impact, failure history, and earned autonomy. Runtime v1 has no automatic autonomy promotion.

### 14. An operator rewrites the runtime history

**Countermeasure:** `execution_events` is append-only at the database trigger boundary. Corrections are new events or new attempts; prior claim, failure, approval, and completion records are not edited in place.

## Deliberate exclusions

The following Auto-Company behaviors are not imported:

- bypass-permission or full-access defaults;
- no-human-approval operation;
- permanent persona rosters;
- all-MCP or unrestricted tool exposure;
- arbitrary repository, deployment, installation, or infrastructure authority;
- Markdown as the authoritative state store;
- hidden chain-of-thought persistence;
- assuming a shared local host is a security boundary.

The Auto-Company repository displays an MIT badge in its README, but this implementation does not copy its code. Any future code reuse requires a separate license and supply-chain review.

## Safe rollout gate

The first runtime exercise must be a prepare-only internal or QA workstream:

1. Apply the migration to QA only.
2. Create a plan against an active Delegation Spec and an already-running Workstream Run.
3. Freeze the plan and confirm the canonical hash.
4. Claim one stage with two competing workers and confirm only one lease succeeds.
5. Expire the lease and confirm the stale worker cannot heartbeat or complete.
6. Complete the replacement attempt and confirm dependent-stage readiness.
7. Inject each red-team failure class and verify the deterministic response.
8. Attach real evidence, run existing validation, and preserve the Outcome Receipt gate.
9. Measure latency, owner minutes, human minutes, AI cost, tool cost, retry rate, and exception rate.

No Production deployment, external communication, purchase, catalog mutation, repository mutation, or autonomy promotion is implied by this runtime foundation.
