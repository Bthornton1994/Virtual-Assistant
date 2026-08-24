# Capability Sovereignty Implementation Roadmap

Status: **Execution roadmap for the owner-approved Capability Sovereignty objective.**

This roadmap converts `docs/CAPABILITY-SOVEREIGNTY.md` into staged implementation work. It is deliberately sequenced so the current Step 3D work-cell proving ground can continue without being destabilized by a broad refactor.

The rule is simple:

> **Do not replace a proven working boundary with a speculative abstraction. First prove the interface against real work, then generalize it.**

---

## Current dependency

Step 3D currently uses named implementations:

```text
prepare  -> hermes-loadout-researcher-v1
review   -> grok-loadout-reviewer-v1
validate -> catalog-evidence-validator-v1
```

That is acceptable for the proving ground because executor identity is frozen for repeatability.

It is not the desired permanent abstraction.

The target becomes:

```text
prepare requires:
  evidence_research

review requires:
  independent_evidence_review

validate requires:
  deterministic_catalog_validation

routing policy selects qualified implementations.
```

Runs 4-9 should therefore complete before materially changing the current experiment protocol unless a safety defect requires correction.

---

# Phase CS-0 — Doctrine and governance

Status: **This architecture PR.**

Deliverables:

- `VISION.md` explicitly adopts Capability Sovereignty.
- `docs/CAPABILITY-SOVEREIGNTY.md` becomes the canonical doctrine that extends the strategic thesis's existing executor-interchangeability principle.
- `docs/CAPABILITY-SOVEREIGNTY-ROADMAP.md` defines the implementation sequence.
- `AGENTS.md` requires dependency/capability analysis for consequential architecture changes.

Exit gate:

- governing docs agree that external tools are implementations, not product architecture;
- no external tool receives new authority;
- no Step 3D experiment behavior changes.

---

# Phase CS-1 — Capability vocabulary and registry

Timing: **After Step 3D work-cell qualification begins producing stable evidence.**

Goal: describe what an executor can do separately from who the executor is.

## 1. Capability registry

Add a small native registry such as:

```text
capabilities
- id
- key
- display_name
- description
- risk_class
- input_contract_versions
- output_contract_versions
- verification_contract
- status
```

Initial candidate capability keys:

```text
evidence_research
independent_evidence_review
deterministic_catalog_validation
public_web_retrieval
software_repository_read
software_change_prepare
software_change_verify
structured_data_transform
business_research
specialist_escalation
```

Do not create dozens of speculative capabilities.

## 2. Executor-capability mapping

Add a join such as:

```text
executor_capabilities
- executor_profile_id
- capability_id
- qualification_status
- qualification_version
- evidence_summary
- effective_from
- suspended_at
```

An executor may support many capabilities. A capability may have many implementations.

## 3. Preserve Step 3D compatibility

The existing `executor_profiles.role` field may remain during migration.

Do not break Runs 4-9 merely to remove the word `researcher` or `reviewer`.

Exit gate:

- the system can query qualified implementations for a capability;
- no routing is autonomous yet;
- the current Hermes/Grok assignments continue to work unchanged.

---

# Phase CS-2 — Executor Protocol v1

Goal: standardize the cross-executor boundary.

Create a versioned contract for executor input/output that can wrap domain-specific artifacts.

Conceptual envelope:

```text
ExecutorEnvelopeV1
- schemaVersion
- runId
- assignmentId
- capabilityKey
- objective
- inputArtifactRefs
- authoritySnapshot
- allowedToolClasses
- outputContract
- evidenceRequirements
- economicLimit
- deadline
- executorConfigurationSnapshot
```

Output envelope:

```text
ExecutorResultV1
- schemaVersion
- runId
- assignmentId
- capabilityKey
- status
- outputArtifactRef or candidate payload
- evidence refs
- escalation
- authority report
- economics
- execution provenance
```

Important:

- domain packets such as `catalog-evidence-packet/v1` remain valid;
- the executor envelope wraps the assignment context rather than replacing the domain evidence contract;
- authoritative lifecycle state remains outside the agent output.

Exit gate:

- two materially different executor implementations can accept the same capability envelope and return valid results without changing the workstream contract.

---

# Phase CS-3 — Capability Router v1

Goal: choose among qualified implementations based on evidence.

Initial router must be conservative.

Inputs:

- required capability;
- authority class;
- data sensitivity;
- workstream risk class;
- contract version compatibility;
- qualification status;
- executor health;
- cost ceiling;
- latency/SLA;
- historical QA evidence.

Initial policy:

1. filter out unqualified, suspended, incompatible, or over-authority implementations;
2. apply deterministic routing policy;
3. log why the implementation was selected;
4. no self-promotion by an executor;
5. no model-generated routing state becomes authoritative without deterministic policy validation.

Do not begin with reinforcement learning or opaque dynamic routing.

Exit gate:

- routing is reproducible from stored inputs;
- every selection has a reason artifact;
- manual pinning remains available for experiments and incident recovery.

---

# Phase CS-4 — Capability performance ledger

Goal: make implementations compete on evidence.

Track at capability + implementation + contract version level:

- total runs;
- hard-gate pass rate;
- false acceptance rate where benchmark truth exists;
- false rejection/escalation rate;
- authority incidents;
- human intervention minutes;
- correction rate;
- median and percentile latency;
- AI/tool cost;
- total cost per accepted outcome;
- evidence completeness;
- rollback/retry rate;
- applicable benchmark suite/version.

Never let the executor write its own authoritative performance score.

Exit gate:

- Delegation Cloud can compare two implementations for the same capability from stored outcome evidence.

---

# Phase CS-5 — Context Provider bakeoff

Goal: harvest Graft and Codebase Memory concepts without adopting either as architecture.

Create a `ContextProvider` interface or experiment harness with:

```text
build
refresh
architecture
findSymbol
findCallers
impactAnalysis
search
health
```

Benchmark conditions on Delegation Cloud and Loadout:

1. cold agent;
2. agent + Graft;
3. agent + Codebase Memory;
4. future native/other provider if useful.

Use identical unseen tasks.

Measure:

- correct answer/change;
- affected-file recall;
- false structural conclusions;
- token use;
- tool calls;
- wall time;
- setup/maintenance burden;
- stale-context incidents;
- privacy/data handling.

Decision after evidence:

- Adapter;
- Hybrid;
- Native subset;
- Reject.

Do not deploy both portfolio-wide before the bakeoff.

---

# Phase CS-6 — Workspace Isolation v1

Goal: internalize the strongest Orca principle without making Orca the scheduler.

Add an engineering-workspace abstraction for coding executor assignments.

Requirements:

- one candidate implementation per isolated branch/worktree/container;
- frozen base SHA;
- executor identity/config snapshot;
- result SHA;
- evidence of verification;
- cleanup lifecycle;
- no shared mutable working tree between competing agents.

Then enable bounded multi-candidate experiments:

```text
same objective
  -> candidate A
  -> candidate B
  -> candidate C
  -> independent comparison
  -> selected patch
```

Exit gate:

- parallel candidates cannot corrupt one another's working state;
- comparison is evidence-based;
- merge authority remains separate.

---

# Phase CS-7 — Role Contract library

Goal: harvest useful specialist decomposition from Agency Agents without creating a 200-agent persona catalog.

Create a small versioned role-contract schema:

```text
RoleContract
- key
- mission
- requiredCapabilities
- inputContracts
- outputContracts
- allowedAuthorityClass
- forbiddenActions
- knownFailureModes
- fallbackPolicy
- evaluationSuite
```

Start only with roles required by demonstrated workstreams.

Likely early roles:

- Evidence Researcher
- Independent Reviewer
- Engineering Executor
- Engineering Reviewer
- Business Researcher
- Human Specialist

A role is not an executor identity.

Exit gate:

- at least two implementations can satisfy one role contract;
- no role grants authority beyond the Delegation Spec.

---

# Phase CS-8 — Research Connector and trust model

Goal: broaden public research coverage without confusing access with evidence authority.

Create connector metadata:

```text
platform
authMode
capabilities
health
trustTier
sourceUrl
accessedAt
rawArtifactHash
```

Add source trust classifications and evidence requirements.

Evaluate Agent-Reach-like approaches only behind this interface.

Exit gate:

- connector outage/auth expiry is visible;
- social/community sources cannot satisfy a primary-authority gate accidentally;
- all research artifacts retain source provenance.

---

# Phase CS-9 — Model Provider abstraction

Goal: make OpenRouter useful but replaceable.

Create native concepts for:

```text
ModelProvider
ModelConfiguration
InferenceRequest
InferenceResult
Usage
Cost
Latency
DataPolicy
Health
FallbackPolicy
```

Adapters can include OpenRouter, direct providers, or future local inference.

Routing should compare measured provider/model performance by capability.

Exit gate:

- a provider can be replaced without changing the workstream or Skill contract;
- cost and latency remain attributable;
- model/provider changes are versioned in execution provenance.

---

# Phase CS-10 — Tool Runtime and Execution Context

Goal: stop treating an agent runtime's ambient tool access as authority.

Create explicit tool classes and an Execution Context generated from the Delegation Spec and assignment.

First implementation can remain advisory/recorded if enforcement cannot yet be centralized, but the target is enforceable scoped adapters.

Exit gate:

- authorized tool classes are explicit and snapshot per assignment;
- attempts outside the envelope are detectable and block verification;
- sensitive credentials are never embedded into agent-authored prompts/artifacts.

---

# Phase CS-11 — Memory and Operational Graph hardening

Goal: turn useful memory into governed operational knowledge.

Add typed classes for:

- working context;
- operational facts;
- entity facts;
- procedures;
- preferences;
- historical outcomes.

Every promoted operational fact needs provenance and scope.

Exit gate:

- executor memory cannot silently become organization policy;
- conflicting facts can coexist as unresolved evidence rather than being overwritten;
- knowledge can be invalidated or expired.

---

# Phase CS-12 — Native Skill Registry

Goal: make Skills first-class Delegation Cloud operational objects.

Do not begin this until Step 3E establishes what qualification evidence actually matters.

Native Skill metadata should include:

- capability;
- version/hash;
- procedure artifact;
- tool requirements;
- authority ceiling;
- input/output contracts;
- qualification suite;
- qualification history;
- economic profile;
- known failure classes;
- status.

External runtime skill formats may be generated from the canonical Delegation Cloud Skill but must not become the source of truth.

Exit gate:

- Hermes/Grok/other runtime instructions can be regenerated from one canonical qualified Skill definition;
- a runtime-specific Skill can disappear without losing the company's procedure.

---

# Phase CS-13 — Specialist Pipeline framework

Goal: generalize the staged-pipeline lesson from OpenMontage.

Use only when a real specialist workstream requires it.

Potential framework:

```text
plan
-> staged deliverables
-> approvals
-> provider/specialist execution
-> deterministic technical checks
-> business QA
-> delivery
-> replay/evidence
```

Exit gate:

- first real specialist domain proves reuse without introducing a domain-specific parallel control plane.

---

# Relationship to the current roadmap

Capability Sovereignty is **not** a replacement for the Step 3 / Step 4 portfolio proving sequence.

The immediate execution order remains:

```text
PR #14 is merged and QA-qualified
    -> Step 3D-1 / 3D-2 complete
    -> Run 4 work-cell test
    -> repeat to stable pre-Skill work-cell behavior
    -> Step 3E Skill extraction and qualification
    -> Step 4 Grounded portability test
```

Capability Sovereignty runs alongside that sequence as follows:

- CS-0 now: doctrine only;
- CS-1 and CS-2 may begin after Run 4/5 if they do not alter the frozen experiment;
- CS-3/4 should use real Step 3 qualification evidence;
- CS-12 should use Step 3E evidence rather than being invented ahead of it;
- Grounded becomes the first major proof that capability contracts generalize across domains.

The strongest proof of Capability Sovereignty will not be a document. It will be this:

> **A Grounded workstream can reuse the Delegation Cloud capability, evidence, verification, and autonomy architecture while selecting different implementations where appropriate.**

---

# Non-goals

Do not:

- rewrite Delegation Cloud around a plugin framework;
- recreate every open-source project internally;
- build a foundation model;
- create hundreds of agent personas;
- introduce opaque autonomous routing before qualification evidence exists;
- allow runtime memory to become company policy;
- let model choice determine authority;
- add multiple overlapping context systems without a benchmark;
- create a second evidence/receipt/autonomy system for a specialist domain;
- block Step 3 on speculative platform abstractions.

---

# Success criteria

Capability Sovereignty is working when:

1. Workstreams request capabilities instead of named products.
2. Multiple implementations can satisfy the same capability contract.
3. Delegation Cloud can compare those implementations empirically.
4. Switching an implementation does not change authority semantics.
5. Switching an implementation does not invalidate historical evidence.
6. Native business knowledge, Skills, and autonomy evidence remain in Delegation Cloud.
7. External tools can be removed without making the operating model incoherent.
8. Useful external innovations improve Delegation Cloud even when the external project itself is never adopted.
9. Hands-Off Verified Completion improves while authority incidents remain zero.
