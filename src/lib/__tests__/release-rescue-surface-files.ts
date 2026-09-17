import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Every file that can put words in front of a Release Rescue customer, DERIVED
 * from what the rendered routes import — and the extractor that reads the words.
 *
 * `AGENTS.md` makes `findProhibitedClaims` "the single list governing both
 * report text and the marketing surface". Deciding WHICH files that covers has
 * now failed three times, each time by a hand-written list, and each fix
 * contained the next list:
 *
 *   1. A list of 11 route and component files. It omitted `demo/[id]/page.tsx`,
 *      `demo/[id]/not-found.tsx` and `demo/report/download/route.ts`.
 *   2. Replaced by a directory walk — which pushed two library files by hand as
 *      "the two library files that hold customer-visible WORDS". Already wrong:
 *      `intake.ts` holds `RETENTION_POLICY_COPY` and every intake error string.
 *   3. Replaced by walking the library directory too — leaving a list of two
 *      ROOT DIRECTORIES. Also already wrong: `src/app/actions/ai-app-release-rescue.ts`
 *      returns `"Check the highlighted fields. Nothing was stored."` into a
 *      `role="alert"` div, and `release-rescue-presentation.ts` holds
 *      `UNAVAILABLE_TEXT`, rendered into the customer's report. A planted claim
 *      in either survived the whole suite.
 *
 * A directory is not what makes a file customer-facing; being reachable from a
 * rendered route is. So the set is the import graph rooted at the route
 * entrypoints, and no one has to remember anything. A new module reaches a
 * customer the moment a route imports it, and it is checked that moment.
 */
const ROUTE_ENTRY_DIR = "src/app/(marketing)/ai-app-release-rescue";

/** Test files and fixtures are not a customer surface; everything else reachable is. */
const NOT_A_SURFACE = /\.(test|test-fixtures)\.tsx?$/;

function listRouteEntrypoints(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) listRouteEntrypoints(child, found);
    else if (/\.tsx?$/.test(entry.name) && !NOT_A_SURFACE.test(entry.name)) found.push(child);
  }
  return found;
}

/** Resolve an import specifier to a repository-relative file, or null if it leaves the tree. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join("src", specifier.slice(2));
  else if (specifier.startsWith(".")) base = join(dirname(fromFile), specifier);
  else return null; // a package, not our source
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    const full = resolve(process.cwd(), candidate);
    if (existsSync(full) && statSync(full).isFile()) return candidate.replace(/\\/g, "/");
  }
  return null;
}

function discoverSurfaceFiles(): string[] {
  const reached = new Set<string>();
  const queue = listRouteEntrypoints(ROUTE_ENTRY_DIR);
  queue.forEach((file) => reached.add(file));

  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
      const target = resolveImport(match[1], file);
      if (target && !reached.has(target) && !NOT_A_SURFACE.test(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return [...reached].sort();
}

export const RELEASE_RESCUE_SURFACE_FILES = discoverSurfaceFiles();

/**
 * The set the graph must yield, asserted exactly rather than as a floor.
 *
 * The floor this replaces was `> 12` against a set of 14, so the walk could
 * lose TWO files and still report success. The same shape had already failed on
 * the regression corpus (a floor cannot tell 47 payloads from 50) and on the
 * residual corpus (`toBeGreaterThan(0)` certified a payload the guard actually
 * caught). A floor is the right shape only where the quantity is genuinely
 * unbounded above; this is a set the codebase owns.
 *
 * It is deliberately wider than "the Release Rescue directories": a shared
 * primitive or an auth helper reached by a rendered route CAN put words on the
 * page, and a change to this list means the customer-reachable set moved, which
 * is worth a look rather than a silent pass.
 */
export const EXPECTED_SURFACE_FILES = [
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/not-found.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/download/route.ts",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/intake/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/app/actions/ai-app-release-rescue.ts",
  "src/components/ai-app-release-rescue/intake-form.tsx",
  "src/components/ai-app-release-rescue/non-claims.tsx",
  "src/components/ai-app-release-rescue/offer-pricing.tsx",
  "src/components/ai-app-release-rescue/report-view.tsx",
  "src/components/ai-app-release-rescue/rubric-checklist.tsx",
  "src/components/ui.tsx",
  "src/lib/ai-app-release-rescue/constants.ts",
  "src/lib/ai-app-release-rescue/demo-cookie.ts",
  "src/lib/ai-app-release-rescue/demo-fixtures.ts",
  "src/lib/ai-app-release-rescue/engagement.ts",
  "src/lib/ai-app-release-rescue/intake.ts",
  "src/lib/ai-app-release-rescue/payment.ts",
  "src/lib/ai.ts",
  "src/lib/auth-cookie.ts",
  "src/lib/auth.ts",
  "src/lib/capability-registry.ts",
  "src/lib/catalog-evidence-hash.ts",
  "src/lib/catalog-evidence-packet.ts",
  "src/lib/catalog-evidence-review.ts",
  "src/lib/catalog-evidence-shared.ts",
  "src/lib/catalog-evidence-validator.ts",
  "src/lib/cn.ts",
  "src/lib/domain.ts",
  "src/lib/executor-envelope.ts",
  "src/lib/release-rescue-credential-scanner.ts",
  "src/lib/release-rescue-demo-identity.ts",
  "src/lib/release-rescue-field-policy.ts",
  "src/lib/release-rescue-findings-model.ts",
  "src/lib/release-rescue-findings.ts",
  "src/lib/release-rescue-intake.ts",
  "src/lib/release-rescue-observation-catalog.ts",
  "src/lib/release-rescue-pipeline.ts",
  "src/lib/release-rescue-presentation.ts",
  "src/lib/release-rescue-redaction-keys.ts",
  "src/lib/release-rescue-redaction.ts",
  "src/lib/release-rescue-report.ts",
  "src/lib/release-rescue-rubric.ts",
  "src/lib/release-rescue-secret-classification.ts",
  "src/lib/store.ts",
  "src/lib/supabase/env.ts",
  "src/lib/supabase/server.ts",
];

/**
 * Files that legitimately contain prohibited claim text, each with a reason.
 *
 * A file reachable from a route is checked unless it is declared here, and a
 * declaration needs a reason — the same shape as `REPORT_FIELD_POLICY`, where an
 * unexplained exemption is how coverage rots. The test asserts this map's keys
 * are exactly the files that need it: a stale exemption fails as loudly as a
 * missing one, so this cannot quietly become a place to silence a real hit.
 */
export const DECLARED_CLAIM_BEARING_FILES: Readonly<Record<string, string>> = {
  "src/lib/release-rescue-intake.ts":
    "This file IS the prohibited-claims list. `RELEASE_RESCUE_OFFER.prohibitedClaims` holds all 24 phrases as bare strings so the guard can match them; a guard that refused its own vocabulary could not exist. Nothing here is rendered — the offer's customer-facing copy lives in `constants.ts` and is checked.",
};

/**
 * Text a customer can actually read: quoted strings and rendered JSX text.
 *
 * Comments are stripped first. A comment is not customer-visible, and this
 * codebase documents its own attack payloads in prose — reading those as copy
 * would make the check fire on its own explanations.
 *
 * TWO FORMATTING DEFECTS, both found by audits, both fixed here:
 *
 *   1. The JSX branch was `/>\s*([A-Z][^<>{}\n]{12,})\s*</`, which stops at a
 *      newline. Every real paragraph is wrapped by the formatter, so none was
 *      read, while the identical sentence on one line was caught.
 *   2. Fixing the newline left the same defect through markup: `{}` and `<>` in
 *      the character class meant inline tags FRAGMENTED a sentence, and the
 *      `^[A-Z]` filter then discarded every continuation. `We deliver a
 *      <strong>penetration test</strong> of your application.` was served over
 *      HTTP with the suite green; the same words without the tags were caught.
 *
 * So the formatting is normalised the way a browser resolves it, rather than
 * pattern-matched: string literals inside expression containers are substituted,
 * other containers and BLOCK-level tags become boundaries, and every remaining
 * (inline) tag is transparent so the text around it joins up. Block tags stay
 * boundaries so two unrelated paragraphs cannot be spliced into a claim neither
 * one makes.
 */
const BLOCK_LEVEL_TAG =
  /<\/?(?:p|div|li|ul|ol|h[1-6]|section|article|header|footer|main|nav|form|label|button|option|td|th|tr|table|blockquote|dl|dt|dd|figure|figcaption|aside|pre)\b[^>]*>/gi;

const TEXT_BOUNDARY = " ";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

export function visibleStrings(source: string): string[] {
  let code = stripComments(source);

  // `"Your application is " + "secure and audited."` renders as one sentence and
  // read as two literals carries no claim. Fold adjacent literals before
  // matching. Bounded rather than `while (true)`: a chain longer than this is
  // not prose anyone wrote by hand.
  for (let pass = 0; pass < 8; pass += 1) {
    const folded = code.replace(
      /(["'`])((?:(?!\1)[^\\])*)\1\s*\+\s*(["'`])((?:(?!\3)[^\\])*)\3/g,
      (_whole, _open, left, _open2, right) => `"${left}${right}"`,
    );
    if (folded === code) break;
    code = folded;
  }

  const quoted = [...code.matchAll(/"([^"\n]{12,})"|'([^'\n]{12,})'|`([^`]{12,})`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );

  const rendered = code
    // `{"secure"}` renders as the word; keep it in the sentence it sits in.
    .replace(/\{\s*(["'`])((?:(?!\1).)*)\1\s*\}/g, "$2")
    .replace(/\{[^{}]*\}/g, ` ${TEXT_BOUNDARY} `)
    .replace(BLOCK_LEVEL_TAG, TEXT_BOUNDARY)
    .replace(/<[^>]*>/g, "")
    .split(TEXT_BOUNDARY)
    .map((text) => text.replace(/\s+/g, " ").trim())
    // A run of prose has a space in it. Requiring a leading capital is what let
    // a continuation segment through.
    .filter((text) => text.length >= 12 && text.includes(" "));

  return [...quoted, ...rendered];
}

export function readSurface(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}
