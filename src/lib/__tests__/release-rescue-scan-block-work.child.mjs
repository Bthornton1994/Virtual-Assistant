// Child process for `release-rescue-scan-block-work.test.ts`. Not a test file.
//
// It counts the JavaScript the scan executes, as V8 precise block coverage: the
// sum of the range counts V8 reports for every `file:` module that runs during
// the scan except this one, so a loop moved into a helper module, of any
// extension, in the repository or in a dependency, is still counted. V8 folds a
// nested range into its parent when their counts are equal, so the sum is a
// proxy for block executions rather than one count per execution; a loop body
// that runs more often than its parent keeps its own range, so a per-key walk
// still shows. That walk, the loop neither the `indexOf` counter nor the
// regular-expression counter can see, is JavaScript and is counted here. Work
// inside a native builtin (a spread, `findIndex`'s own loop, `includes`) is not
// JavaScript and is seen by none of the three counters.
//
// WHY A SEPARATE PROCESS. Precise coverage is one mode per V8 isolate, and
// reading it resets the counters. Inside a Vitest worker that would consume the
// counts of any coverage provider running in the same isolate, and leave the
// mode on for whatever test file the worker runs next. Here nothing else shares
// the isolate, and it ends with this process.
//
// WHY COVERAGE STARTS BEFORE THE IMPORT. A function compiled before block
// coverage is on runs without block counters: V8 then reports it with
// `isBlockCoverage: false` and a call count only. The scanner is imported after
// the mode is set, and the reply lists every function the scan ran in a
// measured module without block counters, so the test fails rather than report
// too little.
//
// WHY OPTIMIZATION IS OFF. The test spawns this child with `--no-turbofan
// --no-maglev`. Optimized code does not report every function entry: a helper
// called from an optimized loop drops out of the report, at a point JIT timing
// decides, so two runs of one input could differ. Loop bodies keep their own
// counters either way. The calibration below calls a helper from a warmed-up
// loop and reports how many of its entries were counted, so a run with
// optimization on fails rather than measure a JIT-dependent figure.
//
// WHAT THIS CAN LOAD. Node strips the TypeScript itself, in strip-only mode,
// and the hook below resolves `@/` and extensionless relative imports. A type
// imported without `import type`, an enum, a namespace, a parameter property, a
// `.js`-suffixed import of a `.ts` file or a JSON import without an import
// attribute is accepted by the build but not loadable here: the child exits
// non-zero and the test fails, rather than pass on a partial measurement.
//
// Protocol: one JSON request on stdin, one JSON reply on stdout.
//   request: { srcRoot, calibration, shapes: [{ label, field, scan }], standIns: { sizes } }
//            where `field` and `scan` are the texts of each series, smallest first
//   reply:   { scannerSeen, uncounted, calibration, shapes: [{ label, field, scan, repeat }], standIns }
import { Session } from "node:inspector/promises";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const request = JSON.parse(readFileSync(0, "utf8"));
const srcRoot = request.srcRoot.endsWith("/") ? request.srcRoot : `${request.srcRoot}/`;
const srcRootUrl = pathToFileURL(srcRoot).href;

// `@/` is the repository's path alias. Node resolves it, and any extensionless
// relative import, with this hook, and strips the TypeScript itself; nothing
// else is transformed.
const resolveHook = `
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
  if (specifier.startsWith("@/")) {
    found = sourceFile(root + specifier.slice(2));
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    found = sourceFile(fileURLToPath(new URL(specifier, context.parentURL)));
  }
  return next(found ?? specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(resolveHook)}`, { data: { srcRoot } });

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

const scannerUrl = pathToFileURL(`${srcRoot}lib/release-rescue-credential-scanner.ts`).href;
// Every module loaded from disk except this child. `node:` internals and the
// `data:` stand-ins below are not counted.
const isMeasured = (url) => url.startsWith("file:") && url !== import.meta.url;
const { redactSecrets } = await import("@/lib/release-rescue-redaction");

let scannerSeen = true;
const uncounted = new Set();

/** Coverage for whatever runs inside `run`, and nothing before it. */
async function coverageOf(run) {
  await session.post("Profiler.takePreciseCoverage"); // resets every counter
  run();
  return (await session.post("Profiler.takePreciseCoverage")).result;
}

/** Summed block-range counts in every measured module while one scan runs. */
async function scanBlocks(text) {
  const result = await coverageOf(() => redactSecrets(text));
  let total = 0;
  let scanner = false;
  for (const script of result) {
    if (!isMeasured(script.url)) continue;
    if (script.url === scannerUrl) scanner = true;
    const name = script.url.startsWith(srcRootUrl) ? script.url.slice(srcRootUrl.length) : script.url;
    for (const fn of script.functions) {
      // A function that ran with only a call count would be an undercount.
      if (fn.ranges[0].count > 0 && fn.isBlockCoverage !== true) {
        uncounted.add(`${name}#${fn.functionName || "(anonymous)"}`);
      }
      for (const range of fn.ranges) total += range.count;
    }
  }
  if (!scanner) scannerSeen = false;
  return total;
}

const shapes = [];
for (const { label, field, scan } of request.shapes) {
  const measured = { label, field: [], scan: [] };
  for (const text of field) measured.field.push(await scanBlocks(text));
  for (const text of scan) measured.scan.push(await scanBlocks(text));
  measured.repeat = await scanBlocks(scan[scan.length - 1]);
  shapes.push(measured);
}

// Stand-ins, loaded after coverage starts like the scanner. They are NOT the
// scanner: they show the instrument itself behaves, and the end-to-end proof is
// a mutation run against the scanner.
const standInSource = `
function step(index) { return index & 1; }
export function calibrate(length) {
  let total = 0;
  for (let index = 0; index < length; index += 1) total += step(index);
  return total;
}
export function perKeyWalk(text, keys) {
  for (const at of keys) {
    let end = at;
    while (end < text.length && text[end] !== '"') end += 1;
  }
}
export function sharedWalk(text, keys) {
  let end = -1;
  for (const at of keys) {
    if (end < at) {
      end = at;
      while (end < text.length && text[end] !== '"') end += 1;
    }
  }
}`;
const standInUrl = `data:text/javascript,${encodeURIComponent(standInSource)}`;
const standIn = await import(standInUrl);

/** The stand-in functions' coverage while `run` executes, by function name. */
async function standInFunctions(run) {
  const script = (await coverageOf(run)).find((entry) => entry.url === standInUrl);
  return new Map((script?.functions ?? []).map((fn) => [fn.functionName, fn]));
}

// A loop body that runs `calibration` times and a helper called on every pass.
// Block counters are live if the body's range reaches the length; function
// entries are all counted only if optimization did not drop the helper's. The
// measured call follows an unmeasured one: in a probe with optimization on, the
// first call still counted every entry and the later calls counted none.
standIn.calibrate(request.calibration);
const calibrated = await standInFunctions(() => standIn.calibrate(request.calibration));
const calibration = {
  loopBody: Math.max(0, ...(calibrated.get("calibrate")?.ranges.slice(1).map((range) => range.count) ?? [])),
  helperCalls: calibrated.get("step")?.ranges[0].count ?? 0,
};

const walkBlocks = async (walk, text, keys) =>
  [...(await standInFunctions(() => walk(text, keys))).values()]
    .flatMap((fn) => fn.ranges)
    .reduce((sum, range) => sum + range.count, 0);
const standIns = { perKeyWalk: [], sharedWalk: [] };
for (const size of request.standIns.sizes) {
  const text = "x".repeat(size);
  const keys = [];
  for (let at = 0; at < size / 2; at += 11) keys.push(at);
  standIns.perKeyWalk.push(await walkBlocks(standIn.perKeyWalk, text, keys));
  standIns.sharedWalk.push(await walkBlocks(standIn.sharedWalk, text, keys));
}

process.stdout.write(JSON.stringify({ scannerSeen, uncounted: [...uncounted].sort(), calibration, shapes, standIns }));
