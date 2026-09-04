# Software Factory Run Manager v1

Status: **implemented as a prepare-only control-plane vertical slice. No merge, deploy, secret change, or live GitHub mutation is authorized.**

Vision alignment: **Aligns with constraints.** Relevant `VISION.md` sections: *Capability sovereignty*, *Authority is explicit and bounded*, *Quality assurance is part of delivery*, and *Manual first, automation after proof*.

## Purpose

Software Factory Run Manager is a Delegation Cloud-owned capability for coordinating Bryant Thornton’s Grok Bot Software Factory team. It accepts a software work request, creates a Delegation Spec and Workstream Run, freezes a structured task packet, records human-mediated worker handoffs, collects hashed evidence, pauses at consequential gates, and issues an Outcome Receipt.

It is not a freeform coding bot, agent marketplace, or unrestricted autonomous worker.

## Operating model

| Role | Authority in this slice |
| --- | --- |
| Delegation Cloud | Durable control plane, lifecycle, evidence, approvals, Outcome Receipts |
| Chief of Staff | External coordinator; not product authority |
| Software Factory PM | Planning and status through a structured handoff |
| Software Factory Developer | Cursor Cloud Agent coordinator through a structured handoff |
| Cursor Cloud Agent | Replaceable coding executor, tracked only when an approved connector exists |
| GitHub | Repo/PR/CI evidence provider only |

No agent, model, tool, CLI, MCP, Grok Bot, or Cursor runtime is product authority.

## Contracts

- Intake: `software-factory-intake/v1`
- Packet: `software-factory-packet/v1`
- Inspection: `software-factory-inspection/v1`
- Handoff: `software-factory-handoff/v1`
- Cursor execution: `software-factory-cursor-execution/v1` (evidence only; never authoritative)
- Evidence: `software-factory-evidence/v1`
- Owner decision: `software-factory-owner-decision/v1`
- Receipt: `software-factory-receipt/v1`

Factory evidence and receipts project onto the existing `evidence_artifacts` and `outcome_receipts` shapes in `src/lib/software-factory-projection.ts`. GitHub, Grok, and Cursor never become a parallel source of truth.

Every packet carries `STATUS`, `TASK_ID`, `REPOSITORY`, `BASE_BRANCH`, `OBJECTIVE`, `BACKGROUND`, `IN_SCOPE`, `OUT_OF_SCOPE`, `ACCEPTANCE_CRITERIA`, `VERIFICATION`, `DEPENDENCIES`, `RISK`, `APPROVAL_REQUIRED`, and `HANDOFF_NOTES`.

A packet cannot authorize itself. Claims of approval must cite owner or governance evidence recorded outside the packet.

## Lifecycle

`Intake → Discovery → Planned → Ready → In Progress → Blocked → PR Open → Verification → Awaiting Owner → Accepted`

Also: `Rejected`, `Deferred`, `Cancelled`.

The Software Factory lifecycle is an overlay on `workstream_runs`. Delegation Cloud DB remains canonical SoT. GitHub Issues/labels/PRs/CI are projections or evidence only.

Acceptance requires all of:

- every frozen acceptance criterion evidenced
- required evidence attached and hashed
- no unresolved operational blockers
- authority checks passed (`prepare_only`, merge not performed)
- explicit owner acceptance recorded outside the task packet

Never Accepted merely because an agent claims success.

## Authority

Default action class: `prepare_only`.

This slice must not autonomously merge PRs, deploy production, modify production env vars, change permissions, create or rotate secrets, purchase, send external messages, create commercial relationships, delete data or infrastructure, change repository vision, promote demo data, or expand scope without owner approval.

If authority is missing, the run creates an approval request and pauses. Even an approved merge decision only authorizes a human outside Delegation Cloud. The capability never performs the merge.

## Connector limitations

- **Grok Bot:** no approved connector. PM work uses a human-mediated handoff.
- **Cursor Cloud Agent:** no approved connector by default. Developer coordination uses a human-mediated handoff. When an approved connector exists, `trackCursorCloudAgentExecution` records hashed `cursor_execution` evidence. A Cursor success claim never Accepts the run.
- **GitHub Issues write:** unavailable. Do not work around with a PAT or unapproved secret. The Workstream Run is the canonical board.
- **GitHub evidence:** available as a provider only. Historical PR/CI observations may be attached. Live repository mutation is not authorized.

## Persistence

Additive tables `software_factory_runs`, `software_factory_events`, and `software_factory_approvals` bind to existing `delegation_specs` and `workstream_runs`. Evidence remains in `evidence_artifacts`. Receipts remain in `outcome_receipts` when a persistent workspace applies the overlay.

The in-memory store in `src/lib/software-factory-store.ts` is the executable vertical slice used by tests. It writes factory evidence and receipts and also projects them onto `EvidenceArtifact` / `OutcomeReceipt`. The SQL migration is not applied to Production by this change. The QA fixture `supabase/qa/software_factory_loadout_sf_load_001.sql` creates a demonstration Workstream Run and Software Factory overlay for SF-LOAD-001, attaches historical Loadout PR #26 as evidence, and leaves the run at `awaiting_owner`.

## Loadout proof

Task `SF-LOAD-001` demonstrates the governed path against historical Loadout PR https://github.com/Bthornton1994/Loadout/pull/26. The PR is attached as evidence. This capability does not merge, reopen, or modify that PR.

## What this does not do

- It does not create Linear, Notion, GitHub Projects, PATs, or new external accounts.
- It does not add routines or always-on schedules.
- It does not qualify Grok or Cursor as executors.
- It does not apply the migration to Production or write production secrets.
