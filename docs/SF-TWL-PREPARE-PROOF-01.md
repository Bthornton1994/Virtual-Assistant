# SF-TWL-PREPARE-PROOF-01

Status: **QA proof complete, database hardening verified**

`VISION.md` sections: **Authority is explicit and bounded**, **Quality assurance is part of delivery**, **Manual first, automation after proof**, **Capability sovereignty**.

Classification: **Aligns with constraints**. GitHub is a GET-only public-read evidence source. It is not a source of authority, lifecycle state, or verification truth.

This proof does not merge, deploy, store GitHub secrets, write GitHub, write issues, purchase, or send external messages.

## Frozen contract

Typed source: `src/lib/twl-prepare-proof.ts`.

- `action_class = prepare_only`
- `merge_performed = false`
- `mutatesRepository = false`
- Required evidence: assignment `observation` plus public PR `source`
- An agent report alone cannot Accept
- The assigned worker cannot issue their own Outcome Receipt
- Only an operations manager or platform admin may issue a passing Outcome Receipt after deterministic checks
- Release routing is `hold`, `ready_for_human_review`, or `escalate`, never merge or deploy

## Public GitHub target decision

`Bthornton1994/three-white-lights#35` is private. It therefore cannot satisfy an anonymous public-GET evidence contract. This is expected fail-closed behavior, not a reader defect.

The successful public proof used `octocat/Hello-World#1`. The attach form remains parameterized for any genuinely public pull request. Authenticated read-only evidence for private repositories is a separate future capability.

## Original live QA proof

The staff browser walkthrough passed on PR #67 commit `8a716579dee395984bbdc0edf2b26c4c7178cd01` in GitHub Actions run `34046413737`.

It exercised `/ops/execution`, started a durable run, assigned the prepare-only shadow worker, attached public PR evidence, submitted the run for independent verification, and issued a passing Outcome Receipt. Merge and deploy remained unauthorized.

Durable QA evidence from that proof remains:

- Verified run: `aea1a4aa-9f33-40bf-86df-ce8ad618d060`
- Outcome Receipt: `2c41f158-9626-4716-a22e-f4a8c33fe343`
- Receipt: `passed`
- Definition of done: met
- QA score: `100`
- Exceptions: none
- Unresolved decisions: none

Assignment artifact:

- Schema: `twl-prepare-proof-assignment/v1`
- Worker: `sf-twl-prepare-proof-shadow-v1`
- `mayOwnAccept=false`
- Evidence content hash: `46c7507fb809e4423207f5e37721c9d8de11bc8bc8614defbc042171848b7f66`
- Payload hash: `ca9ffffee9aec5c8fe38245a2e1e179a9dd4191e2df7d2536b5833b987b51c37`

Public PR artifact:

- Schema: `twl-prepare-proof-pr/v1`
- Target: `octocat/Hello-World#1`
- Request method: `GET`
- `mutatesRepository=false`
- `mergePerformed=false`
- Evidence content hash: `2f7c429d4683b8a6ba29a9aa5935625d1f8f951bce4cffe1984384c436866b96`
- Payload hash: `d09d943c53b42c72482ef945cad726980bf6a29965c545667abba5c48bfcb853`

The temporary browser-provisioning harness used for that one proof was subsequently removed. Its disposable staff identity was disabled and its session invalidated; the earlier incomplete run was cancelled.

## Merge-gate adversarial review

A final re-review after the original proof identified three P1 control-plane bypasses:

1. `verifyWorkstreamRun()` enforced the TWL receipt gate in application code, but an operations manager could attempt a direct `outcome_receipts` insert through another Supabase client.
2. The generic evidence path could accept arbitrary JSON that declared a reserved TWL `schemaVersion`, allowing self-authored evidence to resemble an assignment or GitHub observation.
3. Verification checked the verifier's role but not whether the verifier was the same human operator frozen into the assignment.

These findings were valid. PR #67 was not merged. They are closed by `supabase/migrations/20260906191128_twl_prepare_proof_database_hardening.sql`.

## Database-boundary hardening

The hardening migration establishes the authoritative controls instead of relying on UI routing:

- enables the Supabase `http` extension for this bounded public-read capability;
- reserves `twl-prepare-proof-assignment/v1` and `twl-prepare-proof-pr/v1` as singleton artifacts per run;
- changes `evidence_artifacts` INSERT RLS so authenticated generic evidence writers cannot create either reserved schema;
- adds a database-owned assignment RPC that derives the human operator name and user ID from `operators` and freezes that identity into the hashed assignment;
- adds a database-owned public-PR RPC that constructs only `https://api.github.com/repos/{owner}/{repo}/pulls/{number}` and commit-status GETs, performs the anonymous HTTP request itself, validates the returned PR identity and SHAs, and then creates the hashed evidence;
- adds a `BEFORE INSERT` Outcome Receipt trigger for TWL passing receipts that independently rechecks the reserved artifacts, their payload hashes, their envelope hashes, prepare-only flags, actual authenticated verifier, and human-worker/verifier identity separation;
- keeps anonymous callers away from both reserved writer RPCs.

The application staff path now calls these reserved database writers instead of the generic evidence writer for the two authoritative artifacts.

## QA hardening verification

The migration was applied to QA project `qbvmtgaphvpwpwemplje` before merge review.

Canonical hashing was cross-checked independently. For nested JSON `{"b":2,"a":1,"c":[{"z":3,"y":2},true,null]}`, TypeScript and PostgreSQL both canonicalized to `{"a":1,"b":2,"c":[{"y":2,"z":3},true,null]}` and produced SHA-256:

`24fa330e77bb0bed931b36b6e03182a72727a9fcedf8d1fc8e96fdde2a58095d`

A transactionally rolled-back adversarial QA smoke test then proved all of the following in one database transaction:

- **PASS:** database-owned shadow assignment + database-owned public `octocat/Hello-World#1` GET + direct manager Outcome Receipt produced a verified run;
- **BLOCKED:** direct/generic insertion of a forged reserved assignment schema;
- **BLOCKED:** a direct passing Outcome Receipt without the reserved proof artifacts;
- **BLOCKED:** an `ops_manager` assigned as the human worker attempting to verify their own run, with the specific self-verification guard firing;
- **BLOCKED:** `Bthornton1994/three-white-lights#35`, because the anonymous database GitHub GET returned 404 for the private repository.

The smoke ended with deliberate marker `QA_TWL_HARDENING_SMOKE_ROLLBACK_OK`, rolling back every temporary run, artifact, and receipt. Follow-up queries confirmed zero smoke artifacts and zero smoke receipts remained.

QA inspection also confirmed:

- `http` extension version `1.6` installed;
- `trg_twl_prepare_proof_receipt_gate` present;
- `trg_twl_prepare_proof_artifact_writer` present;
- reserved-artifact singleton index present;
- `evidence_artifacts_insert` RLS explicitly excludes both reserved TWL schemas.

QA recorded this control set through the connected migration API as version `20260906191128` (`twl_prepare_proof_database_hardening`). The repository file uses that same version and name, so ordinary `supabase db push` treats it as already applied on QA and does not re-run it. Both TWL triggers are still created after `DROP TRIGGER IF EXISTS`, so the SQL itself remains idempotent if it is re-executed.

## Reproduction

### Local contract check

```bash
npx tsx scripts/twl-prepare-proof-oneshot.ts
```

This performs GET-only public PR reading plus pure fail-closed contract checks. It does not write Supabase or GitHub.

### Durable QA run

1. Apply `supabase/qa/sf_twl_prepare_proof_01.sql` only to the dedicated QA workspace.
2. Ensure the database hardening migration is applied.
3. Sign in as authorized QA operations staff and open `/ops/execution`.
4. Start the planned run.
5. Assign a human operator or the shadow worker. The reserved assignment writer freezes the authoritative assignment identity.
6. Attach a genuinely public pull request. The reserved database writer performs the anonymous GitHub GET and freezes the resulting metadata.
7. Freeze and submit for verification.
8. An operations manager or platform admin who is not the assigned human worker may issue the Outcome Receipt. The database independently enforces the final gate.

## Escalation and release routing

Escalate when required evidence is missing, hashes do not match, a repository write/merge is claimed, an agent report is offered as the sole Accept basis, the assigned worker attempts to Accept, or the public GitHub read fails.

`routeTwlPrepareProofRelease` returns `hold`, `ready_for_human_review`, or `escalate`. `mergePerformed` and `deployAuthorized` remain false. A passing proof receipt does not authorize downstream merge or deploy.

## Scope boundary

PR #67 now includes the database hardening migration required to make this evidence path authoritative. Applying that schema migration is distinct from deploying or enabling a write-capable GitHub connector. Webhook auto-advance, private-repository authenticated reads, Grok/Cursor/GitHub-write connectors, branding, memory-plane changes, and broader Software Factory automation remain outside this proof.

## Model

- REQUESTED_MODEL: `grok-4.6`
- ACTUAL_MODEL: recorded on the implementing PR
