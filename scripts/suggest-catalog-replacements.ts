/**
 * Suggest same-brand, same-category Loadout IDs for identity-mismatch SKUs.
 * Does not write Loadout or pick a replacement.
 *
 *   npx tsx scripts/suggest-catalog-replacements.ts --packet packet.json --loadout ../Loadout
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import { loadLoadoutProductsFromSource } from "../src/lib/loadout-catalog-loader";
import { correctiveActionFromPacket, suggestCatalogReplacements } from "../src/lib/work-cell-operator";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

const packetPath = arg("--packet");
const loadoutRoot = arg("--loadout") || resolve("..", "Loadout");
if (!packetPath) {
  console.error("usage: npx tsx scripts/suggest-catalog-replacements.ts --packet packet.json [--loadout path] [--review review.json]");
  process.exit(2);
}

const packet = JSON.parse(readFileSync(packetPath, "utf8")) as CatalogEvidencePacketV1;
const reviewPath = arg("--review");
const catalog = loadLoadoutProductsFromSource(readFileSync(resolve(loadoutRoot, "src/data/products.ts"), "utf8"));
const frozenRecords = Object.fromEntries(catalog.map((product) => [product.id, product]));
const action = correctiveActionFromPacket({
  packet,
  review: reviewPath ? (JSON.parse(readFileSync(reviewPath, "utf8")) as CatalogEvidenceReviewV1) : undefined,
  frozenRecords,
});
const suggestions = suggestCatalogReplacements({
  droppedProductIds: action.droppedProductIds,
  frozenRecords,
  catalog,
});

console.log(action.reason);
console.log(`loadoutWrite: false`);
if (!suggestions.length) {
  console.log("No identity-mismatch SKUs to replace.");
  process.exit(0);
}
for (const suggestion of suggestions) {
  const ids = suggestion.candidates.map((item) => item.id);
  console.log(
    `${suggestion.mismatchedProductId} (${suggestion.brand} / ${suggestion.category}): ${ids.length ? ids.join(", ") : "no same-brand same-category SKU in Loadout"}`,
  );
}
