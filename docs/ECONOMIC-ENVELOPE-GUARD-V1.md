# Economic Envelope Guard v1

Status: implemented on a draft branch for review; not merged and not applied to Production.

## Purpose

A Delegation Spec already records an `economic_envelope`, and work-cell assignments already record observed human, AI, and tool costs. Before this guard, the envelope was metadata: its shape was not validated and a passing run was not checked against it at the database boundary.

This guard makes numeric ceilings explicit and fail-closed at the authoritative completion boundary without claiming a capability the current execution engine does not have.

## Reserved keys

Unknown keys remain accepted for backward compatibility with existing recording flags such as `record_human_minutes`. Only these keys are interpreted as ceilings:

| Key | Meaning | Type |
| --- | --- | --- |
| `maxHumanMinutes` | Maximum observed human intervention | Finite non-negative number |
| `maxOwnerMinutes` | Maximum observed owner intervention | Finite non-negative number |
| `maxAiCostMicros` | Maximum AI cost in USD micros | Non-negative integer |
| `maxToolCostMicros` | Maximum tool/API cost in USD micros | Non-negative integer |

A missing numeric key means that dimension has no declared numeric cap in that spec. It does not grant new authority or authorize spending.

## Enforcement

- Application validation rejects malformed reserved keys when a spec is created or activated.
- The database rejects malformed `economic_envelope` values on spec insert or update, including direct PostgREST writes.
- A workstream run cannot report human, AI, or tool totals below the costs already recorded on its executor assignments.
- A run cannot become `verified` when any declared ceiling is exceeded.
- A run that exceeds a ceiling can still receive a failed Outcome Receipt, so the overage remains visible instead of being hidden or leaving the run permanently stuck.
- Equality at a ceiling is allowed.
- The guard does not stop a provider mid-request or reserve spend before execution. That requires a future execution-adapter budget hook. The current truthful guarantee is that an over-limit run cannot be authoritatively verified as successful.

## Verification plan

1. Run the pure unit tests for malformed envelopes, legacy flags, boundary equality, overages, and malformed observed totals.
2. Apply the migration only to the connected QA project.
3. Prove in QA that malformed specs are rejected, an over-limit verified transition is rejected, a failed receipt remains possible, and assignment totals cannot be under-reported.
4. Run security and performance advisors after the DDL.
5. Keep the PR draft until repository checks, QA evidence, and independent review are complete.

No catalog, supplier, payment, inventory, publication, account, or Production state is changed by this tranche.
