# Preview synthetic prepare — native public-web researcher

Date: 2026-08-25  
Project: `qbvmtgaphvpwpwemplje` (Delegation Cloud Preview/QA only)  
Production: not touched  
OpenBot: not started

## What ran

`npx tsx scripts/preview-native-prepare.ts`

1. Upserted executor profile `delegation-cloud-public-web-researcher-v1` as `shadow` / `researcher`.
2. Built a frozen synthetic manifest for `ks-sbd-7mm` with manufacturer URL `https://www.sbdapparel.com/products/7mm-knee-sleeves`.
3. GET-only public fetch. No Gauntlet run row was written.

## Result

| Check | Result |
| --- | --- |
| Profile status | `shadow` |
| Packet schema | 0 schema failures |
| Authority incidents | 0; all-zero report |
| Primary sources accessed | 1 |
| `thickness` | supported |
| Product name identity | uncertain (page text did not contain the frozen display name; likely JS-rendered catalog copy) |
| Escalation | required — correct fail-closed behavior |

This is a successful prepare-only proof: the executor retrieved a public page, supported a scalar catalog claim from retrieved text, refused to invent identity, and asked for human/specialist continuation. It does not replace Hermes on Runs 4–9.
