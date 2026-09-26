---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Verification Before Completion

A claim that work is done, fixed, or passing needs fresh evidence from the current message. If you have not run the verification command in this message, you cannot claim it passes. An earlier run, a confident expectation, or another agent's report is not evidence: code and environments change between runs, and reports can be wrong. The rule covers the meaning of a claim, not only its exact words.

## The gate

Before stating any status, or saying you are satisfied with the work:

1. Identify the command that proves the claim.
2. Run the full command now, fresh and complete.
3. Read the whole output: the exit code and the failure count.
4. Check whether the output confirms the claim.
   - If it does not, state the actual status with the evidence.
   - If it does, state the claim with the evidence.
5. Only then make the claim.

A step that is skipped means the claim is unverified, and must be reported as unverified.

## What each claim needs

| Claim | Requires | Not sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Original symptom re-tested and passing | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows the changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

A linter does not check compilation, and a partial check does not prove the whole.

## Signs a claim is running ahead of the evidence

- Describing results with "should", "probably", or "seems to".
- Expressing satisfaction ("Great", "Perfect", "Done") before verification.
- Preparing to commit, push, or open a PR without verification.
- Trusting an agent's success report.
- Relying on partial verification.
- Making an exception for this one case.

When one of these appears, run the verification before saying more.

## Patterns

**Tests:** run the test command, see the result (for example `34/34 pass`), then say "All tests pass". Not "Should pass now" or "Looks correct".

**Regression tests (red-green):** write the test, run it (pass), revert the fix, run it (it must fail), restore the fix, run it (pass). Writing a regression test without this cycle does not show that it works.

**Build:** run the build and see exit 0. A passing linter does not show that the build succeeds.

**Requirements:** re-read the plan, make a checklist, verify each item, then report gaps or completion. Passing tests alone do not complete a phase.

**Delegated work:** when an agent reports success, check the VCS diff, verify the changes, and report the actual state.

## When to apply

Before:
- any claim of success or completion, however it is worded, including paraphrases and implications;
- any expression of satisfaction with the work;
- any positive statement about the state of the work;
- committing, creating a PR, or marking a task complete;
- moving to the next task;
- delegating to agents.
