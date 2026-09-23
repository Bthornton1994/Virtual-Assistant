import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import {
  exceedsGrowthCeiling,
  growthExponent,
  SCAN_SIZES,
  TIMED_SHAPES,
} from "@/lib/__tests__/release-rescue-growth-gate";

// THE SCANNER TIMING OBSERVATION. ADVISORY: IT DOES NOT BLOCK A RELEASE.
//
// Under DECISION_LOG.md § D-019 the wall-clock growth assertion and the 2,000ms
// ceiling run here, in the separately named `timing-observation` check
// (`.github/workflows/timing-observation.yml`, `npm run test:timing-observation`),
// and not in `npm test`. A failure here is visible on the pull request and is
// not a blocker. It is never retried automatically: vitest's `retry` is 0 in
// `vitest.timing-observation.config.ts`, and the workflow runs this file once.
//
// The assertions are the ones that were in `npm test`, moved unchanged: the same
// estimator, the same 1.5 ceiling, the same 2,000ms absolute ceiling, the same
// warm-up and best-of runs. Nothing is loosened by moving them. What changed is
// only whether their failure blocks.
//
// WHY, in one line: a wall-clock complexity assertion on a shared runner is
// decided by the machine as well as the code. The release gate on the scan's
// cost is counted work, which is the same integer on every machine, in
// `release-rescue-scan-work.test.ts` and `release-rescue-scan-block-work.test.ts`.
// Those counters see only what they count - `indexOf` / `lastIndexOf` scan
// distance, regular-expression start positions, and JavaScript block
// executions - so elapsed time is still worth watching for what they cannot
// see: other native builtins, allocation, garbage collection. That is what
// this observation is for.
//
// Every test prints one `[timing-observation]` JSON line before it asserts, so a
// passing run records what it measured as well as a failing one does.

function record(observation: Record<string, unknown>): void {
  console.log(`[timing-observation] ${JSON.stringify(observation)}`);
}

describe("timing observation: the scan grows linearly on the clock (advisory, D-019)", () => {
  // TWO DEFECTS IN THIS TEST'S OWN METHOD, both found when CI finally ran it on
  // a machine slower than the one it was written on.
  //
  // It said "measured at 20, 40 and 80KB", and the scanner never saw 80KB:
  // `MAX_SCAN_LENGTH` is 64,000, so the third input was clipped and the last step
  // was a 1.6x increase described as a doubling. The sizes are all inside that
  // bound now, so every step is a real doubling of the text actually read; the
  // blocking suite checks that without a clock.
  //
  // And the per-step ratio check carried `if (timings[index - 1] < 20) continue`,
  // which skipped the comparison whenever the smallest sample landed under 20ms.
  // On this machine `<password>` repeated at 20KB ran in 18.65ms — just under —
  // so the one ratio that would have caught a real defect was silently dropped,
  // and the suite was green. CI measured 31.88ms for the same input, the check
  // ran, and it failed at 3.81. The escape hatch was hiding a genuine
  // near-quadratic path in `collectOpaqueTokensNearCredentialNouns`, since fixed.
  //
  // So the assertion is the growth EXPONENT across the whole range rather than
  // adjacent ratios with a skip. Over three doublings linear is 1.0 and
  // quadratic is 2.0, nothing can be skipped, and every sample is read.
  //
  // S-018 replaced that exponent with the median of the three adjacent
  // doubling ratios, because on fb3110e this shape measured
  // 12.73 -> 27.75 -> 64.32 -> 301.28ms, exponent 1.522 against the 1.5
  // ceiling, on a ledger-only commit. Audit 48 measured the replacement: a
  // median of three DISCARDS the largest ratio, so super-linear growth
  // confined to the final doubling passes it. That is not a stricter or a
  // looser gate than the exponent, it is a blind one in the direction this
  // test exists to watch, and the audit reproduced it by size-gating the
  // scanner and still getting a green suite. The exponent was restored, and
  // the per-step ratios are kept in the failure detail, where they diagnose
  // without deciding. The restored gate was then measured failing on an
  // unchanged scanner under load, which is what D-019 answers.
  for (const [label, make] of TIMED_SHAPES) {
    it(`stays linear on ${label}`, () => {
      const inputs = SCAN_SIZES.map(make);

      // Warmed on every input before any of them is timed. Without this the
      // smallest input is the one that pays for JIT compilation, which distorts
      // exactly the sample the growth measurement is most sensitive to.
      for (const input of inputs) redactSecrets(input);

      // Best of three. A single sample under a parallel test runner measures the
      // machine as much as the code, and the fastest run is the one least
      // contaminated by other work.
      const timings = inputs.map((input) => {
        let best = Number.POSITIVE_INFINITY;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const started = performance.now();
          redactSecrets(input);
          best = Math.min(best, performance.now() - started);
        }
        return best;
      });

      const exponent = growthExponent(timings);
      // Diagnostics only. The per-step ratios say WHERE a failure came from;
      // they decide nothing, and no assertion reads them.
      const ratios = timings.slice(1).map((value, index) => value / timings[index]);
      const detail = `${label}: ${timings.map((t) => t.toFixed(2)).join(" -> ")}ms, ratios ${ratios.map((ratio) => `${ratio.toFixed(2)}x`).join(", ")}, exponent ${exponent.toFixed(3)}`;
      record({
        check: "growth exponent",
        shape: label,
        sizes: SCAN_SIZES,
        milliseconds: timings.map((t) => Number(t.toFixed(3))),
        exponent: Number(exponent.toFixed(4)),
        overCeiling: exceedsGrowthCeiling(timings),
      });

      // 1.0 is linear and 2.0 is quadratic over these three real doublings.
      // Decided by `exceedsGrowthCeiling`, the same function the recorded-series
      // table in the blocking suite calls, so that table cannot stay green while
      // this verdict changes.
      expect(exceedsGrowthCeiling(timings), detail).toBe(false);
      // And an absolute ceiling, so "linear but enormous" still fails.
      expect(timings[timings.length - 1], `${label} took ${timings[timings.length - 1]}ms at 64KB`).toBeLessThan(2_000);
    });
  }
});

describe("timing observation: the scan stays within 2,000ms as the input grows (advisory, D-019)", () => {
  // An absolute ceiling only. HOW the cost grows is observed above, by the
  // exponent, and these shapes are in that list.
  //
  // This block, when it was in `release-rescue-scanner-value-properties.test.ts`,
  // used to also assert `time(80KB) / time(40KB) < 3`, calling 3 "the line
  // between linear and quadratic" (S-014). It was not. MAX_SCAN_LENGTH is
  // 64,000, so the 80KB input was clipped and the step actually measured was
  // 1.6x: on that step a linear scan reads 1.6 and a quadratic one 2.56, both
  // under 3. The check could not fail on complexity. It could fail on a loaded
  // runner, and did — 3.63 and 3.18 on two shapes whose measured exponents are
  // 1.25 and 1.00 — on a commit that touched nothing it reads. That is S-005 and
  // S-012 a third time: a threshold the machine decides, on a test that meant to
  // measure something else. The sizes are derived from the bound now, so nothing
  // is clipped, and the one assertion left is the ceiling.
  const SIZES = [MAX_SCAN_LENGTH / 4, MAX_SCAN_LENGTH / 2, MAX_SCAN_LENGTH] as const;

  const SHAPES: ReadonlyArray<{ label: string; fill: (size: number) => string }> = [
    { label: "colons", fill: (n) => "password:".repeat(Math.ceil(n / 9)).slice(0, n) },
    { label: "equals signs", fill: (n) => "password=".repeat(Math.ceil(n / 9)).slice(0, n) },
    { label: "one enormous line of flags", fill: (n) => "--password x ".repeat(Math.ceil(n / 13)).slice(0, n) },
    { label: "credential nouns in prose", fill: (n) => "the password is not stored here. ".repeat(Math.ceil(n / 33)).slice(0, n) },
    { label: "quotes", fill: (n) => 'password="a" '.repeat(Math.ceil(n / 13)).slice(0, n) },
  ];

  for (const shape of SHAPES) {
    it(`stays within budget on ${shape.label}`, () => {
      // Best of five: the minimum is the run that was not interrupted.
      const timings = SIZES.map((size) => {
        const text = shape.fill(size);
        let best = Infinity;
        for (let run = 0; run < 5; run += 1) {
          const started = performance.now();
          redactSecrets(text);
          best = Math.min(best, performance.now() - started);
        }
        return best;
      });
      record({
        check: "absolute ceiling 2000ms",
        shape: shape.label,
        sizes: SIZES,
        milliseconds: timings.map((t) => Number(t.toFixed(3))),
      });

      for (const elapsed of timings) {
        expect(elapsed, `${shape.label}: ${timings.map((t) => Math.round(t)).join("ms, ")}ms`)
          .toBeLessThan(2_000);
      }
    });
  }
});

// DEMONSTRATION ONLY, REVERTED BY THE NEXT COMMIT. D-019 requires showing that a
// failure of this advisory check does not fail `verify`. This assertion cannot
// pass: no scan takes less than 0ms.
describe("DEMONSTRATION ONLY (reverted in the next commit): an advisory timing failure", () => {
  it("fails a wall-clock assertion on purpose", () => {
    const started = performance.now();
    redactSecrets("password=x");
    const elapsed = performance.now() - started;
    record({ check: "deliberate demonstration failure", milliseconds: [Number(elapsed.toFixed(3))] });
    expect(elapsed, "deliberate: no scan takes less than 0ms").toBeLessThan(0);
  });
});
