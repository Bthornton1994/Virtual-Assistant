# Native Skill Registry v1

Status: **CS-12 canonical contract and runtime projection boundary**

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

The Supabase connector available during implementation exposed project `cvpypxzqcsdhabiejyxh`, not Delegation Cloud QA project `qbvmtgaphvpwpwemplje`, and the Supabase CLI was unavailable. No database was written and no untested migration was fabricated. A persistence migration may later store these exact canonical objects when the correct project is connected; persistence must not change the contract or create a qualified seed.

## Vision audit

This implementation aligns with `VISION.md` because:

- Delegation Cloud owns the procedure, qualification, authority, and projection contracts;
- external runtimes are replaceable implementations;
- failed shadow evidence does not become operational truth;
- qualification requires accepted, measured outcomes plus manager approval;
- runtime instructions cannot expand authority;
- no external action, database write, routing change, or autonomy promotion is introduced.

## Exit gate

CS-12 v1 exits when the canonical contract compiles, qualification and tamper boundaries pass, qualified synthetic evidence regenerates equivalent Hermes/Grok/generic projections, the operator roster is visible, and no real Skill is falsely promoted.
