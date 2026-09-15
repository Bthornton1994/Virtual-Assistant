import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { findCredentialSpans } from "@/lib/release-rescue-credential-scanner";
import { classifyAssignment, valueShape } from "@/lib/release-rescue-secret-classification";
import { isNonSecretValue } from "@/lib/release-rescue-credential-scanner";

// The scanner, tested along the axis the previous rounds pinned.
//
// `release-rescue-credential-scanner.test.ts` crosses assignment FORM with KEY
// shape and holds the value fixed at `S3cretP4ssw0rdHere` — a value that looks
// like a secret from any angle. Every audit so far attacked the axis the previous
// audit had varied, and audit 5 attacked this one: it kept the forms and the keys
// that already passed, and changed only the value. `DB_PASS=swordfish`,
// `PIN=4821`, `DB_PASSWORD=postgres`. Ten of them shipped.
//
// So this file holds the key fixed at something unmistakable and varies the
// VALUE, across every carrier a credential is written in. The property under
// test is the one the classifier is now built around:
//
//   On a credential-named key in machine syntax, the value has no vote.
//
// A regression that makes any value "look harmless enough" fails here, whatever
// carrier it hides in.

/**
 * Values, chosen so that no shape heuristic could pass this table by accident.
 * `redacted: false` entries are the other half of the property: a control that
 * redacts everything is not a control.
 */
const VALUES: ReadonlyArray<{ label: string; value: string; redacted: boolean }> = [
  // The audit-5 set: ordinary words, which the value-shape gate called prose.
  { label: "dictionary word", value: "swordfish", redacted: true },
  { label: "the default it usually is", value: "postgres", redacted: true },
  { label: "capitalised word", value: "Falcon", redacted: true },
  { label: "two words, quoted", value: "correct horse", redacted: true },
  // Short, where a length floor is the temptation.
  { label: "four-digit PIN", value: "4821", redacted: true },
  { label: "short with a digit", value: "hunter2", redacted: true },
  { label: "short with a symbol", value: "p@ss", redacted: true },
  { label: "exactly the minimum length", value: "abcd", redacted: true },
  // The shapes that always looked like secrets, kept so a fix cannot trade them away.
  { label: "high entropy", value: "Xk92mQvn7LzPr0dQ", redacted: true },
  { label: "entropy behind a word joiner", value: "a-Kx92mQvn7LzPr0dQQ", redacted: true },
  { label: "aws access key id", value: "AKIAIOSFODNN7EXAMPLE", redacted: true },
  { label: "github token", value: "ghp_16C7e42F292c6912E7710c838347Ae178B4a", redacted: true },
  { label: "base64", value: "cGFzc3dvcmQxMjM0NTY3OA==", redacted: true },
  { label: "hex", value: "9f86d081884c7d659a2feaa0c55ad015", redacted: true },
  // Values that are genuinely not credentials. These must survive intact, because
  // a false positive holds a paid report.
  { label: "an env reference", value: "process.env.DB_PASSWORD", redacted: false },
  { label: "a shell variable", value: "${DB_PASSWORD}", redacted: false },
  { label: "an angle-bracket placeholder", value: "<your-password>", redacted: false },
  { label: "an already-redacted marker", value: "[REDACTED]", redacted: false },
  { label: "the word changeme", value: "changeme", redacted: false },
  { label: "a row of asterisks", value: "********", redacted: false },
  { label: "the literal null", value: "null", redacted: false },
];

/**
 * Every carrier the audit named, plus the ones they were examples of. Each takes
 * the key and value and writes the line the way that ecosystem writes it.
 *
 * `quotes` says whether the carrier can hold a value containing a space; a
 * space-bearing value in an unquoted carrier is not a case that exists.
 */
const CARRIERS: ReadonlyArray<{
  label: string;
  quotes: boolean;
  /** Carriers whose key is a fixed keyword of that format, not a name anyone picks. */
  key?: string;
  render: (key: string, value: string) => string;
}> = [
  { label: "env assignment", quotes: false, render: (k, v) => `${k}=${v}` },
  { label: "env assignment, double quoted", quotes: true, render: (k, v) => `${k}="${v}"` },
  { label: "env assignment, single quoted", quotes: true, render: (k, v) => `${k}='${v}'` },
  { label: "env assignment, spaced", quotes: false, render: (k, v) => `${k} = ${v}` },
  { label: "shell export", quotes: false, render: (k, v) => `export ${k}=${v}` },
  { label: "walrus", quotes: false, render: (k, v) => `${k} := ${v}` },
  { label: "fat arrow", quotes: false, render: (k, v) => `${k} => ${v}` },
  { label: "json", quotes: true, render: (k, v) => `{"${k}": "${v}"}` },
  { label: "docker ENV, equals", quotes: false, render: (k, v) => `ENV ${k}=${v}` },
  { label: "docker ENV, spaced", quotes: false, render: (k, v) => `ENV ${k} ${v}` },
  { label: "docker ARG", quotes: false, render: (k, v) => `ARG ${k}=${v}` },
  {
    label: "docker compose environment",
    quotes: false,
    render: (k, v) => `services:\n  db:\n    environment:\n      - ${k}=${v}\n`,
  },
  {
    label: "docker compose environment, quoted",
    quotes: true,
    render: (k, v) => `services:\n  db:\n    environment:\n      ${k}: "${v}"\n`,
  },
  { label: "sql create user", quotes: true, render: (k, v) => `CREATE USER app WITH ${k} '${v}';` },
  { label: "sql alter role", quotes: true, render: (k, v) => `ALTER ROLE app WITH ${k} '${v}';` },
  { label: "cli long flag", quotes: false, render: (k, v) => `mytool --${k} ${v} --verbose` },
  { label: "cli long flag, equals", quotes: false, render: (k, v) => `mytool --${k}=${v}` },
  { label: "xml attribute", quotes: true, render: (k, v) => `<property name="${k}" value="${v}"/>` },
  { label: "xml element", quotes: true, render: (k, v) => `<${k}>${v}</${k}>` },
  { label: "php define", quotes: true, render: (k, v) => `define('${k}', '${v}');` },
  // `.netrc` and `.pgpass` name their own field; substituting DB_PASSWORD there
  // would test a file format that does not exist.
  {
    label: "netrc",
    quotes: false,
    key: "password",
    render: (k, v) => `machine api.example.com login deploy ${k} ${v}`,
  },
  { label: "trailing comment", quotes: false, render: (k, v) => `${k}=${v} # rotate this quarterly` },
  {
    label: "trailing comment that reads as a sentence",
    quotes: false,
    render: (k, v) => `${k}=${v} # this is the value we use in the staging config for now`,
  },
  { label: "leading comment", quotes: false, render: (k, v) => `# staging only\n${k}=${v}` },
  { label: "inside prose", quotes: false, render: (k, v) => `The deploy config sets ${k}=${v} in production.` },
  { label: "yaml", quotes: false, render: (k, v) => `${k}: ${v}` },
  { label: "yaml, quoted", quotes: true, render: (k, v) => `${k}: "${v}"` },
];

/** Carriers where the key is the URL's own userinfo rather than a named field. */
const URL_CARRIERS: ReadonlyArray<{ label: string; render: (value: string) => string }> = [
  { label: "postgres url", render: (v) => `postgres://appuser:${v}@db.internal:5432/app` },
  { label: "redis url", render: (v) => `REDIS_URL=redis://default:${v}@cache.internal:6379/0` },
  { label: "redis url, rediss", render: (v) => `rediss://user:${v}@cache.internal:6379` },
  { label: "amqp url", render: (v) => `amqp://svc:${v}@broker.internal:5672/%2f` },
  { label: "mongodb url", render: (v) => `mongodb://root:${v}@mongo.internal:27017/admin` },
  { label: "https url", render: (v) => `https://deploy:${v}@git.internal/org/repo.git` },
  { label: "empty username", render: (v) => `postgres://:${v}@db.internal:5432/app` },
  { label: "curl user flag", render: (v) => `curl -u admin:${v} https://api.internal/v1/ping` },
  { label: "curl bearer", render: (v) => `curl -H "Authorization: Bearer ${v}" https://api.internal/` },
  { label: "curl basic", render: (v) => `curl -H 'Authorization: Basic ${v}' https://api.internal/` },
  { label: "pgpass line", render: (v) => `db.internal:5432:app:appuser:${v}` },
];

const KEY = "DB_PASSWORD";

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + 1);
  }
  return count;
}

describe("the value has no vote, in any carrier", () => {
  it("redacts every real credential value, and leaves every placeholder alone", () => {
    const leaked: string[] = [];
    const overreached: string[] = [];
    let checked = 0;

    for (const carrier of CARRIERS) {
      for (const entry of VALUES) {
        if (/\s/.test(entry.value) && !carrier.quotes) continue;
        checked += 1;

        const text = carrier.render(carrier.key ?? KEY, entry.value);
        const { redacted } = redactSecrets(text);
        const survived = redacted.includes(entry.value);

        if (entry.redacted && survived) leaked.push(`${carrier.label} / ${entry.label}`);
        if (!entry.redacted && !survived) overreached.push(`${carrier.label} / ${entry.label}`);
      }
    }

    // Guards the loop itself: a skip rule that quietly emptied the table would
    // otherwise report a clean run.
    expect(checked).toBeGreaterThan(400);
    expect(leaked, `${leaked.length} carrier/value combinations leaked the value`).toEqual([]);
    expect(
      overreached,
      `${overreached.length} combinations redacted something that is not a credential`,
    ).toEqual([]);
  });

  it("never downgrades a credential-named assignment below credential_evidence", () => {
    const weak: string[] = [];

    for (const carrier of CARRIERS) {
      for (const entry of VALUES) {
        if (!entry.redacted) continue;
        if (/\s/.test(entry.value) && !carrier.quotes) continue;

        const text = carrier.render(carrier.key ?? KEY, entry.value);
        const { spans } = findCredentialSpans(text);
        const covering = spans.filter(
          (span) => text.slice(span.start, span.end).includes(entry.value.trim()),
        );
        if (covering.length === 0) {
          weak.push(`${carrier.label} / ${entry.label}: no span`);
          continue;
        }
        // yaml's bare colon is the one syntax a sentence can also produce, so it
        // is allowed to land on `ambiguous_secret_candidate` — which still
        // redacts, and still holds the report. Everything else is machine syntax.
        const allowAmbiguous = carrier.label.startsWith("yaml");
        for (const span of covering) {
          const ok =
            span.classification === "credential_evidence" ||
            (allowAmbiguous && span.classification === "ambiguous_secret_candidate");
          if (!ok) weak.push(`${carrier.label} / ${entry.label}: ${span.classification}`);
        }
      }
    }

    expect(weak, `${weak.length} combinations classified below credential evidence`).toEqual([]);
  });

  it("redacts a credential carried in a URL or an auth header, whatever its shape", () => {
    const leaked: string[] = [];

    for (const carrier of URL_CARRIERS) {
      for (const entry of VALUES) {
        // A URL cannot carry a space, an unencoded `@` does not parse as userinfo
        // at all, and the placeholder values are not what a userinfo position is
        // ever legitimately filled with.
        if (!entry.redacted || /\s|@|\$|<|\[|\*/.test(entry.value)) continue;

        const text = carrier.render(entry.value);
        // Counted, not searched: `postgres://appuser:postgres@...` contains the
        // value twice, and only the second one is the credential. A substring
        // test would call a correct redaction a leak.
        const before = occurrences(text, entry.value);
        const after = occurrences(redactSecrets(text).redacted, entry.value);
        if (after >= before) leaked.push(`${carrier.label} / ${entry.label}`);
      }
    }

    expect(leaked, `${leaked.length} URL/auth carriers leaked the credential`).toEqual([]);
  });
});

describe("the rule that the last regression broke, stated directly", () => {
  it("cannot be downgraded by value shape under structured syntax", () => {
    for (const shape of ["opaque", "wordlike"] as const) {
      for (const tail of [true, false]) {
        expect(classifyAssignment("structured", shape, tail)).toBe("credential_evidence");
      }
    }
  });

  it("still refuses to invent a credential out of a placeholder", () => {
    for (const tail of [true, false]) {
      expect(classifyAssignment("structured", "placeholder", tail)).toBe("sensitive_prose");
      expect(classifyAssignment("bare_colon", "placeholder", tail)).toBe("sensitive_prose");
    }
  });

  it("reads a bare colon by value and context, and only a bare colon", () => {
    expect(classifyAssignment("bare_colon", "opaque", true)).toBe("credential_evidence");
    expect(classifyAssignment("bare_colon", "wordlike", true)).toBe("sensitive_prose");
    expect(classifyAssignment("bare_colon", "wordlike", false)).toBe("ambiguous_secret_candidate");
  });

  it("does not let a trailing comment turn an assignment into prose", () => {
    const text = "SECRET=Quicksilver # this is the value that we use for the staging config";
    expect(redactSecrets(text).redacted).not.toContain("Quicksilver");
  });

  it("classifies value shape without consulting the key, which is the whole point", () => {
    expect(valueShape("swordfish", isNonSecretValue)).toBe("wordlike");
    expect(valueShape("Xk92mQvn7Lz", isNonSecretValue)).toBe("opaque");
    expect(valueShape("changeme", isNonSecretValue)).toBe("placeholder");
    // Shape says "wordlike", and the classifier still redacts it. That
    // disagreement is the fix.
    expect(redactSecrets("DB_PASSWORD=swordfish").redacted).not.toContain("swordfish");
  });
});

describe("ordinary security prose survives, because holding a report costs the customer", () => {
  const PROSE = [
    "Password rotation policy is weak: the last rotation was 14 months ago.",
    "Auth: Clerk. Payments: Stripe.",
    "Secrets: managed via environment variables in the deploy pipeline.",
    "The API key is stored in the platform secret store and is not in the repository.",
    "Token expiry: not configured, so sessions do not end.",
    "We reviewed the password reset flow and the token is single use.",
    "Credentials are rotated quarterly and the rotation is logged.",
  ];

  for (const line of PROSE) {
    it(`leaves it exactly as written: ${line.slice(0, 44)}`, () => {
      expect(redactSecrets(line).redacted).toBe(line);
    });
  }
});

describe("the scan stays bounded as the input grows", () => {
  // Wall-clock, so the numbers are generous: the property is that cost grows
  // with size rather than with size squared, and a quadratic scan blows these
  // budgets by orders of magnitude, not by a factor of two.
  const SIZES = [20_000, 40_000, 80_000] as const;

  const SHAPES: ReadonlyArray<{ label: string; fill: (size: number) => string }> = [
    { label: "colons", fill: (n) => "password:".repeat(Math.ceil(n / 9)).slice(0, n) },
    { label: "equals signs", fill: (n) => "password=".repeat(Math.ceil(n / 9)).slice(0, n) },
    { label: "one enormous line of flags", fill: (n) => "--password x ".repeat(Math.ceil(n / 13)).slice(0, n) },
    { label: "credential nouns in prose", fill: (n) => "the password is not stored here. ".repeat(Math.ceil(n / 33)).slice(0, n) },
    { label: "quotes", fill: (n) => 'password="a" '.repeat(Math.ceil(n / 13)).slice(0, n) },
  ];

  for (const shape of SHAPES) {
    it(`stays within budget on ${shape.label}`, () => {
      // Best of five, not one sample. At these magnitudes a 40KB scan takes
      // ~13ms, so one descheduled slice is a third of the measurement and the
      // ratio below crosses its threshold on noise rather than on complexity.
      // The minimum is the run that was not interrupted.
      const timings = SIZES.map((size) => {
        const text = shape.fill(size);
        let best = Infinity;
        for (let run = 0; run < 5; run += 1) {
          const started = performance.now();
          redactSecrets(text);
          best = Math.min(best, performance.now() - started);
        }
        return best;
      });

      for (const elapsed of timings) {
        expect(elapsed, `${shape.label}: ${timings.map((t) => Math.round(t)).join("ms, ")}ms`)
          .toBeLessThan(2_000);
      }

      // Doubling the input must not quadruple the time. Compared against the
      // largest two sizes, where the fixed overhead is smallest. Linear puts
      // this at 2 and quadratic at 4; 3 is the line between them.
      const [, mid, large] = timings;
      if (mid > 5) {
        expect(large / mid, `80KB took ${large.toFixed(1)}ms vs 40KB ${mid.toFixed(1)}ms`)
          .toBeLessThan(3);
      }
    });
  }

  it("refuses rather than half-scans an input past the hard cap", () => {
    const oversized = `DB_PASSWORD=Xk92mQvn7LzPr0dQ\n${"# padding\n".repeat(8_000)}`;
    const result = findCredentialSpans(oversized);
    expect(result.truncated).toBe(true);
  });
});
