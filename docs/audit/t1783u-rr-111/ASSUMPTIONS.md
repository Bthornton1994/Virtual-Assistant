# t1783u assumptions: port of VA #111 MemoryStore cross-tenant guards

Written before any code change on `cos/t1783u-rr-111`, based on `780ea553a16444b9c8ff9573cfc9924709f86974`. Each item is marked verified, inferred, or unknown. "Local check" is what this worktree re-ran on 2026-10-02. Line numbers are at `780ea55`, before the cherry-pick. This file opens no gate and closes none.

1. **Verified.** Live main is `780ea553a16444b9c8ff9573cfc9924709f86974`. The `gh` compare of that SHA to `23b983dc9d6f38cc5cb96fd6630c1937f58945c0` is diverged, ahead 1, behind 8, and touches only `src/lib/store.ts` and `src/lib/__tests__/store-workstream-binding-gates.test.ts`.
   Local check: `git ls-remote origin refs/heads/main` returned `780ea55`. `gh api repos/Bthornton1994/Virtual-Assistant/compare/780ea55...23b983dc` returned `status: diverged`, `ahead_by: 1`, `behind_by: 8`, and those two files. `git rev-list --left-right --count 780ea55...23b983dc` returned `8 1`.

2. **Verified.** Commits from `fa0d9e8e35e9704bbe61dbcf5bb333f37d9b6412` (parent of `23b983dc`) to `780ea55` do not touch `src/lib/store.ts`, so the cherry-pick of `23b983dc` onto this HEAD should be clean. Rebasing or force-pushing `cursor/missing-test-coverage-8e40` is unsafe: it is the open draft #111 branch, and `maintainer_can_modify` is false. #111 stays open. This branch is the replacement.
   Local check: `git log fa0d9e8..780ea55 -- src/lib/store.ts src/lib/__tests__/store-workstream-binding-gates.test.ts` is empty. The merge base of the two tips is `fa0d9e8`. `gh pr view 111` returned OPEN, draft, head `cursor/missing-test-coverage-8e40` at `23b983dc`, `maintainerCanModify: false`.

3. **Verified.** In `MemoryStore`, `createRequest` binds `input.workstreamId` with no org check. `updateRequestScope` applies `workstreamId` and `playbookId` with `Object.assign` and checks neither existence nor org. `createPlaybook` stores `input.workstreamId` while `organizationId` stays the actor's org. Intake playbooks already call `assertOrgAccess`.
   Local check: `src/lib/store.ts:1159-1160` looks the workstream up by id only. `:1367` is `Object.assign(req, patch, { updatedAt: nowIso() })` with no check before it. `:2010` is `const orgId = actor.organizationId || fromWorkstream || this.visibleOrgIds(actor)[0]` and `:2017` stores `workstreamId: input.workstreamId`. `:1179-1180` is `if (playbook) assertOrgAccess(actor, playbook.organizationId)`.

4. **Verified.** `SupabaseWorkspace.updateRequestScope` does not write `workstream_id` or `playbook_id`. This port does not edit `src/lib/data/supabase-workspace.ts`. Supabase `createPlaybook` still stores a raw workstream id; that is out of scope for this port.
   Local check: `src/lib/data/supabase-workspace.ts:737` writes `title`, `objective`, `description`, `deliverable`, `due_at`, and the authority-raise fields only. `createPlaybook` at `:1474` inserts `workstream_id: input.workstreamId`.

5. **Verified.** `docs/RELEASE-RESCUE-DEPLOY-TARGET-DECISION.md` at this SHA is Option A, operator-only. G-08 gzip residuals stay Open and owner-only. G-03: no host is enabled. This port does not close any production gate.
   Local check: the decision doc's status row is "Decided: Option A" and operator-only. The G-03 row says no host is enabled. The G-08 row says Open.

6. **Verified.** `docs/cos/VA-111-RO-READINESS.md` is a 2026-09-29 snapshot that forbade a #111 writer while #108 QA ran. #108 has since merged. Bryant's t1783u assignment authorizes this isolated port only. That snapshot does not authorize a public host.
   Local check: the snapshot says "As of 2026-09-29" and "Do not seat a #111 writer while #108 QA is running." Main contains `c00b277` (#108). The snapshot's precondition, a fresh `store.ts` check against post-#108 main, is item 2.

7. **Inferred.** Same-org rebind of `req_inbox` to `ws_sales` and `pb_proposal` must keep working. The cherry-picked tests already cover it.
   Evidence: the `23b983dc` test "lets a client rebind a request to another workstream in the same organization".

8. **Unknown, resolved.** `store.ts` has no second store class. Only `MemoryStore` gets the guards.
   Local check: the only class declaration in `src/lib/store.ts` is `export class MemoryStore` at line 761.
