# AI App Release Rescue — audit ledger

Audit findings for the release-readiness review workstream, as a repository
artifact rather than a conversation transcript.

Every audit of this workstream so far has existed only inside an agent session.
`AGENTS.md` requires an executor-produced artifact to be given a versioned record
and bound to the thing it judges; findings that live in a transcript satisfy
neither, and a release cannot rest on evidence that is not in the repository.
This file is the record. It is written by hand from audit reports and is not
itself evidence of anything — the evidence is the commits, the tests, and the
measurements each row cites.

**This ledger does not confer or withhold merge authority.** `DO_NOT_MERGE` is
held by the pull request and by `DECISION_LOG.md` § D-012.

---

## Retracted claims

A claim retracted here must not be repeated in a commit message, a pull request
body, an architecture document, or a check-in — whatever its original wording.

### R-001 — "208 sweep payloads caught"

| | |
| --- | --- |
| Published in | commit `e874c8c`, PR #97 body, `docs/AI-APP-RELEASE-RESCUE-V1.md` |
| Claimed | that the `COORDINATORS` word list "was measured to be doing nothing" |
| Retracted at | `148bb31` |
| Status | **retracted — the measurement could not have failed** |

All four templates in that sweep filled the denial verb's complement slot, so
the complement bound rejected every one of them whatever connective was
substituted. **208 of 208 was the only answer the corpus could produce.** It was
structurally incapable of detecting either of the two licensing defects audit 44
then found in the same commit.

The defect is subtler than a wrong number: the round before had failed by
building its corpus from its own word list, and this round freed the
*connectives* from that list while leaving the *templates* fixed — and the
templates are the axis that decides the outcome. The same error, rotated.

**Replaced by** a corpus that varies what occupies the complement slot: 9
templates × 52 connectives = **468 payloads, 468 caught**, with the figure read
out of the architecture document by a test. The `COORDINATORS` question was then
answered separately by diffing the two configurations over **10,400 generated
payloads** — zero disagreement.

---

## Audits

Audits 1–43 are summarised in `docs/AI-APP-RELEASE-RESCUE-V1.md`, which records
them narratively alongside the mechanism each one changed. This section begins at
the point findings started being tracked as a ledger.

### Audit 44 — subject `e874c8c`, verdict DO_NOT_MERGE

4 blocking, 9 non-blocking. Every blocking finding was reproduced by execution
before anything was changed.

| ID | Finding | Direction | Resolved at | How |
| --- | --- | --- | --- | --- |
| 44-B1 | The `that` arm of `complementHoldsTheClaim` tested only that a `that` *existed* within reach of the denial verb, then licensed every claim after it at any distance. `We never guarantee that scope is wide but your application is secure` was licensed here and **caught at `11f1661`** — a regression. 52 of 52 connectives went through. | fail-open | `148bb31` | The claim must be the complement **of that `that`**, and only the first `that` is read. |
| 44-B2 | Deleting `COORDINATORS` re-opened the subject-negation arm, whose auxiliary scan ran to the end of `before` with no bound of its own. `No refunds are given after delivery but we do guarantee your application is secure` was licensed, and was **caught at both predecessors**. | fail-open | `148bb31` | `SUBJECT_REACH` bounds the negated subject's noun phrase. |
| 44-B3 | The 208-payload sweep was evidence composed inside its own premise. | evidence | `148bb31` | Retracted as **R-001**; corpus rebuilt to vary the complement slot. |
| 44-B4 | `No guarantee is needed because your application is secure` — the payload the commit message and PR body both named as the evidence for the subject-negation exclusion — existed in no test and no corpus. | evidence | `148bb31` | Added to `NEGATION_SCOPE_REGRESSIONS`; the bound doc figure moved 17 → 18. |

Non-blocking findings 44-N1 to 44-N9 are recorded in the architecture document
alongside the mechanisms they concern. Two are worth naming here because they
are *records* rather than code: the `FUNCTION_WORDS` set was published as
40 words in four places and had 41, and the mutation proof's closing sentence
counted four `wiring:` mutants inside its "reconstructed or modelled" total.

### Audit 45 — not yet run

Subject will be the head at the time it is seeded. Not seeded as of this entry.

---

## Findings this workstream raised on itself

Not every finding comes from an audit. These were found while building, and are
recorded here because a defect found by the person who wrote the code is worth
exactly as much as one found by a reviewer — and is easier to leave unwritten.

### S-001 — the delivery decision's content hash could not fail

| | |
| --- | --- |
| Found | while implementing the reviewer attestation |
| Class | a check that cannot fail |
| Closed at | the reviewer attestation slice, `DECISION_LOG.md` § D-013 |

`decideReleaseRescueDelivery` recomputed a content hash from the artifact at
decision time and presented it as the binding between the reviewer's release and
the bytes released. It was recomputed from the very bytes about to be rendered,
so it always matched. A test asserted it — `expect(SAMPLE_DELIVERY.reviewer
.approvedContentHash).toBe(SAMPLE_DELIVERY.contentHash)` — and that assertion
could not have gone red for any input.

Closed by making the hash the reviewer's own, verified rather than derived. The
test now asserts the two are DIFFERENT and that the stored one matches a
recomputed review subject, which is a check with two outcomes.

### S-002 — `jsonb_typeof` of an absent key is not `<> 'object'`

| | |
| --- | --- |
| Found | by four existing QA proofs, on the first run of the v13 payload guard |
| Class | SQL three-valued logic |
| Closed at | the reviewer attestation slice |

The v13 guard returned early for an unsigned draft with
`if jsonb_typeof(v_signature) <> 'object' then return`. For a report with no
`reviewedBy` key at all, `jsonb_typeof` returns SQL NULL, the comparison is NULL
rather than true, and the early return did not fire — so every stored report
that omits the key was flagged as an incomplete signature. Four proofs went red
at once.

The guard's own draft fixture used an explicit JSON `null`, which is a different
shape and took the correct path. **The proof was written against the shape the
author had in mind rather than the shapes that exist**, which is the same failure
as R-001 one layer down. Both shapes are asserted now.

### S-003 — a loop that varies nothing

| | |
| --- | --- |
| Found | while reducing fixture cost in `release-rescue-audit7-properties.test.ts` |
| Class | a corpus that cannot disagree |
| Status | **open — recorded, not fixed** |

`never delivers a report carrying a credential from any lexicon key` iterates 6
qualifiers × 5 carriers × 2 spellings = 60 keys, and builds **the same report
every time**: the loop variable `key` is used only to label a failure, never to
compose the input. Sixty iterations of one case.

Not fixed here. It is outside this slice, and rewriting a property test's corpus
in the same commit that speeds it up is how a measurement gets quietly replaced
by a different one. Recorded so the next audit has it.

---

## Standing lessons

Each was bought with a regression in this workstream.

1. When a mechanism is **replaced** rather than extended, run the old
   implementation against the new mutants — **in both directions**. The `require`
   rule was diffed on its included direction only, and seven real module-load
   forms were silently dropped.
2. When a change alters what gets measured, measure both ways over the same
   corpus — **and confirm the corpus can disagree with the change**. R-001 is
   this rule broken; the ambiguity gate reverted at `e874c8c` is the same rule
   broken one round earlier.
3. A fix is not correct because it is the obvious repair. Measure it, be willing
   to revert, and do not conclude "this cannot be done" without measuring that
   too — an owner escalation was once written on a distance figure that was
   simply wrong, and an auditor closed the hole in fifteen lines.
4. A record that nothing executes is not evidence, and a record that states
   something untrue about what it covers is the same failure inverted.

---

## Continuous integration

### CI-001 — `verify` has never executed

| | |
| --- | --- |
| Status | **unavailable — no run has been demonstrated** |
| Observed on | `83cda0a`, `11f1661`, `e874c8c`, `148bb31`, `e673271` — five consecutive heads, plus every head since |

Every run completes in about two seconds with `runner_id` 0, an empty runner
name, an empty check title, summary and text, and no steps. Representative:

```
check_run 105333443527   head_sha 148bb31
runner_id 0 · runner_name "" · runner_group_id 0
created 18:39:09Z → completed 18:39:11Z
```

**Investigated locally, and the workflow is not the cause.** `.github/workflows/verify.yml`
parses, declares one job on `ubuntu-latest` with seven well-formed steps, and
references no secret, no environment, no container, and no self-hosted runner
label — so there is nothing in the definition for an account to withhold. No job
was ever assigned a runner; the failure is account-level, and it has been
corroborated from a different branch and a different actor.

This is recorded as **unavailable**, not as passing and not as failing for a
reason in this diff. A check that never ran is not evidence either way, and no
release claim on this branch may treat it as a signal.

**Separately, `verify` could not go green today even with a runner.** Its steps
are the ones that run locally, and measured on `148bb31`:

```
npm run lint      exit 0
npm run typecheck exit 0
npm test          exit 1     <- 8 environmental failures
```

So the runner outage and the red suite are two independent blockers, and fixing
the first would not clear the second. The suite is governed by `DECISION_LOG.md`
§ D-012, which now names the eight tests, the measured cause (this container's
Git 2.43.0 has no `--no-lazy-fetch`, which the adapter requires and preflights
for), the owner, and an expiration date.

The one permitted re-run is spent and Actions has not been retried. The
standing-down comment is on PR #97 (`issuecomment-5682530322`).

---

## Open owner decisions

| | Decision | Recorded |
| --- | --- | --- |
| D-012 | The verification policy required before `DO_NOT_MERGE` can lift, given eight environmental failures that are not this branch's to fix. | `DECISION_LOG.md` |
| ~~—~~ | ~~Whether `reviewedBy` should carry a **reason** and a **hash of the artifact approved**.~~ **Closed** by owner direction: it carries both. See `DECISION_LOG.md` § D-013 and migration `v13`. | `DECISION_LOG.md` |
| — | Payment activation, production access, and any increase in executor authority. | `VISION.md` § D-009 |
