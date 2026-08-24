# Agent Instructions

## Project vision

Read `VISION.md` and `README.md` before planning substantial changes to request intake, workstreams, routing, AI behavior, automation, operator tools, approvals, quality assurance, customer data, security, monetization, architecture, or scope.

For substantial work involving Delegation Cloud autonomy, portfolio operation, outcome execution, workstream certification, executor routing, external agent/tool adoption, or the long-term business model, also read:

- `docs/DELEGATION-CLOUD-STRATEGIC-THESIS.md`
- `docs/AUTONOMOUS-PORTFOLIO-EXECUTION-PLAYBOOK.md`
- `docs/GAUNTLET-LOOP.md`
- `docs/STEP-3D-WORK-CELL.md`
- `docs/CAPABILITY-SOVEREIGNTY.md`
- `docs/CAPABILITY-SOVEREIGNTY-ROADMAP.md`

`VISION.md` remains the governing product constitution. The strategic thesis is an owner-approved direction to test, not authority to bypass the vision. The execution playbook is an implementation sequence, not evidence that autonomy, product-market fit, or software-like economics have already been achieved. The Gauntlet Loop defines the execution-control and earned-autonomy evidence path; it does not grant authority beyond a Delegation Spec. The work cell defines how several replaceable executors staff one attempt; it grants no authority either. Capability Sovereignty defines how external executors, frameworks, providers, memory systems, context engines, and specialist tools may enter the architecture: as replaceable implementations behind Delegation Cloud-owned contracts, never as sources of authority or product truth.

## Executors and authoritative state

An AI worker may produce evidence and judgments. It may never own authoritative state transitions, counts, economic calculations, autonomy decisions, or verification gates. Those belong to deterministic code and to accountable humans.

When adding an executor or an executor-produced artifact:

- give it a versioned, typed contract, not a prose report;
- compute every metric in deterministic code rather than accepting an executor's self-reported numbers;
- hash and freeze the artifact, and bind any downstream review to it by content hash;
- reuse `evidence_artifacts` and the existing receipt/Gauntlet primitives rather than adding a parallel evidence store;
- register the executor's authority envelope and forbidden actions in `executor_profiles`, and never store credentials there.

## Capability sovereignty

For consequential architecture, dependency, executor, or integration proposals, do not begin with a product name. Begin with the capability the system needs.

Before adding a new external dependency, answer:

1. What capability are we acquiring?
2. Should Delegation Cloud own this capability natively, use an adapter, use a hybrid boundary, keep the project as a benchmark/reference only, or reject it?
3. Can another implementation satisfy the same calling contract without redesigning the workstream?
4. Would the dependency become a source of authority, lifecycle state, verification truth, operational memory, or Skill truth that Delegation Cloud should own instead?
5. Can its performance, cost, provenance, and authority use be measured independently?
6. Can it be removed later without invalidating historical evidence or making the operating model incoherent?

Prefer Delegation Cloud-owned interfaces and versioned contracts. Vendor/model/runtime names belong in implementation metadata and execution provenance, not in durable workstream semantics unless a temporary frozen experiment explicitly requires them.

When an external project demonstrates a superior pattern, extract the useful capability or principle first. Benchmark it where execution quality matters. Internalize the capability only when doing so strengthens control, verification, learning, routing, authority, or defensibility. Do not recreate commodity infrastructure merely to claim independence.

For each substantial proposal, classify it as:

- **Aligns**
- **Aligns with constraints**
- **Conflicts**
- **Vision is silent**

Name the relevant `VISION.md` section in the plan or handoff. If a request conflicts with the vision or requires an owner decision the vision does not resolve, surface that conflict and ask whether the request or the vision should change. Do not silently rewrite the vision to make a feature fit.

Treat explicit authority, required approvals, least-privilege access, organization isolation, auditability, human accountability, and manual proof before automation as hard boundaries. Never let an agent send, purchase, publish, commit, transfer funds, alter access, or take another external or sensitive action without the defined authorization.

Only edit `VISION.md` when the task explicitly authorizes a governing decision change. Small fixes need no formal vision analysis, but they must preserve these boundaries. Report validation and any remaining vision tension before handoff.
