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
  // adjacent ratios with a skip. Over three doublings, linear is 1.0 and
  // quadratic is 2.0; one noisy sample moves the exponent by a fraction where it
  // could flip a single adjacent ratio outright, and nothing can be skipped.
  const SHAPES: Array<[string, (size: number) => string]> = [
    ["scheme-like run", (n) => `a${".b".repeat(n / 2)}=value12345`],
    ["identifier run", (n) => `${"A".repeat(n)}_PASSWORD=x`],
    ["repeated colons", (n) => "password:".repeat(Math.floor(n / 9))],
    ["repeated flags", (n) => "--password ".repeat(Math.floor(n / 11))],
    ["repeated tags", (n) => "<password>".repeat(Math.floor(n / 10))],
    ["quotes", (n) => '"'.repeat(n)],
    ["pem prefix", (n) => `-----BEGIN ${"A ".repeat(n / 2)}`],
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

      const doublings = SCAN_SIZES.length - 1;
      const exponent = Math.log2(timings[doublings] / timings[0]) / doublings;
      const detail = `${label}: ${timings.map((t) => t.toFixed(2)).join(" -> ")}ms, exponent ${exponent.toFixed(3)}`;

      // 1.0 is linear and 2.0 is quadratic. 1.5 sits between them with room for a
      // noisy machine on either side, and every shape here measures at or below
      // 1.13 once the line index is built once instead of per word.
      expect(exponent, detail).toBeLessThan(1.5);
      // And an absolute ceiling, so "linear but enormous" still fails.
      expect(timings[doublings], `${label} took ${timings[doublings]}ms at 64KB`).toBeLessThan(2_000);
    });
  }

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
