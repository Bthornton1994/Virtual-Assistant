# Release Rescue deploy target

| | |
| --- | --- |
| **Status** | Undecided. This packet does not select a host. |
| **Applies to** | A future production surface for Release Rescue. The internal workflow stays local. |
| **Current runtime** | `RELEASE_RESCUE_INTERNAL=local`, `next start --hostname 127.0.0.1 --port 3020`. Any of `VERCEL`, `VERCEL_ENV`, or `VERCEL_URL` refuses the mode. |
| **Not a decision** | Enabling Release Rescue on the existing Vercel app, widening `config/release-rescue-internal.allowlist.json`, or describing the offer as a penetration test, a compliance certification, or a security guarantee. |

The internal workflow is an operator tool on one machine. It is not evidence that a production host exists. `docs/P0B-RELEASE.md` and the Virtual Assistant Vercel project are not this decision.

## Options

Leave the decision row blank. The notes are consequences, not a recommendation.

| Option | What it would mean |
| --- | --- |
| **A. Operator-only** | The supported surface stays this loopback workflow. There is no customer URL. Production, if that word is used at all, means a supported internal tool. Identity can stay the local operator file only if this option is the one chosen. |
| **B. Private host** | A single-tenant host with a network ACL and no public internet. The mode, bind, and request guard would have to be redesigned for that network. Client-supplied forwarded headers would not be the isolation control. |
| **C. Public HTTPS** | A public application with its own authentication. Largest change to the mode and the request guard. Separate from the marketing site deploy. |

## Decision

| Field | Value |
| --- | --- |
| Hosting option (A, B, or C) | |
| Decided by | |
| Date | |
| Notes | |

Filling that table in is an owner action. This change does not fill it in.

## Still required before any production claim

These stay open. This packet does not decide them.

| Gate | Decision still required |
| --- | --- |
| **G-01** Data plane | Which governed store production runs write, and whether the local directory remains an operator tool. The internal modules do not open a hosted database client. |
| **G-02** Identity | Which identity production sign-in uses. Local `operators.json` and `secret.key` are not that identity. Option A above is the only hosting option that keeps them. |
| **G-03** Host | The blank row in the decision table. |
| **G-04** Rubric scope | Whether paid use can stay at two automated checks plus a human reading, or needs more deterministic checks, or an authorized model provider. No provider is authorized now. |
| **G-07** Claim language | Whether the recorded claim-guard residuals stay, or which named misses to close before any paid marketing. Marketing must not say the guard is complete. |
| **G-10** Allowlist | How a shared production target list is governed. The local tool reads the working tree. |
| **G-11** Non-loopback | Covered by the hosting row. A host that is not loopback-bound cannot treat client headers as isolation. |
| **G-12** `pg_net` | Whether a production database must provide `pg_net`. The CI proof image does not, and skips that one non-Release-Rescue migration. |

`VISION.md` § Scope and non-goals admits the review as prepare-only, read-only, with deterministic severity and a named human signature. Choosing a host does not by itself authorize payment, production access, or a change to those terms.
