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

/** The modules this offer owns outright. */
const OFFER_MODULE = /^src\/(?:lib|components)\/(?:ai-app-release-rescue\/|release-rescue-)/;

/**
 * Every file the app serves that sells this offer, found structurally.
 *
 * FIFTH AND SIXTH TIME. This question has been answered with a hand-written
 * list five times, and each fix contained the next one. The last two were both
 * inside the repair for the one before:
 *
 *   - the entry filter was `/\/page\.tsx?$/`. Next serves `route.ts`,
 *     `default.tsx`, `opengraph-image.tsx`, `sitemap.ts` and more from the same
 *     tree, so a route handler importing this offer's own constants, printing
 *     its name and price beside a prohibited claim, was never even a candidate;
 *   - "reaches an offer module" was a DIRECTORY pattern, so a page whose only
 *     tie to the offer was its name held in a shared copy module fell through
 *     every test. That page was served at HTTP 200 with the claim beside the
 *     price, whole suite green.
 *
 * Both are the shape the previous commit was written to remove, one notch in.
 * So neither the file's NAME nor a module's DIRECTORY decides anything now:
 *
 *   a served file is a surface when anything it can reach either belongs to
 *   this offer or says this offer's name.
 *
 * Saying the name counts whether it is a literal in the source or text the page
 * renders, so a shared copy module pulls in every page that reaches it. What is
 * still outside: a file that reaches neither, and names the offer only through a
 * value computed at runtime. That bound is recorded in ENTRY_RESIDUALS below
 * rather than left to be found by the next audit.
 */
const statesTheOffer = new Map<string, boolean>();

function namesTheOffer(file: string): boolean {
  const remembered = statesTheOffer.get(file);
  if (remembered !== undefined) return remembered;
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const answer = source.includes(OFFER_NAME) || visibleStrings(source, file).some((text) => text.includes(OFFER_NAME));
  statesTheOffer.set(file, answer);
  return answer;
}

function filesSellingTheOffer(): string[] {
  return filesUnder(APP_DIR).filter((file) =>
    reachableFrom(file).some((reached) => OFFER_MODULE.test(reached) || namesTheOffer(reached)),
  );
}

const reachedFromCache = new Map<string, string[]>();

/** Every repository file reachable from one entrypoint by import. */
function reachableFrom(entry: string): string[] {
  const remembered = reachedFromCache.get(entry);
  if (remembered) return remembered;
  const reached = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    // Bare side-effect imports and `require` count too: a module reached only
    // that way still renders, and the previous pattern could not see either.
    for (const match of source.matchAll(
      /(?:from\s+|import\s*\(\s*)["']([^"']+)["']|import\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']/g,
    )) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;
      const target = resolveImport(specifier, file);
      if (target && !reached.has(target) && !NOT_A_SURFACE.test(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  const all = [...reached];
  reachedFromCache.set(entry, all);
  return all;
}

/**
 * What the ENTRY RULE cannot see, recorded for the same reason the extractor's
 * residuals are: the miss that produced this round had been sitting in an
 * unrecorded class, and nobody had written the class down.
 *
 * The rule reads imports and stated text. It cannot read a name a program
 * computes, and it cannot follow an import whose specifier is computed.
 */
export type EntryResidual = { readonly mechanism: "computed_name" | "computed_import"; readonly why: string };

export const ENTRY_RESIDUALS: readonly EntryResidual[] = [
  {
    mechanism: "computed_name",
    why: "A served file that reaches no offer module and assembles the offer's name at runtime — `[\"AI App\", \"Release\", \"Rescue\"].join(\" \")` — states it nowhere a parser can read.",
  },
  {
    mechanism: "computed_import",
    why: "A dynamic `import(`./${name}`)` specifier cannot be resolved statically, so a module reached only that way is outside every graph this file walks.",
  },
];

function listRouteEntrypoints(): string[] {
  const entries = new Set<string>(filesUnder(ROUTE_DIR));
  for (const file of ancestorChainFor(ROUTE_DIR)) entries.add(file);
  for (const served of filesSellingTheOffer()) {
    entries.add(served);
    for (const file of ancestorChainFor(served.slice(0, served.lastIndexOf("/")))) entries.add(file);
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
  "src/app/(app)/layout.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/not-found.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/download/route.ts",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/intake/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/app/(marketing)/layout.tsx",
  "src/app/(marketing)/pricing/page.tsx",
  "src/app/(ops)/layout.tsx",
  "src/app/actions/ai-app-release-rescue.ts",
  "src/app/actions/auth.ts",
  "src/app/api/internal/release-rescue/retention-sweep/route.ts",
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
  "src/lib/release-rescue-retention-schedule.ts",
  "src/lib/release-rescue-rubric.ts",
  "src/lib/release-rescue-secret-classification.ts",
  "src/lib/store.ts",
  "src/lib/supabase/admin.ts",
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
 *
 * THE TRADE THIS MAKES, stated because the comment it replaced claimed the
 * opposite and was left standing for a commit. Running an element's descendants
 * together means a wrapper's children are read as one sentence, so text that
 * never renders adjacent can still be joined:
 *
 *     <h3>What the review is</h3><li>Secure, read-only access…</li>
 *       -> "…the review is Secure, read-only access…"  flags `is secure`
 *     <dt>Vulnerabilities found</dt><dd>no</dd><dt>Vulnerabilities fixed</dt><dd>no</dd>
 *       -> "Vulnerabilities found no Vulnerabilities fixed no"  flags `no vulnerabilities`
 *
 * That second one was first written here as a SINGLE dt/dd pair, which does not
 * flag — "Vulnerabilities found no" never puts `no` before `vulnerabilities`.
 * An audit measured it and was right. It takes two pairs for the join to bring
 * those two words together, and both examples above are measured as written.
 *
 * Neither child carries a claim. Both are plausible copy for THIS product. The
 * direction is fail-closed — a false positive stops a build, it never delivers
 * an overclaim — and the alternative, bounding runs by a list of block-level
 * tags, is the hand-written list that failed four rounds running. So the join is
 * deliberate and the cost is a rewording, not a silent pass. An author who hits
 * it cannot buy their way out with an exemption either: only the module that
 * defines the claim list may be declared.
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

/**
 * A file the parser could not read is not a file with no text in it.
 *
 * `createSourceFile` is error-tolerant: it returns a tree for anything. An
 * unterminated block comment reduces a component to zero strings, and a legacy
 * `<string>value` type assertion — valid TypeScript that `tsc` and `next build`
 * both accept — parses under TSX as one enormous JsxText and swallows the file.
 * Either way the extractor would report "nothing to check" and the per-file test
 * would pass on silence. The surface test asserts this is empty for every file.
 */
export function parseProblems(file: string, source: string): readonly string[] {
  const parsed = parseSurface(file, source) as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] };
  return (parsed.parseDiagnostics ?? []).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
  );
}

function parseSurface(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function visibleStrings(source: string, file = "surface.tsx"): string[] {
  const parsed = parseSurface(file, source);
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
export function rendersMarkup(source: string, file = "surface.tsx"): boolean {
  const parsed = parseSurface(file, source);
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

/**
 * What the EXTRACTOR cannot see, recorded as an exact set.
 *
 * The tokenizer's residuals are kept this way in
 * `release-rescue-claim-guard-residuals.ts`, under the rule that a bound should
 * be a measurement rather than a silence. The extractor had no such record, and
 * an audit found the gap by walking straight through it: the entry set was fixed
 * to read RENDERED text, which still could not see `{RESCUE_SERVICE_NAME}`,
 * because an identifier is not a literal. That miss was in this class the whole
 * time and nobody had written the class down.
 *
 * Static extraction reads text the source states. It cannot read text the
 * program computes. Everything below renders a claim to a customer and is
 * invisible here — measured, each one, not supposed.
 */
export type ExtractorResidual = {
  readonly mechanism: "identifier" | "computed" | "cross_component" | "non_jsx_element";
  /** Source the extractor sees. */
  readonly source: string;
  /**
   * What a customer reads when it runs. Declared, because a residual that does
   * not actually render a claim proves nothing by being invisible — two entries
   * here were once prose with no claim in them and passed for exactly that
   * reason, until an audit executed them.
   */
  readonly renders: string;
};

export const EXTRACTOR_RESIDUALS: readonly ExtractorResidual[] = [
  // The sentence exists only after an identifier is resolved.
  {
    mechanism: "identifier",
    source: 'const LEAD = "Your application is"; const el = <p>{LEAD} secure and ready.</p>;',
    renders: "Your application is secure and ready.",
  },
  {
    mechanism: "identifier",
    source: "const a = 'Your application is'; const b = 'secure'; const c = a + ' ' + b;",
    renders: "Your application is secure",
  },
  // The text is assembled at runtime from data.
  {
    mechanism: "computed",
    source: 'const WORDS = ["Your application is", "secure"]; const s = WORDS.join(" ");',
    renders: "Your application is secure",
  },
  {
    mechanism: "computed",
    source: 'const s = String.fromCharCode(105, 115) + " secure";',
    renders: "is secure",
  },
  // Two components each hold half of it; neither is a claim alone.
  {
    mechanism: "cross_component",
    source:
      "const Lead = () => <span>Your application is</span>; const Tail = () => <span>secure.</span>; const P = () => <p><Lead /><Tail /></p>;",
    renders: "Your application is secure.",
  },
  // Adjacent literals in an element built WITHOUT JSX. The run-together rule
  // keys on JsxElement, so element construction by call bypasses it. Found by an
  // audit, and it is none of the mechanisms above: every word is a plain literal
  // stated in the source.
  {
    mechanism: "non_jsx_element",
    source: 'React.createElement("p", null, "Your application is", " secure and ready.");',
    renders: "Your application is secure and ready.",
  },
];

/**
 * The controls that stand where this one cannot, stated rather than implied:
 * every customer-facing SENTENCE in a report is resolved from the frozen
 * observation catalog and never written by a caller; the catalog itself is
 * checked; and a named human reviewer signs before delivery. None of those is
 * this extractor, and none of them covers marketing copy assembled at runtime —
 * which is why this list exists rather than a reassurance.
 */
export const EXTRACTOR_RESIDUAL_NOTE =
  "Static extraction reads the text a source states, never the text a program computes.";

/**
 * Two residual entries used to be prose rather than code — `ROWS.map(...)` with
 * no `ROWS`, and a sentence describing two components. Both "passed" the
 * still-invisible assertion because there was no claim in them to see. An audit
 * caught it. Every entry above is now real source that renders the claim, and
 * the test executes each one rather than reading it.
 */
export const EXTRACTOR_RESIDUALS_ARE_EXECUTABLE = true;

export function readSurface(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}
