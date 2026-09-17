import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
/**
 * Where Next looks for routes, PROBED rather than named.
 *
 * This was the single string `"src/app"`. Next resolves `app` or `src/app`, and
 * `pages` or `src/pages`, so a Pages Router page naming the offer sat outside
 * `filesUnder`, `ancestorChainFor`, `frameworkEntrypoints` and the asset walk
 * all at once — every walk in this module, missed by one literal. The same
 * shape as the entrypoint list the previous round replaced, in the constant
 * directly above it.
 */
export function routeRoots(root: string = process.cwd()): string[] {
  const found: string[] = [];
  for (const kind of ["app", "pages"]) {
    for (const parent of ["src", "."]) {
      const dir = parent === "." ? kind : `${parent}/${kind}`;
      const full = resolve(root, dir);
      if (existsSync(full) && statSync(full).isDirectory()) found.push(dir);
    }
  }
  return found;
}

const ROUTE_ROOTS = routeRoots();

if (ROUTE_ROOTS.length === 0) {
  throw new Error("no Next route directory found; every route walk would be empty");
}

const ROUTE_DIR = "src/app/(marketing)/ai-app-release-rescue";

/**
 * The offer's own name. A page anywhere in the app that sells this offer is a
 * Release Rescue surface wherever it lives — `(marketing)/pricing/page.tsx`
 * names it and quotes both prices, and it sat outside a set that was rooted at
 * one directory.
 */
const OFFER_NAME = "Release Rescue";

/**
 * The files the TEST RUNNER actually collects, read from `vitest.config.ts`.
 *
 * This was a name pattern — `/\.(test|test-fixtures)\.(tsx?|jsx?|mjs|cjs)$/` —
 * and it was a NEGATIVE, LIST-SHAPED rule in the discovery path of the file
 * whose premise is that such rules fail. It named four spellings. `vitest`
 * collects only `src/**\/*.test.ts`. So `.test.tsx`, `.test.jsx` and
 * `.test-fixtures.ts` were excluded from the surface AND never collected as
 * tests: read by nothing, bundled and rendered by Next. An audit imported a
 * `release-note.test.tsx` into the offer's own landing page and served two
 * prohibited claims at HTTP 200 with the whole suite green.
 *
 * The question is not "is this named like a test" but "does the runner run
 * this", and the runner's own config answers it. A file the runner does not run
 * is not a test, whatever it is called.
 */
function vitestIncludeGlobs(): string[] {
  const config = readFileSync(resolve(process.cwd(), "vitest.config.ts"), "utf8");
  const parsed = ts.createSourceFile("vitest.config.ts", config, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const globs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "include" &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) globs.push(element.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return globs;
}

const COLLECTED_BY_THE_RUNNER = vitestIncludeGlobs();

if (COLLECTED_BY_THE_RUNNER.length === 0) {
  throw new Error("vitest.config.ts declares no `include` globs; every test file would be read as a surface");
}

/** One glob from that config as a matcher. The dialect in use is `**`, `*` and literals. */
function globToPattern(glob: string): RegExp {
  const source = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((piece) => {
      if (piece === "**/") return "(?:[^/]*\\/)*";
      if (piece === "**") return ".*";
      if (piece === "*") return "[^/]*";
      if (piece === "?") return "[^/]";
      return piece.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`);
}

const RUNNER_PATTERNS = COLLECTED_BY_THE_RUNNER.map(globToPattern);

/** Whether the test runner collects this file, so it is a test rather than a surface. */
export function collectedByTheRunner(file: string): boolean {
  return RUNNER_PATTERNS.some((pattern) => pattern.test(file));
}

/**
 * Every extension this project can serve or import.
 *
 * It was `.ts`/`.tsx` in both the directory walk and the import resolver, while
 * `tsconfig.json` sets `allowJs` and Next's default `pageExtensions` includes
 * `js` and `jsx`. An audit served a `page.jsx` at HTTP 200 with a prohibited
 * claim, and — worse, because it is silent — imported a `.jsx` component into an
 * already-checked page: the resolver returned null, the module never joined the
 * set, and nothing changed to alarm about.
 */
const SOURCE_EXTENSION = /\.(tsx?|jsx?|mjs|cjs)$/;

/**
 * Files the FRAMEWORK loads, which no import graph reaches.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`, and this repository has one.
 * A proxy can return a response body, so it can put words in front of a
 * customer — and nothing imports it, so every walk in this file missed it.
 * Listing them is not the hand-written-list defect: these are the framework's
 * own entrypoint names, not a judgement about which of our files matter, and a
 * name that stops existing is caught by the exact-set assertion.
 */
const FRAMEWORK_ENTRYPOINT_NAMES = [
  "proxy",
  "middleware",
  "instrumentation",
  "instrumentation-client",
];

/**
 * Next resolves each of these from the project root OR `src/`, in any servable
 * extension — `MIDDLEWARE_LOCATION_REGEXP` in the installed framework is
 * `(?:src/)?middleware`, and `create-compiler-aliases` looks for
 * `src/instrumentation-client` and `instrumentation-client` alike.
 *
 * The previous version was three literal strings with the `src/` spelling only,
 * and it missed `instrumentation-client` — which runs in the BROWSER on every
 * route, is imported by nothing, and needs no config flag. An audit served a
 * claim from it at HTTP 200 with the whole suite green.
 *
 * The defence offered for a literal list was that "a name that stops existing
 * fails the exact-set assertion". True for deletion and rename; an entrypoint
 * that is ADDED is silent, which is exactly what happened.
 */
export function frameworkEntrypoints(root: string = process.cwd()): string[] {
  const found: string[] = [];
  for (const name of FRAMEWORK_ENTRYPOINT_NAMES) {
    for (const directory of ["src", "."]) {
      for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
        const candidate = directory === "." ? `${name}${extension}` : `${directory}/${name}${extension}`;
        if (existsSync(resolve(root, candidate))) found.push(candidate);
      }
    }
  }
  return found;
}

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
export const RENDERED_AROUND_A_PAGE =
  /^(layout|template|error|global-error|global-not-found|not-found|forbidden|unauthorized|loading|default)\.(tsx?|jsx?|mjs|cjs)$/;

function ancestorChainFor(dir: string): string[] {
  const found: string[] = [];
  const segments = dir.split("/");
  // Every level from the route root down to and including the route directory.
  const root = ROUTE_ROOTS.find((candidate) => dir === candidate || dir.startsWith(`${candidate}/`));
  if (!root) return found;
  for (let depth = root.split("/").length; depth <= segments.length; depth += 1) {
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
    else if (SOURCE_EXTENSION.test(entry.name) && !collectedByTheRunner(child)) found.push(child);
  }
  return found;
}

/** Every file under a directory, whatever its extension. */
function everyFileUnder(dir: string, found: string[] = []): string[] {
  const full = resolve(process.cwd(), dir);
  if (!existsSync(full)) return found;
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) everyFileUnder(child, found);
    else found.push(child);
  }
  return found;
}

/**
 * Whether a served asset's bytes ARE its words, decided by READING them.
 *
 * This was an extension list — `svgz?|html?|txt|md|json|xml|csv|webmanifest|vtt`
 * — and everything outside it was recorded as "a binary asset whose words, if
 * any, are pixels or glyph outlines rather than text". That sentence was false
 * for `.js`, `.css`, `.yaml`, `.rtf`, `.jsonld`, `.ics` and `.mjs`, all of which
 * are text and any of which `public/` can hold; a `public/*.js` pulled in by a
 * `<Script src>` puts words on the page. So the list was both a list and a
 * RECORD THAT STATED SOMETHING UNTRUE — the inverse of the failure this file
 * keeps finding, where a record proves nothing because it executes nothing.
 *
 * Bytes settle it. A file that decodes as UTF-8 and holds no NUL is text and is
 * read; anything else genuinely cannot be read as words here, and its recorded
 * reason is then true of it.
 */
export function assetIsItsOwnText(file: string): boolean {
  const bytes = readFileSync(resolve(process.cwd(), file));
  if (bytes.includes(0)) return false;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // U+FFFD only appears where a byte sequence was not valid UTF-8, unless the
  // file genuinely contains the replacement character — which a served text
  // asset may, so a single one is not enough to call it binary.
  const undecodable = (decoded.match(/\uFFFD/g) ?? []).length;
  return undecodable === 0 || undecodable / Math.max(decoded.length, 1) < 0.01;
}

/**
 * Everything `public/` serves, at the site root, byte for byte.
 *
 * The discovery in this file answers "which files can put words in front of a
 * customer" by following imports from rendered routes. `public/` is reached by
 * NO import: Next serves `public/x.svg` at `/x.svg` because it is on disk. So an
 * SVG with `<text>We deliver a penetration test</text>`, or a `claims.txt`
 * linked from a page, was outside every walk in this module — not a residual,
 * not an exemption, simply unconsidered. The offer's own marketing surface is
 * exactly where such an asset would live.
 */
export const RELEASE_RESCUE_SERVED_ASSETS: string[] = [
  // `public/` is served at the site root byte for byte.
  ...everyFileUnder("public"),
  // And so are the route roots' NON-SOURCE files. `robots.txt`,
  // `manifest.webmanifest`, `sitemap.xml` and their neighbours live in the app
  // directory and Next serves them at `/robots.txt` and so on. Naming `public`
  // as THE served-static directory was the same hand-written fact as the
  // entrypoint list, one directory over: an audit served a manifest whose
  // `description` — shown at install and in the app switcher — carried two
  // prohibited claims, at HTTP 200, with the whole suite green. Deriving it as
  // "not a module the bundler compiles" names none of them.
  ...ROUTE_ROOTS.flatMap((root) => everyFileUnder(root)).filter((file) => !SOURCE_EXTENSION.test(file)),
].sort();

/** The served assets whose text this suite reads. */
export const SCANNABLE_ASSETS: string[] = RELEASE_RESCUE_SERVED_ASSETS.filter(assetIsItsOwnText);

/**
 * Served assets this suite does NOT read, with the reason — a raster image, a
 * font, a media file. Recorded rather than skipped, under the same rule the
 * tokenizer and extractor residuals follow: a bound should be a measurement.
 * Words rendered INTO a PNG are outside this guard and outside the scanner; the
 * control that stands there is human review of what the repository publishes.
 */
export const ASSET_RESIDUALS: ReadonlyArray<{ readonly file: string; readonly why: string }> =
  RELEASE_RESCUE_SERVED_ASSETS.filter((file) => !assetIsItsOwnText(file)).map((file) => ({
    file,
    why: "its bytes are not decodable text, so any words it shows a customer are pixels or glyph outlines that no extractor here can read; human review of what the repository publishes is the control that stands in its place",
  }));

/** The text of one served asset, exactly as the framework would hand it over. */
export function readServedAsset(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
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
 * So the rule is stated with its DIRECTORY disjunct named rather than described
 * away — saying "neither NAME nor DIRECTORY decides anything" was false in two
 * commit messages, and this comment carried it for one more:
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
  // Case-folded, and the route slug counts too. It was `includes` on the exact
  // casing, so a page saying "release rescue" was not a surface — the audit-33
  // escape again, one case-fold in.
  const answer = sourceStatesTheOffer(source, file);
  statesTheOffer.set(file, answer);
  return answer;
}

function filesSellingTheOffer(): string[] {
  return ROUTE_ROOTS.flatMap((root) => filesUnder(root)).filter((file) =>
    reachableFrom(file).some((reached) => OFFER_MODULE.test(reached) || namesTheOffer(reached)),
  );
}

/**
 * Every import specifier the graph can resolve statically, from one file's text.
 *
 * Named and exported so the `computed_import` residual can be EXECUTED rather
 * than described: a residual that nothing runs is the "a record that nothing
 * executes is not evidence" defect, and an earlier commit claimed these were
 * asserted the way the extractor's residuals are when they were only counted.
 * The walk calls this, so a test of it cannot drift from what the walk does.
 */
export function staticSpecifiersIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:from\s+|import\s*\(\s*)["']([^"']+)["']|import\s+["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']/g,
  )) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) found.push(specifier);
  }
  return found;
}

/** Whether any text this file states, or renders, says the offer's name. */
export function sourceStatesTheOffer(source: string, file = "surface.tsx"): boolean {
  const needle = OFFER_NAME.toLowerCase();
  const slug = needle.replace(/ /g, "-");
  const says = (text: string): boolean => {
    const folded = text.toLowerCase();
    return folded.includes(needle) || folded.includes(slug);
  };
  return says(source) || visibleStrings(source, file).some(says);
}

const reachedFromCache = new Map<string, string[]>();

/** Every repository file reachable from one entrypoint by import. */
export function reachableFrom(entry: string): string[] {
  const remembered = reachedFromCache.get(entry);
  if (remembered) return remembered;
  const reached = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(resolve(process.cwd(), file), "utf8");
    // Bare side-effect imports and `require` count too: a module reached only
    // that way still renders, and the previous pattern could not see either.
    for (const specifier of staticSpecifiersIn(source)) {
      const target = resolveImport(specifier, file);
      // No exclusion here. A module a RENDERED PAGE imports is a surface whatever
      // it is called: the name pattern that used to sit here deleted a component
      // from the graph AFTER it resolved, so `UNRESOLVED_IMPORTS` could not fire
      // and the exact-set assertion did not move. A test file is not imported by
      // a page in a healthy repository; when one is, it is a surface.
      if (target && !reached.has(target)) {
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
export type EntryResidual = {
  readonly mechanism: "computed_name" | "computed_import";
  readonly why: string;
  /** Source that DEMONSTRATES the miss, so the bound is run rather than asserted. */
  readonly source: string;
  /** The same shape written so the rule CAN see it, so the test is not vacuous. */
  readonly seenWhenStatic: string;
};

export const ENTRY_RESIDUALS: readonly EntryResidual[] = [
  {
    mechanism: "computed_name",
    why: "A served file that reaches no offer module and assembles the offer's name at runtime — `[\"AI App\", \"Release\", \"Rescue\"].join(\" \")` — states it nowhere a parser can read.",
    source: 'const parts = ["AI App", "Release", "Rescue"]; export const Title = () => <h1>{parts.join(" ")}</h1>;',
    seenWhenStatic: 'export const Title = () => <h1>AI App Release Rescue</h1>;',
  },
  {
    mechanism: "computed_import",
    why: "A dynamic `import(`./${name}`)` specifier cannot be resolved statically, so a module reached only that way is outside every graph this file walks.",
    source: "const name = \"panel\"; export const load = () => import(`./${name}`);",
    seenWhenStatic: 'export const load = () => import("./panel");',
  },
];

function listRouteEntrypoints(): string[] {
  const entries = new Set<string>(filesUnder(ROUTE_DIR));
  for (const file of frameworkEntrypoints()) entries.add(file);
  for (const file of ancestorChainFor(ROUTE_DIR)) entries.add(file);
  for (const served of filesSellingTheOffer()) {
    entries.add(served);
    for (const file of ancestorChainFor(served.slice(0, served.lastIndexOf("/")))) entries.add(file);
  }
  return [...entries];
}

/**
 * The project's own path aliases, READ FROM `tsconfig.json`.
 *
 * "Our tree" was decided by the literal prefix `@/`. Any second alias — the
 * ordinary `~/*` beside it, say — was classified as a package and dropped
 * BEFORE the unresolved-import recording, so the guard added for exactly this
 * failure could not fire. An audit added `"~/*": ["./src/*"]`, imported a
 * component through it, built it, and served a prohibited claim at HTTP 200 with
 * `UNRESOLVED_IMPORTS` empty and the suite green.
 *
 * The aliases are a fact about this project, written down in one place by the
 * project itself. Reading them is not a list; assuming them was.
 */
export function tsconfigAliases(
  configPathInput?: string,
): Array<{ readonly prefix: string; readonly target: string }> {
  // TypeScript reads its own config. The first attempt at this stripped comments
  // with a regex before `JSON.parse`, and the block-comment pattern matched the
  // `/*` INSIDE the alias key `"@/*"` — it ate the paths map and threw. A
  // hand-rolled parser for a format the compiler already parses is the same
  // mistake as a hand-written list, one layer down. `parseJsonConfigFileContent`
  // also resolves `extends`, so an alias inherited from a base config counts.
  const configPath = configPathInput ?? resolve(process.cwd(), "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(`tsconfig.json is unreadable: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
  const paths = parsed.options.paths ?? {};
  const baseUrl = parsed.options.baseUrl ?? dirname(configPath);
  return Object.entries(paths).flatMap(([pattern, targets]) => {
    const prefix = pattern.replace(/\*$/, "");
    const first = targets[0];
    if (first === undefined) return [];
    // Targets are relative to baseUrl (or the config's own directory); the rest
    // of this module speaks repository-relative paths, so convert once here.
    const absolute = resolve(baseUrl, first.replace(/\*$/, ""));
    const target = relative(configPathInput ? dirname(configPath) : process.cwd(), absolute).replace(/\\/g, "/");
    return target ? [{ prefix, target }] : [];
  });
}

const ALIASES = tsconfigAliases();

if (ALIASES.length === 0) {
  throw new Error("tsconfig.json declares no path aliases; every `@/` import would be read as a package");
}

function aliasFor(specifier: string): string | null {
  for (const { prefix, target } of ALIASES) {
    if (specifier.startsWith(prefix)) return join(target, specifier.slice(prefix.length));
  }
  return null;
}

/** Resolve an import specifier to a repository-relative file, or null if it leaves the tree. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  const alias = aliasFor(specifier);
  if (alias) base = alias;
  else if (specifier.startsWith(".")) base = join(dirname(fromFile), specifier);
  else return null; // a package, not our source
  const suffixes = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
  const candidates = [
    ...suffixes.map((suffix) => `${base}${suffix}`),
    ...suffixes.map((suffix) => join(base, `index${suffix}`)),
    base,
  ];
  // Only source and data. A bare-path fallback used to accept anything on disk,
  // which pulled `globals.css` in through `import "./globals.css"` — a real
  // stylesheet parsed as TypeScript. JSON stays: an audit put customer copy in a
  // `.json` import and the guard correctly caught it.
  const READABLE = /\.(tsx?|jsx?|mjs|cjs|json)$/;
  for (const candidate of candidates) {
    const full = resolve(process.cwd(), candidate);
    if (existsSync(full) && statSync(full).isFile() && READABLE.test(candidate)) return candidate.replace(/\\/g, "/");
  }
  // A stylesheet or asset is resolvable and simply not text we read.
  if (/\.(css|scss|svg|png|jpe?g|webp|woff2?|ico)$/.test(specifier)) return null;
  // A specifier into our own tree that resolves to nothing is not a package and
  // not a miss to shrug at — it is a module the guard will never read. Recorded
  // so the suite can fail on it rather than silently narrowing the surface.
  UNRESOLVED_IMPORTS.push(`${fromFile} -> ${specifier}`);
  return null;
}

/** Own-tree specifiers the resolver could not place. Asserted empty by the suite. */
export const UNRESOLVED_IMPORTS: string[] = [];

function discoverSurfaceFiles(): string[] {
  // ONE walk. There were two, with different import patterns: this one was left
  // on the narrow regex while `reachableFrom` was widened to follow bare
  // side-effect imports and `require()`. So a module could make a page an ENTRY
  // and never join the CHECKED set. An audit served a claim through exactly that
  // gap. Both paths are `reachableFrom` now, so they cannot disagree again.
  const reached = new Set<string>();
  for (const entry of listRouteEntrypoints()) {
    for (const file of reachableFrom(entry)) reached.add(file);
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
  "src/lib/auth-redirect.ts",
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
  "src/proxy.ts",
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

/**
 * Whether a node's JSX children are ALTERNATIVES rather than neighbours.
 *
 * `ok ? <span>Your application is </span> : <span>secure.</span>` has two JSX
 * children, so the run-together rule joined them into a sentence that NO render
 * produces — one arm or the other runs, never both. Flagging fabricated text is
 * the safe direction for a guard, but it is still a claim the repository does
 * not make, and this file's whole subject is not asserting things that are not
 * so. Each arm is visited on its own by the walk, so nothing is lost.
 *
 * Inside a real JsxElement the conservative join stays: there the children ARE
 * adjacent, and a conditional between two literal siblings is a real path.
 */
function rendersAlternatives(node: ts.Node): boolean {
  if (ts.isConditionalExpression(node)) return true;
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    return (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    );
  }
  return false;
}

/** How many of a node's direct children are JSX elements that would render adjacently. */
function jsxChildCount(node: ts.Node): number {
  const isJsx = (candidate: ts.Node): boolean =>
    ts.isJsxElement(candidate) || ts.isJsxFragment(candidate) || ts.isJsxSelfClosingElement(candidate);
  let count = 0;
  node.forEachChild((child) => {
    if (isJsx(child)) {
      count += 1;
      return;
    }
    // An object's values and an array's entries reach JSX one level down, through
    // a PropertyAssignment. `{ a: <b>…</b>, b: <b>…</b> }` renders adjacently
    // exactly as `[<b>…</b>, <b>…</b>]` does.
    if (ts.isPropertyAssignment(child) && isJsx(child.initializer)) count += 1;
  });
  return count;
}

/**
 * Does this snippet interpolate anything the extractor cannot resolve?
 *
 * A residual whose JSX contains `{SOMETHING}` renders text the parser cannot
 * compute — that is the point of the residual — so its declared `renders` cannot
 * be checked against its source. Where the JSX is all literals, it can be, and
 * is: one entry declared a space between two adjacent elements that a browser
 * does not insert, which made it invisible for the wrong reason.
 */
export function interpolatesSomething(source: string): boolean {
  const parsed = parseSurface("residual.tsx", source);
  let computed = false;
  const visit = (node: ts.Node): void => {
    if (computed) return;
    if (ts.isJsxExpression(node)) {
      const inner = node.expression;
      if (inner && !ts.isStringLiteral(inner) && !ts.isNoSubstitutionTemplateLiteral(inner)) {
        computed = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return computed;
}

/**
 * All JSX text under one node, in source order.
 *
 * `separated` joins with a space, which is what the run-together reading wants.
 * `verbatim` concatenates with nothing added, which is what a browser actually
 * produces — used to check a recorded residual's declared rendered text against
 * its own source, because one of them declared a space that does not exist.
 */
export function jsxTextOf(node: ts.Node, mode: "separated" | "verbatim"): string {
  const parts: string[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isJsxText(child)) parts.push(mode === "separated" ? child.text : jsxTextValue(child.text));
    else if (ts.isJsxExpression(child)) {
      const inner = child.expression;
      if (inner && (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))) parts.push(inner.text);
    }
    child.forEachChild(walk);
  };
  node.forEachChild(walk);
  if (mode === "separated") return tidy(parts.join(" "));
  // Verbatim joins with nothing and keeps the significant spaces JSX preserves,
  // so it can be compared against a recorded residual's declared rendered text.
  return decodeEntities(parts.join("")).trim();
}

/**
 * One JSX text node's value, under JSX's own whitespace rule.
 *
 * Verbatim used to be `tidy(parts.join(""))`, and `tidy` collapses every run of
 * whitespace to one space. So siblings written across lines —
 *
 *   <p>
 *     <Lead />
 *     <Tail />
 *   </p>
 *
 * — produced "Lead Tail" from the "\n    " between them, when JSX DELETES a
 * whitespace-only line break and a browser renders "LeadTail". The check that
 * compares a residual's declared `renders` against its source therefore
 * disagreed with the source for a formatting reason, which is the opposite of
 * what it was added to catch. This is the rule the compiler applies: lines are
 * trimmed at the inner edges, empty ones vanish, and what survives joins with a
 * single space.
 */
function jsxTextValue(text: string): string {
  const lines = text.split(/\r\n|\n|\r/);
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index] ?? "";
    if (index > 0) line = line.replace(/^[ \t]+/, "");
    if (index < lines.length - 1) line = line.replace(/[ \t]+$/, "");
    if (line) kept.push(line);
  }
  return kept.join(" ");
}

/** What one source snippet renders as text, with nothing inserted between elements. */
export function renderedTextVerbatim(source: string): string {
  return jsxTextOf(parseSurface("residual.tsx", source), "verbatim");
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

export function parseSurface(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
}

/**
 * The dialect to parse a file as, from its extension.
 *
 * This was `endsWith(".tsx") ? TSX : TS`, so every `.jsx` and `.js` surface —
 * which `allowJs` and Next's default `pageExtensions` both permit — was parsed
 * as TypeScript. JSX in a `.js` file is a syntax error to the TS dialect, so the
 * parser returned a tree full of error nodes and the extractor read nothing from
 * it. Silently. `.js` maps to JSX rather than JS because Next serves JSX from
 * `.js` routinely, and JSX is the superset; `.ts` stays TS because `<T>expr` is
 * a type assertion there and a broken tag in TSX.
 */
function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  if (/\.(jsx|js|mjs|cjs)$/.test(file)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TSX;
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
    } else if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {
      // A SELF-CLOSING element belongs here too. Its own tag has no children,
      // but its PROPS can carry JSX — `<Row lead={<b>Your application is </b>}
      // tail={<b>secure.</b>} />` puts a whole sentence in front of a customer
      // with no JsxElement anywhere above it. Wrapped in a `<div>` the guard
      // caught it, because the div is a JsxElement and the walk descends through
      // attributes; outermost, it was read by nothing.
      found.push(renderedTextOf(node));
    } else if (jsxChildCount(node) >= 2 && !rendersAlternatives(node)) {
      // Siblings that render adjacently without a JSX parent — an array of
      // elements returned from a component, or elements in object values. Every
      // word is a plain literal in a real JsxElement, so it is none of the
      // recorded residual mechanisms, and the branch above never saw it because
      // it keys on the PARENT being JSX. An audit served it at HTTP 200.
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
      "const Lead = () => <span>Your application is </span>; const Tail = () => <span>secure.</span>; const P = () => <p><Lead /><Tail /></p>;",
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
 *
 * Two constants used to sit here — a NOTE and an ARE_EXECUTABLE flag — exported
 * and read by nothing, in the file whose figure-binding test exists because "a
 * figure nothing reads is a figure nothing can keep true". A commit message
 * claimed one of them had been wired up; it had not. Both are gone: the claims
 * they made are now assertions in the suite instead of strings in the module.
 */

export function readSurface(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}
