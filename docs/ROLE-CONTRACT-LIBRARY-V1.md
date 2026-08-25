# Role Contract Library v1

CS-7 defines a small, versioned responsibility contract. A role is a reusable mission boundary, not an executor identity, model, persona inventory, or authority grant.

## Contract fields

Each role declares:

- mission;
- required registered capabilities;
- input and output contract references;
- allowed authority class;
- an explicit prohibition on owning authoritative state;
- forbidden actions;
- known failure modes;
- fallback policy;
- an evaluation suite and success criteria.

External or sensitive execution roles must require human approval for fallback. Fallback triggers must reference declared failure modes, so a role cannot silently invent a recovery path.

## Library boundary

The validator rejects duplicate role keys, duplicate capabilities or forbidden actions, duplicate failure codes, unknown fallback triggers, malformed contracts, and any attempt to set authoritative ownership. It sorts valid roles deterministically.

The initial vocabulary is intentionally limited to demonstrated workstreams:

- Evidence Researcher
- Independent Reviewer
- Engineering Executor
- Engineering Reviewer
- Business Researcher
- Human Specialist

This change does not seed executor profiles, route work, qualify capabilities, or map a role to a particular model or provider. Multiple implementations may later satisfy one role contract and be compared through CS-4 and CS-6 evidence.

## Exit gate

CS-7 is not complete merely because the schema exists. The exit gate remains evidence that at least two implementations satisfy one role contract, with authority still governed by the Delegation Spec.
