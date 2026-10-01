# Software Factory Run Manager v1

Status: **implemented as a prepare-only control-plane vertical slice. No merge, deploy, secret change, or live GitHub mutation is authorized.**

Vision alignment: **Aligns with constraints.** Relevant `VISION.md` sections: *Capability sovereignty*, *Authority is explicit and bounded*, *Quality assurance is part of delivery*, and *Manual first, automation after proof*.

## Purpose

Software Factory Run Manager is a Delegation Cloud-owned capability for coordinating Bryant Thornton’s Grok Bot Software Factory team. It accepts a software work request, creates a Delegation Spec and Workstream Run, freezes a structured task packet, records human-mediated worker handoffs, collects hashed evidence, pauses at consequential gates, and issues an Outcome Receipt.

It is not a freeform coding bot, agent marketplace, or unrestricted autonomous worker.

Proof-carrying work-cell binding is a design boundary on the existing Native Skill and Software Factory packet/hash contracts. It is not a second lifecycle or evidence system. See [Proof-Carrying Work-Cell Binding](NATIVE-SKILL-REGISTRY-V1.md#proof-carrying-work-cell-binding).

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

The in-memory store in `src/lib/software-factory-store.ts` remains the unit-test vertical slice. Persistent QA/staff operation uses reserved SECURITY DEFINER writers in `supabase/migrations/20260906210000_software_factory_control_plane_hardening.sql` and the staff surface on `/ops/execution`. Staff overlay controls stay available while the workstream is `running` or `awaiting_verification`, so verification can still move the factory run to `awaiting_owner` for the owner queue on `/app/approvals`. The demo store does not simulate factory overlay rows: `/ops/execution` stays on the persistent-workspace notice, and `/app/approvals` returns an empty factory owner queue rather than opening Supabase.

Typed authoritative artifacts:

- packet freeze (`software-factory-packet/v1`) is written only by `software_factory_freeze_packet`
- owner acceptance is written only by `software_factory_record_owner_decision` and must come from an organization owner or member
- Accepted is written only when a passing Outcome Receipt survives `enforce_software_factory_receipt`

Authenticated clients cannot insert or update `software_factory_runs` or `software_factory_approvals` directly. They also cannot execute the internal helpers `software_factory_write_evidence`, `software_factory_append_event`, or `software_factory_sync_workstream`. Generic evidence insert cannot impersonate the reserved packet or owner-decision schemas. The TWL reserved schemas stay reserved. The receipt trigger treats a non-staff `is_ops_manager()` result as closed, including SQL `NULL`.

The SQL migrations are not applied to Production by this change. The QA fixture `supabase/qa/software_factory_loadout_sf_load_001.sql` creates a demonstration Delegation Spec marked `software-factory-run/v1`, a planned Workstream Run, and a Software Factory overlay at `intake`. It does not Accept the run and does not mutate Loadout.

## Packet hash and freeze-time STATUS

Packet `STATUS` is a freeze-time snapshot of the overlay lifecycle at freeze. Later transitions do not rewrite the packet. `evaluateAcceptance` binds to `packetHash` of the frozen payload; it does not require `packet.STATUS` to equal the current lifecycle. Re-freeze only when payload fields change. A re-freeze must set `STATUS` to the current lifecycle. A mutated payload that keeps the old hash fails closed.

Application `hashSoftwareFactoryPacket` canonicalizes object keys with case-insensitive `en` order so it matches Postgres `software_factory_sha256` (`twl_prepare_proof_canonical_json`, `ORDER BY key`). Catalog-evidence `sha256Hex` keeps UTF-16 ordinal key order and must not be used for factory packets. Do not change `twl_prepare_proof_sha256`; existing TWL and factory hashes stay valid.

## Stale acceptance

Problem class `stale` (default 72 hours since last evidence on a non-terminal run) is an unresolved acceptance failure. `evaluateAcceptance` and both Outcome Receipt issuers fail closed. The SQL `enforce_software_factory_receipt` trigger does not encode that clock; freshness is an application gate in this slice. No Production schema write.

## Next work item: SF-VA-002 worker leases and heartbeats

Not implemented in this slice. Execution-runtime leases on `execution_runtime_v1` / `execution_plan_steps` are a different plane; this overlay does not drive them.

A separately scoped Software Factory change should specify:

- allocation owner
- executor identity
- lease start and expiry
- heartbeat / update timestamp
- takeover rules
- stale detection
- owner-visible current-work state
- concurrency and duplicate-worker tests

SF-VA-002 must remain `prepare_only`, must not add automatic executor routing, and must not grant merge, deploy, or Production migration authority.

## Loadout proof

Task `SF-LOAD-001` demonstrates the governed path against historical Loadout PR https://github.com/Bthornton1994/Loadout/pull/26. The PR is attached as evidence. This capability does not merge, reopen, or modify that PR.

## What this does not do

- It does not create Linear, Notion, GitHub Projects, PATs, or new external accounts.
- It does not add routines or always-on schedules.
- It does not qualify Grok or Cursor as executors.
- It does not apply the migration to Production or write production secrets.
