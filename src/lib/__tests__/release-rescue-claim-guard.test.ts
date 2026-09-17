import ts from "typescript";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NEGATION_SCOPE_REGRESSIONS } from "./release-rescue-claim-guard-residuals";
import { RELEASE_RESCUE_OFFER, findProhibitedClaims } from "@/lib/release-rescue-intake";
import {
  assetIsItsOwnText,
  collectedByTheRunner,
  parseSurface,
  staticSpecifiersIn,
  UNREADABLE_SPECIFIERS,
  reachableFrom,
  routeRoots,
  FRAMEWORK_ENTRYPOINT_NAMES,
  frameworkEntrypoints,
  tsconfigAliases,
  assetReadings,
  assetResiduals,
  EXPECTED_ASSET_RESIDUALS,
  DECLARED_CLAIM_BEARING_FILES,
  ENTRY_RESIDUALS,
  allAssets,
  IMPORTED_ASSETS,
  scannableAssets,
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
  // Audit 41. The scope-list rule rejected all five: ordinary denials whose
  // shape the lists did not describe. They are the reason the rule is now
  // positive — a denial is recognised by a shape this offer writes, not by the
  // absence of a disqualifier.
  "We describe a review rather than a penetration test.",
  "We provide a review instead of a penetration test.",
  "This is a review other than a penetration test.",
  "We do not claim while reviewing that your application is secure.",
  "We never promise before delivery that your application is secure.",
  // The two shapes the contrast head has to tolerate between itself and the
  // thing it points away from: nothing, and function words only.
  "This is a review, not a penetration test.",
  "We sell a review rather than the penetration test you may be looking for.",
];

/**
 * The initialiser of a MODULE-LEVEL constant in the discovery module, by name.
 *
 * Scoped deliberately. The first version walked the whole tree and kept the LAST
 * match, so a decoy — `function unused() { const ROUTE_ROOTS = routeRoots(); }` —
 * satisfied the assertion while the module-level constant held the literal
 * predecessor. An audit broke two mechanisms that way, with both suites green
 * and the mutation proof printing that all fifteen were held. An assertion about
 * a module-level constant has to be about that declaration and no other, and
 * there has to be exactly one of it.
 */
function moduleLevelInitialiser(name: string): string | null {
  const source = readSurface("src/lib/__tests__/release-rescue-surface-files.ts");
  const parsed = parseSurface("release-rescue-surface-files.ts", source);
  const found: string[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        found.push(declaration.initializer.getText(parsed));
      }
    }
  }
  expect(found.length, `${name} must be declared exactly once at module level`).toBe(1);
  return found[0] ?? null;
}

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

  it("reads an n't contraction typeset with a curly apostrophe", () => {
    // The tokenizer treats an ASCII apostrophe as a word character and a
    // typographic one as a separator, so `isn\u2019t` arrived as `isn` and `t`,
    // the negation vanished, and the guard flagged the offer's own disclaimer.
    for (const text of [
      "This isn\u2019t a penetration test.",
      "We can\u2019t guarantee your application is secure.",
      "This doesn\u2019t guarantee the absence of vulnerabilities.",
      "We haven\u2019t promised your application is secure.",
    ]) {
      expect(findProhibitedClaims(text, "offer_copy"), text).toEqual([]);
    }

    // Repaired in the licensing scan alone, and closed. Normalising the
    // apostrophe in the TOKENIZER would have REMOVED a detection: this is
    // caught precisely because the separator splits it.
    expect(
      findProhibitedClaims("Your application is\u2019secure.", "offer_copy"),
      "a curly apostrophe inside a claim is still a separator",
    ).not.toEqual([]);

    // And a pair that is not a contraction rejoins to nothing this file
    // declares, so it licenses nothing.
    expect(
      findProhibitedClaims("We sell an t penetration test.", "offer_copy"),
      "`an` + `t` spells `an't`, which is not a declared negation",
    ).not.toEqual([]);
  });

  it("publishes the regression and denial counts the arrays actually hold", () => {
    // Every count in this area has been published wrong at least once, twice in
    // the same commit that corrected a different one. A figure nothing reads is
    // a figure nothing can keep true.
    const doc = readSurface("docs/AI-APP-RELEASE-RESCUE-V1.md");
    for (const [label, pattern, actual] of [
      ["regression payloads", /\*\*(\d+) regression payloads caught/g, NEGATION_SCOPE_REGRESSIONS.length],
      ["declared denials", /(\d+) declared denials licensed\*\*/g, REQUIRED_DENIALS.length],
    ] as const) {
      const every = [...doc.matchAll(pattern)];
      expect(every.length, `the ${label} figure must appear exactly once in the doc`).toBe(1);
      expect(Number(every[0]![1]), `the doc's ${label} count must be the array's length`).toBe(actual);
    }
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
    // One, not two. `computed_name` is gone because nothing reads a name any
    // more: every file under a route root is an entry, so a file that assembles
    // the offer's name at runtime is no longer invisible to anything.
    // Two. `computed_name` went when nothing read a name any more, but the class
    // that deletion left behind — a file the framework loads from the project
    // root under a name Next does not declare — was not written down until an
    // audit named it.
    expect(ENTRY_RESIDUALS.length).toBe(2);
    expect([...new Set(ENTRY_RESIDUALS.map((entry) => entry.mechanism))].sort()).toEqual([
      "computed_import",
      "framework_root_file",
    ]);
    for (const entry of ENTRY_RESIDUALS) {
      expect(entry.why.length, `${entry.mechanism} needs a reason, not an entry`).toBeGreaterThan(80);

      // And the bound is RUN, the way the extractor's residuals are. A commit
      // claimed these were "asserted the way EXTRACTOR_RESIDUALS is" when the
      // suite only counted them and measured the length of their prose — a
      // record that nothing executes, in the record added to stop exactly that.
      // Both are executed the same way: the residual form must yield no
      // specifier the walk can follow, and the static form must yield one, or
      // the record proves nothing.
      expect(
        staticSpecifiersIn(entry.source),
        `${entry.mechanism}: the residual form must actually be unreachable by the walk`,
      ).toEqual([]);
      expect(
        staticSpecifiersIn(entry.seenWhenStatic),
        `${entry.mechanism}: and the reachable form must be reachable, or the residual proves nothing`,
      ).not.toEqual([]);

      // The framework-root residual needs more than "this source imports
      // nothing" — any import-free file satisfies that, so the assertion did not
      // demonstrate the stated mechanism at all. What it claims is that a file
      // the framework loads from the project root under an UNDECLARED name is
      // invisible to the entry walk, so that is what is run: the file is put on
      // disk in a scratch tree and the entrypoint derivation is asked for it.
      if (entry.mechanism === "framework_root_file") {
        const scratch = mkdtempSync(join(tmpdir(), "release-rescue-root-"));
        try {
          mkdirSync(join(scratch, "src"), { recursive: true });
          writeFileSync(join(scratch, "mdx-components.tsx"), entry.source);
          writeFileSync(join(scratch, "src", "proxy.ts"), "export default function proxy() {}\n");
          const found = frameworkEntrypoints(scratch);
          expect(found, "the derivation must still find a declared entrypoint beside it").toContain("src/proxy.ts");
          expect(
            found.some((file) => file.includes("mdx-components")),
            "if the derivation now finds this, the residual is closed and must be removed",
          ).toBe(false);
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
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
      // A CSS escape inside an inline `<style>`. CSS escapes were read on the
      // ASSET path only, so the identical bytes were caught in a `.css` file and
      // invisible here — the asymmetry the same commit claimed to have closed
      // for entities. And the template literal's COOKED value destroys the
      // evidence (`\0` cooks to a NUL), so the RAW source text is what has to be
      // read: that is what Next copies into the stylesheet and what a browser's
      // CSS parser sees. An audit confirmed the rendered `::after` content in a
      // real Chromium.
      "a CSS escape inside an inline style": [
        "page.tsx",
        "const S = () => <style>{`#x::after { content: \"penetration\\000020test\"; }`}</style>;",
      ],
      // An em space. `decodeEntities` carried ELEVEN named entities out of
      // HTML5's ~2,200 — a hand-written list, in the module whose premise is
      // that hand-written lists fail. A browser renders this as whitespace
      // between the two claim tokens; the guard saw one word.
      "a claim split by a named entity the list did not carry": `<p>Your application is&emsp;secure and ready to ship.</p>`,
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
    expect(allAssets().length, "no asset was enumerated at all").toBeGreaterThan(0);
    expect(
      [...scannableAssets(), ...assetResiduals().map((residual) => residual.file)].sort(),
      "every asset is either read or recorded as unreadable",
    ).toEqual(allAssets());

    // Served from disk AND reached by import. A stylesheet outside a route root
    // was in neither set: `resolveImport` returned null for it under a comment
    // saying a stylesheet is "not text we read", while `src/app/globals.css` was
    // scanned because it happened to sit under a route root. An audit put a
    // claim in a `.css` under `src/components`, imported it from the site
    // chrome, and served it on every marketing route with the suite green.
    for (const file of scannableAssets()) {
      expect(findProhibitedClaims(readServedAsset(file), "typed_field"), `${file} serves a prohibited claim`).toEqual([]);
    }

    // The unreadable ones are an EXACT set, like the other three residual
    // records. This asserted only that each entry's prose was long enough, so an
    // asset could join the exemption and nothing failed — which made a one-byte
    // classification error free rather than loud. An audit exempted an HTML page
    // with one NUL in a comment, and a UTF-16 SVG with no hostile byte at all,
    // and served prohibited claims from both at HTTP 200 with the suite green.
    expect(
      assetResiduals().map((residual) => residual.file).sort(),
      "an asset joined or left the exemption; look at it rather than re-pinning",
    ).toEqual([...EXPECTED_ASSET_RESIDUALS].sort());

    for (const residual of assetResiduals()) {
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

    const initialiserOf = (name: string): string | null => moduleLevelInitialiser(name);

    // And no shadowing declaration of these names anywhere else in the file,
    // which is what the decoy relied on.
    const shadows: string[] = [];
    const findShadows = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        ["ALIASES", "ROUTE_ROOTS", "COLLECTED_BY_THE_RUNNER", "FRAMEWORK_ENTRYPOINT_NAMES", "EXPECTED_ASSET_RESIDUALS"].includes(
          node.name.text,
        ) &&
        node.parent.parent.parent !== parsed
      ) {
        shadows.push(node.name.text);
      }
      ts.forEachChild(node, findShadows);
    };
    findShadows(parsed);
    expect(shadows, "a nested declaration shadows a checked constant; that is how a decoy defeats this test").toEqual([]);

    expect(initialiserOf("ALIASES"), "ALIASES must be read from tsconfig, not restated").toBe("tsconfigAliases()");
    expect(initialiserOf("ROUTE_ROOTS"), "ROUTE_ROOTS must be probed, not named").toBe("routeRoots()");
    expect(initialiserOf("COLLECTED_BY_THE_RUNNER"), "the runner's globs must be read from its config").toBe(
      "vitestIncludeGlobs()",
    );

    // The opposite direction, for the one constant that must NOT be derived.
    // `EXPECTED_ASSET_RESIDUALS` is a pin: the whole point is that it disagrees
    // with the computed set when an asset joins or leaves the exemption. Written
    // as `ASSET_RESIDUALS.map(...)` it would agree with anything, which is how a
    // mutant doing exactly that survived.
    const assetPin = initialiserOf("EXPECTED_ASSET_RESIDUALS");
    expect(assetPin, "the asset-residual pin must be a literal, not computed from what it checks").toMatch(
      /^\[\s*(?:"[^"]*"\s*,?\s*)*\]$/,
    );
    // Parsed, not grepped. A bare `includes` is satisfied by the same text
    // inside a COMMENT, which an audit used to defeat this one.
    const callsInEntrypointList: string[] = [];
    const findCalls = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "listRouteEntrypoints") {
        const inner = (child: ts.Node): void => {
          if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
            callsInEntrypointList.push(child.expression.text);
          }
          ts.forEachChild(child, inner);
        };
        ts.forEachChild(node, inner);
      }
      ts.forEachChild(node, findCalls);
    };
    findCalls(parsed);
    expect(callsInEntrypointList, "the entry set must come from the derived entrypoints").toContain(
      "frameworkEntrypoints",
    );
    expect(callsInEntrypointList, "and from the derived route roots").toContain("filesUnder");
  });

  it("serves assets from every directory the framework serves them from", () => {
    // The served set is the union of `public/` and the route roots' non-source
    // files. Dropping either source left every assertion about the set still
    // true — the union still held, the length was still non-zero — so the
    // mutation proof reported both sources UNHELD. Each source is now required
    // to contribute, which is a true statement about this repository: five SVGs
    // under `public/`, and `favicon.ico` and `globals.css` under `src/app`.
    const assets = allAssets();
    const fromPublic = assets.filter((file) => file.startsWith("public/"));
    const fromRouteRoots = assets.filter((file) => routeRoots().some((root) => file.startsWith(`${root}/`)));
    expect(fromPublic.length, "public/ must contribute").toBeGreaterThan(0);
    expect(
      fromRouteRoots.length,
      "the route roots' non-source files are served at the site root and must contribute too",
    ).toBeGreaterThan(0);

    // And the third source: assets reached BY IMPORT, wherever they live. A
    // stylesheet under `src/components` produces the same served bytes as one
    // under `src/app`, and used to be in no set at all.
    expect(IMPORTED_ASSETS.length, "imported assets must contribute").toBeGreaterThan(0);
    expect(
      [...new Set([...fromPublic, ...fromRouteRoots, ...IMPORTED_ASSETS])].sort(),
      "the asset set is exactly those three sources",
    ).toEqual(assets);
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
    // The names come from NEXT, not from this repository. An audit deleted
    // `"instrumentation"` from what used to be a four-string literal and both
    // suites stayed green. The first repair derived the test fixture from that
    // literal, which shrinks with it — self-consistent and vacuous about the one
    // thing in question, which is this project's signature failure rebuilt
    // inside the fix for an instance of it. There is no list to shorten now.
    expect(
      [...FRAMEWORK_ENTRYPOINT_NAMES].sort(),
      "the framework's entrypoint filenames changed; check what Next added or renamed",
    ).toEqual(["instrumentation", "instrumentation-client", "middleware", "proxy"]);

    // And they are read rather than restated, asserted from this module's source
    // for the same reason the alias and route-root wirings are: on this
    // repository a derivation and its current output agree, so only the source
    // can tell them apart.
    expect(
      moduleLevelInitialiser("FRAMEWORK_ENTRYPOINT_NAMES"),
      "the entrypoint names must be read from the framework",
    ).toBe("frameworkEntrypointNames()");

    // The fixture below is one file per name, alternating locations and cycling
    // extensions, which proves the RESOLVER covers both locations and every
    // servable extension. It does not prove the set is complete; the assertion
    // above does that, against the framework.
    const scratch = mkdtempSync(join(tmpdir(), "release-rescue-entry-"));
    try {
      mkdirSync(join(scratch, "src"), { recursive: true });
      const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
      const expected = FRAMEWORK_ENTRYPOINT_NAMES.map((name, index) => {
        const directory = index % 2 === 0 ? "src" : ".";
        const extension = extensions[index % extensions.length];
        const relativePath = directory === "." ? `${name}${extension}` : `${directory}/${name}${extension}`;
        writeFileSync(join(scratch, relativePath), "export default function entry() {}\n");
        return relativePath;
      });
      writeFileSync(join(scratch, "src", "not-an-entrypoint.ts"), "export const x = 1;\n");

      expect(
        frameworkEntrypoints(scratch).sort(),
        "every NAME in the list, in either location and any servable extension",
      ).toEqual([...expected].sort());
      expect(expected.length, "the entrypoint list must not be empty").toBeGreaterThan(0);
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

  // The "counts every file Next renders around a page" test is gone with the
  // rule it guarded. `RENDERED_AROUND_A_PAGE` existed so that a layout or an
  // error boundary joined the entry set beside the offer's own directory. Every
  // file under a route root is an entry now, so the pattern had no job left, and
  // a constant plus a test for a rule the module no longer applies is precisely
  // the "record that nothing executes" defect this file catalogues.

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

  it("does not let an unrelated denial license an affirmative claim", () => {
    // These were recorded as a residual the previous round, with an argument
    // that no rule in code could close them. The argument rested on a distance
    // that was measured wrong — all three payloads and both cited denials put
    // their negation four tokens before the claim, not three and four — and an
    // audit refuted the conclusion by writing the rule.
    //
    // What separates them is scope, not distance: a negation-shaped intensifier
    // denies nothing, and a subordinating conjunction starts a predicate the
    // negation does not reach into.
    expect(NEGATION_SCOPE_REGRESSIONS.length, "the regression corpus must not be empty").toBeGreaterThan(0);
    for (const sentence of NEGATION_SCOPE_REGRESSIONS) {
      expect(
        findProhibitedClaims(sentence, "offer_copy"),
        `${sentence} is an affirmative claim and must not be licensed by the denial in front of it`,
      ).not.toEqual([]);
    }

    // And every denial the offer publishes stays licensed. This is the whole
    // constraint: a rule that caught the payloads by rejecting these would have
    // been a worse guard, not a better one.
    for (const denial of REQUIRED_DENIALS) {
      expect(findProhibitedClaims(denial, "offer_copy"), `${denial} is a denial and must stay licensed`).toEqual([]);
    }
  });

  it("reads a served asset the way a browser renders it, entities and CSS escapes included", () => {
    // The JSX path has decoded entities since an audit planted a claim behind
    // them, and two planted shapes pin it. The ASSET path decoded nothing, so
    // `penetration&#32;test` was invisible on a served SVG while the identical
    // shape in JSX was caught — the same "checked in one place, invisible in
    // another" asymmetry as the stylesheet, one layer over. Five prohibited
    // claims were served at HTTP 200 from the offer's own landing page.
    const shapes: Record<string, string> = {
      "numeric entity": "<svg><text>We deliver a penetration&#32;test.</text></svg>",
      "hex entity": "<svg><text>We deliver a penetration&#x20;test.</text></svg>",
      "nbsp entity": "<svg><text>We deliver a penetration&nbsp;test.</text></svg>",
      "entity inside a claim": "<svg><text>Your application is&#32;secure.</text></svg>",
      "css escape": '.badge::after { content: "penetration\\000020test"; }',
      "css escape with space": '.badge::after { content: "penetration\\20 test"; }',
    };
    for (const [shape, source] of Object.entries(shapes)) {
      const readings = assetReadings(Buffer.from(source, "utf8"));
      expect(
        readings.flatMap((reading) => findProhibitedClaims(reading, "typed_field")),
        `a claim written as ${shape} must be read`,
      ).not.toEqual([]);
    }

    // And an asset that says nothing prohibited stays clean, so the above is a
    // detection rather than everything matching everything.
    expect(
      assetReadings(Buffer.from("<svg><title>Delegation Cloud</title></svg>", "utf8")).flatMap((reading) =>
        findProhibitedClaims(reading, "typed_field"),
      ),
      "an ordinary asset must not be flagged",
    ).toEqual([]);
  });

  it("reads every import specifier with the parser, and records the ones it cannot", () => {
    // This was the one place in the module still using a regular expression,
    // seven rounds after a regex extractor was replaced by the parser for
    // exactly this reason. `import\s*\(\s*["']` requires the quote to follow
    // the parenthesis, so the idiomatic webpackChunkName comment form matched
    // nothing, `resolveImport` was never called, `UNRESOLVED_IMPORTS` stayed
    // empty, and an audit pulled a component in that way and served three
    // claims from the offer's landing page.
    const forms: Record<string, string> = {
      "static import": 'import { X } from "./panel";',
      "type-only import": 'import type { X } from "./panel";',
      "export from": 'export { X } from "./panel";',
      "export star": 'export * from "./panel";',
      "side-effect import": 'import "./panel";',
      "dynamic import": 'const m = import("./panel");',
      "dynamic with a leading comment": 'const m = import(/* webpackChunkName: "p" */ "./panel");',
      "dynamic with a plain template": "const m = import(`./panel`);",
      "require": 'const m = require("./panel");',
      "require.resolve": 'const p = require.resolve("./panel");',
    };
    for (const [form, source] of Object.entries(forms)) {
      expect(staticSpecifiersIn(source), `${form} must yield its specifier`).toContain("./panel");
    }

    // A local helper that happens to be NAMED `require` is not a module load.
    // Matching by name recorded fifteen boolean conditions from
    // `skill-qualification.ts` as unreadable specifiers; CommonJS require takes
    // exactly one argument, and that is what distinguishes them.
    expect(
      staticSpecifiersIn('const require = (c: boolean, code: string) => c; require(a >= b, "code");'),
      "a two-argument local helper named require is not an import",
    ).toEqual([]);

    // Forms the PREDECESSOR REGEX caught and the first parser version dropped.
    // The repository's rule is to diff the SETS when a mechanism is replaced;
    // that diff was not run, and an audit ran it over all 318 source files and
    // found these four. `import("y").X` is erased at runtime, but following
    // `import type … from "y"` while dropping it is an inconsistency rather
    // than a decision; the other three are real runtime loads.
    for (const [form, source] of Object.entries({
      "import type node": 'type T = import("./panel").X;',
      "import = require": 'import panel = require("./panel");',
      "module.require": 'const m = module.require("./panel");',
      "require.main.require": 'const m = require.main.require("./panel");',
    })) {
      expect(staticSpecifiersIn(source, "m.ts"), `${form} must yield its specifier`).toContain("./panel");
    }

    // The ARITY check covered the two-argument case above and nothing else. A
    // one-argument member call named `require` was still matched by name, one
    // syntax form over: `policy.require("./x")` fed a non-import string to the
    // resolver and `policy.require(flag)` put a boolean identifier back into the
    // record audit 39 had just cleaned of fifteen of them. What distinguishes a
    // CommonJS require is the ROOT of the callee chain, not its tail.
    const pollutedBefore = UNREADABLE_SPECIFIERS.length;
    for (const [form, source] of Object.entries({
      "one-argument member, literal": 'const x = policy.require("./missing-config");',
      "one-argument member, identifier": "const x = policy.require(flag);",
      "deep member": 'const x = a.b.c.require("./deep");',
      "two-argument member": 'const x = policy.require(a, "code");',
    })) {
      expect(staticSpecifiersIn(source, "m.ts"), `${form} is not a module load`).toEqual([]);
    }
    expect(
      UNREADABLE_SPECIFIERS.slice(pollutedBefore),
      "and none of them may be recorded as an unreadable specifier either",
    ).toEqual([]);

    // The genuine residual: a specifier the compiler cannot read either.
    expect(staticSpecifiersIn("const n = 'p'; const m = import(`./${n}`);")).toEqual([]);

    // And that residual is RECORDED — deduped, and read by this assertion. It
    // was written to by the module and read by nothing, while three places said
    // it "records anything it cannot place".
    expect(UNREADABLE_SPECIFIERS, "the unreadable record must not be empty after that call").toContain("`./${n}`");
    const before = UNREADABLE_SPECIFIERS.length;
    staticSpecifiersIn("const n = 'p'; const m = import(`./${n}`);");
    expect(UNREADABLE_SPECIFIERS.length, "the same specifier twice must be recorded once").toBe(before);
  });

  it("parses each module in its own dialect when walking the import graph", () => {
    // `reachableFrom` called `staticSpecifiersIn(source)` with no file, so every
    // module in the graph was parsed as TSX. A legacy `<string>x` assertion or a
    // `<T>(x) => x` generic arrow — valid `.ts` that `tsc` and `next build`
    // accept — made the parse fail and silently dropped every import after it.
    // Both guards built for this were blind: `parseProblems` uses the correct
    // dialect and reported clean, and `resolveImport` was never called so
    // `UNRESOLVED_IMPORTS` stayed empty.
    const legacy = 'const a = <string>x; import { B } from "./b"; import { C } from "./c";';
    expect(staticSpecifiersIn(legacy, "m.ts"), "a .ts file must be parsed as TypeScript").toEqual(["./b", "./c"]);

    // And the walk passes the file. On this repository the derived answer and
    // the default agree, so only the source shows the wiring.
    const callsWithFile: string[] = [];
    const parsed = parseSurface(
      "release-rescue-surface-files.ts",
      readSurface("src/lib/__tests__/release-rescue-surface-files.ts"),
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "staticSpecifiersIn"
      ) {
        callsWithFile.push(node.arguments.map((argument) => argument.getText(parsed)).join(", "));
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(callsWithFile, "the graph walk must pass the file so the dialect follows it").toContain("source, file");
  });

  it("decodes a printable escape in the raw reading and leaves a destructive one alone", () => {
    // The raw reading exists for what COOKING DESTROYS: `\0` cooks to a NUL, so
    // the backslash a CSS decoder looks for is gone from `node.text`. It does
    // not exist for escapes that cook to a printable character, where the cooked
    // value already carries it — and spelling those out gave a reading nobody
    // renders, which flagged the offer's own disclaimer.
    const curly = String.raw`const s = "This isn’t a penetration test.";`;
    expect(visibleStrings(curly, "p.tsx"), "one reading, with the apostrophe decoded").toEqual([
      "This isn\u2019t a penetration test.",
    ]);

    // The escape still cannot hide a claim: cooking decodes it identically.
    expect(
      visibleStrings(String.raw`const s = "We deliver a penetration test.";`, "p.tsx").flatMap((text) =>
        findProhibitedClaims(text, "typed_field"),
      ),
    ).not.toEqual([]);

    // And the destructive escape keeps its second reading, which is the whole
    // reason the raw text is read at all.
    const cssEscape = "const S = () => <style>{`#x::after { content: \"penetration\\000020test\"; }`}</style>;";
    expect(
      visibleStrings(cssEscape, "page.tsx").some((text) => text.includes("\\000020")),
      "the raw reading must still carry the backslash run the CSS decoder needs",
    ).toBe(true);
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
    // `aria-label`s all enter the same token stream. An audit served a badge
    // reading "This is not a penetration test" beside "We deliver a penetration
    // test" at HTTP 200 with the suite green. An asset cannot carry a scoped
    // disclaimer, so it does not get to benefit from one.
    //
    // That SPLIT payload is now caught under both sources, because the licensing
    // rule went positive: a denial has to sit adjacent to the claim or deny one
    // of the offer's own verbs, and `</desc><text x 10 y 30 We deliver` is
    // neither. Asserting it stays disarmed under offer_copy would be asserting a
    // weakness the guard no longer has, so the pair below is the distinction
    // that survives: an ADJACENT disclaimer is still licensed as offer copy and
    // still caught in an asset.
    const split = `<svg xmlns="http://www.w3.org/2000/svg"><desc>This is not a penetration test</desc><text x="10" y="30">We deliver a penetration test</text></svg>`;
    for (const source of ["typed_field", "offer_copy"] as const) {
      expect(
        findProhibitedClaims(split, source),
        `a disclaimer elsewhere in an asset must not license the claim (${source})`,
      ).not.toEqual([]);
    }

    const adjacent = `<svg><desc>This review is not a penetration test</desc></svg>`;
    expect(
      findProhibitedClaims(adjacent, "offer_copy"),
      "an adjacent denial is licensed when a person wrote it as prose",
    ).toEqual([]);
    expect(
      findProhibitedClaims(adjacent, "typed_field"),
      "the same bytes in an asset are read as a typed field, where nothing licenses them",
    ).not.toEqual([]);

    // And the classification in both directions, decided by BYTES rather than by
    // a name. `assetResiduals()` holds one entry today — `src/app/favicon.ico` —
    // so its loop does run; these files make the DECISION run in both
    // directions, which one entry cannot. (This comment said the set was empty
    // and its loop asserted nothing, which stopped being true when the app
    // directory joined the asset scan, and named a constant that does not
    // exist.)
    const scratch = mkdtempSync(join(tmpdir(), "release-rescue-asset-"));
    try {
      const text = join(scratch, "notice.js");
      writeFileSync(text, 'export const NOTE = "we deliver a penetration test";\n');
      expect(assetIsItsOwnText(text), "a .js asset is text and must be read").toBe(true);

      const binary = join(scratch, "badge.png");
      writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
      expect(assetIsItsOwnText(binary), "a PNG is not readable as text").toBe(false);

      // UTF-16, which is what an ordinary Windows editor writes when told
      // "Unicode". Every other character is a NUL, and the predecessor called
      // any file containing one binary — so this was exempted from the scan and
      // served at HTTP 200 with two prohibited claims in it. No hostile byte is
      // involved; this is a file someone saves by accident.
      const utf16 = join(scratch, "trust-badge.svg");
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>We deliver a penetration test.</text></svg>';
      writeFileSync(utf16, Buffer.from(`\ufeff${svg}`, "utf16le"));
      expect(assetIsItsOwnText(utf16), "UTF-16 is text, and is full of NULs").toBe(true);
      expect(
        findProhibitedClaims(readServedAsset(utf16), "typed_field"),
        "and reading it must decode it, or classifying it correctly changes nothing",
      ).not.toEqual([]);

      // With NO mark, UTF-16 is NOT text as far as a browser is concerned: the
      // HTML standard detects UTF-16 only from a byte-order mark and XML
      // requires one, so such a file renders as mojibake and conveys no words.
      // The previous round asserted the opposite here, on my own initiative
      // rather than from any finding, and the sniffing that satisfied it is what
      // let a Windows-1252 asset be read as printable CJK and its claim vanish.
      // It belongs in the exemption, where the pinned set makes it loud.
      const utf16NoMark = join(scratch, "badge-no-bom.svg");
      writeFileSync(utf16NoMark, Buffer.from(svg, "utf16le"));
      expect(assetIsItsOwnText(utf16NoMark), "UTF-16 without a mark is not a reading any browser gives").toBe(false);

      // A legacy single-byte asset, which IS one a browser reads. Accented prose
      // pushes the UTF-8 reading past the noise threshold; sniffing UTF-16 then
      // produced printable CJK, the file was classified as text, and the claim
      // inside it was served at HTTP 200 and read by nothing.
      const legacy = join(scratch, "legacy.svg");
      writeFileSync(
        legacy,
        Buffer.from(
          '<?xml version="1.0" encoding="windows-1252"?><svg><title>S\u00e9curit\u00e9 \u2014 \u00e9valuation pr\u00e9alable, ma\u00eetris\u00e9e</title>' +
            "<desc>R\u00e9vision compl\u00e8te \u2014 pr\u00e9par\u00e9e \u00e0 l\u2019avance, d\u00e9taill\u00e9e, v\u00e9rifi\u00e9e</desc>" +
            "<text>We deliver a penetration test.</text></svg>",
          "latin1",
        ),
      );
      expect(assetIsItsOwnText(legacy), "a windows-1252 asset is text a browser reads").toBe(true);
      expect(
        findProhibitedClaims(readServedAsset(legacy), "typed_field"),
        "and the claim inside it must be read",
      ).not.toEqual([]);

      // One NUL inside an HTML comment, which leaves the rendered text intact.
      const sneaky = join(scratch, "claims.html");
      writeFileSync(sneaky, Buffer.from(`<p>We deliver a penetration test.</p><!-- \u0000 -->`, "utf8"));
      expect(assetIsItsOwnText(sneaky), "one stray NUL does not make a document unreadable").toBe(true);
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
