# Evaluation Reference: Loadout Catalog Integrity v1 Shadow Batch

Status: **Evaluator-only reference. Do not provide to the Grok worker before its shadow run.**

Date observed: 2026-08-22

Purpose: establish a human-reviewed primary-source reference for scoring the first five-product Grok shadow run. This file is not the Loadout evidence ledger and does not itself authorize any catalog change.

## Evaluation doctrine

The shadow worker is being evaluated on whether it:

- finds the exact model rather than a nearby product;
- prefers primary manufacturer/federation sources;
- distinguishes evidence from inference;
- detects conflicts with repository values;
- understands when an `approval` label is semantically wrong for the equipment type;
- escalates ambiguity rather than manufacturing certainty.

A candidate may be correct even when it recommends `insufficient_evidence` or `conflict`. False certainty is worse than an explicit unknown.

---

## 1. `ks-sbd-7mm` — SBD 7mm Knee Sleeves

### Repository baseline

- price: `$99.99`
- thickness: `7mm`
- material: `7mm high-grade neoprene, reinforced seams`
- approvals: `IPF`, `USAPL`, `CPU`

### Primary sources observed

Manufacturer, SBD Apparel USA:

`https://us.sbdapparel.com/products/7mm-knee-sleeves`

Observed facts:

- current US price: `$110.00`
- product name: `Knee Sleeves`
- 7mm high-grade neoprene
- reinforced seam construction
- 30cm length
- IPF approved
- manufacturer describes the product as USAPL/USPA compliant and IWF compliant

Federation, IPF current approved-list page:

`https://www.powerlifting.sport/rules/codes/info/approved-list`

The current linked list is valid through 31 December 2026 and lists `SBD Knee Sleeves` under IPF IDs `242`, `243`, and `248`.

### Expected shadow conclusions

- `price`: **conflict**. Current official US manufacturer price differs from repository estimate.
- `thicknessMm`: **eligible_for_human_verification**.
- `material`: **eligible_for_human_verification** for 7mm high-grade neoprene and reinforced seams.
- `approvals.IPF`: **eligible_for_human_verification**, assuming the repo item is intended to map to SBD's standard `Knee Sleeves` rather than the separate `Powerlifting Knee Sleeves` product.
- `approvals.USAPL`: **semantic caution**. Manufacturer says USAPL compliant; do not silently equate `compliant` with a federation-specific product approval unless Loadout defines that field semantics.
- `approvals.CPU`: **insufficient_evidence** from this source set.

### Important ambiguity

SBD now sells both standard `Knee Sleeves` and a distinct `Powerlifting Knee Sleeves` product. The repository's generic name `SBD 7mm Knee Sleeves` appears closer to the standard product based on its listed material/specification and price history, but the worker must identify that model distinction rather than assume the two are interchangeable.

---

## 2. `belt-sbd-13mm` — SBD 13mm Lever Belt

### Repository baseline

- price: `$245.00`
- thickness: `13mm`
- material: `Full-grain leather, steel lever buckle`
- approvals: `IPF`, `USAPL`, `CPU`

### Primary sources observed

Manufacturer, SBD Apparel USA:

`https://us.sbdapparel.com/products/13mm-lever-belt`

Observed facts:

- current US price: `$310.00`
- 13mm thickness
- 10cm width
- four layers of British leather and suede
- black oiled leather finish, red suede interior
- patented gliding lever
- IPF approved
- manufacturer describes the belt as USAPL and USPA compliant

Federation, IPF approved list:

`https://www.powerlifting.sport/rules/codes/info/approved-list`

Current linked list valid through 31 December 2026 includes `SBD Belts`, IPF IDs `236` and `237`.

### Expected shadow conclusions

- `price`: **conflict**. Repository value is below current official US manufacturer price.
- `thicknessMm`: **eligible_for_human_verification**.
- `material`: **conflict/partial support**. The source supports leather, suede, and a lever, but does not support the repository's exact `full-grain leather, steel lever buckle` wording as written.
- `approvals.IPF`: **eligible_for_human_verification**.
- `approvals.USAPL`: **semantic caution**, manufacturer says compliant.
- `approvals.CPU`: **insufficient_evidence** from the observed primary sources.

---

## 3. `ks-a7-conical` — A7 Conical Knee Sleeves 7mm

### Repository baseline

- price: `$79.99`
- thickness: `7mm`
- material: `7mm conical neoprene, anti-slip lining`
- approvals: `IPF`, `USAPL`, `USPA`

### Primary sources observed

Manufacturer, A7:

`https://a7.co/products/stealth-stiff-cone-knee-sleeves-uspa-ipf-approved`

Observed facts:

- current product title: `CONE Knee Sleeves - USPA & IPF Approved - Stiff - Stealth`
- current listed price: `$85.95`
- 7mm high-quality neoprene
- tapered/CONE design
- reinforced double rear seams
- manufacturer says IPF and USPA approved and USAPL technical-spec compliant

Federation, IPF approved list:

`https://www.powerlifting.sport/rules/codes/info/approved-list`

Current linked list valid through 31 December 2026 identifies:

- `A7 CONE Knee Sleeves – Regular`, IPF ID `195`
- `A7 CONE Knee Sleeves – Stiff`, IPF ID `196`

### Expected shadow conclusions

- `price`: **conflict**.
- `thicknessMm`: **eligible_for_human_verification**.
- `material`: **partial support**. 7mm neoprene and tapered/CONE construction are supported; `anti-slip lining` was not established in the observed primary product page.
- `approvals.IPF`: **eligible_for_human_verification**, with an exact Stiff CONE entry in the federation list.
- `approvals.USPA`: **candidate evidence exists from manufacturer**, but a federation-side current source should be preferred before Loadout treats this as a fully verified federation approval claim.
- `approvals.USAPL`: **semantic caution**, manufacturer says the product meets USAPL technical specifications and is allowed, not necessarily that USAPL maintains a product-specific approval status with the same semantics as IPF.

---

## 4. `shoe-nike-romaleos` — Nike Romaleos 4

### Repository baseline

- price: `$200.00`
- material: `Flyknit upper, dual strap, TPU heel`
- approvals: `IPF`, `USAPL`, `USPA`

### Primary sources observed

Manufacturer, Nike:

`https://www.nike.com/t/romaleos-4-weightlifting-shoes-r7zff9/CD3463-003`

Observed facts:

- current US price: `$200`
- product: `Nike Romaleos 4`
- supportive/rigid midsole with heel lift
- wide flat outsole/heel
- wide adjustable straps
- rubber tread

Federation, IPF Technical Rules:

`https://www.powerlifting.sport/rules/codes/info/technical-rules`

Current 2026 rules regulate footwear by category/construction: indoor sports shoes, powerlifting/weightlifting boots or deadlift slippers; underside height and flatness limits apply. Shoes are not handled like supportive equipment on the IPF manufacturer approved list.

USA Powerlifting 2026 rulebook similarly defines allowable footwear by construction/specification rather than a brand approval claim.

### Expected shadow conclusions

- `price`: **eligible_for_human_verification**; current repository value matches current Nike US listing.
- `material`: **conflict/insufficient evidence**. The official Nike page observed does not establish the repository's `Flyknit upper` or `TPU heel` wording. It does support adjustable/wide straps, rigid midsole/heel lift, wide heel and rubber tread.
- `approvals.IPF`: **data-model conflict**. `IPF approved` is not the right semantics for ordinary footwear under the current IPF rules. The relevant question is rule compliance, not presence on the supportive-equipment approved list.
- `approvals.USAPL`: **data-model conflict** for the same reason; current rules establish footwear specifications rather than an equivalent product-specific approval status.
- `approvals.USPA`: **insufficient_evidence** in this reference set.

### Important architecture finding

Loadout's current single `approvals[]` field conflates at least two concepts:

1. product/model appears on a federation approved-equipment list; and
2. product appears to comply with general equipment rules for a category that is not individually listed.

A trustworthy catalog should eventually model these separately rather than forcing both into the same badge.

---

## 5. `belt-inzer-forever` — Inzer Forever Lever Belt 10mm

### Repository baseline

- price: `$120.00`
- thickness: `10mm`
- material: `Premium leather, Forever Lever`
- approvals: `IPF`, `USAPL`, `USPA`, `WRPF`

### Primary sources observed

Manufacturer, Inzer Advance Designs:

`https://inzer.com/collections/power-belts/products/forever-lever-lifting-belt%E2%84%A2-10mm`

Observed facts:

- exact product: `Forever Lever Belt™ 10MM`
- current US price: `$129.95`
- 10mm thickness
- patented lever
- one solid thickness of leather with an integrated reinforced-leather component
- four rows of lock-stitched high-density nylon
- fine suede finish/non-slip surface
- competition-legal width is referenced by the manufacturer

Federation, IPF approved list:

`https://www.powerlifting.sport/rules/codes/info/approved-list`

Current linked list valid through 31 December 2026 includes `INZER Lever Belts`, IPF ID `272`.

### Expected shadow conclusions

- `price`: **conflict**.
- `thicknessMm`: **eligible_for_human_verification**.
- `material`: **eligible/partial**. Leather and lever construction are supported; a revised evidence-backed wording should track the source instead of preserving generic marketing shorthand.
- `approvals.IPF`: **eligible_for_human_verification**; federation list identifies INZER Lever Belts.
- `approvals.USAPL`: **insufficient_evidence** in this reference set.
- `approvals.USPA`: **insufficient_evidence** in this reference set.
- `approvals.WRPF`: **insufficient_evidence** in this reference set.

---

# Expected evaluator behavior

A strong Grok shadow run should not merely maximize `eligible_for_human_verification` records. It should uncover the same structural issues as this reference set, especially:

- SBD standard vs Powerlifting Knee Sleeves are distinct products;
- several repository prices are estimates/stale versus current manufacturer prices;
- repository material strings sometimes contain details not supported by current primary pages;
- A7 Stiff CONE has an exact IPF listing;
- Nike footwear demonstrates that `approved` and `rule-compliant` are not interchangeable;
- Inzer's IPF evidence exists at the generic `INZER Lever Belts` family level;
- unsupported CPU/USPA/WRPF/USAPL badges must not be retained merely because the existing catalog contains them.

## Scoring categories

For the first shadow run, score:

- **Primary-source precision**: correct exact source / all candidate sources.
- **Exact-model precision**: no wrong variant/model accepted.
- **Conflict detection**: known repository/source conflicts surfaced.
- **Unsupported-certainty errors**: count; target is zero.
- **Correct escalations**: ambiguities appropriately marked instead of guessed.
- **Semantic insight**: whether the worker catches approval-vs-compliance distinctions.
- **Review burden**: actual human minutes required to validate/correct the report.

The reference is intentionally narrower than the full catalog. Its purpose is to test the process before paying to research all 271 tracked claims.
