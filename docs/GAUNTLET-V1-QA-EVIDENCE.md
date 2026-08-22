# Gauntlet v1 QA Evidence

Status: **QA gate passed on 2026-08-22.**

This document records the release evidence for the Gauntlet v1 control loop. It is evidence for the QA environment only. It is not a Production deployment record and does not authorize Production promotion.

## Gate result

`GAUNTLET_V1_PASS`

The database lifecycle gate exercised the loop as an actual state machine rather than a UI-only happy path.

## Verified checks

- `pre_diagnosis_attempt_blocked`
- `pre_review_pass_receipt_blocked_for_expected_reason`
- `success_to_impact`
- `impact_to_autonomy`
- `recurring_reentry`
- `direct_autonomy_mutation_blocked`
- `failure_case_created`
- `classified_retry_lineage`
- `retry_success`
- `authority_incident_auto_suspend`
- `explicit_level0_recovery`
- `recovery_audit_atomic`
- `direct_recovery_delete_blocked`
- `parent_cascade_preserved`

## Path A: successful recurring cycle

The gate verified:

1. observation exists before diagnosis;
2. diagnosis unlocks execution;
3. a Workstream Run carries evidence and economics;
4. a passing Outcome Receipt is rejected before an independent adversarial hard-gate review;
5. a valid independent review permits a passing receipt;
6. technical verification moves to business-impact review;
7. impact review moves to autonomy review;
8. a default workstream with unconfigured promotion thresholds holds rather than silently promoting;
9. applying the autonomy decision closes the cycle;
10. a recurring workstream creates the next cycle in `observing`, without automatically starting execution.

## Path B: corrective retry

The gate verified:

1. a failed attempt is preserved;
2. a Failure Case is created automatically;
3. the failure is explicitly classified;
4. retry policy is recorded;
5. corrective action resolves the failure case;
6. the next Workstream Run is a new immutable attempt linked through `retry_of_run_id`;
7. the corrected attempt can complete the same independent verification and impact path.

## Path C: authority incident and recovery

The gate verified:

1. an adversarial review with an authority incident immediately suspends the workstream autonomy profile;
2. the active Gauntlet cycle is suspended;
3. automatic re-entry stops;
4. direct mutation of autonomy level/state is rejected;
5. recovery requires an explicit recovery record;
6. recovery returns the workstream to `active` at Level 0;
7. the incident cycle remains suspended and is not silently reopened.

## Defect found by the receipt gate

The initial receipt guard contained an ambiguous PL/pgSQL identifier. The negative gate exposed it because the database rejected the pre-review receipt for the wrong reason. The guard was corrected to use unambiguous local variables and the same negative test was rerun.

Acceptance requires the precise failure condition:

`A Gauntlet run cannot pass without an independent adversarial hard-gate review`

The corrected guard now meets that requirement.

## Recovery audit hardening

Recovery is operable through a manager-only server action and control-center form, while the database remains the authority boundary. A recovery insert triggers both:

- the Level-0 profile reset; and
- an `audit_events` record with recovery identity, workstream, prior level, resulting level, and explicit reason.

The audit write participates in the same database statement so an audit failure rolls back the recovery.

The recovery-surface QA gate also found and corrected a schema contradiction. Recovery records use parent `ON DELETE CASCADE` foreign keys, while the first immutability trigger blocked every delete, including the database's own parent cascade. The hardened invariant now:

- rejects direct recovery-row deletion;
- continues to reject updates;
- permits only nested parent-driven cascade deletion;
- preserves normal organization/workstream deletion semantics.

The corrected gate verified both the negative direct-delete case and successful parent cascade cleanup.

## Advisor scope

The Gauntlet migrations introduced no new error-level security finding during the QA review. New Gauntlet foreign-key index findings were addressed. Remaining Supabase advisor warnings are pre-existing foundation items or expected unused-index notices in the small QA dataset and are not reclassified as Gauntlet release failures.

## Release boundary

This evidence does not authorize:

- Production deployment;
- Production environment changes;
- unrestricted autonomous execution;
- external send, publish, purchase, permission, contract, or financial actions;
- automatic promotion without a workstream policy that explicitly earns and permits it.
