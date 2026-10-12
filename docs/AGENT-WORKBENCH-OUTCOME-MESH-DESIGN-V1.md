# Agent Workbench / Outcome Mesh Design v1

Status: **Phase 0 design and red-team. Docs only. Not an implementation plan that authorizes code, merge, deploy, or Production writes.**

Date: 2026-09-08

Vision alignment: **Aligns with constraints.**

Governing sections of `VISION.md`:

- *Capability sovereignty* — own intent, authority, execution contracts, evidence, verification, lifecycle, economics, operational learning, and autonomy policy. External agent desktops, daemons, relays, and provider CLIs remain replaceable implementations.
- *Authority is explicit and bounded* — prepare-only by default; external and sensitive actions require explicit authorization.
- *Quality assurance is part of delivery* — a finished executor task is not a completed outcome.
- *Workflow memory compounds value* — only inspectable, correctable, tenant-scoped, approved knowledge becomes reusable.
- *Manual first, automation after proof* — do not skip managed delegation or invent an unmanned agent fleet.
- *Security follows delegated authority* — least privilege, tenant isolation, audit, removable access.
- *Decision tests* — resist any change that makes the customer manage workers, hides uncertainty, or makes an external runtime architecturally indispensable.

Related doctrine, not substitutes for `VISION.md`:

- `docs/DELEGATION-CLOUD-STRATEGIC-THESIS.md` — managed execution company; do not launch by selling orchestration software.
- `docs/CAPABILITY-SOVEREIGNTY.md` and `docs/CAPABILITY-SOVEREIGNTY-ROADMAP.md` — interfaces and authority stay Delegation Cloud-owned.
- `docs/GAUNTLET-LOOP.md` — execution-control loop and earned autonomy evidence path.
- `docs/STEP-3D-WORK-CELL.md` — multi-executor staffing inside one attempt; grants no extra authority.
- `docs/EXECUTION-RUNTIME-V1.md` — durable plan, stage, lease, heartbeat, and recovery.
- `docs/SOFTWARE-FACTORY-RUN-MANAGER-V1.md` — prepare-only software control-plane overlay.
- `docs/ENGINEERING-EXECUTION-PRINCIPLES.md` — tool-agnostic engineering quality; grants no merge or deploy authority.

This document names an **Outcome Mesh**: Delegation Cloud’s own agent-orchestration *control plane*. It is not a desktop IDE, not a multi-agent launcher, and not a rebrand of Superset or Paseo.

Hard constraints observed by this design:

- Do not copy code, UI, naming, product assumptions, or architecture from [Superset](https://github.com/superset-sh/superset) or [Paseo](https://github.com/getpaseo/paseo).
- Do not add either product as a dependency, install, or hosted service.
- Do not add a hosted memory provider or Supermemory.
- Do not modify PR #64, PR #70, or PR #73.
- Do not merge, deploy, change Production infrastructure, or write Production databases.
- Do not grant agents merge, deploy, publish, purchase, messaging, access-change, or Production authority.
- Keep future implementation provider-neutral.
- Treat all executor output as untrusted until independently verified.

Reference inspection for this document used only public READMEs and high-level docs. Marketing claims (“100+ agents,” “code 10x faster,” “privacy-first”) are **not** treated as security, isolation, verification, or autonomy guarantees.

---

## 1. Product thesis

### 1.1 Distinct category

Delegation Cloud’s category is not “agent desktop,” “agent dashboard,” or “multi-agent launcher.”

The product primitive is:

> Delegation Cloud coordinates replaceable executors around verified business outcomes, using bounded workcells, authority leases, evidence, independent verification, approval gates, and reusable approved workflow knowledge.

The durable category names are:

1. **Outcome operating system** — the customer delegates a business condition, boundaries, and authority. Delegation Cloud compiles that request into an executable contract, staffs bounded work, stops at authority edges, and returns a verified result.
2. **Proof-carrying execution platform** — nothing is complete because an agent, script, or operator *says* it is complete. Completion is a typed Outcome Receipt bound to evidence, independent verification, authority checks, and a human decision where required.

The strategic thesis states the company should not initially compete by selling orchestration software. The wedge remains **we run the work**. The Outcome Mesh is the internal control plane that makes that promise inspectable. It is not a customer-facing agent cockpit.

### 1.2 Why this is not an agent desktop

An agent desktop optimizes for:

- launching many coding agents;
- watching terminals;
- switching models;
- merging the “winning” diff;
- reaching those agents from phone, CLI, SDK, or plugin.

That is a **labor-inventory and supervision surface**. It recreates the founder-as-routing-layer problem with bots instead of freelancers.

Delegation Cloud optimizes for:

- a named outcome and definition of done;
- an authority envelope and approval points;
- a bounded workcell graph, not a swarm;
- evidence and independent challenge;
- human decisions only where risk requires them;
- learning that is approved, tenant-scoped, and revocable.

Success metrics are accepted outcomes, time to verified delivery, approval burden, cost per accepted outcome, and authority/tenant failures — not agent count, token count, or parallelism.

### 1.3 What must be feature-compatible with Superset/Paseo

“Feature-compatible” here means **capability compatibility**, not product, protocol, or UX compatibility. Delegation Cloud may need the *capability* those products demonstrate, behind DC-owned contracts.

Extracted primitives from public docs, treated as hypotheses rather than guarantees:

| Observed primitive | Useful capability for DC | DC-owned contract it must satisfy |
| --- | --- | --- |
| Isolated workspaces / git worktrees | Isolated execution surface per attempt | `docs/ENGINEERING-WORKSPACE-ISOLATION-V1.md`; workspace never grants merge |
| Agent processes | Replaceable executor runtime | `executor_profiles`, Executor Envelope, Execution Context |
| Terminals | Capturable logs, not a product UI | hashed evidence artifacts; fail-closed redaction |
| Diff review | Human-readable change evidence for software work | GitHub/PR evidence as provider; Outcome Receipt remains SoT |
| Daemon / process control | Start, pause, stop, reap orphaned workers | Execution Runtime leases, heartbeats, reaper |
| CLI / SDK orchestration | Operator and adapter control plane | existing scripts + future headless Workbench CLI; not a second Run Manager |
| Provider adapters | Plug in humans, scripts, Cursor, Codex, Claude, Grok, future runtimes | Model Provider Abstraction; capability registry; no durable vendor semantics |
| Notifications | Alert humans at gates | approval and exception notifications only |
| Cross-device access | Reach running work from another client | **deferred / mostly reject**; high relay and device-compromise risk |
| Plugins | Extend the orchestration surface | **never add** as an execution-authority extension point |

Public documentation does **not** prove: tenant isolation, independent verification, authority leases, immutable evidence, rejection-as-authoritative, or earned autonomy. Those are Delegation Cloud requirements the references do not claim in a form this design can trust.

### 1.4 What must be fundamentally different

| Agent-launcher assumption | Delegation Cloud invariant |
| --- | --- |
| The unit of work is an agent session | The unit of work is an Outcome compiled into a Delegation Spec and Workstream Run |
| The user manages agents, models, and terminals | The customer never manages an AI workforce (`VISION.md`; strategic thesis §13) |
| “Done” is when the agent stops or CI is green | “Done” is an Outcome Receipt after independent verification |
| Parallelism is the product | Parallelism is an implementation tactic inside a bounded graph |
| Ambient machine credentials | Authority Lease + Execution Context; secrets never in prompts |
| Merge/push from the agent surface | Human-gated PRs and deployments; adapters prepare only |
| Provider name is the workflow | Capability key is the workflow; provider is provenance |
| Memory is chat history or a hosted store | Operational Memory is a governed, approved, tenant-scoped artifact |
| Retry until it looks good | Rejection is authoritative; repair requires a new attempt |
| Remote phone control of live agents | External/sensitive actions cannot be authorized from a compromised remote device without DC gates |

### 1.5 Product promise, restated

The customer should always be able to answer the `VISION.md` questions:

- What outcome is being pursued?
- Who or what is working on it?
- What information and authority were provided?
- What has been completed and checked?
- What requires customer approval?
- What was delivered?
- What did the system learn for the next occurrence?

The Outcome Mesh exists so those answers are reconstructable from frozen contracts, not from a terminal scrollback.

---

## 2. Core primitives

Every primitive below is a Delegation Cloud-owned contract. Vendor, model, and runtime names may appear only in implementation metadata and execution provenance.

Convention:

- **Owner** is the accountable plane, not the executor that produced bytes.
- **Authority** is a ceiling, never inferred from capability or confidence.
- **Tenant boundary** is `organization_id` unless explicitly staff-only internal staffing detail.

### 2.1 Outcome

The business condition the customer is trying to create, stated independently of who will perform the work.

| Dimension | Contract |
| --- | --- |
| Owner | Customer (objective and final authority); Delegation Cloud (interpretation, tracking, delivery path) |
| Lifecycle | requested → clarified → compiled → in execution → verified or failed → delivered / accepted / cancelled |
| Authority | None by itself. An Outcome cannot authorize send, purchase, publish, merge, deploy, or access change |
| Inputs | Customer request, context, constraints, existing workstream if any |
| Outputs | Candidate Delegation Spec inputs: objective, definition of done, missing questions |
| Failure behavior | Ambiguous or high-risk outcomes pause for clarification; they do not spawn unbounded executor graphs |
| Audit | Request create/status, compiler version, clarification thread, resulting spec identity |
| Tenant boundary | Organization-scoped. Never reused across tenants |

### 2.2 Outcome Compiler

Deterministic-plus-human compilation of an Outcome into one or more Delegation Specs and a bounded Workcell Graph. Compilation is interpretation under policy, not autonomous planning with extra authority.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud control plane; humans approve compiled plans when policy requires |
| Lifecycle | draft compile → validation → human plan approval if required → frozen graph |
| Authority | Cannot raise action class above the request, workstream, or active Delegation Spec. Cannot invent credentials |
| Inputs | Outcome, workstream templates, active Delegation Spec if present, data policy, economic envelope, playbooks that are *verified* and in-scope |
| Outputs | Delegation Spec version, Workcell Graph, approval points, verification method |
| Failure behavior | Fail closed on unknown capability, cyclic graph, missing acceptance criteria, authority overflow, or cross-tenant inputs |
| Audit | Compiler version, input hashes, output graph hash, approver identity |
| Tenant boundary | Compiler may read only the requesting organization’s approved workflow memory and specs |

The compiler is **not** a competing Run Manager. Software Factory packets remain `software-factory-packet/v1`. Ordinary workstreams remain `delegation_specs` + `workstream_runs`.

### 2.3 Workcell

A bounded staffing and isolation arrangement inside **one** Workstream Run / Gauntlet attempt. Matches Step 3D: several replaceable executors, one attempt, Delegation Cloud owns every authoritative transition.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud. Staff see roster; customers see outcomes, not agents |
| Lifecycle | manifest frozen → prepare → review → validate → terminal (succeeded / failed / cancelled). No silent phase overwrite (`unique (run_id, phase)`) |
| Authority | Snapshot of executor envelope at assignment time. `mayOwnAuthoritativeState` is always false. Validate phase requires a deterministic executor |
| Inputs | Frozen manifest, limited artifacts, Authority Lease, Execution Context |
| Outputs | Typed evidence artifacts (packet, review, validation, or rejection). Never a self-issued receipt |
| Failure behavior | Rejected output becomes an untrusted rejection artifact. New attempt required. Same attempt cannot be silently repaired |
| Audit | Assignments, authority snapshots, artifact hashes, economics, traces |
| Tenant boundary | Assignments are staff-only at the DB boundary; artifacts are organization-scoped |

### 2.4 Workcell Graph

The compiled, acyclic graph of workcells/stages that realize one Outcome under one Delegation Spec version.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud control plane. Maps onto Execution Runtime `execution_plan` / `execution_plan_step` when that overlay is used, or onto Step 3D phases for catalog-style cells |
| Lifecycle | proposed → frozen → executing → blocked / failed / cancelled / complete |
| Authority | Each node ≤ plan ceiling ≤ Delegation Spec action class. Frozen hash is immutable |
| Inputs | Compiled nodes and edges, budgets, stop conditions |
| Outputs | Ordered stage attempts, evidence, gates |
| Failure behavior | Failed, blocked, or cancelled dependencies block descendants. Cycles rejected at freeze |
| Audit | Plan hash, stage keys, attempt lineage, events |
| Tenant boundary | `organization_id` on every plan/stage/attempt |

This graph is an overlay on Workstream Runs. It does not replace them.

### 2.5 Executor

A replaceable implementation that can satisfy a capability: human, deterministic script, or agent runtime.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud registry (`executor_profiles`). The executor never owns product truth |
| Lifecycle | shadow → active / suspended / retired. Qualification is separate (`executor_capabilities`) |
| Authority | Profile envelope frozen into assignment `authority_snapshot`. Forbidden actions are structural. No credentials stored in the profile |
| Inputs | Executor Envelope: frozen artifacts, authority, output contract, economics, deadline, config snapshot |
| Outputs | Executor Result: candidate payload or artifact refs, evidence refs, authority report, measured economics, provenance |
| Failure behavior | Identity drift, over-limit economics, late completion, or prepare-only violations fail the result. Failed results remain evidence |
| Audit | Config snapshot, provider/protocol/model as provenance, traces, costs |
| Tenant boundary | Profiles are internal staffing detail (not org-scoped). Assignments and artifacts are org-scoped. Customers do not browse executors |

### 2.6 Capability

A Delegation Cloud-owned description of *what work is*, independent of *who does it*.

| Dimension | Contract |
| --- | --- |
| Owner | Capability registry (`docs/CAPABILITY-REGISTRY-V1.md`) |
| Lifecycle | proposed → active / suspended / retired |
| Authority | Risk class and verification contract only. A capability is not a permission |
| Inputs | Capability key, contract versions, risk class |
| Outputs | Eligible implementations via router policy; never automatic invocation by this primitive |
| Failure behavior | Unknown, inactive, or unqualified capabilities block routing |
| Audit | Registry versions, qualification evidence summaries, router decision artifacts |
| Tenant boundary | Registry is platform vocabulary. Qualification evidence is tenant- or proving-ground-scoped as recorded |

Durable workstream semantics use capability keys (`evidence_research`, `software_change_prepare`), not `cursor`, `codex`, `claude`, or `grok`.

### 2.7 Authority Lease

A time-bounded, worker-bound grant to execute one stage/attempt inside an already authorized envelope. Combines Execution Runtime leases with Execution Context tool classes.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud runtime. Plaintext lease token is never stored; only its hash |
| Lifecycle | issued → heartbeat → completed / failed / expired / revoked / reaped |
| Authority | Cannot exceed the frozen assignment snapshot, Execution Context tool classes, or Delegation Spec. Cannot be transferred. Cannot be extended past deadline by the worker |
| Inputs | Attempt id, stage id, worker identity, context hash, expiry |
| Outputs | Right to heartbeat and submit a result for that attempt only |
| Failure behavior | Mismatched token, worker, attempt, or expired lease cannot complete. Reaper creates a new attempt rather than resurrecting the old one |
| Audit | Lease hash, heartbeats, expiry, revocation reason, claiming worker |
| Tenant boundary | Org-consistent FKs; staff-only runtime detail until a sanitized projection exists |

Software Factory overlay currently notes SF-VA-002 worker leases as **not implemented**. This primitive must extend that overlay later, not invent a third lease table as SoT.

### 2.8 Evidence Artifact

Immutable, hash-bound observation or work product. Existing table: `evidence_artifacts`. Insert-only for authenticated roles.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud evidence plane |
| Lifecycle | inserted and frozen. No update, no delete |
| Authority | Proves content identity, not truth, approval, independence, or completion |
| Inputs | Kind, summary, payload, source URI, observed_at, optional content hash |
| Outputs | Artifact id + content hash referenced by reviews, receipts, memory candidates |
| Failure behavior | Missing required hash for typed schemas is a hard failure. Tamper (payload no longer hashes) fails verification |
| Audit | Org, run, creator, hash, schemaVersion, observed_at |
| Tenant boundary | `organization_id`; artifacts cannot be cited across organizations |

### 2.9 Outcome Receipt

Authoritative completion record for one Workstream Run. Existing table: `outcome_receipts`. Immutable after insert. Passing receipts require definition of done and evidence when the spec declares verification rules. Gauntlet adds independent-review hard-gate constraints.

| Dimension | Contract |
| --- | --- |
| Owner | Delegation Cloud. Issued only when the run is `awaiting_verification` |
| Lifecycle | insert once → run becomes `verified` or `failed`. Never edited |
| Authority | The only object that can mark an outcome complete. Agents cannot insert a passing receipt for their own work |
| Inputs | Verification status, definition-of-done flag, summary, actions, exceptions, unresolved decisions, verifier |
| Outputs | Terminal run status, Gauntlet impact-review eligibility, learning eligibility |
| Failure behavior | Failed receipts are first-class. Over-limit economics can still receive a *failed* receipt so overage is visible |
| Audit | Verifier identity, timestamp, bound evidence, review ids |
| Tenant boundary | Org + run uniqueness; RLS |

Section 6 specifies the minimum v1 receipt fields the current schema must grow toward. Growth is additive overlay, not a parallel receipts table.

### 2.10 Verification Gate

Independent challenge of executor output. Deterministic validators own `hard_gate_pass`. Agent reviewers may produce review artifacts but cannot own the gate.

| Dimension | Contract |
| --- | --- |
| Owner | Deterministic code first; accountable human QA where the spec requires it |
| Lifecycle | bound to frozen inputs → challenge → pass / fail / inconclusive |
| Authority | Can reject completion. Cannot grant extra action class. Cannot merge, deploy, or send |
| Inputs | Frozen artifacts by hash, Delegation Spec verification rules, hidden tests where declared, authority and tenant checks |
| Outputs | Validation artifact, Gauntlet review row, gate result |
| Failure behavior | Hard failure blocks a passing receipt. Inconclusive is valid; it is not manufactured into pass |
| Audit | Reviewer kind/reference, independence flag, defects, evidence gaps, authority incidents |
| Tenant boundary | Same org as the run. Hidden tests stay staff-controlled and are not shown to the executor |

### 2.11 Human Decision

Accountable approve / reject / clarify / accept-uncertainty / authorize-sensitive / authorize-external / accept-delivery record.

| Dimension | Contract |
| --- | --- |
| Owner | Named human with the correct role (`client_admin` / `client_member` for customer approvals; `ops_manager` / `platform_admin` for staffing and some gates). Operators cannot decide customer approvals |
| Lifecycle | requested → decided (approved / rejected / cancelled) or expired |
| Authority | The only source of extra authority beyond the active envelope. Decisions are not transferable to executors as ambient permission |
| Inputs | Kind (`execution_plan`, `external_email`, `crm_destructive_change`, `vendor_communication`, `sensitive_action`, plus factory owner-decision), artifact hashes, risk tier |
| Outputs | Approval row or `software-factory-owner-decision/v1`; run pause or resume |
| Failure behavior | Missing or stale approval blocks the protected step. Sensitive execution cannot enter `in_progress` without an approved row (application + SQL trigger) |
| Audit | Actor, kind, decision, reason, bound hashes, timestamp |
| Tenant boundary | Organization-scoped. Staff cannot impersonate customer approval |

### 2.12 Approved Workflow Memory

Reusable knowledge promoted only after verification and accountable approval. Existing contract: `docs/OPERATIONAL-MEMORY-V1.md`. This design does **not** add a hosted memory provider.

| Dimension | Contract |
| --- | --- |
| Owner | Organization (customer-specific playbooks) or platform (generalized methods, separately scoped). Executors may only propose candidates |
| Lifecycle | candidate → reviewed → verified/promoted → possibly invalidated / expired / superseded |
| Authority | Memory never grants send, purchase, publish, merge, access change, or scoring power |
| Inputs | Source artifact ids, run/assignment refs, kind (working / operational / entity / procedural / preference / historical) |
| Outputs | Hash-bound memory body with approver, scope, expiry |
| Failure behavior | Conflicts remain as a conflict set; neither value is silently chosen. Expired/invalidated memory cannot be used for routing |
| Audit | Provenance, approver, hashes, invalidation reason |
| Tenant boundary | Explicit organization scope. Customer knowledge never becomes global by default |

### 2.13 Earned Autonomy

Workstream-specific permission to reduce day-to-day coordination **inside an already granted action class**, based on Gauntlet evidence. Not a reward for a busy loop.

| Dimension | Contract |
| --- | --- |
| Owner | Autonomy controller in Gauntlet + operations manager configuration. Promotion is approval-gated by default |
| Lifecycle | Level 0 observe → 1 prepare → 2 execute with approval → 3 bounded autonomous execution → 4 exception-only supervision. Hold / promote / demote / suspend |
| Authority | Cannot exceed the Delegation Spec. External and sensitive steps still stop. Autonomy is revocable. Authority incidents can auto-suspend; failed hard gates and regressions can auto-demote |
| Inputs | Verified runs, QA, failure/exception rates, owner minutes, impact assessments, zero-incident requirement |
| Outputs | Autonomy profile change + audit |
| Failure behavior | Unset thresholds mean **hold**. Activity, agent count, or token spend cannot promote |
| Audit | Decision, evidence window, approver, reversions |
| Tenant boundary | Per organization workstream |

---

## 3. System architecture

### 3.1 End-to-end path

```text
Outcome request
      |
      v
Outcome compilation
      |
      v
Bounded workcell graph
      |
      v
Executor assignment
      |
      v
Isolated execution
      |
      v
Evidence collection
      |
      v
Independent verification
      |
      v
Human approval (when required)
      |
      v
Delivery
      |
      v
Approved workflow learning
```

Mapped onto existing Delegation Cloud planes from `docs/CAPABILITY-SOVEREIGNTY.md`:

```text
CUSTOMER INTENT
      |
      v
INTENT / CONTRACT PLANE
  Outcome, Delegation Spec, definition of done,
  authority envelope, approval policy, economic envelope
      |
      v
CONTROL PLANE
  Workstream Run, Gauntlet cycle, Outcome Compiler,
  Workcell Graph, routing decision artifact, recovery,
  exception management, autonomy controller
      |
      v
EXECUTION PLANE
  Workcell + Authority Lease + Execution Context
  isolated workspace / worktree / container
  replaceable executor adapter (human / script / agent)
      |
      v
EVIDENCE / VERIFICATION PLANE
  evidence_artifacts, traces, deterministic gate,
  independent review, Outcome Receipt, economics
      |
      v
LEARNING PLANE
  approved workflow memory, failure taxonomy,
  capability performance ledger, Skill versions,
  earned autonomy
```

### 3.2 Authoritative contracts that remain SoT

Do **not** introduce a competing Run Manager, memory model, authority model, or execution lifecycle.

| Concern | Authoritative contract | Outcome Mesh may |
| --- | --- | --- |
| Product constitution | `VISION.md` | Cite; not rewrite unless a governing decision is explicitly authorized |
| Request / workstream / approval UX | Existing `/app` and `/ops`, `src/lib/domain.ts`, `src/lib/store.ts` | Add staff-only projections later; no customer agent roster |
| Delegation Spec / run / evidence / receipt | `delegation_specs`, `workstream_runs`, `evidence_artifacts`, `outcome_receipts` | Add fields via future reviewed migrations; no parallel tables as SoT |
| Gauntlet | `docs/GAUNTLET-LOOP.md` | Use as the verification and autonomy loop |
| Workcell staffing | `docs/STEP-3D-WORK-CELL.md`, `executor_profiles`, `run_executor_assignments` | Generalize beyond catalog schemas without duplicating evidence |
| Executor I/O | `docs/EXECUTOR-ENVELOPE-V1.md` | Adapter target for all runtimes |
| Tool access | `docs/EXECUTION-CONTEXT-V1.md` | Enforce in every adapter |
| Isolation | `docs/ENGINEERING-WORKSPACE-ISOLATION-V1.md` | Operator that provisions worktrees/branches/containers |
| Durable queue / leases | `docs/EXECUTION-RUNTIME-V1.md` | Headless Workbench drives this runtime; does not replace it |
| Software work overlay | `docs/SOFTWARE-FACTORY-RUN-MANAGER-V1.md` | Consume; add leases later as SF-VA-002, not a new factory |
| Economics | `docs/ECONOMIC-ENVELOPE-GUARD-V1.md` | Enforce ceilings; adapters may add pre-flight budget hooks later |
| Memory | `docs/OPERATIONAL-MEMORY-V1.md` (CS-11). PR #64 is a separate draft and must not be modified here | Propose candidates only; no hosted provider |
| Capabilities / routing | CS-1, CS-3 | Decision artifacts only; no autonomous invocation |
| Model providers | `docs/MODEL-PROVIDER-ABSTRACTION-V1.md` | Provenance, not workstream identity |
| Skills | `docs/NATIVE-SKILL-REGISTRY-V1.md` | Qualified procedures only |
| Performance comparison | `docs/CAPABILITY-PERFORMANCE-LEDGER-V1.md` | Consume validator/human evidence, never self-score |
| Specialist multi-stage work | `docs/SPECIALIST-PIPELINE-V1.md` | Compatible graph shape |
| Local source lookup | `docs/SOFTWARE-CONTEXT-SHUNT-V1.md` | Optional locator; not an Outcome Receipt |
| Operator helpers | `docs/WORK-CELL-OPERATOR-TOOLCHAIN.md` | Keep prepare-only; no Loadout writes |
| Agent eval / trace | Draft PRs #70 and #73 — **do not modify**. Treat as adjacent evidence harnesses when/if they land | Reference as evaluation plane, not SoT |

### 3.3 What the Outcome Mesh is not

- Not a second lifecycle (`Intake → … → Accepted` already lives on Software Factory overlay of `workstream_runs`).
- Not a customer desktop for chatting with a fleet.
- Not an MCP server that lets agents create workspaces with extra authority.
- Not a plugin host.
- Not a hosted memory fabric.
- Not permission to merge because a worktree looks good.

### 3.4 Control versus execution

Delegation Cloud owns state transitions, counts, economics, autonomy, and verification. Executors produce candidate artifacts and traces. Adapters invoke providers. Humans decide consequential gates.

An AI worker may never:

- mark a run verified;
- promote memory;
- qualify a capability;
- extend a lease;
- raise action class;
- treat a trace as a receipt.

---

## 4. Outcome Graph design

### 4.1 Compilation

```text
Request
  -> clarify missing inputs / authority / data policy
  -> select or create Delegation Spec version
  -> compile Workcell Graph (nodes + edges)
  -> freeze graph hash
  -> create Workstream Run (planned)
  -> optionally freeze Execution Runtime plan
  -> wait for plan approval when required
  -> activate first ready nodes
```

Unknown work compiles to a **Workstream Foundry** path: human-led, instrumented execution under prepare-only, not an unbounded agent graph (strategic thesis §4).

### 4.2 Node contract

Every graph node **must** carry all of the following: capability, executor class, action class, allowed tools, forbidden tools, evidence requirements, acceptance criteria, deadline, budget, retry policy, approval requirement, tenant scope, data sensitivity, stop conditions, and verification method.

| Field | Rule |
| --- | --- |
| capability (`capability`) | Registry key. Unknown keys fail freeze |
| executor class (`executorClass`) | `human` \| `deterministic` \| `agent`. Not a vendor name. Validate nodes must be `deterministic` |
| action class (`actionClass`) | ≤ Delegation Spec. Default `prepare_only` |
| allowed tools (`allowedTools`) | Execution Context tool classes / tool keys. Closed allowlist |
| forbidden tools (`forbiddenTools`) | Explicit deny list; deny wins |
| evidence requirements (`evidenceRequirements`) | Required artifact schema versions, provenance, independence flag |
| acceptance criteria (`acceptanceCriteria`) | Observable, falsifiable checks. Empty list fails freeze |
| deadline (`deadline`) | Absolute timestamp. Late work blocks rather than runs |
| budget (`budget`) | Human minutes, AI micros, tool micros; inherit spec ceilings |
| retry policy (`retryPolicy`) | Failure-class map from Gauntlet / Execution Runtime. Finite attempts. Security/authority/policy do not brute-force retry |
| approval requirement (`approvalRequirement`) | None / operator / customer / specialist, bound to `APPROVAL_KINDS` or factory owner-decision |
| tenant scope (`tenantScope`) | Exact `organizationId`. No wildcard |
| data sensitivity (`dataSensitivity`) | Must be ≤ executor and capability ceilings |
| stop conditions (`stopConditions`) | Authority incident, budget breach, deadline, contradiction, missing evidence, human cancel |
| verification method (`verificationMethod`) | Deterministic validator contract and/or independent human/agent review **plus** gate ownership |

Optional provenance, never semantics: `preferredImplementationKey` (manual pin). An ineligible pin blocks rather than silently falling back (`docs/CAPABILITY-ROUTER-V1.md`).

### 4.3 Edges and readiness

- Edges are data/control dependencies.
- A node is claimable only when every dependency has `succeeded` with hash-bound outputs matching the declared input contracts.
- Side-effecting nodes (external/sensitive) additionally require a live Human Decision bound to the frozen node hash.
- The graph is a DAG. Cycles fail freeze.
- Fan-out is allowed only when isolation records exist (distinct workspaces) and comparison does not auto-merge.

### 4.4 Software Factory mapping

For software outcomes, node fields map onto packet fields already required by Run Manager (`STATUS`, `TASK_ID`, `REPOSITORY`, `BASE_BRANCH`, `OBJECTIVE`, `IN_SCOPE`, `OUT_OF_SCOPE`, `ACCEPTANCE_CRITERIA`, `VERIFICATION`, `RISK`, `APPROVAL_REQUIRED`). The graph does not replace the packet. It sequences cells that consume the packet.

---

## 5. Workcell design

### 5.1 Provisioning bundle

Each workcell receives:

| Resource | Rule |
| --- | --- |
| Isolated worktree or execution surface | Branch, worktree, or container per `engineering-workspace/v1`. Frozen base Git SHA. `mergeAuthorityGranted: false` always |
| Limited inputs | Exact artifact refs/hashes listed in the envelope. No ambient repo, ticket, or memory dump |
| Authority Lease | Worker + attempt + token hash + expiry. Heartbeat required |
| Execution deadline | Stage deadline; lease expiry ≤ deadline |
| Economic envelope | Assignment-level caps; run totals cannot under-report assignment costs |
| Output contract | Schema version + artifact kind. Unknown keys rejected (`.strict()` pattern from Step 3D) |
| Trace identity | Run, assignment, workcell, attempt, context hash. Redact prompts/secrets |
| Revocation path | Operator or policy can revoke lease, mark stage cancelled, and request workspace cleanup. Revocation does not undo external side effects |

### 5.2 Lifecycle

Workcells are started, paused, stopped, resumed, failed, and recovered as follows:

```text
provision -> activate -> running
                |           |
                |           +--> pause (lease held, tools blocked)
                |           +--> stop / cancel (terminal; cleanup)
                |           +--> fail (rejection artifact; new attempt)
                |           +--> submit result -> independent verify
                |
                +--> resume (new or remaining lease if still valid)
                +--> recover (reap expired lease, new attempt, same stage key)
```

| Action | Who | Effect |
| --- | --- | --- |
| Started | Runtime claim after dependencies succeed | Issues lease, activates workspace, records assignment |
| Paused | Operator or policy (budget, approval wait, suspicion) | Heartbeats may continue; tool invocations other than status are blocked |
| Stopped | Operator, customer cancel, security incident | Stage terminal; workspace cleanup requested; no overwrite of evidence |
| Resumed | Operator after pause if lease still valid | Same attempt. If lease expired, resume is recovery instead |
| Failed | Adapter, validator, or reaper | Rejection artifact; failure classification; retry policy decides new attempt |
| Recovered | Reaper / operator | New attempt, new lease, possibly different qualified executor. Prior attempt remains evidence |

Retries never overwrite the previous attempt. Gauntlet retries are new Workstream Runs when the loop requires it; Execution Runtime retries are new `execution_attempt` rows.

### 5.3 Isolation rules

- Distinct mutable workspace refs are required before candidate comparison.
- Comparison is allowed only after independent verification of each candidate.
- Comparison does not select a winner with merge authority.
- Dirty worktree files are not evidence; software locators read committed blobs (`docs/SOFTWARE-CONTEXT-SHUNT-V1.md`).
- Cleanup completion is explicit. Cleaned workspaces retain result SHA and verification refs for replay.

### 5.4 Headless Workbench (Phase 1 target)

The internal Workbench is a **staff operator + adapter host**, not a desktop IDE:

- provision/tear down workspaces;
- start/stop/reap executor processes;
- stream logs into redacted traces;
- never expose a customer “fleet” view;
- never auto-merge;
- never hold long-lived cloud credentials in the workcell.

Existing operator scripts remain the seed (`extract-work-cell-artifact`, `draft-work-cell-receipt`, freeze helpers). They draft; they do not issue receipts or write Production.

---

## 6. Proof-carrying outcome design

### 6.1 Minimum Outcome Receipt

The current `outcome_receipts` row is necessary but not sufficient for the Mesh. v1 Mesh receipts must be a typed payload stored as evidence and/or additive columns, still inserted through the existing receipt gate. Minimum contents:

| Field | Meaning |
| --- | --- |
| Requested outcome | Objective + Delegation Spec version + graph hash |
| Actual output | Artifact refs/hashes of delivered work (or explicit none on failure) |
| Evidence references | All required kinds, each with content hash |
| Source provenance | Primary sources, observation times, recorder kinds |
| Acceptance criteria | Frozen list and per-criterion pass/fail/untested |
| Verification result | Independent review id, deterministic `hardGatePass`, defects, gaps |
| Authority decision | Action class used, incidents, lease ids, tool-class violations |
| Approval state | Required vs recorded Human Decisions, bound hashes |
| Trace references | Redacted `agent-trace` / runtime event ids. No raw chain-of-thought |
| Cost and timing | Human, owner, AI, tool costs; started/completed; recompute, do not trust self-report |
| Unresolved uncertainty | First-class list; empty only if none remain |
| Reviewer decision | Independent reviewer identity/kind; cannot be the preparing executor |
| Final delivery state | Bound to request status / factory overlay: delivered, accepted, failed, cancelled — never “agent done” |

Passing technical receipts still move Gauntlet to **impact review**, not to autonomy promotion (`docs/GAUNTLET-LOOP.md`).

### 6.2 Why an agent cannot independently mark an outcome complete

1. **Database**: receipts insert only for `awaiting_verification`; passing requires definition of done; typed evidence may be mandatory; receipts are immutable; agents are not the verifier identity.
2. **Gauntlet**: a passing receipt for a Gauntlet run is blocked until an independent review passes its hard gate with zero authority incidents. Humans cannot mark their own run as independent review.
3. **Workcell**: validate phase must be a deterministic executor at the DB boundary.
4. **Envelope**: `mayOwnAuthoritativeState` is always false.
5. **Factory**: Accepted requires `software_factory_record_owner_decision` from an organization owner/member plus `enforce_software_factory_receipt`. Cursor/Grok success claims never Accept.
6. **Economics**: over-limit runs cannot be `verified`.
7. **Stale evidence**: factory acceptance treats stale evidence as failure.

Therefore “the model said it finished” is not a state transition.

### 6.3 False-completion classes the receipt must catch

- CI green without acceptance criteria evidence;
- empty or self-hashed evidence;
- review that edits or replaces the packet;
- missing approval on sensitive/external nodes;
- cost under-reporting;
- expired lease completion;
- cross-tenant artifact citation;
- replay of a previous run’s hashes as if new.

---

## 7. Executor mesh

### 7.1 Provider-neutral interface

All executors speak Executor Envelope / Executor Result (`docs/EXECUTOR-ENVELOPE-V1.md`) plus Execution Context tool validation (`docs/EXECUTION-CONTEXT-V1.md`). Model-shaped executors also speak Model Provider Abstraction (`docs/MODEL-PROVIDER-ABSTRACTION-V1.md`).

```text
claim stage
  -> bind Execution Context + optional approved memory refs
  -> issue Authority Lease
  -> adapter.invoke(envelope)
        humans: structured handoff (already used by Software Factory)
        deterministic: in-process or isolated script
        agents: Cursor / Codex / Claude / Grok / future via adapter
  -> validate ExecutorResult against envelope hash
  -> persist evidence
  -> release lease
```

Adapters may exist for:

| Implementation class | Current DC fact | Mesh rule |
| --- | --- | --- |
| Humans | Operators, specialists, CoS, SF PM/Developer handoffs | First-class executor kind |
| Deterministic scripts | Catalog validator, economic guards, context shunt, routers | Only class that may own validate gates |
| Cursor or other coding agents | Factory records hashed `cursor_execution` evidence when an **approved connector** exists; default is human-mediated | Prepare-only; success claim never Accepts |
| Codex | Named in context-shunt docs as a possible future consumer; no connector | Adapter only after qualification |
| Grok | `XAI_API_KEY` mock-or-live for in-app AI; Grok Bot has **no approved Software Factory connector**; Step 3D uses a frozen reviewer key | Use only behind capability + envelope; do not freeze “Grok” into workstream semantics except a controlled experiment |
| Claude or other providers | Not a durable workstream identity | Same adapter interface |
| Future runtimes | Expected | Must satisfy the same contracts without redesigning the workstream |

Grok is **not** assumed to have a general coding-agent RPC in this repository. Where a real supported interface exists (in-app model calls, or a later qualified Bot connector), it is an implementation. Where it does not, the mesh uses human-mediated handoff rather than pretending a daemon exists.

### 7.2 Replaceability test

A healthy mesh remains coherent if Cursor, Codex, Claude, Grok, or a local CLI disappears. Historical receipts stay valid because they bind hashes, capability keys, and config snapshots — not a vendor workflow object.

### 7.3 Forbidden durable semantics

Workstream templates, graph nodes, Skills, and playbooks must not require:

- a named desktop app;
- a named daemon protocol;
- a named model id (except frozen experiments);
- MCP as the control plane;
- plugins that expand tools.

---

## 8. Gauntlet and independent verification

Preserve `docs/GAUNTLET-LOOP.md`. The Mesh supplies workcells and evidence; it does not replace Observe → Diagnose → Execute → Adversarial review → Receipt → Impact → Autonomy.

### 8.1 Challenge methods

| Check | Rule |
| --- | --- |
| Independent verification | Different executor than prepare; hash-bound to frozen packet; no edit path |
| Red-team checks | Try to disprove completion: authority, tenant, freshness, hidden tests, economics |
| Evidence freshness | Observation time vs policy clock. Factory stale class (default 72h) fails closed in application. Do not trust executor “now” |
| Contradiction handling | Conflicting facts → conflict set or Gauntlet failure class `source_ambiguity`; escalate to human. No silent pick |
| Tenant checks | Org on every artifact, assignment, workspace, memory ref |
| Authority checks | Tool invocations vs Execution Context hash; unlisted actions fail. Sensitive attempts fail even if blocked with no side effect |
| Hidden / independent acceptance tests | Declared in the spec, unknown to the executor. Missing tests fail the gate, not the executor’s story |
| Economic checks | Assignment sums ≤ run totals ≤ spec ceilings |
| False-completion detection | Agent-eval style graders (adjacent PRs #70/#73 when landed) plus receipt schema. Do not modify those PRs here |
| Rejection behavior | Rejection is authoritative. Persist rejection artifact. Classify failure. **Do not silently repair inside the same attempt** |
| Resubmission | New attempt or new Gauntlet run. Must cite prior failure id. Same phase unique key forbids overwrite |

### 8.2 Failure classes (authoritative)

Reuse Gauntlet classes: bad input, executor failure, evidence failure, QA failure, integration failure, source ambiguity, authority limit, policy conflict, business-strategy failure, cost limit, security incident, external dependency, unknown.

Critical/security → stop run, block plan, human review. Authority/policy/ambiguity → block and escalate. Bad input → correct then new attempt. Executor/integration → bounded retry with different qualified executor if budget remains.

### 8.3 Independence rules

- Deterministic validator owns `hard_gate_pass`.
- Reviewer cannot change severity labels already on the frozen packet (Step 3D invariant).
- Self-review is a hard failure.
- CI is evidence, not the gate.

---

## 9. Human decision design

### 9.1 When to ask a human

| Decision | Trigger | Default actor |
| --- | --- | --- |
| Approve | Execution plan; promotion of autonomy; Skill qualification; memory promotion | Role-appropriate admin / ops manager |
| Reject | Failed gate, policy conflict, untrusted evidence | Same as the pending approval owner, or verifier |
| Request clarification | Missing inputs, ambiguous objective, conflicting sources | Operator to customer, or compiler pause |
| Accept uncertainty | Residual unknowns that do not block a bounded prepare-only delivery | Customer or ops manager, recorded on the receipt |
| Authorize a sensitive action | `sensitive_execution` or `sensitive_action` approval kind | Customer; SQL trigger blocks `in_progress` otherwise |
| Authorize an external action | Email, vendor communication, CRM destructive change, publish, commit request | Customer; even approved merge is performed by a human **outside** DC adapters |
| Approve a delivery | Ready-to-deliver / factory awaiting owner | Customer owner/member |

Operators (`operator` role) work the queue. They cannot assign others or decide customer approvals. `platform_admin` still cannot skip sensitive-execution approval.

### 9.2 Risk-tiered gates (anti-fatigue)

| Risk tier | Examples | Gate |
| --- | --- | --- |
| T0 — observe / prepare | Research packet, draft, locator receipt | No customer interrupt if action class is prepare-only and budget holds |
| T1 — reversible internal | Internal labeling, draft PR **unmerged** | Ops QA; customer sees status, not every keystroke |
| T2 — external reversible | Drafted email awaiting send | Customer approval of exact artifact hash |
| T3 — sensitive / irreversible | Access change, purchase, Production, legal, funds | Explicit approval + specialist controls; out of launch scope for regulated domains |
| T4 — autonomy change | Promote workstream level | Ops manager + default extra approval; unset thresholds hold |

Batch low-risk T0/T1 into a digest. Never batch T2–T4. Never auto-approve because the queue is long.

### 9.3 Fatigue controls

- Ask only at compiled `approvalRequirement` points.
- Bind every decision to frozen hashes so “approve” cannot attach to a mutated packet.
- Show full item details (outcome, action, artifact, cost, residual uncertainty) before write decisions.
- Reject requires a reason.
- Duplicate pending approvals for the same hash collapse to one.
- A paused goal or expired approval is not consent.

---

## 10. Workflow learning

### 10.1 Separation of knowledge

| Kind | May become durable authority? | Notes |
| --- | --- | --- |
| Raw executor output | No | Untrusted candidate only |
| Evidence | Proof of what was observed, not policy | Immutable artifacts |
| Approved result | Yes, as historical Outcome Receipt | Still not a Skill until promoted |
| Corrected result | Yes, as new receipt + correction lineage | Prior failure remains |
| Organization-specific playbook | Yes, after approval | Tenant-scoped operational/procedural memory |
| Generalized method | Yes, only as platform Skill/procedure with separate scope | Cannot carry customer confidential data |
| Unresolved hypothesis | No | Diagnosis records; Gauntlet preserves them without promoting |

No raw conversation, chain-of-thought, or unverified agent claim becomes durable authority or reusable workflow knowledge.

### 10.2 Promotion path

```text
candidate memory (executor-proposed)
  -> human review
  -> bind source artifact hashes + receipt id
  -> promoteOperationalMemory (accountable approver)
  -> optional Skill candidate (CS-12 / Step 3E)
  -> qualify only with manager approval and measured suite
```

Conflicts stay visible. Invalidation and expiry are first-class. Retrieval must fail closed on stale, erased, or contradictory memory.

### 10.3 Explicit non-goals

- Vector DB as SoT.
- Hosted memory vendor (including Supermemory).
- Automatic promotion by popularity or model confidence.
- Cross-tenant retrieval.
- Using PR #64’s draft control plane from this document. That PR remains a separate draft; this design cites CS-11 only.

---

## 11. Differentiation and defensibility

Delegation Cloud becomes hard to replace when switching costs are **operational truth**, not UI chrome. This is not a claim that copying is impossible.

| Asset | Why it compounds |
| --- | --- |
| Verified outcome history | Receipts + hashes + impact reviews are a private dataset of what actually worked |
| Acceptance data | Per-criterion pass/fail across repetitions beats generic agent logs |
| Organization-owned playbooks | Inspectable procedures the customer already corrected |
| Authority and approval history | Who authorized what, on which artifact, at which risk tier |
| Exception patterns | Failure taxonomy and corrective actions |
| Workflow economics | Cost per accepted outcome, owner minutes, rework — not token vanity |
| Evidence graph | Replayable provenance for disputes and onboarding |
| Trusted integrations | Least-privilege connectors behind DC contracts |
| Operational learning | Qualified Skills and earned autonomy that a generic launcher does not have |

A competitor can clone a worktree UI in a season. They cannot clone a tenant’s verified history, approval graph, and playbooks without the customer moving that data. Defensibility still requires the customer to **see** those playbooks (`VISION.md` incentives). Lock-in by hiding knowledge is forbidden.

The market for generic agent orchestration is crowded (strategic thesis §3). Winning there is not the strategy. Winning verified outcomes for founder-led operators is.

---

## 12. Red-team threat model

Each row is a required analysis. Residual risk of “low” still needs tests before a later phase exits.

### 12.1 Prompt injection

- **Threat:** Untrusted files, tickets, web text, or retrieved memory instruct the executor to raise authority or skip gates.
- **Attack path:** Injected “ignore policy / send email / dump secrets” in a repo or artifact.
- **Affected boundary:** Execution Context vs untrusted content.
- **Detection:** Tool-class violations; eval fixtures for injection markers; unexpected external tool attempts.
- **Prevention:** Separate trusted instructions from data; allowlisted tools; retrieved text cannot grant permission.
- **Recovery:** Fail attempt, revoke lease, classify security/policy, rotate any exposed refs.
- **Residual risk:** Semantic injection without markers.
- **Required test:** Adversarial fixture: untrusted content requests forbidden tool; invocation rejected; run not verified.

### 12.2 Poisoned repository content

- **Threat:** Malicious code, Skills, or docs in the worktree become instructions or executed payloads.
- **Attack path:** Compromised dependency, planted `SKILL.md`, hostile PR base.
- **Affected boundary:** Workspace isolation + Skill registry.
- **Detection:** Unexpected network/tool use; Skill hash mismatch; review diffs.
- **Prevention:** Qualified Skills only; read committed blobs; no ambient Skill auto-load from untrusted trees; pin revisions.
- **Recovery:** Abandon workspace; new attempt from known-good SHA; invalidate poisoned memory.
- **Residual risk:** Subtle logic bombs that look like valid code.
- **Required test:** Workcell with hostile instruction file cannot expand allowedTools.

### 12.3 Secret exfiltration

- **Threat:** Credentials in env, git history, or prompts leave the tenant.
- **Attack path:** Agent prints env; prompt includes secret; trace stores completion text.
- **Affected boundary:** Credential references vs secret material.
- **Detection:** Trace redaction failures; DLP-like secret patterns; unexpected egress.
- **Prevention:** `secretMaterialIncluded: false`; credentials as refs; fail-closed redaction; no secrets in executor artifacts.
- **Recovery:** Rotate secrets; invalidate traces; security incident stop.
- **Residual risk:** Side channels (timing, encoded diffs).
- **Required test:** Trace sanitizer drops prompt/completion/secret-like keys; envelope forbids credential_use on prepare-only.

### 12.4 Malicious dependencies

- **Threat:** npm/pip/OS packages execute during workspace setup.
- **Attack path:** `postinstall`, compromised lockfile, unpinned action.
- **Affected boundary:** Workspace provision scripts.
- **Detection:** Network during install; hash mismatch vs lockfile.
- **Prevention:** Pin reviewed revisions; disposable/sandbox installs; no Production credentials in setup; treat generated CLIs as untrusted (`AGENTS.md` tooling rules).
- **Recovery:** Destroy workspace; freeze known-good lockfile; incident review.
- **Residual risk:** Trusted-but-compromised upstream.
- **Required test:** Provision path refuses to run with Production secret env; supply-chain review checklist on adapter.

### 12.5 Unauthorized tool calls

- **Threat:** Executor invokes a tool class not in the frozen context.
- **Attack path:** SDK default tools; “helpful” browser; shell escape.
- **Affected boundary:** `validateToolInvocation`.
- **Detection:** Trace with unauthorized class; blocked flag missing canonical failure code.
- **Prevention:** Central adapter enforcement; closed allowlist; deny wins.
- **Recovery:** Hard-fail verification; do not rewrite the invocation into an allowed one.
- **Residual risk:** Adapter that bypasses the validator.
- **Required test:** Outside-envelope call blocks verification; cannot be repaired in-place.

### 12.6 Worktree escape

- **Threat:** Process reads/writes outside the isolated surface (symlink, `..`, shared mounts).
- **Attack path:** Follow symlink to host secrets; write sibling branch.
- **Affected boundary:** Engineering workspace.
- **Detection:** Path canonicalization failures; unexpected result SHA lineage.
- **Prevention:** Container or bounded worktree root; no extra mounts; Git safety options (`--no-lazy-fetch` pattern).
- **Recovery:** Mark workspace abandoned; treat outputs as untrusted.
- **Residual risk:** Kernel/container escape.
- **Required test:** Attempt to read path outside workspaceRef fails closed.

### 12.7 Branch contamination

- **Threat:** Workcell commits onto a shared branch or the customer’s main.
- **Attack path:** Wrong `workspaceRef`; adapter push; hook on checkout.
- **Affected boundary:** Isolation + GitHub provider.
- **Detection:** Result SHA not descended from frozen base SHA on the assigned branch.
- **Prevention:** Unique branch per attempt; no merge authority; GitHub write not authorized from adapters.
- **Recovery:** Human revert outside DC; failed receipt; do not auto-force-push.
- **Residual risk:** Misconfigured remote permissions.
- **Required test:** Two cells cannot share a mutable workspace ref; push/merge APIs absent from prepare-only adapter.

### 12.8 Cross-tenant retrieval

- **Threat:** Memory, evidence, or traces from org A used in org B.
- **Attack path:** Guessable ids; missing org predicate; staff UI leak.
- **Affected boundary:** RLS + store checks + memory scope.
- **Detection:** Composite FK failures; canAccessOrganization denials.
- **Prevention:** `organization_id` on every row; RLS; staff-only workcell economics.
- **Recovery:** Incident, erasure of leaked projections, customer notification per policy.
- **Residual risk:** Staff over-privilege.
- **Required test:** Artifact citation with foreign org_id fails freeze and retrieval.

### 12.9 Stale evidence

- **Threat:** Old passing hashes reused to claim a new outcome.
- **Attack path:** Replay receipt payload; cache without revalidation.
- **Affected boundary:** Freshness clocks; factory stale class.
- **Detection:** `evaluationClock` / observed_at vs policy; packet hash vs current spec.
- **Prevention:** Bind receipt to run id + graph hash + time window; cache revalidate.
- **Recovery:** Fail closed; require new observations.
- **Residual risk:** Specs without freshness rules.
- **Required test:** Evidence older than policy window cannot pass factory/Mesh acceptance.

### 12.10 Contradictory evidence

- **Threat:** Two sources disagree; system picks the convenient one.
- **Attack path:** Packet vs review vs hidden test.
- **Affected boundary:** Conflict sets; Gauntlet source_ambiguity.
- **Detection:** Validator warnings/hard fails; conflict-set API.
- **Prevention:** Do not auto-resolve; escalate.
- **Recovery:** Human decision recorded; new attempt if needed.
- **Residual risk:** Subtle numeric disagreement.
- **Required test:** Conflicting primary sources block passing receipt.

### 12.11 Forged verification

- **Threat:** Executor writes a fake validation artifact or review.
- **Attack path:** Insert `catalog-evidence-validation/v1` from agent profile; self-signed hard_gate_pass.
- **Affected boundary:** DB: validate phase requires deterministic executor; hash recompute.
- **Detection:** Reviewer key equals preparer; hash mismatch.
- **Prevention:** Schema + triggers; metrics computed in deterministic code.
- **Recovery:** Reject insert; suspend executor; security class.
- **Residual risk:** Compromised deterministic binary.
- **Required test:** Agent assignment to validate phase fails; tampered validation hash fails.

### 12.12 Agent self-approval

- **Threat:** Agent approves its own plan, delivery, or memory.
- **Attack path:** Forged approval row; using operator token.
- **Affected boundary:** Human Decision roles.
- **Detection:** Actor is executor key; missing customer role.
- **Prevention:** Approvals from users with roles; factory owner-decision RPC restricted; agents cannot call it.
- **Recovery:** Invalidate decision; rotate; failed run.
- **Residual risk:** Stolen human session.
- **Required test:** Executor identity cannot insert passing customer approval.

### 12.13 Approval fatigue

- **Threat:** Humans rubber-stamp high-risk items.
- **Attack path:** Flood of undifferentiated approvals; batched T3 items.
- **Affected boundary:** Human Decision UX.
- **Detection:** Time-to-approve vs risk tier; identical-hash multi-approve; skip-detail metrics.
- **Prevention:** Risk-tiered gates; hash-bound details; no T2–T4 batching.
- **Recovery:** Revoke rushed approvals if still pre-side-effect; incident if not.
- **Residual risk:** Social engineering of the founder.
- **Required test:** Policy forbids batching sensitive kinds; UI/contract test.

### 12.14 Duplicate execution

- **Threat:** Two workers run the same stage, causing double spend or conflicting writes.
- **Attack path:** Race on claim; ignored unique (run, phase).
- **Affected boundary:** Runtime claim transaction.
- **Detection:** Unique constraint; SKIP LOCKED.
- **Prevention:** One lease per attempt; unique stage claim.
- **Recovery:** Second worker fails to claim; economics of winner only.
- **Residual risk:** Adapter-side double invoke after claim.
- **Required test:** Two competing claims: exactly one lease.

### 12.15 Retry storms

- **Threat:** Infinite autonomous retries burn budget and hide failures.
- **Attack path:** Executor-driven retry; missing attempt budget.
- **Affected boundary:** Retry policy.
- **Detection:** Attempt count; cost slope.
- **Prevention:** Finite budget; backoff; security/authority do not retry; rejection stays.
- **Recovery:** Terminal fail; human classify.
- **Residual risk:** Misclassified failure class.
- **Required test:** Exhausted attempts become failed, not looping running.

### 12.16 Orphaned processes

- **Threat:** Worker continues after cancel/expiry and later writes.
- **Attack path:** Missed kill; stale heartbeat.
- **Affected boundary:** Lease reaper + workspace cleanup.
- **Detection:** Heartbeat timeout; process inventory vs lease table.
- **Prevention:** Reaper; completion requires live lease; cleanup lifecycle.
- **Recovery:** SIGTERM/kill adapter; abandon workspace; ignore late results.
- **Residual risk:** Process outside adapter supervision.
- **Required test:** Expired lease cannot complete; late result dropped.

### 12.17 Lease theft

- **Threat:** Another worker presents a stolen token.
- **Attack path:** Log leak; shared memory; relay.
- **Affected boundary:** Token hash + worker identity.
- **Detection:** Worker mismatch; duplicate heartbeat identities.
- **Prevention:** Hash-only storage; bind worker id; short TTL; TLS to control plane.
- **Recovery:** Revoke, rotate, new attempt.
- **Residual risk:** Compromised worker host.
- **Required test:** Correct token + wrong worker cannot heartbeat or complete.

### 12.18 Economic runaway

- **Threat:** Unbounded model/tool spend.
- **Attack path:** Long loop; expensive tools; under-reported costs.
- **Affected boundary:** Economic envelope guard.
- **Detection:** Assignment vs run totals; ceiling breach.
- **Prevention:** Caps; fail closed on verify; future pre-flight adapter hook (not claimed now).
- **Recovery:** Failed receipt showing overage; stop siblings on incident.
- **Residual risk:** Provider bills after the fact; current guard does not stop mid-request.
- **Required test:** Over-limit run cannot become verified; failed receipt still insertable.

### 12.19 Evidence gaming

- **Threat:** Executor cherry-picks sources, self-reports metrics, or hashes empty files.
- **Attack path:** Packet with aggregate counts; fake URLs; reused hashes.
- **Affected boundary:** Strict schemas; deterministic metrics.
- **Detection:** Unrecognized keys; validator hard rules; hidden tests.
- **Prevention:** `.strict()` contracts; DC computes counts; independent sources.
- **Recovery:** Rejection artifact; do not “fix” numbers in place.
- **Residual risk:** Plausible but false primary sources.
- **Required test:** Self-reported aggregates rejected; hidden acceptance test can fail a green narrative.

### 12.20 Provider outage

- **Threat:** Cursor/Codex/Claude/Grok/API down.
- **Attack path:** Timeout cascade; silent fallback to another tenant’s key.
- **Affected boundary:** Adapter health vs qualification.
- **Detection:** ModelProviderHealth; missing output artifact.
- **Prevention:** Declarative fallback only; ineligible pin does not silently switch; blocked/inconclusive first-class.
- **Recovery:** Retry other *qualified* implementation if policy allows; else human.
- **Residual risk:** Correlated multi-provider outage.
- **Required test:** Unhealthy provider cannot complete a receipt; fallback cannot change data policy.

### 12.21 Relay compromise

- **Threat:** Remote-access relay reads tokens or injects commands (capability implied by Superset/Paseo remote/mobile docs).
- **Attack path:** Malicious relay, MITM, paired device.
- **Affected boundary:** Any future remote host channel.
- **Detection:** Unexpected claims from new device ids.
- **Prevention:** **Do not build customer remote execution relays in v1.** Staff access stays ordinary authenticated ops surfaces. No phone-authorized side effects.
- **Recovery:** N/A until built; if ever built, mutual auth, device attestation, no T2–T4 from mobile.
- **Residual risk:** None in Phase 0–1 if rejected.
- **Required test:** Design review confirms no relay in Phase 1 deliverables.

### 12.22 Mobile or remote-device compromise

- **Threat:** Stolen phone starts agents or approves sends.
- **Attack path:** Paired device; weak PIN; notification actions.
- **Affected boundary:** Human Decision + remote clients.
- **Detection:** Impossible-travel; new device approvals.
- **Prevention:** No mobile execution control in v1. Approvals for T2+ require full artifact review on an authenticated app session with step-up later.
- **Recovery:** Session revoke; pending approvals cancel.
- **Residual risk:** Compromised laptop already in scope for ops.
- **Required test:** No mobile/remote-host API in Phase 1 surface inventory.

### 12.23 Bad workflow memory

- **Threat:** Unverified chat becomes playbook and later authorizes the wrong action.
- **Attack path:** Auto-promote; cross-tenant generalize; stale SOP.
- **Affected boundary:** Operational Memory.
- **Detection:** Candidate without approver; expired use; contradiction block.
- **Prevention:** Candidate-only until promote; no hosted memory vendor; hash + expiry.
- **Recovery:** Invalidate; conflict set; demote Skill.
- **Residual risk:** Approver error.
- **Required test:** Unapproved candidate cannot be bound into a claim; expired memory excluded.

### 12.24 Excessive platform complexity

- **Threat:** A second Run Manager, second evidence store, or desktop product splits SoT and slows Golden Path.
- **Attack path:** “Just add a workbench schema.”
- **Affected boundary:** Architecture / capability sovereignty.
- **Detection:** Duplicate lifecycle tables; vendor names in workstream keys.
- **Prevention:** This document’s reuse table; kill criteria in §14.
- **Recovery:** Delete the parallel plane before it ships.
- **Residual risk:** Org pressure to “look like” agent IDEs.
- **Required test:** Design review checklist: no new SoT for runs, receipts, memory, or authority.

### 12.25 Loss of customer trust

- **Threat:** Completion theater, hidden uncertainty, or unauthorized send.
- **Attack path:** UI shows “done” from agent status; buried exceptions.
- **Affected boundary:** Customer UX and receipts.
- **Detection:** Exception rate vs delivered; authority incidents; complaints.
- **Prevention:** Receipt-required delivery; visible uncertainty; no silent external actions.
- **Recovery:** Honest failed delivery, revoke, communicate, demote autonomy.
- **Residual risk:** One high-severity incident.
- **Required test:** Customer-visible status cannot say delivered without a passing receipt + required approvals.

### 12.26 Additional boundary: adapter impersonation of GitHub/CI

- **Threat:** Fabricated PR/CI URLs as evidence.
- **Attack path:** Executor-authored “checks passed” without provider pull.
- **Affected boundary:** Evidence providers.
- **Detection:** Provider fetch mismatch; missing independent observation.
- **Prevention:** GitHub is evidence provider only; DC records fetched observations, not pasted badges.
- **Recovery:** Fail verification; classify evidence failure.
- **Residual risk:** Compromised GitHub org.
- **Required test:** Unfetched CI claim is insufficient for software acceptance.

---

## 13. Product metrics

Do **not** optimize agent count, token count, or parallelism by themselves.

| Metric | Definition | Direction |
| --- | --- | --- |
| Accepted outcomes | Customer-accepted deliveries with passing receipts | Maximize quality, not volume alone |
| Time to verified delivery | Request (or cycle observe) → passing receipt | Reduce without hiding QA |
| First-pass verification rate | Passing independent gate on attempt 1 | Increase |
| Rejection rate | Failed receipts / attempts | Watch; high may be healthy if catching false completion |
| Rework rate | Attempts after rejection for same outcome | Reduce after playbooks exist |
| Customer approval burden | Customer decisions per accepted outcome, by risk tier | Reduce T0/T1 interrupts; never reduce T3 checks by rubber-stamping |
| Cost per accepted outcome | Human + owner minutes + AI + tool, DC-computed | Reduce with evidence, not by skipping gates |
| Evidence completeness | Required schemas present, hashed, fresh | Increase to 100% on passing receipts |
| Authority violations | Tool/envelope incidents | Must be ~0 on verified runs |
| Tenant-isolation failures | Cross-org reads/writes | Must be 0 |
| Stale-memory failures | Use of expired/invalidated/candidate memory in claims | Must be 0 |
| Executor reliability | Completions vs crashes/timeouts **after** claim, per capability | Informative; not a promotion input alone |
| Workcell recovery time | Expiry/fail → healthy new attempt or human block | Reduce |
| Workflows with approved playbooks | Recurring workstreams with promoted procedural memory | Increase after stage 2 |
| Actions that remain prepare-only | Share of nodes/runs at `prepare_only` | High at MVP; decrease only with earned autonomy |

Gauntlet already tracks verified completion, hard-gate pass, exceptions, owner/human minutes, impact direction, demotions. Reuse those rather than a parallel dashboard of “agents online.”

Capability Performance Ledger (CS-4) is the comparison surface for implementations. Executors must not write their own scores.

---

## 14. Phased implementation

No phase authorizes Production migration, merge, deploy, secrets, or autonomous external actions.

### Phase 0 — Design and threat model

**This document.**

| | |
| --- | --- |
| Deliverables | `docs/AGENT-WORKBENCH-OUTCOME-MESH-DESIGN-V1.md`; owner-visible decision |
| Non-goals | Application code; deps; memory vendor; desktop; modifying PRs #64/#70/#73 |
| Tests | Link/integrity of this doc; confirm no product files changed |
| Exit evidence | Design review recorded; decision from §16 accepted or revised by owner |
| Kill criteria | Owner finds category conflict with `VISION.md` (agent desktop / marketplace) |
| Owner decisions | Confirm category; confirm §16; confirm remote/mobile/plugins remain rejected |

### Phase 1 — Internal headless Workbench

Staff-only operator/adapter over **existing** runtime and workcell contracts.

| | |
| --- | --- |
| Deliverables | Worktree/workspace operator implementing CS-6; executor adapter invoking envelopes; run lifecycle **hooks into** Execution Runtime + Workstream Runs; logs → redacted traces; evidence insert; human gate pause |
| Non-goals | Desktop app; mobile; plugins; MCP control plane; customer fleet UI; auto-merge; hosted memory; Production writes |
| Tests | Duplicate claim; lease expiry; workspace escape; unauthorized tool; cleanup retains hashes; no merge API |
| Exit evidence | One prepare-only internal workstream completes through isolated execution + evidence without a passing self-claim |
| Kill criteria | Introduces a second Run Manager or evidence store; requires vendor-named workstreams |
| Owner decisions | Where adapters run (existing ops hosts vs new staff VM); whether SF-VA-002 leases land in this phase or with Factory |

### Phase 2 — Outcome Graph and Golden Path

| | |
| --- | --- |
| Deliverables | Compiler from request → frozen graph; node contract enforcement; mapping onto Execution Runtime plans and/or Factory packets; one Golden Path workstream (already-certified, prepare-only) |
| Non-goals | General “any agent, any task”; customer model picker; Foundry automation |
| Tests | Cycle rejection; authority overflow; ineligible pin; empty acceptance criteria |
| Exit evidence | A real recurring outcome compiles, runs, and is reconstructable from graph hash + receipts |
| Kill criteria | Graph becomes unbounded swarm; Golden Path skipped for impressive demos |
| Owner decisions | Which workstream is Golden Path; compiler human-approval policy |

### Phase 3 — Independent verification and Outcome Receipts

| | |
| --- | --- |
| Deliverables | Mesh receipt payload covering §6 fields; hidden tests; contradiction/staleness gates; Gauntlet review binding; economic check at verify |
| Non-goals | Agent-owned validate; auto-impact “improved” |
| Tests | Self-review fail; forged validation; stale evidence; over-limit verify reject; false-completion fixtures |
| Exit evidence | Passing receipt impossible without independent hard gate and required approvals |
| Kill criteria | UI marks complete from executor status |
| Owner decisions | Additive schema vs evidence-payload overlay; freshness windows per workstream |

### Phase 4 — Approved workflow learning

| | |
| --- | --- |
| Deliverables | Promotion pipeline using CS-11; playbook vs generalized method split; Skill candidate path (CS-12) without auto-qualify |
| Non-goals | Hosted memory; vector SoT; modifying PR #64 unless owner later merges it on its own |
| Tests | Candidate cannot route; conflict set; expiry; cross-tenant deny |
| Exit evidence | Second occurrence of Golden Path starts from an inspectable approved playbook |
| Kill criteria | Chat logs stored as policy |
| Owner decisions | Who may approve org playbooks vs platform methods |

### Phase 5 — Earned autonomy by workstream

| | |
| --- | --- |
| Deliverables | Gauntlet autonomy profiles configured from real receipts; demote/suspend paths; still-gated external/sensitive steps |
| Non-goals | Customer-facing “autonomous company”; Level 3+ as default; unmanned product |
| Tests | Unset thresholds hold; authority incident suspends; promotion needs approval |
| Exit evidence | Named workstream reduces customer intermediate-task assignment **inside** existing authority, with exceptions visible |
| Kill criteria | Promotion from activity metrics or vendor marketing |
| Owner decisions | Per-workstream thresholds; whether automatic promotion is ever enabled |

---

## 15. Build versus defer

Classification is about Delegation Cloud’s Outcome Mesh, not about whether Superset/Paseo should exist as external products.

| Item | Classification | Rationale |
| --- | --- | --- |
| Desktop app | **Reject** as DC product; **never add** as customer surface | Recreates worker management; contradicts “never manage an AI workforce.” Staff use `/ops` + CLI |
| CLI | **Build later** (internal) | Headless Workbench and existing scripts. Not a customer agent CLI |
| Local daemon | **Reject** as product architecture; **build later** only as a staff adapter supervisor if Phase 1 needs process reaping | Execution Runtime is SoT, not a local daemon protocol |
| Remote hosts | **Reject** (v1–v4) | Relay compromise; tenant and lease theft. Revisit only with a dedicated security review |
| Mobile access | **Never add** for execution control or T2+ approval shortcuts | Device compromise. Status-only later would still be a separate review |
| Worktrees | **Build later** | CS-6 contract exists; operator not yet a filesystem orchestrator |
| Terminals | **Use as an external reference** | Capture logs as traces. Do not ship a terminal IDE |
| Diff viewer | **Use as an external reference** | GitHub PR review is the human diff surface; DC stores evidence refs |
| Agent adapters | **Build later** | Provider-neutral; qualify before connect; Cursor/Grok currently human-mediated |
| Scheduling | **Build later** | Delegation Spec trigger/cadence + Gauntlet re-entry. Not “overnight agent automations” with merge rights |
| Notifications | **Build later** | Gate and exception alerts only |
| Plugins | **Never add** | Untrusted code with daemon/client access is an authority leak |
| Model selection | **Reject** as customer-facing durable semantics | Provenance only; router may pin implementations internally |
| Memory | **Build later** on CS-11; **never add** hosted/Supermemory | PR #64 is out of scope for this work |
| Approvals | **Build now** (already exists; Mesh reuses) | Extend risk-tiering, do not replace |
| Evidence | **Build now** (already exists; Mesh reuses) | No second store |
| Outcome Receipts | **Build now** (exists) / **build later** for §6 field completeness | Additive, same table/gate |
| Gauntlet | **Build now** (exists) | Mesh feeds it |
| Workflow learning | **Build later** (Phase 4) | After verified Golden Path repetitions |
| Customer-facing autonomy | **Never add** until Phase 5 evidence; even then bounded and revocable | `VISION.md` stage discipline |

Also classified:

| Item | Classification |
| --- | --- |
| MCP server that drives DC workspaces | **Reject** as authority surface |
| Slack/Linear “spin up agents” | **Defer**; if ever, create DC *requests*, not raw agent sessions |
| In-app browser / port preview | **External reference** only |
| Voice control | **Reject** for v1 authority path |
| Comparing 100 agents and merging the winner | **Reject** as product behavior; bounded candidate comparison exists without merge |
| Superset or Paseo as dependency | **Never add** |

---

## 16. Final decision

**`PROCEED_TO_DESIGN_REVIEW`**

### 16.1 Why this option

Evidence from the current architecture and vision:

1. **The control plane already exists in pieces.** Delegation Specs, Workstream Runs, evidence, receipts, Gauntlet, Step 3D workcells, Execution Runtime leases, Executor Envelopes, Execution Context, CS-6 isolation, economic guards, CS-11 memory, capability registry/router, and Software Factory Run Manager are already DC-owned. A new orchestration *product* would compete with them (§3.2, §12.24).
2. **Implementation now would skip the required owner gate.** This task is Phase 0. Phase 1 (internal Workbench) still has owner decisions: adapter host, SF-VA-002 vs runtime leases, Golden Path selection. `VISION.md` forbids automating unproven workflows and skipping stages.
3. **`PROCEED_TO_INTERNAL_WORKBENCH` is premature.** Workspace operators, process supervision, and adapters are real gaps (CS-6 “next implementation step”; Factory SF-VA-002; no approved Cursor/Grok connectors). Building them before this threat model is accepted risks a parallel daemon that looks like Paseo and violates capability sovereignty.
4. **`DEFER_AND_FOCUS_ON_GOLDEN_PATH` is the right *product* emphasis after review, not a reason to skip the review.** Golden Path is Phase 2 and remains the customer-facing priority (strategic thesis: structured execution under a horizontal front door). The Mesh must be accepted as a thin binding layer so Golden Path does not invent a third lifecycle.
5. **`REJECT_AS_OVERBUILT` is too strong.** Isolated execution, leases, independent verification, and proof-carrying receipts are already in doctrine and schema. Rejecting the Mesh would leave those contracts unbound. What *is* overbuilt — desktop, mobile, plugins, relays, hosted memory, 100-agent races — is already classified reject/never.

### 16.2 What design review must confirm

- Category remains outcome OS / proof-carrying platform, not agent desktop.
- No competing SoT.
- Remote/mobile/plugins/hosted memory stay out.
- PRs #64, #70, and #73 stay untouched by Mesh implementation.
- Next engineering slice after approval is the smallest of: (a) Golden Path compilation onto existing runs, or (b) CS-6 workspace operator + lease enforcement for prepare-only internal work — not both as a platform rewrite.

### 16.3 Recommended implementation order after approval

1. Keep serving managed delegation on current `/app` and `/ops`.
2. Freeze one Golden Path workstream’s Delegation Spec and acceptance tests.
3. Add only the missing isolation/lease adapter those tests require (Phase 1, prepare-only).
4. Turn on Mesh receipt fields and hidden tests (Phase 3) on that path.
5. Promote playbooks from accepted repetitions (Phase 4).
6. Configure autonomy thresholds only with evidence (Phase 5).

Until design review is recorded, **do not implement application code for this Mesh.**

---

## Appendix A — Reference primitive extraction (non-authoritative)

Inspected 2026-09-08 from public materials only:

- [superset-sh/superset README](https://github.com/superset-sh/superset) and [docs.superset.sh](https://docs.superset.sh): isolated git worktrees, parallel agent processes, terminals, diff viewer, in-app browser/ports, scheduled automations, remote hosts, CLI/SDK/MCP, provider adapters, notifications, skills provisioned at launch. License metadata: Elastic License 2.0. Not installed.
- [getpaseo/paseo README](https://github.com/getpaseo/paseo): local daemon, desktop/mobile/web/CLI clients, multi-provider agent processes, worktrees, encrypted relay option, plugins, TypeScript client, Docker daemon. License metadata: Apache-2.0. Not installed.

No code was copied. No inference that these products provide DC-grade tenant isolation, receipts, or authority leases.

## Appendix B — PR exclusion list

This design must not modify:

| PR | Title | Head |
| --- | --- | --- |
| [#64](https://github.com/Bthornton1994/Virtual-Assistant/pull/64) | Governed memory control plane foundation | `agent/memory-control-plane-v1` |
| [#70](https://github.com/Bthornton1994/Virtual-Assistant/pull/70) | Agent Reliability and Evaluation v1 | `cursor/agent-reliability-evaluation-v1-28b6` |
| [#73](https://github.com/Bthornton1994/Virtual-Assistant/pull/73) | Runtime-backed agent evaluation suite | `cursor/runtime-backed-agent-evaluation-v1-28b6` |

Those drafts are adjacent (memory persistence; eval/trace harnesses). They are not Mesh SoT and are not to be edited to “make the Mesh fit.”

## Appendix C — Unresolved decisions (owner)

1. Which certified workstream is Golden Path for Phase 2.
2. Whether Software Factory leases (SF-VA-002) merge into Execution Runtime leases or remain an overlay with the same invariants.
3. Whether Mesh receipt §6 fields are additive columns, a typed evidence payload, or both.
4. Whether any staff VM may host executor processes, vs remaining on human-mediated handoff until connectors are qualified.
5. Freshness windows per workstream beyond Factory’s 72h default.
6. Eventual fate of PR #64 relative to CS-11 (out of scope here).

None of these authorize skipping human-gated PRs or deployments.

## Appendix D — Software Factory routing note

This document is design-only.

- `REQUESTED_MODEL`: grok-4.6 (Software Factory default implementer)
- `ACTUAL_MODEL`: recorded by the executing agent runtime
- `PLANNER_ESCALATION`: NOT REQUIRED — architectural direction is already constrained by `VISION.md` and existing CS/Gauntlet contracts; this artifact red-teams and binds them rather than opening a new product category
- `MODEL_ROUTING_EXCEPTION`: none intended

Planner auto-delegation was not used.
