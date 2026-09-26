import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FIELD_SIZES,
  MAX_WORK_EXPONENT,
  MIN_STEP_GROWTH,
  SCAN_SIZES,
  SHAPES,
  smallestStep,
  workExponent,
  worstPerCharacter,
} from "@/lib/__tests__/release-rescue-scan-shapes";

// The scan's JAVASCRIPT work, counted as V8 block executions rather than timed.
//
// `release-rescue-scan-work.test.ts` counts the work the scanner hands to native
// methods: `indexOf` scan distance and regular-expression start positions. It is
// blind to a loop written in JavaScript, because a loop calls no native method.
// The known case is a per-key character walk to the closing quote of an
// XML-attribute value: reintroduced, it made the scan quadratic and passed both
// of those counters. Here V8's block coverage counts the JavaScript the scan
// runs in every module it loads from disk, which is the work those counters
// cannot see, and the same growth bound applies. The figure is the sum of the
// block-range counts V8 reports, a proxy for block executions (see the child).
// Work inside native builtins other than `indexOf`, `lastIndexOf` and `exec`
// (a spread, the loop inside `findIndex`, `includes`) is seen by none of the
// three counters.
//
// The measurement runs in a child process (`release-rescue-scan-block-work.child.mjs`)
// so it shares no V8 isolate with Vitest: precise coverage is one mode per
// isolate and reading it resets its counters, so doing it here would interfere
// with a coverage provider and with later files in the same worker. The child
// imports the real scanner source through Node's own type stripping; nothing is
// added to, exported from, or counted inside the scanner.
//
// No bound on the scan's work is a time or an exact count. With optimization off
// the counts repeat exactly on one Node version, but they may differ across V8
// versions, so every bound on the scan is a growth exponent, a generous
// per-character ceiling or a floor on each doubling's growth, and the repeat
// check allows 1%. Only the liveness check is exact: V8 must count every one of
// the calibration's passes.

const CHILD = fileURLToPath(new URL("./release-rescue-scan-block-work.child.mjs", import.meta.url));
const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Block-range counts per input character, at every size of both series.
 * Measured on the fixed scanner, the worst is 126.7 (repeated colons, at 64K);
 * the worst exponent is 1.0719 (repeated colons, at the field sizes). With the
 * per-key walk it guards against put back, the unterminated-carrier shape
 * charges 2,914 per character at 64K, and its exponents are 1.9735 at the field
 * sizes and 1.9948 at the scan sizes. A bound of 1,000 is about eight times the
 * observed worst case and about three times below the walk at 64K. At the field
 * sizes the walk charges at most 368 per character, so there its exponent is
 * what catches it.
 */
const MAX_BLOCKS_PER_CHARACTER = 1_000;

// Passes of the calibration loop. Enough for V8 to optimize its helper were
// optimization on, so the check that every call was counted means something.
const CALIBRATION_LENGTH = 100_000;

// How far the same input measured twice may drift before the count is not a
// count. With optimization off it does not drift at all.
const MAX_REPEAT_DRIFT = 0.01;

// Stand-in sizes: small, because the quadratic stand-in is quadratic.
const STAND_IN_SIZES = [1_000, 2_000, 4_000, 8_000];

// Harness limits for the one child process that measures sixteen shapes with
// block counters on (a few seconds on one development machine; illustrative).
// Neither is a bound on how fast the scan is, and neither can make a run pass.
// A regression like the per-key walk still finishes well inside them and fails
// on its counts; one costly enough to reach the child limit fails as a
// timeout, with no counts. `spawnSync` holds the worker, so the child limit is
// the one that fires first.
const CHILD_TIMEOUT_MS = 240_000;
const TEST_TIMEOUT_MS = 300_000;

/**
 * Node's type stripping needs a flag on 22.6 to 22.17 and 23.0 to 23.5. The
 * child does not inherit this worker's flags, so it gets the flag whenever the
 * version needs it.
 */
function nativeTypeStripArgs(): string[] {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const flagRequired = (major === 22 && minor >= 6 && minor < 18) || (major === 23 && minor < 6);
  return flagRequired ? ["--experimental-strip-types"] : [];
}

type ChildReply = {
  scannerSeen: boolean;
  uncounted: string[];
  calibration: { loopBody: number; helperCalls: number };
  shapes: Array<{ label: string; field: number[]; scan: number[]; repeat: number }>;
  standIns: { perKeyWalk: number[]; sharedWalk: number[] };
};

function measureInChild(): ChildReply {
  const request = {
    srcRoot: SRC_ROOT,
    calibration: CALIBRATION_LENGTH,
    shapes: SHAPES.map(([label, make]) => ({ label, field: FIELD_SIZES.map(make), scan: SCAN_SIZES.map(make) })),
    standIns: { sizes: STAND_IN_SIZES },
  };
  // An empty value, not a deleted key: Node copies the parent's value into any
  // child environment that lacks the key. The measurement is the child's own.
  const env = { ...process.env, NODE_V8_COVERAGE: "" };
  // Optimization off: optimized code does not report every function entry.
  const result = spawnSync(
    process.execPath,
    [
      ...nativeTypeStripArgs(),
      "--no-turbofan",
      "--no-maglev",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      CHILD,
    ],
    { input: JSON.stringify(request), encoding: "utf8", env, timeout: CHILD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    const cause = result.error ? `${(result.error as NodeJS.ErrnoException).code ?? result.error.message}, ` : "";
    throw new Error(
      `block-work child exited ${result.status} (${cause}${result.signal ?? "no signal"}): ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout) as ChildReply;
}

describe("the scan executes a bounded number of JavaScript blocks, counted rather than timed", () => {
  // One child process measures every shape; each check below reads its reply.
  let reply: ChildReply;
  beforeAll(() => {
    reply = measureInChild();
  }, TEST_TIMEOUT_MS);

  it("measured with live block counters, so no figure below is an undercount", () => {
    expect(reply.scannerSeen, "the scanner module was not seen by the coverage session").toBe(true);
    // Every function the scan ran in a measured module must report block counters.
    expect(reply.uncounted, "functions that ran with a call count only").toEqual([]);
    expect(reply.calibration.loopBody, "calibration loop body").toBeGreaterThanOrEqual(CALIBRATION_LENGTH);
    expect(reply.calibration.helperCalls, "calibration helper calls counted").toBeGreaterThanOrEqual(
      CALIBRATION_LENGTH,
    );
    expect(reply.shapes.map((entry) => entry.label)).toEqual(SHAPES.map(([label]) => label));
  });

  for (const [label] of SHAPES) {
    it(`stays linear in blocks executed: ${label}`, () => {
      const measured = reply.shapes.find((entry) => entry.label === label);
      expect(measured, `no measurement for ${label}`).toBeDefined();
      const { field, scan, repeat } = measured!;

      // The same input measured twice gives the same figure, or it is not a count.
      const largest = scan[scan.length - 1];
      expect(Math.abs(repeat - largest) / largest, `${label}: ${largest}, repeat ${repeat}`).toBeLessThanOrEqual(
        MAX_REPEAT_DRIFT,
      );

      // Both series: the exponent, the ceiling at every size rather than at 64K
      // alone, and the step floor.
      for (const [series, blocks, sizes] of [
        ["field", field, FIELD_SIZES],
        ["scan", scan, SCAN_SIZES],
      ] as const) {
        const exponent = workExponent(blocks);
        const perCharacter = worstPerCharacter(blocks, sizes);
        const step = smallestStep(blocks);
        const detail = `${label}, ${series} sizes: ${blocks.join(" -> ")} blocks, exponent ${exponent.toFixed(4)}, worst ${perCharacter.toFixed(1)} per input character, smallest step ${step.toFixed(3)}`;

        expect(blocks[0], detail).toBeGreaterThan(0);
        expect(exponent, detail).toBeLessThan(MAX_WORK_EXPONENT);
        expect(perCharacter, detail).toBeLessThan(MAX_BLOCKS_PER_CHARACTER);
        expect(step, detail).toBeGreaterThanOrEqual(MIN_STEP_GROWTH);
      }
    });
  }

  it("reports quadratic growth for a per-key walk and linear growth for a shared one", () => {
    // These stand-ins run in the same child, under the same coverage session, as
    // the scanner. They are NOT the scanner: the end-to-end proof is a mutation
    // run that puts the per-key walk back into `attributeCarrier`.
    const walked = workExponent(reply.standIns.perKeyWalk);
    const shared = workExponent(reply.standIns.sharedWalk);

    expect(walked, `per-key walk: ${reply.standIns.perKeyWalk.join(" -> ")}`).toBeGreaterThan(1.9);
    expect(shared, `shared walk: ${reply.standIns.sharedWalk.join(" -> ")}`).toBeLessThan(MAX_WORK_EXPONENT);
  });
});
