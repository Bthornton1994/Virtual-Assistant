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
