/**
 * Build a later freeze file from exact-identity SKUs in a packet.
 * Drops identity mismatches. Does not start a run, write Loadout, or retry Hermes.
 *
 *   npx tsx scripts/next-freeze-from-packet.ts --packet packet.json --out later-freeze.json --loadout ../Loadout
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import { loadLoadoutProductsFromSource } from "../src/lib/loadout-catalog-loader";
import { correctiveActionFromPacket, freezeRecordsForNextBatch } from "../src/lib/work-cell-operator";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

function main() {
  const packetPath = arg("--packet");
  const out = arg("--out") || "later-freeze.json";
  const loadoutRoot = arg("--loadout") || resolve("..", "Loadout");
  if (!packetPath) {
    console.error("usage: npx tsx scripts/next-freeze-from-packet.ts --packet packet.json --out later-freeze.json [--loadout path] [--review review.json]");
    process.exit(2);
  }

  const packet = JSON.parse(readFileSync(packetPath, "utf8")) as CatalogEvidencePacketV1;
  const reviewPath = arg("--review");
  const action = correctiveActionFromPacket({
    packet,
    review: reviewPath ? (JSON.parse(readFileSync(reviewPath, "utf8")) as CatalogEvidenceReviewV1) : undefined,
  });
  if (!action.nextProductIds.length) {
    console.error(action.reason);
    process.exit(1);
  }

  const sourcePath = resolve(loadoutRoot, "src/data/products.ts");
  const catalog = loadLoadoutProductsFromSource(readFileSync(sourcePath, "utf8"));
  const { records, missing } = freezeRecordsForNextBatch(catalog, action);
  if (missing.length) {
    console.error(`Missing Loadout product IDs: ${missing.join(", ")}`);
    process.exit(1);
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`);
  console.log(JSON.stringify({
    out,
    classification: action.classification,
    retryDecision: action.retryDecision,
    droppedProductIds: action.droppedProductIds,
    nextProductIds: action.nextProductIds,
    loadoutWrite: action.loadoutWrite,
  }, null, 2));
}

main();
