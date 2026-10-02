# Release Rescue deploy target

| | |
| --- | --- |
| **Status** | Decided: Option A — Operator-only (supported internal tool; no customer URL). |
| **Applies to** | The supported Release Rescue endpoint. Under option A that is the internal workflow on an operator's own machine. A customer URL or any other host needs a new owner decision. |
| **Current runtime** | `npm run rr:local:app`, which runs `scripts/release-rescue-local-app.mjs`: `next build`, then `RELEASE_RESCUE_INTERNAL=local`, `next start --hostname 127.0.0.1 --port 3020`. Any of `VERCEL`, `VERCEL_ENV`, or `VERCEL_URL` refuses the mode. |
| **Not a decision** | Enabling Release Rescue on the existing Vercel app, widening `config/release-rescue-internal.allowlist.json`, or describing the offer as a penetration test, a compliance certification, or a security guarantee. |

The internal workflow is an operator tool on one machine. Option A keeps it that way. It is not evidence that a production host exists. `docs/P0B-RELEASE.md` and the Virtual Assistant Vercel project are not this decision.

## Options

The owner chose A. B and C stay listed as the options not taken. Moving to either is a new owner decision and reopens the gates below.

| Option | What it would mean |
| --- | --- |
| **A. Operator-only** | The supported surface stays this loopback workflow. There is no customer URL. Production, if that word is used at all, means a supported internal tool. Identity can stay the local operator file only if this option is the one chosen. |
| **B. Private host** | A single-tenant host with a network ACL and no public internet. The mode, bind, and request guard would have to be redesigned for that network. Client-supplied forwarded headers would not be the isolation control. |
| **C. Public HTTPS** | A public application with its own authentication. Largest change to the mode and the request guard. Separate from the marketing site deploy. |

## Decision

| Field | Value |
| --- | --- |
| Hosting option (A, B, or C) | A. Operator-only |
| Decided by | Bryant Thornton |
| Date | 2026-09-29 |
| Notes | D1=A: operator-only, loopback-bound, no customer URL. D2=C: identity stays the local `operators.json` and `secret.key`; no identity provider. D3=A: the two automated secrets checks plus a reviewer's reading of the other 30; no model provider is authorized. D4=A: the 48 claim-guard residuals recorded in `src/lib/__tests__/release-rescue-claim-guard-residuals.ts` at this decision stay recorded, and none is closed; marketing must not say the guard is complete. Source: CoS owner packet `2026-09-29-t1723u-rr-d1-d4-decision.md`. |

This records the owner's decision. It enables no host and does not change the mode, the `127.0.0.1` bind, the request guard, the `VERCEL` refusal, or the allowlist.

## Gates before any production claim

Rows marked decided hold for the operator-only endpoint only. Open rows are not decided by this packet.

| Gate | State |
| --- | --- |
| **G-01** Data plane | Accepted for operator-only: the local directory (`.release-rescue-local/` or `RELEASE_RESCUE_LOCAL_DIR`) remains the store. The internal modules do not open a hosted database client, and this decision opens none. The `vercel.json` cron calls `/api/internal/release-rescue/retention-sweep`, the hosted product's sweep through the Supabase admin client. The operator-only store does not use it: the local workflow applies retention to its own store when its pages load, before an export, and on `npm run rr:local -- purge`. Which governed store a hosted endpoint would write stays open. |
| **G-02** Identity | Decided (D2=C): sign-in stays the local `operators.json` and `secret.key`. No identity provider is added. Option A is the only hosting option that keeps them. |
| **G-03** Host | Decided (D1=A): operator-only, bound to `127.0.0.1`. No customer URL, and no host is enabled. |
| **G-04** Rubric scope | Decided (D3=A): two automated checks, both secrets checks, plus a reviewer's reading of the other 30. No model provider is authorized. This does not activate payment. |
| **G-07** Claim language | Decided (D4=A): the 48 recorded claim-guard residuals stay, and none is closed. Marketing must not say the guard is complete. |
| **G-08** Gzip residuals | Open. Whether to tighten the recorded ratio residuals: gzip framing after the data, and deflate data that decodes to nothing. The caps still hold, and `docs/RELEASE-RESCUE-INTERNAL.md` states their bounds. |
| **G-10** Allowlist | Open. How a shared production target list is governed. The local tool reads the working tree. |
| **G-11** Non-loopback | Covered by option A: the endpoint stays loopback-bound. `rr:local:app` starts through `scripts/release-rescue-local-app.mjs`, which fixes the bind at `127.0.0.1:3020` in code, so the npm script is no longer the only control. The launcher refuses every argument except `--dry-run`, and refuses to start when `HOST` or `HOSTNAME` names an address that is not loopback or `PORT` is not 3020. It checks only what it is asked to run: it does not read the listen address after the bind, and a `next start` run by hand does not go through it. Client headers are defence in depth, not isolation. |
| **G-12** `pg_net` | Open. Whether a production database must provide `pg_net`. The CI proof image does not, and skips that one non-Release-Rescue migration. The operator-only endpoint does not use `pg_net`. |

`VISION.md` § Scope and non-goals admits the review as prepare-only, read-only, with deterministic severity and a named human signature. Choosing a host does not by itself authorize payment, production access, or a change to those terms.
