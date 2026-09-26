import { describe, expect, it } from "vitest";
import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { containsLikelySecret, keyLooksSecret, redactSecrets } from "@/lib/release-rescue-redaction";

// Property-shaped cases, written after a second independent audit made one
// criticism and was right about it:
//
//   "Every fix closes the literal statement the previous audit executed, and the
//    property it was an example of remains open."
//
// Both earlier rounds fixed examples. The redaction detector was patched to
// handle a keyword PREFIX and immediately leaked on a suffix; the claim guard was
// patched for one phrasing and leaked on the plural. So these tests do not assert
// on the strings an audit happened to use. They generate the space the attacker
// picks from — every affix position, every inflection, every separator — and
// assert over all of it.
//
// A fix that closes only the next example will fail here.

const SECRET_WORDS = ["PASSWORD", "SECRET", "TOKEN", "APIKEY", "PASSPHRASE", "CREDENTIALS"];
const AFFIXES = ["", "DB_", "PROD_", "AWS_", "NEXT_PUBLIC_", "APP_V2_"];
const SUFFIXES = ["", "_PROD", "_LIVE", "_V2", "_2024", "_ACCESS_KEY"];

describe("a key name is credential-shaped wherever the secret word sits", () => {
  it("redacts the value for every prefix x suffix combination", () => {
    const leaked: string[] = [];

    for (const word of SECRET_WORDS) {
      for (const prefix of AFFIXES) {
        for (const suffix of SUFFIXES) {
          const key = `${prefix}${word}${suffix}`;
          const line = `${key}=s3cr3t-value-goes-here`;
          const result = redactSecrets(line);
          if (!result.hadSecrets || result.redacted.includes("s3cr3t-value-goes-here")) {
            leaked.push(key);
          }
        }
      }
    }

    expect(leaked, `${leaked.length} key shapes leaked their value`).toEqual([]);
  });

  it("does not care about separator style or casing", () => {
    // The same name written six ways is the same name.
    for (const key of [
      "DB_PASSWORD_PROD",
      "db_password_prod",
      "dbPasswordProd",
      "DbPasswordProd",
      "db-password-prod",
      "db.password.prod",
    ]) {
      expect(keyLooksSecret(key), key).toBe(true);
      expect(containsLikelySecret(`${key} = "s3cr3t-value-goes-here"`), key).toBe(true);
    }
  });

  it("still reads an ordinary name as ordinary, whatever it contains", () => {
    // Over-redaction is not free: `scanForSecrets` hard-fails a report, so a
    // substring match here would block delivery over "authorName". The unit is a
    // SEGMENT, which is what keeps "bypass" out of "pass" and "tokenizer" out of
    // "token".
    for (const key of [
      "authorName",
      "bypass",
      "tokenizer",
      "cacheKey",
      "sortKey",
      "monkeys",
      "passengerName",
      "keyboardLayout",
    ]) {
      expect(keyLooksSecret(key), key).toBe(false);
    }
  });

  it("redacts in linear time on adversarial input", () => {
    // The previous detector's unbounded `[A-Za-z0-9_]*` prefix backtracked
    // quadratically: 40KB of identifier characters took over four seconds, which
    // is a denial of service reachable from any reviewed file. Every quantifier
    // in the detector is bounded now.
    const adversarial = `${"A".repeat(40_000)}_PASSWORD`;
    const started = Date.now();
    redactSecrets(adversarial);

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("a prohibited claim is prohibited in every form of the words", () => {
  const CLAIM_FORMS = [
    "penetration test",
    "penetration tests",
    "penetration testing",
    "penetration-test",
    "penetration-testing",
    "compliance certification",
    "compliance certifications",
    "compliance-certification",
    "pen test",
    "pen tests",
    "pentest",
    "pentests",
    "security guarantee",
    "security guarantees",
  ];

  it("catches every inflection and hyphenation in an affirmative sentence", () => {
    const missed = CLAIM_FORMS.filter(
      (form) => findProhibitedClaims(`We deliver a ${form} with every review.`).length === 0,
    );

    expect(missed, `${missed.length} claim forms were not caught`).toEqual([]);
  });

  it("still permits every one of them inside a denial", () => {
    const wrong = CLAIM_FORMS.filter(
      (form) => findProhibitedClaims(`This review is not a ${form}.`).length > 0,
    );

    expect(wrong, `${wrong.length} denials were wrongly flagged`).toEqual([]);
  });
});

describe("a referral licenses the items it refers away, and nothing else", () => {
  it("does not let a referral clause license a claim in another clause", () => {
    // The previous version scoped referral to the SENTENCE, so any sentence
    // containing "if you need" or "outside the scope" could carry any claim.
    for (const text of [
      "If you need a short answer, your application is secure.",
      "Ongoing monitoring is outside the scope; we deliver a penetration test.",
      "If you want details, we are SOC 2 certified.",
      "Customers who need speed should engage us; your app will be secure.",
      "Password rotation is out of scope, and after this review there are no vulnerabilities.",
    ]) {
      expect(findProhibitedClaims(text), text).not.toEqual([]);
    }
  });

  it("licenses a genuine referral, including a multi-item one", () => {
    for (const text of [
      "Customers who need penetration testing should engage a qualified specialist.",
      "Customers who need penetration testing, compliance certification, or ongoing monitoring should engage a qualified specialist.",
      "Penetration testing is out of scope.",
      "If you require a compliance certification, engage a qualified specialist.",
    ]) {
      expect(findProhibitedClaims(text), text).toEqual([]);
    }
  });

  it("does not let a denial in one clause license a claim in the next", () => {
    for (const text of [
      "We are not a consultancy; we deliver a penetration test.",
      "This is not a compliance certification. We do provide a penetration test.",
      "We never overstate: your application is secure.",
    ]) {
      expect(findProhibitedClaims(text), text).not.toEqual([]);
    }
  });
});
