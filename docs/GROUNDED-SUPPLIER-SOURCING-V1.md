# Grounded supplier sourcing v1

Status: **implemented as a shadow/prepare-only contract; no supplier relationship or catalog write exists.**

## Purpose

Grounded needs supplier-direct or partner-fulfilled offers before it can advertise any product. The current Grounded catalog is a fail-closed prototype with no production-ready SKUs. This workstream prepares and verifies supplier candidates without turning research into a supplier claim, inventory claim, catalog write, or commercial launch.

The system follows:

\`frozen brief → Grok prepare → independent review → deterministic validation → human decision → approved communication → reviewed supplier evidence → Grounded catalog gate\`

Delegation Cloud owns the run, evidence artifacts, hashes, authority checks, lifecycle, and receipt. Grok is an interchangeable execution implementation, not the authority, router, source of truth, or seller.

## Frozen input

Each attempt freezes:

- the Grounded product ID, exact product identity, brand, model, and variant;
- desired market and category;
- desired fulfillment modes: \`supplier-direct\` and/or \`partner-fulfilled\`;
- whether kit assembly is required;
- known public URLs and constraints;
- Grounded repository and commit SHA when catalog identity is involved;
- prepare and review executor keys;
- a deterministic SHA-256 \`inputHash\`.

The input is stored as an immutable \`supplier-sourcing-input/v1\` evidence artifact before research begins.

## Grok prepare contract

Grok may:

- read the frozen brief;
- research public manufacturer, distributor, fulfillment, shipping, returns, compliance, and program sources;
- identify candidate supplier entities;
- prepare source-linked candidate classifications;
- draft a supplier inquiry using only cited facts.

Grok may not:

- send or schedule messages;
- create a supplier relationship;
- claim a supplier accepted a partnership;
- claim live inventory from an unverified page;
- purchase samples or products;
- modify Grounded or Delegation Cloud source/data;
- publish or promote products;
- create routines, Skills, accounts, or permissions.

Every candidate remains \`unverified\`. A supported finding means only that the cited source supports the stated fact; it does not mean Grounded has accepted the supplier.

## Evidence contract

A candidate must preserve:

- supplier identity and identity status;
- product identity fit;
- supplier-direct and partner-fulfilled findings;
- kit-assembly finding;
- inventory model;
- seller of record;
- shipping, returns, availability, and compliance findings;
- commercial-term findings;
- public contact channel provenance;
- raw source artifact hashes and access times;
- escalation state;
- outreach draft with source facts and \`sent: false\`.

The deterministic validator rejects:

- malformed or non-HTTPS source URLs;
- packet scope or hash drift;
- non-zero authority reports;
- owned-inventory proposals;
- Grounded seller-of-record implication;
- sent-message claims;
- unsupported “supported” findings without source URLs and artifact hashes;
- missing candidate coverage;
- a review that is not hash-bound to the exact packet.

## Communication boundary

Supplier communication is a separate external action. A prepared draft can be shown to an operator, but transmission requires a distinct, human-approved action that records:

- exact recipient/channel;
- exact message body;
- facts and source artifacts used;
- approver and approval time;
- sender identity;
- delivery result;
- any supplier reply as a new immutable evidence artifact.

No reply or absence of reply can mark a supplier verified by itself. A human must review the relationship, commercial terms, compliance, fulfillment, seller-of-record, availability, shipping, returns, and economics before any Grounded catalog metadata changes.

## Qualification path

1. Install the QA-only profile fixture in Delegation Cloud QA.
2. Freeze a small Grounded batch.
3. Run Grok once in shadow mode, preserving raw output.
4. Run a separate independent review.
5. Run deterministic validation.
6. Issue a passing or failed Outcome Receipt based on the contract.
7. Measure source precision, false positives, escalations, human minutes, AI/tool cost, and corrections.
8. Repeat before any Skill or routine is considered.
9. Keep all supplier-contact and catalog changes human-approved.

A successful contract test or a passing research run does not make any Grounded SKU production-ready.
