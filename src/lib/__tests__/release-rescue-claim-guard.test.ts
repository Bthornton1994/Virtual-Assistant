import ts from "typescript";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_RESCUE_OFFER, findProhibitedClaims } from "@/lib/release-rescue-intake";
import {
  assetIsItsOwnText,
  collectedByTheRunner,
  parseSurface,
  sourceStatesTheOffer,
  staticSpecifiersIn,
  reachableFrom,
  routeRoots,
  frameworkEntrypoints,
  tsconfigAliases,
  RENDERED_AROUND_A_PAGE,
  ASSET_RESIDUALS,
  DECLARED_CLAIM_BEARING_FILES,
  ENTRY_RESIDUALS,
  RELEASE_RESCUE_SERVED_ASSETS,
  SCANNABLE_ASSETS,
  readServedAsset,
  EXTRACTOR_RESIDUALS,
  UNRESOLVED_IMPORTS,
  interpolatesSomething,
  parseProblems,
  renderedTextVerbatim,
  EXPECTED_SURFACE_FILES,
  RELEASE_RESCUE_SURFACE_FILES,
  readSurface,
  rendersMarkup,
  visibleStrings,
} from "./release-rescue-surface-files";

// The claim guard, tested adversarially.
//
// This is the check that stops the offer being described as something it is not.
// An earlier version was defeated by any sentence containing the word
// "engagement" — a word this product uses constantly — and by "nothing" and
// "note", because negation was matched as a substring rather than a token. These
// cases are the ones that got past it.

const EVASIONS = [
  // Substring negations: "nothing" and "note" contain "not".
  "Nothing is left unchecked in our penetration test.",
  "Note that we provide a compliance certification.",
  "This is notable: we deliver a penetration test.",
  // Product vocabulary that previously exempted the whole sentence.
  "This engagement includes a full security guarantee.",
  "Engage Delegation Cloud for a penetration test of your app.",
  "Our specialists deliver a penetration test with every review.",
  "Every engagement ends with a compliance certification.",
  // Whitespace and phrasing variants.
  "We perform a penetration  test for every customer.",
  "We offer pen testing and pentest services.",
  "We are SOC 2 certified.",
  // Guarantee-shaped claims the phrase list previously missed.
  "We guarantee your application is secure.",
  "Your app will be secure after this review.",
  "We guarantee the absence of vulnerabilities.",
  "After our review there are no vulnerabilities.",
  "Your application is fully secure.",
];

const REQUIRED_DENIALS = [
  "This review is not a penetration test.",
  "This review is not a compliance certification.",
  "This review does not guarantee the absence of vulnerabilities.",
  "It is not a compliance certification (SOC 2, ISO 27001, or any other standard).",
  "We do not offer a security guarantee.",
  "We never claim your application is secure.",
  "Unlike a penetration test, this review reads source rather than attacking a running system.",
  "Customers who need penetration testing should engage a qualified specialist.",
  "This review is not a penetration test and does not guarantee the absence of vulnerabilities.",
  "We cannot guarantee your application is secure.",
];

describe("prohibited claim guard", () => {
  for (const text of EVASIONS) {
    it(`catches: ${text}`, () => {
      expect(findProhibitedClaims(text), text).not.toEqual([]);
    });
  }

  for (const text of REQUIRED_DENIALS) {
    it(`permits the denial: ${text.slice(0, 52)}`, () => {
      expect(findProhibitedClaims(text), text).toEqual([]);
    });
  }

  it("is deliberately conservative about unusual denial phrasing", () => {
    // "Nothing here is a compliance certification" is a denial in English, and
    // the guard flags it. That is a chosen trade-off, not an oversight: treating
    // "nothing" as a negation would re-open "Nothing is left unchecked in our
    // penetration test", which is a claim. A false positive costs an author one
    // rewrite into the plain form; a false negative ships an overclaim.
    expect(findProhibitedClaims("Nothing here is a compliance certification.")).toContain(
      "compliance certification",
    );
    expect(findProhibitedClaims("This is not a compliance certification.")).toEqual([]);
  });

  it("licenses every item in a multi-item referral", () => {
    // Clause splitting on the comma would isolate the later items from the
    // "who need" that licenses them.
    const text =
      "Customers who need penetration testing, compliance certification, or ongoing security monitoring should engage a qualified specialist.";

    expect(findProhibitedClaims(text)).toEqual([]);
  });

  it("does not fire on words that merely contain a claim phrase", () => {
    for (const text of [
      "Our pentesters are not involved in this review.",
      "The data is securely stored and encrypted at rest.",
      "This is secured by row level security.",
      "A structured release-readiness review.",
    ]) {
      expect(findProhibitedClaims(text), text).toEqual([]);
    }
  });

  it("catches an affirmative claim in a sentence that denies something else", () => {
    const text = "This is not a compliance certification. We do provide a penetration test.";

    expect(findProhibitedClaims(text)).toContain("penetration test");
    expect(findProhibitedClaims(text)).not.toContain("compliance certification");
  });

  it("catches a claim later in a sentence whose first clause is a denial", () => {
    // The clause is bounded by punctuation, so an earlier "not" in a DIFFERENT
    // clause must not license a later claim.
    const text = "We are not a consultancy; we deliver a penetration test.";

    expect(findProhibitedClaims(text)).toContain("penetration test");
  });
});

// Every customer-visible surface, checked by the real guard.
//
// AGENTS.md states that findProhibitedClaims "is the single list governing both
// report text and the marketing surface". Before this test, no code path applied
// it to the marketing surface at all, so that was an aspiration. Now it is CI.
//
// The set is DISCOVERED and the extractor reads wrapped prose; both of those
// were hand-shaped and wrong, and `release-rescue-surface-files.ts` records
// exactly how. A new marketing route is covered the day it is added, not the
// day someone remembers to add it here.
const SURFACE_FILES = RELEASE_RESCUE_SURFACE_FILES;

describe("the marketing surface makes no prohibited claim", () => {
  it("discovers exactly the expected surface files, so the set cannot go stale", () => {
    // This was `toBeGreaterThan(12)` against a set of 14, so the walk could lose
    // TWO files and still report success — including either of the `demo/[id]`
    // routes the floor was written immediately after missing. A floor cannot
    // tell a set from a smaller set. It could not tell 47 payloads from 50
    // either, which was a blocking finding two rounds ago, and it let a caught
    // payload sit in the residual corpus for four rounds.
    //
    // The set is the assertion. A rename that drops a surface now names it.
    expect(SURFACE_FILES).toEqual(EXPECTED_SURFACE_FILES);
    for (const file of SURFACE_FILES) {
      expect(existsSync(resolve(process.cwd(), file)), `${file} does not exist`).toBe(true);
    }
  });

  for (const file of SURFACE_FILES.filter((candidate) => !(candidate in DECLARED_CLAIM_BEARING_FILES))) {
    it(file, () => {
      const source = readSurface(file);
      const offences: Array<{ text: string; claims: string[] }> = [];

      for (const text of visibleStrings(source, file)) {
        const claims = findProhibitedClaims(text);
        if (claims.length > 0) offences.push({ text, claims });
      }

      expect(offences, `${file} makes a prohibited claim`).toEqual([]);
    });
  }

  it("actually finds strings to check, so a passing run means something", () => {
    // Without this, a broken extractor would make every file above pass vacuously.
    // Per-file, only for files that actually render markup. The set now reaches
    // general-purpose modules — a cookie helper, an env reader — whose customer
    // words, if any, live in quoted strings; requiring prose from every one of
    // them would assert something untrue.
    for (const file of SURFACE_FILES) {
      const source = readSurface(file);
      if (!rendersMarkup(source, file)) continue;
      expect(visibleStrings(source, file).length, file).toBeGreaterThan(0);
    }

    // And across the set, a floor — which IS the right shape here, by the same
    // test the rest of this suite applies: a floor belongs where the quantity is
    // genuinely unbounded above. Copy grows; an exact count would go red on every
    // wording change while proving nothing. What it catches is the failure it is
    // for: an extractor that silently returns nothing.
    const total = SURFACE_FILES.reduce((sum, file) => sum + visibleStrings(readSurface(file), file).length, 0);

    expect(total, "the extractor reads almost nothing — it is probably broken").toBeGreaterThan(1500);
  });

  it("parses every surface file cleanly, so 'no text' never means 'did not parse'", () => {
    // `createSourceFile` is error-tolerant and returns a tree for anything. A
    // legacy `<string>value` assertion — valid TypeScript that `tsc` and the
    // build both accept — parses under TSX as one enormous JsxText and swallows
    // the file; an unterminated comment reduces a component to zero strings and
    // flips `rendersMarkup` to false, so the per-file check skips it and passes
    // on silence. The extractor cannot tell "nothing to read" from "could not
    // read", so the suite asks the parser directly.
    for (const file of SURFACE_FILES) {
      expect(parseProblems(file, readSurface(file)), `${file} does not parse cleanly`).toEqual([]);
    }

    // A specifier into our own tree that resolves to nothing is a module the
    // guard will never read. It used to return null in silence, so importing a
    // `.jsx` component into a checked page removed it from the surface without
    // changing anything that could fail.
    expect(UNRESOLVED_IMPORTS, "an own-tree import resolved to nothing").toEqual([]);
  });

  it("records what the extractor cannot see, as an exact set", () => {
    // The tokenizer's residuals are an exact set because a bound should be a
    // measurement rather than a silence. The extractor had no such record, and
    // an audit walked through the gap: a fix that read RENDERED text still could
    // not see `{RESCUE_SERVICE_NAME}`, because an identifier is not a literal.
    // Every entry below is verified STILL invisible, so a future extractor that
    // starts seeing one has to come here and narrow the claim.
    for (const residual of EXTRACTOR_RESIDUALS) {
      expect(
        visibleStrings(residual.source).some((text) => findProhibitedClaims(text).length > 0),
        `${residual.mechanism}: ${residual.source} — if this is now seen, the recorded bound is overstated`,
      ).toBe(false);
    }

    // The ENTRY rule's residuals, asserted the same way. They were recorded and
    // then read by nothing — the "a figure nothing reads is a figure nothing can
    // keep true" defect, in the record added to prevent the next round of it.
    expect(ENTRY_RESIDUALS.length).toBe(2);
    expect([...new Set(ENTRY_RESIDUALS.map((entry) => entry.mechanism))].sort()).toEqual([
      "computed_import",
      "computed_name",
    ]);
    for (const entry of ENTRY_RESIDUALS) {
      expect(entry.why.length, `${entry.mechanism} needs a reason, not an entry`).toBeGreaterThan(80);

      // And the bound is RUN, the way the extractor's residuals are. A commit
      // claimed these were "asserted the way EXTRACTOR_RESIDUALS is" when the
      // suite only counted them and measured the length of their prose — a
      // record that nothing executes, in the record added to stop exactly that.
      if (entry.mechanism === "computed_name") {
        expect(
          sourceStatesTheOffer(entry.source, "residual.tsx"),
          "the computed_name residual must actually be invisible to the entry rule",
        ).toBe(false);
        expect(
          sourceStatesTheOffer(entry.seenWhenStatic, "residual.tsx"),
          "and the same shape written statically must be seen, or the residual proves nothing",
        ).toBe(true);
      } else {
        expect(
          staticSpecifiersIn(entry.source),
          "the computed_import residual must actually be unresolvable by the walk",
        ).toEqual([]);
        expect(
          staticSpecifiersIn(entry.seenWhenStatic),
          "and the static form must be resolvable, or the residual proves nothing",
        ).not.toEqual([]);
      }
    }

    expect(EXTRACTOR_RESIDUALS.length).toBe(6);
    expect([...new Set(EXTRACTOR_RESIDUALS.map((r) => r.mechanism))].sort()).toEqual([
      "computed",
      "cross_component",
      "identifier",
      "non_jsx_element",
    ]);

    // Each entry must be real source that renders the claim, not prose about
    // one. Two used to be prose and passed by having no claim in them to miss.
    for (const residual of EXTRACTOR_RESIDUALS) {
      expect(parseProblems("residual.tsx", residual.source), `${residual.source} must parse`).toEqual([]);
      // Both halves, or the entry proves nothing: what it RENDERS must be a
      // real claim, and what the extractor SEES must not contain it.
      expect(
        findProhibitedClaims(residual.renders).length,
        `${residual.mechanism}: the declared rendered text carries no claim, so its invisibility proves nothing`,
      ).toBeGreaterThan(0);

      // And `renders` must be what the SOURCE produces, not what its author
      // believed. One entry declared a space between two adjacent elements that
      // a browser does not insert, so it rendered "issecure" and was invisible
      // for the wrong reason — passing the very test added to stop that. Where
      // the JSX interpolates something the parser cannot resolve, the rendered
      // text is by definition uncomputable and the declaration stands alone.
      if (!interpolatesSomething(residual.source)) {
        const verbatim = renderedTextVerbatim(residual.source);
        if (verbatim.length > 0) {
          expect(verbatim, `${residual.mechanism}: declared renders disagrees with its own source`).toBe(
            residual.renders,
          );
        }
      }
    }
  });

  it("declares exactly the files that need a claim-bearing exemption, and no more", () => {
    // A file reachable from a route is CHECKED unless it is declared, and the
    // declaration carries a reason. The danger with any exemption list is that
    // it becomes the place a real hit goes to die, so this asserts the list from
    // BOTH sides: every declared file must genuinely still need the exemption,
    // and no undeclared file may need one.
    //
    // A stale exemption therefore fails exactly as loudly as a missing one.
    const needsExemption = SURFACE_FILES.filter((file) =>
      visibleStrings(readSurface(file), file).some((text) => findProhibitedClaims(text).length > 0),
    );

    expect(needsExemption.sort()).toEqual(Object.keys(DECLARED_CLAIM_BEARING_FILES).sort());
    for (const [file, why] of Object.entries(DECLARED_CLAIM_BEARING_FILES)) {
      expect(SURFACE_FILES, `${file} is declared but no longer reachable from a route`).toContain(file);
      expect(why.length, `${file} needs a reason, not an entry`).toBeGreaterThan(80);
    }

    // AND only ONE file can ever be declared: the one that defines the list.
    //
    // The vocabulary rule below was still too wide. An audit exported
    // `RESCUE_TRUST_BADGE = "guaranteed secure"` from `constants.ts`, rendered
    // it on the offer's pricing card, declared `constants.ts`, and served the
    // badge at HTTP 200 with the suite green — because a bare vocabulary entry
    // IS the overclaim once something renders it.
    //
    // There is exactly one honest reason to hold claim text, and it applies to
    // exactly one file: the module that defines `prohibitedClaims`, whose
    // strings the guard consumes rather than renders. Any other file is a
    // rendering surface, so it cannot be declared at all and the door closes.
    const claimListModule = "src/lib/release-rescue-intake.ts";

    expect(Object.keys(DECLARED_CLAIM_BEARING_FILES)).toEqual([claimListModule]);
    expect(
      readSurface(claimListModule),
      "the declared file must be the one that DEFINES the claim list, not merely quote it",
    ).toMatch(/prohibitedClaims\s*:/);

    // AND the exemption covers VOCABULARY, never prose.
    //
    // Both-sides was not enough on its own: an audit planted a claim in the
    // intake action and added that file to the map in the SAME edit, and both
    // sides moved together, so nothing failed. Nothing validates that a written
    // reason is true — that was a governance control wearing a technical one's
    // clothes.
    //
    // What IS checkable: the only legitimate reason to hold claim text is to BE
    // the vocabulary. So every flagged string in a declared file must be one of
    // the offer's own phrases standing alone, in prose form or as an identifier.
    // A sentence that merely contains a claim can no longer be exempted, which
    // is exactly the shape the audit used to slip one through.
    const vocabulary = new Set(
      RELEASE_RESCUE_OFFER.prohibitedClaims.flatMap((claim) => [claim, claim.replace(/[ -]/g, "_")]).map((entry) => entry.toLowerCase()),
    );
    for (const file of Object.keys(DECLARED_CLAIM_BEARING_FILES)) {
      for (const text of visibleStrings(readSurface(file), file).filter((candidate) => findProhibitedClaims(candidate).length > 0)) {
        expect(
          vocabulary.has(text.trim().toLowerCase()),
          `${file}: ${JSON.stringify(text.slice(0, 80))} is prose carrying a claim, not the offer's own vocabulary. An exemption cannot cover it.`,
        ).toBe(true);
      }
    }
  });

  it("would catch a planted claim, in every shape these files actually write prose", () => {
    // This test used to plant ONE shape — a single-line quoted string — which is
    // the shape the extractor read most reliably. Two others were planted by an
    // audit, served over HTTP from a real build, and killed nothing:
    //
    //   1. A quoted string in `lib/ai-app-release-rescue/intake.ts`, which was
    //      outside the file set entirely.
    //   2. A JSX paragraph WRAPPED across lines, which the extractor stopped
    //      reading at the newline. The identical sentence on one line was
    //      caught, so the formatter decided whether the guard ran.
    //
    // Both are here now, so the extractor cannot silently stop reading prose.
    // A shape is either a source string parsed as `.tsx`, or a [file, source]
    // pair when the FILE NAME is the point — the dialect a surface is parsed as
    // comes from its extension, and that was wrong for every `.js` and `.jsx`.
    const planted: Record<string, string | readonly [string, string]> = {
      "single-line quoted string": `export const COPY = "We deliver a penetration test of your application.";`,
      "retention copy in a lib constant": `  purge_on_delivery: "Delete my source material once the report proves my app is secure",`,
      "wrapped JSX paragraph": `
        <p className="mt-8 text-sm text-ink-soft">
          When the review is finished your application is secure and free of vulnerabilities, and we
          deliver a penetration test report you can hand to your enterprise buyer.
        </p>`,
      // Four more shapes, each planted by an audit in a real file, built, and
      // served over HTTP while the whole suite stayed green. Three of them are
      // the SAME defect as the wrapped paragraph — the extractor deciding by
      // formatting rather than content — surviving one round past the commit
      // that declared that defect closed.
      "inline markup splitting a sentence": `<p>Checkout is prepared. We deliver a <strong>penetration test</strong> of your application.</p>`,
      "a word in an expression container": `<p>Your application is {"secure"} and free of vulnerabilities.</p>`,
      "a continuation after a line break": `<p>The review confirms that<br />your application is secure and free of vulnerabilities.</p>`,
      "a claim split across concatenated literals": `<p>{"Your application is " + "secure and audited for release."}</p>`,
      // The third round of this same defect. JSX resolves entities before a
      // customer reads the page; the extractor was reading raw source, so
      // `penetration&#32;test` matched nothing while the page served the words.
      // `&nbsp;` is the ordinary way to stop a two-word phrase wrapping, and
      // `react/no-unescaped-entities` is enforced here, so this is a shape this
      // codebase would reach for rather than an adversarial one.
      "a claim hidden behind numeric entities": `<p>We deliver a penetration&#32;test and your application is&#32;secure.</p>`,
      "a claim hidden behind &nbsp;": `<p>We deliver a penetration&nbsp;test and your application is&nbsp;secure.</p>`,
      // The shapes a REGRESSION let through. An extractor rewrite discarded any
      // run containing `{`, `}`, `;` or `=>` as code — but a JSX text node and
      // the expression inside it are one run, so a single `{price}` threw the
      // whole sentence away, and that is the dominant prose shape in this
      // codebase. Fourteen runs of live copy went unread, the offer's own `<h1>`
      // among them, and four overclaims served at HTTP 200 with the suite green.
      // The commit before it caught all three of these.
      "prose beside an interpolation": `<h1>A {formatUsd(PRICE)} penetration test of what would block a release.</h1>`,
      "prose containing a semicolon": `<p>Checkout is prepared; after this review your application is secure.</p>`,
      "an interpolation opening the sentence": `<p>{count} of these findings are in scope. We deliver a penetration test of every repository.</p>`,
      // Five of the 24 claims are shorter than the old 12-character floor, so
      // they were invisible standing alone in an element — and were not recorded
      // as residuals either. The floor is derived from the claim list now.
      "a short claim standing alone": `<li>pentest</li>`,
      // The shapes a KEYWORD heuristic and a LENGTH FLOOR let through. Each fix
      // in this file was a new heuristic and each new heuristic was the next
      // round's finding, so the regex extractor was replaced by the TypeScript
      // parser. These stay as cases because they are cheap and because they are
      // what a future rewrite has to keep.
      "English words that are also keywords": `<p>We return the report and export your findings once your application is secure.</p>`,
      "a claim after a short sibling literal": `const row = { id: "sk", name: "We deliver a penetration test", tier: "x" };`,
      "a comparison inside the text node": `<p>{n} pass. Your application is secure.{n > 0 ? " x" : ""}</p>`,
      "a claim split by a template interpolation": "const w = \"secure\"; const s = `Your application is ${w} and free of vulnerabilities`;",
      // Siblings that render adjacently with no JSX parent between them. The
      // run-together rule keyed on the PARENT being JSX, so an array returned
      // from a component slipped past it and served at HTTP 200.
      "adjacent siblings in an array": `const A = () => [<span key="a">Your application is </span>, <span key="b">secure.</span>];`,
      "adjacent siblings in object values": `const M = { a: <b>Your application is </b>, b: <b>secure.</b> };`,
      // JSX passed as a PROP, on an element with nothing above it. Wrapped in a
      // `<div>` the guard read it, because the walk descends through attributes
      // from any JsxElement; outermost, the node is a JsxSelfClosingElement and
      // no branch claimed it. A whole sentence, read by nothing.
      "JSX in props on an outermost element": `const L = () => <Row lead={<b>Your application is </b>} tail={<b>secure.</b>} />;`,
      // The dialect shapes. `allowJs` is on and Next's default `pageExtensions`
      // includes `js` and `jsx`, but every surface was parsed as TypeScript — in
      // which JSX is a syntax error, so the tree came back as error nodes and the
      // extractor read nothing at all. Silently.
      "a route served as .js": ["app/page.js", `export default function P() { return <p>Your application is secure.</p>; }`],
      "a component served as .jsx": ["components/card.jsx", `export const C = () => <p>We deliver a penetration test.</p>;`],
    };

    // The published figure, bound to the thing it counts. A commit wrote
    // "eighteen shapes" into the architecture doc while this map held 17 — in
    // the same diff that corrected a different number for not reproducing. A
    // figure nothing reads is a figure nothing can keep true.
    const doc = readSurface("docs/AI-APP-RELEASE-RESCUE-V1.md");
    const everyFigure = [...doc.matchAll(/\*\*(\d+) planted\s+shapes\*\*/g)];
    const published = everyFigure[0];

    expect(published, "the planted-shape figure could not be located in the doc").not.toBeNull();
    // `exec` reads the first match only, so a second figure could drift behind
    // it unnoticed — the same "nothing reads it" defect this test exists for.
    expect(everyFigure.length, "the planted-shape figure must appear exactly once").toBe(1);
    expect(Number(published![1]), "the doc's planted-shape count must be this map's size").toBe(
      Object.keys(planted).length,
    );

    for (const [shape, entry] of Object.entries(planted)) {
      const [file, source] = typeof entry === "string" ? ["planted.tsx", entry] : entry;
      expect(
        visibleStrings(source, file).flatMap((text) => findProhibitedClaims(text)),
        `a planted claim in a ${shape} must be read by the extractor`,
      ).not.toEqual([]);
    }
  });

  it("reads the words in everything `public/` serves", () => {
    // `public/` is reached by no import: Next serves these files because they
    // are on disk. Every walk in the discovery module follows imports from
    // rendered routes, so an SVG carrying `<text>We deliver a penetration
    // test</text>` was outside all of them.
    expect(RELEASE_RESCUE_SERVED_ASSETS.length, "public/ was not enumerated at all").toBeGreaterThan(0);
    expect(
      [...SCANNABLE_ASSETS, ...ASSET_RESIDUALS.map((residual) => residual.file)].sort(),
      "every served asset is either read or recorded as unreadable",
    ).toEqual([...RELEASE_RESCUE_SERVED_ASSETS].sort());

    for (const file of SCANNABLE_ASSETS) {
      expect(findProhibitedClaims(readServedAsset(file), "typed_field"), `${file} serves a prohibited claim`).toEqual([]);
    }

    // The unreadable ones carry a reason, not an entry — the rule the tokenizer
    // and extractor residuals already follow.
    for (const residual of ASSET_RESIDUALS) {
      expect(residual.why.length, `${residual.file} needs a reason, not an entry`).toBeGreaterThan(80);
    }
  });

  it("wires each derivation into the module, rather than pasting the answer it happens to give", () => {
    // This project declares ONE alias, has ONE framework entrypoint on disk and
    // ONE route root. So the derived answer and a hard-coded literal agree on
    // this repository, and no behavioural test can tell them apart — which is
    // exactly how the mutation proof came to report two mechanisms HELD while
    // reverting either to its literal predecessor changed nothing.
    //
    // What can be checked is the WIRING: that the constant is initialised by
    // calling the derivation rather than by restating its current output. That
    // is the property a regression would break, and it is a fact about this
    // module's own source, so it is read from that source.
    const moduleSource = readSurface("src/lib/__tests__/release-rescue-surface-files.ts");
    const parsed = parseSurface("release-rescue-surface-files.ts", moduleSource);

    const initialiserOf = (name: string): string | null => {
      let found: string | null = null;
      const visit = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === name &&
          node.initializer
        ) {
          found = node.initializer.getText(parsed);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      return found;
    };

    expect(initialiserOf("ALIASES"), "ALIASES must be read from tsconfig, not restated").toBe("tsconfigAliases()");
    expect(initialiserOf("ROUTE_ROOTS"), "ROUTE_ROOTS must be probed, not named").toBe("routeRoots()");
    expect(initialiserOf("COLLECTED_BY_THE_RUNNER"), "the runner's globs must be read from its config").toBe(
      "vitestIncludeGlobs()",
    );
    expect(
      moduleSource.includes("for (const file of frameworkEntrypoints()) entries.add(file);"),
      "the entry set must come from the derived entrypoints",
    ).toBe(true);
  });

  it("serves assets from every directory the framework serves them from", () => {
    // The served set is the union of `public/` and the route roots' non-source
    // files. Dropping either source left every assertion about the set still
    // true — the union still held, the length was still non-zero — so the
    // mutation proof reported both sources UNHELD. Each source is now required
    // to contribute, which is a true statement about this repository: five SVGs
    // under `public/`, and `favicon.ico` and `globals.css` under `src/app`.
    const fromPublic = RELEASE_RESCUE_SERVED_ASSETS.filter((file) => file.startsWith("public/"));
    const fromRouteRoots = RELEASE_RESCUE_SERVED_ASSETS.filter((file) =>
      routeRoots().some((root) => file.startsWith(`${root}/`)),
    );
    expect(fromPublic.length, "public/ must contribute to the served set").toBeGreaterThan(0);
    expect(
      fromRouteRoots.length,
      "the route roots' non-source files are served at the site root and must contribute too",
    ).toBeGreaterThan(0);
    expect(
      [...fromPublic, ...fromRouteRoots].sort(),
      "the served set is exactly those two sources",
    ).toEqual([...RELEASE_RESCUE_SERVED_ASSETS].sort());
  });

  it("derives path aliases from a config, not from the one prefix this project happens to use", () => {
    // This project declares exactly one alias, `@/`, and exactly one framework
    // entrypoint exists on disk. So NOTHING in the repository distinguishes
    // "read the aliases from tsconfig" from "assume the literal `@/`" — the
    // mutation proof reported both mechanisms HELD only because its mutant
    // substituted the EMPTY set, which trips an explicit throw, rather than the
    // implementation each one replaced. Reverted to the real predecessors, both
    // suites stayed green: the mechanisms were not held at all.
    //
    // The derivation is exercised here against a config this project does not
    // have, which is the only way a derivation can be told from an assumption.
    const scratch = mkdtempSync(join(tmpdir(), "release-rescue-tsconfig-"));
    try {
      writeFileSync(
        join(scratch, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            // A second alias, and a comment, and a trailing comma — all of which
            // tsconfig permits and `JSON.parse` does not. A hand-rolled stripper
            // for this format ate the paths map on its own `"@/*"` key.
            paths: { "@/*": ["./src/*"], "~/*": ["./src/*"], "#shared/*": ["./packages/shared/*"] },
          },
        }),
      );
      const aliases = tsconfigAliases(join(scratch, "tsconfig.json"));
      expect(
        aliases.map((alias) => alias.prefix).sort(),
        "every alias the config declares must be read, not only the one this project uses",
      ).toEqual(["#shared/", "@/", "~/"]);
      expect(aliases.find((alias) => alias.prefix === "#shared/")?.target).toBe("packages/shared");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("finds a framework entrypoint in either location and any servable extension", () => {
    // The predecessor was three literal strings with the `src/` spelling only.
    // It missed `instrumentation-client`, which runs in the BROWSER on every
    // route and is imported by nothing. This repository has one entrypoint, so
    // only a tree it does not have can tell the derivation from the list.
    const scratch = mkdtempSync(join(tmpdir(), "release-rescue-entry-"));
    try {
      mkdirSync(join(scratch, "src"), { recursive: true });
      writeFileSync(join(scratch, "instrumentation-client.js"), "export function onRouterTransitionStart() {}\n");
      writeFileSync(join(scratch, "src", "proxy.tsx"), "export default function proxy() {}\n");
      writeFileSync(join(scratch, "src", "middleware.mjs"), "export default function middleware() {}\n");
      writeFileSync(join(scratch, "src", "not-an-entrypoint.ts"), "export const x = 1;\n");

      expect(frameworkEntrypoints(scratch).sort(), "every location and extension the framework resolves").toEqual([
        "instrumentation-client.js",
        "src/middleware.mjs",
        "src/proxy.tsx",
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("keeps a module a page imports in the graph, whatever the module is called", () => {
    // The exclusion used to be applied INSIDE the import graph, so a component
    // was deleted from the walk AFTER its specifier resolved: `UNRESOLVED_IMPORTS`
    // could not fire, the exact-set assertion did not move, and the file was
    // read by nothing while Next bundled and rendered it. Two prohibited claims
    // were served at HTTP 200 from the offer's own landing page with the whole
    // suite green.
    const reached = reachableFrom("src/lib/__tests__/surface-fixtures/imports-it.ts");
    expect(
      reached,
      "a module reached by import stays in the graph even when its name looks like a test",
    ).toContain("src/lib/__tests__/surface-fixtures/renders-prose.test.tsx");
  });

  it("probes for the route directories Next resolves, rather than naming one", () => {
    // `APP_DIR` was the single string "src/app". Next resolves `app` or
    // `src/app`, and `pages` or `src/pages`, so a Pages Router page naming the
    // offer sat outside every walk in the module at once.
    const scratch = mkdtempSync(join(tmpdir(), "release-rescue-roots-"));
    try {
      mkdirSync(join(scratch, "src", "app"), { recursive: true });
      mkdirSync(join(scratch, "src", "pages"), { recursive: true });
      mkdirSync(join(scratch, "pages"), { recursive: true });
      expect(routeRoots(scratch).sort(), "every route directory the framework resolves").toEqual([
        "pages",
        "src/app",
        "src/pages",
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("treats a file as a test only when the runner actually collects it", () => {
    // The predecessor was a name pattern naming four spellings. `vitest`
    // collects only `src/**/*.test.ts`, so `.test.tsx` and `.test-fixtures.ts`
    // were excluded from the surface AND never run as tests — read by nothing,
    // while Next bundled and rendered them. An audit imported a
    // `release-note.test.tsx` into the offer's own landing page and served two
    // prohibited claims at HTTP 200 with the whole suite green.
    expect(collectedByTheRunner("src/lib/__tests__/release-rescue-claim-guard.test.ts")).toBe(true);
    for (const notCollected of [
      "src/components/x/release-note.test.tsx",
      "src/components/x/banner.test.jsx",
      "src/lib/y/demo.test-fixtures.ts",
      "src/components/x/banner.tsx",
    ]) {
      expect(
        collectedByTheRunner(notCollected),
        `${notCollected} is not run by the test runner, so it is a surface`,
      ).toBe(false);
    }
  });

  it("counts every file Next renders around a page, including the ones this repo has none of yet", () => {
    // This pattern was widened to Next 16's full set — `global-not-found`,
    // `forbidden`, `unauthorized`, `default`, and the `.jsx`/`.mjs`/`.cjs`
    // extensions. The repository has an instance of none of them, so narrowing
    // it back changed no discovered file and failed no test: a widening nothing
    // exercises is a widening nothing keeps. The pattern is asserted directly.
    for (const name of [
      "layout.tsx",
      "template.tsx",
      "error.tsx",
      "global-error.tsx",
      "global-not-found.tsx",
      "not-found.tsx",
      "forbidden.tsx",
      "unauthorized.tsx",
      "loading.tsx",
      "default.tsx",
      "layout.jsx",
      "not-found.js",
    ]) {
      expect(RENDERED_AROUND_A_PAGE.test(name), `${name} is rendered around a page`).toBe(true);
    }

    // And it must not swallow an ordinary module that merely starts the same way.
    for (const name of ["layout-helpers.tsx", "errors.ts", "default-theme.ts"]) {
      expect(RENDERED_AROUND_A_PAGE.test(name), `${name} is not a page-adjacent file`).toBe(false);
    }
  });

  it("does not invent a sentence out of two arms that never render together", () => {
    // The run-together rule joins JSX siblings because a browser concatenates
    // them. The arms of a conditional are not siblings — one runs or the other
    // does — so joining them produced "Your application is secure." from a
    // source that renders no such sentence. Flagging fabricated text errs safe,
    // but this file's whole subject is not asserting things that are not so.
    const alternatives = `const T = ({ok}: {ok: boolean}) => (ok ? <span>Your application is </span> : <span>secure.</span>);`;
    expect(
      visibleStrings(alternatives, "planted.tsx"),
      "the two arms must be read separately, not concatenated",
    ).not.toContain("Your application is secure.");

    // And the real path through a conditional INSIDE an element still counts:
    // there the children genuinely are adjacent when the branch is taken.
    const realPath = `const T = ({ok}: {ok: boolean}) => <p>{ok ? <b>Your application is </b> : null}<b>secure.</b></p>;`;
    expect(
      visibleStrings(realPath, "planted.tsx").flatMap((text) => findProhibitedClaims(text)),
      "a claim completed by a taken branch must still be read",
    ).not.toEqual([]);
  });

  it("reads rendered text the way a browser does, not the way it is indented", () => {
    // `renderedTextVerbatim` exists to check a recorded residual's declared
    // rendered text against its own source. It collapsed every whitespace run to
    // one space, so siblings written across lines read as "Lead Tail" when JSX
    // deletes a whitespace-only line break and a browser renders "LeadTail" —
    // the check disagreeing with the source for a formatting reason, which is
    // the opposite of what it was added to catch.
    expect(
      renderedTextVerbatim(`const P = () => (
  <p>
    <span>Lead</span>
    <span>Tail</span>
  </p>
);`),
      "a whitespace-only line break renders as nothing",
    ).toBe("LeadTail");

    // A space written INSIDE an element is significant and must survive.
    expect(
      renderedTextVerbatim(`const P = () => <p><span>Your application is </span><span>secure.</span></p>;`),
      "a trailing space inside an element is rendered",
    ).toBe("Your application is secure.");
  });

  it("would read a planted claim out of a served asset", () => {
    // Without this the asset scan is vacuous: a loop over files whose extension
    // never matches passes exactly as loudly as one that works. `public/` today
    // holds five SVGs with no text at all.
    const asset = `<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="0">We deliver a penetration test.</text></svg>`;
    expect(findProhibitedClaims(asset, "typed_field"), "a claim in an SVG must be read").not.toEqual([]);

    // A served asset is scanned as a TYPED FIELD, not as offer copy. Offer copy
    // lets a disclaimer license a claim in the same clause, which is right for
    // prose a person wrote and wrong for markup: an SVG's tag names, `id`s and
    // `aria-label`s all enter the same token stream, so any of them lands
    // between a denial and the claim and licenses it. An audit served a badge
    // reading "This is not a penetration test" beside "We deliver a penetration
    // test" at HTTP 200 with the suite green. An asset cannot carry a scoped
    // disclaimer, so it does not get to benefit from one.
    const licensed = `<svg xmlns="http://www.w3.org/2000/svg"><desc>This is not a penetration test</desc><text x="10" y="30">We deliver a penetration test</text></svg>`;
    expect(
      findProhibitedClaims(licensed, "typed_field"),
      "a disclaimer elsewhere in an asset must not license the claim",
    ).not.toEqual([]);
    expect(
      findProhibitedClaims(licensed, "offer_copy"),
      "this payload is disarmed under offer_copy, which is why assets are not read as offer copy",
    ).toEqual([]);

    // And the classification in both directions, decided by BYTES rather than by
    // a name. `public/` holds five SVGs today, so `ASSET_RESIDUALS` is empty and
    // its loop asserts nothing; these two files make the decision run.
    const scratch = mkdtempSync(join(tmpdir(), "release-rescue-asset-"));
    try {
      const text = join(scratch, "notice.js");
      writeFileSync(text, 'export const NOTE = "we deliver a penetration test";\n');
      expect(assetIsItsOwnText(text), "a .js asset is text and must be read").toBe(true);

      const binary = join(scratch, "badge.png");
      writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
      expect(assetIsItsOwnText(binary), "a PNG is not readable as text").toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("the offer's claim list", () => {
  it("covers every shape the guard is meant to stop", () => {
    for (const required of ["penetration test", "pentest", "compliance certification", "security guarantee", "is secure"]) {
      expect(RELEASE_RESCUE_OFFER.prohibitedClaims, required).toContain(required);
    }
  });

  it("is lowercase, so the case-insensitive match cannot miss an entry", () => {
    for (const claim of RELEASE_RESCUE_OFFER.prohibitedClaims) {
      expect(claim, claim).toBe(claim.toLowerCase());
    }
  });
});
