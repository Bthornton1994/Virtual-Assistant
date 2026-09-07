/** Reproducible local smoke benchmark, NOT an unseen CS-5 qualification bakeoff.
 * No models, paid services, network calls, source mutations, or deployment.
 * Measures raw full-read vs exact receipt bytes, plus a targeted-read comparator.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createSoftwareContextShunt } from "../src/lib/software-context-shunt.ts";
import { sha256Hex, sha256Text } from "../src/lib/catalog-evidence-hash.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = (...args) => execFileSync("git", ["--no-pager", "--no-replace-objects", "--no-lazy-fetch", "-C", root, ...args], { encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const revision = git("rev-parse", "HEAD").trim();
const cases = [
  { id: "registry-lookup", paths: ["src/lib/capability-registry.ts"], query: "software_repository_read" },
  { id: "context-validation", paths: ["src/lib/context-provider.ts"], query: "buildContextProviderScorecard" },
  { id: "cross-file-freeze", paths: ["src/lib/capability-registry.ts", "src/lib/__tests__/capability-registry.test.ts"], query: "FROZEN_WORK_CELL_EXECUTOR_KEYS" },
  { id: "no-match", paths: ["src/lib/context-provider.ts"], query: "__deliberately_absent_lookup_marker__" },
];
const scratch = mkdtempSync(join(tmpdir(), "dc-context-benchmark-"));
const rows = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

try {
  for (const task of cases) {
    const sources = task.paths.map((path) => {
      const text = git("show", "--no-ext-diff", "--no-textconv", `${revision}:${path}`);
      return { path, text, sha256: sha256Text(text) };
    });
    const binding = { organizationId: "local-benchmark", assignmentId: task.id, repository: "Bthornton1994/Virtual-Assistant", revision };
    const request = { schemaVersion: "software-context-request/v1", ...binding, taskKind: "lookup", paths: task.paths, selection: { kind: "search", query: task.query, contextLines: 2 }, maxResponseBytes: 8192 };
    const scope = { schemaVersion: "software-context-scope/v1", ...binding, permissionVersion: "local-benchmark-only", policyHash: sha256Hex({ benchmark: "software-context-shunt/v1" }), dataPolicy: "approved_private_repository", allowedPaths: task.paths, requiredFullReadPaths: [], expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const helper = createSoftwareContextShunt();
    const coldTimes = [], warmTimes = [];
    let result;
    for (let iteration = 0; iteration < 5; iteration++) {
      helper.clear();
      let start = performance.now();
      result = helper.run(request, scope, sources);
      coldTimes.push(performance.now() - start);
      start = performance.now();
      const warm = helper.run(request, scope, sources);
      warmTimes.push(performance.now() - start);
      assert.equal(warm.ok && warm.cache, "hit");
    }
    assert.equal(result.ok, true);
    assert.notEqual(result.receipt.status, "partial");
    assert.equal(result.metrics.responseBytes, Buffer.byteLength(JSON.stringify(result)));
    // Independent literal oracle: every matching line must appear, including late/cross-file hits.
    for (const source of sources) {
      const lines = source.text.split("\n");
      lines.forEach((line, index) => {
        if (!line.includes(task.query)) return;
        assert.ok(result.receipt.excerpts.some((e) => e.path === source.path && e.startLine <= index + 1 && e.endLine >= index + 1));
      });
      for (const e of result.receipt.excerpts.filter((e) => e.path === source.path)) {
        const raw = source.text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        assert.equal(e.text, raw.slice(e.startLine - 1, e.endLine).join(""));
      }
    }
    // Full CLI path includes process startup, imports, manifest parsing, Git reads and errors.
    const scopePath = join(scratch, "scope.json"), requestPath = join(scratch, "request.json");
    writeFileSync(scopePath, JSON.stringify(scope));
    writeFileSync(requestPath, JSON.stringify(request));
    const cliTimes = [];
    let cliOutputBytes = 0, cliStderrBytes = 0;
    for (let iteration = 0; iteration < 3; iteration++) {
      const start = performance.now();
      const cli = spawnSync(process.execPath, [resolve(root, "scripts/software-context-shunt.mjs"), "--repo", root, "--scope", scopePath, "--request", requestPath], { encoding: "utf8", timeout: 30000 });
      cliTimes.push(performance.now() - start);
      assert.equal(cli.status, task.id === "no-match" ? 3 : 0);
      const actual = JSON.parse(cli.stdout);
      assert.equal(actual.contentHash, result.contentHash);
      cliOutputBytes = Buffer.byteLength(cli.stdout);
      cliStderrBytes = Buffer.byteLength(cli.stderr);
    }
    rows.push({
      task: task.id, status: result.receipt.status, inputSnapshotHash: result.receipt.repositorySnapshotHash,
      sources: result.receipt.sources, rawFullReadBytes: result.metrics.sourceBytes, responseBytes: result.metrics.responseBytes,
      outputByteReductionPercent: Number((100 * (1 - result.metrics.responseBytes / result.metrics.sourceBytes)).toFixed(2)),
      targetedExcerptTextBytes: result.receipt.excerpts.reduce((sum, e) => sum + Buffer.byteLength(e.text), 0),
      coreColdMedianMs: Number(median(coldTimes).toFixed(3)), coreWarmMedianMs: Number(median(warmTimes).toFixed(3)),
      cliMedianMs: Number(median(cliTimes).toFixed(3)), cliOutputBytes, cliStderrBytes,
      requestBytes: Buffer.byteLength(JSON.stringify(request)), scopeBytes: Buffer.byteLength(JSON.stringify(scope)),
      literalMatchCoverageChecked: true, exactExcerptBytesChecked: true,
      tokens: null, providerCostMicros: null, modelCalls: 0,
    });
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: "software-context-smoke-benchmark/v1", nodeVersion: process.version, gitVersion: git("--version").trim(),
    sourceCommit: revision,
    implementationHash: sha256Hex(["src/lib/software-context-shunt.ts", "scripts/software-context-shunt.mjs", "src/lib/catalog-evidence-hash.ts"].map((path) => ({ path, sha256: sha256Text(readFileSync(resolve(root, path), "utf8")) }))),
    qualification: "not_performed", assumptions: ["Known local lookup tasks, not unseen trials.", "Byte reduction is relative to raw full-file reads, not billed model tokens or Grok weekly allowance.", "Targeted excerpt text is usually smaller; receipt overhead buys scope/provenance/coverage.", "Startup stderr and request/scope sizes are reported separately. Discovery, owner coordination, retries and model-answer quality are not measured.", "Process-local cache saves extraction work, not repeated prompt ingestion or Git I/O in a fresh CLI process."],
    rows,
  }, null, 2) + "\n");
} finally {
  // Only the newly created, uniquely named benchmark fixture directory is removed.
  rmSync(scratch, { recursive: true, force: true });
}
