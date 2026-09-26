import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { findCredentialSpans, MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import { MAX_INTAKE_FIELD_LENGTH, parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

// The scan's COST, measured as work done rather than as time elapsed.
//
// Every previous attempt to bound this cost asserted a clock reading, and each
// one failed as a threshold the machine decided rather than the code: S-005 a
// 20ms floor, S-012 a 5s ceiling, S-014 a ratio on a clipped step, S-018 a 1.5
// exponent that sat inside runner noise and blocked a release on a commit that
// changed only markdown. This file asserts nothing about time. It counts
// characters the scan asks the engine to read, which is an integer, is the same
// integer on every machine, and is the same integer on every run.
//
// WHY A COUNT IS THE RIGHT ORACLE HERE. The defects this file guards against
// are all one shape: a search that restarts from the beginning (or the end) of
// the input, asked once per candidate. `text.lastIndexOf("\n", offset)` and
// `text.indexOf("\n", index)` are single calls in the source and O(n) reads at
// runtime, so the cost is invisible in the source, invisible to a JavaScript
// statement or block counter — the scan happens inside a native method, which
// executes no JavaScript — and visible in elapsed time only through whatever
// noise the runner adds. Charging each call its scan distance makes the cost
// explicit and deterministic.
//
// THIS INSTRUMENTATION IS TEST-SIDE ONLY, AND MUST STAY THAT WAY. It patches
// `String.prototype` for the duration of one measured call and restores it in a
// `finally`. Nothing is added to, exported from, or counted inside the scanner:
// production code is unaware this file exists. A counter on the scanner's hot
// path would put test-only state inside a module that runs on an
// unauthenticated request path, would have to be maintained in step with every
// future refactor, and would be one more thing to get wrong in a
// security-relevant file. There is no need for one, because the cost being
// measured is paid to the engine, and the engine can be asked about it from
// outside.

const nativeLastIndexOf = String.prototype.lastIndexOf;
const nativeIndexOf = String.prototype.indexOf;

/**
 * Characters the engine is asked to read by the scan's index searches.
 *
 * A backward search from `position` that lands on `found` read the characters
 * between them; a forward search from `position` that lands on `found` did the
 * same; a search that returns -1 read to the end it was heading for. Charging
 * the distance turns each call into the number of characters it actually
 * examined.
 *
 * Both patched functions delegate to the captured natives and never call a
 * patched method themselves, so the charge path cannot re-enter itself. The
 * counter runs only between `counting = true` and the `finally`, so nothing the
 * test framework does around the measurement is charged to the scan.
 */
function chargedScanWork(run: () => void): number {
  let charged = 0;
  let counting = false;

  String.prototype.lastIndexOf = function patchedLastIndexOf(
    this: string,
    search: string,
    position?: number,
  ): number {
    const found = nativeLastIndexOf.call(this, search, position as number);
    if (counting) {
      const from = position === undefined ? this.length : Math.min(position, this.length);
      charged += Math.max(0, from - (found < 0 ? 0 : found));
    }
    return found;
  };

  String.prototype.indexOf = function patchedIndexOf(
    this: string,
    search: string,
    position?: number,
  ): number {
    const found = nativeIndexOf.call(this, search, position as number);
    if (counting) {
      const from = position === undefined ? 0 : Math.max(0, position);
      charged += Math.max(0, (found < 0 ? this.length : found) - from);
    }
    return found;
  };

  try {
    counting = true;
    run();
  } finally {
    counting = false;
    String.prototype.lastIndexOf = nativeLastIndexOf;
    String.prototype.indexOf = nativeIndexOf;
  }

  return charged;
}

/** Growth across the whole range, over counted work rather than over time. */
function workExponent(counts: readonly number[]): number {
  const doublings = counts.length - 1;
  return Math.log2(counts[doublings] / counts[0]) / doublings;
}

// Sizes derived from the bound, so every step is one real doubling of the text
// the span scan actually reads, exactly as the growth test derives them.
const SCAN_SIZES = [
  MAX_SCAN_LENGTH / 8,
  MAX_SCAN_LENGTH / 4,
  MAX_SCAN_LENGTH / 2,
  MAX_SCAN_LENGTH,
];

/**
 * The shapes that carry the two defects this file exists to keep fixed, plus
 * the ones the growth test measures. Every shape here is a SINGLE LINE with no
 * newline in it, which is the input that makes a line-start search scan the
 * whole prefix and a line-end search scan the whole suffix.
 */
const SHAPES: ReadonlyArray<readonly [string, (size: number) => string]> = [
  // `restOfLineValueSpan` asked for a line start once per assignment.
  ["repeated assignments", (n) => "password=".repeat(Math.ceil(n / 9)).slice(0, n)],
  // `valueSpan` asked for the next `)` and the next newline once per value.
  ["repeated colons", (n) => "password:".repeat(Math.floor(n / 9))],
  ["repeated quoted assignments", (n) => 'password="a" '.repeat(Math.ceil(n / 13)).slice(0, n)],
  // The shape S-004 was measured on.
  ["repeated tags", (n) => "<password>".repeat(Math.floor(n / 10))],
  // The noun-driven path, which is the one S-004 lived in.
  ["credential nouns in prose", (n) => "the password is not stored here. ".repeat(Math.ceil(n / 33)).slice(0, n)],
  // A value run that really does end at `(`, so the guarded lookups are the
  // ones that run rather than the ones that are skipped.
  ["assignments ending at a paren", (n) => "password=a( ".repeat(Math.ceil(n / 12)).slice(0, n)],
  ["repeated flags", (n) => "--password ".repeat(Math.floor(n / 11))],
  ["repeated flags with values", (n) => "--password x ".repeat(Math.ceil(n / 13)).slice(0, n)],
  ["scheme-like run", (n) => `a${".b".repeat(n / 2)}=value12345`],
  ["identifier run", (n) => `${"A".repeat(n)}_PASSWORD=x`],
  ["quotes", (n) => '"'.repeat(n)],
  ["pem prefix", (n) => `-----BEGIN ${"A ".repeat(n / 2)}`],
];

/**
 * Linear is 1.0 and quadratic is 2.0 over three real doublings. The bar sits
 * between them with room on both sides that was measured rather than guessed:
 * on the fixed scanner the worst shape charges an exponent of 1.033, and with
 * either defect reintroduced the worst charges 1.99 or more.
 */
const MAX_WORK_EXPONENT = 1.5;

/**
 * An absolute companion to the exponent, because a cost can be linear and still
 * be enormous. Measured: the fixed scanner's worst shape charges 23.0
 * characters per input character; with a defect present the same shapes charge
 * 6,400 to 17,664. A bound of 100 is four times the observed worst case and
 * sixty-four times below the nearest defect.
 */
const MAX_CHARGED_PER_CHARACTER = 100;

describe("the scan reads a bounded number of characters, counted rather than timed", () => {
  it("covers every shape, so removing one has to be deliberate", () => {
    expect(SHAPES).toHaveLength(12);
    expect(SCAN_SIZES).toHaveLength(4);
    for (let index = 1; index < SCAN_SIZES.length; index += 1) {
      expect(SCAN_SIZES[index] / SCAN_SIZES[index - 1]).toBe(2);
    }
    expect(SCAN_SIZES[SCAN_SIZES.length - 1]).toBe(MAX_SCAN_LENGTH);
  });

  for (const [label, make] of SHAPES) {
    it(`stays linear in characters read: ${label}`, () => {
      const counts = SCAN_SIZES.map((size) => chargedScanWork(() => redactSecrets(make(size))));
      const exponent = workExponent(counts);
      const perCharacter = counts[counts.length - 1] / MAX_SCAN_LENGTH;
      const detail = `${label}: ${counts.join(" -> ")} chars read, exponent ${exponent.toFixed(4)}, ${perCharacter.toFixed(1)} per input character`;

      expect(exponent, detail).toBeLessThan(MAX_WORK_EXPONENT);
      expect(perCharacter, detail).toBeLessThan(MAX_CHARGED_PER_CHARACTER);
    });
  }

  it("counts the same integer every time, which is what makes this not a timing test", () => {
    // Three measurements of the same input. A clock would give three different
    // numbers; a count gives one. If this ever fails, the measurement has
    // become machine-dependent and nothing else in this file can be trusted.
    const input = "password=".repeat(Math.ceil(MAX_SCAN_LENGTH / 9)).slice(0, MAX_SCAN_LENGTH);
    const first = chargedScanWork(() => redactSecrets(input));
    const second = chargedScanWork(() => redactSecrets(input));
    const third = chargedScanWork(() => redactSecrets(input));

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  it("restores the methods it patched, even when the measured call throws", () => {
    expect(() => chargedScanWork(() => {
      throw new Error("measured call failed");
    })).toThrow("measured call failed");

    expect(String.prototype.lastIndexOf).toBe(nativeLastIndexOf);
    expect(String.prototype.indexOf).toBe(nativeIndexOf);
  });
});

describe("the measurement can fail, on the two patterns this scanner had", () => {
  // A GATE THAT CANNOT FAIL IS THE DEFECT THIS WORKSTREAM HAS RECORDED FOUR
  // TIMES, so the assertions above are only worth something if the quantity
  // they read moves when the defect is present.
  //
  // These two fixtures are local reimplementations of the patterns that were
  // removed. They do NOT execute the scanner: no production code carries these
  // shapes any more, and a test cannot reintroduce a defect into the module it
  // is testing. What they establish is narrower and is the part that matters —
  // that `chargedScanWork` reports quadratic growth when a repeated full-range
  // search is present, so a green result above is evidence and not an artefact
  // of the measurement being blind.
  //
  // The end-to-end version of this proof is a mutation run against a scratch
  // copy of the scanner, recorded in the pull request: with the line index
  // degraded back to a backward scan the worst shape charges an exponent of
  // 2.0000, and with the value-span lookups ungated it charges 2.0562, against
  // 1.0329 for the scanner as it now stands.

  const sizes = SCAN_SIZES;
  const oneLine = (n: number) => "password=".repeat(Math.ceil(n / 9)).slice(0, n);

  it("reports quadratic growth for a repeated backward line-start search (the S-004 pattern)", () => {
    const counts = sizes.map((size) => {
      const text = oneLine(size);
      // Once per candidate, exactly as `restOfLineValueSpan` and the noun
      // collector both used to do it.
      const starts: number[] = [];
      for (let at = 0; at < text.length; at += 9) starts.push(at);
      return chargedScanWork(() => {
        for (const at of starts) text.lastIndexOf("\n", Math.max(0, at - 1));
      });
    });

    expect(workExponent(counts)).toBeGreaterThan(1.9);
    expect(workExponent(counts)).toBeGreaterThan(MAX_WORK_EXPONENT);
  });

  it("reports quadratic growth for a repeated forward suffix search (the value-span pattern)", () => {
    const counts = sizes.map((size) => {
      const text = oneLine(size);
      const points: number[] = [];
      for (let at = 0; at < text.length; at += 9) points.push(at);
      return chargedScanWork(() => {
        for (const at of points) {
          text.indexOf(")", at);
          text.indexOf("\n", at);
        }
      });
    });

    expect(workExponent(counts)).toBeGreaterThan(1.9);
    expect(workExponent(counts)).toBeGreaterThan(MAX_WORK_EXPONENT);
  });

  it("reports linear growth for the indexed form that replaced them", () => {
    // The same question, answered by the structure the scanner now builds once.
    const counts = sizes.map((size) => {
      const text = oneLine(size);
      return chargedScanWork(() => {
        const newlineAt: number[] = [];
        for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) {
          newlineAt.push(at);
        }
        for (let at = 0; at < text.length; at += 9) {
          let low = 0;
          let high = newlineAt.length - 1;
          while (low <= high) {
            const mid = (low + high) >> 1;
            if (newlineAt[mid] <= at) low = mid + 1;
            else high = mid - 1;
          }
        }
      });
    });

    expect(workExponent(counts)).toBeLessThan(MAX_WORK_EXPONENT);
  });
});

describe("the fix changed cost, not behaviour", () => {
  it("still finds the credential in each form the affected paths handle", () => {
    // `restOfLineValueSpan` is reached on an `=`-family operator; `valueSpan`
    // on everything else. Both are exercised here with the value in a position
    // the changed code decides about.
    const forms = [
      "DB_PASSWORD=S3cretP4ssw0rdHere",
      "DB_PASSWORD = S3cretP4ssw0rdHere",
      'DB_PASSWORD="S3cretP4ssw0rdHere"',
      "password: S3cretP4ssw0rdHere",
      "password := S3cretP4ssw0rdHere",
      "export DB_PASSWORD=S3cretP4ssw0rdHere",
      "--password S3cretP4ssw0rdHere",
      "Rotate pr0d-Xk92mQvn7Lz and move it to a secret store",
    ];

    for (const form of forms) {
      expect(redactSecrets(form).redacted, form).not.toContain("S3cretP4ssw0rdHere");
    }
    expect(redactSecrets(forms[forms.length - 1]).redacted).not.toContain("pr0d-Xk92mQvn7Lz");
  });

  it("still treats a call as a call, which is the branch the guarded lookups feed", () => {
    // The two lookups are read only when the value run stopped at `(`. These
    // are the inputs where that happens, so the guard is exercised rather than
    // skipped: the first is a call and must not be reported as a credential
    // value, the second stops at `(` with no closing paren on the line and is
    // a value.
    const call = "const token = getToken(req);";
    const notACall = "DB_PASSWORD=Xk92mQvn7Lz(";

    expect(redactSecrets(call).redacted).toContain("getToken");
    expect(redactSecrets(notACall).redacted).not.toContain("Xk92mQvn7Lz");
  });

  it("leaves ordinary security prose exactly as written", () => {
    // The report is ABOUT security. A sentence that discusses credentials
    // without carrying one must arrive unchanged, and the cheaper scan must not
    // have bought its speed by looking at less.
    const prose = [
      "the password rotation policy is weak and should be reviewed",
      "We fixed the token leak in commit a1b2c3d4e5f6 last week.",
      "Credentials are read by the deploy-2024-prod-runner job.",
      "Rotate the API key quarterly and store it in the secret manager.",
    ];

    for (const sentence of prose) {
      expect(redactSecrets(sentence).redacted, sentence).toBe(sentence);
    }
  });

  it("pins one PRE-EXISTING over-report, unchanged by this change", () => {
    // NOT desired behaviour and NOT this change's doing. An assignment in the
    // middle of a sentence still takes the words after the placeholder:
    // `restOfLineValueSpan` correctly declines the line, `valueSpan` takes the
    // run, and what follows is scored as an assigned secret. Measured on the
    // parent commit and on this one and found byte-identical, so it is recorded
    // here rather than fixed: changing it is a detector decision with its own
    // false-negative risk, and this change is about cost, not classification.
    const sentence = "The deploy config sets DB_PASSWORD=<your-password> in production.";

    expect(redactSecrets(sentence).redacted).toBe(
      "The deploy config sets DB_PASSWORD=<your-password>[REDACTED:assigned_secret]",
    );
  });

  it("keeps the placeholder and identifier allowlists intact", () => {
    for (const benign of ["DB_PASSWORD=${DB_PASSWORD}", "DB_PASSWORD=<your-password>", "password=null"]) {
      expect(redactSecrets(benign).redacted, benign).toBe(benign);
    }
  });
});

describe("the bound on what is read at all is unchanged", () => {
  it("reports truncation at one character past the bound, and not before", () => {
    expect(findCredentialSpans("a".repeat(MAX_SCAN_LENGTH)).truncated).toBe(false);
    expect(findCredentialSpans("a".repeat(MAX_SCAN_LENGTH + 1)).truncated).toBe(true);
  });

  it("still finds a credential that sits just inside the bound", () => {
    const secret = "S3cretP4ssw0rdHere";
    const assignment = `DB_PASSWORD=${secret}`;
    const padded = "a".repeat(MAX_SCAN_LENGTH - assignment.length) + assignment;

    expect(padded).toHaveLength(MAX_SCAN_LENGTH);
    expect(redactSecrets(padded).redacted).not.toContain(secret);
  });

  it("does not read a credential that sits beyond the bound", () => {
    // Not a regression: the scan is bounded on purpose, and this pins that the
    // cheaper scan did not quietly extend its reach.
    const secret = "S3cretP4ssw0rdHere";
    const beyond = "a".repeat(MAX_SCAN_LENGTH + 10) + `DB_PASSWORD=${secret}`;
    const { spans, truncated } = findCredentialSpans(beyond);

    expect(truncated).toBe(true);
    for (const span of spans) {
      expect(span.start).toBeLessThan(MAX_SCAN_LENGTH);
    }
  });

  it("charges bounded work on input far beyond the bound", () => {
    const oversized = "password=".repeat(Math.ceil((MAX_SCAN_LENGTH * 4) / 9));
    const charged = chargedScanWork(() => redactSecrets(oversized));

    expect(charged / oversized.length).toBeLessThan(MAX_CHARGED_PER_CHARACTER);
  });
});

describe("the public intake limits are still the ones that bound the unauthenticated path", () => {
  it("truncates every field at MAX_INTAKE_FIELD_LENGTH before anything expensive runs", () => {
    expect(MAX_INTAKE_FIELD_LENGTH).toBe(8_000);
    // Smaller than MAX_SCAN_LENGTH, which is what makes the field limit — not
    // the scan limit — the bound that governs what an anonymous POST can cost.
    expect(MAX_INTAKE_FIELD_LENGTH).toBeLessThan(MAX_SCAN_LENGTH);
  });

  it("refuses evidence notes over 2000 characters before scanning them", () => {
    const result = parseRescueIntake({ evidenceNotes: "a".repeat(2001) });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("2000 characters");
  });

  it("still refuses evidence notes that carry a credential", () => {
    const result = parseRescueIntake({ evidenceNotes: "PGPASSWORD=pr0dXk92mQvn7Lz" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("looks like a credential");
  });

  it("charges bounded work for the largest field the public path accepts", () => {
    // The adversarial shape at the size a field can actually reach, which is
    // the number that describes the unauthenticated cost — not the 64,000 the
    // scanner would allow if the field limit were not there first.
    const field = "password=".repeat(Math.ceil(MAX_INTAKE_FIELD_LENGTH / 9)).slice(0, MAX_INTAKE_FIELD_LENGTH);
    const charged = chargedScanWork(() => redactSecrets(field));

    expect(charged / MAX_INTAKE_FIELD_LENGTH).toBeLessThan(MAX_CHARGED_PER_CHARACTER);
  });
});
