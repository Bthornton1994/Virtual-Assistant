# RO readiness / conflict analysis — VA #111 (t1708u)

Snapshot fixture for the CoS control plane. As of 2026-09-29. This note is read-only analysis. It is not a CLEAR, a rebase instruction, or a merge authorization.

The same rules are enforced by `canDispatchIndependentWork`, `serializeConflict`, and `assertGatesClosed` in `src/lib/cos-control-plane.ts`.

## Targets

| Item | Tip | Draft | Notes |
| --- | --- | --- | --- |
| #108 (QA wait) | `2acdccbe97b51a592174321f35807e2b4a558bef` | yes | Independent QA running on `cursor/missing-test-coverage-90ed`. Do not write, rebase, or push that branch. |
| #111 (analysis only) | `23b983dc9d6f38cc5cb96fd6630c1937f58945c0` | yes | Separate branch `cursor/missing-test-coverage-8e40`. Read-only conflict and readiness analysis is allowed. |
| main | `fa0d9e8e35e9704bbe61dbcf5bb333f37d9b6412` | — | Base for new work, including this control plane. |

## Overlap

- #108 and #111 use different branches. #108 is `cursor/missing-test-coverage-90ed`. #111 is `cursor/missing-test-coverage-8e40`.
- A later merge order may still need a fresh `store.ts` conflict check. That check is read-only until each pull request has its own exact-SHA CLEAR.
- Media Lens #163 tip `789662fea5fd25eed1d9350c2823a168c3c2ba42` stays KEEP_DRAFT. Its branch is not pinned in this snapshot, so this note authorizes no write there. The #118 flag stays off. Markout C2, C3, and C5 stay unmet.

## Allowed now

- Read-only readiness and conflict analysis for #111.
- Independent work on a new branch from main, with no writer overlap onto #108 or #111.

## Forbidden until each item's own CLEAR

- Rebase, push, or any other write on the #108 branch.
- A rebase of #111 onto #108 "to help" the QA wait.
- Undraft or merge of #108 or #111.
- Opening Media Lens #118 or treating Markout C2, C3, or C5 as cleared.

## Recommendation

Keep the #108 wait with its existing independent-QA owner. One owner for that exact SHA. After CLEAR, merge test lanes serially. If #111 is still open, re-check `store.ts` against post-#108 main before anyone takes a writer seat. Do not seat a #111 writer while #108 QA is running.
