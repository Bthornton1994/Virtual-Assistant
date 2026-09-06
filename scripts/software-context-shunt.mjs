/** Local, opt-in, read-only adapter. Node 22.18+ or 24+; no remote calls or hooks.
 * Native type stripping + explicit extensions: https://nodejs.org/api/typescript.html
 * Git reads: https://git-scm.com/docs/git-cat-file and https://git-scm.com/docs/git-ls-tree
 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Text } from "../src/lib/catalog-evidence-hash.ts";
import {
  createSoftwareContextShunt, preflightSoftwareContext,
  MAX_CONTEXT_SOURCE_BYTES, MAX_CONTEXT_INPUT_BYTES,
} from "../src/lib/software-context-shunt.ts";

const USAGE = "node scripts/software-context-shunt.mjs --repo REPOSITORY_DIR --scope SCOPE_JSON --request REQUEST_JSON";

function readJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw new Error("Invalid manifest");
    const buffer = Buffer.alloc(65537);
    let count = 0, read = 0;
    do {
      read = readSync(fd, buffer, count, buffer.length - count, null);
      count += read;
    } while (read && count < buffer.length);
    if (count > 65536) throw new Error("Oversized manifest");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)));
  } finally { closeSync(fd); }
}

export function runSoftwareContextCli(args) {
  if (args.length === 1 && args[0] === "--help") return { exitCode: 0, output: USAGE + "\n" };
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!["--repo", "--scope", "--request"].includes(key) || !value || options.has(key)) {
      return { exitCode: 2, output: JSON.stringify({ ok: false, code: "INVALID_ARGUMENTS", usage: USAGE }) };
    }
    options.set(key, value);
  }
  if (options.size !== 3) return { exitCode: 2, output: JSON.stringify({ ok: false, code: "INVALID_ARGUMENTS", usage: USAGE }) };
  try {
    const requestInput = readJson(options.get("--request"));
    const scopeInput = readJson(options.get("--scope"));
    const preflight = preflightSoftwareContext(requestInput, scopeInput);
    if (!preflight.ok) return { exitCode: 2, output: JSON.stringify(preflight) };
    const { request } = preflight;
    const root = resolve(options.get("--repo"));
    const deadline = Date.now() + 30000;
    // Ignore ambient GIT_DIR/config injections; prohibit replacements and lazy fetch.
    // Credentials are not requested, emitted, or transferred into another process.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SystemRoot"].includes(key)));
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" });
    const git = (...gitArgs) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Read deadline exceeded");
      return execFileSync("git", ["--no-pager", "--no-replace-objects", "--no-lazy-fetch", "--literal-pathspecs", "-C", root, ...gitArgs], {
        env, shell: false, timeout: Math.min(5000, remaining), maxBuffer: MAX_CONTEXT_SOURCE_BYTES + 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    };
    if (git("cat-file", "-t", request.revision).toString().trim() !== "commit") throw new Error("Expected exact commit");
    const sources = [];
    let total = 0;
    for (const path of request.paths) {
      const entry = git("ls-tree", "-z", "--full-tree", request.revision, "--", path).toString("utf8");
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(entry);
      if (!match || match[3] !== path) throw new Error("Missing or non-regular source");
      const blob = match[2];
      const size = Number(git("cat-file", "-s", blob).toString().trim());
      total += size;
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_CONTEXT_SOURCE_BYTES || total > MAX_CONTEXT_INPUT_BYTES) throw new Error("Read size limit");
      const bytes = git("cat-file", "blob", blob);
      if (bytes.length !== size) throw new Error("Source size mismatch");
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      sources.push({ path, text, sha256: sha256Text(text) });
    }
    const result = createSoftwareContextShunt(0).run(requestInput, scopeInput, sources);
    const exitCode = !result.ok ? 2 : result.receipt.status === "complete" ? 0 : 3;
    return { exitCode, output: JSON.stringify(result) };
  } catch {
    // Subprocess/JSON errors may contain source, paths or credentials: never echo them.
    return { exitCode: 2, output: JSON.stringify({ ok: false, code: "INPUT_UNAVAILABLE", reason: "Check manifest shape, local commit, regular-file paths, UTF-8, and read limits. No network fallback attempted." }) };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runSoftwareContextCli(process.argv.slice(2));
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
