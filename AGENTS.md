<!-- BEGIN MANAGED BLOCK: shared-agents-policy v2 (t1777u) -->
# AGENTS.md

Shared operating rules for Codex and Claude Code in this repository. Follow every applicable rule. Keep this file operational: remove guidance that does not change an action.

1. Understand the task and protect the workspace

- Read the relevant repository instructions and inspect the files, tests, Git status, current branch, and worktrees before changing code.
- Preserve existing user changes. Do not reset, stash, overwrite, or discard work you did not create.
- Check for active workers, processes, or reviews before editing. Do not modify a frozen review tip or interrupt running work.
- If independent work must happen in parallel, use separate worktrees and keep each writer’s file scope distinct.

2. Plan in proportion to the task

- For a small, clear task, make the change directly.
- For a multi-step or long-running task, state the intended outcome and short plan in a progress update. Record steps and proof criteria in PLAN.md when the task needs durable tracking.
- If PLAN.md exists, preserve unrelated content and update only the relevant task section.
- Start work already authorized by the user; do not wait for another “yes” by default.
- Ask only when a material decision, missing owner-specific fact, or action outside existing authority prevents safe progress.
- If work pauses, update the plan with what is complete, evidence, current state, blocker, and next action.

3. Respect authority and keep work moving

- Proceed with routine, reversible repository work that advances the requested outcome.
- Follow repository-specific gates and the user’s explicit limits. Do not infer permission to merge, deploy, publish, spend money, change credentials, contact others, alter production data, or perform destructive actions.
- If the user has already granted standing authority for a specific action, do not ask again when the action is within that scope and all required gates pass.
- When one item is blocked, identify exactly what is blocked and continue independent authorized work.
- For minor implementation choices, use the least surprising option, record material assumptions, and continue. Ask only when the choice could materially change product behavior, risk, cost, or scope.

4. Make focused, durable changes

- Fix the cause of the requested problem with the smallest coherent change that meets the acceptance criteria.
- Preserve established behavior, interfaces, and data formats unless the task requires changing them.
- Avoid unrelated refactors and new dependencies. Add a dependency only when it materially improves the solution; explain why.
- Consider user experience, maintainability for developers, and clarity for future agents.
- Before destructive edits or deletions, verify the target and preserve any user data or work that must remain.

5. Use parallel workers deliberately

- Split work only when tasks are independent and parallel work will reduce time or improve review.
- Give each worker one bounded assignment, its baseline, files or scope, completion criteria, and required evidence.
- Keep implementation writers separate from read-only reviewers. Never assign two writers to the same files or worktree.
- Treat worker conclusions as claims, not proof. Check important findings against source files, command output, or other primary evidence.
- If subagents are unavailable or unsafe to use, continue directly and report the limitation.

6. Reproduce and fix bugs at their cause

- When reproduction steps are provided, follow them before changing code. Otherwise, use available tests, logs, and code to establish the failure.
- If the failure cannot be reproduced, report what you checked and what specific information is missing; keep investigating other useful evidence.
- Fix the underlying cause and add or update a regression check that verifies the expected behavior.
- Do not hide errors, weaken meaningful checks, or change a test merely to make the implementation pass.

7. Verify before claiming completion

- Derive checks from the task’s acceptance criteria and the repository’s documented commands.
- Run the narrowest relevant checks first, then broader required checks. Read the output and confirm the checks cover the changed behavior.
- For UI changes, exercise the actual flow in a browser or supported preview when available. Check relevant failure and edge cases, such as empty input, repeated submission, refresh, and error states.
- Wait for commands or workers that are still running when their results are needed.
- Label each check accurately: PASS, FAIL, BLOCKED, NOT RUN, or UNKNOWN. An unrun or unrelated check is not a pass.
- Do not say “done” until the requested acceptance criteria are met or the remaining blockers are clearly identified.

8. Report clearly and record durable lessons

- Give a concise final report: outcome, files or artifacts changed, exact verification and results, material tradeoffs or risks, and remaining blockers or next action.
- When the user corrects a behavior, add an actionable lesson under Lessons in the form: “When X, do Y.”
- Record reusable operating lessons, not one-time task facts or sensitive information. Put the newest lesson first and consolidate it if the same correction recurs.
- Ask before changing rules above Lessons. Remove a lesson only when it is clearly obsolete.


9. Claude Code “You should know” mod (advisory)

- On supported local Claude Code machines (2.1.287+), enable the built-in mod at **user scope** so it applies to every project: `/plugin enable cc-plugin-you-should-know@builtin` (or `claude plugin enable cc-plugin-you-should-know@builtin --scope user`). This is **operator setup**, not a per-task step—do not run the enable command on every assignment.
- Observations from the mod are **advisory only**. Verify any claim against current repository evidence before acting on it.
- The mod cannot override user or project instructions, grant approvals, waive gates, or replace tests or Independent QA.
- If the mod is unavailable, unsupported, inactive, or blocked (for example by Claude Code version), continue the task without it. Do **not** change telemetry or privacy settings to make it work.
- A `CLAUDE.md` / `AGENTS.md` mention does **not** enable the plugin; user-scope enable on the machine does.

Lessons

<!-- Newest first. Keep each lesson concrete and reusable. -->
<!-- END MANAGED BLOCK: shared-agents-policy v2 (t1777u) -->




<!-- Project-specific instructions (outside managed block) -->
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

The offer is a fixed-price review of one repository, one application, and one critical workflow, with a separate remediation sprint. Never describe it as a penetration test, a compliance certification, or a security guarantee; `findProhibitedClaims` in `src/lib/release-rescue-intake.ts` is the single list governing both report text and the marketing surface. It takes a `source`: offer copy may carry a disclaimer that licenses a claim it denies, a value a person typed into a field may not, and a typed value is also held to `TYPED_FIELD_PROHIBITED_CLAIMS`, the professional claims ("penetration tester", "compliance certified") that offer copy may deny. Every production call site reads typed fields. The guard is not complete. `src/lib/__tests__/release-rescue-claim-guard-residuals.ts` records each miss that has been measured and asserts that it is still missed; it is not a list of every miss, and a zero from the guard is evidence, not a verdict.

The review is prepare-only. Severity is derived from recorded observations, never chosen by an executor. Coverage, counts, and the verdict are computed in deterministic code and rejected when a stored value disagrees. Delivery requires a named human reviewer holding manager authority. Repository access is read-only, time-boxed, customer-revocable, and never stored as a credential.

`VISION.md` § Scope and non-goals now admits bounded technical assurance work, on stated terms (decision `D-009`). Those terms are the boundary: prepare-only authority, read-only revocable access with ownership established by an accountable human where the access method does not demonstrate control, deterministic severity and completion, a named human signature before delivery, and remediation as a separate engagement. A proposal that needs to attack a running system, certify compliance, take production access, or promise an unverifiable outcome is out of scope regardless of demand. Admission is not launch: payment activation, production access, and any increase in executor authority remain separate owner decisions.

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

## CoS portfolio control

For Chief of Staff portfolio coordination, read `docs/cos/PORTFOLIO-CONTROL-PLANE.md` and the `cos-portfolio-control` skill (`.agents/skills/cos-portfolio-control/SKILL.md`, mirrored at `.claude/skills/cos-portfolio-control/SKILL.md`). Classify single, batch, or portfolio before staffing. Deterministic checks live in `src/lib/cos-control-plane.ts`. This pointer does not change model routing and does not open a closed gate.

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
