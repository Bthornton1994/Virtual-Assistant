# Engineering Quality Layer

## Purpose

Delegation Cloud needs two different kinds of control:

1. **Business execution control**: Delegation Specs, authority envelopes, evidence, Outcome Receipts, the Gauntlet, business-impact review, and earned autonomy.
2. **Software engineering execution quality**: how coding agents investigate, design, implement, verify, review, and hand off changes inside a repository.

The first is owned by Delegation Cloud. The second can be strengthened by external engineering workflows such as **pstack** without transferring authority to them.

Upstream reference: <https://github.com/cursor/plugins/tree/main/pstack>

pstack is an MIT-licensed Cursor plugin. This integration was reviewed against the upstream project on 2026-08-24. We do not vendor the plugin into Delegation Cloud by default.

## Architectural position

pstack sits **below project governance and below the Delegation Cloud authority layer**. It is an executor-side quality system, not an executor, policy engine, or source of business authority.

```text
Owner / VISION / approved business rules
                |
        Delegation Cloud control plane
                |
     Delegation Spec + authority envelope
                |
        engineering work assignment
                |
        +-----------------------+
        | coding executor layer |
        |                       |
        | Cursor + pstack       |
        | Claude Code           |
        | Codex / other agents  |
        +-----------+-----------+
                    |
          repository verification
                    |
        independent/adversarial review
                    |
                 Gauntlet
                    |
          authorized merge/release path
```

The hierarchy is deliberate. A pstack playbook can improve how a worker performs engineering work. It cannot increase what that worker is allowed to do.

## What we adopt from pstack

We adopt the following engineering behaviors as portfolio-wide defaults for substantial software work:

- **Model the domain before coding.** Core types, state machines, registries, and data ownership should make the architecture understandable rather than spreading assumptions across conditionals.
- **Boundary discipline.** Parse and validate external data at system boundaries. Keep internal business logic as pure and typed as practical.
- **Make operations idempotent.** Re-running a migration, setup step, executor action, or recovery path should converge safely rather than multiply state.
- **Prove the real behavior.** Green lint/typecheck/build is evidence, not proof that the intended runtime behavior works. Verify the artifact or workflow itself.
- **Reproduce before repair.** Defects should have runtime evidence and a root cause before a fix is accepted when reproduction is practical.
- **Sequence work into verifiable units.** Multi-step work should have intermediate checks so failures localize cleanly.
- **Use adversarial review for consequential changes.** Cross-cutting architecture, authority, security, money, data isolation, and release-control changes deserve an independent attempt to break the design.
- **Build the verification lever.** If a behavior matters repeatedly, prefer a script, typed validator, test harness, or verification Skill over repeating a manual checklist.
- **Capture lessons in structure.** Repeated instructions should graduate into tests, types, policy metadata, deterministic checks, or versioned Skills rather than accumulating as prose reminders.
- **Preserve a decision trail for long autonomous work.** A future operator should be able to reconstruct what changed, what evidence was used, and what remains uncertain.

These principles complement the Delegation Cloud thesis of proof-carrying work and earned autonomy.

## Cursor usage

When Cursor is the coding runtime and pstack is installed, the preferred entry point for substantial engineering work is `/poteto-mode`.

Useful pstack capabilities map to our architecture as follows:

| pstack capability | Delegation Cloud interpretation |
| --- | --- |
| `/poteto-mode` | Executor-side engineering workflow wrapper |
| `/architect` | Pre-implementation design exploration |
| `/interrogate` | Independent/adversarial engineering review |
| `/arena` / `/swarm` | Parallel candidate generation or coverage, never an authority vote |
| `/create-verification-skill` | Project-local deterministic/runtime verification harness |
| `/eval` | Blinded comparison for prompt/Skill behavior changes |
| `/show-me-your-work` | Engineering decision/evidence trail |
| `/reflect` | Candidate learning proposal, not automatic policy |
| shipping/babysit workflows | PR lifecycle assistance subject to repository merge/release authority |

For non-Cursor runtimes, apply the same engineering disciplines with the tools available. Do not invent pstack commands in Claude Code, Codex, or another runtime.

## Authority override

pstack includes its own autonomy guidance. That guidance is **not authoritative in this portfolio**.

Repository rules, VISION, Delegation Specs, and owner-approved controls always win. Unless the governing repository explicitly grants the action, an agent may not use pstack or any other workflow to autonomously:

- merge a pull request;
- deploy or promote Production;
- write Production environment variables;
- perform Production database writes or destructive migrations;
- send customer, vendor, employee, or public messages;
- make purchases or move money;
- create or alter accounts, secrets, credentials, or permissions;
- publish externally;
- delete consequential data;
- change its own authority level;
- promote or rewrite a production Skill or Routine.

The correct pattern is:

```text
prepare -> verify -> independent review -> evidence -> authority check -> execute if authorized
```

not:

```text
agent believes work is good -> agent ships it
```

## Relationship to the Gauntlet

pstack strengthens the **inside of an engineering attempt**. The Gauntlet evaluates the **attempt as an accountable unit**.

Example:

```text
Delegation Cloud selects objective
        |
engineering executor enters rigorous workflow
        |
implementation + tests + runtime proof
        |
independent engineering review
        |
immutable evidence and economics
        |
Gauntlet hard gate
        |
Outcome Receipt / corrective action
```

pstack does not replace the Gauntlet because:

- pstack does not own tenant or business authority;
- pstack does not own Outcome Receipts;
- pstack does not own business-impact review;
- pstack does not own autonomy promotion/demotion;
- pstack is currently Cursor-specific, while Delegation Cloud must remain executor-agnostic.

## Relationship to Step 3D and Step 3E

The current Loadout proving ground already demonstrates several compatible ideas:

- Hermes prepares evidence.
- Grok independently challenges it.
- deterministic software owns counts and gates.
- the Gauntlet records the accountable result.

pstack reinforces this model on the **software-development side**. Its multi-model review, blinded eval, verification-skill, and decision-trail patterns are useful inputs when we qualify future coding executors and engineering Skills.

For Step 3E specifically, `/reflect` or similar learning tools may generate candidate improvements, but those improvements must enter our normal versioned Skill qualification process. They may not silently mutate a production Skill.

## Portfolio rollout policy

Every active software repository should carry a concise version of this policy in `AGENTS.md` so any coding runtime sees the same hierarchy:

1. Project vision and safety rules govern.
2. Repository-specific release and data controls govern.
3. pstack may be used when available to improve engineering rigor.
4. Non-Cursor agents apply equivalent disciplines.
5. Verification must inspect the real artifact or runtime behavior.
6. External/consequential actions remain authority-gated.
7. pstack is installed through Cursor rather than copied into each repository.

This avoids six independent forks of the plugin while giving every repository the same quality contract.

## Local installation

Repository changes do not install the Cursor plugin. A Cursor environment that should use pstack still needs the upstream plugin installed through Cursor, followed by its setup flow.

Do not commit API keys, model credentials, or machine-specific pstack configuration into a repository unless a future reviewed configuration format is explicitly intended to be shared.
