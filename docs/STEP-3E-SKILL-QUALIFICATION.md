# Step 3E Skill Qualification Contract v1

Status: **qualification boundary implemented; no Skill promoted**

## Decision

Step 3E defines the evidence required before a repeatable procedure may be recommended for promotion from shadow to a qualified Delegation Cloud Skill. It does not create a Skill registry, grant authority, or promote Hermes, Grok, or any other runtime.

The deterministic contract is `src/lib/skill-qualification.ts`.

## Why this gate comes before CS-12

`docs/CAPABILITY-SOVEREIGNTY-ROADMAP.md` blocks the Native Skill Registry until Step 3E establishes what qualification evidence matters. Runs 4 and 5 proved that a structurally sound control plane can still produce a rejected business outcome. A registry built before this distinction would make it too easy to mistake “the workflow ran” for “the procedure is qualified.”

This contract therefore separates:

- a frozen candidate procedure and content hash;
- a versioned qualification suite;
- immutable, run-bound observations;
- deterministic qualification metrics and failures;
- a recommendation from the separate manager decision required to promote anything.

## Mandatory evidence

A qualification suite declares numeric minimums and ceilings. The evaluator requires:

- at least two distinct runs;
- repeated hard-gate passes and accepted Outcome Receipts;
- independent review and deterministic validation when required by the suite;
- zero authority incidents;
- zero accepted high-severity unsupported claims;
- zero wrong-model acceptances;
- bounded reviewer correction and unresolved escalation counts;
- measured human minutes, owner minutes, AI cost, and tool cost when required;
- exact candidate key, version, capability, procedure hash, and suite bindings;
- immutable evidence references and the frozen executor configuration for every observation.

Missing economics remain `null`. They are never converted to zero or “free.” Duplicate runs cannot inflate the evidence count.

## Decision semantics

The deterministic evaluator emits one of:

- `qualify`: all declared evidence thresholds were met;
- `remain_shadow`: evidence is incomplete or a non-authority threshold failed;
- `suspend`: at least one authority incident was recorded.

Every decision says `requiresManagerApproval: true` and `authorityGranted: false`. A positive deterministic recommendation is evidence for a manager; it is not a write to lifecycle state and does not authorize execution, publication, catalog changes, or autonomy.

## Runs 4–5 assessment

The recorded Runs 4 and 5 remain `USEFUL SHADOW / RETRY BEFORE SKILL`:

- neither produced an accepted Outcome Receipt;
- both failed the deterministic hard gate;
- Run 5 retained an unresolved reviewer rejection and escalation;
- human minutes, owner minutes, AI/model cost, and tool cost were not measured;
- the five-product freeze contained two unlocatable catalog identities and an unresolved promotional-price question;
- the operator evidence explicitly forbids Skill extraction from that batch.

The correct Step 3E result is therefore `remain_shadow`. Run 6 is not required on the same defective freeze and would not repair the missing qualification evidence.

## Vision audit

This slice aligns with `VISION.md`:

- manual proof still precedes automation;
- agents supply evidence and judgments but do not own gates or promotion;
- accepted outcomes, not activity volume, are the qualification unit;
- authority and unsupported-certainty violations are hard boundaries;
- cost and owner burden stay visible instead of being inferred;
- external runtimes remain replaceable implementations beneath a canonical contract.

## Exit and next gate

Step 3E contract v1 is complete when its schemas and evaluator compile and its boundary cases pass tests. After that, CS-12 may implement the Native Skill Registry against this contract, but it must seed no qualified Catalog Integrity Skill from Runs 4–5. A later clean batch or another procedure may supply the first real qualification history.

