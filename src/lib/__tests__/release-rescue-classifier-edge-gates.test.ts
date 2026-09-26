import { describe, expect, it } from "vitest";
import { keyLooksSecret, keyNameSegments, MAX_KEY_NAME_LENGTH } from "@/lib/release-rescue-redaction-keys";
import { tailReadsAsSentence, valueShape } from "@/lib/release-rescue-secret-classification";

describe("keyNameSegments keeps the tail of a padded key name", () => {
  it("still sees DB_PASSWORD after enough padding to exceed the name cap", () => {
    const padded = `${"x".repeat(470)}DB_PASSWORD`;
    expect(padded.length).toBeGreaterThan(MAX_KEY_NAME_LENGTH);
    expect(keyNameSegments(padded)).toContain("password");
    expect(keyLooksSecret(padded)).toBe(true);
  });
});

describe("tailReadsAsSentence does not treat a comment as prose", () => {
  it("refuses #, //, and ; comment tails that used to drop a password", () => {
    expect(tailReadsAsSentence(" # this is the value we use in the staging config", 0)).toBe(false);
    expect(tailReadsAsSentence(" // leftover comment about the staging config", 0)).toBe(false);
    expect(tailReadsAsSentence(" ; windows ini comment about the staging config", 0)).toBe(false);
  });

  it("still recognises an ordinary English tail", () => {
    expect(tailReadsAsSentence(" rotation policy with no enforcement yet", 0)).toBe(true);
  });
});

describe("valueShape treats a quantity as wordlike, not a silent drop", () => {
  const neverPlaceholder = () => false;

  it("keeps 30-day, 256bit, and 24h on the sentence path", () => {
    expect(valueShape("30-day", neverPlaceholder)).toBe("wordlike");
    expect(valueShape("256bit", neverPlaceholder)).toBe("wordlike");
    expect(valueShape("24h", neverPlaceholder)).toBe("wordlike");
    expect(valueShape("30-day", neverPlaceholder)).not.toBe("placeholder");
  });
});
