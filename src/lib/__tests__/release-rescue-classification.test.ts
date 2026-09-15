import { describe, expect, it } from "vitest";
import { redactSecrets, scanForSecrets } from "@/lib/release-rescue-redaction";
import { keyLooksSecret } from "@/lib/release-rescue-redaction-keys";
import {
  SECRET_CLASSIFICATIONS,
  blocksDelivery,
  classifyAssignment,
  requiresHumanClearance,
  strongerClassification,
} from "@/lib/release-rescue-secret-classification";
import {
  assembleReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

// Detection and prose sensitivity, as three outcomes rather than one boolean.
//
// A boolean was wrong in both directions at once. `DB_PASS=pr0d-Xk92mQvn7Lz`
// shipped; "Password: rotation policy is weak" — the ordinary wording of a real
// finding — refused the deliverable, and the same rule rejected a customer
// describing their stack on the public intake form.
//
// These tests are generated across the axes an audit actually varies, not
// written as the examples that were missed.

const KEY_STEMS = ["PASSWORD", "PASS", "PW", "SECRET", "TOKEN", "APIKEY", "PASSPHRASE"];
const PREFIXES = ["", "DB_", "SMTP_", "ADMIN_", "PROD_", "NEXT_PUBLIC_"];
const SUFFIXES = ["", "_PROD", "_LIVE", "_1"];
const CASINGS: Array<(key: string) => string> = [
  (key) => key,
  (key) => key.toLowerCase(),
  (key) => key.toLowerCase().replace(/_(.)/g, (_, c: string) => c.toUpperCase()),
  (key) => key.toLowerCase().replace(/_/g, "-"),
  (key) => key.toLowerCase().replace(/_/g, "."),
];
/** A value that no reasonable classifier should read as an English word. */
const SECRET_VALUE = "pr0d-Xk92mQvn7Lz";

describe("a credential-named key is credential-named in every form", () => {
  it("matches across prefix x suffix x casing", () => {
    const missed: string[] = [];
    for (const stem of KEY_STEMS) {
      for (const prefix of PREFIXES) {
        for (const suffix of SUFFIXES) {
          for (const casing of CASINGS) {
            const key = casing(`${prefix}${stem}${suffix}`);
            if (!keyLooksSecret(key)) missed.push(key);
          }
        }
      }
    }
    expect([...new Set(missed)], `${missed.length} key forms were not recognised`).toEqual([]);
  });

  it("still leaves lookalikes alone, which is why segments and not substrings", () => {
    for (const key of [
      "bypass", "compass", "surpass", "encompass", "passenger", "passport", "password_checker".replace("password", "bypass"),
      "cacheKey", "sortKey", "authProvider", "tokenizer", "monkeys", "authorName",
    ]) {
      expect(keyLooksSecret(key), key).toBe(false);
    }
  });

  it("recognises a generated qualifier/carrier pair, not a hand-listed one", () => {
    // AUTH_HEADER was missed because `auth` alone is too broad, `header` alone is
    // meaningless, and the pair was simply not typed out. The set is a cross
    // product now, so a qualifier covers every carrier at once.
    for (const key of [
      "AUTH_HEADER", "API_SIGNATURE", "REGISTRY_PASSWORD", "SMTP_CREDENTIALS",
      "SSH_KEY", "OAUTH_TOKEN", "ADMIN_PW", "DATABASE_SECRET",
    ]) {
      expect(keyLooksSecret(key), key).toBe(true);
    }
  });
});

describe("credential syntax is credential_evidence in every syntax the audit named", () => {
  const FORMS: Array<[string, string]> = [
    ["env", `DB_PASS=${SECRET_VALUE}`],
    ["env smtp", `SMTP_PASS=${SECRET_VALUE}`],
    ["env pw", `ADMIN_PW=${SECRET_VALUE}`],
    ["php define", `define('DB_PASSWORD', '${SECRET_VALUE}');`],
    ["mysql attached flag", `mysql -uroot -p${SECRET_VALUE} db`],
    ["pgpass", `db.example.com:5432:appdb:appuser:${SECRET_VALUE}`],
    ["docker compose quoted", `      - "DB_PASSWORD=${SECRET_VALUE}"`],
    ["docker compose yaml", `    DB_PASS: '${SECRET_VALUE}'`],
    ["gitlab ci", `  DB_PASS: ${SECRET_VALUE}`],
    ["redis empty user", `REDIS_URL=redis://:${SECRET_VALUE}@cache:6379`],
    ["dockerfile env", `ENV DB_PASSWORD ${SECRET_VALUE}`],
    ["sql", `CREATE USER app WITH PASSWORD '${SECRET_VALUE}';`],
    ["cli long flag", `psql --password ${SECRET_VALUE} -h db`],
    ["netrc", `machine api.example.com login deploy password ${SECRET_VALUE}`],
    ["curl", `curl -u admin:${SECRET_VALUE} https://api.example.com`],
    ["xml attribute", `<property name="jdbc.password" value="${SECRET_VALUE}"/>`],
    ["xml element", `<password>${SECRET_VALUE}</password>`],
    ["short bare", "password=Tr0ub4d"],
    ["yaml block", `db_password: |\n  ${SECRET_VALUE}`],
    ["csv", `user,password\nadmin,${SECRET_VALUE}`],
    ["json", `"password": "${SECRET_VALUE}"`],
    ["after prose", `The deploy config sets DB_PASS=${SECRET_VALUE} in production.`],
  ];

  for (const [label, text] of FORMS) {
    it(`classifies ${label} as credential_evidence`, () => {
      const result = redactSecrets(text);
      expect(result.classification, text).toBe("credential_evidence");
      expect(result.redacted).not.toContain(SECRET_VALUE);
      expect(result.redacted).not.toContain("Tr0ub4d");
    });
  }
});

describe("ordinary audit prose stays readable and does not hold anything", () => {
  const PROSE = [
    "Password: rotation policy is weak and should be tightened.",
    "Authorization: object-level checks are missing on three routes.",
    "Secrets: managed via environment variables in the deploy pipeline.",
    "Token: refresh logic is missing so sessions never expire.",
    "Credentials: none are present in the repository as far as we could see.",
    "API key: rotation is manual today and should be automated.",
    "The password rotation policy is weak and should be reviewed.",
    "Passwords are stored using bcrypt with a work factor of 12.",
    "See the secret management section of the README for details.",
    "const apiKey = process.env.API_KEY;",
    "password = changeme",
    "api_key: ${API_KEY}",
    "client_secret: <your-client-secret>",
  ];

  for (const text of PROSE) {
    it(`leaves alone: ${text.slice(0, 50)}`, () => {
      const result = redactSecrets(text);
      expect(result.classification, text).toBeNull();
      expect(result.redacted).toBe(text);
    });
  }

  it("does not hard-fail a report whose finding is worded that way", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({ limitations: ["Authorization: object-level checks are missing on three routes."] }),
    );
    const validation = validateReleaseRescueReport(report);

    expect(validation.hardGatePass).toBe(true);
    expect(releaseRescueDeliveryGate(report, validation).deliverable).toBe(true);
  });

  it("does not reject valid security language on the public intake form", () => {
    for (const notes of [
      "Auth: Clerk. Payments: Stripe. Database: Neon.",
      "Password: rotation is manual today.",
      "The repo has a token, a webhook, and a cron job.",
      "Secrets: managed via environment variables.",
    ]) {
      const result = parseRescueIntake({ evidenceNotes: notes });
      const message = result.ok ? "" : JSON.stringify(result.errors);
      expect(message, notes).not.toContain("looks like a credential");
    }
  });

  it("still rejects a real credential on that form", () => {
    const result = parseRescueIntake({ evidenceNotes: `DB_PASS=${SECRET_VALUE}` });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("looks like a credential");
  });
});

describe("an ambiguous candidate is held, never silently delivered", () => {
  // A value that is neither obviously generated nor obviously a word: no
  // sentence around it, no entropy signature.
  const AMBIGUOUS = "password: Zephyrbolt";

  it("classifies it as ambiguous rather than either extreme", () => {
    expect(redactSecrets(AMBIGUOUS).classification).toBe("ambiguous_secret_candidate");
  });

  it("redacts it for safety even though it does not hard-fail", () => {
    const result = redactSecrets(AMBIGUOUS);

    expect(result.redacted).not.toContain("Zephyrbolt");
  });

  it("does not hard-fail validation, but refuses delivery until cleared", () => {
    const report = assembleReleaseRescueReport(makeReportInput({ limitations: [AMBIGUOUS] }));
    const validation = validateReleaseRescueReport(report);
    const gate = releaseRescueDeliveryGate(report, validation);

    expect(validation.hardGatePass, "an ambiguous candidate is not a validation failure").toBe(true);
    expect(gate.deliverable, "but it is not deliverable either").toBe(false);
    expect(gate.blockers.join(" ")).toContain("held for human review");
  });

  it("records the reason in a form the customer can be shown", () => {
    const report = assembleReleaseRescueReport(makeReportInput({ limitations: [AMBIGUOUS] }));
    const holds = pendingSecretHolds(report);

    expect(holds).toHaveLength(1);
    expect(holds[0].classification).toBe("ambiguous_secret_candidate");
    expect(holds[0].reason).toContain("needs a human decision");
    expect(holds[0].path).toMatch(/^\$\.limitations\[\d+\]$/);
  });

  it("delivers once a named human clears that exact path", () => {
    const base = assembleReleaseRescueReport(makeReportInput({ limitations: [AMBIGUOUS] }));
    const [hold] = pendingSecretHolds(base);
    const cleared = assembleReleaseRescueReport(
      makeReportInput({
        limitations: [AMBIGUOUS],
        clearedSecretHolds: [
          {
            path: hold.path,
            clearedBy: "ops-manager-1",
            clearedAt: "2026-09-16T09:00:00.000Z",
            rationale: "Reviewed the source line; it is a product name, not a credential.",
          },
        ],
      }),
    );
    const gate = releaseRescueDeliveryGate(cleared, validateReleaseRescueReport(cleared));

    expect(pendingSecretHolds(cleared)).toEqual([]);
    expect(gate.deliverable).toBe(true);
  });

  it("does not let a clearance for one path release another", () => {
    const report = assembleReleaseRescueReport(
      makeReportInput({
        limitations: [AMBIGUOUS],
        clearedSecretHolds: [
          {
            path: "$.some.other.path",
            clearedBy: "ops-manager-1",
            clearedAt: "2026-09-16T09:00:00.000Z",
            rationale: "Unrelated.",
          },
        ],
      }),
    );

    expect(pendingSecretHolds(report)).toHaveLength(1);
    expect(releaseRescueDeliveryGate(report, validateReleaseRescueReport(report)).deliverable).toBe(false);
  });

  it("a credential is NOT clearable this way", () => {
    // Clearing is for uncertainty, not for overriding a confident detection.
    const report = assembleReleaseRescueReport(
      makeReportInput({
        limitations: [`DB_PASS=${SECRET_VALUE}`],
        clearedSecretHolds: [
          {
            path: "$.limitations[3]",
            clearedBy: "ops-manager-1",
            clearedAt: "2026-09-16T09:00:00.000Z",
            rationale: "Looks fine to me.",
          },
        ],
      }),
    );

    expect(validateReleaseRescueReport(report).hardGatePass).toBe(false);
  });
});

describe("the classification model itself", () => {
  it("has a total precedence order", () => {
    for (const a of SECRET_CLASSIFICATIONS) {
      for (const b of SECRET_CLASSIFICATIONS) {
        const winner = strongerClassification(a, b);
        expect([a, b]).toContain(winner);
        expect(strongerClassification(b, a), `${a}/${b} must not depend on order`).toBe(winner);
      }
    }
  });

  it("gives exactly one classification the authority to block, and one to hold", () => {
    expect(SECRET_CLASSIFICATIONS.filter(blocksDelivery)).toEqual(["credential_evidence"]);
    expect(SECRET_CLASSIFICATIONS.filter(requiresHumanClearance)).toEqual(["ambiguous_secret_candidate"]);
  });

  it("is total over every shape and context combination", () => {
    for (const shape of ["placeholder", "prose", "ambiguous", "credential"] as const) {
      for (const tail of [true, false]) {
        expect(SECRET_CLASSIFICATIONS).toContain(classifyAssignment(shape, tail));
      }
    }
  });

  it("reports the strongest classification when a string holds several", () => {
    const mixed = `password: Zephyrbolt and DB_PASS=${SECRET_VALUE}`;

    expect(redactSecrets(mixed).classification).toBe("credential_evidence");
  });

  it("carries the classification through a nested scan", () => {
    const hits = scanForSecrets({ findings: [{ excerpt: `DB_PASS=${SECRET_VALUE}` }] });

    expect(hits[0].classification).toBe("credential_evidence");
  });
});
