# Engineering Execution Principles

Status: Portfolio engineering standard v1

Date adopted: 2026-08-24

## Purpose

Delegation Cloud must remain executor-agnostic. Cursor, Claude Code, Codex, Hermes, Grok, human engineers, and future runtimes may all participate in engineering work, but none should require a tool-specific methodology in order to produce trustworthy results.

This document defines the engineering principles that apply across the portfolio regardless of runtime. They are derived in part from the engineering ideas published in the MIT-licensed pstack project, but they are adapted here as our own tool-independent operating standard. pstack itself is not a dependency, authority source, or required runtime.

Upstream inspiration: https://github.com/cursor/plugins/tree/main/pstack

## Position in the architecture

These principles govern how an engineering executor reasons, changes code, verifies behavior, and hands work back. They sit below project governance and below Delegation Cloud's authority plane.

```text
Owner / VISION / approved product rules
                |
        Delegation Cloud control plane
                |
     Delegation Spec + authority envelope
                |
        engineering executor
   (any model, agent, IDE, or human)
                |
   Engineering Execution Principles
                |
 implementation + runtime evidence
                |
 independent/adversarial verification
                |
             Gauntlet
                |
       Outcome Receipt / correction
```

The principles can improve execution quality. They cannot grant permission to merge, deploy, publish, message, purchase, mutate Production, change permissions, or increase autonomy.

## Core principles

### 1. Smallest sufficient change

Bias toward deletion, simplification, and the smallest change that fully solves the problem. New abstractions, layers, wrappers, state, and configuration must earn their cost.

### 2. Foundations before logic

Settle the core data shape, state ownership, invariants, concurrency assumptions, and scaffold before writing downstream behavior. A correct foundation should make later code more obvious.

### 3. Integrate requirements from first principles

When a new requirement changes an existing design, do not bolt it on by default. Reconsider the design as if the requirement had been foundational from the beginning, then choose the simplest architecture that would have resulted.

### 4. Subtract before adding

Remove obsolete paths, duplicated concepts, and dead compatibility layers before adding the replacement when doing so is safe. Build on the simpler base rather than preserving accidental complexity.

### 5. Minimize reader load

Optimize for the next maintainer. Reduce hidden state, indirection, one-caller wrappers, oversized mutable scopes, and control flow that requires several files to understand one behavior.

### 6. Execute toward the target outcome

For migrations and staged rewrites, each phase should converge toward the intended architecture. Do not preserve temporary compatibility states indefinitely merely because they already exist.

### 7. Experience first

For product and UX tradeoffs, implementation convenience is not the product requirement. Prefer the user experience that best serves the product vision, then find the simplest responsible implementation.

### 8. Explore the design space when uncertainty is real

For novel interactions or architecture without a clear precedent, compare multiple plausible approaches before committing. Use lightweight prototypes, traces, or design spikes when an empirical result can settle the choice.

### 9. Build the lever

If work will repeat or must be proven, create the script, validator, generator, harness, migration check, benchmark, or other reusable mechanism that performs or verifies it. Prefer a rerunnable artifact over a manual checklist.

## Architecture principles

### 10. Model the domain explicitly

Represent stateful behavior with appropriate structures such as state machines, typed models, registries, reducers, tables, or clear ownership boundaries. Avoid scattering the same domain assumption across conditionals.

### 11. Guard system boundaries

Validate and normalize external input at the boundary where it enters the trusted system. Keep internal business logic as pure and typed as practical. Do not repeatedly re-parse trusted internal state.

### 12. Make invalid states hard to represent

Use the type system, schemas, constraints, branded identifiers, discriminated unions, and database invariants to make illegal combinations difficult or impossible to construct.

### 13. Make operations idempotent

Commands, lifecycle steps, setup, retries, recovery, and migrations should converge safely when repeated. Design for crashes, duplicated delivery, partial failure, and retry rather than assuming exactly-once execution.

### 14. Migrate callers, then delete the legacy path

When replacing an internal API or structure, move the callers and remove the obsolete interface in the same controlled wave when practical. Avoid permanent dual systems without a deliberate migration reason.

### 15. Separate shared state before serializing access to it

When concurrent actors can collide on the same file, branch, row, key, resource, or mutable object, first ask whether the sharing can be eliminated. Prefer ownership separation over increasingly elaborate locking.

## Verification principles

### 16. Prove the real behavior

Compilation, linting, type checks, and unit tests are evidence, not sufficient proof of user-visible or operational behavior. Verify the real artifact, runtime, workflow, database invariant, rendered interface, or external boundary that the change is supposed to affect.

### 17. Fix root causes

Reproduce defects when practical and trace symptoms to the underlying cause before accepting a repair. Do not hide a failing invariant with a downstream patch if the upstream cause can be corrected.

### 18. Sequence work into verifiable units

Break multi-step changes into bounded units that each end with a meaningful check. Order commits, migrations, and PRs so the sequence itself helps localize failures and demonstrates progress toward the target state.

### 19. Challenge consequential work independently

Changes involving authority, security, tenant isolation, money, privacy, irreversible data mutation, release controls, core architecture, or safety need an independent attempt to break the reasoning. Agreement is evidence; self-review is not independence.

## Delegation principles

### 20. Preserve useful context, not raw volume

Keep the main decision path compact and evidence-rich. Summarize large outputs, preserve source references and hashes, and delegate bulk exploration without losing provenance. Future operators should be able to reconstruct what mattered without replaying every token.

### 21. Resolve observable technical questions empirically

Do not push reversible, observable engineering questions to the owner merely because the agent is uncertain. Run a safe experiment, prototype, trace, test, or comparison when that can answer the question. Human approval remains mandatory for genuine product preferences, governing decisions, consequential actions, and irreversible authority boundaries.

### 22. Encode repeated lessons in structure

When the same instruction, defect class, or review comment appears again, move the lesson into a type, test, lint rule, schema, runtime invariant, metadata field, verification harness, or versioned Skill. Repeated prose is a warning that the system has not learned structurally.

## Portfolio practices derived from the principles

For substantial engineering work, executors should normally follow this shape:

```text
understand the governing product rules
        |
name the data/state shape
        |
inspect current behavior and blast radius
        |
prototype competing approaches when uncertainty warrants it
        |
implement the smallest sufficient change
        |
verify the real behavior
        |
independent/adversarial review for consequential changes
        |
record evidence, economics, and unresolved risks
        |
Gauntlet / authority gate
```

Prompt, Skill, and agent-policy changes should be evaluated empirically on blinded or otherwise controlled examples when their behavior matters. A learning or reflection pass may propose a new rule or Skill revision, but it cannot silently make that proposal authoritative.

## Authority boundary

The following remain governed by the repository, VISION, Delegation Specs, and explicit owner-approved controls rather than by these engineering principles:

- merge or release authorization;
- Production deployment or promotion;
- Production database or environment mutation;
- destructive operations;
- purchases or transfer of funds;
- customer, vendor, employee, or public communications;
- account, secret, credential, or permission changes;
- external publication;
- production Skill or Routine promotion;
- executor autonomy promotion.

The correct pattern is:

```text
prepare -> prove -> independently challenge -> record evidence -> authority check -> execute if authorized
```

not:

```text
executor believes the work is good -> executor expands its own authority and ships
```

## Relationship to the Gauntlet

The Engineering Execution Principles improve the inside of an engineering attempt. The Gauntlet remains the accountable control loop around the attempt.

The principles influence how evidence is produced. Delegation Cloud still owns typed evidence contracts, deterministic metrics, hard gates, Outcome Receipts, business-impact review, and earned autonomy.

## Relationship to Skills

Stable repeated engineering procedures may be extracted into versioned Skills. A Skill is an encoded procedure, not an authority grant.

A candidate Skill should be versioned, hashed, evaluated on fresh work, and promoted only after its qualification gate is satisfied. A worker may propose a Skill change, but may not silently rewrite the production Skill it is currently operating under.

## Portfolio rollout

Every active software repository should carry a concise copy or reference in `AGENTS.md` so any coding runtime receives the same expectations. Repository-specific product, safety, privacy, security, data, and release requirements remain higher priority.

This standard is intentionally independent of Cursor, Claude Code, Codex, or any particular model provider.