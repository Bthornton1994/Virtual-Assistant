import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { RELEASE_RESCUE_OFFER } from "@/lib/release-rescue-intake";

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
 * Tags that do NOT interrupt a sentence. Everything else — every block-level
 * element — is left in place so it bounds its own text.
 */
const INLINE_TAG =
  /<\/?(?:strong|em|b|i|u|s|span|code|kbd|abbr|small|sup|sub|mark|cite|q|time|var|samp|wbr|br|a|Link|Wordmark)\b[^>]*\/?>/gi;


function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

/**
 * Resolve HTML entities, because JSX resolves them before a customer reads the
 * page and the extractor's whole contract is to see what the customer sees.
 *
 * This was the THIRD consecutive round of "formatting decides, not content":
 * a newline stopped the match, then inline markup fragmented it, then
 * `penetration&#32;test` hid it. All three passed the suite; the last two were
 * served at HTTP 200 from a real build. `&nbsp;` is not adversarial either —
 * `react/no-unescaped-entities` is enforced here, so this codebase already
 * writes entities in prose, and a non-breaking space is the ordinary way to
 * stop "penetration test" wrapping across two lines.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_whole, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_whole, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&(amp|lt|gt|quot|apos|hellip|mdash|ndash|shy|zwnj|zwj);/gi, (_whole, name) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        hellip: "...",
        mdash: "-",
        ndash: "-",
        shy: "",
        zwnj: "",
        zwj: "",
      };
      return named[String(name).toLowerCase()] ?? " ";
    });
}

/**
 * Does this file render markup at all?
 *
 * The `rendered` branch below splits on tags. In a plain `.ts` module there are
 * no tags, so the whole file collapses into one run and ordinary code is read as
 * prose: an audit showed `["fully", "secure", "partial"]` in a rubric constant
 * failing CI as the claim "fully secure". It fails CLOSED, so it never shipped
 * an overclaim — but the surface now includes general-purpose modules, and their
 * code is not customer text. Quoted strings in those files are still read; that
 * is where their customer-visible words actually live.
 */
export function rendersMarkup(source: string): boolean {
  return /<\/[A-Za-z]|\/>/.test(source);
}

/**
 * The literal words of one JSX text node, with its expressions removed — or
 * `null` when the run is code between two elements rather than text inside one.
 *
 * THIS REPLACED A HEURISTIC THAT COST COVERAGE. The previous version discarded
 * any run containing `;`, `{`, `}` or `=>` as "code". A JSX text node and the
 * expression inside it are ONE run between `>` and `<`, so a single `{price}`
 * threw the whole sentence away — and that is the dominant prose shape here. An
 * audit measured 14 runs of live customer copy going unread, including the
 * offer's own `<h1>`, and served four overclaims at HTTP 200 with the suite
 * green. A semicolon did the same thing to any sentence containing one.
 *
 * Worse, the commit before it caught all three of those shapes. Deleting
 * expressions and reading the words around them is what it did; this restores
 * that and keeps the tag-anchored reading that fixed the footer.
 *
 * Balanced braces are an expression and are removed. An UNBALANCED brace means
 * the run spans a function body or a `.map()` — that is code, and code is the
 * only thing dropped.
 */
function literalTextOf(run: string): string | null {
  let text = "";
  let depth = 0;
  for (const character of run) {
    if (character === "{") {
      depth += 1;
      continue;
    }
    if (character === "}") {
      if (depth === 0) return null;
      depth -= 1;
      continue;
    }
    if (depth === 0) text += character;
  }
  if (depth !== 0) return null;
  // What survives with an arrow or a declaration keyword in it is a fragment of
  // source, not a sentence. Prose keeps its semicolons.
  if (/=>|\b(?:function|return|export|import|const|await)\b/.test(text)) return null;
  return text;
}

/**
 * The shortest string that could possibly BE a prohibited claim, derived from
 * the claim list rather than chosen.
 *
 * Both branches used a flat 12 characters, which is longer than five of the 24
 * claims — `pen test`, `pen testing`, `pentest`, `pentesting` and `is secure`
 * were invisible standing alone in an element, and an audit found that none of
 * them was recorded as a residual either. Measuring the alternative cost
 * nothing: dropping to this floor across all 61 files adds 22 runs and produces
 * zero new findings, so there was no precision being bought by the larger
 * number.
 */
const SHORTEST_POSSIBLE_CLAIM = Math.min(...RELEASE_RESCUE_OFFER.prohibitedClaims.map((claim) => claim.length));

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

  const quotedPattern = new RegExp(
    `"([^"\\n]{${SHORTEST_POSSIBLE_CLAIM},})"|'([^'\\n]{${SHORTEST_POSSIBLE_CLAIM},})'|\`([^\`]{${SHORTEST_POSSIBLE_CLAIM},})\``,
    "g",
  );
  const quoted = [...code.matchAll(quotedPattern)].map((match) =>
    decodeEntities(match[1] ?? match[2] ?? match[3] ?? ""),
  );

  if (!rendersMarkup(code)) return quoted;

  // Anchor on TAGS, never on braces.
  //
  // The previous version deleted `{...}` spans to drop expression containers.
  // `\{[^{}]*\}` cannot tell a JSX container from a JavaScript block, so any
  // component whose body happens to contain no nested braces had its ENTIRE
  // body deleted before a single word was read — `MarketingFooter` among them.
  // A planted claim in the site footer, rendered on every Release Rescue page,
  // was invisible for that reason and served at HTTP 200.
  //
  // Reading only what sits between a `>` and a `<` needs no brace handling at
  // all: inline tags are removed first so a sentence they split joins back up,
  // and block-level tags stay in place so each run is the text of one element
  // and two unrelated paragraphs are never spliced into a claim neither makes.
  const markup = code
    .replace(/\{\s*(["'`])((?:(?!\1).)*)\1\s*\}/g, "$2")
    .replace(INLINE_TAG, "");

  const rendered = [...markup.matchAll(/>([^<>]*)</g)]
    .map((match) => literalTextOf(match[1]))
    .filter((text): text is string => text !== null)
    .map((text) => decodeEntities(text).replace(/\s+/g, " ").trim())
    // No space requirement: `pentest` alone in an element is the claim, and the
    // structural rules above already exclude code.
    .filter((text) => text.length >= SHORTEST_POSSIBLE_CLAIM);

  return [...quoted, ...rendered];
}

export function readSurface(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}
