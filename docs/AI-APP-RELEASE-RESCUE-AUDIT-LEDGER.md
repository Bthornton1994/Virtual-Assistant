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

### S-004 — the credential scanner was near-quadratic on a single long line

| | |
| --- | --- |
| Found | by CI, the first time `verify` ran on a real runner |
| Class | complexity, on the path that reads adversarial input |
| Closed at | the same commit that records it |

`collectOpaqueTokensNearCredentialNouns` resolved each word's line with
`text.lastIndexOf("\n", offset)`, once per word, in each of two loops. On text
with no newlines that scans back to offset zero every time, so the function was
O(n²) in the length of the text — and one long line is not exotic here: it is a
pasted note, a minified file, a config value, or an adversarial payload, which
supplies the credential noun that makes this function run in the first place.

Measured inside the 64,000-character scan bound, with warm-up, before and after,
on the same harness:

| shape | exponent before | exponent after | 64KB before | 64KB after |
| --- | --- | --- | --- | --- |
| `<password>` repeated | **1.771** | 1.037 | 138.31ms | 11.28ms |
| `password:` repeated | 1.263 | 1.047 | 333.05ms | 189.78ms |
| `--password ` repeated | 1.132 | 1.134 | 23.98ms | 24.34ms |
| every other shape | ≈1.0 | ≈1.0 | — | — |

1.0 is linear, 2.0 is quadratic. The before figures rose across successive
doublings (3.10, 3.48, 3.70 for the worst shape), which is what distinguishes
super-linear growth from measurement noise. Exactly the three shapes containing a
credential noun were slow, and every shape that returns early was clean — the
prediction the diagnosis made before the fix, and the reason it is a root cause
rather than a guess.

Fixed by indexing the newline offsets once and binary-searching them.
`lastIndexOf` semantics are preserved exactly.

### S-005 — the test that should have caught S-004 was skipping the check

| | |
| --- | --- |
| Found | while root-causing S-004 |
| Class | an assertion with an escape hatch, and a claim its code did not meet |
| Closed at | the same commit |

Two defects in one test, `the scan is near-linear on adversarial input`:

1. It said "measured at 20, 40 and 80KB". `MAX_SCAN_LENGTH` is 64,000, so the
   80KB input was clipped and the final step was a 1.6x increase described as a
   doubling. The sizes are derived from the constant now, so they cannot drift
   from it again — a literal beside a constant is how they drifted in the first
   place.
2. The ratio check carried `if (timings[index - 1] < 20) continue`. On this
   machine the decisive input ran in **18.65ms** — just under the floor — so the
   one comparison that would have caught S-004 was silently skipped and the suite
   was green. CI's slower machine measured 31.88ms for the same input, the check
   ran, and it failed at 3.81.

**A skip is not a pass, and this one was indistinguishable from one.** The
assertion is now the growth exponent across the whole range, which nothing can
skip and which one noisy sample cannot flip.

The pair is worth stating plainly: a real defect sat behind a threshold for
several rounds, and it took a *different machine* to cross it. The eight
`software-context-shunt-cli` failures are the same lesson inverted — those pass
on CI and fail here.

### S-006 — the v13 trigger bound two of four signature fields

| | |
| --- | --- |
| Found | by an automated review on the PR, before this migration had run anywhere |
| Class | a binding that covers part of what it claims to bind |
| Closed at | the same commit |

The `v13` row/artifact trigger compared `reasonCode` and `approvedContentHash`
and said nothing about `operatorUserId` or `reviewedAt`. The row's `reviewed_by`
is the field checked for manager authority; the artifact's
`reviewedBy.operatorUserId` and `displayName` are what a customer's report shows
as the signature. Binding two of four let those disagree — a row naming an
authorised manager could point at an artifact attributing the review to any id,
any name and any time, and the database and the delivery gate both accepted it.

**The authority check and the customer-visible attribution have to be about the
same person, or the authority check is decoration.** All four fields are bound
now, with the timestamp parsed rather than string-compared so that the same
instant in another offset is not a spurious refusal. `reviewed_at` defaults to
`now()`, which is how a row and its artifact drift apart without anyone choosing
it, so a signed report must now state its own review time.

Worth naming: this is the reviewer-attestation slice's own mechanism, and the
defect is the same shape as the one the slice was written to fix — a record that
looks like a binding and does not bind the thing that matters.

### S-007 — the same absent-key defect, fixed once and left in place twice

| | |
| --- | --- |
| Found | by two existing QA proofs, on the run after S-006's fix |
| Class | a defect fixed at one occurrence and not at the other |
| Closed at | the same commit |

S-002 was `jsonb_typeof` of an ABSENT key returning SQL NULL, so
`jsonb_typeof(x) <> 'object'` is NULL rather than true and an early return does
not fire. It was fixed in `release_rescue_payload_unattested_signature`.

**The identical expression sat in the row/artifact trigger, in the same file, and
was not fixed.** It stayed invisible until the S-006 binding gave the signed
branch something new to reject: two proofs whose report bodies carry no
`reviewedBy` key were then judged against a signature that was not there, and
both went red.

The lesson is cheap to state and was not free to learn: **fixing one occurrence
of a defect is not fixing the defect.** A grep for the expression would have
found the second one in seconds. There is now an explicit proof case for a row
accepted against a body with no `reviewedBy` key, rather than leaving that
coverage to two older fixtures that could change for unrelated reasons.

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

### CI-001 — `verify` had never executed, until it did

| | |
| --- | --- |
| Status | **RESOLVED — `verify` executed on a real runner at 2026-09-17T22:47Z** |
| Unavailable on | `83cda0a`, `11f1661`, `e874c8c`, `148bb31`, `e673271`, `44e825a` — six consecutive heads, each checked |
| Executed on | `ea9e81a`, run `35278577643` attempt 2, runner `GitHub Actions 1000001844` |

**The outage lifted.** A re-run the owner started — not this executor; the one
permitted re-run remains unspent on our side — was assigned a runner and ran
every step:

```
Set up job / checkout / setup-node / npm ci   success
npm run lint                                  success
npm run typecheck                             success
npm test                                      FAILURE   1,577 passed / 1 failed
npm run build                                 skipped
```

That record settles two questions that had been open:

1. **The eight `software-context-shunt-cli` failures are not failures on CI.**
   All thirteen tests in that file passed. The runner reports `git version
   2.55.0`, which carries `--no-lazy-fetch`; this container has 2.43.0, which
   does not. The D-012 diagnosis is confirmed exactly, and its premise — that
   those eight failures are what keeps the suite red — is false for CI.
2. **A different test failed, and it was right to.** That is S-004, a real
   near-quadratic path in the credential scanner that this container's timings
   had been hiding behind a threshold. CI found a genuine defect on its first
   run, which is the strongest argument available for why a check that never
   ran was never evidence of anything.

What follows was written while the outage stood. It is kept rather than deleted:
it was true when written, and the investigation it records is what established
that the failure was account-level rather than a defect in the workflow.

Every run completes in about two seconds with `runner_id` 0, an empty runner
name, an empty check title, summary and text, and no steps. Representative:

```
check_run 105333443527   head_sha 148bb31
runner_id 0 · runner_name "" · runner_group_id 0
created 18:39:09Z → completed 18:39:11Z

check_run 105394300819   head_sha 44e825a
runner_id 0 · runner_name "" · runner_group_id 0
created 21:44:46Z → completed 21:44:48Z
```

An earlier revision of the row above read "five consecutive heads, **plus every
head since**". That clause was written before any head after `e673271` existed,
so it claimed evidence that had not been collected — the failure this ledger
exists to catch, in the ledger's own wording. It is replaced by the list of
heads actually checked, and a head is added to that list only after its check
run has been read.

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

So the runner outage and the red suite were two independent blockers, and fixing
the first would not have cleared the second. That framing held while the outage
stood; the run above replaced the second half of it, because on CI those eight
tests pass. The suite is governed by `DECISION_LOG.md` § D-012, amended in the
same commit as this entry.

The one permitted re-run was never spent. Actions was not retried by this
executor at any point, including after the outage lifted.

The one permitted re-run is spent and Actions has not been retried. The
standing-down comment is on PR #97 (`issuecomment-5682530322`).

---

## Open owner decisions

| | Decision | Recorded |
| --- | --- | --- |
| D-012 | The verification policy required before `DO_NOT_MERGE` can lift, given eight environmental failures that are not this branch's to fix. | `DECISION_LOG.md` |
| ~~—~~ | ~~Whether `reviewedBy` should carry a **reason** and a **hash of the artifact approved**.~~ **Closed** by owner direction: it carries both. See `DECISION_LOG.md` § D-013 and migration `v13`. | `DECISION_LOG.md` |
| — | Payment activation, production access, and any increase in executor authority. | `VISION.md` § D-009 |
