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
held by the pull request and by the owner's standing order (draft, no merge, no
deploy, no D-009 payments, no production). `DECISION_LOG.md` § D-012 held it
too until 2026-09-18, when the owner decided D-012; that decision settled the
release environment and lifted nothing else.

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

### S-008 — three of the intake form's four text boxes were not scanned

| | |
| --- | --- |
| Found | by an automated review on the PR |
| Class | a guard applied to a field instead of to a class |
| Closed at | the same commit |

`evidenceNotes` was scanned for credential material. `applicationName`,
`criticalWorkflow` and `criticalWorkflowEntryPoint` were not — they were
validated for length and shape and then stored. Reproduced before anything was
changed: `OPENAI_API_KEY=sk-proj-...` pasted into "describe the workflow" was
**accepted** and carried into the parsed contract, while the identical value in
`evidenceNotes` was refused with "That looks like a credential."

The form tells a customer it does not accept credentials, and for three of its
four text boxes that was not true.

This is the same defect the report side has been through four times: a guard
attached to a hand-picked field rather than to a class of fields. The scanned
list is declared once now, and a test walks the **stored contract** and fails if
any string in it is neither scanned, a closed enum, nor an identifier this
codebase mints. That walk immediately surfaced three strings — the demo
organization id and two service codes — which are accounted for by name rather
than by loosening the assertion.

### S-009 — the engagement lifecycle has preconditions but no transition graph

| | |
| --- | --- |
| Found | by an automated review on the PR |
| Class | a state machine enforced at its entrances only |
| Status | **CLOSED** — decided by the owner as D-014, enforced in `v14` |
| Closed at | `9617920` |

Reproduced against the real migration chain on a disposable Postgres. All three
of the reviewer's examples succeed:

```
intake          -> access_granted   ACCEPTED   with no repository grant recorded
access_granted  -> intake           ACCEPTED   a backward transition
cancelled       -> scoped           ACCEPTED   a cancelled engagement reopened
```

**What IS enforced, and it is not nothing.** `release_rescue_status_starts_review`
covers `auditing`, `report_ready` and `delivered`, and entering any of those
requires a recorded ownership confirmation written by an ops manager, a known
access mode, a repository named in the frozen scope, a pinned reviewed commit,
and a live unrevoked read-only grant. A direct `intake -> delivered` was refused
in the same probe, by the grant precondition.

So the states that carry the customer's source are well defended. What is missing
is an ORDER: `scoped` and `access_granted` are outside that set, and no trigger
compares `old.status` to `new.status`, so the graph is unenforced in both
directions.

**Not fixed here, and the reason is not effort.** Which transitions are legal,
and which role may make each one, is a lifecycle design decision with an
operational cost if it is guessed wrong — a graph that is too strict blocks a
legitimate operator recovering a mis-set engagement. `AGENTS.md` puts explicit
authority and required approvals on the owner's side of the line. The evidence is
here; the decision is not an executor's.

The first version of this probe reported all three as refused. That was a false
negative: the engagement fixture had failed to insert, so every `UPDATE` matched
zero rows and reported success by matching nothing. The result above is from a
run where the baseline `select` shows the row actually exists.

**How it was closed.** The owner decided the graph (D-014): `intake → scoped →
access_granted → auditing → report_ready → delivered`, cancellation from every
state before delivery, a manager-authorized recovery as the only way back from
`cancelled` (to `intake`, with a reason code, attributed to the caller the way
v5 attributes ownership confirmation), the sweep as the only way to `purged`,
and no way out of `delivered`. `v14` enforces it in two triggers that fire ahead
of every existing gate — one invoker-rights function that decides WHO may make
WHICH move, one definer-rights function that checks what must be TRUE to enter a
state — and logs every status change to a table only the trigger can write.
`src/lib/release-rescue-lifecycle.ts` mirrors the graph, and a static test reads
the migration's edge list and fails if the two disagree.

Measured rather than listed: the proof drives a fresh engagement to each of the
eight states through the real lifecycle and tries all **56** off-diagonal cells.
Exactly the ten normal-path edges succeed; the other 46 are refused by the
graph's own message, not by a precondition tripping first. The three
reproductions above are three of those 46, asserted by name. On the application
side the same 56 cells are decided under each of three authorities.

Five earlier proofs jumped `intake → auditing` to test the review-start gates.
They now walk to `access_granted` first, so each still exercises the gate it
names; `hardening_v3` gained a case for the v3 grant gate at its new position (a
grant revoked *after* access was recorded still does not start the review).

### S-010 — the retention sweep deletes artifacts by run, not by engagement

| | |
| --- | --- |
| Found | by an automated review on the PR |
| Class | a destructive operation scoped wider than the thing it acts on |
| Status | **CLOSED** — decided by the owner as D-015, enforced in `v14` |
| Closed at | `9617920` |

The sweep updates reports with `where engagement_id = ... and organization_id = ...`
and then deletes evidence with:

```sql
delete from public.evidence_artifacts
 where run_id = v_engagement.run_id
   and organization_id = v_engagement.organization_id
   and coalesce(payload->>'schemaVersion', '') like 'release-rescue-%';
```

The organization scope is there and deliberate. **The engagement scope is not.**
And nothing makes a run exclusive to one engagement — the only constraint on
`release_rescue_engagements.run_id` is a composite foreign key to
`workstream_runs (id, organization_id)`, with a plain non-unique index beside it:

```
release_rescue_engagements_run_organization_fkey  FOREIGN KEY (run_id, organization_id) ...
release_rescue_engagements_run_idx                btree (run_id) WHERE run_id IS NOT NULL
```

So two engagements in one organization may share a run, and purging the first
deletes the second's unexpired artifacts.

**Not fixed there, because both repairs change a privacy commitment.** Deleting
only artifacts referenced by this engagement's report rows would leave any
artifact with no report row behind — which for a retention promise may be the
worse failure. Enforcing one engagement per run constrains a relationship this
schema currently allows. That is the owner's call, not an executor's.

**How it was closed.** The owner chose exclusivity (D-015). `v14` replaces the
plain index with a unique partial index on `run_id`, after counting shared runs
and failing the migration if any exist rather than applying over a violation. A
report must name the run pinned on its engagement. The sweep is redefined with
one addition: before each evidence delete it checks that no other engagement
holds the run, and if one does it **refuses** — the sweep aborts rather than
reaches the second engagement. The unique index makes that branch unreachable;
it is there so that dropping the index can never quietly widen a destructive
operation. The proof drops the index inside a transaction, manufactures the
shared run, and asserts the refusal, then rolls back and asserts the index is
back.

The v7 property proof caught this pass's first version of the sharing check:
it read `release_rescue_engagements` without an `organization_id` conjunct,
which is exactly the class v7 exists to catch. The composite key already
confines every engagement on a run to the run's organization, so the conjunct
loses nothing; it was added and the v7 proof passes again. A property proof that
has been seen to fail is evidence; that one now has.

Two earlier proofs (`hardening_v2`, `reviewer_attestation_v13`) issued reports
for engagements with no pinned run; both now pin the run their reports name.
`trust_boundary_v5` created three engagements on two runs; it now creates four
runs.

### S-011 — the public demo store has no retention bound

| | |
| --- | --- |
| Found | by an automated review on the PR (P2) |
| Class | customer data with no expiry on a path open to the public |
| Status | **CLOSED** — decided by the owner as D-016 |
| Closed at | `e50611c` |

`createDemoEngagement` writes into a process-global `Map` and nothing ever
removes an entry: `engagement.ts` contains no delete, eviction, expiry, TTL,
prune, clear, or size check of any kind. Each record holds a prospect's name,
work email, private repository reference and workflow description.

The 24-hour cookie is real and does its own job — it stops a viewer who merely
knows the id from reading the record — but it governs the browser, not the
store. The record itself survives for the life of the process, and repeated
anonymous submissions grow the map without bound.

Scope worth stating: this is the demo path, which takes no payment and grants no
repository access. It is still customer-supplied contact data on a route anyone
can reach, and `VISION.md` treats retention as a commitment rather than a
convenience.

**How it was closed.** The owner set a 24-hour TTL and a fixed ceiling (D-016).
Every record now carries an absolute `expiresAt`; a record at or past it is
unreadable and is removed the next time the store is touched. The TTL is one
constant shared with the cookie's `maxAge`, so the record cannot outlive the
only thing that can reach it and the cookie cannot point at a record that is
gone. The store holds at most `DEMO_STORE_MAX_ENTRIES` (200) records; a
submission that would exceed it evicts the oldest, after expired records are
pruned, so a live record is never evicted while a dead one holds a slot. No
timer: expiry is checked on read and on write, so nothing depends on a
background task or on the process staying up between two ticks. The store is a
factory with an injected clock and bounds, so the tests drive the boundary
exactly — a record is served one second before it expires and refused at the
instant — rather than waiting on wall-clock time.

### S-013 — an interactive caller could sign a report as someone else

| | |
| --- | --- |
| Found | listed as the fourth outstanding item on PR #97; the same shape v5 closed for ownership confirmation |
| Class | a validity check on a value in `NEW`, where the property needs a privilege check on the caller |
| Status | **CLOSED** — decided by the owner as D-017, enforced in `v14` |
| Closed at | `9617920` |

`reviewed_by` has been `NOT NULL` and checked for manager authority since `v1`.
Nothing compared it to the caller, so an ops manager signed in through the API
could insert a report row naming a *different* manager as its reviewer, and the
v13 row/artifact binding — which holds the row to the artifact — would hold it
to an artifact carrying the same wrong name. The customer-visible signature and
the authority check agreed with each other and with nobody who had actually
acted.

**How it was closed.** The v5 trust model, applied to the signature. An
interactive `INSERT` on `release_rescue_reports` requires `reviewed_by =
auth.uid()` and refuses a mismatch rather than correcting it; the server channel
may name a reviewer, who must still hold manager authority; `reviewed_via`
records which. The same binding applies to a report artifact a staff member
writes directly: its `reviewedBy.operatorUserId` and every `clearedBy` must be
the writer. In the application, `signReleaseRescueReportAs(actor, report,
submission)` reads the reviewer's identity and display name from the
authenticated session and the time from the server clock; the submission is a
strict schema of a reason code and the approved hash, and one that carries an
identity is refused as malformed, naming the field and never the value.

Proven from both sides: the first manager cannot issue a report signed by the
second, the second issues it as themselves and the row records
`authenticated_operator` whatever channel the caller claimed, and the server
channel still refuses a plain operator.

### S-014 — a ratio threshold that sat above quadratic, and failed on noise

| | |
| --- | --- |
| Found | by CI, on `df93008`: `verify` failed `npm test` 1,648 / 1,650, on a file none of that head's commits touch |
| Class | a threshold nobody meant to assert — S-005 and S-012, a third time |
| Closed at | the same commit that records it |

`release-rescue-scanner-value-properties.test.ts` › *the scan stays bounded as
the input grows* asserted `time(80KB) / time(40KB) < 3` for five input shapes,
with a comment calling 3 "the line between linear and quadratic". On the run:

```
equals signs   80KB took 398.6ms vs 40KB 109.7ms   ratio 3.63
quotes         80KB took  24.8ms vs 40KB   7.8ms   ratio 3.18
```

**The threshold could not fail on complexity.** `MAX_SCAN_LENGTH` is 64,000,
so the "80KB" input was clipped and the step actually measured was 1.6x — the
same clipping S-005 found and fixed in the *other* growth test, left in place in
this one. On a 1.6x step a linear scan reads 1.6 and a quadratic one 2.56. Both
are under 3. What is over 3 is a runner that is descheduled during the five
largest samples, which is what happened: the 40KB samples themselves ran about 45%
slower than here, and both shapes crossed the line at the same moment.

Measured before anything changed, by the exponent method S-005 established
(sizes derived from the bound, warmed, best of three, three real doublings):

| shape | timings 8 → 16 → 32 → 64KB | exponent |
| --- | --- | --- |
| `password=` repeated | 10.8 → 24.0 → 56.5 → 145.2ms | **1.25** |
| `--password x ` repeated | 1.1 → 2.2 → 4.5 → 10.7ms | 1.10 |
| credential nouns in prose | 0.9 → 1.8 → 3.7 → 7.6ms | 1.01 |
| `password="a" ` repeated | 1.0 → 2.0 → 3.9 → 7.7ms | 1.00 |

1.0 is linear, 2.0 quadratic. The two shapes CI failed are 1.25 and 1.00. The
scanner is not the cause and is not changed.

**Closed the way the S-012 lesson says to.** The four shapes only this block
covered are added to the exponent test in
`release-rescue-credential-scanner.test.ts`, which asserts growth on purpose and
by a method one noisy sample cannot flip. The ratio assertion is removed, the
block's sizes are derived from the bound so nothing is clipped, and the one
assertion it keeps is the absolute ceiling it can keep true. The 1.25 on
`password=` is recorded rather than smoothed: it is under the 1.5 line S-005 set
and its per-doubling ratios rise (2.22, 2.35, 2.57), which is the shape of a
mild super-linear component. It is not a finding at this size; it is a number
the next scanner change should measure against.

The pattern, stated for the third time: **S-005** was a 20ms floor that skipped
a real defect; **S-012** a 5s ceiling that failed a correct test; **S-014** a
ratio that sat above the complexity it claimed to bound and below the noise it
did not. Each was a threshold the machine decided, on a test that meant to
measure something else. There is now one growth test, and it measures growth.

### S-015 — the proof-base paragraph counted a chain that had since grown

| | |
| --- | --- |
| Found | while re-measuring the v14 work rather than accepting it |
| Class | a published figure nothing read |
| Closed at | this commit |

The architecture doc said the proof base *"applies 55 of 59 migrations"* and that
*"all fourteen Release Rescue proofs run against the result"*. Measured on a
freshly rebuilt base at `df93008`: the directory holds **60** migrations, **56**
apply, and there are **fifteen** Release Rescue proofs. Both figures went stale
in the commit that added `v14` and its proof, and nothing said so, because
nothing read them.

The headline figure two hundred lines above it — *"495 live database cases across
fifteen proofs"* — was correct, and correct for a reason: a test sums the
doc's per-proof table, compares it to the headline, counts the proof directory
from disk and requires the headline to name that number in words. The paragraph
that drifted was the one with no test on it.

So it has one now, in `release-rescue-migration.test.ts`: the denominator must
equal the migration directory, every migration the paragraph names as not
applying must exist in the chain, and the arithmetic
`stated_total - stated_applied` must equal the number of migrations named.
Both halves were mutation-checked — restoring "55 of 59" fails the first,
deleting one named migration fails the second.

Also recorded there, because it costs an hour to rediscover: the v14 proof stops
with `function extensions.digest(text, unknown) does not exist` on a base built
in this container, because `pgcrypto` ships in `template1` and is therefore
already installed in `public`, which makes
`create extension ... with schema extensions` a no-op. On Supabase the extension
is in `extensions` and the proof is correct as written. The local base declares
two delegating wrappers. **This reads like a proof failure and is an environment
gap** — the distinction is the reason it is written down rather than worked
around silently.

### S-016 — the interactive signing path S-013 closes has no production caller yet

| | |
| --- | --- |
| Found | while verifying `9617920` |
| Class | scope of a closed finding, stated precisely |
| Closed at | not a defect; recorded so the closure is not read as wider than it is |

S-013 is closed correctly and the control is real: `release_rescue_reports` has a
`before insert or update` trigger that refuses any interactive INSERT whose
`reviewed_by` is not `auth.uid()`, and `evidence_artifacts` has one that refuses
a report artifact attributing its signature or a secret-hold clearance to anyone
else. Both were exercised live in the `v14` proof.

What is worth stating plainly: **the application half has no production caller.**
`signReleaseRescueReportAs` is reached only from its own test file, and no route
or server action in `src/` inserts into `release_rescue_reports`. There is no
reviewer console yet. The finding was prospective — the shape that would have
been wrong the first time someone wrote that handler — not a live path a
customer's report could have travelled. Closing it before the handler exists is
the right order; describing it as a hole that was open is not.

The artifact-side trigger fires `before insert` only, where the other Release
Rescue artifact guards fire on insert **or** update. That is sufficient rather
than an oversight, and it was checked rather than assumed: a real row was fetched
from the `v14` proof database and updated, and
`trg_evidence_artifact_invariants` refused it with *"Evidence artifacts are
immutable"*. There is no update path for the insert-only trigger to miss.

### S-012 — a 5-second default decided whether the claim guard's own test passed

| | |
| --- | --- |
| Found | by CI, failing on a commit that changed only markdown |
| Class | a threshold nobody meant to assert |
| Closed at | this commit |

`verify` failed on `f214f0b` with **1,584 passed / 1 failed**, and the one
failure was not an assertion:

```
FAIL  release-rescue-claim-guard.test.ts > declares exactly the files that
      need a claim-bearing exemption, and no more
Error: Test timed out in 5000ms.
```

`f214f0b` changed the audit ledger and nothing else — markdown this test never
reads — and the same test had passed on the three heads before it. Measured
locally, the case takes **3,906ms against vitest's 5,000ms default**: 78% of the
budget on an unloaded machine, for a case that parses every one of the 176 files
reachable from the marketing route. A loaded runner, or one more surface file,
decides the result.

The property under test is the exemption list, asserted from both sides. **How
long the parse takes is not part of it.** The default timeout was a performance
assertion nobody wrote on purpose, sitting on a test whose cost grows with the
codebase — so it is now explicit and generous, and the comment says why.

This is S-005 again in a different place: *a threshold the machine decides,
attached to a test that never meant to measure time*. S-005 was a 20ms floor that
skipped a real defect; this one was a 5s ceiling that failed a correct one. The
pair is the argument for keeping deliberate timing assertions in the one test
that measures growth on purpose, and out of every test that does not.

### S-003 — a loop that varies nothing

| | |
| --- | --- |
| Found | while reducing fixture cost in `release-rescue-audit7-properties.test.ts` |
| Class | a corpus that cannot disagree |
| Status | **corpus closed, delivery half unreachable** — the sixty assignments are distinct and a clean signature is deliverable; the gate assertion is resolved by the signer and is asserted as such |
| Closed at | `35706a447bb3ce38be755f67b3864bc8beb24f3d` |

`never delivers a report carrying a credential from any lexicon key` iterated 6
qualifiers × 5 carriers × 2 spellings = 60 keys, and built **the same report
every time**: the loop variable `key` was used only to label a failure, never to
compose the input. Sixty iterations of one case.

The corpus is now the assignments themselves: each qualifier, carrier and
spelling produce `${KEY}=${SECRET}` in both separated and run-together form.
The test asserts `inputs.length === 60` and `new Set(inputs).size === 60`
before signing any of them onto `reviewedBy.displayName`, the one free-text
string a report still holds. `ACCESS_TOKEN=` and `ACCESSTOKEN=`, `PG_PASSWORD=`
and `PGPASSWORD=` are all present.

A second vacuity sat under that one. The finding lived on an all-pass
assessment sheet, so the delivery gate was false for every input and
`includes(SECRET)` never ran. The matching check is now marked fail, and a
clean signature on that draft is asserted deliverable before the planted
names are tried. Signing still refuses a credential-shaped display name
rather than rewriting it; a name that nevertheless reaches a deliverable
report holding the value fails the property.

No production behaviour changed. S-004 and S-005 are untouched.

**Measured on `35706a4`:**

Local (Git 2.43.0, the D-012 container):

```
npm run lint       exit 0    0 errors, 13 pre-existing warnings
npm run typecheck  exit 0
npm test           exit 1    1,577 passed / 8 failed   the eight shunt CLI tests
npm run build      exit 0
```

GitHub Actions `verify` run [35286805441](https://github.com/Bthornton1994/Virtual-Assistant/actions/runs/35286805441) attempt 1, job `105420829075`, SHA `35706a447bb3ce38be755f67b3864bc8beb24f3d`:

```
npm ci             success
npm run lint       success   0 errors, 13 warnings
npm run typecheck  success
npm test           success   1,585 passed / 1,585   86 files
npm run build      success
```

The eight local failures are the D-012 Git 2.43 / `--no-lazy-fetch` environment split. They are not reopened here. CI is the release environment.

Proof the corpus is not sixty copies of one case: 6 × 5 × 2 = 60 generated assignments, `new Set(inputs).size === 60`, and both spellings of the same pair are present (`ACCESS_TOKEN=` vs `ACCESSTOKEN=`, `PG_PASSWORD=` vs `PGPASSWORD=`).

**A third vacuity sat under the second, and it was measured rather than
reasoned about.** The rewritten loop skipped an input whose signature was
refused, with a bare `continue`. Counted:

```
total inputs        60
refused at signing  60
reached the gate     0
```

**Every one of the sixty is refused at the signature, so none reaches the
gate.** The closing assertion — the one that reads as "the delivery gate never
delivers a credential" — was resolved entirely by `signReleaseRescueReport`
refusing reviewer text that would have to be redacted (S-006, S-008), a guard
added to this codebase *after* the test was written. The gate check in the loop
body is unreachable.

That is not an argument for deleting the test: refusing all sixty forms at the
signature is a real and strong property. It is an argument for asserting the
property that holds rather than one that reads better. Both outcomes are tallied
now, `refused.length` is asserted to be the full sixty, and the delivery list
stays and becomes live the moment anything stops being refused at the signature.

Three passes were needed to make one sixty-iteration loop mean something, and
each pass removed a different reason it could not fail. The pattern worth keeping
is not any of the three fixes — it is that **a loop with a `continue` in it is a
loop that can quietly test nothing**, and the way to find out is to count both
branches rather than read the code.

---

## Local verification, re-measured rather than inherited

The `v14` work (`4a1a084` … `df93008`) and the two commits after it arrived from
a second executor. They were re-run here from a freshly rebuilt proof base rather
than accepted, on the argument this ledger has made about every other
executor-produced change. Every figure below was measured on this branch; none is
quoted from a commit message.

| Gate | Result |
| --- | --- |
| Unit suite | **1,648 passed / 8 failed.** The eight are exactly the `software-context-shunt-cli` cases governed by `DECISION_LOG.md` § D-012. **The suite is not green, and is not described as green.** |
| Typecheck | 0 errors |
| Lint | 0 errors, 13 warnings, all pre-existing and outside Release Rescue |
| Production build | succeeds |
| Claim-guard mutation proof | 39 of 39 mechanisms held, control unchanged |
| Database proofs | **495 cases across 15 proofs, all passing**, counted with `grep -cE "PASS [a-z_]+ +\|"` — never `grep -c "PASS "`, which has inflated this figure twice. Measured at `df93008`; no migration or proof file has changed since |
| Browser | **16 passed, 1 skipped** across the four specs that need no credential — the 13 Release Rescue cases, delivery authorization, and two demo-lifecycle cases; `production-golden-path` skips itself without a preview environment |

`persistent-login.spec.ts` and `preview-golden-path.spec.ts` throw at load
without `E2E_PASSWORD`. They target preview and production, this branch holds no
such credential, and none was obtained. They are **not run**, and not counted
above. An earlier draft of this block said four specs were blocked this way;
two of them are not, and were run.

Two things were mutation-checked rather than read, because both are the kind of
check that passes while asserting nothing:

- **The TypeScript-to-SQL edge binding.** Adding `('intake', 'access_granted')`
  to the migration's edge list fails
  *"declares exactly the edges the application declares"*. The two graphs cannot
  drift apart quietly.
- **The 56-cell transition matrix.** Pointing its fixture at an id naming no row
  — the vacuous-fixture defect this workstream has now made three times — makes
  every one of the 56 cells report *accepted*, and the proof stops with
  *"exactly the ten normal-path edges are accepted"* listing all 56. The matrix
  cannot pass on an empty table.

**One figure in this ledger disagrees with another, and neither is being quietly
dropped.** CI-001's local row for `4fcbbba` records the proof base as *54 of 60
migrations applied*; the base built for the run above applied **56 of 60**. The
two agree on everything that bears on the result — 60 migrations in the chain, 15
proofs, 495 cases, 0 failures, and no Release Rescue table touched by anything
skipped — and differ in how each base handles the migrations that cannot replay
onto an empty database. The architecture document now **names** the four that do
not apply here, and a test requires that list to match the chain and the
arithmetic, so this figure is checkable rather than asserted. Which base
composition is right is not settled by this entry.

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

### CI-001 — `verify` had never executed, then it did, then it passed

| | |
| --- | --- |
| Status | **RESOLVED, and GREEN — `verify` passed in full at 2026-09-17T23:17Z** |
| Unavailable on | `83cda0a`, `11f1661`, `e874c8c`, `148bb31`, `e673271`, `44e825a` — six consecutive heads, each checked |
| First executed on | `ea9e81a`, run `35278577643` attempt 2, runner `GitHub Actions 1000001844` |
| First passed on | `7969a76`, run `35285958590` attempt 1, runner `GitHub Actions 1000001848` |
| Also passed on | `35706a4`, run `35286805441` attempt 1 — S-003 head, 1,585/1,585 |
| Failed on | `df93008`, run [35308044742](https://github.com/Bthornton1994/Virtual-Assistant/actions/runs/35308044742) — `npm test` 1,648 / 1,650, the two S-014 ratio assertions; lint and typecheck green, build skipped |
| Passed on | `4fcbbba`, run [35308531433](https://github.com/Bthornton1994/Virtual-Assistant/actions/runs/35308531433) attempt 1 — **1,654 / 1,654 across 88 files**, every step, 04:51:07Z → 04:53:07Z |

**Measured on `4fcbbba`, the owner-order head (D-012, D-014 to D-017, S-009 to
S-011, S-013, S-014):**

Local (Git 2.43.0, the D-012 container):

```
npm run lint       exit 0    0 errors, 13 pre-existing warnings
npm run typecheck  exit 0
npm test           exit 1    1,646 passed / 8 failed   the eight shunt CLI tests, D-012
npm run build      exit 0
proofs             15 files, 495 cases, 0 failures   disposable Postgres 16, 54 of 60 migrations applied
```

GitHub Actions `verify` run `35308531433`, SHA `4fcbbba73faff3bf55bd57dd8d2ad429c6a24ba1`:

```
npm ci             success
npm run lint       success   0 errors, 13 warnings
npm run typecheck  success
npm test           success   1,654 passed / 1,654   88 files
npm run build      success
```

Under D-012 as decided, the eight local failures do not block: their sole cause
is the container's Git 2.43 lacking `--no-lazy-fetch`, and CI `verify` passed on
the exact SHA. The `df93008` failure was a GitHub Actions failure and did block,
by the same decision, until its cause was found and closed as S-014; it was not
re-run.

**Green, measured, every step:**

```
Set up job / checkout / setup-node / npm ci   success
npm run lint                                  success   23:15:28 → 23:15:42
npm run typecheck                             success   23:15:42 → 23:15:53
npm test                                      success   23:15:53 → 23:16:55
npm run build                                 success   23:16:55 → 23:17:18
```

This is the first green `verify` in the history of this branch, and it arrived
two runs after the first one that executed at all. Between them: S-004, the
near-quadratic scan path CI found, and S-006 to S-008, the review findings.

**Say both halves or neither.** `npm test` passes on CI and the same command has
**8 failures in the development container**, for the reason recorded under D-012:
the container ships Git 2.43.0 and the runner ships 2.55.0. Neither number is the
whole truth on its own.

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

## Owner decisions

| | Decision | Recorded |
| --- | --- | --- |
| D-012 | **Decided 2026-09-18.** "GitHub Actions `verify` on the exact candidate SHA is the authoritative release environment. Local failures caused solely by unsupported Git 2.43 do not block when CI `verify` passes. Any GitHub Actions failure remains a blocker." Review by 2026-10-17. | `DECISION_LOG.md` § D-012, amended to this wording from the owner's implementation order |
| D-014 | **Decided 2026-09-18.** The lifecycle is an ordered graph; reopening a cancelled engagement is a manager-authorized recovery; delivered does not reopen. Closes S-009. | `DECISION_LOG.md` § D-014, migration `v14` |
| D-015 | **Decided 2026-09-18.** A run belongs to one engagement; the sweep is scoped to it. Closes S-010. | `DECISION_LOG.md` § D-015, migration `v14` |
| D-016 | **Decided 2026-09-18.** Demo submissions expire in 24 hours; the store has a fixed ceiling. Closes S-011. | `DECISION_LOG.md` § D-016 |
| D-017 | **Decided 2026-09-18.** Interactive reviewer actions are bound to the authenticated user. Closes S-013. | `DECISION_LOG.md` § D-017, migration `v14` |
| ~~—~~ | ~~Whether `reviewedBy` should carry a **reason** and a **hash of the artifact approved**.~~ **Closed** by owner direction: it carries both. See `DECISION_LOG.md` § D-013 and migration `v13`. | `DECISION_LOG.md` |
| — | Payment activation, production access, and any increase in executor authority. **Still open**, and not this branch's to take. | `VISION.md` § D-009 |

> **The D-012 disagreement is resolved, and this is how.** From `f214f0b` to
> `907ba22` this table and `DECISION_LOG.md` § D-012 disagreed: the table
> recorded D-012 as decided, citing "this task", and the register read
> *open — owner decision required*. The rule this ledger stated was that only
> the owner amending the register in their own words could settle it.
>
> On 2026-09-18 the owner's implementation order, issued through the Chief of
> Staff, carried the decision's exact wording and directed that § D-012 be
> amended to it. It was, in the same commit as this row, and the wording in the
> register is the owner's. The register and this table now agree, for the
> reason the rule required rather than because this table was left standing.
>
> What did not change: `DO_NOT_MERGE`, held by the pull request and by the
> owner's standing bans; the local suite, which still shows the eight shunt CLI
> failures on Git 2.43 and is reported as such; and the requirement that any
> GitHub Actions failure blocks.
