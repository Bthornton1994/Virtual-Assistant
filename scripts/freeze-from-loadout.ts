/**
 * Build Work Cell section-0 frozen input records from the Loadout catalog.
 * Does not write Loadout, Supabase, or Production.
 *
 *   npx tsx scripts/freeze-from-loadout.ts --ids ks-sbd-5mm,ww-a7-coneface --out records.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadLoadoutProductsFromSource } from "../src/lib/loadout-catalog-loader";
import { buildFrozenInputRecords } from "../src/lib/work-cell-operator";

function arg(name: string) {
  const at = process.argv.indexOf(name);
  return at === -1 ? "" : String(process.argv[at + 1] || "");
}

function main() {
  const idsRaw = arg("--ids");
  const out = arg("--out") || "frozen-input-records.json";
  const loadoutRoot = arg("--loadout") || resolve("..", "Loadout");
  const productIds = idsRaw.split(/[\s,]+/).map((id) => id.trim()).filter(Boolean);
  if (!productIds.length) {
    console.error("usage: npx tsx scripts/freeze-from-loadout.ts --ids id1,id2 --out records.json [--loadout path]");
    process.exit(2);
  }

  const sourcePath = resolve(loadoutRoot, "src/data/products.ts");
  const catalog = loadLoadoutProductsFromSource(readFileSync(sourcePath, "utf8"));
  const { records, missing } = buildFrozenInputRecords(catalog, productIds);
  if (missing.length) {
    console.error(`Missing Loadout product IDs: ${missing.join(", ")}`);
    process.exit(1);
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(records, null, 2)}\n`);
  console.log(JSON.stringify({ out, sourcePath, productIds, count: productIds.length }, null, 2));
}

main();
