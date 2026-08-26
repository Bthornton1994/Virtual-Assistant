/**
 * Emit CS-4 ledger observations from a frozen packet+review. Does not persist.
 *
 *   npx tsx scripts/work-cell-ledger-observations.ts --packet packet.json --review review.json
 */
import { readFileSync } from "node:fs";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import { buildCapabilityPerformanceLedger } from "../src/lib/capability-performance-ledger";
import { workCellLedgerObservations } from "../src/lib/work-cell-ledger";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

const packetPath = arg("--packet");
const reviewPath = arg("--review");
if (!packetPath || !reviewPath) {
  console.error("usage: npx tsx scripts/work-cell-ledger-observations.ts --packet packet.json --review review.json");
  process.exit(2);
}

const packet = JSON.parse(readFileSync(packetPath, "utf8")) as CatalogEvidencePacketV1;
const review = JSON.parse(readFileSync(reviewPath, "utf8")) as CatalogEvidenceReviewV1;
const observations = workCellLedgerObservations({
  packet,
  review,
  expectedProductIds: packet.products.map((product) => product.productId),
  recordedAt: review.reviewedAt,
});
const ledger = buildCapabilityPerformanceLedger(observations);
if (!ledger.ok) {
  console.error(ledger.failures.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ observationCount: observations.length, rows: ledger.rows }, null, 2));
