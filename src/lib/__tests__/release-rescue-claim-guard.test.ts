import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_RESCUE_OFFER, findProhibitedClaims } from "@/lib/release-rescue-intake";

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
const SURFACE_FILES = [
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/intake/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/report/page.tsx",
  "src/components/ai-app-release-rescue/intake-form.tsx",
  "src/components/ai-app-release-rescue/report-view.tsx",
  "src/components/ai-app-release-rescue/non-claims.tsx",
  "src/components/ai-app-release-rescue/offer-pricing.tsx",
  "src/components/ai-app-release-rescue/rubric-checklist.tsx",
  "src/lib/ai-app-release-rescue/constants.ts",
  "src/lib/ai-app-release-rescue/payment.ts",
];

/** Text inside quotes and JSX text nodes — what a customer actually reads. */
function visibleStrings(source: string): string[] {
  const quoted = [...source.matchAll(/"([^"\n]{12,})"|'([^'\n]{12,})'|`([^`]{12,})`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
  const jsxText = [...source.matchAll(/>\s*([A-Z][^<>{}\n]{12,})\s*</g)].map((match) => match[1]);
  return [...quoted, ...jsxText];
}

describe("the marketing surface makes no prohibited claim", () => {
  for (const file of SURFACE_FILES) {
    it(file, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
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
    for (const file of SURFACE_FILES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(visibleStrings(source).length, file).toBeGreaterThan(0);
    }
  });

  it("would catch a planted claim", () => {
    // Proves the extractor reaches the kind of text these files contain.
    const planted = `export const COPY = "We deliver a penetration test of your application.";`;

    expect(visibleStrings(planted).flatMap(findProhibitedClaims)).toContain("penetration test");
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
