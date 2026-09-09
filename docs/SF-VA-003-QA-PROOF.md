# SF-VA-003 QA proof

QA project: `qbvmtgaphvpwpwemplje`. No Production schema or data write.

Disposable overlay: `SF-VA-003-QA-PROOF-01` (`1ae0d056-1f32-4b3d-b7d4-dea8141a846a`), workstream `24425c91-7113-4945-afa8-eb8c02c1637d`. This run was rejected after the proofs. It was not Accepted.

Untouched:

- `SF-VA-UI-PROOF-01` remains `awaiting_owner` / `awaiting_verification`
- `SF-LOAD-001` remains `accepted` / `verified`

## Applied QA migration names

Already present from earlier helper applies, plus this follow-up:

| Version | Name |
| --- | --- |
| `20260907035818` | `software_factory_database_boundary_hardening` (QA-only empty placeholder; not in repo) |
| `20260907040014` | `software_factory_database_boundary_helpers` |
| `20260907040103` | `software_factory_database_boundary_freeze` |
| `20260907040126` | `software_factory_database_boundary_owner_forbidden` |
| `20260907040147` | `software_factory_database_boundary_sync` |
| `20260909161641` | `software_factory_database_boundary_workstream_invariants` |
| `20260909161710` | `software_factory_database_boundary_receipt_gate` |
| `20260909162106` | `software_factory_database_boundary_forbidden_event_id` |
| `20260909162158` | `software_factory_database_boundary_helper_search_path` |

Canonical repo file: `supabase/migrations/20260907040000_software_factory_database_boundary_hardening.sql` (replay-safe; not applied as that exact version on QA).

## Transactional proofs

| Finding | Result |
| --- | --- |
| Secret value / key detection | `software_factory_json_has_secrets` true for `ghp_…` and `api_key`; false for a clean packet |
| Freeze RPC secrets | `P0001` Packet looks like a credential |
| Versioned re-freeze | hash `c3956fba…` then `a1353e38…`; `packet_freeze_version=2`; 2 packet artifacts |
| Latest owner decision | approve then reject → latest status `rejected` |
| Partial criteria | `software_factory_acceptance_criteria_covered` false on the disposable run |
| Forbidden-action audit | RPC returned `{ok:false, blocked:true, mergePerformed:false, eventId:41}`; one `forbidden_action_blocked` event; overlay `merge_performed` stayed false |
| Unauthenticated forbidden RPC | `P0001` Forbidden-action checks require an authenticated actor |
| Harbor owner on Northline | `P0001` Cross-tenant access denied |
| Terminal projection | overlay `rejected` → workstream `failed` without an Outcome Receipt |
| Existing fixtures | UI proof and Loadout proof unchanged |

## Advisors

Security: `function_search_path_mutable` on the three new helpers was cleared by pinning `search_path`. `enforce_software_factory_receipt` execute was revoked from `anon`/`authenticated`. Remaining advisor hits are pre-existing platform/TWL/auth functions, plus authenticated execute on the reserved Software Factory writers (intentional for signed-in staff/owners).

Performance: no new findings naming the SF-VA-003 helpers or version indexes.
