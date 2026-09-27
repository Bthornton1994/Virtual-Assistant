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
- A run page names the acquisition status, the shared limits version `release-rescue-snapshot-limits/v1`, and the expansion ratio rule `whole-archive/compressed-data/16MiB-floor`. A `.tar.gz` of which the tool read at least one byte says the ratio rule was applied, including one refused afterwards because it is not the pinned commit. A git checkout, a plain `.tar`, and a `.tar.gz` refused before a byte of it was read say the rule was not applied. A record written before those fields existed says they are absent. The page quotes the record as stored and does not fill it in or correct it, so a record written by a build of this change from before that rule was settled can disagree with it for a `.tar.gz` that was refused.
- The ledger still shows two implemented checks and thirty `NOT RUN`. The verdict stays `conditional_release`. Model-assisted analysis stays `NOT RUN`.

There is no off-machine monitor, log drain, or status page, and this procedure does not add one. The tool does not log error text. What you can inspect on the machine:

- The listen address, as above.
- Disk use of the local store: `du -sh .release-rescue-local`. Source bytes are not in it. Run records, scrypt hashes, checkout paths, and `secret.key` are.
- Runs whose status is `blocked`, from the dashboard or from `runs/*.json`. A blocked run is a refused source or a failed stage. The record names the stage in a fixed sentence. It does not contain the error text or the source.
- Five failed sign-ins in a row lock that display name for one minute, whether or not the name is registered. The fifth failure still shows "That name and passphrase do not match a registered reviewer." While the name is locked, the page shows "Too many failed attempts. Wait a minute and try again.", even for the right passphrase. An attempt while the name is locked is not counted. Until a sign-in succeeds, each further failure locks the name for another minute. The count is held in memory, so restarting the app clears it.

An uncommitted edit of `config/release-rescue-internal.allowlist.json` takes effect, because the tool reads the working tree and does not check that the file is the committed one. For this single-operator local workflow that is the current rule. It is not a production allowlist control. Do not widen the committed allowlist from this procedure.

## Backup

Stop the app first, so a record is not half written. From the repository root, where `rr:local` and `rr:local:app` run, copy the whole store to a directory outside the repository:

```bash
store="${RELEASE_RESCUE_LOCAL_DIR:-$PWD/.release-rescue-local}"
backups="$HOME/rr-local-backups"
(
  umask 077
  mkdir -p "$backups"
  chmod 0700 "$backups"
  tar -C "$(dirname "$store")" -czf "$backups/rr-local-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" "$(basename "$store")"
)
```

`umask 077` applies inside the parentheses only. It makes the directory and the archive owner-only as they are created, so there is no moment when another account on the machine can read them. `$HOME/rr-local-backups` is an example. Any dedicated directory outside the repository checkout that holds only these backups will do; the block makes it owner-only, so do not point it at a shared one. Leave `RELEASE_RESCUE_LOCAL_DIR` unset or set it to a non-empty path: the app reads an empty value as the current directory, and these commands do not. Do not write the archive into the repository. `.gitignore` ignores `/rr-local-*.tar.gz` at the repository root only as a backstop for a mistake.

The archive contains `secret.key`. Anyone who has that file can forge seals and sessions for the records in that store. Keep the archive on the operator's machine. Do not commit it, and do not attach it to a ticket or a chat.

The archive does not contain repository source. Source is held in memory for one run and is not written. It does not contain passphrases, only scrypt hashes in `operators.json`. `checkouts.json` stores absolute paths; those paths are only useful on a machine that still has the clones.

An archive is the store as it was when it was taken. A run purged before then is already reduced to its accounting (who started it, the repository and commit, the ledger, the hashes, the verdict, the finding count), and the archive has no report for it. A run purged later still has its draft or signed report in every archive taken before the purge. Retention does not reach an archive: the sweep reads only the live store. Delete each archive no later than 60 days after it was taken. By then every run in it is past the deadline the archive records for it: an undelivered run is purged 60 days after it was created, and a delivered run at most 30 days after delivery. Nothing enforces that bound except this procedure.

## Recovery

Restoring an archive puts the store back to the moment the archive was taken. What happened to the store after that is undone:

- Runs started after the backup are not in the restored store.
- Signatures made after the backup are gone. A run that was awaiting review at the backup is awaiting review again, and anyone on the restored reviewer list can sign it.
- A delivery recorded after the backup is undone. `deliveredAt` is empty again, the report can be exported again, and that export starts a new retention window.
- Reports purged after the backup are back in full, until a sweep finds them past their restored deadline.
- Operators removed after the backup are back, with their old passphrases, and a cookie of theirs that has not expired works again. Operators added after it are gone.
- Sign-outs after the backup are undone. A cookie that such a sign-out had voided works again until its eight hours are up.
- `checkouts.json` has the paths it had at the backup.

Step 5 below puts back the moved-aside store's run records and applies its removals and sign-outs again. It does not put back operators added or checkout paths set after the backup; add them again with `operator:add` and `checkout:set`. Restore only to replace a store that is lost or damaged. Take these steps in order, in one shell, from the repository root:

1. Stop the app.
2. Name the store and the backup directory, as the backup did:

   ```bash
   store="${RELEASE_RESCUE_LOCAL_DIR:-$PWD/.release-rescue-local}"
   backups="$HOME/rr-local-backups"
   aside="$backups/moved-aside-$(date -u +%Y%m%dT%H%M%SZ)"
   ```

3. If there is a current store, move it aside, outside the repository, and keep it: `mv "$store" "$aside"`. If `mv` fails, stop and do not extract: extracting over a store that is still there mixes the two. The moved-aside store is the only record of the runs, signatures, exports, and purges made after the backup, because the tool keeps no other log. It holds `secret.key` and reports, so it takes the same care as an archive, and the same 60-day bound, counted from the day you moved it aside.
4. Extract the archive into the path the app reads:

   ```bash
   (umask 077 && tar -C "$(dirname "$store")" -xzf "$backups/rr-local-<stamp>.tar.gz")
   ```

5. Before you start the app, redo what the archive does not know about. The moved-aside `operators.json` shows which operators it still had, and each operator's latest sign-out as `sessionsValidFrom`, in milliseconds since 1970.
   - Remove again each operator removed after the backup: `npm run rr:local -- operator:remove <operator id>`. `npm run rr:local -- operator:list` shows the restored list.
   - For each sign-out after the backup that is less than eight hours old, remove that operator and add them again (`operator:remove`, then `operator:add`), or wait until eight hours after that sign-out before you start the app. The new entry has a new id, so no cookie issued to the old one verifies. There is no terminal command that signs an operator out.
   - For each run the restored store lacks, or that is further along in the moved-aside store (signed, delivered, or purged there but not in the restored copy), copy its `runs/<run id>.json` from the moved-aside store over the restored one, unless that record is the damage you are recovering from. `grep -lE '"status": "(signed|purged)"|"deliveredAt": "' "$aside"/runs/*.json` lists the runs that may be further along, and `for f in "$aside"/runs/*.json; do [ -e "$store/runs/${f##*/}" ] || echo "$f"; done` lists the runs the restored store lacks. Check each copied run with `npm run rr:local -- show <run id>`. A copied purged record holds the accounting, not the report. A copied signature verifies only while `secret.key` is the key that sealed it. A signature or delivery you do not copy back is recorded only in the moved-aside store.
   - Then run `npm run rr:local -- purge`. It purges every run whose deadline has passed, judged on the records as they now stand. A run whose later delivery you did not copy back is undelivered in the restored store, so `purge` leaves its report until 60 days after the run was created.
   - If there is no moved-aside store, or its `operators.json` cannot be read, there is no record of what happened after the backup. Remove every restored operator (`operator:list`, then `operator:remove`), and add back with `operator:add` only the people who should sign now; the new ids void every old cookie. Treat every restored run as possibly signed, exported, or purged after the backup, and check for exported report files before anyone signs or exports it again.
6. Restore owner-only permissions:

   ```bash
   chmod 0700 "$store"
   find "$store" -type d -exec chmod 0700 {} +
   find "$store" -type f -exec chmod 0600 {} +
   ```

7. Start with `npm run rr:local:app` and sign in.

A restored `secret.key` validates the seals that were made with it. A session works until it expires, the operator signs out, the operator is removed, or the key changes, each judged against the restored `operators.json`. That is why step 5 comes before the app starts.

If `secret.key` is missing, the app creates a new key the next time it needs one. If it was replaced, the app uses the replacement. Either way, seals made with the old key fail. Signed reports are withheld, and existing sessions end. That is not a recovery of those reports. Do not delete `secret.key` to "fix" a sign-in. Restore the key that sealed them, or leave the withheld reports to retention.

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

Checking out another SHA leaves the store as it is, so a rollback on its own neither brings back a purged report nor undoes a signature. Extracting a backup undoes both, for everything after it was taken, and Recovery step 5 then puts back what the moved-aside store records. If the new code mis-handled the store, restore the backup from before you first started it, following every Recovery step, then start the older SHA. Under step 5, apply removals and sign-outs again in every case, and copy back only the run records the new code did not damage. A signature, delivery, or purge you do not copy back is recorded only in the moved-aside store.

Do not treat a rollback as permission to start the mode under `VERCEL`, `VERCEL_ENV`, or `VERCEL_URL`, or on an address other than `127.0.0.1`. Only the `VERCEL` variables are refused: with any of them set, every internal route returns 404. Nothing in the code refuses a public bind. The `--hostname 127.0.0.1` in `rr:local:app` is the only control that keeps the server off the network. The request guard reads headers a client can send, so it does not replace the bind. G-11 in `docs/RELEASE-RESCUE-DEPLOY-TARGET-DECISION.md` remains open.

## Proof environment

`npm run proof:sql` on `verify` uses Postgres 16. One non-Release-Rescue migration asks for `pg_net`, which that image does not have, and the runner skips it. The Release Rescue proofs still run. The skip is described in `docs/AI-APP-RELEASE-RESCUE-V1.md`. This local workflow does not use `pg_net`. Installing the extension here would not create a production data plane. Whether a future production database must have it is an owner decision, recorded as still open in the deploy-target packet.

## Residuals this procedure does not change

- Gzip framing after the data, and deflate data that decodes to nothing, remain the documented ratio residuals. The caps still hold. Changing them is an owner decision.
- The claim guard remains incomplete. The known misses stay in `src/lib/__tests__/release-rescue-claim-guard-residuals.ts`. This procedure does not close them and does not authorize a customer-facing claim that the guard is complete.
- Thirty of the thirty-two rubric checks stay `NOT RUN`. No model provider is authorized.
