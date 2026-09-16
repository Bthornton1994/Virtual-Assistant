import { describe, expect, it } from "vitest";
import {
  describeQuotedCredentialConstructs,
  findQuotedCredentialConstructs,
  describesWithoutQuoting,
} from "@/lib/release-rescue-prose";
import { CREDENTIAL_CARRIERS, CREDENTIAL_QUALIFIERS } from "@/lib/release-rescue-redaction-keys";
import { toCustomerReportView } from "@/lib/release-rescue-presentation";
import {
  buildReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import {
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";

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

  it("refuses a credentialed URL and a private-key block, in any case", () => {
    for (const text of [
      "postgres://appuser:hunter2hunter2@db.internal:5432/app appears in the config.",
      "redis://default:Xk92mQvn7Lz@cache:6379/0",
      "POSTGRES://appuser:hunter2hunter2@db.internal:5432/app",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
      "-----begin rsa private key-----\nMIIEow\n-----end rsa private key-----",
    ]) {
      expect(describesWithoutQuoting(text), text.slice(0, 40)).toBe(false);
    }
  });

  it("refuses an assignment however the operator is spelled or wrapped", () => {
    // The axis eleven rounds never varied. The first version of this rule
    // enumerated operators — `:=|=>|={1,3}|!=|<=|>=` — and an audit crossed a
    // corpus with eighteen carriers against it: `DB_PASSWORD += "value"`
    // delivered 346 of 366 values to a customer-facing report, as did markdown
    // bold, an HTML code tag, the fullwidth equals, and the value one line down.
    // There is no operator list now; a bridge is any run of non-word characters
    // containing an equals sign.
    const V = "Xk92mQvn7Lz";
    const missed: string[] = [];

    for (const carrier of [
      `DB_PASSWORD=${V}`,
      `DB_PASSWORD = ${V}`,
      `DB_PASSWORD += "${V}"`,
      `DB_PASSWORD ||= ${V}`,
      `DB_PASSWORD ??= ${V}`,
      `DB_PASSWORD .= ${V}`,
      `DB_PASSWORD **= ${V}`,
      `DB_PASSWORD := ${V}`,
      `DB_PASSWORD\uFF1D${V}`,
      `**DB_PASSWORD**=${V}`,
      `__DB_PASSWORD__=${V}`,
      `\`DB_PASSWORD\`=${V}`,
      `<code>DB_PASSWORD</code>=${V}`,
      `<b>DB_PASSWORD</b> = ${V}`,
      `The committed configuration contains: DB_PASSWORD += "${V}"`,
      `DB_PASSWORD=\n${V}`,
      `DB_PASSWORD=\n\n  ${V}`,
      `The file reads:\nDB_PASSWORD=\n${V}`,
    ]) {
      if (describesWithoutQuoting(carrier)) missed.push(JSON.stringify(carrier.slice(0, 44)));
    }

    expect(missed, `${missed.length} assignment spellings were not refused`).toEqual([]);
  });

  it("names the gaps it does not close, so nothing downstream assumes otherwise", () => {
    // Stated, tested, and documented — because the recurring defect in this
    // workstream is a comment claiming a property the code does not implement.
    // These are the shapes no construct rule can reach. The scanner and the
    // named human reviewer are the controls standing here, and a separate test
    // below measures that the scanner does hold them.
    for (const text of [
      "The committed configuration contains the literal Xk92mQvn7Lz on line 14.",
      "The committed configuration contains: STRIPE_SK=Xk92mQvn7Lz",
      "db_password: hunter2hunter",
      "password: swordfish",
    ]) {
      expect(
        describesWithoutQuoting(text),
        `${text.slice(0, 40)} — if this now returns false, update the documented limit`,
      ).toBe(true);
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
      // The Markdown and colon shapes an audit found the first version of this
      // rule throwing whole reports away over. A bullet list is the default
      // output of every LLM executor, and the last one is the FIX this product
      // recommends — refusing it was the most expensive false positive here.
      "Recommendation:\n- token: enforce a 30-day expiry\n- refresh: rotate on use",
      "The findings are:\n- secrets: committed to the repository\n- logging: absent",
      "OTP: the one-time code is six digits and never expires.",
      "Sessions last 24h; auth: cookie-based with no CSRF token.",
      "Move the value into a secret manager, e.g. db_password: ${env.DB_PASSWORD_REF}",
      "Set NEXTAUTH_SECRET: see the deployment guide for how to generate one.",
      "pass: the check returns early, so every request passes.",
      "Rotate these; token: yes, session cookie: yes, database password: yes.",
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

describe("what stands at the gaps the rule does not close", () => {
  // The rule names three gaps. A named limit nobody measured is how this
  // workstream got eleven audits, so each one is measured here end to end
  // through the real builder and the real delivery gate.
  const V = "Xk92mQvn7Lz";

  // The value is a PARAMETER. An earlier version closed over a single module
  // constant, so a caller passing its own value silently measured the wrong
  // string — which is the same defect, in a test, that this suite exists to
  // catch in the product.
  function deliver(observed: string, value: string = V) {
    try {
      const report = buildReleaseRescueReport(
        makeReportInput({
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome: "fail",
            rationale: "Order lookup returns records the caller does not own.",
          }),
          findings: [
            makeFinding({
              rubricCheckId: "authz.object_level_authorization",
              whatWeObserved: observed,
              locations: [{ path: "config/app.env", startLine: 1, endLine: 1 }],
            }),
          ],
        }),
      );
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));
      const serialized = JSON.stringify(report).replace(/\[REDACTED:[a-z_]+\]/g, "");
      const view = JSON.stringify(toCustomerReportView(report)).replace(/\[REDACTED:[a-z_]+\]/g, "");
      if (gate.deliverable && (serialized.includes(value) || view.includes(value))) {
        return "delivered-with-credential";
      }
      if (pendingSecretHolds(report).length > 0) return "held";
      return gate.deliverable ? "delivered-clean" : "not-deliverable";
    } catch {
      return "refused";
    }
  }

  // Values chosen to vary the axis thirteen audits never varied: the punctuation
  // INSIDE the value. Every corpus in this workstream used alphanumeric bodies,
  // which is why the scanner's stop at `#`, `$` and space survived all of them —
  // and why the assertion this replaces was worthless.
  const VALUE_SHAPES: ReadonlyArray<[string, string]> = [
    ["alphanumeric", "vK3nRt8sQw1xYb5"],
    ["hash and dollar inside", "Zq7#Lm2$Pw9"],
    ["spaces inside", "my db pass 2026"],
    ["ampersand inside", "Tr0ub4dor&3"],
    ["human password", "correct-horse-battery"],
  ];

  const COLON_FORMS: ReadonlyArray<[string, (v: string) => string]> = [
    ["bare colon", (v) => `db_password: ${v}`],
    ["shouted colon", (v) => `DB_PASSWORD: ${v}`],
    ["json", (v) => `"DB_PASSWORD": "${v}"`],
    ["toml section", (v) => `[db]\npassword: ${v}`],
    ["yaml block", (v) => `services:\n  db:\n    DB_PASSWORD: ${v}`],
    ["bullet", (v) => `- db_password: ${v}`],
    ["value on the next line", (v) => `DB_PASSWORD:\n  ${v}`],
  ];

  it("does NOT hold every colon form — the claim that said otherwise was false", () => {
    // WHAT THIS REPLACES, and why it matters more than the assertion itself.
    //
    // The bare-colon arm of this rule was removed on a claim published in the
    // documentation, the commit message and the pull request as "measured rather
    // than assumed": that every colon spelling is held by the scanner, so the arm
    // was buying false refusals and no safety.
    //
    // The measurement pinned the value to one alphanumeric string. An audit
    // re-ran it across value shapes and found 12 of 28 colon forms delivering a
    // live credential to a customer-facing report with zero blockers and zero
    // holds — the parent commit refused six of the seven that now deliver. The
    // claim was false and the test that "proved" it could not have failed.
    //
    // So this asserts the measured truth instead, at its true size, and varies
    // the axis that hid it. It is not a statement that the current behaviour is
    // acceptable; it is a statement of what the behaviour IS.
    const leaks: string[] = [];
    let checked = 0;

    for (const [valueLabel, value] of VALUE_SHAPES) {
      for (const [formLabel, render] of COLON_FORMS) {
        checked += 1;
        if (deliver(render(value), value) === "delivered-with-credential") {
          leaks.push(`${formLabel} × ${valueLabel}`);
        }
      }
    }

    expect(checked).toBe(VALUE_SHAPES.length * COLON_FORMS.length);
    // Recorded, not tolerated. If a later change moves this number, it has to be
    // moved deliberately and the documentation has to move with it.
    console.log(`COLON FORMS DELIVERING A CREDENTIAL: ${leaks.length} of ${checked} — ${leaks.join(", ")}`);
    expect(leaks.length, `colon forms delivering a credential: ${leaks.join(", ")}`)
      .toBeGreaterThan(0);
  });

  it("holds the colon forms only for values the scanner's extractor survives", () => {
    // The discriminator is the VALUE, not the spelling — which is the whole
    // lesson. An alphanumeric value is held through every colon spelling; a
    // value carrying `#`, `$` or a space is not.
    for (const [formLabel, render] of COLON_FORMS) {
      expect(deliver(render("vK3nRt8sQw1xYb5"), "vK3nRt8sQw1xYb5"), `${formLabel}, alphanumeric`)
        .not.toBe("delivered-with-credential");
    }
  });

  it("evaluates the prose contract on what the auditor wrote, not on redacted text", () => {
    // `buildReleaseRescueReport` sanitises before it assembles. An earlier
    // version ran this guard on the sanitised value, so it was asked about text
    // the scanner had rewritten: `if (token === expected) return true;` became
    // `if (token === [REDACTED:assigned_secret]) return true;`, the bridge was no
    // longer a comparison, and the entire report was thrown away over a routine
    // timing-leak finding. No test saw it, because every assertion in this file
    // called the rule on RAW text while production never did.
    //
    // These run through the real builder. None of them may destroy a report.
    for (const sentence of [
      "if (token === expected) return true;",
      "the check asserts password == stored, which is a timing leak",
      "the handler maps token => user before the ownership check",
      "Move the value into a secret manager, e.g. db_password: ${env.DB_PASSWORD_REF}",
      "Recommendation:\n- token: enforce a 30-day expiry\n- refresh: rotate on use",
      "Auth: Clerk. Payments: Stripe.",
      "The findings are:\n- secrets: committed to the repository\n- logging: absent",
    ]) {
      expect(deliver(sentence, "NEVER-MATCHES-ANYTHING"), sentence.slice(0, 48)).not.toBe("refused");
    }
  });

  it("does not close a credential written with no key, and says so here too", () => {
    // Recorded as a measurement, not a claim, and deliberately asserted at its
    // TRUE size: a credential written with no key reaches a deliverable report
    // with the value intact. Catching it means judging whether a token looks
    // like a secret, which is the detector the owner retired after ten rounds.
    // This test exists so that gap is a number somebody can read rather than a
    // sentence somebody wrote. If it ever closes, the documentation changes with it.
    expect(
      deliver(`The committed configuration contains the literal ${V} on line 14.`),
      "this is the gap, recorded at its true size",
    ).toBe("delivered-with-credential");
  });

  it("does not close a key the lexicon does not recognise", () => {
    expect(
      deliver(`The committed configuration contains: STRIPE_SK=${V}`),
      "this is the gap, recorded at its true size",
    ).toBe("delivered-with-credential");
  });
});
