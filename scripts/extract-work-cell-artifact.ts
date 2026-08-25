/**
 * Strip executor chatter, validate typed work-cell JSON, write a paste file.
 * Does not ingest, does not call Hermes, does not change frozen executor keys.
 *
 *   npx tsx scripts/extract-work-cell-artifact.ts raw.txt --run-id <uuid> --out packet.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "../src/lib/capability-registry";
import { hashCatalogEvidencePacket, sha256Hex } from "../src/lib/catalog-evidence-hash";
import type { CatalogEvidencePacketV1 } from "../src/lib/catalog-evidence-packet";
import type { CatalogEvidenceReviewV1 } from "../src/lib/catalog-evidence-review";
import {
  collectPacketClaims,
  validateCatalogEvidencePacket,
  validateCatalogEvidenceReview,
} from "../src/lib/catalog-evidence-validator";
import { parseRawExecutorJson } from "../src/lib/work-cell";

const RUN5_PRODUCT_IDS = ["ks-sbd-5mm", "ww-a7-coneface", "shoe-do-win", "suit-inzer-champion", "belt-averte"];

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{"schemaVersion"');
  if (start === -1) throw new Error("No schemaVersion JSON object found. Paste failed: chatter-only input.");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  throw new Error("JSON object was truncated before the closing brace.");
}

const inputPath = process.argv[2];
if (!inputPath || inputPath.startsWith("--")) {
  console.error("usage: npx tsx scripts/extract-work-cell-artifact.ts <raw-file> --run-id <uuid> [--out file]");
  process.exit(2);
}

const runId = arg("--run-id");
const out = arg("--out") || "work-cell-artifact.json";
const raw = readFileSync(inputPath, "utf8");
const json = extractJsonObject(raw);
const parsed = parseRawExecutorJson(json);
if (!parsed.ok) {
  console.error(parsed.error);
  process.exit(1);
}

const value = parsed.value as { schemaVersion?: string };
writeFileSync(out, `${json}\n`);

if (value.schemaVersion === "catalog-evidence-packet/v1") {
  const packet = parsed.value as CatalogEvidencePacketV1;
  const validation = validateCatalogEvidencePacket(packet, {
    expectedProductIds: RUN5_PRODUCT_IDS,
    expectedRunId: runId || packet.runId,
    expectedExecutorKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare,
    expectedMarket: "US",
  });
  const hash = validation.hardGatePass ? hashCatalogEvidencePacket(packet) : null;
  console.log(JSON.stringify({ kind: "packet", out, hardGatePass: validation.hardGatePass, hardFailures: validation.hardFailures, warnings: validation.warnings, contentHash: hash }, null, 2));
  process.exit(validation.hardGatePass ? 0 : 1);
}

if (value.schemaVersion === "catalog-evidence-review/v1") {
  const review = parsed.value as CatalogEvidenceReviewV1;
  const packetPath = arg("--packet");
  if (!packetPath) {
    console.error("Reviews require --packet <validated-packet.json> so the hash bind can be checked.");
    process.exit(2);
  }
  const packet = JSON.parse(readFileSync(packetPath, "utf8")) as CatalogEvidencePacketV1;
  const expectedPacketHash = hashCatalogEvidencePacket(packet);
  const validation = validateCatalogEvidenceReview(review, {
    expectedPacketHash,
    claims: collectPacketClaims(packet),
    packetProductIds: packet.products.map((product) => product.productId),
    expectedRunId: runId || packet.runId,
    expectedReviewerKey: FROZEN_WORK_CELL_EXECUTOR_KEYS.review,
  });
  console.log(JSON.stringify({ kind: "review", out, hardGatePass: validation.hardGatePass, hardFailures: validation.hardFailures, reviewHash: sha256Hex(review), expectedPacketHash }, null, 2));
  process.exit(validation.hardGatePass ? 0 : 1);
}

console.error(`Unsupported schemaVersion "${String(value.schemaVersion)}".`);
process.exit(1);
