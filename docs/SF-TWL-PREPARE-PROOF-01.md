# SF-TWL-PREPARE-PROOF-01

Status: QA-only prepare-only proof

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

Default evidence target: public repo `Bthornton1994/three-white-lights` PR #35.

## How to run the one-shot proof

### 1. Local contract check (no QA credentials)

```bash
npx tsx scripts/twl-prepare-proof-oneshot.ts
```

This GETs the public PR, prints number / head / base / CI / HTML URL / payload hash, and runs the fail-closed Accept cases. It does not write Supabase, GitHub, or Production.

If `Bthornton1994/three-white-lights` #35 is not visible to unauthenticated GET (GitHub returns 404 for private or missing repos), the script uses public fallback `octocat/Hello-World` #1. The staff attach form still defaults to PR #35; an operator can point it at any public pull.

### 2. Durable QA run (env-gated)

Execution Lab refuses the demo store. You need the dedicated QA Supabase project (`qbvmtgaphvpwpwemplje`) and a staff session.

1. In the QA SQL editor, run `supabase/qa/sf_twl_prepare_proof_01.sql`.
   - Refuses to run unless organization slug `northline-consulting-test` and `ops.manager@delegation-test.cloud` exist.
   - Creates the workstream, active Delegation Spec, shadow executor profile, and one `planned` run if none is open.
2. Sign in as QA ops staff and open `/ops/execution`.
3. Open the planned run. Status is on that page and in the recent-runs list.
4. Start the run.
5. Assign the shadow worker or a human operator. Neither can Accept alone.
6. Attach public PR evidence. Defaults to `Bthornton1994/three-white-lights` #35. The server action GETs metadata only and hashes it into `evidence_artifacts`.
7. Freeze and submit for verification.
8. An operations manager issues the Outcome Receipt. Passing is blocked unless the hashed PR evidence and assignment are present. An agent report is not enough.

If the SQL seed is not applied, a manager can still create the spec by hand on `/ops/execution` using the frozen fields in `TWL_PREPARE_PROOF_SPEC`, including required input `twl-prepare-proof/v1`, then create a run.

### 3. Live staff walkthrough (Playwright)

`e2e/twl-prepare-proof-live.spec.ts` signs in as `ops.manager@delegation-test.cloud`, opens a planned TWL run, assigns the shadow worker, attaches public `octocat/Hello-World#1`, submits, and issues a passing receipt. It does not merge or deploy.

PR #67 CI job `pr67-live-qa` runs that spec after `verify`. It needs repository secret `E2E_PASSWORD` for the QA ops manager. If the secret is empty, the job skips with a notice and stays green. This agent cannot create GitHub secrets.

When `QA_TWL_RUN_ID` is unset or that run is no longer planned, the spec creates a fresh run from Execution Lab. Do not put the password in the repository.

Locally, with `.env.local` or an exported `E2E_PASSWORD`:

```bash
npx playwright test e2e/twl-prepare-proof-live.spec.ts --project=chromium
```

## Escalation

Coded in `evaluateTwlPrepareProofAccept` and shown on the run page. Escalate when:

- required evidence is missing or the payload hash no longer matches
- evidence claims `mutatesRepository=true` or `merge_performed=true`
- a write or merge GitHub path is requested
- an agent report is offered as the sole Accept basis
- the assigned worker tries to Accept

Do not auto-advance. Do not merge.

## Release routing

`routeTwlPrepareProofRelease` returns hold, ready-for-human-review, or escalate. `mergePerformed` and `deployAuthorized` stay false. A passing receipt still does not merge or deploy.

## Out of scope

Webhook auto-advance, Production migration, Grok/Cursor/GitHub-write connectors, branding, memory plane, Software Factory Run Manager overlay, model-economy docs.

## Model

- REQUESTED_MODEL: `grok-4.6`
- ACTUAL_MODEL: recorded on the implementing PR
