# SF-VA-001 QA proof

Status: live persisted staff-identity walk completed on Delegation Cloud QA (`qbvmtgaphvpwpwemplje`). Production was not written.

Vision: **Aligns with constraints.** Relevant `VISION.md` sections: *Capability sovereignty*, *Authority is explicit and bounded*, *Quality assurance is part of delivery*, and *Manual first, automation after proof*.

This proof does not merge PR #65, deploy Production, write Production data, create secrets, or mutate Loadout.

## What is proven

- Software Factory overlays `workstream_runs` under `software-factory-run/v1` and `prepare_only`.
- Packet freeze (`software-factory-packet/v1`) and owner acceptance have reserved writers. Generic evidence insert cannot impersonate those schemas.
- Staff cannot record owner acceptance. The owner/member decision binds to the frozen packet hash and cannot cite the packet as authorization.
- A passing Outcome Receipt is the only path to `accepted`. Cursor/Grok claims and agent reports cannot Accept.
- `is_ops_manager()` returning SQL `NULL` for a non-staff actor no longer skips the receipt manager check.
- Internal helpers `software_factory_write_evidence`, `software_factory_append_event`, and `software_factory_sync_workstream` are not executable by `authenticated`.
- Merge, deploy, secrets, and GitHub mutation stay closed. `merge_performed` remained false.
- Harbor cannot read Northline factory rows.

The walk used the same reserved RPCs the staff UI on `/ops/execution` and the owner form on `/app/approvals` call. It authenticated as the existing QA ops manager and Northline `client_admin` via JWT claims. It was not a browser click-through; this environment does not hold QA passwords, and none were created.

## QA identities used

| Role | Email | User id |
| --- | --- | --- |
| Ops manager | `ops.manager@delegation-test.cloud` | `c0b2ab6c-c56d-4435-89fd-f972ce552609` |
| Northline owner | `client.admin@northline-test.delegation.cloud` | `c6af719b-1d9b-4824-bca1-667203676f99` |
| Harbor isolation | `client.admin@harbor-test.delegation.cloud` | `84ea87e6-9378-4e10-a1be-2af1d79c01a9` |

No disposable staff identity was provisioned for this walk. The leftover PR67 disposable operator `PR67 disposable QA manager` (`1eec4df5-2736-4bd8-b0df-0279837b440e`) was set `inactive` after the proof.

## Live QA record

Northline org: `230533c4-a1cf-4f4e-a825-d7cf93134a30`

| Object | Id |
| --- | --- |
| Delegation Spec | `3cc77f3d-5723-451c-983a-c5f7c3756eff` |
| Workstream run | `e3bee1ff-61b8-437c-a876-6c8c4910141b` |
| Software Factory run | `48f48a71-b23a-44c1-8485-3722773bf81b` |
| Frozen packet hash | `652d356fdacb97f6e31020827bef8580e7ba080004fcee8d16ecb88a94eb0326` |
| Owner acceptance | `2f5cd167-3991-4601-ac7b-7d4b161fd5a1` |
| Outcome Receipt | `abed4d55-b49f-434d-ba3c-20829db00b3e` |

Final factory state: `accepted`, version `11`, `action_class = prepare_only`, `merge_performed = false`.
Final workstream state: `verified`.

Historical GitHub observation: [Loadout PR #26](https://github.com/Bthornton1994/Loadout/pull/26). Attached as recorded evidence only. Not merged, reopened, or modified.

### Evidence artifacts

| Kind | Artifact id | Content hash |
| --- | --- | --- |
| `repository_inspection` | `431a4296-b303-42c7-8e82-6318e9d5085c` | `2ca0586d4087f2f7b666ba38a3c8429234abb02b67950825fb85f00e81a587d9` |
| `task_packet` | `00e17c43-9424-4643-a279-2759852405e7` | `202bd9b806b5fa3d66e6d80aba70775cc49557ac809ecd8eb6e2666cba6374bf` |
| PM handoff | `55708a79-3106-42c8-870c-7127c23d578e` | `3e811b2f1271a5d6b7abcbc8c0addb88d9de10869c031171bf75e298d8a21163` |
| Developer handoff | `dd03e8ed-0a6e-4ee3-82f9-053cecff28d5` | `32be87ecdb2ec515d8d15be06cd344b368c92a1236d5a1534e8046bde24d25fa` |
| `pull_request` | `89746b24-5e6b-4a17-9654-66a900f5bfaf` | `69f1be0cf88d829d6304e7688a7152c8afc9d16cb3b65c174e0098140c671f5b` |
| `ci` | `5ebc1327-2318-453c-b16b-7e69ab7095d7` | `c84b02e8ed8234cf7787afe6f308cdac4ff131129bbf1ae88c7c7a9b8fab3930` |
| `test` | `22d14539-603d-4fd0-8b01-a202ecffae49` | `29a9f714cfd8ec5b38178e9905fd2f461239aafd2f7675e8cee2d8e6658420e1` |
| `cursor_execution` (evidence only) | `e4c20425-ec50-40bd-857b-e84899e3c0fe` | `aef7827d8685f29ea0b01eb6bdddb8ea90926e0dcb6dd71b68b1020d6b90adbf` |

## Negative controls (all fail-closed)

| Control | Result |
| --- | --- |
| Attach reserved `task_packet` through the generic evidence RPC | Reserved writer rejection |
| Authenticated insert of `software-factory-packet/v1` | Database-owned writer rejection |
| RPC transition to `accepted` | Receipt-only rejection |
| Direct `UPDATE` of lifecycle to `accepted` without owner acceptance | Owner-acceptance rejection |
| Staff `software_factory_record_owner_decision` | Owner-required rejection |
| Passing receipt before owner acceptance | Owner-acceptance rejection |
| Harbor owner decision on the Northline run | Cross-tenant denial |
| Owner cites `packet` as a source ref | Packet-cannot-authorize rejection |
| Contradictory/stale `packet_hash` write | Packet hash mismatch |
| Owner issues the Outcome Receipt | Manager-required rejection |
| Manager session with owner `verified_by` | Verifier mismatch |
| `merge_pr` forbidden action | Merge remains blocked |
| Harbor `SELECT` of the Northline factory row | 0 rows |
| Transition `accepted → in_progress` | Invalid transition |

A Cursor success claim was attached on the accepted run and did not substitute for required inspection, packet, PR, CI, or test evidence. The receipt trigger also rejects a provider-only kind set (`agent_report` / `cursor_execution`).

## QA migrations applied

Repo versions recorded in `supabase_migrations.schema_migrations` so a later `supabase db push` does not re-run them:

- `20260904210000` `software_factory_run_manager_v1` (MCP apply `20260906210518`)
- `20260906210000` `software_factory_control_plane_hardening` (MCP apply `20260906210923` plus follow-on writer/receipt chunks)

Structural checks after apply:

- Overlay tables grant `authenticated` `SELECT` only
- `trg_software_factory_artifact_writer` and `trg_software_factory_receipt_gate` exist
- `evidence_artifacts_insert` still blocks TWL reserved schemas and the Software Factory reserved schemas
- Internal writer execute privileges revoked from `authenticated`

## Limitations

- Grok Bot and Cursor Cloud Agent remain unconnected. No approved runtime connector is claimed.
- GitHub Issues write remains unavailable.
- Browser login against the preview was not exercised in this environment.
- This proof does not authorize merge of PR #65 or any Production apply.

## Out of scope (honored)

- No merge of PR #65 by the agent
- No production deploy
- No production secret changes
- No Loadout mutation
- No routines or always-on schedules
