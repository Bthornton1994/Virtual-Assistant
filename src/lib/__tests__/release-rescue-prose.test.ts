import { describe, expect, it } from "vitest";
import {
  describeQuotedCredentialConstructs,
  findQuotedCredentialConstructs,
  describesWithoutQuoting,
} from "@/lib/release-rescue-prose";
import { CREDENTIAL_CARRIERS, CREDENTIAL_QUALIFIERS } from "@/lib/release-rescue-redaction-keys";

// The second half of the excerpt decision, as tests.
//
// The first half removed the field the system copied source into. An audit then
// measured where customer text lives now: `whatWeObserved` and its neighbours,
// where 30 of 116 generated credential values reached a DELIVERABLE report
// because a prose prefix in front of the assignment changed how the span
// extractor read the value. The same 116 in a bare assignment: 0.
//
// So this suite is about a CONSTRUCT, and every assertion in it is driven from
// the key and the operator. None of it looks at the value — that is the whole
// point, and the property a value-based test could not have.

/** Values chosen to defeat a value-reading rule. None of them is real. */
function credentialCorpus(): string[] {
  const bodies = ["Xk92mQvn7Lz", "hunter2hunter", "AKIAIOSFODNN7EXAMPLE", "9f86d081884c"];
  const values = new Set<string>();

  for (const body of bodies) {
    values.add(body);
    // Mid-value punctuation, which is what defeated the extractor: it stopped at
    // `#` and judged the two characters it had captured a placeholder.
    for (const inner of ["#", "&", "(", ")", ";", "'", '"', " ", "<", ">", "|", "%", "*", ",", "\t"]) {
      values.add(`Ab${inner}${body}`);
      values.add(`${body}${inner}cd`);
    }
    for (const affix of ["-", "_", "$", ".", "--", "//", "#"]) {
      values.add(`${affix}${body}`);
      values.add(`${body}${affix}`);
    }
    values.add(`${body} # rotate quarterly`);
    values.add(`${body} // set by the deploy script`);
    values.add(`"${body}"`);
    values.add(`'${body}'`);
  }
  for (const common of ["password", "secret", "letmein", "qwerty", "changeit", "admin123", ""]) {
    values.add(common);
  }
  return [...values];
}

const CORPUS = credentialCorpus();

/** The ways a single line can spell an assignment. */
const OPERATORS = ["=", " = ", "  =  ", ":=", " := "];

/** The ways an executor wraps one when it writes a sentence around it. */
const WRAPPERS: ReadonlyArray<(line: string) => string> = [
  (line) => line,
  (line) => `The committed configuration contains: ${line}`,
  (line) => `${line} — rotate this before launch.`,
  (line) => `We found this in the deploy file:\n${line}\nIt is committed.`,
  (line) => `    ${line}`,
  (line) => `services:\n  db:\n    ${line}`,
  (line) => `${line} # noted during the review`,
  (line) => `Observed at config/app.env line 4: ${line}`,
];

describe("an observation may not reproduce an assignment, whatever the value", () => {
  it("refuses every value in the corpus, under every operator, inside every wrapper", () => {
    const missed: string[] = [];
    let checked = 0;

    for (const value of CORPUS) {
      if (value.trim().length === 0) continue; // `DB_PASSWORD=` assigns nothing
      for (const operator of OPERATORS) {
        for (const wrap of WRAPPERS) {
          checked += 1;
          const text = wrap(`DB_PASSWORD${operator}${value}`);
          if (describesWithoutQuoting(text)) missed.push(JSON.stringify(text.slice(0, 44)));
        }
      }
    }

    expect(checked).toBeGreaterThan(5000);
    expect(missed, `${missed.length} quoted assignments were not refused`).toEqual([]);
  });

  it("refuses them behind every key the lexicon recognises", () => {
    const missed: string[] = [];
    let checked = 0;

    for (const qualifier of CREDENTIAL_QUALIFIERS) {
      for (const carrier of CREDENTIAL_CARRIERS) {
        for (const key of [
          `${qualifier}_${carrier}`.toUpperCase(),
          `${qualifier}${carrier}`.toUpperCase(),
        ]) {
          checked += 1;
          const text = `The committed configuration contains: ${key}=Ab#Xk92mQvn7Lz in production.`;
          if (describesWithoutQuoting(text)) missed.push(key);
        }
      }
    }

    expect(checked).toBeGreaterThan(500);
    expect(missed, `${missed.length} lexicon keys were not refused in prose`).toEqual([]);
  });

  it("names the construct and the key, and never the value", () => {
    const value = "VICTIM-SECRET-STRING-abc123";
    const message = describeQuotedCredentialConstructs(
      findQuotedCredentialConstructs(`The file contains: DB_PASSWORD=${value}`),
      "findings[0].whatWeObserved",
    );

    expect(message).toContain("findings[0].whatWeObserved");
    expect(message).toContain("DB_PASSWORD");
    expect(message).toContain("assignment");
    expect(message, "a refusal reaches logs").not.toContain(value);
    // And it says what to write instead, because a refusal an auditor cannot act
    // on is a refusal they will route around.
    expect(message).toContain("cite");
  });

  it("refuses a configuration line, a credentialed URL and a private-key block too", () => {
    for (const text of [
      "db_password: hunter2hunter",
      "password: swordfish",
      "apiKey: sk_live_abcdefghijklmnop",
      "The file contains: DB_PASSWORD: hunter2",
      "postgres://appuser:hunter2hunter2@db.internal:5432/app appears in the config.",
      "redis://default:Xk92mQvn7Lz@cache:6379/0",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    ]) {
      expect(describesWithoutQuoting(text), text.slice(0, 40)).toBe(false);
    }
  });
});

describe("and it may still say everything an auditor needs to say", () => {
  // The other direction, as a product. The audit that found the gate test
  // vacuous also named the pinned axis: the credential direction used products
  // while the safe direction used a list somebody typed. A false refusal here is
  // a $299 report nobody can send, which is the more expensive failure of the two.
  const SUBJECTS = [
    "Tokens",
    "Passwords",
    "Secrets",
    "Credentials",
    "API keys",
    "Session keys",
    "The signing secret",
    "The bearer token",
  ];
  const PREDICATES = [
    "have a 30-day lifetime with no rotation.",
    "are stored in the platform secret store, not in the repository.",
    "are assigned literal values in the committed configuration.",
    "are rotated quarterly and the rotation is logged.",
    "are missing on this route, so any caller reaches the record.",
    "are read from the environment at boot and never written to disk.",
  ];

  it("refuses none of the sentences the rubric asks auditors to write", () => {
    const refused: string[] = [];
    let checked = 0;

    for (const subject of SUBJECTS) {
      for (const predicate of PREDICATES) {
        for (const shape of [
          `${subject} ${predicate}`,
          `${subject}: ${predicate}`,
          `${subject.toLowerCase()} ${predicate}`,
        ]) {
          checked += 1;
          if (!describesWithoutQuoting(shape)) refused.push(shape.slice(0, 48));
        }
      }
    }

    expect(checked).toBeGreaterThan(100);
    expect(refused, `${refused.length} ordinary observations were refused`).toEqual([]);
  });

  it("leaves the specific sentences the previous audits protected alone", () => {
    for (const text of [
      "Auth: Clerk. Payments: Stripe.",
      "API keys: managed via environment variables in the deploy pipeline.",
      "Session keys: not configured, so sessions do not end.",
      "The route reads a session token and then loads the record by id without an ownership check.",
      "docker-compose.yml assigns literal values to the DB_PASSWORD and SMTP_PASS settings.",
      "The committed configuration sets ACCESS_TOKEN.",
      "Rotate the value and read it from process.env.API_KEY instead.",
      "The API key check was added in commit 4f9a2b1c8d3e.",
      "SELECT id, password, email\n  ORDER BY id, created_at, name",
      "user id,order date,email\n7,2024-01-01,a@b.com",
      "PORT=3000",
      "SESSION_HEADER_NAME=x-acme-session",
      'const STORAGE_KEY = "delegation-cloud-draft-v2";',
      "DB_PASSWORD=",
      "DB_PASSWORD=\nAPI_HOST=prod.example.com",
    ]) {
      expect(describesWithoutQuoting(text), text.slice(0, 44)).toBe(true);
    }
  });

  it("does not read a comparison as an assignment", () => {
    for (const text of [
      "if (token === expected) return true;",
      "the check asserts password == stored, which is a timing leak",
      "when secret != null the branch is taken",
      "if (apiKey >= minimum) proceed",
      "the handler maps token => user before the ownership check",
    ]) {
      expect(describesWithoutQuoting(text), text.slice(0, 44)).toBe(true);
    }
  });
});

describe("the rule is total and deterministic", () => {
  it("answers the same way twice for every input", () => {
    for (const text of [...CORPUS.slice(0, 60), "DB_PASSWORD=x", "Tokens: 30 days"]) {
      expect(findQuotedCredentialConstructs(text)).toEqual(findQuotedCredentialConstructs(text));
    }
  });

  it("handles empty, huge and structureless input without throwing", () => {
    for (const text of ["", " ", "\n\n\n", "a".repeat(4000), "=".repeat(500), ":".repeat(500)]) {
      expect(() => findQuotedCredentialConstructs(text)).not.toThrow();
    }
  });
});
