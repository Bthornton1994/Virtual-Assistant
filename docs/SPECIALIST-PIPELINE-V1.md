# Specialist Pipeline v1

Status: **CS-13 framework boundary; no runtime adapter or specialist workflow activated**

## Purpose

CS-13 gives Delegation Cloud a small, versioned shape for specialist work that has more than one deliverable. It keeps the control plane in charge of stage order, approvals, evidence, stop conditions, and replay while leaving execution replaceable.

The contract is implemented in \`src/lib/specialist-pipeline.ts\`.

## Required stage spine

Every pipeline must contain these stages in deterministic order:

\`\`\`text
plan
-> technical_check
-> business_qa
-> delivery
-> replay
\`\`\`

A pipeline may also include a \`deliverable\`, \`approval\`, or \`execution\` stage. If it includes execution, an approval stage must precede it. External or sensitive stages require human approval. A technical-check stage must be deterministic.

Every stage declares:

- required capability keys;
- input and output contract versions;
- action-class ceiling;
- whether human approval is required;
- whether the check is deterministic;
- a stage-specific objective.

The pipeline declares its own authority ceiling, required inputs/outputs, stop conditions, escalation rules, and \`mayOwnAuthoritativeState: false\` invariant.

## Run boundary

A run freezes:

- pipeline key and version;
- input artifact references;
- authority snapshot;
- one state for every stage;
- stage input and output artifact references, including upstream content hashes;
- timestamps and blocking reasons;
- final output evidence bound to the pipeline output contract.

Validation fails closed when:

- the run does not match the pipeline identity;
- a stage is missing, duplicated, out of order, or unknown;
- a later stage is active while an earlier stage is incomplete;
- an approval is missing or a protected stage activates before approval;
- a required plan, technical-check, business-QA, delivery, or replay stage is skipped;
- a completed stage has no input evidence bound by content hash or no output evidence matching its declared contract;
- a blocked or skipped stage has no reason;
- a delivered run lacks completed delivery and replay stages or final evidence matching the pipeline output contract;
- authority exceeds the pipeline ceiling.

## Authority and implementation boundary

This is a contract, not an orchestrator. It does not:

- select an executor;
- invoke a model, connector, or specialist;
- create authoritative lifecycle state;
- send, publish, purchase, or modify external systems;
- write Supabase;
- promote a Skill;
- replace the frozen Step 3D work cell.

A future adapter may translate a real specialist workstream into this contract only after its authority and business-QA requirements are explicitly reviewed.

## Verification

The test suite covers:

- the required stage spine;
- approval-before-execution and authority ceilings;
- planned-run creation with all stages pending;
- completed delivery with replay evidence;
- input/output contract and upstream-hash binding;
- approval-before-activation and mandatory-stage skip rejection;
- fail-closed activation of a later stage before approval/order.
