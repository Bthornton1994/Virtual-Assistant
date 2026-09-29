# CoS portfolio control plane

Chief of Staff coordination for Delegation Cloud. This document is the operator entry point. The skill [cos-portfolio-control](../../.agents/skills/cos-portfolio-control/SKILL.md) is the procedure. [`src/lib/cos-control-plane.ts`](../../src/lib/cos-control-plane.ts) is the deterministic check. The portfolio playbook remains the operating sequence: [AUTONOMOUS-PORTFOLIO-EXECUTION-PLAYBOOK.md](../AUTONOMOUS-PORTFOLIO-EXECUTION-PLAYBOOK.md).

Vision fit: **Aligns with constraints**. Relevant sections: `VISION.md` Decision tests (authority and current status stay visible) and Scope and non-goals (no unlimited authority). This plane does not merge, deploy, spend, change model routing, or clear a gate.

## Classify first

| Scope | When | What starts |
| --- | --- | --- |
| Single | One issue or pull request | That item only. No portfolio sweep. |
| Batch | A finite queue, including several repositories | One owner, status, and next action per item. No standing monitor. |
| Portfolio | Ongoing coordination of more than one item | A portfolio sweep only by reusing monitors already authorized for the CoS. |

## Item record

`validateItemRecord` requires repo, issue or PR, owner, branch, worktree (or null), full 40-character SHA, phase, one external wait (exact run or SHA, or none), gate or blocker (or null), last evidence, and next action. A QA wait must name that item's full SHA. `assertSingleWaitOwner` rejects a second watcher for the same wait.

## Dispatch and serialization

`canDispatchIndependentWork` allows independent work, and read-only analysis, on other branches while an item waits on exact-SHA QA. It refuses writes, rebases, pull request mutations, and merges on the waiting branch, and it refuses a second writer on an occupied branch.

`serializeConflict` admits one public action per lane. Same-branch writes, pull request mutations, and merges share a lane. Releases, deploys, and shared environments share one lane per repository. Reads do not take a lane. An item in `qa_wait` or `owner_gate` blocks public mutations of that item.

`assertGatesClosed` keeps these closed unless a future owner decision changes this module: Media Lens #118, Markout C2, Markout C3, Markout C5. Silence does not open them. An observation that marks one open is a violation.

The t1708u read-only snapshot for Virtual-Assistant #108 and #111 is [VA-111-RO-READINESS.md](./VA-111-RO-READINESS.md).

## Skill roots

Canonical skills for this plane live in `.agents/skills/<name>/`. `.claude/skills/<name>/` is an identical mirror. Managed names are `cos-*` and, when present, `test-audit`. Other skills, including the existing UI skills, are outside this sync.

```bash
npm run cos:validate-skills
node scripts/cos-sync-skills.mjs --dry-run
```

`cos-sync-skills` is idempotent. `--dry-run` writes nothing. A second dry-run against an already matching tree reports `changes=0`. Real files are preserved. A skill name that escapes its root is refused before any write. Stale symlinks that point into the canonical root are pruned. The pattern is adapted from steipete/agent-scripts at `3f8c6a33f911818b72936248384e7a71b4f1d971` (MIT). See [THIRD_PARTY/NOTICE](../../THIRD_PARTY/NOTICE).

## Migration

No data migration. No new credential, host, or model pin. Existing skills are not rewritten. Closed gates stay closed.
