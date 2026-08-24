# Delegation Cloud Capability Sovereignty

Status: **Owner-approved architectural objective, 2026-08-24.**

This document defines how Delegation Cloud should absorb useful ideas from external agent frameworks, models, memory systems, orchestration tools, coding environments, research connectors, and specialist runtimes without allowing those products to become Delegation Cloud's architecture.

`VISION.md` remains the governing product constitution. `docs/DELEGATION-CLOUD-STRATEGIC-THESIS.md` remains the company thesis. This document defines the architectural doctrine for executor independence, native capability ownership, external-tool adoption, and capability harvesting.

---

## 1. The doctrine

Delegation Cloud should own every abstraction necessary to:

- interpret delegated business intent;
- compile intent into an executable contract;
- define authority and approval boundaries;
- describe required execution capabilities;
- route work to a suitable executor;
- constrain what that executor may do;
- collect evidence and provenance;
- independently verify consequential work;
- calculate operational state and economics;
- determine completion;
- learn from repeated execution;
- version reusable procedures;
- promote or demote autonomy based on evidence.

Third-party systems may provide execution capacity beneath these abstractions, but they must not define Delegation Cloud's operating model.

> **Delegation Cloud defines interfaces and authority. Implementations compete to satisfy those interfaces.**

A model provider, agent framework, code-context system, browser runtime, workspace manager, or specialist tool may disappear without making the Delegation Cloud operating model incoherent.

The desired dependency is tactical or economic, never conceptual.

---

## 2. Capability sovereignty, not tool ownership

Capability sovereignty does **not** mean rebuilding every useful product internally.

It means Delegation Cloud owns the contract by which a useful capability enters the system.

For every external capability, choose one of five treatments:

### Native

Delegation Cloud should own the capability because it is central to authority, verification, learning, routing, or defensibility.

Examples:

- Delegation Specs;
- authority envelopes;
- executor registry;
- evidence contracts;
- deterministic gates;
- Outcome Receipts;
- Gauntlet lifecycle;
- autonomy policy;
- capability performance history.

### Adapter

The capability is commodity infrastructure better supplied externally behind a Delegation Cloud interface.

Examples may include:

- model inference providers;
- search APIs;
- browser runtimes;
- media rendering engines;
- OCR or transcription services;
- email, calendar, CRM, and commerce APIs.

### Hybrid

Delegation Cloud owns the control logic and verification contract but delegates the expensive or specialized execution.

Examples:

- public-web research;
- software engineering;
- specialist analysis;
- video production;
- browser/computer-use work.

### Benchmark-only

An external project is useful as a reference implementation or source of design ideas but does not need to become a runtime dependency.

### Reject

The capability adds more architectural coupling, operational risk, or complexity than the value it creates.

The default question is not:

> Should Delegation Cloud integrate this tool?

It is:

> What capability does this tool demonstrate, should Delegation Cloud own that capability, and what is the smallest replaceable interface required to obtain the value?

---

## 3. The target architecture

```text
CUSTOMER / BUSINESS INTENT
          |
          v
+----------------------------------------------+
| INTENT / CONTRACT PLANE                      |
| Outcome                                      |
| Delegation Spec                              |
| Definition of Done                           |
| Authority Envelope                           |
| Approval Policy                              |
| Economic Envelope                            |
+----------------------+-----------------------+
                       |
                       v
+----------------------------------------------+
| CONTROL PLANE                                |
| Workstreams                                  |
| Gauntlet                                     |
| Run Lifecycle                                |
| Routing                                      |
| Recovery / Retry                             |
| Exception Management                         |
| Autonomy Controller                          |
+----------------------+-----------------------+
                       |
                       v
+----------------------------------------------+
| EXECUTION CAPABILITY KERNEL                  |
| Research                                     |
| Reasoning                                    |
| Retrieval                                    |
| Browser / Computer Use                       |
| API Execution                                |
| Deterministic Computation                    |
| Software Engineering                         |
| Communication                                |
| Data Transformation                          |
| Document Operations                          |
| Monitoring                                   |
| Planning                                     |
| Reconciliation                               |
| Specialist Escalation                        |
+----------------------+-----------------------+
                       |
          +------------+-------------+
          |            |             |
          v            v             v
     DC-native      external       human /
     capability     executor       specialist
          |            |             |
          +------------+-------------+
                       |
                       v
+----------------------------------------------+
| EVIDENCE / VERIFICATION PLANE                |
| Typed Evidence Artifacts                     |
| Provenance                                   |
| Independent Review                           |
| Deterministic Validation                     |
| Outcome Receipt                              |
| Authority Audit                              |
| Economics                                    |
+----------------------+-----------------------+
                       |
                       v
+----------------------------------------------+
| LEARNING PLANE                               |
| Operational Graph                            |
| Failure Taxonomy                             |
| Capability Performance                       |
| Skill / Procedure Versions                   |
| Routing Evidence                             |
| Earned Autonomy                              |
+----------------------------------------------+
```

External products belong below the capability contracts, never above them.

---

## 4. Capability contracts

The long-term routing unit should be a **capability requirement**, not a vendor name.

Example:

```json
{
  "capability": "evidence_research",
  "authorityClass": "prepare_only",
  "requiredEvidence": ["primary-source URL", "access timestamp", "claim binding"],
  "market": "US",
  "economicLimitMicros": 2000000,
  "verificationContract": "catalog-evidence-packet/v1"
}
```

The router may satisfy that request with:

- a Delegation Cloud-native researcher;
- Hermes;
- Grok;
- another model or agent;
- deterministic retrieval;
- a human analyst.

The calling workstream must not depend on which implementation was selected.

### Minimum capability metadata

Every registered capability implementation should eventually expose:

- stable implementation key;
- capability keys;
- executor kind;
- provider/runtime;
- model identifier where relevant;
- input contract versions;
- output contract versions;
- allowed tool classes;
- authority ceiling;
- data-sensitivity compatibility;
- expected cost model;
- expected latency class;
- verification requirements;
- known failure classes;
- health state;
- qualification status.

Historical performance belongs to Delegation Cloud, not to the executor's self-description.

---

## 5. Native executor protocol

Delegation Cloud should standardize the execution boundary so every executor receives the same classes of operating information.

Conceptually:

```text
ExecutorInput
- runId
- objective
- frozen inputs
- constraints
- authority envelope
- approval requirements
- available capabilities/tools
- expected output schema
- evidence requirements
- economic ceiling
- deadline/SLA
- provenance requirements

ExecutorOutput
- result
- evidence
- actions attempted
- unresolved questions
- escalations
- authority report
- human minutes
- AI/tool usage
- execution trace/provenance
```

The executor may reason about the work. It does not own authoritative run state.

Delegation Cloud parses, validates, persists, verifies, and determines whether the result advances the lifecycle.

---

## 6. Native structured-output and evidence runtime

The Step 3D work cell establishes an important native primitive:

```text
executor output
      |
      v
schema parsing
      |
      v
contract validation
      |
      v
evidence binding
      |
      v
deterministic calculations
      |
      v
policy / authority checks
      |
      v
immutable evidence artifact
```

This pattern should generalize beyond Loadout.

Models and agents may propose facts, corrections, actions, and judgments. They must not supply authoritative aggregate counts, lifecycle state, autonomy decisions, or hard-gate results when those can be calculated by software.

A malformed or rejected executor result remains an auditable failed execution, not something silently repaired into success.

---

## 7. Native tool and action abstraction

Executors should not receive broad ambient computer access merely because their runtime supports it.

Delegation Cloud should progressively expose explicit action classes such as:

```text
web.search
web.fetch
browser.navigate
browser.click
browser.type
github.read
github.branch
github.commit
email.read
email.draft
email.send
calendar.read
calendar.schedule
database.read
database.write
filesystem.read
filesystem.write
```

A Delegation Spec and executor assignment determine which action classes are available for a run.

The runtime implementation can change without changing the authority semantics.

---

## 8. Native execution sandbox

Longer term, every consequential executor assignment should receive an explicit execution context:

```text
ExecutionContext
- allowedTools
- allowedDomains
- allowedRepositories
- allowedOrganizations
- allowedDataScopes
- allowedActions
- maxSpend
- maxRuntime
- externalCommunicationPolicy
- approvalRequirements
```

An executor cannot expand its own context.

Tool credentials remain outside prompts and executor-authored artifacts. Delegation Cloud grants narrowly scoped capability access through controlled adapters where possible.

---

## 9. Native memory architecture

Delegation Cloud should learn from agent-memory products without allowing model memory to become business truth.

Distinguish at least:

### Working memory
Temporary context for one run or tightly related execution sequence.

### Operational memory
Verified facts about how work is performed.

### Entity memory
Verified facts about customers, vendors, systems, people, products, and other operational entities.

### Procedural memory
Versioned, tested methods for performing recurring work.

### Preference memory
Authorized user or organization preferences with scope and provenance.

### Historical memory
Past runs, outcomes, decisions, exceptions, and corrections.

Important memory should carry:

- source;
- scope;
- timestamp;
- verification status;
- approver where relevant;
- expiration/review date where relevant.

An executor memory is advisory until promoted through an authorized Delegation Cloud knowledge path.

---

## 10. Native Skill model

A Delegation Cloud Skill should be more than a prompt file.

A mature Skill should contain or reference:

- capability provided;
- applicability conditions;
- required inputs;
- procedure;
- tool requirements;
- authority ceiling;
- output contract;
- evidence requirements;
- verification contract;
- known failure modes;
- economic profile;
- historical qualification evidence;
- version;
- content hash;
- provenance;
- status: candidate / shadow / qualified / suspended / retired.

The progression is:

```text
repeated successful behavior
        |
        v
candidate procedure
        |
        v
versioned Skill
        |
        v
shadow qualification
        |
        v
qualified Skill
        |
        v
Routine candidate
        |
        v
bounded earned autonomy
```

An executor may propose a Skill revision. It does not silently change production procedure.

---

## 11. Native evaluator and critic fabric

`reviewer` should become a capability, not a permanent Grok role.

A Review Contract should specify:

- artifact or assertion being challenged;
- claims requiring independent verification;
- accepted evidence types;
- severity policy;
- independence requirements;
- review output schema;
- escalation policy.

Possible implementations may include:

- another model;
- a different model family;
- deterministic validation;
- a specialist;
- a human operator;
- multiple independent reviewers for higher-risk work.

Delegation Cloud decides whether the combined evidence passes.

---

## 12. Context Provider interface

External projects such as Graft and Codebase Memory demonstrate that agents waste substantial time and tokens repeatedly rediscovering repository structure.

Delegation Cloud should treat code context as a replaceable **Context Provider** capability.

Potential interface:

```text
ContextProvider
- build
- refresh
- architecture
- findSymbol
- findCallers
- impactAnalysis
- search
- health
```

Important rules:

- the context graph is derived from repository source;
- it is a regenerable cache, not authoritative architecture;
- stale-context detection is required;
- generated summaries cannot silently become design policy;
- sensitive-code processing must honor data policy;
- competing implementations should be benchmarked on real Delegation Cloud and portfolio tasks.

Possible implementations today include Graft, Codebase Memory, or a future native provider.

---

## 13. Workspace isolation interface

Orca demonstrates a useful engineering principle: parallel coding agents should not manipulate the same working tree.

Delegation Cloud should eventually represent engineering workspaces explicitly.

Conceptual record:

```text
EngineeringWorkspace
- workspaceId
- repository
- baseSha
- branch
- worktree/container reference
- executor assignment
- startedAt
- resultSha
- cleanup state
```

One engineering candidate should have one isolated workspace.

Parallel implementations may be compared through evidence rather than combined through uncontrolled shared state.

---

## 14. Role contracts, not persona inventories

Agency-style agent libraries are useful as catalogs of task decomposition and specialist responsibilities, but Delegation Cloud should not create hundreds of named personas as architecture.

Extract reusable **Role Contracts**:

```text
RoleContract
- mission
- required capabilities
- required inputs
- expected output contract
- allowed authority
- forbidden actions
- known failure modes
- fallback behavior
- evaluation suite
- cost/latency expectations
```

A role may be filled by multiple implementations.

Role contracts should remain few enough to govern and broad enough to reuse.

---

## 15. Research Connector interface and source trust

Agent-Reach-like systems demonstrate the value of broad public-source access, but access does not equal authority.

Delegation Cloud should normalize research acquisition through a connector contract:

```text
ResearchConnector
- platform
- auth mode
- capabilities
- source trust tier
- health
- source URL
- accessedAt
- raw artifact hash
```

Suggested evidence hierarchy:

1. official/primary authority;
2. recognized institutional source;
3. reputable secondary source;
4. community/social evidence;
5. unverified user-generated content.

A source may be useful without being sufficient to support a consequential claim.

Connector health should be observable so an executor cannot silently treat an unavailable or expired source channel as valid coverage.

---

## 16. Specialist pipeline interface

OpenMontage demonstrates a strong pattern for specialist work: staged execution, provider selection, approval gates, cost visibility, replayable production, and final QA.

Delegation Cloud should extract the pattern rather than absorb a media-specific architecture.

A specialist pipeline may consist of:

```text
plan
 -> stage outputs
 -> approval gates
 -> specialist/provider execution
 -> technical validation
 -> business QA
 -> delivery
 -> replay/provenance
```

The same pattern can apply to media production, procurement research, design, financial reconciliation, or other specialist domains.

---

## 17. Engineering execution principles

pstack and similar engineering frameworks reinforce several practices that should remain independent of the coding environment:

- investigate before editing;
- settle invariants and data shape before cross-boundary implementation;
- prefer the smallest sufficient change;
- use deterministic tests for deterministic behavior;
- independently challenge consequential changes;
- inspect blast radius, not only the direct code path;
- prove real runtime behavior where compilation cannot establish correctness;
- encode repeated lessons into structure rather than repeating warnings in prose;
- use experiments to resolve reversible technical uncertainty instead of escalating every question to the owner.

These are Delegation Cloud engineering standards, not dependencies on any one coding product.

---

## 18. Capability Harvest protocol

Every external system considered for Delegation Cloud should go through the same process.

### Step 1: Inventory

Identify the actual capabilities demonstrated by the project. Ignore marketing labels and persona names.

### Step 2: Map

Map each capability to an existing Delegation Cloud interface or identify a genuine interface gap.

### Step 3: Classify

Choose Native, Adapter, Hybrid, Benchmark-only, or Reject.

### Step 4: Benchmark

Where execution quality matters, test the capability on representative Delegation Cloud or portfolio work.

Measure at minimum where applicable:

- correctness;
- hard-gate pass rate;
- false acceptance rate;
- authority incidents;
- owner intervention;
- latency;
- AI/tool cost;
- human cost;
- operational complexity;
- failure recovery;
- provenance quality.

### Step 5: Extract

Document the design pattern or behavior that created the value.

### Step 6: Internalize where strategic

Implement a Delegation Cloud-owned interface or native primitive when the capability materially affects control, verification, learning, routing, authority, or defensibility.

### Step 7: Keep competition

Even when a native implementation exists, external implementations may continue to compete beneath the same capability contract if they provide better economics or performance.

---

## 19. Current capability harvest map

This map records the current architectural lesson, not a permanent vendor commitment.

| Source | Useful pattern | Delegation Cloud treatment |
|---|---|---|
| Hermes | tool-using research/execution runtime, composable workflows | Hybrid executor behind capability contracts |
| Grok | evidence-heavy judgment, independent challenge | Hybrid reviewer/research executor behind capability contracts |
| OpenRouter | provider/model normalization and usage accounting | Adapter behind native model-provider abstraction |
| Graft | derived code graph, fast codebase orientation | Benchmark candidate for Context Provider |
| Codebase Memory MCP | structural graph, callers, routes, blast radius | Benchmark candidate for Context Provider |
| Agency Agents | specialist decomposition, role contracts, evaluator separation | Benchmark-only pattern library; extract Role Contracts |
| Orca | isolated worktrees, parallel candidate execution | Extract Workspace Isolation; optional implementation |
| Agent-Reach | broad source acquisition, channel health | Extract Research Connector and trust tiers |
| OpenMontage | staged specialist pipeline, approval gates, cost/replay | Extract Specialist Pipeline pattern; potential future executor |
| pstack | investigation, architecture-first execution, adversarial verification, empirical engineering | Engineering principles; no runtime dependency required |

No row in this table grants authority or guarantees permanent use.

---

## 20. Routing should become empirical

The eventual router should select implementations based on observed evidence rather than brand preference.

Example internal comparison:

```text
evidence_research

implementation A
- hard-gate pass rate: 94%
- false accepts: 0.5%
- median cost: X
- median latency: Y

implementation B
- hard-gate pass rate: 91%
- false accepts: 0.2%
- median cost: Z
- median latency: W
```

Risk class and verification requirements may justify choosing a more expensive implementation.

The lowest-cost executor is not automatically the correct executor.

The executor should not score itself.

---

## 21. Strategic capabilities Delegation Cloud should own

The following are presumptively native because they define Delegation Cloud's operating model:

- business-intent compilation;
- Delegation Specs;
- authority and approval policy;
- capability requirements;
- executor identity and assignment provenance;
- lifecycle state;
- evidence contracts;
- deterministic gate logic;
- Outcome Receipts;
- exception/recovery state;
- executor economics;
- capability performance history;
- Skill qualification state;
- Routine qualification state;
- operational knowledge provenance;
- autonomy promotion/demotion decisions.

External implementations may contribute evidence into these systems. They do not own them.

---

## 22. Dependency test

Before accepting a new architectural dependency, ask:

1. What capability are we acquiring?
2. Could the same capability be provided by another implementation without changing the calling workstream?
3. Does this dependency define authority, state, verification, or memory that Delegation Cloud should own instead?
4. Is the external product becoming a source of truth?
5. Can the implementation be removed without invalidating historical evidence?
6. Are credentials, data, and permissions scoped to the capability actually required?
7. Can performance and economics be measured independently?
8. Does the dependency improve Hands-Off Verified Completion?
9. Are we adopting a capability, or accidentally adopting someone else's architecture?

If the answer to the last question is the latter, redesign the boundary before adoption.

---

## 23. End state

Delegation Cloud should become stronger as underlying technology changes.

A better foundation model should improve the system without redefining it.

A better coding agent should be able to replace the current engineering executor.

A better context engine should be able to replace the current code-context implementation.

A better research connector should expand coverage without redefining source trust.

A native capability should be able to replace an external worker without changing customer-facing workstreams.

The company should accumulate:

- verified operating procedures;
- capability contracts;
- execution evidence;
- failure knowledge;
- routing intelligence;
- authority policy;
- customer operational knowledge;
- qualification suites;
- outcome economics.

That accumulated operating intelligence is more durable than dependence on any individual model or tool.
