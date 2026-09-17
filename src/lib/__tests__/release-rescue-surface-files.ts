import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

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
const APP_DIR = "src/app";
const ROUTE_DIR = "src/app/(marketing)/ai-app-release-rescue";

/**
 * The offer's own name. A page anywhere in the app that sells this offer is a
 * Release Rescue surface wherever it lives — `(marketing)/pricing/page.tsx`
 * names it and quotes both prices, and it sat outside a set that was rooted at
 * one directory.
 */
const OFFER_NAME = "Release Rescue";

/** Test files and fixtures are not a customer surface; everything else reachable is. */
const NOT_A_SURFACE = /\.(test|test-fixtures)\.tsx?$/;

/**
 * The files Next renders AROUND a page, by its own routing rules rather than by
 * anyone's memory.
 *
 * This is the fourth time the "which files" question has been answered wrongly,
 * and the third mechanism to fail at it. Rooting the import graph at the route
 * directory looked derived, but the ENTRY SET was still a hand-written answer:
 * Next wraps every page in the ancestor `layout.tsx` chain from `src/app` down,
 * and `(marketing)/layout.tsx` renders `<MarketingHeader />` and
 * `<MarketingFooter />` on every Release Rescue page. An audit put a claim in
 * the footer and served it at HTTP 200 on three Release Rescue routes with the
 * whole suite green.
 *
 * So the chain is derived from the filesystem the way the framework derives it.
 */
const RENDERED_AROUND_A_PAGE = /^(layout|template|error|global-error|not-found|loading)\.tsx?$/;

function ancestorChainFor(dir: string): string[] {
  const found: string[] = [];
  const segments = dir.split("/");
  // Every level from `src/app` down to and including the route directory.
  for (let depth = APP_DIR.split("/").length; depth <= segments.length; depth += 1) {
    const level = segments.slice(0, depth).join("/");
    for (const entry of readdirSync(resolve(process.cwd(), level), { withFileTypes: true })) {
      if (!entry.isDirectory() && RENDERED_AROUND_A_PAGE.test(entry.name)) found.push(`${level}/${entry.name}`);
    }
  }
  return found;
}

function filesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) filesUnder(child, found);
    else if (/\.tsx?$/.test(entry.name) && !NOT_A_SURFACE.test(entry.name)) found.push(child);
  }
  return found;
}

/** Any page in the app that sells this offer by name, plus what Next wraps it in. */
function pagesNamingTheOffer(): string[] {
  return filesUnder(APP_DIR)
    .filter((file) => /\/page\.tsx?$/.test(file))
    .filter((file) => readFileSync(resolve(process.cwd(), file), "utf8").includes(OFFER_NAME));
}

function listRouteEntrypoints(): string[] {
  const entries = new Set<string>(filesUnder(ROUTE_DIR));
  for (const file of ancestorChainFor(ROUTE_DIR)) entries.add(file);
  for (const page of pagesNamingTheOffer()) {
    entries.add(page);
    for (const file of ancestorChainFor(page.slice(0, page.lastIndexOf("/")))) entries.add(file);
  }
  return [...entries];
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
  const queue = listRouteEntrypoints();
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
  "src/app/(marketing)/layout.tsx",
  "src/app/(marketing)/pricing/page.tsx",
  "src/app/actions/ai-app-release-rescue.ts",
  "src/app/actions/auth.ts",
  "src/app/error.tsx",
  "src/app/layout.tsx",
  "src/app/not-found.tsx",
  "src/components/ai-app-release-rescue/intake-form.tsx",
  "src/components/ai-app-release-rescue/non-claims.tsx",
  "src/components/ai-app-release-rescue/offer-pricing.tsx",
  "src/components/ai-app-release-rescue/report-view.tsx",
  "src/components/ai-app-release-rescue/rubric-checklist.tsx",
  "src/components/brand.tsx",
  "src/components/marketing/chrome.tsx",
  "src/components/marketing/skip-to-content.tsx",
  "src/components/nav-link.tsx",
  "src/components/shells.tsx",
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
  "src/lib/deployment-origin.ts",
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
/**
 * What a customer can actually read: rendered JSX text and string literals,
 * extracted with the TYPESCRIPT PARSER rather than with regular expressions.
 *
 * FOUR CONSECUTIVE ROUNDS of this were hand-rolled JSX parsing, and every one
 * of them lost detections it did not know it had:
 *
 *   - `/>\s*([A-Z][^<>{}\n]{12,})\s*</` stopped at a NEWLINE, so every wrapped
 *     paragraph was invisible while the same sentence on one line was caught.
 *   - Its replacement excluded `<>{}` from the class, so INLINE MARKUP
 *     fragmented a sentence and a leading-capital filter dropped the rest.
 *   - Dropping `\{[^{}]*\}` could not tell a JSX container from a JavaScript
 *     block, so any component body without nested braces was deleted whole.
 *   - Anchoring on tags and rejecting runs with `;` `{` `}` `=>` threw away any
 *     sentence containing an interpolation or a semicolon, then a keyword list
 *     threw away sentences containing the English words "return", "export" and
 *     "function", and a length floor of 7 mis-paired quote delimiters so that a
 *     literal after a short one went unread.
 *
 * Three of those were served at HTTP 200 from a real build with the whole suite
 * green. Each fix was a new heuristic, and each new heuristic was the next
 * round's finding. The parser is not a better heuristic — it removes the
 * category. A `JsxText` node is text because the grammar says so, a
 * `StringLiteral` is a string because the grammar says so, and neither
 * punctuation, nor formatting, nor an English word can change that.
 *
 * What is emitted:
 *   - every string literal and template literal part, and the concatenation of
 *     a `+` chain or a template's literal parts, so a claim split across pieces
 *     is read as the sentence it renders as;
 *   - for every JSX element and fragment, the text of all its descendants run
 *     together, which is what the browser shows and which no markup can split.
 *
 * Comments are excluded by construction: the grammar knows they are not text,
 * so the codebase can keep documenting its own attack payloads in prose.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_whole, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_whole, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&(amp|lt|gt|quot|apos|hellip|mdash|ndash|shy|zwnj|zwj);/gi, " ");
}

function tidy(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim();
}

/** Every string literal in a `+` chain, so `"a " + "b"` reads as `"a b"`. */
function concatenatedParts(node: ts.Expression, into: string[]): void {
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    concatenatedParts(node.left, into);
    concatenatedParts(node.right, into);
    return;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) into.push(node.text);
}

/** All descendant JSX text of one element, run together the way a browser renders it. */
function renderedTextOf(element: ts.Node): string {
  const parts: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isJsxText(node)) parts.push(node.text);
    else if (ts.isJsxExpression(node)) {
      const inner = node.expression;
      if (inner && (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))) parts.push(inner.text);
    }
    node.forEachChild(walk);
  };
  element.forEachChild(walk);
  return tidy(parts.join(" "));
}

export function visibleStrings(source: string): string[] {
  const parsed = ts.createSourceFile("surface.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(tidy(node.text));
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      for (const part of parts) found.push(tidy(part));
      // And the sentence the template renders as, minus its interpolations.
      found.push(tidy(parts.join(" ")));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const parts: string[] = [];
      concatenatedParts(node, parts);
      if (parts.length > 1) found.push(tidy(parts.join("")));
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      found.push(renderedTextOf(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);

  // No length floor. One was introduced at 12 characters, which was longer than
  // five of the 24 prohibited claims, and lowering it to 7 mis-paired quote
  // delimiters and blinded 73 positions the previous commit could see. The
  // parser returns text, so there is nothing to filter for — an empty string is
  // the only thing dropped.
  return found.filter((text) => text.length > 0);
}

/** Whether the file contains any JSX at all, for the vacuity guard. */
export function rendersMarkup(source: string): boolean {
  const parsed = ts.createSourceFile("surface.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let hasJsx = false;
  const visit = (node: ts.Node): void => {
    if (hasJsx) return;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {
      hasJsx = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return hasJsx;
}

export function readSurface(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}
