# Grok Bot supplier-sourcing runbook

Status: **QA-only, prepare-only, and draft-only until a human-approved delivery connector is qualified.**

This runbook is the operator handoff for the Grounded supplier-sourcing workstream. Grok Bot is the replaceable research and drafting executor. Delegation Cloud owns the frozen brief, evidence artifacts, hashes, validation, run lifecycle, approvals, and receipts.

## 1. Start from the Delegation Cloud run

1. Open the Grounded Supplier Sourcing workstream and the active run.
2. Freeze the bounded product brief from the Grounded repository SHA shown in the run.
3. Copy the exact prompt generated from the persisted manifest.
4. Do not add products, alter product identity, or replace the executor key after freezing.

The frozen product fields are authoritative for the run:

- product ID and name;
- brand, model, and variant;
- category;
- desired fulfillment modes;
- kit-assembly requirement;
- repository and commit SHA.

## 2. Grok Bot research pass

Give Grok Bot only the frozen prompt and public-source research task. The prepare pass may:

- research manufacturer and authorized-distributor pages;
- research public supplier-direct, dropship, partner-fulfillment, and kit-assembly programs;
- collect public shipping, returns, availability, compliance, seller-of-record, and commercial-term evidence;
- identify exact, partial, mismatched, not-found, disqualified, and needs-review candidates;
- prepare a draft inquiry with source facts.

The prepare pass must not:

- send, schedule, or post a supplier message;
- sign up for a supplier program or create an account;
- claim that a supplier accepted a relationship;
- claim live inventory from an unbounded or expired source;
- buy or hold anything;
- change Grounded, Delegation Cloud, a repository, a catalog, a listing, a price, or a permission;
- create a Skill, Routine, automation, or new credential.

Return one JSON object conforming to supplier-sourcing-packet/v1. Preserve unresolved facts as unresolved. Paste the exact raw output into the run; prose around the JSON is rejected and retained as a failed artifact.

## 3. Independent review pass

Use a separate Grok Bot context or independent reviewer for supplier-sourcing-review/v1. It must receive the exact packet hash and challenge:

- identity and product-variant fit;
- supplier-direct and partner-fulfilled evidence;
- kit assembly;
- compliance and safety evidence;
- current availability and validity windows;
- shipping, returns, and seller of record;
- commercial terms and hidden fees;
- every proposed outreach fact.

An accepted review must cite independent public sources. It does not make a supplier verified or create a commercial relationship.

## 4. Deterministic gate and receipt

Run deterministic validation only after both typed artifacts are accepted. The gate checks:

- frozen input, packet, and review hashes;
- exact product identity scope;
- candidate coverage and duplicate IDs;
- public HTTPS source provenance;
- candidate-local artifact binding;
- expired evidence;
- current availability validity;
- no owned inventory;
- no Grounded seller-of-record implication;
- no sent-message claim;
- zero authority incidents.

A passing gate means the contract is internally consistent. It does not mean Grounded may advertise or sell a product. An operations manager must issue the normal Outcome Receipt, and any failure or unresolved issue remains visible.

## 5. Communication handoff

After a passing Outcome Receipt:

1. Review the exact draft, destination, and cited source facts in Delegation Cloud.
2. If appropriate, record one immutable approval for that exact draft.
3. Do not edit the recipient, body, facts, or expiry after approval.
4. Wait for a separately qualified delivery connector.

The current release stores approvals but has no qualified delivery connector. It therefore cannot record a sent result or transmit a message. A future connector must be separately registered, scoped to supplier_outreach, bound to the approval hash, and qualified with a provider delivery ID and sender identity.

A supplier reply is new evidence. It must be captured, hash-bound, and reviewed. A reply alone never marks a supplier verified.

## 6. Grounded catalog gate

Only a human-approved supplier/compliance record may move into Grounded catalog metadata. Before any verified-for-sale decision, review:

- exact identity and variant;
- compliance and safety documentation;
- supplier relationship and seller of record;
- supplier-direct or partner fulfillment;
- current availability and inventory evidence;
- shipping and returns responsibility;
- kit assembly scope and economics;
- expected customer disclosures.

No record is production-ready merely because Grok found a plausible supplier, produced a clean JSON packet, or drafted a message.
