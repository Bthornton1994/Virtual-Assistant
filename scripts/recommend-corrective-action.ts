/**
 * Recommend Gauntlet classification/retry from a frozen packet.
 * Does not write the Gauntlet, Loadout, or a receipt.
 *
 *   npx tsx scripts/recommend-corrective-action.ts --packet packet.json [--records records.json] [--review review.json]
 */
import { readFileSync } from "node:fs";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import {
  classifyCatalogDecisions,
  recommendCorrectiveAction,
  type CatalogProductRecord,
} from "../src/lib/work-cell-operator";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

const packetPath = arg("--packet");
if (!packetPath) {
  console.error("usage: npx tsx scripts/recommend-corrective-action.ts --packet packet.json [--records records.json] [--review review.json]");
  process.exit(2);
}

const packet = JSON.parse(readFileSync(packetPath, "utf8")) as CatalogEvidencePacketV1;
const recordsPath = arg("--records");
const reviewPath = arg("--review");
const report = classifyCatalogDecisions({
  packet,
  frozenRecords: recordsPath
    ? (JSON.parse(readFileSync(recordsPath, "utf8")) as Record<string, CatalogProductRecord>)
    : undefined,
  review: reviewPath ? (JSON.parse(readFileSync(reviewPath, "utf8")) as CatalogEvidenceReviewV1) : undefined,
});
const action = recommendCorrectiveAction({ packet, report });

console.log(action.reason);
console.log(`classification: ${action.classification}`);
console.log(`retryDecision: ${action.retryDecision}`);
console.log(`hermesRetryUseful: ${action.hermesRetryUseful}`);
console.log(`loadoutWrite: ${action.loadoutWrite}`);
if (action.droppedProductIds.length) console.log(`drop: ${action.droppedProductIds.join(", ")}`);
if (action.nextProductIds.length) console.log(`later freeze: ${action.nextProductIds.join(", ")}`);
