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
  buildReleaseRescueReport,
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

  it("does not hard-fail a report carrying that wording", () => {
    // A finding has no field for this wording any more. The reviewer's name is
    // the string a human still types, so that is where the property is asserted:
    // ordinary language containing a credential noun must not hold a report.
    for (const text of PROSE.slice(0, 4)) {
      const report = buildReleaseRescueReport(
        makeReportInput({
          reviewedBy: {
            operatorUserId: "op-1",
            displayName: `Ops Manager — ${text}`.slice(0, 180),
            reviewedAt: "2026-09-16T10:00:00.000Z",
          },
        }),
      );
      const validation = validateReleaseRescueReport(report);

      expect(validation.hardGatePass, text).toBe(true);
      expect(releaseRescueDeliveryGate(report, validation).deliverable, text).toBe(true);
    }
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

describe("nothing credential-named is ever silent", () => {
  // The property the previous round broke. `sensitive_prose` drops the span
  // entirely, so anything classified that way is neither redacted nor held nor
  // reported. On a credential-named key that must never happen, whatever the
  // value looks like and whatever follows it.
  const VALUES = [
    "swordfish", "letmein", "postgres", "butterfly", "Falcon", "Zephyrbolt",
    "4821", "Tr0ub4d", "pr0d-Xk92mQvn7Lz", "a-Kx92mQvn7LzPr0dQQ", "correcthorse",
  ];
  const KEYS = ["DB_PASS", "DB_PASSWORD", "SMTP_PASSWORD", "ADMIN_PW", "PIN", "SECRET"];

  it("classifies every key x value as evidence under a structured assignment", () => {
    const silent: string[] = [];
    for (const key of KEYS) {
      for (const value of VALUES) {
        const result = redactSecrets(`${key}=${value}`);
        if (result.classification !== "credential_evidence" || result.redacted.includes(value)) {
          silent.push(`${key}=${value} -> ${result.classification ?? "SILENT"}`);
        }
      }
    }
    expect(silent, `${silent.length} credential assignments were not treated as evidence`).toEqual([]);
  });

  it("cannot be downgraded by a trailing comment", () => {
    for (const text of [
      "SECRET=Quicksilver # this is the value that we use for the service",
      "DB_PASSWORD=Zephyrbolt and it is the same as the one in the other config",
      "AWS_SECRET_ACCESS_KEY=correcthorse so it is not rotated and we should do that",
    ]) {
      expect(redactSecrets(text).classification, text).toBe("credential_evidence");
    }
  });

  it("cannot be downgraded by a sentence around it", () => {
    const text = "The deploy config sets DB_PASSWORD=swordfish and it is the same as the one in the config";

    expect(redactSecrets(text).classification).toBe("credential_evidence");
    expect(redactSecrets(text).redacted).not.toContain("swordfish");
  });
});

describe("a hold is recorded on the report and cleared by content, not by path", () => {
  const AMBIGUOUS = "password: Zephyrbolt";

  it("records what it removed, as a hash rather than a copy", () => {
    const report = buildReleaseRescueReport(makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${AMBIGUOUS}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }));
    const hold = report.unresolvedHolds.find((entry) => entry.path.startsWith("$.reviewedBy.displayName"));

    expect(hold).toBeDefined();
    expect(hold?.originalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(report)).not.toContain("Zephyrbolt");
  });

  it("refuses delivery while the hold stands", () => {
    const report = buildReleaseRescueReport(makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${AMBIGUOUS}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }));
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(pendingSecretHolds(report).length).toBeGreaterThan(0);
    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("held for human review");
  });

  it("delivers once the exact content is cleared", () => {
    const base = buildReleaseRescueReport(makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${AMBIGUOUS}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }));
    const hold = base.unresolvedHolds[0];
    const cleared = buildReleaseRescueReport(
      makeReportInput({
        limitationCodes: ["customer_excluded_part_of_the_repository"],
        clearedSecretHolds: [
          {
            path: hold.path,
            clearedContentHash: hold.originalHash,
            clearedBy: "ops-manager-1",
            clearedAt: "2026-09-16T09:00:00.000Z",
            reasonCode: "value_is_a_placeholder_not_a_credential",
          },
        ],
      }),
    );

    expect(pendingSecretHolds(cleared)).toEqual([]);
    expect(releaseRescueDeliveryGate(cleared, validateReleaseRescueReport(cleared)).deliverable).toBe(true);
  });

  it("does not let a clearance for other content release this hold", () => {
    // Binding to the path alone let a blanket pre-clearance of speculative paths
    // switch the mechanism off before the content existed.
    const base = buildReleaseRescueReport(makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${AMBIGUOUS}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }));
    const hold = base.unresolvedHolds[0];
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${AMBIGUOUS}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
        clearedSecretHolds: [
          {
            path: hold.path,
            clearedContentHash: "b".repeat(64),
            clearedBy: "ops-manager-1",
            clearedAt: "2026-09-16T09:00:00.000Z",
            reasonCode: "value_is_a_placeholder_not_a_credential",
          },
        ],
      }),
    );

    expect(pendingSecretHolds(report).length).toBeGreaterThan(0);
  });

  it("never lets a clearance release confident credential evidence", () => {
    // The assignment form, not the colon form the tests above use. A confident
    // detection is the one `pendingSecretHolds` refuses to let any human clear,
    // and that refusal is the property under test here.
    const CONFIDENT = "DB_PASSWORD=Zephyrbolt";
    const base = buildReleaseRescueReport(makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${CONFIDENT}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }));
    const hold = base.unresolvedHolds[0];
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: `Ops Manager ${CONFIDENT}`,
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
        clearedSecretHolds: [
          {
            path: hold.path,
            clearedContentHash: hold.originalHash,
            clearedBy: "ops-manager-1",
            clearedAt: "2026-09-16T09:00:00.000Z",
            reasonCode: "value_is_a_placeholder_not_a_credential",
          },
        ],
      }),
    );

    expect(hold.classification).toBe("credential_evidence");
    expect(pendingSecretHolds(report).length).toBeGreaterThan(0);
    expect(releaseRescueDeliveryGate(report, validateReleaseRescueReport(report)).deliverable).toBe(false);
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
    for (const shape of ["placeholder", "opaque", "wordlike"] as const) {
      for (const tail of [true, false]) {
        for (const syntax of ["structured", "bare_colon"] as const) {
          expect(SECRET_CLASSIFICATIONS).toContain(classifyAssignment(syntax, shape, tail));
        }
      }
    }
  });

  it("never returns sensitive_prose for a structured credential assignment", () => {
    // The monotonicity property, checked directly on the decision function.
    for (const shape of ["opaque", "wordlike"] as const) {
      for (const tail of [true, false]) {
        expect(classifyAssignment("structured", shape, tail)).toBe("credential_evidence");
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
