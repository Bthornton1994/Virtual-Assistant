# Release Rescue: internal local workflow

This runs AI App Release Rescue on this machine, against our own repositories, so that we can use it and inspect what it produces. It is for internal use only. It is not the paid service, not a customer engagement, and not evidence of production readiness. The governing spec is `docs/AI-APP-RELEASE-RESCUE-V1.md`, and everything in it still applies.

## Run it

```bash
npm ci

# Once: create the reviewer who will sign. The passphrase is asked for without echo.
npm run rr:local -- operator:add --name "Your Name"

# Once per repository: point the allowlisted repository at a local clone.
npm run rr:local -- checkout:set Bthornton1994/StageForge /absolute/path/to/StageForge
npm run rr:local -- checkout:set Bthornton1994/three-white-lights /absolute/path/to/three-white-lights
npm run rr:local -- checkout:set Bthornton1994/Loadout /absolute/path/to/Loadout

# Build and start the app on 127.0.0.1:3020 in internal mode.
npm run rr:local:app
```

Open <http://127.0.0.1:3020/internal/release-rescue> and sign in with the name and passphrase you created. On each repository card, check the pinned commit (it defaults to the clone's default-branch head), confirm the repository is ours, and select **Run review**. Read the draft, then sign it or leave it unsigned. After signing, view the report or export it as JSON.

A review can also run from the terminal, up to the unsigned draft:

```bash
npm run rr:local -- head Bthornton1994/Loadout
npm run rr:local -- run Bthornton1994/Loadout --sha <40-char sha> --confirm-ownership --summary-out /tmp/rr-internal-outputs/loadout.json
```

The terminal has no signing command. Signing needs a signed-in session in the browser.

## What a run does

1. **Scope.** The repository must be listed in `config/release-rescue-internal.allowlist.json`. That file names one application and one critical workflow per repository. If a repository is not on the list, or the ownership box is not confirmed, the run is refused before anything is read and no record is written. To add a target, change the committed allowlist in a reviewed commit.
2. **Acquisition.** The run reads the pinned commit from the clone's git object database, using `git ls-tree` and `git cat-file`. It never reads the working tree, and it does not apply `.gitattributes`, filters, or hooks. The clone's `origin` must name the allowlisted repository. A `.tar` or `.tar.gz` made by `git archive` can be read instead with `--archive`; its recorded commit must equal the pin. Every limit in `SNAPSHOT_LIMITS` (file count, file size, total bytes, archive bytes, expansion ratio, path depth and length) is enforced against the bytes actually read, not the sizes the source declares. Symlinks are recorded and not followed. Traversal, absolute paths, hard links, devices, submodules, and credential files are recorded and not read. If a limit is exceeded, or the source is malformed, the run is **BLOCKED** and produces no report.
3. **Analysis.** Deterministic checks only. Each check is recorded in the ledger in one of four states:

   | Ledger state | Meaning | In the report |
   | --- | --- | --- |
   | `FAIL` | The check found an instance. | `concern`, with findings built from catalog codes and `path:line` locations |
   | `PASS` | The check ran over every file it covers and found nothing. | `not_assessed`: finding nothing does not show the control holds |
   | `BLOCKED` | A file the check covers was not read. | `not_assessed`, with that stated as the reason |
   | `NOT RUN` | No automated implementation exists. | `not_assessed`: it needs a reviewer's reading |

   Two of the 32 rubric checks are implemented: `secrets.no_secrets_in_version_control` (only vendor-specific credential shapes produce findings) and `secrets.no_secrets_reachable_from_client` (privileged key names behind a browser-exposed prefix). Generic matches, such as `password = "..."`, are counted for the reviewer and never reported. No check can report `pass`, so the verdict is always `conditional_release` and never a clean one.
4. **Draft.** The draft is assembled by the production `buildReleaseRescueReport` and must pass `validateReleaseRescueReport`. It is sealed with an HMAC under a local key.
5. **Signature.** The reviewer is the signed-in operator, taken from the session. The form sends only a reason code and the content hash of the draft that was shown. The signature is refused if the stored draft was edited, the hash differs, the operator no longer exists, the run is already signed, or the submission carries any other field.
6. **Export.** Viewing and export both go through `decideReleaseRescueDelivery`. A signed report whose stored copy no longer matches its seal is withheld. The first export counts as the delivery and starts the retention window.

## Data, identity and retention

- Everything is kept in `.release-rescue-local/` (or `RELEASE_RESCUE_LOCAL_DIR`), which is gitignored, with `0700` directories and `0600` files. It contains:
  - `secret.key`: the HMAC key;
  - `operators.json`: scrypt hashes, never passphrases;
  - `checkouts.json`;
  - `runs/*.json`.
- Source is held in memory for the length of a run and is never written anywhere. Run records, summaries, and exports carry catalog codes, counts, hashes, and `path:line` locations, and no source text or credential values.
- Retention follows the elected policy. After delivery, a run is purged when its policy's window ends. An undelivered run is purged 60 days after creation. The sweep runs whenever the dashboard or a run page loads, or on `npm run rr:local -- purge`. A purged run keeps only its accounting: its hashes, verdict, and finding count.
- Operators exist only in this directory, and there is no default account. Sessions are HMAC-signed, last 8 hours, and end when the operator is removed or the key changes. Five failed sign-ins lock the name for a minute.
- The internal routes return 404 unless `RELEASE_RESCUE_INTERNAL=local` is set and no `VERCEL*` variable is present. The request must also reach a loopback host with no forwarded-by-proxy headers. The server is bound to `127.0.0.1`.

## What this does not cover

- **Model-assisted analysis: NOT RUN.** No model provider is authorized for this workflow, so every check that needs one stays `not_assessed`. The limitation `ai_assisted_review_residual_risk` still appears, because the product's assembler adds it to every report.
- **The other 30 rubric checks are NOT RUN.** They need a reviewer's reading. The signed report says so, check by check.
- **No production path.** The local store is not the Supabase schema. None of the database-enforced invariants apply here: row-level security, immutability triggers, and the scheduled sweep. The local identity is not Supabase Auth. This mode refuses to start on a deployment.
- **No running system** is contacted, and no repository is modified.

## Tests

```bash
npx vitest run src/lib/__tests__/release-rescue-internal-*.test.ts
npm run build && npm run test:e2e:internal
```

The browser journey runs against a throwaway repository and store under the system temp directory. It covers:

- sign-in;
- refusal of a forged cookie;
- refusal of an out-of-scope or unconfirmed run;
- a tampered draft;
- a mismatched approval hash;
- signing;
- the signed view;
- export;
- a stranger's export attempt;
- a tampered signed report.
