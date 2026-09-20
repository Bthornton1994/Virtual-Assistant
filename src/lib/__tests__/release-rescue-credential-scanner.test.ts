import { describe, expect, it } from "vitest";
import { containsLikelySecret, redactSecrets, scanForSecrets } from "@/lib/release-rescue-redaction";
import { findCredentialSpans, MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import { buildReleaseRescueReport, releaseRescueDeliveryGate, validateReleaseRescueReport } from "@/lib/release-rescue-report";
import {
  FIXTURE_OPERATOR_ID, makeFinding, makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

// The credential scanner, tested as a scanner rather than as a list of examples.
//
// Three audits defeated the regex this replaces, each time with a syntax nobody
// had added to the alternation. So these tests are built the other way round:
// a table of assignment FORMS, crossed with generated variations of separator,
// casing, affix, quoting and whitespace. A fix that closes only the next example
// fails here.
//
// The secret value is the same everywhere on purpose: the test is about whether
// the FORM is recognised, not about whether the value looks exotic.

const SECRET = "S3cretP4ssw0rdHere";

/** Every syntax an audit found, plus the ones they were examples of. */
const FORMS: Array<{ family: string; render: (key: string, value: string) => string }> = [
  { family: "operator =", render: (k, v) => `${k}=${v}` },
  { family: "operator :", render: (k, v) => `${k}: ${v}` },
  { family: "operator :=", render: (k, v) => `${k} := ${v}` },
  { family: "operator =>", render: (k, v) => `${k} => ${v}` },
  { family: "quoted value", render: (k, v) => `${k} = "${v}"` },
  { family: "single quoted", render: (k, v) => `${k} = '${v}'` },
  { family: "json", render: (k, v) => `"${k}": "${v}"` },
  { family: "yaml", render: (k, v) => `${k}: ${v}` },
  { family: "yaml block scalar", render: (k, v) => `${k}: |\n  ${v}` },
  { family: "dockerfile ENV", render: (k, v) => `ENV ${k} ${v}` },
  { family: "dockerfile ARG", render: (k, v) => `ARG ${k} ${v}` },
  { family: "shell export", render: (k, v) => `export ${k}=${v}` },
  { family: "sql", render: (k, v) => `CREATE USER app WITH ${k} '${v}';` },
  { family: "long flag", render: (k, v) => `mytool --${k} ${v} --verbose` },
  { family: "xml element", render: (k, v) => `<${k}>${v}</${k}>` },
  { family: "xml attribute", render: (k, v) => `<property name="${k}" value="${v}"/>` },
  { family: "netrc", render: (k, v) => `machine api.example.com login deploy ${k} ${v}` },
  { family: "csv", render: (k, v) => `user,${k}\nadmin,${v}` },
  { family: "no leading context", render: (k, v) => `${k}=${v}` },
  { family: "after prose", render: (k, v) => `The deployment config sets ${k}=${v} in production.` },
  { family: "after another assignment", render: (k, v) => `Config: ${k}=${v}` },
];

/** Key names that all mean "this holds a credential". */
const KEYS = [
  "password",
  "PASSWORD",
  "DB_PASSWORD",
  "DB_PASSWORD_PROD",
  "NEXTAUTH_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "SESSION_PASSPHRASE",
  "dbPasswordProd",
  "db.password.prod",
  "db-password-prod",
  "api_key",
  "x-api-key",
  "client_secret",
  "PROD_DATABASE_CONNECTION_STRING",
];

describe("every assignment form, crossed with every key shape", () => {
  it("redacts the value in all of them", () => {
    const leaks: string[] = [];

    for (const form of FORMS) {
      for (const key of KEYS) {
        // A form that names the key itself (xml, sql, netrc, csv) only makes
        // sense with a simple key, so those are exercised with the plain one.
        const usable = /[<,]|WITH|machine/.test(form.render("K", "V")) && key !== "password" ? null : key;
        if (!usable) continue;

        const text = form.render(usable, SECRET);
        if (redactSecrets(text).redacted.includes(SECRET)) leaks.push(`${form.family} / ${usable}`);
      }
    }

    expect(leaks, `${leaks.length} form/key combinations leaked`).toEqual([]);
  });

  it("redacts a URL credential with or without a username", () => {
    for (const url of [
      "redis://:S3cretP4ssw0rdHere@cache.internal:6379/0",
      "redis://user:S3cretP4ssw0rdHere@cache.internal:6379/0",
      "mongodb://:S3cretP4ssw0rdHere@db.example.com:27017",
      "postgres://appuser:S3cretP4ssw0rdHere@db.internal:5432/app",
      "amqps://:S3cretP4ssw0rdHere@queue.internal",
    ]) {
      expect(redactSecrets(url).redacted, url).not.toContain(SECRET);
    }
  });

  it("redacts a short value, which the old minimum length let through", () => {
    for (const value of ["Tr0ub4d", "hunter2", "abc123"]) {
      expect(redactSecrets(`password=${value}`).redacted, value).not.toContain(value);
    }
  });

  it("does not let a non-secret assignment swallow a secret one", () => {
    // The regex matched key, operator and value together, so `Config:` consumed
    // the text after it and `String.replace` resumed past the real assignment.
    // Ordinary prose in front of a .env line was enough.
    const text = "A bookkeeping app. Config: DB_PASSWORD_PROD=hunter2hunter2hunter2";

    expect(redactSecrets(text).redacted).not.toContain("hunter2hunter2hunter2");
  });

  it("redacts the credential after an auth scheme, not the scheme itself", () => {
    const redacted = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwx").redacted;

    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwx");
    // Redacting the word "Bearer" and leaving the token is worse than useless: it
    // looks like something was protected.
    expect(redacted).toContain("Bearer");
  });
});

describe("safe text stays readable, because a false positive blocks a delivery", () => {
  const SAFE = [
    "const apiKey = process.env.API_KEY;",
    "password: import.meta.env.DB_PASSWORD",
    "api_key: ${API_KEY}",
    "client_secret: <your-client-secret>",
    "password = changeme",
    'const token = "";',
    "The password rotation policy is weak and should be reviewed.",
    "Passwords are stored using bcrypt with a work factor of 12.",
    "This finding concerns the password reset flow in checkout.",
    "See the secret management section of the README for details.",
    'const authorName = "Jonathan Smithson";',
    'const bypass = "somethinglongish";',
    'const tokenizer = "wordpiece-basic";',
    "saltRounds = 10",
    "A structured release-readiness review of one repository.",
  ];

  for (const text of SAFE) {
    it(`leaves alone: ${text.slice(0, 48)}`, () => {
      expect(redactSecrets(text).hadSecrets, text).toBe(false);
    });
  }
});

// Growth over real doublings, measured as the whole-range exponent.
//
// Linear is a 2x step (exponent 1.0); quadratic is a 4x step (exponent 2.0).
// S-005 replaced skippable per-step ratios with this exponent so a 20ms floor
// could not hide S-004 a second time. S-018 then replaced the exponent with
// the median of the three adjacent doubling ratios against 3.
//
// Audit 48 measured what that swap actually did, and the two gates turn out
// not to be ordered by strength: they ask different questions. A median of
// three discards the largest ratio, so a cost that only turns super-linear in
// the FINAL doubling passes it untouched. [1, 2, 4, 256] has a median ratio of
// 2.00 against a bar of 3, and a whole-range exponent of 2.667. The mirror
// case [1, 8, 16, 32] is the same: median 2.00, exponent 1.667. Neither series
// is noise. Both are growth the median cannot see, because the sample that
// carries the growth is the one the median throws away.
//
// So the whole-range exponent is the authoritative gate again. It reads the
// largest sample rather than discarding it, and it is the single number every
// series below is measured against.
const MAX_GROWTH_EXPONENT = 1.5;

/**
 * The whole-range growth exponent over a series of equal doublings.
 *
 * ORDER IS PART OF THE CALCULATION: the first and last samples are the
 * endpoints and the divisor is the number of steps between them, so the same
 * numbers in a different order are a different answer. `depends on the order
 * of the samples` below pins that, because a future rewrite that sorts or
 * reverses the series would otherwise pass every other test here.
 */
function growthExponent(timings: readonly number[]): number {
  const doublings = timings.length - 1;
  return Math.log2(timings[doublings] / timings[0]) / doublings;
}

/**
 * THE gate. The live measurement below and the recorded-series table both
 * decide through this one function, so growth is judged in exactly one place.
 *
 * WHAT THAT BUYS, measured rather than asserted. Rewriting this function to
 * judge by the median of adjacent ratios instead - the S-018 change - fails 3
 * tests in this file. When the table recomputed the comparison itself, the
 * same rewrite left it green.
 *
 * WHAT IT DOES NOT BUY, stated because a partial guard described as a whole
 * one is how S-014 and S-018 happened. Deleting the call below and writing a
 * median assertion inline at the live site still passes every test here: 55
 * of 55. No test can observe another test's assertion, so that residual is
 * closed by reading the diff, not by running it. What this function does is
 * make such a change a visible deletion rather than a silent drift.
 */
function exceedsGrowthCeiling(timings: readonly number[]): boolean {
  return growthExponent(timings) >= MAX_GROWTH_EXPONENT;
}

describe("the growth gate, on recorded series rather than on the clock", () => {
  // Deterministic. These are numbers that were measured, or the textbook shape
  // of the thing being measured, so the gate itself is tested without a clock
  // anywhere near it. `verdict` is what the live gate must say about each one.
  const SERIES: ReadonlyArray<{
    label: string;
    timings: readonly number[];
    exponent: number;
    verdict: "rejects" | "accepts";
  }> = [
    // Textbook quadratic: every step is 4x.
    { label: "a pure n^2 series", timings: [1, 4, 16, 64], exponent: 2, verdict: "rejects" },
    // S-004's shape. RECONSTRUCTED, not recorded: what the ledger and the
    // scanner's own comment record are the three ratios 3.10, 3.48, 3.70 and a
    // whole-range exponent of 1.771. This series is built back from those
    // two-decimal ratios, so it measures 1.772960 rather than 1.771 - the
    // difference is rounding in the published ratios, not a second
    // measurement. What matters here is the SHAPE: the ratios rise together,
    // which is super-linear growth rather than one descheduled sample.
    { label: "the S-004 near-quadratic shape", timings: [10, 31, 107.88, 399.156], exponent: 1.772960264105, verdict: "rejects" },
    // Growth confined to the last doubling. Median 2.00 — invisible to S-018.
    { label: "growth that starts only in the last doubling", timings: [1, 2, 4, 256], exponent: 2.666666666667, verdict: "rejects" },
    // Growth confined to the first doubling. Median 2.00 — also invisible.
    { label: "growth that stops after the first doubling", timings: [1, 8, 16, 32], exponent: 1.666666666667, verdict: "rejects" },
    // Textbook linear: every step is 2x.
    { label: "a pure linear series", timings: [1, 2, 4, 8], exponent: 1, verdict: "accepts" },
    // `password=` repeated, measured at these sizes while S-014 was open. A
    // mild super-linear residual, recorded rather than smoothed, and the
    // closest real series to the ceiling on the accepting side.
    { label: "the measured `password=` residual", timings: [10.8, 24, 56.5, 145.2], exponent: 1.249646078611, verdict: "accepts" },
    // THE EXPONENT'S OWN BLIND BAND, stated rather than left to be discovered.
    // It bounds growth across the whole range, not any single step, so a late
    // spike small enough in total is admitted: over three doublings the
    // ceiling permits last/first < 2^4.5 = 22.627, which on an otherwise
    // linear series leaves room for a final step of up to 22.627 / 4 = 5.657x.
    // This series spikes 5.00x at the end and is accepted. The median gate
    // this replaces had the mirror blind spot and a wider one - it discarded
    // the largest ratio outright, so [1, 2, 4, 256] passed at 64x. Neither
    // estimator sees every shape; this one at least cannot ignore the sample
    // that carries the growth.
    { label: "a late spike small enough to stay inside the ceiling", timings: [1, 2, 4, 20], exponent: 1.4406426982957876, verdict: "accepts" },
  ];

  it("covers every series in the table", () => {
    // Deleting a row deletes a test, and a deleted test does not fail. The
    // count is pinned so removing coverage has to be deliberate.
    expect(SERIES).toHaveLength(7);
    expect(SERIES.filter((row) => row.verdict === "rejects")).toHaveLength(4);
    expect(SERIES.filter((row) => row.verdict === "accepts")).toHaveLength(3);
  });

  for (const row of SERIES) {
    it(`${row.verdict}: ${row.label}`, () => {
      const exponent = growthExponent(row.timings);

      expect(exponent).toBeCloseTo(row.exponent, 10);
      // Through the SAME function the live gate calls, not a copy of its
      // comparison. This is what makes the table describe the gate.
      expect(exceedsGrowthCeiling(row.timings)).toBe(row.verdict === "rejects");
    });
  }

  it("pins the ceiling the live gate reads", () => {
    // The table brackets this number from both sides: the closest ACCEPTED
    // series measures 1.440643 and the closest REJECTED one 1.666667, so
    // moving the ceiling anywhere outside (1.440643, 1.666667] already fails a
    // row above. This fixes it inside that bracket, so changing it has to be
    // deliberate rather than a quiet edit that no test notices.
    expect(MAX_GROWTH_EXPONENT).toBe(1.5);
  });

  it("records the fb3110e false positive the ceiling cannot avoid", () => {
    // NOT a defect, and NOT desired behaviour. This is the one series in this
    // file that the gate gets WRONG, and it is here because a gate's known
    // false positives belong beside it rather than only in a commit message.
    //
    // GitHub Actions measured it on fb3110e, a ledger-only commit: markdown
    // this test never reads, with the scanner byte-identical to its green
    // parent. No defect was present, and the gate still says reject.
    const timings = [12.73, 27.75, 64.32, 301.28];

    expect(growthExponent(timings)).toBeCloseTo(1.521600193571, 10);
    expect(exceedsGrowthCeiling(timings)).toBe(true);

    // The margin is NEGATIVE, by this much: at a ceiling of 1.5 the largest
    // last sample this first sample permits is 12.73 * 2^4.5 = 288.047ms, and
    // the run measured 301.28ms - over the allowance by 4.59%. The ceiling has
    // no room on the high side against a measurement already observed on CI
    // hardware with nothing wrong.
    const allowance = timings[0] * 2 ** (MAX_GROWTH_EXPONENT * 3);
    expect(allowance).toBeCloseTo(288.047, 3);
    expect(timings[3]).toBeGreaterThan(allowance);
    expect(timings[3] / allowance - 1).toBeCloseTo(0.0459, 4);

    // Restoring the exponent re-instates this failure. That is the blocker on
    // this change, recorded rather than dissolved: every workaround available
    // here was excluded - raising the ceiling, sleeping, retrying, or going
    // back to a median whose blind spot is worse. What would actually fix it
    // changes production code or release policy, which is an owner decision
    // and not this file's to take.
  });

  it("depends on the order of the samples", () => {
    // The exponent is an endpoint measurement over an ORDERED series, so the
    // same four numbers in a different order are a different answer. Growth is
    // a property of the order the sizes were measured in; a rewrite that
    // sorted the timings first would still satisfy every other test here.
    expect(growthExponent([1, 2, 4, 256])).toBeCloseTo(2.666666666667, 10);
    expect(growthExponent([1, 256, 4, 2])).toBeCloseTo(0.333333333333, 10);
  });
});

describe("the scan is near-linear on adversarial input", () => {
  // The shapes that made a previous version quadratic, plus the ones that made
  // the FIRST version of this scanner quadratic. Each must not grow like n^2.
  //
  // TWO DEFECTS IN THIS TEST'S OWN METHOD, both found when CI finally ran it on
  // a machine slower than the one it was written on.
  //
  // It said "measured at 20, 40 and 80KB", and the scanner never saw 80KB:
  // `MAX_SCAN_LENGTH` is 64,000, so the third input was clipped and the last step
  // was a 1.6x increase described as a doubling. The sizes below are all inside
  // that bound, so every step is a real doubling of the text actually read.
  //
  // And the per-step ratio check carried `if (timings[index - 1] < 20) continue`,
  // which skipped the comparison whenever the smallest sample landed under 20ms.
  // On this machine `<password>` repeated at 20KB ran in 18.65ms — just under —
  // so the one ratio that would have caught a real defect was silently dropped,
  // and the suite was green. CI measured 31.88ms for the same input, the check
  // ran, and it failed at 3.81. The escape hatch was hiding a genuine
  // near-quadratic path in `collectOpaqueTokensNearCredentialNouns`, since fixed.
  //
  // So the assertion is the growth EXPONENT across the whole range rather than
  // adjacent ratios with a skip. Over three doublings linear is 1.0 and
  // quadratic is 2.0, nothing can be skipped, and every sample is read.
  //
  // S-018 replaced that exponent with the median of the three adjacent
  // doubling ratios, because on fb3110e this shape measured
  // 12.73 -> 27.75 -> 64.32 -> 301.28ms, exponent 1.522 against the 1.5
  // ceiling, on a ledger-only commit. Audit 48 measured the replacement: a
  // median of three DISCARDS the largest ratio, so super-linear growth
  // confined to the final doubling passes it. That is not a stricter or a
  // looser gate than the exponent, it is a blind one in the direction this
  // test exists to watch, and the audit reproduced it by size-gating the
  // scanner and still getting a green suite. The exponent is authoritative
  // again, and the per-step ratios are kept in the failure detail, where they
  // diagnose without deciding.
  const SHAPES: Array<[string, (size: number) => string]> = [
    ["scheme-like run", (n) => `a${".b".repeat(n / 2)}=value12345`],
    ["identifier run", (n) => `${"A".repeat(n)}_PASSWORD=x`],
    ["repeated colons", (n) => "password:".repeat(Math.floor(n / 9))],
    ["repeated flags", (n) => "--password ".repeat(Math.floor(n / 11))],
    ["repeated tags", (n) => "<password>".repeat(Math.floor(n / 10))],
    ["quotes", (n) => '"'.repeat(n)],
    ["pem prefix", (n) => `-----BEGIN ${"A ".repeat(n / 2)}`],
    // The four shapes that release-rescue-scanner-value-properties.test.ts
    // measured with an adjacent-ratio check at a clipped size (S-014). They are
    // measured here, by the exponent, and the ratio check is gone. Measured on
    // 2026-09-18: 1.25, 1.10, 1.01 and 1.00.
    ["repeated assignments", (n) => "password=".repeat(Math.ceil(n / 9)).slice(0, n)],
    ["repeated flags with values", (n) => "--password x ".repeat(Math.ceil(n / 13)).slice(0, n)],
    ["credential nouns in prose", (n) => "the password is not stored here. ".repeat(Math.ceil(n / 33)).slice(0, n)],
    ["repeated quoted assignments", (n) => 'password="a" '.repeat(Math.ceil(n / 13)).slice(0, n)],
  ];

  // DERIVED from MAX_SCAN_LENGTH rather than written beside it. The previous
  // sizes were literals that had drifted past the bound, which is how the last
  // step came to be a 1.6x increase the comment called a doubling. Derived, they
  // cannot drift again: every step doubles the text the scanner actually reads.
  const SCAN_SIZES = [
    MAX_SCAN_LENGTH / 8,
    MAX_SCAN_LENGTH / 4,
    MAX_SCAN_LENGTH / 2,
    MAX_SCAN_LENGTH,
  ];

  for (const [label, make] of SHAPES) {
    it(`stays linear on ${label}`, () => {
      const inputs = SCAN_SIZES.map(make);

      // Warmed on every input before any of them is timed. Without this the
      // smallest input is the one that pays for JIT compilation, which distorts
      // exactly the sample the growth measurement is most sensitive to.
      for (const input of inputs) redactSecrets(input);

      // Best of three. A single sample under a parallel test runner measures the
      // machine as much as the code, and the fastest run is the one least
      // contaminated by other work — which is what makes this assertion about
      // complexity rather than about load.
      const timings = inputs.map((input) => {
        let best = Number.POSITIVE_INFINITY;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const started = performance.now();
          redactSecrets(input);
          best = Math.min(best, performance.now() - started);
        }
        return best;
      });

      const exponent = growthExponent(timings);
      // Diagnostics only. The per-step ratios say WHERE a failure came from;
      // they decide nothing, and no assertion reads them.
      const ratios = timings.slice(1).map((value, index) => value / timings[index]);
      const detail = `${label}: ${timings.map((t) => t.toFixed(2)).join(" -> ")}ms, ratios ${ratios.map((ratio) => `${ratio.toFixed(2)}x`).join(", ")}, exponent ${exponent.toFixed(3)}`;

      // 1.0 is linear and 2.0 is quadratic over these three real doublings.
      // Decided by `exceedsGrowthCeiling`, the same function the recorded-series
      // table calls, so that table cannot stay green while this verdict changes.
      // The ceiling itself is bracketed there by series that must be accepted
      // and series that must be rejected, so it cannot drift here either.
      expect(exceedsGrowthCeiling(timings), detail).toBe(false);
      // And an absolute ceiling, so "linear but enormous" still fails.
      expect(timings[timings.length - 1], `${label} took ${timings[timings.length - 1]}ms at 64KB`).toBeLessThan(2_000);
    });
  }

  it("measures on sizes that ascend by a real doubling", () => {
    // The exponent divides by the NUMBER of steps and reads only the endpoints,
    // so it means nothing unless every step is one real doubling in ascending
    // order. The sizes are derived from the bound for that reason; this pins
    // the property the derivation is supposed to guarantee.
    expect(SCAN_SIZES).toEqual([8_000, 16_000, 32_000, 64_000]);
    for (let index = 1; index < SCAN_SIZES.length; index += 1) {
      expect(SCAN_SIZES[index] / SCAN_SIZES[index - 1]).toBe(2);
    }
    expect(SCAN_SIZES[SCAN_SIZES.length - 1]).toBe(MAX_SCAN_LENGTH);
  });

  it("gives the timed function a real doubling of text on every shape", () => {
    // The sizes doubling is not enough: a generator can overshoot the bound and
    // have the scan clip it, which is exactly how S-005 and S-014 came to call a
    // 1.6x step a doubling. What has to double is the text actually read.
    //
    // `redactSecrets` reads it in TWO stages and only one of them clips. The
    // detector pass runs its regexes over the whole string; `findCredentialSpans`
    // is the stage bounded by MAX_SCAN_LENGTH. Three shapes overshoot the bound
    // by 11-13 characters at the top size, so their clipped step is 1.99925
    // rather than 2 - 0.04% short, which is why the tolerance here is two
    // decimals rather than exact. Both stages are checked, because a generator
    // that broke either would make the exponent's divisor a lie.
    expect(SHAPES).toHaveLength(11);

    for (const [label, make] of SHAPES) {
      const read = SCAN_SIZES.map((size) => make(size).length);
      const spanScanned = read.map((length) => Math.min(length, MAX_SCAN_LENGTH));

      for (let index = 1; index < read.length; index += 1) {
        expect(read[index] / read[index - 1], `${label} detector pass: ${read.join(", ")}`).toBeCloseTo(2, 2);
        expect(
          spanScanned[index] / spanScanned[index - 1],
          `${label} span scan: ${spanScanned.join(", ")}`,
        ).toBeCloseTo(2, 2);
      }
    }
  });

  it("bounds what it will read at all", () => {
    const { truncated } = findCredentialSpans("a".repeat(MAX_SCAN_LENGTH + 1));

    expect(truncated).toBe(true);
  });

  it("keeps the public intake parser fast on an oversized field", () => {
    // Reachable with no authentication. This was 17 seconds at 160KB.
    const notes = `a${".b".repeat(80_000)}=value12345`;
    const started = performance.now();
    const result = parseRescueIntake({ evidenceNotes: notes });

    expect(performance.now() - started).toBeLessThan(500);
    expect(result.ok).toBe(false);
  });
});

describe("the storage and delivery paths, not just the detector's return value", () => {
  const PLANTED = [
    "REDIS_URL=redis://:S3cretP4ssw0rdHere@cache.prod:6379",
    "ENV NEXTAUTH_SECRET 8f3a9c2b7e1d4f6a0b5c8d9e",
    '<property name="jdbc.password" value="S3cretP4ssw0rdHere"/>',
    "CREATE USER app WITH PASSWORD 'S3cretP4ssw0rdHere';",
    "machine api.example.com login deploy password S3cretP4ssw0rdHere",
  ];

  for (const planted of PLANTED) {
    it(`removes and holds, rather than shipping: ${planted.slice(0, 40)}`, () => {
      // The pipeline now REDACTS at build rather than detecting at validation, so
      // the property is stronger than "the report is refused": the credential is
      // not in the artifact at all, and the report is held rather than delivered.
      const report = buildReleaseRescueReport(
        makeReportInput({
          // The carrier is the reviewer's display name: the one free-text string
          // a report still holds after Option 1. It used to be a finding's
          // `whatWeObserved`, and before that a location excerpt; both are gone,
          // so this is where the scanner still has work to do.
          reviewedBy: {
            operatorUserId: FIXTURE_OPERATOR_ID,
            displayName: `Ops Manager ${planted}`.slice(0, 180),
            reviewedAt: "2026-09-16T10:00:00.000Z",
          },
        }),
      );
      const validation = validateReleaseRescueReport(report);

      expect(JSON.stringify(report), planted).not.toContain("S3cretP4ssw0rdHere");
      expect(JSON.stringify(report)).not.toContain("8f3a9c2b7e1d4f6a0b5c8d9e");
      expect(report.unresolvedHolds.length, "the removal is recorded").toBeGreaterThan(0);
      expect(releaseRescueDeliveryGate(report, validation).deliverable).toBe(false);
    });
  }

  it("finds one nested anywhere in a stored structure", () => {
    // `scanForSecrets` walks whatever it is given. It is defence in depth over
    // free text now rather than the excerpt check it began as, so the path here
    // is a field an auditor writes.
    const hits = scanForSecrets({
      findings: [{ whatWeObserved: "ENV DB_PASSWORD S3cretP4ssw0rdHere" }],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("$.findings[0].whatWeObserved");
    expect(hits[0].classification).toBe("credential_evidence");
  });

  it("removes it from a nested structure when the pipeline handles it", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [
          makeFinding({
            locations: [{ path: "docker-compose.yml", startLine: 4, endLine: 4 }],
          }),
        ],
      }),
    );

    expect(JSON.stringify(report)).not.toContain("S3cretP4ssw0rdHere");
  });

  it("is still idempotent, so a redacted string's hash is reproducible", () => {
    for (const text of PLANTED) {
      const once = redactSecrets(text).redacted;
      expect(redactSecrets(once).redacted).toBe(once);
    }
  });

  it("does not depend on call order", () => {
    const text = "password=abc12345 and API_KEY=def67890";

    expect(redactSecrets(text)).toEqual(redactSecrets(text));
    expect(containsLikelySecret(text)).toBe(true);
  });
});
