import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { isNonSecretValue } from "@/lib/release-rescue-credential-scanner";
import {
  buildReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { makeFinding, makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";

// The ninth audit, as tests.
//
// It found nine real credentials reaching a `deliverable: true` report, eight of
// them admitted by an entry in the value allowlist. Its diagnosis was that the
// corpus guarding that allowlist is sixteen HAND-PICKED values — so it contains
// nothing starting with `-`, `$` or `<`, nothing ending in `(`, no literal
// `password`, and no diceware rooted at a listed word. Eight of the nine
// counterexamples would have been caught by a generator.
//
// This file is that generator, plus the two assertions that matter most: nothing
// real may be SUPPRESSED, and nothing real may be DELIVERABLE.

/**
 * Generated credential values, over the alphabet real secrets are drawn from.
 *
 * The leading and trailing characters are the point. Every allowlist pattern is
 * anchored, so the character at each end decides whether a value falls into it,
 * and that is exactly the axis a hand-written list does not vary.
 */
function generateCredentialValues(): string[] {
  const bodies = [
    "Xk92mQvn7Lz",
    "hunter2hunter",
    "correct.horse.battery.staple",
    "super-horse-staple-rope",
    "AKIAIOSFODNN7EXAMPLE",
    "9f86d081884c7d659",
    "P4ssw0rd",
    "1qazXSW",
    "123456abcdef",
    "aG9yc2ViYXR0ZXJ5",
  ];
  // The characters a generated secret can begin or end with, which is where the
  // anchored allowlist patterns decide.
  const affixes = ["", "-", "_", "$", "<", ">", "*", "x", "X", ".", "%", "(", "["];

  const values = new Set<string>();
  for (const body of bodies) {
    values.add(body);
    for (const affix of affixes) {
      values.add(`${affix}${body}`);
      values.add(`${body}${affix}`);
    }
  }

  // The passwords people actually choose, which are words rather than entropy.
  for (const common of [
    "password", "Password1", "secret", "token", "apikey", "letmein", "qwerty",
    "changeit", "admin123", "welcome1", "monkey", "dragon", "iloveyou", "trustno1",
  ]) {
    values.add(common);
  }

  // Diceware rooted at a word the reference-path allowlist knows, which is the
  // shape that survived two rounds of tightening.
  for (const root of ["window", "vault", "config", "process", "session", "state"]) {
    values.add(`${root}.tiger.canvas.rope`);
    values.add(`${root}.horse.battery`);
  }

  return [...values];
}

const GENERATED = generateCredentialValues();

/**
 * How a value of this shape is actually written.
 *
 * A value carrying syntax characters is quoted in every real config format, and
 * an unquoted `DB_PASSWORD=<Xk92mQvn7Lz` is not a line anyone writes. Quoting
 * these keeps the corpus adversarial about the VALUE without inventing a
 * malformed carrier.
 */
/**
 * The output with every placeholder removed.
 *
 * `[REDACTED:assigned_secret]` contains the substring `secret`, so a naive
 * `includes` check reports a correctly-redacted `DB_PASSWORD=secret` as a leak.
 */
function withoutPlaceholders(text: string): string {
  return text.replace(/\[REDACTED:[a-z_]+\]/g, "");
}

function assign(key: string, value: string): string {
  return /[<>()\[\]]/.test(value) ? `${key}="${value}"` : `${key}=${value}`;
}

const CREDENTIAL_KEYS = [
  "DB_PASSWORD",
  "PGPASSWORD",
  "PASSPHRASE",
  "SECRET_KEY",
  "ACCESSTOKEN",
  "HMAC_KEY",
  "SUPABASE_KEY",
  "JWT_SECRET",
  "API_KEY",
];

describe("no real credential is ever suppressed", () => {
  // The assertion the structural change made possible.
  //
  // Until this round, "we decided this is not a secret" and "we never looked"
  // were the same observable state — nothing. A span classified `sensitive_prose`
  // was dropped, so an allowlist entry that admitted a real credential produced
  // no trace at all, and the only way to find one was to guess the exact value.
  //
  // Spans are now always recorded, and a suppressed one is reported. So this can
  // be asserted directly rather than inferred from an absence.
  it("suppresses none of the generated corpus behind a credential-named key", () => {
    const suppressed: string[] = [];
    let checked = 0;

    for (const key of CREDENTIAL_KEYS) {
      for (const value of GENERATED) {
        checked += 1;
        const result = redactSecrets(assign(key, value));
        // A suppression only matters if the value SURVIVED it. A vendor detector
        // that redacts first leaves `[REDACTED:…]` behind, and the scanner then
        // suppresses that placeholder — correctly, and with nothing at stake.
        if (result.suppressed.length > 0 && withoutPlaceholders(result.redacted).includes(value)) {
          suppressed.push(assign(key, value));
        }
      }
    }

    expect(checked).toBeGreaterThan(2_000);
    expect(suppressed, `${suppressed.length} generated credentials were suppressed`).toEqual([]);
  });

  it("admits none of them to the allowlist directly", () => {
    const admitted = GENERATED.filter((value) => isNonSecretValue(value));

    expect(admitted, `${admitted.length} generated credentials are on the allowlist`).toEqual([]);
  });

  it("redacts every one of them", () => {
    const leaked: string[] = [];

    for (const key of CREDENTIAL_KEYS) {
      for (const value of GENERATED) {
        if (withoutPlaceholders(redactSecrets(assign(key, value)).redacted).includes(value)) {
          leaked.push(assign(key, value));
        }
      }
    }

    expect(leaked, `${leaked.length} generated credentials survived redaction`).toEqual([]);
  });
});

describe("the structural references are still readable, and still reported", () => {
  const REFERENCES = [
    "process.env.DB_PASSWORD",
    "${DB_PASSWORD}",
    "%DB_PASSWORD%",
    "<your-password>",
    "[REDACTED]",
    "changeme",
    "********",
    "null",
    "config.sessionSecret",
    "req.headers.token",
  ];

  it("leaves them in the text", () => {
    for (const value of REFERENCES) {
      expect(redactSecrets(`DB_PASSWORD=${value}`).redacted, value).toContain(value);
    }
  });

  it("reports each one as a suppression rather than as silence", () => {
    // This is what stops the next allowlist entry being a silent leak: a wrong
    // one now OVER-reports, which a test can see.
    for (const value of REFERENCES) {
      const result = redactSecrets(`DB_PASSWORD=${value}`);
      expect(result.suppressed.length, value).toBeGreaterThan(0);
    }
  });
});

describe("the gate, over the generated corpus", () => {
  function reportWith(excerpt: string) {
    return buildReleaseRescueReport(
      makeReportInput({
        findings: [
          makeFinding({
            locations: [{ path: "config/app.env", startLine: 1, endLine: 1, excerpt }],
          }),
        ],
      }),
    );
  }

  it("delivers no report holding any generated credential", () => {
    const delivered: string[] = [];

    // One key, the whole corpus: the per-key axis is covered above and this is
    // the expensive assertion.
    for (const value of GENERATED) {
      const report = reportWith(assign("DB_PASSWORD", value));
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

      if (gate.deliverable && withoutPlaceholders(JSON.stringify(report)).includes(value)) {
        delivered.push(value);
      }
    }

    expect(delivered, `${delivered.length} generated credentials reached a deliverable report`)
      .toEqual([]);
    // Builds and validates a full report per value, so it is slow on purpose:
    // this is the one assertion that speaks for the customer.
  }, 60_000);

  it("bricks no report over ordinary content", () => {
    // A `credential_evidence` hold cannot be cleared by any human, so each false
    // positive at that level is a permanent denial of service on a paid artifact.
    const ORDINARY = [
      "const token = getToken(req);",
      "const token = req.headers.token;",
      "password = get_password(user)",
      "token := fetchToken(ctx)",
      'const authHeader = request.headers.get("authorization");',
      "DB_PASSWORD=\nRotate this before launch.",
      "DB_PASSWORD=\nAPI_HOST=prod.example.com",
      "SELECT id, password, email\n  ORDER BY id, created_at, name",
      "user id,order date,email\n7,2024-01-01,a@b.com",
      "const cacheKey = `${userId}:${tenantId}`;",
    ];
    const bricked: string[] = [];

    for (const excerpt of ORDINARY) {
      const report = reportWith(excerpt);
      if (pendingSecretHolds(report).some((hold) => hold.classification === "credential_evidence")) {
        bricked.push(excerpt.slice(0, 44));
      }
    }

    expect(bricked, `${bricked.length} ordinary excerpts became permanently undeliverable`)
      .toEqual([]);
  });
});
