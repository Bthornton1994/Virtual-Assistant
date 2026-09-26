import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { findCredentialSpans, MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import { MAX_INTAKE_FIELD_LENGTH, parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import {
  FIELD_SIZES,
  MAX_WORK_EXPONENT,
  MIN_STEP_GROWTH,
  QUOTED_KEY,
  SCAN_SIZES,
  SERIES,
  SHAPES,
  shape,
  smallestStep,
  workExponent,
  worstPerCharacter,
} from "@/lib/__tests__/release-rescue-scan-shapes";

// The scan's COST, measured as work done rather than as time elapsed.
//
// Every previous attempt to bound this cost asserted a clock reading, and each
// one failed as a threshold the machine decided rather than the code: S-005 a
// 20ms floor, S-012 a 5s ceiling, S-014 a ratio on a clipped step, S-018 a 1.5
// exponent that sat inside runner noise and blocked a release on a commit that
// changed only markdown. This file asserts nothing about time. It counts two
// integers that are the same on every machine and on every run: the scan
// distance of every `indexOf` and `lastIndexOf` call, and the start positions
// every regular-expression search must consider (see `chargedRegexWork`).
//
// NEITHER IS ALL THE SCANNER'S CPU. JavaScript loops, other string methods,
// binary-search steps, allocation and garbage collection are not counted at
// all. What is counted is the part this file guards against.
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

const nativeExec = RegExp.prototype.exec;

/**
 * True for a pattern that can only match at the start of its input: it begins
 * with `^`, is neither global nor multiline, and has no top-level alternative
 * that escapes the anchor (`/^a|b/` is not anchored, and is charged as such).
 */
function isAnchored(pattern: RegExp): boolean {
  if (pattern.global || pattern.multiline || !pattern.source.startsWith("^")) return false;
  let depth = 0;
  let inClass = false;
  for (let index = 0; index < pattern.source.length; index += 1) {
    const character = pattern.source[index];
    if (character === "\\") {
      index += 1;
    } else if (inClass) {
      if (character === "]") inClass = false;
    } else if (character === "[") {
      inClass = true;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    } else if (character === "|" && depth === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Start positions the scan's regular-expression searches must consider.
 *
 * `RegExp.prototype.exec` is what `test`, `match`, `replace` and `split` all
 * reach, so patching it sees every search. An unanchored search that fails must
 * try every start position from where it began to the end of its input, and one
 * that succeeds tried at least every position up to the end of its match; that
 * distance is the charge. An anchored or sticky search tries one position and is
 * charged what it matched, or 1.
 *
 * This is a model of the work, not a measurement of it. The engine may skip
 * positions, and backtracking can repeat work the charge does not see. What it
 * does see is the defect this file guards against: a search of the rest of the
 * input, asked once per candidate.
 */
function chargedRegexWork(run: () => void): number {
  let charged = 0;
  let counting = false;

  RegExp.prototype.exec = function patchedExec(this: RegExp, input: string): RegExpExecArray | null {
    const start = this.global || this.sticky ? this.lastIndex : 0;
    const match = nativeExec.call(this, input);
    if (counting) {
      if (this.sticky || isAnchored(this)) {
        charged += match ? Math.max(1, match[0].length) : 1;
      } else {
        const end = match ? match.index + match[0].length : String(input).length;
        charged += Math.max(1, end - start);
      }
    }
    return match;
  };

  try {
    counting = true;
    run();
  } finally {
    counting = false;
    RegExp.prototype.exec = nativeExec;
  }

  return charged;
}

// `MAX_WORK_EXPONENT` (1.5) and `MIN_STEP_GROWTH` (0.5) are shared with the
// block-work test. Measured on the fixed scanner across all sixteen shapes and
// both series: the worst `indexOf` exponent is 1.1871 and the worst
// regular-expression exponent is 1.0780, both on repeated colons at the field
// sizes (1.0315 and 1.0146 at the scan sizes). That `indexOf` count is linear,
// about 24.2 per character less a fixed 13,700, which a two-point ratio from 2K
// to 8K reads as 1.19. With the residual defects present (on `56e6ed1`), every
// defective shape charges 1.90 or more on at least one counter, on both series.

/**
 * An absolute companion to the exponent, because a cost can be linear and still
 * be enormous. It holds at every size of both series. Measured on the fixed
 * scanner, the worst is 24.01 characters per input character (repeated colons,
 * at 64K). With a defect present the defective shapes charge 2,124 to 10,553 at
 * 64K. A bound of 100 is about four times the observed worst case and about
 * twenty-one times below the nearest defect.
 */
const MAX_CHARGED_PER_CHARACTER = 100;

/**
 * The same companion for regular-expression work, at every size of both series.
 * Measured on the fixed scanner, the worst is 443.9 start positions per input
 * character (repeated colons, at 64K). The XML-attribute defects charge 2,930 and 6,566, so this bound
 * catches them on its own. The block-scalar defect charges 516, which it does
 * not: that one is caught by the exponent and by the `indexOf` count.
 */
const MAX_REGEX_CHARGED_PER_CHARACTER = 1_000;

describe("the scan reads a bounded number of characters, counted rather than timed", () => {
  it("covers every shape, so removing one has to be deliberate", () => {
    expect(SHAPES).toHaveLength(16);
    expect(SCAN_SIZES).toHaveLength(4);
    for (let index = 1; index < SCAN_SIZES.length; index += 1) {
      expect(SCAN_SIZES[index] / SCAN_SIZES[index - 1]).toBe(2);
    }
    expect(SCAN_SIZES[SCAN_SIZES.length - 1]).toBe(MAX_SCAN_LENGTH);
    // The field series doubles up to the largest intake field.
    expect(FIELD_SIZES).toHaveLength(3);
    for (let index = 1; index < FIELD_SIZES.length; index += 1) {
      expect(FIELD_SIZES[index] / FIELD_SIZES[index - 1]).toBe(2);
    }
    expect(FIELD_SIZES[FIELD_SIZES.length - 1]).toBe(MAX_INTAKE_FIELD_LENGTH);
  });

  it("reaches the shared carrier at every size, so the exponent compares one path", () => {
    // The exponent only means something if every size exercises the same code.
    // This shape once reached the carrier at 64K alone, because the keys were cut
    // mid-word at the other three sizes. At every size the text must be whole
    // keys, then one carrier that never closes, and every key must record that
    // one carrier's span.
    const make = shape("quoted keys sharing one unterminated value");
    for (const size of [...FIELD_SIZES, ...SCAN_SIZES]) {
      const text = make(size);
      const carrier = text.indexOf('value="');
      const keys = text.slice(0, Math.max(0, carrier)).split(QUOTED_KEY).length - 1;
      const carried = findCredentialSpans(text).spans.filter((span) => span.form === "xml_attribute");

      expect(text, `${size}`).toHaveLength(size);
      expect(keys, `${size}`).toBeGreaterThan(0);
      expect(text.slice(0, carrier), `${size}: whole keys before the carrier`).toBe(QUOTED_KEY.repeat(keys));
      expect(text.indexOf('"', carrier + 'value="'.length), `${size}: the carrier never closes`).toBe(-1);
      expect(carried, `${size}: ${keys} keys`).toHaveLength(keys);
      expect(new Set(carried.map((span) => `${span.start}:${span.end}`)).size, `${size}: one carrier`).toBe(1);
    }
  });

  // Each bound holds on both series: the exponent, the per-character ceiling at
  // every size rather than at the largest alone, and the step floor.
  for (const [label, make] of SHAPES) {
    it(`stays linear in characters read: ${label}`, () => {
      for (const [series, sizes] of SERIES) {
        const counts = sizes.map((size) => chargedScanWork(() => redactSecrets(make(size))));
        const exponent = workExponent(counts);
        const perCharacter = worstPerCharacter(counts, sizes);
        const step = smallestStep(counts);
        const detail = `${label}, ${series} sizes: ${counts.join(" -> ")} chars read, exponent ${exponent.toFixed(4)}, worst ${perCharacter.toFixed(1)} per input character, smallest step ${step.toFixed(3)}`;

        expect(exponent, detail).toBeLessThan(MAX_WORK_EXPONENT);
        expect(perCharacter, detail).toBeLessThan(MAX_CHARGED_PER_CHARACTER);
        expect(step, detail).toBeGreaterThanOrEqual(MIN_STEP_GROWTH);
      }
    });
  }

  for (const [label, make] of SHAPES) {
    it(`stays linear in regular-expression start positions: ${label}`, () => {
      for (const [series, sizes] of SERIES) {
        const counts = sizes.map((size) => chargedRegexWork(() => redactSecrets(make(size))));
        const exponent = workExponent(counts);
        const perCharacter = worstPerCharacter(counts, sizes);
        const step = smallestStep(counts);
        const detail = `${label}, ${series} sizes: ${counts.join(" -> ")} regex positions, exponent ${exponent.toFixed(4)}, worst ${perCharacter.toFixed(1)} per input character, smallest step ${step.toFixed(3)}`;

        expect(exponent, detail).toBeLessThan(MAX_WORK_EXPONENT);
        expect(perCharacter, detail).toBeLessThan(MAX_REGEX_CHARGED_PER_CHARACTER);
        expect(step, detail).toBeGreaterThanOrEqual(MIN_STEP_GROWTH);
      }
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

    const regexFirst = chargedRegexWork(() => redactSecrets(input));
    expect(chargedRegexWork(() => redactSecrets(input))).toBe(regexFirst);
    expect(regexFirst).toBeGreaterThan(0);
  });

  it("restores the methods it patched, even when the measured call throws", () => {
    expect(() => chargedScanWork(() => {
      throw new Error("measured call failed");
    })).toThrow("measured call failed");

    expect(String.prototype.lastIndexOf).toBe(nativeLastIndexOf);
    expect(String.prototype.indexOf).toBe(nativeIndexOf);

    expect(() => chargedRegexWork(() => {
      throw new Error("measured call failed");
    })).toThrow("measured call failed");
    expect(RegExp.prototype.exec).toBe(nativeExec);
  });

  it("treats a pattern as anchored only when the anchor governs every alternative", () => {
    expect(isAnchored(/^abc/)).toBe(true);
    expect(isAnchored(/^(?:a|b)c$/i)).toBe(true);
    expect(isAnchored(/^[|]x/)).toBe(true);
    expect(isAnchored(/^a|b/)).toBe(false);
    expect(isAnchored(/^a/g)).toBe(false);
    expect(isAnchored(/^a/m)).toBe(false);
    expect(isAnchored(/a^/)).toBe(false);
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
  // 1.0315 at the scan sizes for the scanner as it now stands.

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

  it("reports quadratic growth for a repeated search of the rest of the input by a regular expression", () => {
    // The XML-attribute pattern: once per candidate, a search of everything
    // after it, which on text with no match reads to the end each time.
    const counts = sizes.map((size) => {
      const text = oneLine(size);
      return chargedRegexWork(() => {
        for (let at = 0; at < text.length; at += 9) /\bvalue\s*=\s*"/i.exec(text.slice(at));
      });
    });

    expect(workExponent(counts)).toBeGreaterThan(1.9);
    expect(workExponent(counts)).toBeGreaterThan(MAX_WORK_EXPONENT);
  });

  it("does not charge an anchored search for the input it never reaches", () => {
    // The anchored rule is what keeps the regex count honest: `^x` on the rest
    // of the text tries one position, not the rest of the text.
    const counts = sizes.map((size) => {
      const text = oneLine(size);
      return chargedRegexWork(() => {
        for (let at = 0; at < text.length; at += 9) /^x/.test(text.slice(at));
      });
    });

    expect(workExponent(counts)).toBeLessThan(MAX_WORK_EXPONENT);
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

describe("the XML-attribute and block-scalar forms read what they always read", () => {
  // Each expected value below was measured on the parent commit and on the
  // commit before it, and is unchanged by indexing the two forms.

  it("records the shared carrier once per quoted key in the tag", () => {
    const tag = '<add key="db.password" name="jdbc.password" value="S3cretP4ssw0rdHere" />';
    const xml = findCredentialSpans(tag).spans.filter((span) => span.form === "xml_attribute");

    expect(xml.map((span) => [span.start, span.end])).toEqual([[51, 69], [51, 69]]);
    expect(redactSecrets(tag).redacted).not.toContain("S3cretP4ssw0rdHere");
  });

  it("stops looking for a carrier at the end of the tag", () => {
    const text = '<add name="db.password"> value="S3cretP4ssw0rdHere"';

    expect(findCredentialSpans(text).spans).toEqual([]);
  });

  it("does not read a carrier out of a longer attribute name", () => {
    const text = '<add name="db.password" datavalue="S3cretP4ssw0rdHere" />';

    expect(findCredentialSpans(text).spans).toEqual([]);
  });

  it("ends the value at the quote that opened it, or at the end of the text", () => {
    expect(redactSecrets("<add name='db.password' value='S3cret\"P4ss' />").redacted).toBe(
      "<add name='db.password' value='[REDACTED:assigned_secret]' />",
    );
    expect(redactSecrets('<add name="db.password" value="S3cretP4ssw0rdHere').redacted).toBe(
      '<add name="db.password" value="[REDACTED:assigned_secret]',
    );
  });

  it("pins one PRE-EXISTING under-report: a block scalar yields only its first line", () => {
    // NOT desired behaviour and NOT this change's doing. The block-scalar form
    // takes the value run on the first body line. The loop that walked the rest
    // of the block computed an end that was never read, so a second secret line
    // has always been left readable. Taking the whole block is a detector
    // decision with its own false-positive risk and is not made here.
    const block = "db_password: |\n  S3cretP4ssw0rdHere\n  SecondLineSecret99\nnext: 1";

    expect(redactSecrets(block).redacted).toBe(
      "db_password: |\n  [REDACTED:assigned_secret]\n  SecondLineSecret99\nnext: 1",
    );
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
  it("caps each field the public path scans at MAX_INTAKE_FIELD_LENGTH", () => {
    expect(MAX_INTAKE_FIELD_LENGTH).toBe(8_000);
    // Smaller than MAX_SCAN_LENGTH, which makes the field limit — not the scan
    // limit — the bound on any ONE scan an anonymous POST can cause. It is not a
    // bound on the request: a failed submission re-scans every echoed field.
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
