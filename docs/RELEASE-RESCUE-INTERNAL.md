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

The terminal checks every argument before it reads or writes anything. It refuses, with exit status 1:
- an option the command does not take, including a misspelled one, and a name every object inherits, such as `--constructor` or `--__proto__`;
- an option given twice;
- `--option=value` (write `--option value`);
- an option with a missing or empty value, or one followed by another option. A value may not begin with `-`, so write `./-x` for a file called `-x`, and `--name " -Ann"` for a display name that begins with `-` (names are trimmed);
- the wrong number of arguments, a `--sha` that is not a full 40-character lowercase commit, and an unknown `--retention` policy.

`operator:add` checks the display name before it asks for a passphrase.

A run exits 0 when its draft awaits a reviewer and 2 when it was saved as BLOCKED. It exits 1 if the summary file could not be written, after reporting the run, whether or not the run was BLOCKED. The summary file and an export are written owner-only (`0600`), through a new file beside the target that is renamed over it. An existing file at that path is replaced, and so is a symlink, which is not written through. If an export cannot be written, the command says so in one sentence, exits 1, and records no delivery. Any other unexpected failure prints `The command failed unexpectedly.`, with the system error code when there is one, and exits 1. No stack trace or error text is printed.

## What a run does

1. **Scope.** The repository must be listed in `config/release-rescue-internal.allowlist.json`. That file names one application and one critical workflow per repository. If a repository is not on the list, or the ownership box is not confirmed, the run is refused before anything is read and no record is written. To add a target, change the committed allowlist in a reviewed commit. The tool reads that file from the working directory and does not check that it is committed or reviewed, so an uncommitted local edit takes effect: the reviewed commit is a rule for the operator, not a check the tool makes. `RELEASE_RESCUE_ALLOWLIST` names another allowlist file for the test harness only. It is ignored unless `RELEASE_RESCUE_TEST_FIXTURES=1` is also set, so a run is then refused as not allowlisted rather than read against another list. Set neither in normal use.
2. **Acquisition.** The run reads the pinned commit from the clone's git object database, using `git ls-tree` and `git cat-file`. It never reads the working tree, and it does not apply `.gitattributes`, filters, or hooks. The clone itself is treated as hostile input:
   - Its local git configuration must hold only the keys a plain clone carries: `core.*` basics, `remote.origin.url`/`fetch`, `branch.*`, `user.*`, `pull.*` and `init.defaultbranch`. It must not borrow objects from another repository.
   - Anything else refuses the checkout, including promisor remotes, `extensions.*`, `include.*`, `protocol.*` and `credential.*`, because such configuration can make git run a program while it reads.
   - Git also runs with every transport refused (`GIT_ALLOW_PROTOCOL`) and lazy fetching off.
   - The clone's `origin` must name the allowlisted repository.

   A `.tar` or `.tar.gz` made by `git archive` can be read instead with `--archive`. The file name decides the format: `.tar.gz` or `.tgz` is read as gzip, and anything else as a plain tar. An archive's recorded commit is its author's claim, so the archive is accepted only if it matches the pinned commit of the allowlisted clone, which must be configured. The archive and the commit are compared entry by entry:
   - every file must appear once under the same path, with the same bytes (the same git blob id). That holds whether or not the review reads it: a credential file, an oversized file, or a file whose name the rules refuse is hashed as it streams past unread;
   - every symlink must appear once, at the same path and with the same target (the target's blob id). It is not followed;
   - every other entry the review does not read must appear once, at the same path and for the same reason;
   - a submodule must be absent or a directory, which is how `git archive` writes it. Anything else at its path is refused;
   - no other file, symlink or unread entry may appear, and no path may appear twice.

   What is not compared:
   - Directory entries. They hold no data: a directory, symlink, hard link or special entry that carries data is refused.
   - Path spelling. Paths are compared in the one spelling described below, so `./a.ts` in an archive is `a.ts`.

   A symlink target of up to 100 bytes is written in the tar header's link name, which ends at its first NUL. So if such a target holds a NUL byte, its archive never matches the commit and is refused; review such a commit from the checkout. A longer target is written as a pax `linkpath` record, which keeps every byte, NUL included, so that archive matches and is read. Both forms are tested.

   The run records the pinned tree's totals and its list of entries it did not read, not the archive's.

   These are all refused:
   - a file hidden with `export-ignore`;
   - a file whose bytes were changed, whether or not the review reads it;
   - a file repeated in place of one that was left out;
   - a `.env` left out to turn BLOCKED into PASS;
   - a symlink pointed somewhere else;
   - a file renamed to other bytes that are not valid UTF-8.

   Some archives of the right commit are refused as well, because their bytes or layout differ from the commit:
   - one made with `--prefix`, the layout of a GitHub tarball. Use a plain `git archive --format=tar <sha> > commit.tar`, or `git archive --format=tar.gz <sha> > commit.tar.gz`;
   - one from a repository whose `.gitattributes` rewrites content, such as `export-subst`, `eol`/`text` or `ident`. `git archive` applies those whatever the format, so only the checkout works for such a repository.

   **Paths.** Each entry's path is taken in one spelling, with empty and `.` segments dropped, so `./a.ts`, `a.ts/` and `src//a.ts` name the same path as their plain forms. Absolute and drive-qualified paths are left as they are, so the entry rules still refuse them.

   A name is decoded exactly: bytes that are not valid UTF-8 are written as `\xHH`, and so is a backslash. So two different names never become one path, and an archive cannot rename a committed file to other bytes that decode the same way. Such a name holds a backslash, which the entry rules refuse, so the file is recorded as not read and the text checks cannot pass.

   On the git path, a tree entry with a name git itself refuses (empty, `.`, `..`, or containing `/`) refuses the snapshot, rather than being read under another path. Such a name is not seen when its directory part is also a real subtree: a blob named `x/y.ts`, or a subtree named `x/y`, beside a subtree `x`. Each file is read under the path it spells, which is also what `git archive` writes for it. Both are pinned by a test.

   A source that lists one path twice, however it spells it, is refused. So is a source in which a file the rules would read (at most 400 UTF-16 characters and 24 segments) is also used as a directory. That covers the git path too, where a hostile tree object can repeat a name or put a blob beside a subtree of the same name that holds a path. A git subtree that holds no path is not compared this way: an empty subtree beside a blob of its name, and one name used for two subtrees, are not refused. Neither hides a file or reads one twice, because each file under them is still read once under its own path, and the same file reached through both is a repeated path. Two entries that are both refused as too long or too deep are not compared this way. Neither is read, and either one keeps the text checks from passing. GNU long-name records are refused, because `git archive` never writes them. A pax length must be plain decimal digits and must end exactly at its record's newline.

   **Limits.** Every limit in `SNAPSHOT_LIMITS` (file count, file size, total bytes, archive bytes, expansion ratio, path depth and length) is enforced against the bytes actually read, not the sizes the source declares. The file count is enforced before any blob is read.

   A `.tar.gz` is judged on the whole archive's expansion ratio: its expanded bytes over its compressed data. The compressed data is the file's size, taken before it is read, less its gzip framing: each member's header, optional name, comment and extra fields included, and its 8-byte trailer. It is refused once it expands past 12 times its compressed data and past 16 MiB. Because expanded bytes only grow and framing only grows, the decision does not depend on the order of the entries or on how the file is read. The reader stops as soon as the threshold is passed, so the bound on how far a bomb expands depends on where its framing is:
   - framing before the data, such as a 12 MB comment or name in the header, or empty members in front, is subtracted before the data expands, so the bomb is stopped at the same point as without it: within 2 MiB of 16 MiB, in the tests;
   - framing after the data, such as empty members behind the tar, is only known once it is read, so until then the bomb expands under the threshold the file's size allows, at most 12 times the file's size and never past `maxTotalBytes`, and is then refused;
   - deflate data that decodes to nothing, such as empty stored blocks, is compressed data rather than framing. Padding the data this way raises the threshold, within the same two bounds. This is a recorded residual, pinned by a test.

   A test reads a 21 MB archive that expands to 37 MB, with its compressible files first and then last, at three read sizes and from a file, and accepts it every time. Below 16 MiB the ratio is not applied: tar framing alone (a 512-byte header per entry, and padding) makes a small repository, or one of many small files, expand far past 12x. 16 MiB covers the framing of 5,000 small files with short paths. It does not cover 5,000 files each in its own directory with paths long enough to need pax records, which is about 18 MB of framing at nearly 30x. A `.tar.gz` like that, or any whose expanded bytes are over 12 times its compressed data and over 16 MiB, is refused even when it is legitimate, with the reason and the advice to use a plain `.tar`, which has no ratio. A file that changes size while it is read is refused.

   A `.tar.gz` may have at most 4,096 gzip members; one with more is refused as `The archive has more than 4096 gzip members.` `git archive` writes one. Each member costs about 0.15 ms to set up, so the bound keeps a run of empty members from taking minutes to read, and it is above the 3,052 members a BGZF file of 64 KiB blocks needs to reach `maxTotalBytes`. Each member's header, header CRC, CRC-32 and length are checked as gunzip checks them, and a failure is refused as `The archive is not valid gzip.` Tests read the output of `git archive --format=tar.gz` and of `gzip`, which writes a name field.

   `git archive` writes nothing after a `.tar.gz`'s gzip data. The file is read to its end before the decision, so the result does not depend on how the file is read. As with gzip, trailing bytes that begin with a zero byte end the gzip data, and the reader refuses them as `Data followed the gzip stream.` Any other trailing bytes are read as another gzip member. One that is not valid is refused as `The archive is not valid gzip.` A valid one's content follows the tar's end-of-archive marker, and is refused unless it is empty or only zeros, which is accepted like a plain tar's zero padding, so no content can be hidden there.

   Every record carries `limitsVersion: release-rescue-snapshot-limits/v1`, the version the product's SQL schema stores. It names the `SNAPSHOT_LIMITS` values and the entry and whole-snapshot rules of `evaluateSnapshot`, which are unchanged. It does not name how this reader measures the expansion ratio (the whole archive's, over its compressed data, with the 16 MiB floor), and a record does not say which ratio rule it was read under.

   Symlinks are recorded and not followed. Traversal, absolute paths, hard links, devices, submodules, and credential files are recorded and not read. Data after a tar's end-of-archive marker, other than zero padding, refuses the archive. If a limit is exceeded, or the source is malformed, the run is **BLOCKED** and produces no report.

   **Failures.** A read that fails part way, a `.tar.gz` included, is recorded as a BLOCKED run too. So is a run whose source was read but whose analysis throws; it keeps its measured acquisition, with no ledger and no report. If the analysis completed but the draft cannot be built, or cannot be sealed with the local key, the run is BLOCKED with its ledger kept. Either way the record says which stage failed in a fixed sentence. The error text itself is neither stored nor logged.
3. **Analysis.** Deterministic checks only. Each check is recorded in the ledger in one of four states:

   | Ledger state | Meaning | In the report |
   | --- | --- | --- |
   | `FAIL` | The check found an instance it can cite. | `concern`, with findings built from catalog codes and `path:line` locations |
   | `PASS` | The check read every file it covers and found nothing. | `not_assessed`: finding nothing does not show the control holds |
   | `BLOCKED` | Something the check covers was not read, or every instance it found is in a file the report cannot name (a path that is not path-shaped, or that is itself credential-shaped). Any entry the snapshot rules refused counts as unread, a symlink included: its link text is committed content that could hold a credential. It is compared with the commit, but not scanned. A check that finds a citable instance elsewhere is `FAIL` instead, and its unread count is still shown. | `not_assessed`, with the reason stated |
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
- A display name may not make a claim about the review. It is held to the offer's prohibited claims and, as a typed value, to professional claims such as "penetration tester", "pentester", "ISO 27001 lead auditor" or "compliance certified" (`TYPED_FIELD_PROHIBITED_CLAIMS`). A possessive reads as the bare word, so "Pentester's" is refused. So does a word in single quotes, as a typed value and as offer copy: "Dana 'Pentester' Okafor" and "Book a 'penetration test'" are refused, and "Kim 'Red' Okafor" is accepted. "ISO 27001:2022 Lead Auditor" (and the 2005 and 2013 editions), "PCI DSS certified", "Whitehat Hacker" and "Purple Teamer" are refused as typed values; each rule is the exact phrase, so "ISO 27001:2017 Lead Auditor", "PCI DSS v4.0 certified" and "Certified Whitehat" still pass and are recorded as residuals. A typed-field phrase does not run across a comma or other clause mark with a space beside it, so "Erik Red, Team Lead" is accepted and "Red Team Lead" is refused. A mark with no space beside it joins the words: "Red–Team Lead" and "Penetration(Tester)" are refused. Signing checks the name again.
  - "Certified auditor" is not refused, because it is also an accounting credential. It is recorded as a residual.
  - The same clause rule lets "Penetration, Tester", "Red – Team Lead", "Security: Certified" and "Ethical (Hacker)" through. They are recorded as residuals.
  - Three innocent names are refused and pinned by a test: "Alex Red / Team Lead" and "Erik Red - Team Lead" (a slash and a hyphen are not clause breaks) and "Ruby Red Team". Write the name another way.
  - The guard is not complete. The forms it is known to miss, such as "Certified in compliance", a credential acronym such as "CISSP", or a lookalike letter, are recorded in `src/lib/__tests__/release-rescue-claim-guard-residuals.ts`.
- An operator registered before the professional claims were added may have a name the guard now refuses. That operator can still sign in, and `operator:list` and the terminal summary of a run they signed still show the name. A new signature by them is refused. A report they signed before is withheld at export, because the delivery gate reads the signer's name, and it is never delivered. It cannot be signed again, because it is no longer a draft. The way forward is `operator:add` with a name the guard accepts and a new run for the new operator to sign; `operator:remove` ends the old operator's sessions and is advisable but not required. The earlier report stays withheld until retention purges it.
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
npm run proof:rr-internal
```

`proof:rr-internal` undoes each guard added in the third review, one at a time, and runs the suite that should notice. It reports which named tests failed, and a comment-only control must fail none. It edits the source files while it runs, restores them afterwards, and will not start while those files have uncommitted changes. GitHub Actions `verify` and local `npm run verify` both run it, after `proof:claim-guard` and before the build. That is release-gate coverage for these guards. It does not make this workflow production-ready, and it does not enable the mode on Vercel or any public deployment.

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
