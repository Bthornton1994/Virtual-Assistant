# Golden Path: Loadout Catalog Integrity v1

Status: **Frozen owner decision (D-007, D-009). Prepare-only and shadow-mode. Not a new control plane.**

Date: 2026-09-08

This is the first Golden Path freeze. It is not a Workbench, Outcome Mesh runtime, second Run Manager, or customer-facing agent fleet. It records the owner-selected proving ground and the acceptance tests that must pass before later slices are considered.

`VISION.md` remains the governing product constitution. This freeze does not grant merge, deploy, catalog-write, supplier-contact, messaging, permission-change, or autonomy-promotion authority.

## Vision analysis

**Aligns with constraints.**

Governing sections:

- `VISION.md` — Authority, approvals, human accountability, and manual proof before automation. The Golden Path stays inside an existing Delegation Spec. Agents prepare evidence. Deterministic code owns the hard gate. An accountable human issues the Outcome Receipt.
- `VISION.md` — Outcomes, not labor inventory. The path proves one recurring business outcome (catalog integrity findings), not a workforce of agents.
- Capability Sovereignty — replaceable executors behind Delegation Cloud-owned contracts. Hermes and Grok remain shadow implementations; they do not own runs, leases, evidence, or receipts.

Remaining tension: later slices (catalog mutation, supplier contact, Software Factory execution, hosted connectors) stay unauthorized until a separate owner decision.

## Owner decision

Delegation Cloud’s first Golden Path is **Loadout Catalog Integrity v1**.

Initial scope:

- `prepare_only`
- `shadow`

Allowed outputs:

- reviewed, evidence-backed integrity findings
- prepared recommendations (candidate corrections that do not write the catalog)

Forbidden in this freeze:

- mutate the catalog
- contact suppliers
- send messages
- merge code
- deploy
- change permissions
- any other external action

## Reuse map

The Golden Path evaluates an attempt against existing contracts. It does not store runs, leases, evidence, or receipts.

| Concern | Existing source of truth |
| --- | --- |
| Authority ceiling | Delegation Spec (`prepare_only`) |
| Attempt identity | `workstream_runs` |
| Staffing | Step 3D work cell (`docs/STEP-3D-WORK-CELL.md`) |
| Prepare executor | `hermes-loadout-researcher-v1` (agent, shadow) |
| Review executor | `grok-loadout-reviewer-v1` (agent, shadow) |
| Validate executor | `catalog-evidence-validator-v1` (deterministic, active) |
| Lease | Execution Runtime `execution-runtime/v1` (`src/lib/execution-runtime.ts`) |
| Evidence | `evidence_artifacts` (`catalog-evidence-packet/v1`, `catalog-evidence-review/v1`) |
| Independent verification | Step 3D work-cell gate (`src/lib/work-cell-policy.ts`) |
| Receipt | `outcome_receipts`, issued only by an accountable human |
| Autonomy | Gauntlet default policy; this path must **hold** |

Envelope, result, Execution Context, and tool-invocation contracts stay the ones already in `src/lib/executor-envelope.ts` and `src/lib/execution-context.ts`.

Related operating docs: `docs/GAUNTLET-LOOP.md`, `docs/DOGFOOD-LOADOUT-CATALOG-INTEGRITY.md`, `docs/CAPABILITY-SOVEREIGNTY.md`.

## Forbidden actions

Every phase envelope on this path must forbid all of:

- `mutate_catalog`
- `contact_suppliers`
- `send_messages`
- `merge_code`
- `deploy`
- `change_permissions`
- `external_action`

A non-zero authority report is already a prepare-only failure. The Golden Path evaluator treats that as ineligible, including catalog writes, messages, merges, permission changes, purchases, account creation, and other external actions.

`supplier_outreach` is not a Golden Path capability.

## Acceptance tests

Implemented in `src/lib/__tests__/golden-path-catalog-integrity.test.ts` against `evaluateGoldenPathAttempt`:

1. An eligible prepare-only/shadow attempt that reuses the contracts above.
2. Prepared recommendations are allowed when the authority report stays zero.
3. Catalog mutation, supplier contact, messaging, merge, permission changes, and other external actions are rejected.
4. A second run store, lease authority, or evidence store is rejected.
5. Desktop, mobile, plugin, relay, hosted memory, customer agent fleet, and second control-plane surfaces are rejected.
6. An agent-owned validate phase is rejected.
7. A self-issued Outcome Receipt is rejected.
8. Missing independent review fails the work-cell gate, and a passing receipt claim cannot override that rejection.
9. Default autonomy policy holds; this path cannot request promotion.

## Non-goals

Not authorized by this freeze:

- a second Run Manager, lease authority, evidence store, or memory system
- desktop, mobile, plugin, relay, hosted memory, or a customer-facing agent fleet
- mutating Loadout catalog records
- contacting suppliers or sending any message
- merge, deploy, permission changes, or Production database writes
- expanding PRs #64, #70, #73, or #74
- Software Factory 72-hour freshness as a global catalog-integrity rule
- promoting Hermes or Grok out of shadow
- automatic Outcome Receipts

Later isolation adapters, Mesh receipt fields, or additional Golden Paths require a separate owner decision.
