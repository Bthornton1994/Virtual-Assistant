#!/usr/bin/env node
// Entry point for `npm run rr:local -- <command>`.
//
// Loads the internal CLI straight from TypeScript source with Node's own type
// stripping, and resolves the repository's `@/` alias and extensionless
// relative imports with a small loader hook. Nothing is compiled or bundled.
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const srcRoot = `${resolve(process.cwd(), "src")}/`;
const hook = `
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
let root;
export async function initialize(data) { root = data.srcRoot; }
function sourceFile(base) {
  for (const candidate of [base, base + ".ts", base + ".tsx", base + "/index.ts"]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return pathToFileURL(candidate).href;
  }
  return null;
}
export async function resolve(specifier, context, next) {
  let found = null;
  if (specifier.startsWith("@/")) found = sourceFile(root + specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    found = sourceFile(fileURLToPath(new URL(specifier, context.parentURL)));
  }
  return next(found ?? specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hook)}`, { data: { srcRoot } });

const { main } = await import(pathToFileURL(`${srcRoot}lib/release-rescue-internal/cli.ts`).href);
await main(process.argv.slice(2));
