import { MAX_INTAKE_FIELD_LENGTH } from "@/lib/ai-app-release-rescue/intake";
import { MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";

// The inputs the scan's cost is measured on, shared by the two work-count tests
// (`release-rescue-scan-work.test.ts` and `release-rescue-scan-block-work.test.ts`)
// so they measure one definition of each shape. The timing growth test keeps its
// own list. A shape that silently stops reaching the path it names measures
// nothing, and that is exactly how the unterminated carrier shape below went
// wrong once: see its comment.

/** Growth across the whole range, over counted work rather than over time. */
export function workExponent(counts: readonly number[]): number {
  const doublings = counts.length - 1;
  return Math.log2(counts[doublings] / counts[0]) / doublings;
}

// Sizes derived from the bound, so every step is one real doubling of the text
// the span scan actually reads, exactly as the growth test derives them.
export const SCAN_SIZES: readonly number[] = [
  MAX_SCAN_LENGTH / 8,
  MAX_SCAN_LENGTH / 4,
  MAX_SCAN_LENGTH / 2,
  MAX_SCAN_LENGTH,
];

// The same doublings up to the largest field the unauthenticated intake path
// scans. `SCAN_SIZES` starts at `MAX_SCAN_LENGTH / 8`, which is that size today,
// so without this series a regression confined to field-sized inputs would be
// measured at one size only. It starts at 2K (a quarter of today's field)
// rather than 1K. Near the end of the input a value is read for less than its
// full `MAX_VALUE_LENGTH`, a fixed deficit in an otherwise linear count, and at
// 1K that deficit alone made a two-point ratio on repeated colons read 1.37: a
// 25% larger cap would have read it above 1.5 on work that is still linear.
// The protection is the 2K start, not the ratio: a field cap below about 4,000
// would bring the small first size, and the misreading, back.
export const FIELD_SIZES: readonly number[] = [
  MAX_INTAKE_FIELD_LENGTH / 4,
  MAX_INTAKE_FIELD_LENGTH / 2,
  MAX_INTAKE_FIELD_LENGTH,
];

/** Both series, by name. Every work-count bound applies to each. */
export const SERIES: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["field", FIELD_SIZES],
  ["scan", SCAN_SIZES],
];

/** The highest count per input character anywhere in a series. */
export function worstPerCharacter(counts: readonly number[], sizes: readonly number[]): number {
  return Math.max(...counts.map((count, index) => count / sizes[index]));
}

/** The smallest growth across one doubling of a series. */
export function smallestStep(counts: readonly number[]): number {
  let smallest = Infinity;
  for (let index = 1; index < counts.length; index += 1) {
    smallest = Math.min(smallest, counts[index] / counts[index - 1]);
  }
  return smallest;
}

/**
 * Doubling the input may not cut the work by more than half. An exponent reads
 * only the ends of a series, so a slow path that runs below some size and a
 * fast one above it can give a flat, passing exponent; the doubling that
 * crosses the switch is where the cost falls. On the fixed scanner the
 * smallest step on any counter is 1.661 (`indexOf`, repeated assignments, field
 * sizes). Rewriting the tokenizer as one global regular expression, which
 * changes no behaviour, steps 0.706, where the truncated 64K scheme-like run
 * does less work. The per-key walk or the pre-PR XML branch switched on below
 * or above a measured size steps 0.009 to 0.395 at the switch. A switch that
 * turns on and off between two measured sizes is not seen.
 */
export const MIN_STEP_GROWTH = 0.5;

/** `unit` repeated to exactly `size` characters. */
export function fill(unit: string, size: number): string {
  return unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
}

/** The quoted key the XML-attribute shapes repeat. */
export const QUOTED_KEY = '"password" ';

/**
 * The shapes that carry the defects these tests exist to keep fixed, plus
 * the ones the growth test measures. Every shape here except the indented
 * block-scalar lines is a SINGLE LINE with no newline in it, which is the input
 * that makes a line-start search scan the whole prefix and a line-end search
 * scan the whole suffix.
 */
export const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  // `restOfLineValueSpan` asked for a line start once per assignment.
  ["repeated assignments", (n) => "password=".repeat(Math.ceil(n / 9)).slice(0, n)],
  // `valueSpan` asked for the next `)` and the next newline once per value.
  ["repeated colons", (n) => "password:".repeat(Math.floor(n / 9))],
  ["repeated quoted assignments", (n) => 'password="a" '.repeat(Math.ceil(n / 13)).slice(0, n)],
  // The shape S-004 was measured on.
  ["repeated tags", (n) => "<password>".repeat(Math.floor(n / 10))],
  // The noun-driven path, which is the one S-004 lived in.
  ["credential nouns in prose", (n) => "the password is not stored here. ".repeat(Math.ceil(n / 33)).slice(0, n)],
  // A value run that really does end at `(`, so the guarded lookups are the
  // ones that run rather than the ones that are skipped.
  ["assignments ending at a paren", (n) => "password=a( ".repeat(Math.ceil(n / 12)).slice(0, n)],
  ["repeated flags", (n) => "--password ".repeat(Math.floor(n / 11))],
  ["repeated flags with values", (n) => "--password x ".repeat(Math.ceil(n / 13)).slice(0, n)],
  ["scheme-like run", (n) => `a${".b".repeat(n / 2)}=value12345`],
  ["identifier run", (n) => `${"A".repeat(n)}_PASSWORD=x`],
  ["quotes", (n) => '"'.repeat(n)],
  ["pem prefix", (n) => `-----BEGIN ${"A ".repeat(n / 2)}`],
  // The XML-attribute form asked, once per quoted key, where the tag ends and
  // whether a `value=` follows before it. With no `>` both searches ran to the
  // end of the input every time.
  ["quoted keys in a tag with no end", (n) => fill(QUOTED_KEY, n)],
  // Every key shares one carrier whose value has no closing quote, so each key
  // also walked to the end of the input and classified the same long value.
  //
  // WHOLE KEYS ONLY. This was `fill(QUOTED_KEY, n / 2)`, which cuts the last key
  // mid-word at three of the four sizes: `"passwovalue="` has no word boundary
  // before `value`, so there was no carrier at all at 8K, 16K and 32K, and the
  // exponent, which reads the smallest and largest sizes, compared a size that
  // skipped the carrier path with one that took it. The work-count test now pins the text's structure and the carrier
  // spans at every size, so a shape that stops reaching its path fails rather
  // than measuring nothing.
  ["quoted keys sharing one unterminated value", (n) => {
    const keys = QUOTED_KEY.repeat(Math.floor(n / 2 / QUOTED_KEY.length));
    return `${keys}value="${"x".repeat(n - keys.length - 7)}`;
  }],
  // The block-scalar form asked for the next newline once per indicator.
  ["block scalars with no newline", (n) => fill("password: | ", n)],
  // And then walked every following indented line, once per indicator, to find
  // an end it never used.
  ["indented block-scalar lines", (n) => fill("  password: |\n", n)],
];

/** The shape registered under `label`; throws rather than measuring nothing. */
export function shape(label: string): (size: number) => string {
  const found = SHAPES.find(([name]) => name === label);
  if (!found) throw new Error(`no shape named ${label}`);
  return found[1];
}

/**
 * Linear is 1.0 and quadratic is 2.0 over three real doublings. The bar sits
 * between them with room on both sides that was measured rather than guessed:
 * see each counter's own figures in the test that applies it.
 */
export const MAX_WORK_EXPONENT = 1.5;
