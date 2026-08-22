# Gauntlet Loop v1

Status: **Owner-directed implementation, 2026-08-22.**

This document defines the reusable execution-control loop that sits above Delegation Specs and evidence-bearing Workstream Runs. It does not replace `VISION.md`. Authority, approvals, tenant isolation, security, human accountability, and manual proof before automation remain governed by `VISION.md`.

## Purpose

A workstream is not successful because an executor completed a task or because CI passed. The Gauntlet forces every material recurring outcome through two separate questions:

1. **Was the work performed correctly and inside authority?**
2. **Did it improve the business condition we were trying to change?**

Only then does the system update the workstream's autonomy evidence and decide whether to hold, promote, demote, or suspend.

## The loop

```text
OBSERVE
  |
  v
DIAGNOSE + SELECT SMALLEST EVIDENCE-BACKED ACTION
  |
  v
EXECUTE UNDER DELEGATION SPEC
  |
  v
COLLECT PROOF + ECONOMICS
  |
  v
INDEPENDENT ADVERSARIAL REVIEW
  |
  +---------------- hard gate fails ----------------+
  |                                                 |
  v                                                 v
OUTCOME RECEIPT                              CLASSIFY FAILURE
  |                                                 |
  |                                          ROOT CAUSE / RETRY
  |                                                 |
  |                                                 +----> NEW ATTEMPT
  v
BUSINESS-IMPACT REVIEW
  |
  +---- regressed / incident ----> DEMOTE OR SUSPEND
  |
  v
AUTONOMY CONTROLLER
  |
  +---- HOLD
  +---- PROMOTE (approval-gated by default)
  +---- DEMOTE
  +---- SUSPEND
  |
  v
CLOSE CYCLE
  |
  +---- recurring/event ----> NEW OBSERVATION CYCLE
```

## Stage invariants

### 1. Observe

A cycle always starts in `observing`. At least one source-backed observation must exist before diagnosis can be locked.

Observation is intentionally separate from diagnosis. The system should preserve what was actually seen before deciding why it happened.

### 2. Diagnose

A diagnosis records:

- what appears to be happening;
- the current binding constraint;
- the smallest selected action;
- the falsifiable hypothesis;
- evidence references used to choose it.

Locking the diagnosis moves the cycle to `executing`. Diagnoses are immutable; a materially different diagnosis belongs in a later corrective action or next cycle.

### 3. Execute

A Gauntlet attempt is still an ordinary evidence-bearing `workstream_run` under an active Delegation Spec. Gauntlet linkage adds:

- cycle identity;
- attempt number;
- retry-of lineage.

The Gauntlet does not create new authority. The Delegation Spec remains the authority ceiling.

### 4. Adversarial verification

The verifier's job is to try to disprove completion, not merely restate the executor's report.

A review records:

- reviewer type/reference;
- whether review is independent;
- challenged assumptions;
- defects;
- evidence gaps;
- authority incidents;
- hard-gate result;
- verdict.

A passing Outcome Receipt for a Gauntlet run is blocked at the database boundary until an independent review passes its hard gate with zero recorded authority incidents.

Human executors cannot mark their own run as an independent human review.

### 5. Corrective action

A failed/cancelled Gauntlet attempt automatically creates an open failure case if none exists.

Failure classes:

- bad input;
- executor failure;
- evidence failure;
- QA failure;
- integration failure;
- source ambiguity;
- authority limit;
- policy conflict;
- business-strategy failure;
- cost limit;
- security incident;
- external dependency;
- unknown.

The retry policy is explicit. Critical/security failures suspend rather than brute-force retry. Authority/policy/source ambiguity escalates to a human. Bad input is corrected before retry. Executor failures can route to a different executor. Strategy failures re-plan.

Retries create new immutable Workstream Runs. Failed attempts remain evidence.

### 6. Business-impact review

A passing technical receipt moves the cycle to `impact_review`, not to complete.

Impact must be classified as:

- `improved`;
- `neutral`;
- `regressed`;
- `inconclusive`.

The assessment records the hypothesis, primary metric, baseline, observed result, delta, guardrails, evidence references, evidence quality, and interpretation.

An inconclusive result is valid. The system must not manufacture impact merely to progress autonomy.

### 7. Autonomy controller

Each workstream has an `Autonomy Profile`:

- Level 0: observe;
- Level 1: prepare;
- Level 2: execute with approval;
- Level 3: bounded autonomous execution;
- Level 4: exception-only supervision.

The profile also stores workstream-specific promotion policy.

There are intentionally **no universal promotion thresholds** in v1. New profiles start with promotion thresholds unset. That means the controller will hold even after a good run until an operations manager deliberately configures evidence thresholds appropriate to that workstream and risk class.

Hard safety behavior is different:

- an authority incident can automatically **suspend**;
- a failed adversarial hard gate can automatically **demote**;
- measured business regression can automatically **demote**;
- promotion is approval-gated by default even after configured evidence thresholds are satisfied.

Automatic promotion exists as a capability but must be explicitly enabled in a workstream policy after evidence justifies it.

### 8. Re-entry

A manual cycle closes after an applied autonomy decision.

A recurring/event cycle closes and the database automatically creates the next cycle in `observing` state. It does not start an executor. Re-entry means the system is ready to observe the next business condition, not that it has permission to act again blindly.

Suspension stops re-entry.

## Full proof chain

A mature recurring outcome should be reconstructable as:

```text
Delegation Spec
  -> Gauntlet Cycle
    -> Observation(s)
      -> Diagnosis
        -> Workstream Run attempt(s)
          -> Evidence Artifacts
            -> Adversarial Review
              -> Outcome Receipt
                -> Impact Assessment
                  -> Autonomy Decision
                    -> next Cycle
```

The failure path remains reconstructable as well:

```text
Attempt
  -> failed receipt / terminal failure
    -> Failure Case
      -> classification
        -> corrective action
          -> retry lineage
```

## Metrics that matter

The Gauntlet exists to make these trends measurable over repeated runs:

- verified completion rate;
- hard-gate pass rate;
- failure rate;
- exception rate;
- authority incidents;
- QA score;
- owner minutes per run;
- human minutes per run;
- AI/API/tool cost;
- business-impact direction;
- correction burden;
- time between failure and successful retry;
- time to higher autonomy;
- autonomy demotions/suspensions;
- straight-through completion.

Busy agents, issue count, content volume, and commit count are not success metrics by themselves.

## Promotion doctrine

Promotion is not a reward for an impressive model output. It is an operating decision supported by repeated history.

The controller should require a configured window such as:

- minimum verified runs;
- minimum average QA;
- maximum failure rate;
- maximum exception rate;
- optional maximum owner minutes per run;
- improved business impact when required;
- zero authority incidents.

Exact values are workstream-specific and must be calibrated from actual runs.

## Human authority

The Gauntlet deliberately automates **control logic**, not unlimited business judgment.

Humans remain required when:

- promotion needs approval;
- sources conflict;
- policy is ambiguous;
- authority is insufficient;
- a failure is critical or security-related;
- business impact is materially disputed;
- a workstream is suspended and needs recovery;
- the underlying strategy needs to change.

The end state is not an unmanned company. It is a company where machines handle solved execution paths and humans own the edges that still require judgment or consequential authority.
