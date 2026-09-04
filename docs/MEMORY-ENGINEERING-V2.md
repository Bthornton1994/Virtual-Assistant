# Memory Engineering v2: Delegation Cloud Memory Control Plane

Status: preview architecture and pure-code implementation on branch agent/memory-control-plane-v1

## Decision

Yes, Delegation Cloud should implement memory engineering as a platform capability.

It should not implement a generic "remember everything" feature, an unbounded transcript store, or a vector database that an agent can treat as truth. Delegation Cloud needs a governed memory control plane that sits between evidence, workstream execution, executors, and human authority.

This builds on the existing CS-11 Operational Memory Contract. It does not replace VISION.md, the Delegation Spec, the Executor Envelope, the Evidence Artifact plane, Outcome Receipts, the Gauntlet, or the capability registry.

The X post that prompted this work is useful as a design prompt, but the full article could not be retrieved directly from X in this review. The design below is therefore based on the indexed post excerpts and outline, the existing repository contracts, and independent memory and agent-security research. It does not claim that every detail is present in the post.

Sources:

- X post: https://x.com/0xWast3/status/2084625810112032849
- X article: https://x.com/0xWast3/article/2084625810112032849
- LoCoMo long-term memory benchmark: https://arxiv.org/abs/2402.17753
- MemGPT hierarchical context management: https://arxiv.org/abs/2310.08560
- MemoryGraft persistent memory poisoning: https://arxiv.org/abs/2512.16962
- Environment-injected memory poisoning: https://arxiv.org/abs/2604.02623
- Agent memory inside the harness: https://www.mongodb.com/company/blog/technical/agent-memory-inside-harness

## The problem we actually have

The repository currently contains two different things called memory:

1. operating_memory is a free-text, organization-level preference and guardrail record used by the application.
2. operational-memory/v1 is a typed, hash-bound candidate artifact with provenance, promotion, conflict, invalidation, and expiry functions.

The first is usable but under-modeled. The second is governed but is not yet persisted, retrieved, or connected to execution. Treating these as equivalent would create a false sense of completion.

The missing layer is a controlled read and write path.

## Core doctrine

Memory is not truth. Memory is a time-scoped, permission-scoped claim whose authority depends on its source, verification status, freshness, and scope.

Evidence remains the source of proof. A memory may summarize or index evidence, but it must retain the evidence references and must never outrank a newer authoritative source.

A run checkpoint is state, not memory. State allows a run to resume. Memory survives the run and may influence later work.

An executor may propose memory. It may not promote, invalidate, resolve conflicts, or grant memory authority to itself.

## Whiteboard

Customer outcome
  -> Delegation Spec
  -> bounded Workstream Run
  -> evidence and independent review
  -> Outcome Receipt
  -> memory candidate extraction
  -> deterministic validation and provenance binding
  -> human or authorized policy promotion
  -> scoped memory index
  -> task-specific memory compilation
  -> next Workstream Run

Every arrow is a control boundary. No arrow means "the model can write directly to the next layer."

## Memory classes

### Working memory

Run-bounded context, plan details, intermediate results, and checkpoints. It is not durable organizational knowledge.

### Operational memory

Verified facts about how a specific organization performs recurring work, including approved constraints and escalation rules.

### Entity memory

Verified facts about a customer, vendor, person, system, product, or other operational entity.

### Procedural memory

A versioned, tested method for recurring work. Procedural memory is never permission. The Delegation Spec and authority policy remain the permission source.

### Preference memory

An authorized preference, such as formatting or communication style, with explicit owner and organization scope.

### Historical memory

Past decisions, outcomes, exceptions, corrections, and failed approaches. Historical memory explains what happened; it does not automatically dictate what should happen now.

## The breakthrough: proof-carrying memory

The strongest version of this idea is not automatic personalization. It is proof-carrying memory.

A memory candidate should be extracted from a verified work result, an approved decision, a deterministic validation, or another explicitly accepted source. The candidate carries:

- the atomic claim;
- the structured value;
- source artifact references;
- organization and scope;
- observed and recorded timestamps;
- verification status;
- sensitivity;
- retention class;
- review or expiry deadline;
- stable memory identity and revision lineage;
- conflict-set membership;
- the approving authority where applicable.

This makes memory an operational learning product. The system learns from accepted delivery, not from an executor's private narrative or a plausible but unverified answer.

The compounding loop becomes:

verified outcome -> reusable candidate -> reviewed memory -> smaller future coordination burden -> measured repeat -> stronger playbook or bounded automation

If a memory does not reduce coordination, improve quality, reduce correction burden, or improve safe repeatability, it is not automatically valuable.

## Memory compiler

Every run receives a compiled memory context rather than an unrestricted memory dump.

The compiler must:

1. Validate the read request.
2. Enforce organization and scope boundaries.
3. Exclude invalid, expired, archived, and unresolved-conflict records.
4. Require verified memory in normal execution.
5. Allow candidate memory only in explicitly labeled shadow experiments.
6. Enforce sensitivity and data-scope policy.
7. Match requested subjects and memory kinds.
8. Prefer more specific scopes over broad scopes.
9. Prefer fresh records when authority is otherwise equal.
10. Detect contradictory values before selection.
11. Apply item and context-size budgets.
12. Return a hash-bound read receipt showing what was selected and why.
13. Preserve exclusion reasons for audit and debugging.

The compiler returns structured data. It does not generate hidden prose instructions. An adapter may serialize the result for a model, but the serialized context must preserve the distinction between verified facts, advisory candidates, source references, and unresolved uncertainty.

## Write and lifecycle model

Candidate -> verified -> retrieved

Candidate -> conflicted -> explicitly resolved

Candidate or verified -> expired

Candidate, verified, or conflicted -> explicitly invalidated

Terminal records -> archived through a separate retention process

A lifecycle transition creates a new immutable revision linked to the prior content hash. It does not mutate history in place.

Promotion requires an accountable approver or a separately authorized deterministic policy. Automatic promotion is not part of the first rollout.

Conflict resolution requires an explicit winner, an approver, a timestamp, a reason, and invalidation lineage for the alternatives. The system must never silently select the newest, most similar, or most frequently retrieved value when facts disagree.

## Memory record minimum

The implementation must be able to represent:

- memory identity and revision;
- kind;
- atomic claim and structured value;
- exact organization scope;
- specific scope kind and key;
- sensitivity;
- retention class;
- observed, recorded, review, expiry, and invalidation times;
- provenance and source artifact references;
- source run and assignment where relevant;
- verification and approval;
- conflict set;
- superseded content hash;
- content hash of the complete immutable revision.

The source artifact references must be checked against real artifacts at the persistence boundary. A syntactically valid reference is not proof that the artifact exists, belongs to the same organization, or supports the claim.

## Current CS-11 hardening identified by this review

The existing pure contract is a good start, but it needs the following refinements before it can be the system's memory authority:

- sensitivity and retention class are required for safe retrieval;
- revision and supersedes-hash lineage are required for immutable transitions;
- invalidation and expiry timestamps must be chronologically valid;
- working memory must remain run or assignment scoped;
- source kinds that require a run must carry one;
- conflict recording must reject duplicate memory IDs and identical values;
- unresolved conflicts must be blocked from retrieval and require explicit resolution;
- expired or conflicted records must not be treated as ordinary candidates;
- organization-wide "global" scope must not become cross-tenant scope;
- read compilation and read receipts must exist before memory affects execution;
- free-text operating memory must eventually be migrated into governed records or clearly labeled as legacy preferences;
- database persistence must bind records to real source artifacts and preserve append-only history.

## Red-team table

| Threat | Failure mode | Control |
| --- | --- | --- |
| Memory poisoning | A user, webpage, document, or executor plants a future instruction in memory. | Treat memory as untrusted input until validation and promotion; record provenance; never execute instructions merely because they were retrieved. |
| Cross-tenant bleed | A memory is retrieved for the wrong organization. | Organization-bound records, server authorization, RLS, exact scope checks, and cross-tenant tests. |
| Stale truth | A job change, vendor relationship, policy, or preference is no longer true. | Observed time, review date, expiry, supersession, freshness-aware retrieval, and explicit invalidation. |
| Contradiction collapse | The system silently chooses one of two competing facts. | Conflict sets, retrieval blocking, explicit resolution, and preserved loser lineage. |
| Privilege escalation | A procedural memory says to send, purchase, publish, merge, or change access. | Memory never grants authority; action class comes only from the Delegation Spec and policy engine. |
| Sensitive overcollection | The system stores private data because it might be useful later. | Sensitivity classification, minimum necessary capture, scope-limited retrieval, retention policy, deletion, and inspection. |
| Silent persistence | A casual conversation becomes permanent organizational knowledge. | Candidate state, explicit promotion, user-visible memory controls, and audit events. |
| Retrieval overexposure | The agent receives every memory instead of only what the task needs. | Required subject keys, allowed kinds, allowed scopes, context budgets, and read receipts. |
| Self-confirming loop | An agent writes a guess, retrieves it later, and treats its own guess as evidence. | Source artifact requirement, independent verification, candidate labeling, and no self-approval. |
| Prompt injection through memory | Stored text contains model-directed instructions or tool commands. | Structured values, typed fields, safe serialization, source labeling, and never treating retrieved text as authority. |
| Deletion failure | A user deletes a memory but it remains retrievable through a cache or embedding index. | Tombstones/invalidation, cache invalidation, index deletion checks, and deletion verification before calling the task complete. |
| Replay drift | A provider or embedding model changes and old work cannot be explained. | Hash-bound read receipts, provider/configuration provenance, model version metadata, and new qualification observations after changes. |
| Cost blowup | Retrieval, summarization, or consolidation adds more cost than it saves. | Read and write budgets, latency and token measurement, compaction metrics, and outcome economics. |
| False personalization | The system remembers low-value trivia while missing decisions and constraints. | Memory promotion policy prioritizes durable, consequential, reusable claims and measures retrieval usefulness. |
| Atomization loss | One-fact-one-line removes the context needed to interpret the fact. | Keep atomic claims but preserve source artifacts, scope, temporal metadata, and linked decision/outcome context. |

## What we will not build first

We will not begin with:

- a vector database as the source of truth;
- automatic promotion of every model-generated memory;
- permanent agent personas;
- cross-tenant shared memory;
- hidden chain-of-thought storage;
- a memory-driven permission system;
- broad automatic summarization of customer conversations;
- provider-specific memory as a required dependency;
- UI claims that the system learns or improves before measured evidence exists.

Embeddings may become an implementation detail of candidate discovery or retrieval. They are not an authority mechanism.

## Implementation stages

### Stage A: pure contract and compiler

This branch strengthens the CS-11 pure contract and adds deterministic memory-context compilation. It is provider-neutral, network-free, and independently testable.

### Stage B: QA persistence

Persist immutable memory revisions through a Delegation Cloud-owned data boundary. Bind each record to real organization-scoped source artifacts. Add RLS, append-only lifecycle events, deletion handling, and database proofs. Apply only to QA or a Supabase branch.

### Stage C: execution integration

Attach a compiled memory read receipt to a Workstream Run or Execution Attempt. The executor sees only the compiled context. The runtime records memory hashes and exclusion/block reasons. No memory read grants action authority.

### Stage D: proof and bakeoff

Run cold versus warm task pairs and compare:

- verified outcome rate;
- correction and exception rate;
- owner and human minutes;
- tool, model, and total cost;
- latency;
- stale-memory rate;
- contradiction rate;
- retrieval precision;
- unauthorized-memory incidents;
- cross-tenant leakage;
- deletion and expiry correctness.

Use at least two implementations or retrieval strategies before making routing or qualification claims. A benchmark result is evidence, not automatic promotion.

### Stage E: customer-facing memory

Expose inspect, correct, retire, export, and provenance views only after the underlying read and write controls pass. Customer-facing copy must describe what is actually retained and must never imply human-like memory or guaranteed learning.

## Go/no-go gates

Memory may influence a run only when:

- the memory request is bound to a Delegation Spec and organization;
- all selected memory is within scope and data policy;
- unresolved conflicts are absent;
- every selected record is valid and hash-bound;
- the read receipt is stored with the run;
- the executor remains unable to promote or authorize itself;
- audit and deletion behavior are verified;
- cold/warm evaluation shows a measurable benefit without unacceptable safety or privacy regression.

This is aligned with Delegation Cloud's existing doctrine: customer outcomes, explicit authority, proof-carrying work, independent review, measured economics, tenant isolation, and earned autonomy. It does not change any product boundary for Grounded, CareReserve, Manipulation Score, or Three White Lights.
