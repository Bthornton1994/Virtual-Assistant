import ts from "typescript";
import type { CatalogProductRecord } from "@/lib/work-cell-operator";

/**
 * Execute Loadout `src/data/products.ts` after stripping type-only imports.
 * Loadout is not a package of this repo and does not need tsx installed.
 */
export function loadLoadoutProductsFromSource(source: string): CatalogProductRecord[] {
  const stripped = source.replace(/^\s*import type\s+[^;]+;\s*$/gm, "");
  if (/^\s*import\s/m.test(stripped)) {
    throw new Error("Loadout products.ts has runtime imports; freeze cannot execute it.");
  }
  const { outputText } = ts.transpileModule(stripped, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2017,
      esModuleInterop: true,
    },
    fileName: "products.ts",
  });
  const cjs = { exports: {} as { PRODUCTS?: unknown } };
  const run = new Function("exports", "module", outputText) as (exports: unknown, module: unknown) => void;
  run(cjs.exports, cjs);
  if (!Array.isArray(cjs.exports.PRODUCTS)) {
    throw new Error("Loadout products.ts did not export a PRODUCTS array.");
  }
  return JSON.parse(JSON.stringify(cjs.exports.PRODUCTS)) as CatalogProductRecord[];
}
