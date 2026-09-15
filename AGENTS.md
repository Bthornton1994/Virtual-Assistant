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
- `docs/ENGINEERING-EXECUTION-PRINCIPLES.md`

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

## AI App Release Rescue

For work on the release-readiness review workstream — intake, repository access, the audit rubric, findings, report integrity, or retention — read `docs/AI-APP-RELEASE-RESCUE-V1.md` first.

The offer is a fixed-price review of one repository, one application, and one critical workflow, with a separate remediation sprint. Never describe it as a penetration test, a compliance certification, or a security guarantee; `findProhibitedClaims` in `src/lib/release-rescue-intake.ts` is the single list governing both report text and the marketing surface.

The review is prepare-only. Severity is derived from recorded observations, never chosen by an executor. Coverage, counts, and the verdict are computed in deterministic code and rejected when a stored value disagrees. Delivery requires a named human reviewer holding manager authority. Repository access is read-only, time-boxed, customer-revocable, and never stored as a credential.

`VISION.md` is silent on whether Delegation Cloud sells engineering-adjacent assurance work. That is an open owner decision recorded in the document; do not launch or widen this workstream before it is resolved.

## Software Factory model economy

Canonical pins live in `docs/SOFTWARE-FACTORY-MODEL-ECONOMY-V1.md` and the three project agents under `.cursor/agents/`. Do not add more Software Factory agents unless an owner decision changes that policy.

- Default implementer: `grok-4.6` (`.cursor/agents/sf-implementer.md`)
- Strategic planners: `claude-fable-5-1` and `gpt-5.6-sol` — rare, read-only, manually invoked. Choose exactly one when escalation is justified. Never dual by default.
- Planner escalation is limited to architectural ambiguity, cross-repo work, security, high-risk change, authority/permissions/data/economics/core simulation, major stage or product decision, missing sequence, or substantial rework risk.
- Do not auto-delegate planners. Forbidden triggers include “use proactively”, “always use”, “every task”, “run before implementation”, and “run after every change”.
- Verification stays on the existing Software Factory and repository process. Planners are not for routine verify.

Software Factory task reports must include `REQUESTED_MODEL`, `ACTUAL_MODEL`, `PLANNER_ESCALATION` (reason or `NOT REQUIRED`), and `MODEL_ROUTING_EXCEPTION` when the requested model was not the model that ran.

These names are control-plane pins and execution provenance. They do not become durable workstream semantics or a source of authority.

## Engineering execution principles

The portfolio engineering standard is tool-agnostic. Apply it whether the work is performed in Cursor, Claude Code, Codex, GitHub tooling, another agent runtime, or by a human engineer. No runtime-specific command or plugin is required.

For substantial engineering work:

- prefer the smallest sufficient change and subtract obsolete complexity before adding new layers;
- settle core data shapes, ownership, invariants, and concurrency assumptions before downstream logic;
- integrate new requirements from first principles instead of bolting them onto an accidental design;
- minimize reader load and hidden state;
- optimize product choices for the intended user experience rather than implementation convenience;
- compare multiple approaches when a novel or consequential design is genuinely uncertain;
- build rerunnable scripts, validators, harnesses, generators, or benchmarks for repeated work and proof;
- model the domain explicitly with types, state machines, registries, tables, or other appropriate structures;
- validate external data at system boundaries and make invalid states hard to represent;
- make lifecycle operations, retries, migrations, and recovery paths idempotent;
- migrate callers and remove obsolete internal APIs rather than maintaining permanent dual paths without cause;
- eliminate unnecessary shared mutable state before adding serialization or locks;
- reproduce defects and fix root causes when practical;
- sequence multi-step work into verifiable units;
- verify the real runtime, artifact, workflow, database invariant, or user-facing behavior rather than treating green CI as sufficient proof;
- independently challenge consequential changes involving authority, security, tenant isolation, money, privacy, irreversible mutation, or release control;
- preserve concise evidence and decision provenance instead of raw context volume;
- answer reversible, observable engineering questions with safe experiments when possible rather than pushing technical uncertainty to the owner;
- encode repeated lessons into tests, schemas, types, invariants, metadata, verification tooling, or versioned Skills instead of repeating prose instructions.

These principles improve execution quality but grant no authority. They never authorize a merge, Production deployment, Production database or environment write, customer or vendor message, purchase, account or permission change, destructive action, public publication, Skill/Routine promotion, or autonomy increase that the governing repository and Delegation Spec have not already authorized.

See `docs/ENGINEERING-EXECUTION-PRINCIPLES.md` for the full standard and its relationship to the Gauntlet, evidence, Skills, and earned autonomy.

## UI design engineering skills

For UI or interaction work, read `docs/DESIGN_ENGINEERING.md` and `.claude/skills/emil-design-eng/SKILL.md` before editing. Use the supporting `animate`, `review-animations`, `improve-animations`, `find-animation-opportunities`, `animation-vocabulary`, `apple-design`, `pick-ui-library`, and `prototype` skills when the task calls for implementation, review, planning, vocabulary, gesture/material guidance, library selection, or genuine variant exploration.

The project's existing vision, security, privacy, accessibility, safety, data, and release rules remain authoritative. These skills guide interface craft and never authorize a merge, deployment, data write, external communication, or product-behavior change.

## Additional interface-quality skills

For broader interface work, read `docs/DESIGN_ENGINEERING.md` and the relevant `.claude/skills/better-*/SKILL.md` file before editing. Use `better-interface` to coordinate a holistic review and route each finding to its owning domain skill.

The `interface-review`, `explain-interface`, `variant`, and `break` skills are explicitly user-invoked. Do not start them implicitly. These skills guide interface craft and never authorize product-behavior changes, data writes, external communication, merges, deployments, or other consequential actions.

## Taste skill and redesign guidance

For existing UI work, read `docs/DESIGN_ENGINEERING.md`, `.claude/skills/design-taste-frontend/SKILL.md`, and `.claude/skills/redesign-existing-projects/SKILL.md` before editing.

- Apply the source brief inference, preserve-mode audit, and final pre-flight as review checks.
- Use the skills only on the surfaces named in `docs/DESIGN_ENGINEERING.md`. They do not supersede the product vision or authorize a visual rewrite.
- Keep user-facing text plain and specific. Avoid decorative labels, fake precision, and dash flourishes in new visible copy while preserving required product terminology and disclaimers.
- Do not copy image-generation, GSAP, fixed visual-preset, or landing-page patterns into product, trust, benefits, analyzer, or operational surfaces unless the surface is in scope, the interaction is justified, and dependencies are checked.
- Existing project instructions, product boundaries, accessibility requirements, and release controls remain authoritative.

## UI Skills from ibelick

For UI work, use the vendored `ui-skills-root` routing layer to select the smallest useful context. Use `baseline-ui` for spacing, hierarchy, typography, touch targets, and interaction polish; `fixing-accessibility` for controls, forms, focus, and semantics; `fixing-motion-performance` for animation and scroll-linked behavior; and `improve-ui` for evidence-backed surface audits and bounded implementation plans.

These files are vendored from `https://github.com/ibelick/ui-skills` at commit `f2dadf221a166a79606b337d08ce0b04d0d2bfd9` and are reference material, not a runtime dependency. Existing Emil, Jakub, and Leon guidance, `VISION.md`, Delegation Specs, security, tenant isolation, and release controls remain authoritative.

Apply this guidance to marketing routes and shared UI primitives. Preserve operational density and explicit outcome, access, approval, logging, verification, and tenant-isolation language. UI polish must not imply autonomous authority or hidden execution.


## External agent stack from linked Grok and Cursor setup

For UI, copy, source verification, and completion claims, read `docs/EXTERNAL-AGENT-SKILLS.md` and load only the smallest relevant vendored skill. Use `frontend-ui-engineering` for interface implementation, `source-driven-development` for framework-specific decisions, `no-ai-slop` for visible copy, `no-ai-design-slop` for product-specific UI audits, and `verification-before-completion` before claiming a fix or passing check.

Apply this stack to marketing routes, shared UI primitives, and responsive navigation. Existing project vision, product boundaries, security, privacy, accessibility, methodology, tenant isolation, and release controls remain authoritative. The vendored files are source material, not runtime dependencies, and they do not authorize autonomous execution, production access, external actions, merges, or deployments.

## External repository references

For linked repository discovery posts, read `docs/EXTERNAL-AGENT-REPOSITORIES.md` before evaluating a new dependency, context store, agent runtime, model proxy, or UI reference. It records dispositions only. Do not install or enable a listed system without a separate architecture, license, data-authority, safety, and verification review. Existing project documents remain authoritative.

## Design contract

Read `DESIGN.md` together with `docs/DESIGN_ENGINEERING.md`, `AGENTS.md`, and the governing project documents before UI work. `DESIGN.md` is the compact design contract for product intent, responsive states, accessibility, truthful copy, and verification. It does not authorize product-behavior, data, scoring, commerce, external-action, merge, or deployment changes.

## Stack rules

When editing stack-specific code, load the matching `.cursor/rules/*.mdc` file. These rules are versioned guidance and are scoped by their frontmatter. Confirm `package.json` and active framework configuration before applying them; the Prisma rule is dormant unless Prisma is present.
