/**
 * Node custom loader: map `@/` → `<repo>/src/`.
 * Used by `npm run eval:agent:runtime` so modules that use the repo path alias
 * resolve under `node --experimental-strip-types`.
 */
import { pathToFileURL } from "node:url";
import { resolve as resolvePath, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    const base = resolvePath(root, "src", relative);
    const candidates = extname(base)
      ? [base]
      : [base + ".ts", base + ".tsx", base + ".js", resolvePath(base, "index.ts")];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context);
      }
    }
    return nextResolve(pathToFileURL(base + ".ts").href, context);
  }
  return nextResolve(specifier, context);
}
