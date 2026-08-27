# Capability Registry v1

Status: **CS-1 implementation. Registry metadata only; no autonomous routing.**

This increment makes the capability vocabulary Delegation Cloud-owned while preserving the named executor compatibility layer used by the frozen Step 3D work cell.

## What landed

- A small native vocabulary for the current proving ground and the next approved phases.
- A capabilities metadata table with contract versions, risk class, verification contract, and lifecycle status.
- An executor_capabilities mapping with qualification state and evidence summary.
- A QA fixture with idempotent mappings for the current Hermes, Grok, and deterministic validator profiles.
- Agent implementations remain pending until qualification evidence supports promotion. The deterministic catalog validator is the only seeded qualified implementation.

## What this does not do

- It does not change Runs 4–9.
- It does not replace executor_profiles.role.
- It does not select an executor or add autonomous routing.
- It does not make an agent authoritative, grant new authority, or alter the hard gate.
- It does not apply a Supabase migration or write Preview/Production data.
- The migration seeds the capability vocabulary; `supabase/qa/capability_registry_v1.sql` adds environment-specific executor mappings only when Preview/QA setup is explicitly authorized.

## Ported operator tooling (consolidated branch)

These sit on PR #26's schema. They do not add a second CS-1 migration.

- `scripts/extract-work-cell-artifact.ts` — strip chatter and validate packet/review JSON before ingest.
- Frozen Step 3D executor-key guard in `capability-registry.ts` (`FROZEN_WORK_CELL_EXECUTOR_KEYS`).
- `/ops/capabilities` — staff roster of **qualified** implementations for **active** capabilities only.
- `docs/evidence/run5-catalog-integrity-work-cell.md` and the Run 5 scorecard.
- `scripts/apply-cs1-preview.ts` plus `supabase/qa/capability_registry_v1.sql` — Preview/QA only, not executed from this commit.

Qualified queries return only `capabilities.status = active` with `executor_capabilities.qualification_status = qualified`. Hermes and Grok remain `pending`. `executor_profiles.status` retains `shadow` for those agents.

## Exit check

Operations can now query which implementations are registered for a capability and distinguish pending, qualified, suspended, and expired assignments. CS-2 will add the versioned executor envelope; CS-3 will add deterministic routing only after qualification evidence exists.

## Grounded supplier sourcing

The Grounded lane adds two active internal capabilities:

- `supplier_sourcing` — prepare public-source supplier-direct, partner-fulfilled,
  and kit-assembly research under a frozen input contract.
- `deterministic_supplier_sourcing_validation` — enforce scope, provenance,
  authority, and no-owned-inventory rules over the packet and independent review.

Supplier communication is a separate `supplier_outreach` capability and remains
`proposed`. It has no executor mapping. Its exact-message approval and delivery
contracts must be implemented and qualified before any connector can transmit a
supplier message.
