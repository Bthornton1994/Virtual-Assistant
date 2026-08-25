/**
 * Classify catalog-side decisions from a frozen packet (and optional review).
 * Does not ingest, write Loadout, or retry Hermes.
 *
 *   npx tsx scripts/classify-catalog-decisions.ts --packet packet.json [--records records.json] [--review review.json]
 */
import { readFileSync } from "node:fs";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import {
  classifyCatalogDecisions,
  type CatalogProductRecord,
} from "../src/lib/work-cell-operator";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

const packetPath = arg("--packet");
if (!packetPath) {
  console.error("usage: npx tsx scripts/classify-catalog-decisions.ts --packet packet.json [--records records.json] [--review review.json]");
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

console.log(report.summary);
console.log(`hermesRetryUseful: ${report.hermesRetryUseful}`);
console.log(`loadoutWrite: ${report.loadoutWrite}`);
console.log(`decisions: ${report.decisions.length}`);
for (const decision of report.decisions) {
  console.log(`- [${decision.kind}/${decision.action}] ${decision.summary}`);
}
