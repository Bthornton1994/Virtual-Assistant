# Software Context Shunt v1

Status: implemented local pilot; registry **proposed**. Not qualified for automatic routing or deployed. No database, connector, bot, routine, model pin, merge authority, or production change.

## Outcome and architecture

Return a bounded, exact **locator result** for a literal source lookup without feeding whole files into an agent. Keep the original source available for reasoning and review. This is the first measurable subset of the proposed context shunt, not a claim to solve all Software Factory usage.

**Vision: aligns with constraints.** Applies `VISION.md` sections *Use the right executor for each step*, *Capability sovereignty*, *Authority is explicit and bounded*, and *Manual first, automation after proof*. Source-linked extraction is native; future inference/retrieval providers remain replaceable. Quality and authority do not trade away for cheaper context.

| Layer | Responsibility in this increment |
| --- | --- |
| Delegation Cloud | Strict request/scope/receipt contracts, deterministic extraction, hashes, coverage and byte counts |
| Local CLI in an already authorized checkout | Read pinned Git blobs, run the helper, return JSON; no remote access |
| Grok Bot / Cursor / Codex | Optional future consumers of the same CLI/contract; no connector or interception installed here |
| Existing PM / CoS / verifier | Work status, coordination, independent review and existing merge decisions; unchanged |

The implementation extends the **CS-5 context-provider experiment boundary**, not draft Run Manager PR #65 or held PR #67. It adds no second context service or evidence store. `contextShuntSearchProjection` supplies existing CS-5 search metadata only for a complete/no-match result bound to a currently valid request and scope. It refuses partial, line-only, tampered, expired or mismatched input. It does **not** claim to implement build, graph, callers or impact analysis. Nothing populates the empirical scorecard with invented token or outcome observations.

## Supported use and limits

- Case-sensitive literal search plus 0–20 context lines, or one exact 1-based line interval in one file. No regex execution, semantic summary, code generation, source writes, network access, or model calls.
- Up to 32 explicit regular-file paths; 1 MiB per file and 4 MiB total input. Response budget 2–32 KiB, including the full minified JSON envelope, hashes and metrics.
- Source path, full 40-character Git commit, source SHA-256, snapshot hash, request hash, scope hash and policy version remain inspectable. CRLF, tabs, Unicode, BOM and final-newline state are preserved.
- Every successful receipt is explicitly `resultRole: "locator_only"` and `decisionReadiness: "not_assessed"`. `complete` means all matching literal windows fit the response budget, never that a code investigation, diagnosis or decision is complete.
- Overlapping search windows are merged. A budget-constrained response returns an intact prefix of windows, an omitted-window count, `partial`, and a narrowing action. It never silently cuts a window or labels a partial result complete.
- `no_match` means only that the literal was absent from the named files, not that a behavior, caller, dependency or defect does not exist.
- Judgment tasks (debugging, architecture, security and design review) return `DIRECT_REQUIRED`; no cheap model or silent fallback is launched. An incidental locator call may be useful, but the reasoning task still needs the original context.
- Required instruction files (`AGENTS.md`, `VISION.md`, `SKILL.md`, authority files and standing orders) are never compressed. The trusted caller must list **all additional applicable full-read files** in `requiredFullReadPaths`; filename rules cannot discover every instruction dependency.
- If a receipt is no smaller than the source, use an ordinary targeted read. This is not a replacement for `rg`, exact line reads, or native context already supplied efficiently.

`DIRECT_REQUIRED` is a routing decision, **not an owner blocker**. Continue through the existing authorized read/reasoning workflow. Missing local objects, no-match and partial results need a bounded technical continuation; they do not justify removing approvals, inventing new scope, or asking the owner to run routine tools.

The first Cursor A/B trial exposed the key failure mode: a receipt can contain every requested `content_hash` match while still omitting enough surrounding code to reveal an envelope/hash mismatch. That is a valid **negative qualification result**, not a defect to hide with a larger default window. Consumers must use `taskKind: "debugging"` for diagnosis, honor `DIRECT_REQUIRED`, and treat a `locator_only` receipt as a map to the original source. In an authorized local checkout, `rg` or `git grep` may be the cheaper locator when it is already available; the CLI's setup and process overhead must be included in any economics comparison.

## Authority and privacy boundary

`software-context-scope/v1` must come from an already authorized caller, separately from the executor request. It binds organization, assignment, repository, commit, exact allowed paths, permission version, policy hash, data policy and expiry. Every invocation checks these bindings before reading blobs. The core checks the supplied path set and raw content hashes again before a cache hit.

**A scope JSON file is not authentication or an approval grant.** The local CLI operates under the invoking user's existing OS/repository access. Repository/tenant labels do not authenticate a checkout. A future multi-tenant adapter must resolve the checkout through its own trusted registry, derive scope from authenticated Delegation Spec/Execution Context authority, enforce current permission/revocation checks on every call, and never accept caller-authored scope as authorization. This PR does not claim those connectors are implemented.

The CLI reads committed blobs, not dirty working-tree files; a result can therefore intentionally differ from current uncommitted edits. Re-pin and authorize the intended commit before using it for a changed PR. Missing objects, symlinks, submodules, binary/invalid UTF-8, oversize input and unavailable Git fail closed. Literal pathspecs, explicit argv (no shell), disabled object replacements/lazy fetch, a minimal child environment, per-command timeouts and an overall 30-second read deadline constrain the adapter. It does not fetch missing objects or run checkout/build commands. Use Git supporting `--no-lazy-fetch`; unsupported versions fail rather than silently reaching a remote.

Sensitive paths and recognizable secret-like content are withheld without echoing raw source or subprocess errors. This is defense in depth, **not complete DLP**. Use reviewed source files only; no production logs, credentials or arbitrary confidential datasets. Retrieved text is marked untrusted and cannot grant authority. Literal quoting alone is not a universal prompt-injection defense; consumers must keep data separate from trusted instructions and enforce tool permissions.

The optional process-local cache has 8 entries by default, capped at 32, and can be disabled or cleared. It stores only bounded receipts, not complete source bodies. Its key binds request, permission/policy scope and all source content hashes. It is not a singleton, persistent memory, cross-tenant sharing or an authority source. Cache hits revalidate scope and source hashes. A fresh CLI invocation deliberately uses no cache. This cache does **not** reduce repeated prompt ingestion or avoid Git reads between CLI processes.

## Run once in an existing authorized checkout

Requires Node 22.6+ with native type stripping and Git 2.45+ supporting `--no-lazy-fetch`. The npm scripts pass `--experimental-strip-types` for Node 22.6 through 22.17; Node 22.18 and later enable type stripping by default. Node's built-in support strips erasable types only, does not type-check, and does not apply `tsconfig` path aliases. No added dependency or paid account is required; use the existing lockfile installation. Git's `--no-lazy-fetch` option was introduced in Git 2.45; older Git versions fail closed rather than risking an implicit promisor fetch.

```sh
npm run context:read -- --help
npm run context:read -- --repo /absolute/approved/checkout --scope /absolute/scope.json --request /absolute/request.json
npm run context:benchmark
# Direct invocation outside npm on Node 22.6–22.17:
node --experimental-strip-types scripts/software-context-shunt.mjs --repo /absolute/approved/checkout --scope /absolute/scope.json --request /absolute/request.json
```

For machine consumption, invoke `node scripts/software-context-shunt.mjs ...` directly so npm's banner does not mix with JSON stdout. The adapter writes only stdout; the surrounding approved workflow decides whether/how to persist evidence. It does not write files to the checkout.

Prepare the following manifests under existing read authority. Replace placeholders with a real assigned task, approved source paths, exact local commit, current scope and expiry. **Do not ask the owner for a token, paste secrets in chat, or fabricate approval evidence.**

Request:

```json
{
  "schemaVersion": "software-context-request/v1",
  "organizationId": "existing-org-id",
  "assignmentId": "existing-assignment-id",
  "repository": "Bthornton1994/Virtual-Assistant",
  "revision": "<full 40-character approved local Git commit>",
  "taskKind": "lookup",
  "paths": ["src/lib/context-provider.ts"],
  "selection": { "kind": "search", "query": "buildContextProviderScorecard", "contextLines": 2 },
  "maxResponseBytes": 8192
}
```

Scope, constructed by the trusted local operator/adapter, not the executor's output:

```json
{
  "schemaVersion": "software-context-scope/v1",
  "organizationId": "existing-org-id",
  "assignmentId": "existing-assignment-id",
  "repository": "Bthornton1994/Virtual-Assistant",
  "revision": "<same full commit>",
  "permissionVersion": "existing-read-scope-version",
  "policyHash": "<64-character SHA-256 of the applicable policy snapshot>",
  "dataPolicy": "approved_private_repository",
  "allowedPaths": ["src/lib/context-provider.ts"],
  "requiredFullReadPaths": ["AGENTS.md", "VISION.md", "README.md"],
  "expiresAt": "<current scope expiry in ISO UTC format>"
}
```

| Exit | Meaning | Next action |
| --- | --- | --- |
| 0 | Complete literal-match coverage (or explicit `--help`) | Inspect cited originals before consequential decisions; `resultRole` remains `locator_only`; not an Outcome Receipt |
| 2 | Invalid/unavailable input, policy refusal, unsupported Git safety capability or direct read required | Read `code`; correct only within existing scope or use the ordinary authorized path |
| 3 | Partial coverage or no literal match | Narrow the request / broaden only within authorized paths; do not claim task completion |

## Evidence and rollout

The receipt is a candidate payload for existing `evidence_artifacts`, with `contentHash` equal to the canonical hash of `receipt`. No persistence path, new table, lifecycle transition or automatic ingestion is added here. The outer cache/measurement envelope is not the hashed receipt; consumers must revalidate/recompute imported metrics rather than treating agent reports as trusted economics. Hashes prove content identity, not truth, approval, independence, merge eligibility or owner acceptance.

The benchmark reports full-read bytes, complete receipt bytes, targeted excerpt text bytes, request/scope sizes, startup stderr, core cold/warm latency and real CLI latency. The percentage is calculated **outside** the response so it cannot distort self-referential size measurement. Known local test cases are not unseen CS-5 qualification. The Cursor A/B result above is a negative developer-usefulness observation and does not qualify the helper for debugging context. Output-byte reduction is not measured billed-token savings, total provider cost, reduced Grok weekly allowance, owner time saved, or unchanged model-answer quality.

Roll out in this order:

1. Independently review this PR and run `npm run verify` plus the context benchmark. Preserve all existing merge and deployment decisions.
2. After the normal merge gate, CoS selects one existing **locator-only** task in an authenticated Cursor checkout. No new bot, routine, service, secret or model setting.
3. Compare the old retrieval path with this helper on the **same** task: correctness/recall, total input and output context, tool calls, time, retries and available actual provider usage. Include discovery/setup overhead. Keep unknown usage unknown. Any debugging, architecture, security or design judgment must remain on the direct path even if the locator finds matches.
4. Use the helper only where that comparison is worthwhile. Record one evidence result to PM; suppress unchanged ACK/status fan-out using existing standing orders.
5. Only after proof, consider a separately approved adapter that supplies trusted scope and persists to existing evidence infrastructure. Do not activate `software_context_shunt`, add qualified executor mappings, deploy globally or introduce bulk-reader model routing based on this smoke benchmark.

Rollback for the local pilot is simply to stop invoking the CLI and clear any in-process instance; nothing has intercepted normal reads or migrated state. CoS/PM roles, Fable/Sol strategic-only planning, `grok-4.6` default implementation, active TWL work and existing PR holds remain unchanged. This feature does not enforce Grok chat discipline, monitor weekly allowance or create a live CoS-to-Codex bridge.

## Primary implementation references

- [Spotify Portal/shunt article](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90): reference-only inspiration, not an installed dependency or transferable 90% claim.
- [Node 22.14 native TypeScript](https://nodejs.org/download/release/v22.14.0/docs/api/typescript.html#type-stripping) and [Node 22.18 native TypeScript](https://nodejs.org/download/release/v22.18.0/docs/api/typescript.html#type-stripping): explicit `.ts` imports plus `allowImportingTsExtensions` under the existing `noEmit` configuration avoid adding an execution package. No model/runtime replatforming.
- [Node execFileSync](https://nodejs.org/api/child_process.html#child_processexecfilesyncfile-args-options), [TextDecoder](https://nodejs.org/api/util.html#new-textdecoderencoding-options), [Git cat-file](https://git-scm.com/docs/git-cat-file), [Git ls-tree](https://git-scm.com/docs/git-ls-tree), [Git no-lazy-fetch](https://git-scm.com/docs/git#Documentation/git.txt---no-lazy-fetch), [Zod strict objects](https://zod.dev/api#strictobject).
- [Git 2.45 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.45.0.adoc): records the introduction of `git --no-lazy-fetch`.
