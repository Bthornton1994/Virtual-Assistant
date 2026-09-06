# SF-TWL-PREPARE-PROOF-01

Status: **QA proof complete**

`VISION.md` sections: **Authority is explicit and bounded**, **Quality assurance is part of delivery**, **Manual first, automation after proof**, **Capability sovereignty**.

Classification: **Aligns with constraints**. GitHub is a GET-only public-read adapter. It is not a source of authority, lifecycle state, or verification truth.

This is not a live always-on operator. It does not merge, deploy, store secrets, write GitHub, write issues, purchase, or send external messages.

## Frozen contract

Typed source: `src/lib/twl-prepare-proof.ts`

- `action_class = prepare_only`
- `merge_performed = false` always
- `mutatesRepository = false` on evidence
- Required evidence kinds: assignment `observation` and public PR `source`
- An agent report alone cannot Accept
- Assigned worker (human operator or shadow) cannot own Accept
- Only an operations manager or platform admin may issue an Outcome Receipt, and only after deterministic checks pass
- Release route is `hold`, `ready_for_human_review`, or `escalate` — never merge or deploy

## Public GitHub target decision

The originally named target, `Bthornton1994/three-white-lights#35`, is in a private repository and therefore cannot satisfy an anonymous public-GET evidence contract. This is expected fail-closed behavior, not a reader defect.

The completed proof deliberately used public `octocat/Hello-World#1`. The staff attach form remains parameterized so any genuinely public pull request can be supplied without changing the authority model.

## Completed live QA evidence

The browser walkthrough passed on PR #67 commit `8a716579dee395984bbdc0edf2b26c4c7178cd01` in GitHub Actions run `34046413737`.

- Standard `verify` job: passed `npm ci`, lint, typecheck, unit tests, and production build.
- `pr67-live-qa` job: passed the production build and Playwright staff-session walkthrough.
- Playwright started a durable run from `/ops/execution`, assigned the prepare-only shadow worker, attached public PR evidence, submitted for independent verification, and issued a passing Outcome Receipt.
- No merge or deployment was authorized or performed by the proof path.

Durable QA record:

- Verified run: `aea1a4aa-9f33-40bf-86df-ce8ad618d060`
- Final run status: `verified`
- Action class: `prepare_only`
- Required evidence count: `2`
- Outcome Receipt: `2c41f158-9626-4716-a22e-f4a8c33fe343`
- Receipt result: `passed`
- Definition of done: met
- QA score: `100`
- Exceptions: none
- Unresolved decisions: none

Assignment evidence:

- Kind: `observation`
- Schema: `twl-prepare-proof-assignment/v1`
- Worker: `sf-twl-prepare-proof-shadow-v1`
- `mayOwnAccept=false`
- Evidence content hash: `46c7507fb809e4423207f5e37721c9d8de11bc8bc8614defbc042171848b7f66`
- Sealed payload hash: `ca9ffffee9aec5c8fe38245a2e1e179a9dd4191e2df7d2536b5833b987b51c37`

Public PR source evidence:

- Kind: `source`
- Schema: `twl-prepare-proof-pr/v1`
- Target: `octocat/Hello-World#1`
- Request method: `GET`
- `mutatesRepository=false`
- `mergePerformed=false`
- Evidence content hash: `2f7c429d4683b8a6ba29a9aa5935625d1f8f951bce4cffe1984384c436866b96`
- Sealed payload hash: `d09d943c53b42c72482ef945cad726980bf6a29965c545667abba5c48bfcb853`

## Cleanup after proof

The live walkthrough used a temporary QA-only staff-provisioning harness solely to obtain an authenticated staff browser session. It was not part of the product authority model.

After the passing receipt was independently confirmed:

- both temporary QA provisioning/claim functions were dropped from the QA database;
- the disposable staff session was invalidated;
- the disposable operator was set inactive with zero capacity and its Auth identity was banned;
- the earlier incomplete QA run was marked `cancelled` rather than left `running`;
- the one-shot Playwright harness, QA provisioning SQL, and PR-specific CI job were removed from the final branch.

The verified run, its two evidence artifacts, their hashes, and the Outcome Receipt remain durable QA evidence.

## Reproduction without the retired harness

### Local contract check

```bash
npx tsx scripts/twl-prepare-proof-oneshot.ts
```

This performs GET-only public PR reading and the fail-closed Accept checks. It does not write Supabase, GitHub, or Production. If the private default target is not anonymously visible, it uses the public fallback.

### Durable QA run

1. Apply `supabase/qa/sf_twl_prepare_proof_01.sql` only to the dedicated QA workspace. The seed refuses to run without the known Northline QA fixture and QA ops-manager account.
2. Sign in with a normal authorized QA staff account and open `/ops/execution`.
3. Start the planned run.
4. Assign a human operator or the shadow worker. Neither can Accept alone.
5. Attach metadata from a genuinely public pull request.
6. Freeze and submit for verification.
7. Have an operations manager or platform admin issue the Outcome Receipt.

No disposable self-provisioning function is retained. Future live browser replays must use normal QA staff authentication or another explicitly reviewed, short-lived harness.

## Escalation

`evaluateTwlPrepareProofAccept` escalates when:

- required evidence is missing or the payload hash no longer matches;
- evidence claims `mutatesRepository=true` or `merge_performed=true`;
- a write or merge GitHub path is requested;
- an agent report is offered as the sole Accept basis;
- the assigned worker tries to Accept.

Do not auto-advance. Do not merge.

## Release routing

`routeTwlPrepareProofRelease` returns `hold`, `ready_for_human_review`, or `escalate`. `mergePerformed` and `deployAuthorized` remain false. A passing receipt still does not merge or deploy.

## Out of scope

Webhook auto-advance, Production migration, Grok/Cursor/GitHub-write connectors, branding, memory plane, Software Factory Run Manager overlay, model-economy docs.

## Model

- REQUESTED_MODEL: `grok-4.6`
- ACTUAL_MODEL: recorded on the implementing PR
