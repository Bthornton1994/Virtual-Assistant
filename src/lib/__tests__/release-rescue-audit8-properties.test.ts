import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { isNonSecretValue, findCredentialSpans } from "@/lib/release-rescue-credential-scanner";
import { keyLooksSecret } from "@/lib/release-rescue-redaction-keys";
import {
  buildReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { releaseRescueFindingV1Schema } from "@/lib/release-rescue-findings";
import {
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

// The eighth audit's diagnosis, as tests.
//
// It found nine blocking defects and seven regressions shipped by the previous
// round's own fixes, and named the architecture behind them: every entry in the
// value allowlist is a SILENT-DROP route. `isNonSecretValue` makes `valueShape`
// return `placeholder`, `classifyAssignment` turns that into `sensitive_prose`,
// and `pushSpan` drops a prose span entirely — not redacted, not held, not
// reported. So each time a false positive was closed by adding an allowlist
// pattern, a class of real credentials went silent.
//
// Three of these suites are the properties that were missing. The fourth is the
// one assertion that matters most and had almost no coverage: the gate.

/** Real credential values, in the shapes that actually occur. */
const REAL_CREDENTIALS = [
  "123456abcdef",
  "1qazXSW",
  "0okmNJI",
  "8675309abcdef",
  "correct.horse.battery.staple",
  "Tr.Ub.Ador.Zephyr",
  "abc.def.ghi",
  "default",
  "swordfish",
  "postgres",
  "hunter2",
  "Xk92mQvn7LzPr0d",
  "AKIAIOSFODNN7EXAMPLE",
  "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
  "P@ssw0rd!",
  "9f86d081884c7d659a2feaa0c55ad015",
];

describe("the value allowlist is a leak surface, so nothing in it may be a guess", () => {
  // The inverse of the property that was being tested. Asking "is `30-day` a
  // secret?" is the wrong question; the question is whether a secret can be
  // SHAPED like `30-day`. It can, and `PGPASSWORD=123456abcdef` shipped.
  it("admits no real credential value", () => {
    const admitted = REAL_CREDENTIALS.filter((value) => isNonSecretValue(value));

    expect(admitted, `${admitted.length} real credential values are on the allowlist`).toEqual([]);
  });

  it("redacts every one of them behind a credential-named key", () => {
    const leaked: string[] = [];

    for (const key of ["DB_PASSWORD", "PGPASSWORD", "PASSPHRASE", "SECRET_KEY", "ACCESSTOKEN"]) {
      for (const value of REAL_CREDENTIALS) {
        if (redactSecrets(`${key}=${value}`).redacted.includes(value)) {
          leaked.push(`${key}=${value}`);
        }
      }
    }

    expect(leaked, `${leaked.length} credential assignments were left intact`).toEqual([]);
  });

  it("still keeps the structural references readable", () => {
    // The allowlist's remaining members are all forms that CANNOT be a literal
    // secret: a variable reference, a placeholder, an already-redacted marker.
    const references = [
      "process.env.DB_PASSWORD",
      "${DB_PASSWORD}",
      "%DB_PASSWORD%",
      "<your-password>",
      "[REDACTED]",
      "changeme",
      "********",
      "null",
      "config.sessionSecret",
    ];

    for (const value of references) {
      expect(redactSecrets(`DB_PASSWORD=${value}`).redacted, value).toContain(value);
    }
  });
});

describe("ordinary identifiers are never confident evidence", () => {
  // Audit 8's point: the credential direction used products while the key-name
  // false-positive direction stayed a hand-picked list of 24 words. Nine ordinary
  // configuration names were confident evidence — and because a confident hold
  // cannot be cleared by any human, each one is a permanent denial of service on
  // a paid report.
  // `authHeader` is NOT here, and that is deliberate. `AUTH_HEADER=Bearer abc123`
  // is a credential and must be caught, so the KEY is credential-bearing by
  // design. What was wrong was redacting `request.headers.get("authorization")`
  // behind it — a call expression, not a literal. The line-level test below is
  // where that property belongs.
  const ORDINARY_KEYS = [
    "SMTP_AUTH", "LDAP_AUTH", "SSO_AUTH", "USER_KEY", "ID_KEY",
    "BOT_HEADER", "MAIL_SIGNATURE", "MAIL_HEADER_FROM", "SESSION_HEADER_NAME",
    "APP_HEADER", "USER_SIGNATURE", "SERVICE_ACCOUNT_EMAIL", "AWS_ACCESS_KEY_ID",
    "DB_PASSWORD_FILE", "SESSION_TIMEOUT", "TOKEN_TTL", "API_BASE_URL",
    "AUTH_PROVIDER", "LOGIN_PATH", "SECRET_MANAGER_HOST", "KEY_ROTATION_ENABLED",
  ];

  it("does not treat any of them as a credential name", () => {
    const wrong = ORDINARY_KEYS.filter((key) => keyLooksSecret(key));

    expect(wrong, `${wrong.length} ordinary identifiers read as credential names`).toEqual([]);
  });

  it("leaves the line they appear on intact", () => {
    const lines = [
      'const authHeader = request.headers.get("authorization");',
      "SERVICE_ACCOUNT_EMAIL=ops@acme.com",
      'MAIL_SIGNATURE="Best regards, the Acme team"',
      "SESSION_HEADER_NAME=x-acme-session",
      "SMTP_AUTH=login",
    ];

    // `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE` is deliberately NOT here. The KEY
    // is now correctly read as a reference rather than a credential, but the
    // VALUE is an AWS key id, which the vendor detectors flag on sight and which
    // does belong in a hold. The key-name assertion above covers the half that
    // was wrong.

    for (const line of lines) {
      expect(redactSecrets(line).classification, line).not.toBe("credential_evidence");
    }
  });

  it("still names the real ones", () => {
    const real = [
      "DB_PASSWORD", "API_KEY", "AWS_SECRET_ACCESS_KEY", "PGPASSWORD", "ACCESSTOKEN",
      "APIACCESSTOKEN", "client_secret", "x-api-key", "AUTH_HEADER", "WEBHOOK_SIGNATURE",
    ];
    const missed = real.filter((key) => !keyLooksSecret(key));

    expect(missed, `${missed.length} real credential names not recognised`).toEqual([]);
  });
});

describe("a record boundary is never crossed", () => {
  // `valueSpan` is the only place in the scanner that reaches past a newline, and
  // nothing tested what it swallowed. An empty `DB_PASSWORD=` consumed the whole
  // of the next line in a committed `.env.example` — a file this product accepts
  // as evidence — and stamped it `credential_evidence`, which no human can clear.
  const EMPTY_KEYS = ["DB_PASSWORD=", "DB_PASSWORD:", "api_key =", "SECRET:", "export TOKEN="];
  const NEXT_LINES = [
    "API_HOST=prod.example.com",
    "db_host: prod.example.com",
    "# the next line is a comment",
    "",
    "---",
    "- name: another entry",
    "DEBUG=true",
  ];

  it("never produces a span over the following record", () => {
    const swallowed: string[] = [];

    for (const key of EMPTY_KEYS) {
      for (const next of NEXT_LINES) {
        const text = `${key}\n${next}\nTRAILING=1`;
        const spans = findCredentialSpans(text).spans;
        for (const span of spans) {
          const covered = text.slice(span.start, span.end);
          if (covered.includes(next.trim()) && next.trim().length > 0) {
            swallowed.push(`${key} ⇒ ${next}`);
          }
        }
      }
    }

    expect(swallowed, `${swallowed.length} empty keys swallowed the next record`).toEqual([]);
  });

  it("still finds a value that genuinely wrapped onto the next line", () => {
    const wrapped = [
      '{\n  "password":\n    "Xk92mQvn7LzPr0d"\n}',
      "db:\n  password:\n    Xk92mQvn7LzPr0d\n",
    ];

    for (const text of wrapped) {
      expect(redactSecrets(text).redacted, text.slice(0, 24)).not.toContain("Xk92mQvn7LzPr0d");
    }
  });
});

describe("the gate, asserted directly, in both directions", () => {
  // Almost every other test asserts a span or a classification. The property that
  // matters to a customer is the gate, and it matters in both directions: a
  // credential must never be deliverable, and an ordinary report must never be
  // undeliverable.
  //
  // The carrier changed with Option 1. It was a location excerpt, then
  // `whatWeObserved`. Both are gone — a finding carries codes and the catalog
  // carries the words — so the honest carrier is the reviewer's display name,
  // the one free-text string a report still holds. Redaction is DEFENCE IN
  // DEPTH on that field and on transient processing; it is no longer what proves
  // a delivered report is safe.

  function reportWithReviewerName(text: string) {
    try {
      return buildReleaseRescueReport(
        makeReportInput({
          findings: [
            makeFinding({
              locations: [{ path: "config/app.env", startLine: 1, endLine: 3 }],
            }),
          ],
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome: "fail",
            rationaleCode: "control_missing_on_a_reachable_path",
          }),
          reviewedBy: {
            operatorUserId: "op-1",
            displayName: text.slice(0, 180),
            reviewedAt: "2026-09-16T10:00:00.000Z",
          },
        }),
      );
    } catch {
      return null;
    }
  }

  it("is a fixture that can actually be delivered", () => {
    // The guard on the guard. An audit found this suite's gate assertions
    // vacuous because the fixture failed validation for every input.
    const clean = reportWithReviewerName("Ops Manager");

    expect(clean).not.toBeNull();
    expect(validateReleaseRescueReport(clean!).hardFailures).toEqual([]);
    expect(releaseRescueDeliveryGate(clean!, validateReleaseRescueReport(clean!)).deliverable).toBe(true);
  });

  it("never delivers a report holding a real credential", () => {
    const delivered: string[] = [];

    for (const key of ["PGPASSWORD", "DB_PASSWORD", "ACCESSTOKEN", "APIACCESSTOKEN", "PASSPHRASE"]) {
      for (const value of REAL_CREDENTIALS) {
        const report = reportWithReviewerName(`${key}=${value}`);
        if (report === null) continue; // refused before an artifact existed
        const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

        if (gate.deliverable && JSON.stringify(report).includes(value)) {
          delivered.push(`${key}=${value}`);
        }
      }
    }

    expect(delivered, `${delivered.length} credentials reached a deliverable report`).toEqual([]);
  });

  it("cannot express them at all in the fields that used to carry them", () => {
    // The stronger statement, and the one that made the previous rounds
    // unnecessary. The excerpt and the five narrative fields are not guarded
    // now; they are absent, and an attempt to send one is refused by name.
    const accepted: string[] = [];

    for (const field of ["excerpt", "whatWeObserved", "recommendation", "title"]) {
      for (const key of ["PGPASSWORD", "DB_PASSWORD", "ACCESSTOKEN"]) {
        for (const value of REAL_CREDENTIALS) {
          const finding = { ...makeFinding(), [field]: `${key}=${value}` };
          if (releaseRescueFindingV1Schema.safeParse(finding).success) {
            accepted.push(`${field}:${key}=${value}`);
          }
        }
      }
    }

    expect(accepted, `${accepted.length} credentials were accepted into a removed field`).toEqual([]);
  });

  it("never makes an ordinary report permanently undeliverable", () => {
    // A `credential_evidence` hold cannot be cleared by any human, so a false
    // positive at that level is not noise — it is a $299 report nobody can send.
    //
    // The list below used to be observations an auditor wrote. Those are gone,
    // so the ordinary content that still passes through the scanner is the
    // reviewer's name and the catalog's own text. Both are checked: names here,
    // the whole catalog in the audit-9 suite.
    const ORDINARY = [
      "Ops Manager",
      "Alex Rivera — Release Manager",
      "Dr. Mei Chen, Head of Engineering",
      "Sam O'Neill (Security Lead)",
      "Tomás Álvarez — Principal Engineer",
    ];
    const bricked: string[] = [];

    for (const name of ORDINARY) {
      const report = reportWithReviewerName(name);
      expect(report, `an ordinary reviewer name was refused: ${name}`).not.toBeNull();
      if (report && pendingSecretHolds(report).some((hold) => hold.classification === "credential_evidence")) {
        bricked.push(name);
      }
    }

    expect(bricked, `${bricked.length} ordinary reviewer names became undeliverable`).toEqual([]);
  });

  it("no longer refuses a pasted line of code, because nothing asks about one", () => {
    // This test INVERTED with Option 1.
    //
    // `const authHeader = request.headers.get("authorization");` was refused by
    // the prose contract, and the previous version of this test recorded that as
    // a deliberate cost: an auditor could not write the sentence. The cost is
    // gone along with the contract — an auditor writes no sentences, so there is
    // nothing to refuse. The line cannot enter a report at all, which is a
    // different and stronger outcome than being refused for its shape.
    const text = 'const authHeader = request.headers.get("authorization");';

    expect(releaseRescueFindingV1Schema.safeParse({ ...makeFinding(), whatWeObserved: text }).success).toBe(false);
    // And the report an auditor does produce is unaffected.
    expect(reportWithReviewerName("Ops Manager")).not.toBeNull();
  });

  it("does not refuse a prospect describing work they have already shipped", () => {
    // Intake keeps its free text and therefore keeps its guard: removing prose
    // from the REPORT does not remove it from the conversation.
    const refused: string[] = [];

    for (const notes of [
      "We fixed the token leak in commit a1b2c3d4e5f6 last week.",
      "The API key check was added in commit 4f9a2b1c8d3e.",
      "Our password reset uses the token from build 7c4d9e2a1b8f as the fix.",
      "Auth: Clerk. Payments: Stripe.",
      "Tokens: 30-day lifetime with no rotation.",
    ]) {
      const result = parseRescueIntake({ evidenceNotes: notes });
      const message = result.ok ? "" : JSON.stringify(result.errors);
      if (message.includes("looks like a credential")) refused.push(notes);
    }

    expect(refused, `${refused.length} ordinary descriptions refused a customer`).toEqual([]);
  });

  it("still refuses one that really carries a credential", () => {
    const result = parseRescueIntake({ evidenceNotes: "PGPASSWORD=123456abcdef" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("looks like a credential");
  });
});
