import { describe, expect, it } from "vitest";
import { containsLikelySecret, redactSecrets, scanForSecrets } from "@/lib/release-rescue-redaction";
import { findCredentialSpans, MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import { buildReleaseRescueReport, releaseRescueDeliveryGate, validateReleaseRescueReport } from "@/lib/release-rescue-report";
import {
  FIXTURE_OPERATOR_ID, makeFinding, makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import {
  exceedsGrowthCeiling,
  growthExponent,
  MAX_GROWTH_EXPONENT,
  SCAN_SIZES,
  TIMED_SHAPES as SHAPES,
} from "@/lib/__tests__/release-rescue-growth-gate";

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

// The growth estimator, `exceedsGrowthCeiling`, and the timed inputs live in
// `release-rescue-growth-gate.ts`. This file tests them WITHOUT a clock, as part
// of `npm test`. The wall-clock measurement that reads them is the advisory
// timing observation, `release-rescue-scanner.timing-observation.ts`, which
// does not block a release (DECISION_LOG.md § D-019). The release gate on the
// scan's cost is the counted work in `release-rescue-scan-work.test.ts` and
// `release-rescue-scan-block-work.test.ts`.

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
    //
    // The owner took it as D-019: this wall-clock gate no longer blocks a
    // release. It runs as the advisory `timing-observation` check, where a
    // series like this one fails visibly without blocking, and the release
    // gate on the scan's cost is counted work rather than elapsed time. The
    // ceiling is unchanged, so this series is still rejected.
  });

  it("treats an unmeasurable series as over the ceiling, not under it", () => {
    // Three ways the arithmetic can stop producing a number, and what the gate
    // must say about each. None of these is a scan that ran within budget.
    expect(growthExponent([0, 0, 0, 0])).toBeNaN();
    expect(exceedsGrowthCeiling([0, 0, 0, 0])).toBe(true);

    expect(growthExponent([0, 1, 2, 4])).toBe(Number.POSITIVE_INFINITY);
    expect(exceedsGrowthCeiling([0, 1, 2, 4])).toBe(true);

    expect(growthExponent([1, 2, 4, 0])).toBe(Number.NEGATIVE_INFINITY);
    expect(exceedsGrowthCeiling([1, 2, 4, 0])).toBe(true);
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
  // the FIRST version of this scanner quadratic (`TIMED_SHAPES`). How this
  // measurement came to be what it is, S-005 to S-018 and Audit 48, is written
  // down beside the measurement, in the timing observation.
  //
  // THE TIMING ITSELF MOVED. The eleven `stays linear on <shape>` measurements
  // and their 2,000ms absolute ceiling read the clock, so under D-019 they run
  // in `release-rescue-scanner.timing-observation.ts`, the advisory check,
  // unchanged. What stays here is everything about them that needs no clock:
  // the sizes are a real doubling, and so is the text each shape produces.

  it("measures on sizes that ascend by a real doubling", () => {
    // The exponent divides by the NUMBER of steps and reads only the endpoints,
    // so it means nothing unless every step is one real doubling in ascending
    // order. The sizes are derived from the bound for that reason; this pins
    // the property the derivation is supposed to guarantee.
    // Properties, not literals. Writing [8_000, 16_000, 32_000, 64_000] here
    // would re-couple the test to the numbers the derivation from
    // MAX_SCAN_LENGTH exists to stop drifting, and would fail for the wrong
    // reason if that bound ever legitimately changed.
    expect(SCAN_SIZES).toHaveLength(4);
    for (let index = 1; index < SCAN_SIZES.length; index += 1) {
      expect(SCAN_SIZES[index] / SCAN_SIZES[index - 1]).toBe(2);
      expect(Number.isInteger(SCAN_SIZES[index])).toBe(true);
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
    //
    // Those same three shapes pay something the other eight do not: crossing
    // the bound makes `findCredentialSpans` take a 64,000-character slice, so
    // the copy lands on the LAST sample only - the numerator of the exponent.
    // It biases those three UPWARD, against the change, which is the safe
    // direction for a gate and the reason it is recorded here rather than
    // corrected for.
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
