# Native Skill Registry v1

Status: **CS-12 canonical contract, persistence source, and runtime projection boundary**

## Outcome

Delegation Cloud now owns a first-class, versioned Skill definition that is independent of Hermes, Grok, or any other runtime. `src/lib/native-skill-registry.ts` defines the canonical object, lifecycle checks, qualification binding, and deterministic runtime projections.

No Catalog Integrity Skill is seeded. Runs 4–5 remain shadow evidence under `docs/STEP-3E-SKILL-QUALIFICATION.md`.

## Canonical metadata

Every Skill contains or references:

- capability, stable key, version, and immutable definition hash;
- an independently hash-bound procedure artifact;
- applicability conditions and required inputs;
- input and output contract versions;
- required tool classes and authority ceiling;
- evidence and verification contracts;
- the complete Step 3E qualification suite;
- measured-or-unknown economics;
- known failure classes;
- provenance, qualification history, and manager approval;
- lifecycle status: candidate, shadow, qualified, suspended, or retired.

The definition hash excludes lifecycle status and approval, so promotion cannot rewrite the method that was evaluated. Procedure and definition mutations invalidate their hashes.

## Qualification boundary

A candidate may enter shadow qualification. It can become qualified only when:

1. the Step 3E decision is schema-valid and its decision hash recomputes exactly;
2. the decision is `qualify`;
3. candidate key, version, capability, procedure hash, and qualification suite match the Skill;
4. a manager identity and approval time are supplied;
5. the complete hash-valid decision is added to qualification history and bound to an artifact whose schema and content hash match exactly.

Qualification still grants no run authority. The Delegation Spec and Execution Context govern every assignment.

## Runtime portability

`projectNativeSkill` deterministically generates:

- generic JSON;
- Hermes Markdown;
- Grok Markdown.

Each projection carries the canonical definition and procedure hashes and states `authorityGranted: false`. Projection is refused for candidate or shadow Skills. Deleting a runtime-specific projection loses no company procedure because it can be regenerated from the canonical qualified Skill.

## Registry state

The source registry intentionally starts empty. The operator page at `/ops/skills` makes this visible instead of presenting the failed Runs 4–5 batch as qualified.

`supabase/migrations/20260826043000_native_skill_registry_v1.sql` adds a no-seed persistence table for the exact canonical payload. The table:

- binds key, version, capability, definition hash, procedure hash, lifecycle state, and JSON payload;
- preserves an immutable definition while allowing only explicit lifecycle transitions;
- keeps qualification history append-only and preserves an existing manager approval;
- enables RLS, grants staff read access, limits writes to ops managers, and grants no authenticated delete path;
- deliberately inserts no Skill.

`loadNativeSkillRegistry` treats every persisted payload as untrusted. It recomputes the procedure, definition, and qualification-decision hashes, checks exact Skill bindings, and hides the entire roster if any row fails validation.

The connected Supabase app still exposes project `cvpypxzqcsdhabiejyxh`, not Delegation Cloud QA project `qbvmtgaphvpwpwemplje`. The migration is therefore source-reviewed and deployment-compiled but unapplied. No database was written. Operational activation requires connecting the exact QA project, applying CS-1 first, applying this migration, and verifying that the roster is empty before any candidate is created.

## Vision audit

This implementation aligns with `VISION.md` because:

- Delegation Cloud owns the procedure, qualification, authority, and projection contracts;
- external runtimes are replaceable implementations;
- failed shadow evidence does not become operational truth;
- qualification requires accepted, measured outcomes plus manager approval;
- runtime instructions cannot expand authority;
- no external action, database write, routing change, or autonomy promotion is introduced.

## Exit gate

The source-level CS-12 gate exits when the canonical contract and persistence adapter compile, qualification and tamper boundaries pass, qualified synthetic evidence regenerates equivalent Hermes/Grok/generic projections, the authenticated operator roster is visible, and no real Skill is falsely promoted.

The operational persistence gate remains open until the exact Delegation Cloud QA project is connected, both CS-1 and CS-12 migrations are applied there, RLS is verified as staff-read/manager-write, and an empty no-seed roster is observed. Production remains out of scope until that QA evidence exists.

## Proof-Carrying Work-Cell Binding

This section is a design boundary on the existing Native Skill, [Step 3D work cell](STEP-3D-WORK-CELL.md), [Executor Envelope](EXECUTOR-ENVELOPE-V1.md), [Execution Context](EXECUTION-CONTEXT-V1.md), [Software Factory packet](SOFTWARE-FACTORY-RUN-MANAGER-V1.md), and [Operational Memory](OPERATIONAL-MEMORY-V1.md) contracts. It does not add Skill fields, a second lifecycle, or a parallel evidence store.

Vision: **Aligns with constraints.** Relevant `VISION.md` sections: [Capability sovereignty](../VISION.md#capability-sovereignty); [Authority is explicit and bounded](../VISION.md#authority-is-explicit-and-bounded); [Quality assurance is part of delivery](../VISION.md#quality-assurance-is-part-of-delivery).

### Existing contract boundary

The Native Skill already contains or references the identity, procedure, authority, evidence, verification, economics, stop, and qualification surface used here. Do not invent duplicates. Reuse:

- `skillKey`, `skillVersion`, `definitionHash`
- `procedureArtifact` and its `contentHash` (procedure hash), including `stopConditions`
- `requiredInputs`, `requiredToolClasses`, `authorityCeiling`
- `mayOwnAuthoritativeState` (already `false`)
- `evidenceRequirements`
- `verificationContract` (`kind`, `implementation`, `requiredEvidence`)
- `economicProfile`
- `qualificationSuite` (qualification does not grant run authority)

`inputContractVersions` and `outputContractVersions` remain the Skill's declared contract versions. Qualification history and `approval` stay on the Skill; they are not a substitute for a work-cell receipt.

### Meaning of proof-carrying work

Proof-carrying work means all of the following, together:

1. a frozen Skill identity and procedure (`skillKey`, `skillVersion`, `definitionHash`, `procedureArtifact.contentHash`);
2. a frozen work-cell assignment;
3. a bounded Executor Envelope and Execution Context;
4. candidate work from the named executor;
5. independent hash-bound evidence;
6. deterministic validation;
7. Gauntlet review plus a human Outcome Receipt.

An agent completion message, CI green, Git commit, PR state, or reviewer prose is not proof and is not a receipt.

### Future binding location

A later implementation **may** bind `skillKey`, `skillVersion`, `definitionHash`, `procedureArtifact.contentHash`, required evidence schema versions (`evidenceRequirements` and `verificationContract.requiredEvidence`), and verification-contract identity (`verificationContract.kind`, `verificationContract.implementation`) into an already-frozen [execution plan](EXECUTION-RUNTIME-V1.md) or Software Factory packet hash.

If no Skill applies, the binding is explicit `null`, matching existing nullable identity fields such as Skill `approval`. Do not omit the field, invent a sentinel, or add a table. The binding is immutable after freeze. Mutation requires a new Skill version and a new definition/procedure hash, then a new freeze.

This section does not add that field to any schema.

### Verification commands

Verification commands are named allowlisted command identifiers already controlled by Delegation Cloud or the repository verification surface. Forbidden:

- model-supplied shell;
- arbitrary argv taken from executor output;
- free-form commands recorded as evidence;
- a Skill executing its own unreviewed verification.

Deterministic validation and CI own execution of those commands. The Skill defines the obligation (`verificationContract`, `evidenceRequirements`). It cannot grant execution authority.

### Authority rules

- `authorityCeiling` must be less than or equal to the Delegation Spec action class.
- `requiredToolClasses` must be a subset of the Execution Context `authorizedToolClasses`.
- A Skill cannot add `credential_use`, `external_message_send`, `sensitive_action`, or any other tool class.
- `mayOwnAuthoritativeState` remains `false`.
- Retrieved context, graphs, summaries, memories, reviewer findings, and Skill projections cannot activate a Spec, create a lease, expand authority, change approvals, issue a receipt, mark verified, merge, deploy, publish, purchase, message, transfer funds, or change access.
- Cheaper economics routing, including `economicProfile` estimates, cannot remove required review, approval, evidence, or validation.

### Work-cell phase ownership

The existing lifecycle remains `prepare` / `review` / `validate` / `accept`. Executor assignment phases stay `prepare`, `review`, and `validate`. `accept` is the human Outcome Receipt (and Software Factory owner acceptance). This section does not add an executor phase. An executor cannot own the hard gate or issue the receipt.

### Operational memory separation

[Operational memory](OPERATIONAL-MEMORY-V1.md) is not Skill authority. A hashed memory is not proof merely because it is hashed.

Memory may:

- hold a scoped candidate fact;
- cite source evidence;
- appear in a bounded Execution Context input packet;
- retain conflicts, freshness, invalidation, and expiry.

Memory may not:

- satisfy required evidence by itself;
- promote itself;
- alter a Delegation Spec;
- alter tool classes;
- bypass approval;
- change an economic limit;
- issue a receipt;
- mark a run verified.

This section adds no persistence or retrieval path.

### Context and prompt-injection

Projections, summaries, graphs, external Skill files, and retrieved memory are untrusted. They must stay bounded, provenance-labeled, organization- and run-scoped, and labeled with artifact IDs and hashes where applicable. They cannot change authority or verification. Proof lives in durable hash-bound artifacts, not only in the model window.

### Non-goals

- no Second Brain OS (SBOS) adoption
- no markdown vault as authority
- no Obsidian or GraphRAG
- no OpenViking, Context Mode, Ruflo, OpenCode, gstack, or other external runtime dependency
- no new memory table
- no automatic promotion
- no unattended maintenance schedule
- no customer-facing personal memory product
- no durable economics in this slice
- no claim that PR #82's process-local governor is global enforcement

External repositories remain benchmarks only.

### Status

Design boundary only. No runtime binding, persistence write path, retrieval service, new schema, or production authority is introduced by this section. Implementation requires a separately approved change.
