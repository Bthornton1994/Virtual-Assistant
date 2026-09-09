# Executor Envelope v1

CS-2 standardizes the boundary between an executor and the Delegation control plane. It is a contract-only increment: it does not select an executor, route work, grant authority, or write to Supabase.

## Input envelope

An `ExecutorEnvelopeV1` binds one run and assignment to:

- a registered, active capability;
- a phase (`prepare`, `review`, or `validate`);
- frozen input artifact references and hashes;
- the authority snapshot, including allowed and forbidden actions;
- an output contract and evidence requirements;
- economic limits and a deadline;
- an executor configuration snapshot.

The envelope rejects unknown or non-active capabilities, output schemas not declared by the capability, duplicate input references, deadlines before creation, and agent-owned validation phases. The `mayOwnAuthoritativeState` field is intentionally always false.

## Result envelope

An `ExecutorResultV1` binds the result back to the governing envelope. It carries:

- status and a candidate payload or output artifact reference;
- evidence references;
- escalation or failure information;
- an explicit authority report;
- measured economics;
- execution provenance.

Validation rejects identity or provenance drift, mismatched output contracts, duplicate evidence references, completed results without output, blocked results without a failure or required escalation, reported prepare-only actions, over-limit economics, and results completed after the deadline.

## Deterministic boundary

The module exposes canonical JSON and SHA-256 helpers so envelope and result identity can be recorded without trusting executor self-report. It does not decide the Gauntlet verdict. That remains the deterministic validator's responsibility.

## Compatibility with Step 3D

The existing Step 3D work cell remains unchanged. Its Hermes, Grok, and native validator assignments remain frozen. CS-2 defines the boundary that a future adapter can use; it does not wrap or re-run the current assignments.

No migration, database write, provider routing, or production deployment is included in this change.

## Next boundary

`src/lib/assignment-to-envelope.ts` is the read-only translator from a frozen assignment snapshot into this envelope and an Execution Context. It preserves frozen executor and capability keys, maps the existing profile authority snapshot into `authoritySnapshot`, and binds identity with canonical SHA-256 assignment ids. It does not route, select a provider, write to a store, or replace the Delegation Spec as the authority ceiling.

That translator remains separate from any capability-based routing decision. Adapter enforcement of Execution Context at fetch, lease completion, or evidence persistence is a later slice.