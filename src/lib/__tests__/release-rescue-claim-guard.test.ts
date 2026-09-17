import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_RESCUE_OFFER, findProhibitedClaims } from "@/lib/release-rescue-intake";
import {
  DECLARED_CLAIM_BEARING_FILES,
  EXTRACTOR_RESIDUALS,
  parseProblems,
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

      for (const text of visibleStrings(source)) {
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
      if (!rendersMarkup(source)) continue;
      expect(visibleStrings(source).length, file).toBeGreaterThan(0);
    }

    // And across the set, a floor — which IS the right shape here, by the same
    // test the rest of this suite applies: a floor belongs where the quantity is
    // genuinely unbounded above. Copy grows; an exact count would go red on every
    // wording change while proving nothing. What it catches is the failure it is
    // for: an extractor that silently returns nothing.
    const total = SURFACE_FILES.reduce((sum, file) => sum + visibleStrings(readSurface(file)).length, 0);

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

    expect(EXTRACTOR_RESIDUALS.length).toBe(5);
    expect([...new Set(EXTRACTOR_RESIDUALS.map((r) => r.mechanism))].sort()).toEqual([
      "computed",
      "cross_component",
      "identifier",
    ]);
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
      visibleStrings(readSurface(file)).some((text) => findProhibitedClaims(text).length > 0),
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
      for (const text of visibleStrings(readSurface(file)).filter((candidate) => findProhibitedClaims(candidate).length > 0)) {
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
    const planted = {
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
    };

    // The published figure, bound to the thing it counts. A commit wrote
    // "eighteen shapes" into the architecture doc while this map held 17 — in
    // the same diff that corrected a different number for not reproducing. A
    // figure nothing reads is a figure nothing can keep true.
    const doc = readSurface("docs/AI-APP-RELEASE-RESCUE-V1.md");
    const published = /\*\*(\d+) planted\s+shapes\*\*/.exec(doc);

    expect(published, "the planted-shape figure could not be located in the doc").not.toBeNull();
    expect(Number(published![1]), "the doc's planted-shape count must be this map's size").toBe(
      Object.keys(planted).length,
    );

    for (const [shape, source] of Object.entries(planted)) {
      expect(
        visibleStrings(source).flatMap((text) => findProhibitedClaims(text)),
        `a planted claim in a ${shape} must be read by the extractor`,
      ).not.toEqual([]);
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
