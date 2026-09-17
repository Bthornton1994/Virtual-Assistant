import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every file that can put words in front of a Release Rescue customer,
 * DISCOVERED rather than listed — and the extractor that reads the words.
 *
 * `AGENTS.md` makes `findProhibitedClaims` "the single list governing both
 * report text and the marketing surface". That was an aspiration until a test
 * applied it; it is now CI, and this module is the part that decides what CI
 * looks at. Getting that set wrong is how the governing claim becomes false
 * again without anything going red.
 *
 * Two hand-written lists have already failed here:
 *
 *   1. A list of 11 route and component files, which omitted `demo/[id]/page.tsx`,
 *      `demo/[id]/not-found.tsx` and `demo/report/download/route.ts`. Replaced by
 *      the walk below.
 *   2. Inside the function that replaced it, a two-entry push of "the library
 *      files that hold customer-visible WORDS rather than markup" — which was
 *      already incomplete when it was written. `intake.ts` holds
 *      `RETENTION_POLICY_COPY`, three sentences rendered verbatim as radio
 *      labels on the public intake form and again on the demo confirmation
 *      page, plus every intake error string a customer reads. A planted claim
 *      in it served over HTTP with the whole suite green.
 *
 * So the library directory is walked too, on the same rule as the routes. A
 * hand-written list inside the fix for a hand-written list is still a list.
 */
const SURFACE_ROOTS = [
  "src/app/(marketing)/ai-app-release-rescue",
  "src/components/ai-app-release-rescue",
  // Not markup, but customer-readable words all the same: offer copy, intake
  // labels, error strings, retention wording, price formatting.
  "src/lib/ai-app-release-rescue",
];

/** Test files and fixtures are not a customer surface; everything else in a root is. */
const NOT_A_SURFACE = /\.(test|test-fixtures)\.tsx?$/;

function discoverSurfaceFiles(): string[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name) && !NOT_A_SURFACE.test(entry.name)) found.push(child);
    }
  };
  for (const root of SURFACE_ROOTS) walk(root);
  return found.sort();
}

export const RELEASE_RESCUE_SURFACE_FILES = discoverSurfaceFiles();

/**
 * The set the walk must find, asserted exactly rather than as a floor.
 *
 * The floor this replaces was `> 12` against a set of 14, so the walk could
 * lose TWO files and still report success — including either of the two
 * `demo/[id]` routes the floor was written immediately after missing. The same
 * shape of assertion had already failed on the regression corpus, where a floor
 * could not tell 47 payloads from 50, and on the residual corpus, where
 * `toBeGreaterThan(0)` let a payload sit in a list of "evasions the guard
 * cannot see" for four rounds while the guard caught it.
 *
 * A floor is the right shape only when the quantity is genuinely unbounded
 * above. This is a set the codebase owns, so the set is the assertion, and a
 * rename that drops a surface names the file it dropped.
 */
export const EXPECTED_SURFACE_FILES = [
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/not-found.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/download/route.ts",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/intake/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/components/ai-app-release-rescue/intake-form.tsx",
  "src/components/ai-app-release-rescue/non-claims.tsx",
  "src/components/ai-app-release-rescue/offer-pricing.tsx",
  "src/components/ai-app-release-rescue/report-view.tsx",
  "src/components/ai-app-release-rescue/rubric-checklist.tsx",
  "src/lib/ai-app-release-rescue/constants.ts",
  "src/lib/ai-app-release-rescue/demo-cookie.ts",
  "src/lib/ai-app-release-rescue/demo-fixtures.ts",
  "src/lib/ai-app-release-rescue/engagement.ts",
  "src/lib/ai-app-release-rescue/index.ts",
  "src/lib/ai-app-release-rescue/intake.ts",
  "src/lib/ai-app-release-rescue/payment.ts",
];

/**
 * Text inside quotes and JSX text nodes — what a customer actually reads.
 *
 * The JSX branch used to be `/>\s*([A-Z][^<>{}\n]{12,})\s*</`, which stops at a
 * newline. Every real prose paragraph in these files is wrapped across lines by
 * the formatter, so the branch read none of them: a planted paragraph claiming
 * "your application is secure and free of vulnerabilities, and we deliver a
 * penetration test report" was invisible to CI, while the SAME sentence on one
 * line was caught. The shape of the formatting, not the content, decided whether
 * the guard ran.
 *
 * A JSX text node is now read across newlines and its whitespace collapsed
 * before matching, which is what a browser does to it anyway.
 */
export function visibleStrings(source: string): string[] {
  const quoted = [...source.matchAll(/"([^"\n]{12,})"|'([^'\n]{12,})'|`([^`]{12,})`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const jsxText = [...source.matchAll(/>([^<>{}]+)</g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((text) => /^[A-Z]/.test(text) && text.length >= 12);
  return [...quoted, ...jsxText];
}

export function readSurface(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}
