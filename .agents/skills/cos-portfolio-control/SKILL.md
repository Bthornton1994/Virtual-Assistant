---
name: cos-portfolio-control
description: >
  Classify Chief of Staff coordination as a single item, a finite batch, or an
  ongoing portfolio before starting workers, ledgers, or monitors. Use when
  work spans repositories or pull requests, when an item is waiting on exact-SHA
  QA while other work could proceed, or when branch writes, pull request edits,
  merges, releases, deploys, or shared environments might conflict. Coordinate
  external waits without idling: one owner per wait and one writer per branch.
---

# CoS portfolio control

Delegation Cloud owns this coordination. Read the [portfolio control plane](../../../docs/cos/PORTFOLIO-CONTROL-PLANE.md) and the [portfolio execution playbook](../../../docs/AUTONOMOUS-PORTFOLIO-EXECUTION-PLAYBOOK.md) before staffing work. Deterministic checks live in [`src/lib/cos-control-plane.ts`](../../../src/lib/cos-control-plane.ts). The current read-only readiness snapshot is [VA #111](../../../docs/cos/VA-111-RO-READINESS.md).

This skill does not grant merge, deploy, spend, model-routing, or gate-clearance authority. Canonical skill text lives in `.agents/skills/cos-portfolio-control/`. `.claude/skills/cos-portfolio-control/` is the mirror.

## 1. Classify before staffing

Classify the work as single, batch, or portfolio before creating workers, ledgers, or monitors. Use the smallest process.

- **Single:** one repository item (one issue or pull request). No portfolio sweep.
- **Batch:** a finite queue. Record an owner, a status, and a next action for each item. Do not start a standing monitor.
- **Portfolio:** ongoing coordination across more than one item. Only then start a portfolio sweep, and only by reusing monitors that already exist under CoS authority.

## 2. Compact item record

Every tracked item carries one durable record:

| Field | Content |
| --- | --- |
| repo | Repository |
| issue/PR | Issue or pull request id |
| owner/worker | Accountable owner and current worker |
| branch/worktree | Branch and worktree, when one exists |
| full SHA | 40-character commit, not an abbreviation |
| phase | Current phase |
| external wait | Exact wait, including the run or full SHA, with one owner |
| gate/blocker | Closed gate or blocker, or none |
| last evidence | Latest evidence reference |
| next action | The next authorized action |

## 3. Waiting is per item

A QA wait blocks that item only. Continue safe independent work on other branches. One writer per branch and pull request. Use worktrees and explicit scope boundaries so writers do not overlap.

## 4. One owner per external wait

Each external wait has one owner and one exact run or full SHA. Do not add a second watcher. Resume that item when evidence for that exact SHA arrives.

## 5. Serialize conflicting public actions

Serialize same-branch writes, pull request mutations, merges, releases, deploys, and shared live environments. Preserve exact-SHA QA and owner gates. A wait does not authorize writes on the waiting branch.

## 6. Ask the owner for material decisions

Ask the owner for material decisions and authority blockers. Prepare the evidence, the risk, a recommendation, and the real choices. Continue authorized reversible work in the meantime.

## 7. Workers match independent work

Worker count follows the amount of independent work. Each worker gets a bounded task, an input SHA, an evidence format, and a non-overlapping scope. Do not spawn workers recursively unless the system already authorizes that spawn.

## 8. Monitoring stays inside existing authority

Persistent monitoring runs only under existing CoS portfolio authority. Reuse monitors and ledgers that already exist, including an existing harvest lane. Do not add a duplicate heartbeat for the same wait.

## Protected snapshot

These stay in force until their own exact-SHA clearance. This skill cannot open them.

- Virtual-Assistant #108 tip `2acdccbe97b51a592174321f35807e2b4a558bef` on `cursor/missing-test-coverage-90ed` is an independent QA wait. Do not write, rebase, or push that branch.
- Virtual-Assistant #111 tip `23b983dc9d6f38cc5cb96fd6630c1937f58945c0` on `cursor/missing-test-coverage-8e40` may receive read-only conflict and readiness analysis. Do not rebase it onto #108. Do not undraft or merge either pull request until its own CLEAR.
- Media Lens #163 tip `789662fea5fd25eed1d9350c2823a168c3c2ba42` stays KEEP_DRAFT. The #118 flag stays off. Markout C2, C3, and C5 stay unmet.

Upstream pattern attribution for the skill sync and validate scripts is recorded in [THIRD_PARTY/NOTICE](../../../THIRD_PARTY/NOTICE).
