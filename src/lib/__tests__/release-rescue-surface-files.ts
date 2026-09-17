import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
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
/**
 * The framework's entrypoint filenames, READ FROM THE FRAMEWORK.
 *
 * These were four literal strings. An audit deleted `"instrumentation"` — a real
 * Next entrypoint — and both guard suites stayed green and the mutation proof
 * reported every mechanism held, because nothing exercised the list's contents.
 * The first repair made the test fixture write one file per name, which is
 * derived from the list and therefore shrinks with it: self-consistent, and
 * vacuous about exactly the thing in question. That is this project's signature
 * failure — evidence composed inside its own premise — rebuilt inside the fix
 * for an instance of it.
 *
 * Next declares these itself, as `*FILENAME` string constants, and at the
 * installed version those three are precisely the entrypoint filenames and
 * nothing else. `instrumentation-client` is the hook's browser half, spelled by
 * the framework as the hook's name with `-client` appended. So the set is taken
 * from there: a name Next adds arrives on its own, a name Next renames changes
 * the discovered surface and trips the exact-set assertion, and there is no list
 * left for anybody to quietly shorten.
 *
 * This reaches into a private path. If Next moves it the import throws, which is
 * the right failure: loud, at load, rather than a silently empty entry set.
 */
function frameworkEntrypointNames(): string[] {
  const load = createRequire(import.meta.url);
  const constants = load("next/dist/lib/constants.js") as Record<string, unknown>;
  const declared = Object.entries(constants)
    .filter(([key, value]) => typeof value === "string" && key.endsWith("FILENAME"))
    .map(([, value]) => value as string);
  if (declared.length === 0) {
    throw new Error("next/dist/lib/constants.js declares no *FILENAME constants; the entry set would be empty");
  }
  const hook = constants.INSTRUMENTATION_HOOK_FILENAME;
  const browserHalf = typeof hook === "string" ? [`${hook}-client`] : [];
  return [...new Set([...declared, ...browserHalf])];
}

export const FRAMEWORK_ENTRYPOINT_NAMES = frameworkEntrypointNames();

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
/**
 * EVERY reading a browser could give a served asset's bytes.
 *
 * Picking one reading was the mistake. The previous version tried UTF-8, then
 * UTF-16LE, then UTF-16BE, and returned the first that looked printable — and
 * arbitrary bytes of Latin-1 prose decode as perfectly printable CJK under
 * UTF-16LE. So an SVG saved as Windows-1252, with a few per cent of accented
 * characters and an `<?xml encoding="windows-1252"?>` declaration, failed the
 * UTF-8 attempt, "succeeded" as UTF-16LE, was classified as TEXT, and the guard
 * was handed mojibake. The claim inside it was served at HTTP 200 and read by
 * nothing. The exact-set pin could not fire either, because the file was in the
 * SCANNED set rather than the exempt one.
 *
 * Worse, BOM-less UTF-16 sniffing is something no browser does — the HTML
 * standard detects UTF-16 only from a byte-order mark, and XML requires one. I
 * added that branch on my own initiative while fixing the previous round, and
 * the comment beside it claimed these were "the encodings a browser honours".
 * It was the one encoding in the list that a browser specifically does not.
 *
 * So the choice is dropped, the way "which files sell the offer" was dropped.
 * Every plausible reading is returned and the caller scans ALL of them: a claim
 * visible under any reading a browser might produce is a claim. Fail-closed
 * costs a rewording; choosing wrongly costs a served claim.
 */
export function assetReadings(bytes: Uint8Array): string[] {
  const readable = (text: string): string | null => {
    // Measured POSITIVELY, as the share of characters a reader would see. A
    // noise ratio with a small epsilon was an earlier attempt, and it called a
    // fifty-character HTML document with one stray NUL binary — one in fifty is
    // two per cent. What separates a document from a PNG is that almost all of a
    // document is readable, not that none of it is odd.
    if (text.length === 0) return null;
    const noise = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g) ?? []).length;
    return (text.length - noise) / text.length >= 0.95 ? text : null;
  };
  const decode = (encoding: string, from: Uint8Array): string | null => {
    try {
      return readable(new TextDecoder(encoding, { fatal: false }).decode(from));
    } catch {
      return null;
    }
  };

  // A byte-order mark is a declaration, and it is the ONLY thing that makes a
  // browser read UTF-16. When one is present it settles the question alone.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    const marked = new Set<string>();
    const text = decode("utf-16le", bytes.subarray(2));
    if (text === null) return [];
    marked.add(text);
    for (const variant of [decodeEntities(text), decodeCssEscapes(text), decodeCssEscapes(decodeEntities(text))]) {
      if (variant !== text) marked.add(variant);
    }
    return [...marked];
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const marked = new Set<string>();
    const text = decode("utf-16be", bytes.subarray(2));
    if (text === null) return [];
    marked.add(text);
    for (const variant of [decodeEntities(text), decodeCssEscapes(text), decodeCssEscapes(decodeEntities(text))]) {
      if (variant !== text) marked.add(variant);
    }
    return [...marked];
  }
  const body = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;

  const readings = new Set<string>();
  const add = (text: string | null): void => {
    if (text === null) return;
    readings.add(text);
    // And what a browser RENDERS from it. An entity is not decoration: `&#32;`
    // and `&nbsp;` are ordinary ways to write a space, `react/no-unescaped-entities`
    // is enforced in this repository, and the JSX path has decoded entities
    // since an audit planted a claim behind them. The asset path did not — so
    // `penetration&#32;test` was invisible on a served SVG while the identical
    // shape in JSX was caught, the same "checked in one place, invisible in
    // another" asymmetry as the stylesheet one layer down. A CSS escape
    // (`content:"penetration\\000020test"`) is the same trick in the other
    // format the asset scan reads.
    const decoded = decodeEntities(text);
    if (decoded !== text) readings.add(decoded);
    const unescaped = decodeCssEscapes(text);
    if (unescaped !== text) readings.add(unescaped);
    const both = decodeCssEscapes(decoded);
    if (both !== text) readings.add(both);
  };
  // UTF-8 is the default for everything the framework serves, and
  // windows-1252 is what a browser falls back to for legacy single-byte
  // content — every byte maps, so it never fails and it covers the whole
  // Latin-1 family. An in-band declaration, if the file carries one, is added
  // as well rather than instead: a file whose declaration disagrees with its
  // bytes is exactly the case where reading only one of them loses the words.
  for (const encoding of ["utf-8", "windows-1252", declaredEncoding(body)]) {
    if (!encoding) continue;
    add(decode(encoding, body));
  }
  return [...readings];
}

/** An `<?xml encoding="…"?>` or `<meta charset=…>` declaration, which browsers honour. */
function declaredEncoding(bytes: Uint8Array): string | null {
  // The declaration is ASCII in every encoding that can carry one, so a lenient
  // reading of the first bytes is enough to find it.
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 1024));
  const xml = /<\?xml[^>]*\bencoding\s*=\s*["']([\w-]+)["']/i.exec(head);
  const meta = /<meta[^>]*\bcharset\s*=\s*["']?([\w-]+)/i.exec(head);
  const declared = xml?.[1] ?? meta?.[1] ?? null;
  if (!declared) return null;
  try {
    // Ask the platform whether it knows the label rather than listing them.
    new TextDecoder(declared);
    return declared;
  } catch {
    return null;
  }
}

/** Whether any reading of this asset yields words. */
export function assetIsItsOwnText(file: string): boolean {
  return assetReadings(readFileSync(resolve(process.cwd(), file))).length > 0;
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

/**
 * Every asset this suite reads: served from disk, or reached by import.
 *
 * `RELEASE_RESCUE_SERVED_ASSETS` is computed at module load, before any walk has
 * run, so the imported ones are appended here — after `RELEASE_RESCUE_SURFACE_FILES`
 * below has forced the discovery — rather than folded into that constant.
 */
export function scannableAssets(): string[] {
  return allAssets().filter(assetIsItsOwnText);
}

/** Every asset considered, served or imported. */
export function allAssets(): string[] {
  return [...new Set([...RELEASE_RESCUE_SERVED_ASSETS, ...IMPORTED_ASSETS])].sort();
}

/**
 * Served assets this suite does NOT read, with the reason — a raster image, a
 * font, a media file. Recorded rather than skipped, under the same rule the
 * tokenizer and extractor residuals follow: a bound should be a measurement.
 * Words rendered INTO a PNG are outside this guard and outside the scanner; the
 * control that stands there is human review of what the repository publishes.
 */
export function assetResiduals(): ReadonlyArray<{ readonly file: string; readonly why: string }> {
  return allAssets()
    .filter((file) => !assetIsItsOwnText(file))
    .map((file) => ({
      file,
      why: "no reading of its bytes in any encoding a browser would apply yields text, so any words it shows a customer are pixels or glyph outlines that no extractor here can read; human review of what the repository publishes is the control that stands in its place",
    }));
}



/**
 * The words of one served asset, DECODED.
 *
 * This read `utf8` unconditionally. Even once a UTF-16 asset is correctly
 * classified as text, scanning its raw UTF-8 reading finds nothing — every
 * character is separated by a NUL — so the claim would still have been served.
 * Classifying it and reading it have to agree, and they now share one decoder.
 */
export function readServedAsset(file: string): string {
  return assetReadings(readFileSync(resolve(process.cwd(), file))).join("\n");
}


/**
 * Every import specifier the graph can resolve statically, READ BY THE PARSER.
 *
 * This was a regular expression, in the one place in this module that still
 * used one. Seven rounds ago a regex extractor was replaced by the TypeScript
 * parser because four hand-written rewrites each shipped the next round's
 * finding; the specifier extractor kept the regex and nobody noticed.
 *
 * `import\s*\(\s*["']` requires the quote to follow the parenthesis, so the
 * idiomatic `import(/* webpackChunkName: "x" *\/ "./panel")` matched nothing,
 * `import(`./panel`)` matched nothing, and `require.resolve("./panel")` matched
 * nothing. All three are STATICALLY RESOLVABLE, so the `computed_import`
 * residual did not cover them either — `resolveImport` was never called, so
 * `UNRESOLVED_IMPORTS` stayed empty and the exact-set assertion did not move. An
 * audit pulled a component in through the first form and served three claims at
 * HTTP 200 from the offer's own landing page.
 *
 * The parser reads the syntax the compiler reads. `UNREADABLE_SPECIFIERS`
 * records import-like calls whose argument is NOT a literal, which is the real
 * `computed_import` bound and is now measured rather than described.
 */
export const UNREADABLE_SPECIFIERS: string[] = [];

/** Deduped: the same source read twice used to record the same specifier twice. */
function recordUnreadable(text: string): void {
  if (!UNREADABLE_SPECIFIERS.includes(text)) UNREADABLE_SPECIFIERS.push(text);
}

/**
 * The identifier a callee chain starts from: `require` for `require.main.require`,
 * `module` for `module.require`, `policy` for `policy.require`, `import.meta` for
 * `import.meta.resolve`.
 */
/**
 * The global object, under every spelling a bundle target uses.
 *
 * `globalThis.require("./panel")`, `window.require(\u2026)` and `self.require(\u2026)`
 * are real CommonJS loads that the predecessor's `.endsWith(".require")` caught
 * and the root rule dropped. The rule was right and its root set was short: a
 * set-diff of the EXCLUDED direction was not run, which is rule 1 of this
 * repository's four applied to only one half of the change.
 */
/**
 * The global object's spellings, matched CASE-SENSITIVELY because JavaScript is.
 *
 * A case-insensitive set read `Self.require("./panel")` and `GLOBAL.require(…)`
 * as module loads — ordinary objects that merely share a name's letters — and
 * put `Global.require(flag)`'s boolean identifier back into
 * `UNREADABLE_SPECIFIERS`, which is the "record full of things that are not what
 * it says they are" defect this file has now had twice.
 */
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);

/** `process.mainModule` is Node's documented alias for `require.main`. */
const MAIN_MODULE_CHAIN = ["process", "mainModule"];

/**
 * Unwrap the expression a call is really made on.
 *
 * `(0, require)("./panel")` is the canonical indirect-require idiom a bundler
 * emits, and `(require)("./panel")` is the same thing with the comma left out.
 * Both were dropped: the callee is a parenthesized comma expression, not a
 * property access, so the chain walk returned nothing and the module left the
 * import graph unscanned and unrecorded.
 */
function unwrapCallee(callee: ts.Expression): ts.Expression {
  let current: ts.Expression = callee;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      current = current.right;
      continue;
    }
    if (ts.isAsExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/**
 * The dotted segments of a callee, with `obj["name"]` read as `obj.name`.
 *
 * `globalThis["require"]("./panel")` is the same load written with a subscript,
 * and reading only property access dropped it.
 */
function calleeChain(callee: ts.Expression): string[] {
  const segments: string[] = [];
  let current: ts.Expression = unwrapCallee(callee);
  for (;;) {
    if (ts.isPropertyAccessExpression(current)) {
      segments.unshift(current.name.text);
      current = unwrapCallee(current.expression);
      continue;
    }
    if (ts.isElementAccessExpression(current)) {
      const name = current.argumentExpression;
      if (!ts.isStringLiteral(name) && !ts.isNoSubstitutionTemplateLiteral(name)) return [];
      segments.unshift(name.text);
      current = unwrapCallee(current.expression);
      continue;
    }
    break;
  }
  if (ts.isIdentifier(current)) segments.unshift(current.text);
  else if (ts.isMetaProperty(current)) segments.unshift(`${ts.tokenToString(current.keywordToken) ?? ""}.${current.name.text}`);
  else return [];
  return segments;
}

export function staticSpecifiersIn(source: string, file = "specifiers.tsx"): string[] {
  const parsed = parseSurface(file, source);
  const found: string[] = [];

  const literalText = (node: ts.Node | undefined): string | null => {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return null;
  };

  const visit = (node: ts.Node): void => {
    // `import x from "y"`, `export … from "y"`, `export * from "y"`.
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const text = literalText(node.moduleSpecifier);
      if (text !== null) found.push(text);
      else recordUnreadable(node.moduleSpecifier.getText(parsed));
    }
    // `import("y")`, `require("y")`, `require.resolve("y")`, `import.meta.resolve("y")`.
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImportCall = callee.kind === ts.SyntaxKind.ImportKeyword;
      // A bare identifier named `require` is matched by NAME, which is the
      // defect class this whole module is about, so it is qualified by ARITY:
      // CommonJS `require` takes exactly one argument. `skill-qualification.ts`
      // declares a local `require(condition, code)` assertion helper, and the
      // first version of this recorded fifteen of its boolean conditions as
      // unreadable import specifiers — a record full of things that are not
      // what it says they are.
      //
      // `module.require(…)` and `require.main.require(…)` are real runtime
      // loads that the predecessor regex caught and the first parser version
      // dropped. They were added back as `calleeText.endsWith(".require")` —
      // which is matching by name again, one syntax form over: `policy.require`
      // and `a.b.c.require` matched too, so a one-argument `policy.require(flag)`
      // put a boolean identifier back into `UNREADABLE_SPECIFIERS` and
      // `policy.require("./x")` fed a non-import string to `resolveImport`.
      //
      // What actually distinguishes the real forms is the ROOT of the callee
      // chain, not its tail. CommonJS reaches `require` from `require` itself or
      // from `module`; nothing else does.
      const chain = calleeChain(callee);
      const root = chain[0] ?? "";
      const tail = chain[chain.length - 1] ?? "";
      const reachesRequire = tail === "require" || tail === "resolve";
      const loadsAModule =
        // `require(\u2026)`, `require.resolve(\u2026)`, `require.main.require(\u2026)`.
        (root === "require" && reachesRequire) ||
        // `module.require(\u2026)`, `module.parent.require(\u2026)`.
        (root === "module" && reachesRequire) ||
        // `globalThis.require(\u2026)`, `window.parent.require(\u2026)`, and
        // `globalThis.require.resolve(\u2026)`. Depth is NOT bounded here: a
        // one-level bound dropped `window.parent.require`, which the predecessor
        // caught, and a module that leaves the graph is scanned by nothing at
        // all, while an over-read specifier fails loudly at the resolver.
        (GLOBAL_OBJECTS.has(root) && chain.length >= 2 && reachesRequire) ||
        // `process.mainModule.require(\u2026)`, and its `.resolve`. Matched on the
        // WHOLE chain: a two-segment prefix read `process.mainModule.paths.require`,
        // which loads nothing.
        (chain.length === MAIN_MODULE_CHAIN.length + 1 &&
          MAIN_MODULE_CHAIN.every((segment, offset) => chain[offset] === segment) &&
          tail === "require") ||
        (root === "import.meta" && tail === "resolve");
      const isRequire = loadsAModule && node.arguments.length === 1;
      if (isImportCall || isRequire) {
        const first = node.arguments[0];
        const text = literalText(first);
        if (text !== null) found.push(text);
        else if (first) recordUnreadable(first.getText(parsed));
      }
    }
    // `import("y").X` — the import TYPE node. Erased at runtime, but the module
    // still has to be read, and following `import type … from "y"` while
    // dropping this is an inconsistency rather than a decision.
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteral(literal)) found.push(literal.text);
    }
    // `import x = require("y")` — a real runtime load.
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const text = literalText(node.moduleReference.expression);
      if (text !== null) found.push(text);
      else recordUnreadable(node.moduleReference.expression.getText(parsed));
    }
    // `import type … from "y"` is an ImportDeclaration and is handled above.
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
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
    // The FILE is passed. Without it every module in the graph was parsed as
    // TSX, so a legacy `<string>x` assertion or a `<T>(x) => x` generic arrow —
    // valid `.ts` that `tsc` and `next build` both accept — made the parse fail
    // and silently dropped every import after it. `parseProblems` uses the
    // correct dialect and reported clean, `resolveImport` was never called so
    // `UNRESOLVED_IMPORTS` stayed empty, and a newly added module simply never
    // entered the set, so the exact-set pin could not move either. Both guards
    // built for this were blind to it, in the one place the graph is walked.
    for (const specifier of staticSpecifiersIn(source, file)) {
      const target = resolveImport(specifier, file);
      if (target && !SOURCE_IMPORT.test(target)) {
        // Reached by import and not a module the parser can read: a stylesheet,
        // a vendored asset. Its words are scanned the way a served asset's are,
        // rather than dropped because they are not TypeScript.
        if (!IMPORTED_ASSETS.includes(target)) IMPORTED_ASSETS.push(target);
        continue;
      }
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
 * The rule reads imports and walks the route roots. It cannot follow an import
 * whose specifier is computed, and it cannot find a file the framework loads
 * from the project root under a name Next does not declare as a constant.
 *
 * The second was unwritten until an audit named it. Deleting `computed_name`
 * last round was right — nothing reads a name any more — but the class left
 * behind was not recorded, and "the entry rule's residuals" then described a
 * bound narrower than the one that actually holds. `mdx-components` is not
 * reachable today (`@next/mdx` is not a dependency and `pageExtensions` is
 * unset), so this is a bound recorded before it bites rather than after.
 *
 * `computed_name` used to sit beside this one: a served file that assembled the
 * offer's name at runtime was invisible because membership was decided by
 * whether a file SAID the offer's name. Nothing reads a name now — every file
 * under a route root is an entry — so the residual is gone rather than
 * reworded. A bound that stops existing should be deleted, not kept as decor.
 */
export type EntryResidual = {
  readonly mechanism: "computed_import" | "framework_root_file";
  readonly why: string;
  /** Source that DEMONSTRATES the miss, so the bound is run rather than asserted. */
  readonly source: string;
  /** The same shape written so the rule CAN see it, so the test is not vacuous. */
  readonly seenWhenStatic: string;
};

export const ENTRY_RESIDUALS: readonly EntryResidual[] = [
  {
    mechanism: "framework_root_file",
    why: "A file the framework loads from the project root whose name is not one of Next's `*FILENAME` constants — `mdx-components.tsx` is the live example, and `next.config.ts`, whose `env` values are inlined into client bundles, is another. Neither is imported by any module, neither sits under a route root, and `frameworkEntrypointNames()` cannot discover either, because Next does not declare their names the way it declares the entrypoints.",
    source: "export function useMDXComponents(components) { return { ...components }; }",
    seenWhenStatic: 'import "./mdx-components";',
  },
  {
    mechanism: "computed_import",
    why: "A specifier the COMPILER cannot read either — `import(`./${name}`)` — is outside every graph this file walks. The forms a regex could not see but the compiler can (a leading `/* webpackChunkName */` comment, a plain template, `require.resolve`) were in this bound's description and are not in the bound: they are read now, and `UNREADABLE_SPECIFIERS` records anything the parser cannot place.",
    source: "const name = \"panel\"; export const load = () => import(`./${name}`);",
    seenWhenStatic: 'export const load = () => import("./panel");',
  },
];

/**
 * EVERY file the framework serves from a route root, plus the entrypoints it
 * loads outside the route tree. No judgement about which of them matter.
 *
 * This used to be the offer's own directory, its ancestor chain, and whatever
 * `filesSellingTheOffer()` picked out — a file that reached an offer module or
 * said the offer's name. That question, "does this file sell the offer", is the
 * one that has now been answered wrongly ten times.
 *
 * The tenth was an ASYMMETRY the previous round introduced while closing the
 * ninth. `robots.txt` and `manifest.webmanifest` were scanned unconditionally as
 * served static files, but `manifest.ts` — a source file producing the SAME
 * response at the SAME URL, whose `description` a customer reads at install and
 * in the app switcher — sold nothing and named nothing, so it was in neither
 * set. An audit served three prohibited claims through it at HTTP 200 with the
 * surface set unchanged and the suite green.
 *
 * So the question is dropped rather than answered again. Everything under a
 * route root is an entry, and the import graph does the rest. Measured before
 * committing to it: the surface goes from 68 files to 174, and the only
 * prohibited claims anywhere in it are the 27 inside the one declared
 * exemption — the whole application already says nothing it should not, so this
 * is a widening of what is CHECKED and not a relaxation of anything.
 *
 * `filesSellingTheOffer`, `namesTheOffer`, `OFFER_MODULE`, `ancestorChainFor`
 * and `ROUTE_DIR` are gone with it, and so is the `computed_name` entry
 * residual: a file that assembles the offer's name at runtime was invisible only
 * because names decided membership. Nothing reads a name now.
 */
function listRouteEntrypoints(): string[] {
  const entries = new Set<string>(ROUTE_ROOTS.flatMap((root) => filesUnder(root)));
  for (const file of frameworkEntrypoints()) entries.add(file);
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
  // ANY own-tree file that exists. The caller decides what to do with it: a
  // source module is parsed and followed, anything else is read as an asset.
  //
  // This used to stop at `/\.(tsx?|jsx?|mjs|cjs|json)$/` and then return null
  // for a list of asset extensions, under the comment "a stylesheet or asset is
  // resolvable and simply not text we read". That was untrue of a stylesheet on
  // its own terms — `content:` renders words, and `src/app/globals.css` IS
  // scanned, because it happens to sit under a route root. So the same bytes
  // were checked in one directory and invisible in another: the identical
  // asymmetry as `manifest.webmanifest` against `manifest.ts`, which the round
  // before this one called the last one. An audit put a claim in
  // `src/components/marketing/trust-badge.css`, imported it from the site
  // chrome, and served it on every marketing route at HTTP 200 with the suite
  // green, `UNRESOLVED_IMPORTS` empty and the exact-set assertion unmoved.
  for (const candidate of candidates) {
    const full = resolve(process.cwd(), candidate);
    if (existsSync(full) && statSync(full).isFile()) return candidate.replace(/\\/g, "/");
  }
  // A specifier into our own tree that resolves to nothing is not a package and
  // not a miss to shrug at — it is a module the guard will never read. Recorded
  // so the suite can fail on it rather than silently narrowing the surface.
  UNRESOLVED_IMPORTS.push(`${fromFile} -> ${specifier}`);
  return null;
}

/** Modules the parser can read. Anything else reached by import is an asset. */
const SOURCE_IMPORT = /\.(tsx?|jsx?|mjs|cjs|json)$/;

/**
 * Files reached BY IMPORT that are not modules — stylesheets, vendored assets.
 *
 * They are scanned as text beside the served assets. Nothing used to look at
 * them at all: the resolver returned null for a list of asset extensions, so a
 * `.css` outside a route root was in no set this module exports.
 */
export const IMPORTED_ASSETS: string[] = [];

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
  "src/app/(app)/app/analytics/page.tsx",
  "src/app/(app)/app/approvals/page.tsx",
  "src/app/(app)/app/billing/page.tsx",
  "src/app/(app)/app/dashboard/page.tsx",
  "src/app/(app)/app/integrations/page.tsx",
  "src/app/(app)/app/page.tsx",
  "src/app/(app)/app/playbooks/[id]/page.tsx",
  "src/app/(app)/app/playbooks/page.tsx",
  "src/app/(app)/app/requests/[id]/page.tsx",
  "src/app/(app)/app/requests/new/page.tsx",
  "src/app/(app)/app/requests/page.tsx",
  "src/app/(app)/app/settings/export/route.ts",
  "src/app/(app)/app/settings/page.tsx",
  "src/app/(app)/app/team/page.tsx",
  "src/app/(app)/app/workstreams/[id]/page.tsx",
  "src/app/(app)/app/workstreams/page.tsx",
  "src/app/(app)/layout.tsx",
  "src/app/(auth)/demo/page.tsx",
  "src/app/(auth)/login/forgot/page.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/login/reset/page.tsx",
  "src/app/(auth)/signup/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/not-found.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/[id]/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/download/route.ts",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/intake/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/app/(marketing)/book/page.tsx",
  "src/app/(marketing)/book/thanks/page.tsx",
  "src/app/(marketing)/contact/page.tsx",
  "src/app/(marketing)/delegation-audit/page.tsx",
  "src/app/(marketing)/for-assistants/page.tsx",
  "src/app/(marketing)/how-it-works/page.tsx",
  "src/app/(marketing)/layout.tsx",
  "src/app/(marketing)/page.tsx",
  "src/app/(marketing)/pricing/page.tsx",
  "src/app/(marketing)/security/page.tsx",
  "src/app/(marketing)/solutions/[slug]/page.tsx",
  "src/app/(marketing)/solutions/page.tsx",
  "src/app/(ops)/layout.tsx",
  "src/app/(ops)/ops/analytics/page.tsx",
  "src/app/(ops)/ops/capabilities/page.tsx",
  "src/app/(ops)/ops/clients/[id]/page.tsx",
  "src/app/(ops)/ops/clients/page.tsx",
  "src/app/(ops)/ops/dashboard/page.tsx",
  "src/app/(ops)/ops/execution/page.tsx",
  "src/app/(ops)/ops/execution/runs/[id]/loading.tsx",
  "src/app/(ops)/ops/execution/runs/[id]/page.tsx",
  "src/app/(ops)/ops/gauntlet/cycles/[id]/page.tsx",
  "src/app/(ops)/ops/gauntlet/page.tsx",
  "src/app/(ops)/ops/operators/page.tsx",
  "src/app/(ops)/ops/page.tsx",
  "src/app/(ops)/ops/playbooks/page.tsx",
  "src/app/(ops)/ops/qa/page.tsx",
  "src/app/(ops)/ops/queue/page.tsx",
  "src/app/(ops)/ops/requests/[id]/page.tsx",
  "src/app/(ops)/ops/skills/page.tsx",
  "src/app/actions/ai-app-release-rescue.ts",
  "src/app/actions/auth.ts",
  "src/app/actions/execution.ts",
  "src/app/actions/gauntlet-recovery.ts",
  "src/app/actions/gauntlet.ts",
  "src/app/actions/leads.ts",
  "src/app/actions/requests.ts",
  "src/app/actions/software-factory.ts",
  "src/app/actions/supplier-sourcing.ts",
  "src/app/actions/twl-prepare-proof.ts",
  "src/app/actions/work-cell.ts",
  "src/app/api/internal/release-rescue/retention-sweep/route.ts",
  "src/app/auth/callback/route.ts",
  "src/app/error.tsx",
  "src/app/layout.tsx",
  "src/app/not-found.tsx",
  "src/components/ai-app-release-rescue/intake-form.tsx",
  "src/components/ai-app-release-rescue/non-claims.tsx",
  "src/components/ai-app-release-rescue/offer-pricing.tsx",
  "src/components/ai-app-release-rescue/report-view.tsx",
  "src/components/ai-app-release-rescue/rubric-checklist.tsx",
  "src/components/brand.tsx",
  "src/components/live-request-status.tsx",
  "src/components/marketing/chrome.tsx",
  "src/components/marketing/home-interactive.tsx",
  "src/components/marketing/skip-to-content.tsx",
  "src/components/nav-link.tsx",
  "src/components/new-request-form.tsx",
  "src/components/product.tsx",
  "src/components/shells.tsx",
  "src/components/software-factory-run.tsx",
  "src/components/supplier-sourcing.tsx",
  "src/components/twl-prepare-proof-assign-fields.tsx",
  "src/components/twl-prepare-proof.tsx",
  "src/components/ui.tsx",
  "src/components/work-cell-action-form.tsx",
  "src/components/work-cell.tsx",
  "src/lib/ai-app-release-rescue/constants.ts",
  "src/lib/ai-app-release-rescue/demo-cookie.ts",
  "src/lib/ai-app-release-rescue/demo-fixtures.ts",
  "src/lib/ai-app-release-rescue/engagement.ts",
  "src/lib/ai-app-release-rescue/intake.ts",
  "src/lib/ai-app-release-rescue/payment.ts",
  "src/lib/ai-validate.ts",
  "src/lib/ai.ts",
  "src/lib/assignment-to-envelope.ts",
  "src/lib/auth-cookie.ts",
  "src/lib/auth-redirect.ts",
  "src/lib/auth.ts",
  "src/lib/capability-performance-ledger.ts",
  "src/lib/capability-registry.ts",
  "src/lib/catalog-evidence-hash.ts",
  "src/lib/catalog-evidence-input.ts",
  "src/lib/catalog-evidence-packet.ts",
  "src/lib/catalog-evidence-review.ts",
  "src/lib/catalog-evidence-shared.ts",
  "src/lib/catalog-evidence-validator.ts",
  "src/lib/cn.ts",
  "src/lib/data/supabase-workspace.ts",
  "src/lib/deployment-origin.ts",
  "src/lib/domain.ts",
  "src/lib/economic-envelope.ts",
  "src/lib/execution-context-enforcement.ts",
  "src/lib/execution-context.ts",
  "src/lib/execution-policy.ts",
  "src/lib/execution-primitives.ts",
  "src/lib/execution-runtime.ts",
  "src/lib/executor-envelope.ts",
  "src/lib/gauntlet-policy.ts",
  "src/lib/gauntlet-recovery.ts",
  "src/lib/gauntlet.ts",
  "src/lib/leads.ts",
  "src/lib/native-skill-registry.ts",
  "src/lib/ops-metrics.ts",
  "src/lib/public-github-pr.ts",
  "src/lib/public-web-researcher.ts",
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
  "src/lib/skill-qualification.ts",
  "src/lib/software-factory-persist.ts",
  "src/lib/software-factory-run-manager.ts",
  "src/lib/solutions.ts",
  "src/lib/store.ts",
  "src/lib/stripe.ts",
  "src/lib/supabase/admin.ts",
  "src/lib/supabase/env.ts",
  "src/lib/supabase/server.ts",
  "src/lib/supplier-communication.ts",
  "src/lib/supplier-outreach-approval.ts",
  "src/lib/supplier-sourcing-run.ts",
  "src/lib/supplier-sourcing.ts",
  "src/lib/tool-invocation-trace.ts",
  "src/lib/twl-prepare-proof-run.ts",
  "src/lib/twl-prepare-proof.ts",
  "src/lib/work-cell-json.ts",
  "src/lib/work-cell-ledger-persistence.ts",
  "src/lib/work-cell-ledger.ts",
  "src/lib/work-cell-operator.ts",
  "src/lib/work-cell-policy.ts",
  "src/lib/work-cell.ts",
  "src/lib/workspace.ts",
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
/**
 * Character references, decoded without a hand-written list of names.
 *
 * This carried ELEVEN named entities. HTML5 defines about 2,200, and an audit
 * served `Your application is&emsp;secure` — an em space, which a browser
 * renders as whitespace between the two claim tokens — straight through. A
 * hand-written list of names, in the module whose premise is that hand-written
 * lists fail.
 *
 * Numeric references are decoded to the character they name. Every NAMED
 * reference becomes a single space, whatever it names: this guard reads prose
 * for a fixed set of ASCII claims, so the only thing a named entity can do to a
 * claim is join or split its words, and a space covers both readings. It is
 * applied ADDITIVELY — the raw text is scanned too — so nothing is lost by
 * decoding a name that was really meant as text.
 *
 * The trailing semicolon is optional because browsers accept `&#32` and
 * `&amp` without it in many positions.
 */
/**
 * Every reference shape, in ONE alternation so the pass cannot eat its own output.
 *
 * These were three chained `replace` calls, which meant each rule ran over the
 * PREVIOUS rule's result: `&#38;` became `&`, and the named-reference rule then
 * consumed the `&test` it had just created. `We deliver a penetration&#38;test`
 * therefore read as `We deliver a penetration for every customer` — the claim
 * erased by the decoder's own output — while a browser renders
 * `penetration&test`, which is the claim. A single global `replace` scans
 * left to right and never rescans what it substitutes.
 */
const CHARACTER_REFERENCE = /&#x([0-9a-f]+);?|&#(\d+);?|&[a-z][a-z0-9]{1,31};?/gi;

function decodeEntities(text: string): string {
  return text.replace(CHARACTER_REFERENCE, (whole, hex?: string, decimal?: string) => {
    if (hex === undefined && decimal === undefined) return " ";
    const code = Number.parseInt(hex ?? decimal ?? "", hex === undefined ? 10 : 16);
    // `decodeCssEscapes` has always carried this guard and this one had none, so
    // `&#x110000;` anywhere on a surface threw `RangeError` out of the extractor
    // rather than being read. A reference outside Unicode is not a character;
    // it renders as its own text, so it is left alone.
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

/**
 * CSS character escapes, which render as the character they name.
 *
 * `content: "penetration\\000020test"` shows a customer "penetration test".
 * The asset scan reads stylesheets — `src/app/globals.css` is in its set — so
 * this is the same evasion as an HTML entity in the other format it reads.
 */
function decodeCssEscapes(text: string): string {
  return text.replace(/\\([0-9a-f]{1,6})[ \t\n]?/gi, (_whole, hex) => {
    const code = Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
  });
}

/**
 * Whitespace-collapsed only, with character references LEFT ALONE.
 *
 * `tidy` always decodes, so the undecoded reading was never produced on this
 * path and the round that introduced "every named reference becomes a space"
 * described itself as additive when it was not. Two things follow from that,
 * both measured by an audit: `"S&P500 clients"` came out as `"S clients"` —
 * `&P500` is not a valid reference, a browser renders it literally, and the
 * words were ERASED rather than joined or split; and `&period;` between two
 * sentences became a space, so a sentence break the licensing scope depends on
 * disappeared and a claim that the eleven-name predecessor caught was missed.
 *
 * Both readings are kept now, the way the asset path already keeps them.
 */
function tidyWithoutDecoding(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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
export function jsxTextOf(node: ts.Node, mode: "separated" | "verbatim", decode = true): string {
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
  if (mode === "separated") return decode ? tidy(parts.join(" ")) : tidyWithoutDecoding(parts.join(" "));
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

/**
 * A literal's source text with its escapes still in it, or null if unavailable.
 *
 * The cooked value is what the program sees; the raw value is what the file
 * contains, and for anything the framework copies into a stylesheet or a script
 * the raw value is what reaches the customer.
 */
/**
 * Escapes that stand for one printable character: `\u2019`, `\u{1f600}`, `\x41`.
 *
 * These are decoded in the raw reading, because cooking does not LOSE them —
 * the cooked value already carries the character, so leaving the escape spelled
 * out adds a reading that is no text anyone renders. It also broke a denial:
 * `"This isn\u2019t a penetration test."` reads as `isn u2019 t` raw, the
 * negation disappears with the apostrophe, and the guard flagged the offer's own
 * disclaimer. The escapes cooking DESTROYS — `\0`, and the CSS escape runs that
 * depend on a literal backslash — are left exactly as written, which is what the
 * raw reading exists for.
 */
/**
 * The leading `\\\\` alternative is load-bearing, not decoration: it consumes an
 * escaped backslash WHOLE so the engine cannot start matching at its second
 * character. Without it `"a\\\\u0020b"` — a backslash followed by the literal
 * text `u0020b` — decoded to `a\\ b`, a reading nothing renders. It falls
 * through the range check below unchanged, which is why the arm needs no
 * special case in the replacer.
 */
const PRINTABLE_ESCAPE = /\\\\|\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})/g;

function rawTextOf(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral, source: ts.SourceFile): string | null {
  const text = node.getText(source);
  if (text.length < 2) return null;
  return text.slice(1, -1).replace(PRINTABLE_ESCAPE, (whole, braced?: string, four?: string, two?: string) => {
    // `\\u{0000_2019}` is valid JavaScript — leading zeros are unbounded, and a
    // `{1,6}` bound left `\\u{00002019}` undecoded, reproducing the `isn u2019 t`
    // reading this decode exists to remove. The range check is the real bound.
    const code = Number.parseInt(braced ?? four ?? two ?? "", 16);
    if (!Number.isInteger(code) || code <= 0x1f || code === 0x7f || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

/**
 * The same text with references left alone, added whenever it differs.
 *
 * It is added UNCONDITIONALLY, and one round of trying to be clever about that
 * is why the rule is stated so plainly here. The second reading exists because
 * decoding can ERASE text — `S&P500 clients` became `S clients`, and a claim
 * inside the erased run went with it. A gate was added so the reading was kept
 * only when a reference-shaped run did not end in a semicolon, on the premise
 * that "a run that ends in a semicolon is a well-formed character reference,
 * which the browser decodes the same way we do".
 *
 * That premise is false, and an audit measured the regression it caused.
 * `&test;` and `&P500;` end in semicolons and are not character references at
 * all: a browser prints them literally, while `decodeEntities` replaces them
 * with a space and erases the words either side. `We deliver a
 * penetration&test; it is thorough` therefore lost its claim entirely — CAUGHT
 * before the gate, MISSED after it — while the identical bytes in a served
 * asset stayed caught, re-creating the "checked in one place, invisible in
 * another" asymmetry this module's whole history is a record of.
 *
 * The gate's own justification was that the corpus showed 13 readings lost and
 * no claims changed. It could not have shown anything else: the corpus contains
 * no semicolon-terminated non-reference, so the measurement was taken inside the
 * premise it was meant to test.
 *
 * The false positive the gate was hiding — `This isn&rsquo;t a penetration test`
 * reading as `isn rsquo t` — is fixed where it belongs, in the licensing scan's
 * contraction rejoin, which knows that those names spell an apostrophe.
 */
function pushUndecoded(found: string[], text: string): void {
  const undecoded = tidyWithoutDecoding(text);
  if (undecoded.length > 0 && undecoded !== tidy(text)) found.push(undecoded);
}

export function visibleStrings(source: string, file = "surface.tsx"): string[] {
  const parsed = parseSurface(file, source);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(tidy(node.text));
      pushUndecoded(found, node.text);
      // And the RAW text, where the two differ.
      //
      // `node.text` is the COOKED value — what JavaScript computes. For a CSS
      // escape inside an inline `<style>` template, cooking destroys the
      // evidence: `content: "penetration\000020test"` cooks `\0` to a NUL, so
      // the backslash the CSS decoder looks for is already gone and the claim
      // stayed invisible even after CSS escapes were read on this path. What
      // Next puts in the stylesheet, and what the browser's CSS parser reads, is
      // the RAW text. An audit served exactly that at HTTP 200 and confirmed the
      // rendered `::after` content in a real browser.
      const raw = rawTextOf(node, parsed);
      if (raw !== null && raw !== node.text) {
        found.push(tidy(raw));
        pushUndecoded(found, raw);
      }
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      for (const part of parts) {
        found.push(tidy(part));
        pushUndecoded(found, part);
      }
      // And the sentence the template renders as, minus its interpolations.
      found.push(tidy(parts.join(" ")));
      pushUndecoded(found, parts.join(" "));
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
      pushUndecoded(found, jsxTextOf(node, "separated", false));
    } else if (jsxChildCount(node) >= 2 && !rendersAlternatives(node)) {
      // Siblings that render adjacently without a JSX parent — an array of
      // elements returned from a component, or elements in object values. Every
      // word is a plain literal in a real JsxElement, so it is none of the
      // recorded residual mechanisms, and the branch above never saw it because
      // it keys on the PARENT being JSX. An audit served it at HTTP 200.
      found.push(renderedTextOf(node));
      pushUndecoded(found, jsxTextOf(node, "separated", false));
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);

  // No length floor. One was introduced at 12 characters, which was longer than
  // five of the 24 prohibited claims, and lowering it to 7 mis-paired quote
  // delimiters and blinded 73 positions the previous commit could see. The
  // parser returns text, so there is nothing to filter for — an empty string is
  // the only thing dropped.
  // Decoded variants, ADDITIVELY, the same way a served asset's readings are.
  // `decodeCssEscapes` was added to the asset path only, so the identical bytes
  // — `content: "penetration\\000020test"` — were caught in a `.css` file and
  // invisible inside an inline `<style>` in a `.tsx`. An audit served exactly
  // that at HTTP 200 and confirmed the rendered text in a real browser. The
  // round that closed "checked in one place, invisible in another" for entities
  // opened it for CSS escapes, in the same commit.
  const decoded: string[] = [];
  for (const text of found) {
    const withoutEscapes = decodeCssEscapes(text);
    if (withoutEscapes !== text) decoded.push(withoutEscapes);
  }
  return [...found, ...decoded].filter((text) => text.length > 0);
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

/**
 * The served assets this suite is allowed not to read, as an EXACT set.
 *
 * `ASSET_RESIDUALS` was the only one of the four residual records that was not
 * pinned — the other three assert their length and their exact mechanisms, and
 * this one asserted only that each entry's prose was long enough. So an asset
 * could join the exemption and nothing failed, which is what made a one-byte
 * classification error free rather than loud. An exemption that costs nothing to
 * take is not an exemption, it is a hole.
 */
export const EXPECTED_ASSET_RESIDUALS = ["src/app/favicon.ico"];

// Declared HERE, at the end, rather than beside the residual computation.
// Its mutant replaces it with the computed set, and from the earlier position
// that referenced `IMPORTED_ASSETS` before initialisation and crashed the module
// at load — so the proof scored the mechanism HELD on a file that failed to run,
// which is the exact defect the proof's own header says it corrected for the
// aliases. Declaration order is what made the evidence wrong.
