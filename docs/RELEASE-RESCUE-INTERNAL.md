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
2. **Acquisition.** The run reads the pinned commit from the clone's git object database, using `git ls-tree` and `git cat-file`. It never reads the working tree, and it does not apply `.gitattributes`, filters, or hooks. The clone itself is treated as hostile input:
   - Its local git configuration must hold only the keys a plain clone carries: `core.*` basics, `remote.origin.url`/`fetch`, `branch.*`, `user.*`, `pull.*` and `init.defaultbranch`. It must not borrow objects from another repository.
   - Anything else refuses the checkout, including promisor remotes, `extensions.*`, `include.*`, `protocol.*` and `credential.*`, because such configuration can make git run a program while it reads.
   - Git also runs with every transport refused (`GIT_ALLOW_PROTOCOL`) and lazy fetching off.
   - The clone's `origin` must name the allowlisted repository.

   A `.tar` or `.tar.gz` made by `git archive` can be read instead with `--archive`. An archive's recorded commit is its author's claim, so the archive is accepted only if it is exactly the pinned commit of the allowlisted clone, which must be configured:
   - every file the review reads must appear once, byte for byte (the same git blob id);
   - every entry the review does not read must appear once, at the same path and for the same reason. That is anything the snapshot rules refuse: symlinks, credential files, oversized files, and illegal, too-long or too-deep paths. Their content is not compared, because it is not read. A submodule is the one exception: `git archive` writes it as a directory;
   - no other file or unread entry may appear, and no path may appear twice. Directory entries are not compared, since they hold no content.

   These are all refused:
   - a file hidden with `export-ignore`;
   - a file whose bytes were changed;
   - a file repeated in place of one that was left out;
   - a `.env` left out to turn BLOCKED into PASS.

   The run records the pinned tree's totals and its list of entries it did not read, not the archive's.

   Some archives of the right commit are refused as well, because their bytes or layout differ from the commit:
   - one made with `--prefix`, the layout of a GitHub tarball. A plain `git archive --format=tar <sha>` works instead;
   - a small `.tar.gz`. Tar pads every archive to 10 KB, so a small repository compresses past the expansion-ratio limit. The same plain `.tar` works instead;
   - one from a repository whose `.gitattributes` rewrites content, such as `export-subst`, `eol`/`text` or `ident`. `git archive` applies those whatever the format, so only the checkout works for such a repository.

   Each entry's path is taken in one spelling, with empty and `.` segments dropped, so `./a.ts`, `a.ts/` and `src//a.ts` name the same path as their plain forms. Absolute and drive-qualified paths are left as they are, so the entry rules still refuse them. A source that lists one path twice, however it spells it, is refused. So is a source that uses one path as both a file and a directory. That covers the git path too, where a hostile tree object can repeat a name or put a blob beside a subtree of the same name. GNU long-name records are refused, because `git archive` never writes them. Every limit in `SNAPSHOT_LIMITS` (file count, file size, total bytes, archive bytes, expansion ratio, path depth and length) is enforced against the bytes actually read, not the sizes the source declares. The file count is enforced before any blob is read. Symlinks are recorded and not followed. Traversal, absolute paths, hard links, devices, submodules, and credential files are recorded and not read. Data after a tar's end-of-archive marker, other than zero padding, refuses the archive. If a limit is exceeded, or the source is malformed, the run is **BLOCKED** and produces no report. A read that fails part way, a `.tar.gz` included, is recorded as a BLOCKED run too. So is a run whose source was read but whose analysis throws; it keeps its measured acquisition, with no ledger and no report. If the analysis completed but the draft cannot be built, or cannot be sealed with the local key, the run is BLOCKED with its ledger kept. Either way the record says which stage failed in a fixed sentence. The error text itself is neither stored nor logged.
3. **Analysis.** Deterministic checks only. Each check is recorded in the ledger in one of four states:

   | Ledger state | Meaning | In the report |
   | --- | --- | --- |
   | `FAIL` | The check found an instance it can cite. | `concern`, with findings built from catalog codes and `path:line` locations |
   | `PASS` | The check read every file it covers and found nothing. | `not_assessed`: finding nothing does not show the control holds |
   | `BLOCKED` | Something the check covers was not read, or every instance it found is in a file the report cannot name (a path that is not path-shaped, or that is itself credential-shaped). Any entry the snapshot rules refused counts as unread, a symlink included: its link text is committed content that could hold a credential. | `not_assessed`, with the reason stated |
   | `NOT RUN` | No automated implementation exists. | `not_assessed`: it needs a reviewer's reading |

   Every accepted file is scanned. UTF-16 text is decoded first. Other binary content is scanned as bytes for distinctive credential shapes only, and its locations carry no line numbers. Two of the 32 rubric checks are implemented: `secrets.no_secrets_in_version_control` (only vendor-specific credential shapes produce findings) and `secrets.no_secrets_reachable_from_client` (privileged key names behind a browser-exposed prefix). Generic matches, such as `password = "..."`, are counted for the reviewer and never reported. No check can report `pass`, so the verdict is always `conditional_release` and never a clean one.
4. **Draft.** The draft is assembled by the production `buildReleaseRescueReport` and must pass `validateReleaseRescueReport`. It is sealed with an HMAC under a local key.
5. **Signature.** The reviewer is the signed-in operator, taken from the session.
   - The app forwards only a reason code and the content hash of the draft that was shown. Any other form field is dropped and cannot affect who signs. The signing function itself refuses a submission that carries any other field.
   - The signature is refused if the stored draft was edited, the hash differs, the operator no longer exists, or the run is already signed.
   - A run started from the terminal has no named person on its ownership confirmation, so the signer must confirm ownership and is recorded as having done so.
6. **Export.** Viewing and export both go through `decideReleaseRescueDelivery`, after retention has been applied. A signed report whose stored copy no longer matches its seal is withheld, and so is one past its retention window. The first export a person asks for counts as the delivery and starts the retention window. Viewing the report does not, and neither does a browser prefetch of the download link.

## Data, identity and retention

- Everything is kept in `.release-rescue-local/` (or `RELEASE_RESCUE_LOCAL_DIR`), which is gitignored, with `0700` directories and `0600` files. It contains:
  - `secret.key`: the HMAC key;
  - `operators.json`: scrypt hashes, never passphrases;
  - `checkouts.json`;
  - `runs/*.json`.
- Source is held in memory for the length of a run and is never written anywhere. Run records, summaries, and exports carry catalog codes, counts, hashes, and `path:line` locations, and no source text or credential values.
- Retention follows the elected policy. After delivery, a run is purged when its policy's window ends. An undelivered run is purged 60 days after creation. The sweep runs whenever the dashboard or a run page loads, before any view or export, or on `npm run rr:local -- purge`. A purged run keeps no report, draft or file path, only the record that it existed:
   - who started it, the repository and commit;
   - the check ledger and acquisition counts;
   - the report's hashes, verdict and finding count.
- Operators exist only in this directory, and there is no default account. Sessions are HMAC-signed and last 8 hours. They end when the operator signs out (every copy of the cookie with them), when the operator is removed, or when the key changes. Five failed sign-ins lock the name for a minute.
- The server is bound to `127.0.0.1`, which is what keeps it off the network. As defence in depth, the internal routes return 404 unless `RELEASE_RESCUE_INTERNAL=local` is set and none of `VERCEL`, `VERCEL_ENV` or `VERCEL_URL` is. The request must also be addressed to a loopback host and carry no `Forwarded` or `X-Real-IP` header, and no `X-Forwarded-*` value naming another host or address. No other kind of deployment is detected: do not run this mode anywhere but your own machine.
- Reports record the repository's access mode as `customer_uploaded_archive`, the production mode for access that does not itself demonstrate control. A local clone doesn't either, which is why a named person confirms ownership.

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
- a tampered signed report, shown withheld;
- viewing and prefetching not counting as delivery;
- sign-out ending a copied session.
