import { MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";

// The wall-clock growth gate's estimator and the inputs it is measured on.
//
// Shared by two files with different standing, and the difference is the point
// of the split (DECISION_LOG.md § D-019):
//
// - `release-rescue-credential-scanner.test.ts` tests the estimator itself on
//   recorded series, and the timed inputs' own properties. No clock. It is part
//   of `npm test` and blocks a release.
// - `release-rescue-scanner.timing-observation.ts` reads the clock through this
//   estimator. It is the advisory `timing-observation` check, run by
//   `npm run test:timing-observation`, and does not block a release.
//
// The scan's cost is gated for release by counting work instead of time, in
// `release-rescue-scan-work.test.ts` and `release-rescue-scan-block-work.test.ts`.

// Growth over real doublings, measured as the whole-range exponent.
//
// Linear is a 2x step (exponent 1.0); quadratic is a 4x step (exponent 2.0).
// S-005 replaced skippable per-step ratios with this exponent so a 20ms floor
// could not hide S-004 a second time. S-018 then replaced the exponent with
// the median of the three adjacent doubling ratios against 3.
//
// Audit 48 measured what that swap actually did, and the two gates turn out
// not to be ordered by strength: they ask different questions. A median of
// three discards the largest ratio, so a cost that only turns super-linear in
// the FINAL doubling passes it untouched. [1, 2, 4, 256] has a median ratio of
// 2.00 against a bar of 3, and a whole-range exponent of 2.667. The mirror
// case [1, 8, 16, 32] is the same: median 2.00, exponent 1.667. Neither series
// is noise. Both are growth the median cannot see, because the sample that
// carries the growth is the one the median throws away.
//
// So the whole-range exponent is the estimator, and the single number every
// series is measured against.
export const MAX_GROWTH_EXPONENT = 1.5;

/**
 * The whole-range growth exponent over a series of equal doublings.
 *
 * ORDER IS PART OF THE CALCULATION: the first and last samples are the
 * endpoints and the divisor is the number of steps between them, so the same
 * numbers in a different order are a different answer. `depends on the order
 * of the samples` pins that, because a future rewrite that sorts or reverses
 * the series would otherwise pass every other test.
 */
export function growthExponent(timings: readonly number[]): number {
  const doublings = timings.length - 1;
  return Math.log2(timings[doublings] / timings[0]) / doublings;
}

/**
 * THE gate. The live timing observation and the recorded-series table both
 * decide through this one function, so growth is judged in exactly one place.
 *
 * WHAT THAT BUYS: rewriting this function to judge by the median of adjacent
 * ratios instead - the S-018 change - fails the recorded-series table, which
 * is part of `npm test`, without any clock.
 *
 * WHAT IT DOES NOT BUY, stated because a partial guard described as a whole
 * one is how S-014 and S-018 happened. Deleting the call at the live timing
 * site and writing a median assertion inline there passes every blocking test.
 * No test can observe another test's assertion, so that residual is closed by
 * reading the diff, not by running it. What this function does is make such a
 * change a visible deletion rather than a silent drift.
 */
export function exceedsGrowthCeiling(timings: readonly number[]): boolean {
  const exponent = growthExponent(timings);

  // FAIL CLOSED on a number that is not a number. A zero timing is reachable:
  // `performance.now()` has finite resolution, so a fast enough scan can
  // measure 0, and two of them give 0 / 0 = NaN. Returning `NaN >= 1.5`, which
  // is false, would report such a run as within budget. The assertion this
  // helper replaced compared with `toBeLessThan` and failed on NaN by
  // accident; that behaviour is kept here on purpose.
  if (!Number.isFinite(exponent)) return true;

  return exponent >= MAX_GROWTH_EXPONENT;
}

/**
 * The shapes that made a previous version quadratic, plus the ones that made
 * the FIRST version of this scanner quadratic. Timed by the observation suite;
 * their sizes are checked, without a clock, by the blocking suite.
 */
export const TIMED_SHAPES: ReadonlyArray<[string, (size: number) => string]> = [
  ["scheme-like run", (n) => `a${".b".repeat(n / 2)}=value12345`],
  ["identifier run", (n) => `${"A".repeat(n)}_PASSWORD=x`],
  ["repeated colons", (n) => "password:".repeat(Math.floor(n / 9))],
  ["repeated flags", (n) => "--password ".repeat(Math.floor(n / 11))],
  ["repeated tags", (n) => "<password>".repeat(Math.floor(n / 10))],
  ["quotes", (n) => '"'.repeat(n)],
  ["pem prefix", (n) => `-----BEGIN ${"A ".repeat(n / 2)}`],
  // The four shapes that release-rescue-scanner-value-properties.test.ts
  // measured with an adjacent-ratio check at a clipped size (S-014). They are
  // measured here, by the exponent, and the ratio check is gone. Measured on
  // 2026-09-18: 1.25, 1.10, 1.01 and 1.00.
  ["repeated assignments", (n) => "password=".repeat(Math.ceil(n / 9)).slice(0, n)],
  ["repeated flags with values", (n) => "--password x ".repeat(Math.ceil(n / 13)).slice(0, n)],
  ["credential nouns in prose", (n) => "the password is not stored here. ".repeat(Math.ceil(n / 33)).slice(0, n)],
  ["repeated quoted assignments", (n) => 'password="a" '.repeat(Math.ceil(n / 13)).slice(0, n)],
];

// DERIVED from MAX_SCAN_LENGTH rather than written beside it. The previous
// sizes were literals that had drifted past the bound, which is how the last
// step came to be a 1.6x increase the comment called a doubling. Derived, they
// cannot drift again: every step doubles the text the scanner actually reads.
export const SCAN_SIZES: readonly number[] = [
  MAX_SCAN_LENGTH / 8,
  MAX_SCAN_LENGTH / 4,
  MAX_SCAN_LENGTH / 2,
  MAX_SCAN_LENGTH,
];
