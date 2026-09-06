# SF-VA-001 QA proof

Status: implementation complete; live QA IDs are recorded after the persisted staff-session walk.

Vision: **Aligns with constraints.** Relevant `VISION.md` sections: *Capability sovereignty*, *Authority is explicit and bounded*, *Quality assurance is part of delivery*, and *Manual first, automation after proof*.

This proof does not merge PR #65, deploy Production, write Production data, create secrets, or mutate Loadout.

## What is proven in code

- Software Factory overlays `workstream_runs` under `software-factory-run/v1` and `prepare_only`.
- Packet freeze and owner acceptance have reserved writers. Generic evidence insert cannot impersonate those schemas.
- Staff cannot record owner acceptance. The owner/member decision binds to the frozen packet hash.
- A passing Outcome Receipt is the only path to `accepted`. Cursor/Grok claims and agent reports cannot Accept.
- Merge, deploy, secrets, and GitHub mutation stay closed.

## Live QA record

Filled after the persisted walk against `qbvmtgaphvpwpwemplje`.
