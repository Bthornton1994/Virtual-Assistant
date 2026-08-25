# Work-cell operator toolchain

Status: **Local operator automation. Does not replace Hermes/Grok. Does not route by capability. Does not write Loadout.**

These scripts cut owner minutes on freeze, receipt drafting, and catalog-side decisions after a packet exists. They do not ingest, issue receipts, or write Loadout. Artifact paste extract already lives on main as `scripts/extract-work-cell-artifact.ts`.

## Freeze input records from Loadout

Reads `Loadout/src/data/products.ts` in-process (type-only import stripped). Loadout does not need `tsx`.

```text
npx tsx scripts/freeze-from-loadout.ts --ids ks-sbd-5mm,ww-a7-coneface,shoe-do-win,suit-inzer-champion,belt-averte --out frozen-input-records.json --loadout ../Loadout
```

Paste the file into Work Cell section 0.

## Extract Hermes/Grok paste

Use the existing extractor (validates against frozen Run 4–9 keys; does not repair values):

```text
npx tsx scripts/extract-work-cell-artifact.ts hermes-raw.txt --run-id <run-uuid> --out packet.json
```

## Draft the Outcome Receipt

```text
npx tsx scripts/draft-work-cell-receipt.ts --packet packet.json --review review.json
```

Uses the deterministic validator and work-cell gate. A rejected claim drafts a **failed** receipt.

## Classify catalog decisions (do not loop Hermes)

When prepare/review already exist, classify whether the remaining work is a catalog identity/price decision. An identity mismatch on a frozen SKU is not a Hermes retry. The Work Cell page derives the same headline after a packet is frozen (not stored, not a catalog write).

```text
npx tsx scripts/classify-catalog-decisions.ts --packet packet.json --records frozen-input-records.json --review review.json
```

## Recommend Gauntlet corrective action

Does not write the Gauntlet row. Identity mismatch is `source_ambiguity` / `escalate_human`, never `retry_same_executor`.

```text
npx tsx scripts/recommend-corrective-action.ts --packet packet.json --records frozen-input-records.json --review review.json
```

The Work Cell page shows the same recommendation after a packet is frozen.

Frozen executor keys remain `hermes-loadout-researcher-v1` / `grok-loadout-reviewer-v1` / `catalog-evidence-validator-v1`.
