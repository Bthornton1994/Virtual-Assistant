/**
 * Draft Outcome Receipt fields from frozen packet + review JSON.
 * Does not ingest, write catalogs, or issue a receipt.
 *
 *   npx tsx scripts/draft-work-cell-receipt.ts --packet packet.json --review review.json
 */
import { readFileSync } from "node:fs";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import { draftWorkCellReceipt } from "../src/lib/work-cell-operator";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

const packetPath = arg("--packet");
const reviewPath = arg("--review");
if (!packetPath || !reviewPath) {
  console.error("usage: npx tsx scripts/draft-work-cell-receipt.ts --packet packet.json --review review.json");
  process.exit(2);
}

const packet = JSON.parse(readFileSync(packetPath, "utf8")) as CatalogEvidencePacketV1;
const review = JSON.parse(readFileSync(reviewPath, "utf8")) as CatalogEvidenceReviewV1;
const draft = draftWorkCellReceipt({
  packet,
  review,
  expectedProductIds: packet.products.map((product) => product.productId),
});

console.log(`verificationStatus: ${draft.verificationStatus}`);
console.log(`definitionOfDoneMet: ${draft.definitionOfDoneMet}`);
console.log(`packetHash: ${draft.packetHash}`);
console.log("");
console.log("Receipt summary");
console.log(draft.summary);
console.log("");
console.log("Verification notes");
console.log(draft.verificationNotes);
console.log("");
console.log("Actions taken");
for (const line of draft.actionsTaken) console.log(line);
console.log("");
console.log("Exceptions");
for (const line of draft.exceptions) console.log(line);
console.log("");
console.log("Unresolved decisions");
for (const line of draft.unresolvedDecisions) console.log(line);
