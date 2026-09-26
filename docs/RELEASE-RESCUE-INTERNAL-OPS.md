# Release Rescue internal operations

This is the operator procedure for the local internal workflow described in `docs/RELEASE-RESCUE-INTERNAL.md`. It runs on one machine, bound to `127.0.0.1:3020`. It is not a production deploy, not a customer runbook, and not a paid engagement. A green `verify` check, including `proof:rr-internal` and `test:e2e:internal`, does not make it one.

No host is selected. `docs/RELEASE-RESCUE-DEPLOY-TARGET-DECISION.md` leaves that choice blank. Do not start this mode on Vercel, and do not remove the refusal of `VERCEL`, `VERCEL_ENV`, or `VERCEL_URL` in order to "deploy" it.

## Run

Prepare once, then start:

```bash
npm ci
npm run rr:local -- operator:add --name "Your Name"
npm run rr:local -- checkout:set Bthornton1994/StageForge /absolute/path/to/StageForge
npm run rr:local:app
```

`rr:local:app` builds and starts `next start` with `RELEASE_RESCUE_INTERNAL=local`, `--hostname 127.0.0.1`, and `--port 3020`. Open <http://127.0.0.1:3020/internal/release-rescue> and sign in with the name and passphrase you created.

Stop the process with Ctrl-C in that terminal. There is no remote service to stop, and no second copy should be listening. Before you use the page, confirm the listen address is `127.0.0.1:3020` and not `0.0.0.0` or another interface. If it is anything else, stop the process. The bind is the control that keeps the server off the network. The request guard is defence in depth: a request that is not addressed to loopback, or that carries `Forwarded`, `X-Real-IP`, or a non-loopback `X-Forwarded-*` value, is a 404.

The terminal path (`npm run rr:local -- run ...`) writes an unsigned draft. Signing is only in the browser, as a signed-in operator.

## What you should see

On a healthy machine:

- One process listening on `127.0.0.1:3020`.
- The internal home page asks for the display name and passphrase. There is no default account and no sign-up.
- `.release-rescue-local/` (or `RELEASE_RESCUE_LOCAL_DIR`) is mode `0700`, and the files in it are mode `0600`.
- A run page names the acquisition status, the shared limits version `release-rescue-snapshot-limits/v1`, and the expansion ratio rule `whole-archive/compressed-data/16MiB-floor`. A git checkout or a plain `.tar` says the ratio rule was not applied. A `.tar.gz` says it was. A record written before those fields existed says they are absent. The page does not fill them in.
- The ledger still shows two implemented checks and thirty `NOT RUN`. The verdict stays `conditional_release`. Model-assisted analysis stays `NOT RUN`.

There is no off-machine monitor, log drain, or status page, and this procedure does not add one. The tool does not log error text. What you can inspect on the machine:

- The listen address, as above.
- Disk use of the local store: `du -sh .release-rescue-local`. Source bytes are not in it. Run records, scrypt hashes, checkout paths, and `secret.key` are.
- Runs whose status is `blocked`, from the dashboard or from `runs/*.json`. A blocked run is a refused source or a failed stage. The record names the stage in a fixed sentence. It does not contain the error text or the source.
- Five failed sign-ins lock that display name for one minute. The sign-in page says the name and passphrase do not match, including while the name is locked.

An uncommitted edit of `config/release-rescue-internal.allowlist.json` takes effect, because the tool reads the working tree and does not check that the file is the committed one. For this single-operator local workflow that is the current rule. It is not a production allowlist control. Do not widen the committed allowlist from this procedure.

## Backup

Stop the app first, so a record is not half written. Copy the whole store and keep the copy owner-only:

```bash
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="rr-local-${stamp}.tar.gz"
tar -C "$(dirname .release-rescue-local)" -czf "$archive" "$(basename .release-rescue-local)"
chmod 0600 "$archive"
```

If `RELEASE_RESCUE_LOCAL_DIR` points somewhere else, archive that directory instead.

The archive contains `secret.key`. Anyone who has that file can forge seals and sessions for the records in that store. Keep the archive on the operator's machine. Do not commit it, do not put it in the repository, and do not attach it to a ticket or a chat.

The archive does not contain repository source. Source is held in memory for one run and is not written. It does not contain passphrases, only scrypt hashes in `operators.json`. `checkouts.json` stores absolute paths; those paths are only useful on a machine that still has the clones.

A purged run is already reduced to its accounting (who started it, the repository and commit, the ledger, the hashes, the verdict, the finding count). Backup does not bring the report back.

## Recovery

Stop the app. Move the current store aside, extract the archive into the same path the app reads, and restore owner-only permissions:

```bash
chmod 0700 .release-rescue-local
find .release-rescue-local -type d -exec chmod 0700 {} +
find .release-rescue-local -type f -exec chmod 0600 {} +
```

Start with `npm run rr:local:app` and sign in. A restored `secret.key` validates the seals that were made with it. Sessions that were live when you stopped the app still work until they expire, the operator signs out, or the operator is removed.

If `secret.key` is missing or replaced, the app creates a new key the next time it needs one. Old seals then fail. Signed reports are withheld, and existing sessions end. That is not a recovery of those reports. Do not delete `secret.key` to "fix" a sign-in. Restore the key that sealed them, or leave the withheld reports to retention.

`operators.json` from the backup is the reviewer list. A name the claim guard now refuses can still sign in, and cannot sign a new report. Add a new operator with an acceptable name and run the review again, as the internal workflow document describes.

## Rollback

This rolls the program back on the same machine. It does not roll back a deployment, because there is no deployment of this mode.

1. Stop the app.
2. Take the backup above.
3. Note the SHA you are leaving: `git rev-parse HEAD`.
4. Check out a SHA already on `main` that you have run before. `aada503b31417d76ad40055dcb0b5c1b2b53d6a6` is the main tip this procedure was written against, before the ratio-rule field and the browser step on `verify`.
5. `npm ci`, then `npm run rr:local:app`.
6. Open <http://127.0.0.1:3020/internal/release-rescue>, sign in, and open a run you know.

Run records stay at `schemaVersion` `release-rescue-internal-run/v1`. Newer records carry `acquisition.limitsVersion` and `acquisition.measuredRatio`. Older code ignores fields it does not read, and still loads the record. Older records lack those fields. Newer code says they are absent. Seals cover the report, not the acquisition block, so the extra fields do not break a seal.

Rollback does not restore a purged report, and it does not undo a signature. If the new code mis-handled the store, restore the backup from before you started it, then start the older SHA.

Do not treat a rollback as permission to start the mode under `VERCEL`, `VERCEL_ENV`, or `VERCEL_URL`, or to bind a public address. Those still refuse, and they should.

## Proof environment

`npm run proof:sql` on `verify` uses Postgres 16. One non-Release-Rescue migration asks for `pg_net`, which that image does not have, and the runner skips it. The Release Rescue proofs still run. The skip is described in `docs/AI-APP-RELEASE-RESCUE-V1.md`. This local workflow does not use `pg_net`. Installing the extension here would not create a production data plane. Whether a future production database must have it is an owner decision, recorded as still open in the deploy-target packet.

## Residuals this procedure does not change

- Gzip framing after the data, and deflate data that decodes to nothing, remain the documented ratio residuals. The caps still hold. Changing them is an owner decision.
- The claim guard remains incomplete. The known misses stay in `src/lib/__tests__/release-rescue-claim-guard-residuals.ts`. This procedure does not close them and does not authorize a customer-facing claim that the guard is complete.
- Thirty of the thirty-two rubric checks stay `NOT RUN`. No model provider is authorized.
