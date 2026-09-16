import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { isNonSecretValue } from "@/lib/release-rescue-credential-scanner";
import { releaseRescueFindingV1Schema } from "@/lib/release-rescue-findings";
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

  // Characters INSIDE the value.
  //
  // Audit 10's largest finding class, and one this generator could not express:
  // every affix above goes on an end, so a password containing `#`, `&`, `(`, a
  // space or a quote was structurally unreachable. Those are exactly the
  // characters `valueSpan` terminates on, so the scanner captured a two-character
  // prefix and left the rest of the password in the text.
  for (const body of bodies.slice(0, 4)) {
    for (const inner of ["#", "&", "(", ";", "'", " ", "<", "|", "!", "$", "%", "*"]) {
      values.add(`Ab${inner}${body}`);
      values.add(`${body}${inner}cd`);
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
  // The fixture has to produce a report that would OTHERWISE be deliverable.
  //
  // The first version used the default `passingAssessments()` while attaching a
  // finding, which is a contradiction deterministic validation rejects on its
  // own: `deliverable` was false for an empty excerpt, for "hello world", and for
  // a real password alike. The assertion below could not fail, and it was
  // annotated as the one that speaks for the customer. Audit 10 found that, and
  // it was right.
  //
  // `setAssessment(..., { outcome: "fail" })` makes the finding consistent with
  // its check, so the gate's answer now depends on the excerpt.
  // The carrier is `whatWeObserved`, not a location excerpt.
  //
  // Excerpts are gone: a finding points at source and never carries it, so the
  // only way text still enters a report is a free-text field an auditor writes.
  // That is where redaction now serves as DEFENCE IN DEPTH — it is no longer
  // what proves the deliverable is safe, because there is no longer a field for
  // customer source to sit in.
  //
  // It returns `null` when assembly REFUSES the observation, which is now a
  // possible and desirable outcome: an observation that reproduces a credential
  // construct never becomes an artifact. A refusal is the strongest form of "not
  // delivered", so the callers below treat it as one.
  function reportWith(observed: string) {
    try {
      return buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [
          makeFinding({
            whatWeObserved: `The committed configuration contains: ${observed}`,
            locations: [{ path: "config/app.env", startLine: 1, endLine: 1 }],
          }),
        ],
      }),
      );
    } catch {
      return null;
    }
  }

  it("is a fixture that can actually be delivered", () => {
    // The guard on the guard. If this ever fails, every assertion below is
    // vacuous again and says nothing about credentials.
    const clean = reportWith("PORT=3000");

    expect(clean, "the fixture itself must assemble").not.toBeNull();
    const gate = releaseRescueDeliveryGate(clean!, validateReleaseRescueReport(clean!));

    expect(validateReleaseRescueReport(clean!).hardFailures).toEqual([]);
    expect(gate.deliverable, "the corpus assertions below are meaningless without this").toBe(true);
  });

  it("cannot be built with a credential in a source-carrying field, for any generated value", () => {
    // THE PROPERTY, restated for the architecture the owner chose.
    //
    // The old version planted each credential in a finding's excerpt and asked
    // whether the detector had scrubbed it. That question has no safe answer —
    // ten audits went looking for one — and it is no longer the question. There
    // is no excerpt field, so the credential cannot be put into the artifact in
    // the first place, and an attempt to do so is REFUSED rather than cleaned.
    const accepted: string[] = [];

    for (const value of GENERATED) {
      const parsed = releaseRescueFindingV1Schema.safeParse(
        makeFinding({
          locations: [
            { path: "config/app.env", startLine: 1, endLine: 1, excerpt: assign("DB_PASSWORD", value) } as never,
          ],
        }),
      );
      if (parsed.success) accepted.push(value);
    }

    expect(accepted, `${accepted.length} credentials were accepted into a stored finding`).toEqual([]);
  });

  // `password`, `secret` and `token` are in the corpus because people really do
  // choose them, and they are also ordinary English words that a rubric check
  // title and a disclaimer legitimately contain. A whole-artifact substring test
  // cannot tell those apart, so it runs on the values that are not plain words —
  // the distinction is in the test, not in the guarantee.
  const DICTIONARY_WORDS = new Set(["password", "secret", "token", "apikey", "monkey", "dragon"]);
  const CHECKABLE = GENERATED.filter((value) => !DICTIONARY_WORDS.has(value));

  it("delivers no report holding any generated credential, on the carrier the product uses", () => {
    // THE ASSERTION THAT SPEAKS FOR THE CUSTOMER, and the one an audit caught
    // this suite deleting.
    //
    // Two rounds running, the corpus and the delivery gate stopped being crossed
    // with each other. First the crossing was replaced by a fixture that failed
    // validation for every input, so `deliverable` was false for a password and
    // for the empty string alike. Then it was replaced by a single report built
    // from a fixed clean string and checked against values it was never given —
    // a test that cannot fail for any input.
    //
    // This crosses every generated value with the gate, THROUGH THE CARRIER THE
    // PRODUCT ACTUALLY USES: a prose sentence with the assignment inside it,
    // which is how an executor writes "a credential is hardcoded here". That
    // exact carrier measured 30 of 116 delivered before the prose contract
    // existed, while the bare assignment measured 0 — the prefix was the whole
    // difference, and no hand-picked list contained it.
    const delivered: string[] = [];

    for (const value of CHECKABLE) {
      const report = reportWith(assign("DB_PASSWORD", value));
      if (report === null) continue; // refused before an artifact existed
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));
      if (gate.deliverable && withoutPlaceholders(JSON.stringify(report)).includes(value)) {
        delivered.push(value);
      }
    }

    expect(CHECKABLE.length).toBeGreaterThan(200);
    expect(delivered, `${delivered.length} generated credentials reached a deliverable report`)
      .toEqual([]);
  }, 60_000);

  it("refuses every one of them outright, rather than cleaning them", () => {
    // Stronger, and the reason the assertion above can be trusted: none of these
    // got as far as a gate decision. If this ever weakens to "held" or
    // "redacted", the test above is the one that still has to hold.
    const assembled: string[] = [];

    for (const value of CHECKABLE) {
      if (reportWith(assign("DB_PASSWORD", value)) !== null) assembled.push(value);
    }

    expect(assembled, `${assembled.length} quoted assignments were assembled instead of refused`)
      .toEqual([]);
  }, 60_000);

  it("carries no generated credential in a report the auditor wrote correctly", () => {
    // The legitimate path: the observation names the setting and cites the file,
    // and the artifact has nowhere for the value to be.
    const report = reportWith("the DB_PASSWORD setting is assigned a literal value");
    expect(report).not.toBeNull();

    const serialized = withoutPlaceholders(JSON.stringify(report));
    const leaked = CHECKABLE.filter((value) => serialized.includes(value));

    expect(leaked, `${leaked.length} generated credentials appeared in an artifact`).toEqual([]);
    expect(
      releaseRescueDeliveryGate(report!, validateReleaseRescueReport(report!)).deliverable,
      "and the correctly written finding is still deliverable",
    ).toBe(true);
  }, 60_000);

  it("leaks no credential through a carrier the generator cannot express", () => {
    // Multi-line and delimited carriers, which the corpus above cannot reach:
    // every generated value goes through a single-line `operator_assignment`.
    // Audit 10 named that as the pinned axis and found four leaks in it.
    const S = "Xk92mQvn7Lz";
    const CARRIERS: Array<[string, string]> = [
      ["angle-wrapped value", `DB_PASSWORD=<${S}>`],
      ["tab continuation under a space-indented key", `    DB_PASSWORD=\n\t${S}`],
      ["space continuation under a tab-indented key", `\tDB_PASSWORD=\n            ${S}`],
      ["csv with an ambiguous verb column", `order date,password,email\n2024-01-01,${S},a@b.com`],
      ["csv with an update column", `update time,password\nx,${S}`],
      ["csv with a from column", `from,password,to\na,${S},b`],
      ["quoted value carrying a hash", `DB_PASSWORD="Ab#${S}"`],
      ["value carrying a space", `DB_PASSWORD=Ab ${S}`],
      ["value carrying parentheses", `DB_PASSWORD=Ab(${S})`],
      ["url userinfo", `postgres://user:${S}@host:5432/db`],
    ];
    const leaked: string[] = [];

    for (const [label, text] of CARRIERS) {
      if (withoutPlaceholders(redactSecrets(text).redacted).includes(S)) leaked.push(label);
    }

    expect(leaked, `${leaked.length} carriers leaked the credential`).toEqual([]);
  });

  it("keeps the fields a line legitimately holds beside a credential", () => {
    // The other side of taking the rest of the line: a query string is several
    // fields, a JSON object written on one line is several values, and a trailing
    // comment is not part of the password.
    expect(redactSecrets("GET /v1?api_key=Xk92mQvn7Lz&sort=name").redacted).toContain("&sort=name");
    expect(redactSecrets('{"password": "Xk92mQvn7Lz", "host": "db.internal"}').redacted)
      .toContain("db.internal");
    expect(redactSecrets("DB_PASSWORD=Xk92mQvn7Lz # rotate quarterly").redacted)
      .toContain("# rotate quarterly");
  });

  it("bricks no report over ordinary content", () => {
    // A `credential_evidence` hold cannot be cleared by any human, so each false
    // positive at that level is a permanent denial of service on a paid artifact.
    // Neither is a refusal, which is the newer way to brick one.
    //
    // Driven as a PRODUCT rather than a hand-picked list. The audit that found
    // the gate test vacuous also named the pinned axis: the credential direction
    // used products while the safe direction used fifteen strings somebody typed.
    // Both directions are products now.
    const SUBJECTS = [
      "The session token",
      "The API key check",
      "Password rotation",
      "The credential store",
      "The bearer token in the authorization header",
      "The signing secret",
    ];
    const PREDICATES = [
      "has a 30-day lifetime and is never rotated.",
      "is read from the platform secret store rather than the repository.",
      "is missing on this route, so any caller reaches the record.",
      "is configured, logged, and covered by a test.",
      "is assigned a literal value in the committed configuration.",
      "is validated on every request except the two listed above.",
    ];

    const ORDINARY: string[] = [];
    for (const subject of SUBJECTS) {
      for (const predicate of PREDICATES) ORDINARY.push(`${subject} ${predicate}`);
    }
    // Plus the non-assignment shapes an observation legitimately reproduces: a
    // query, a CSV header, a header name. None of them is a quoted credential.
    ORDINARY.push(
      "SELECT id, password, email\n  ORDER BY id, created_at, name",
      "user id,order date,email\n7,2024-01-01,a@b.com",
      "order date,email,status\n2024-01-01,a@b.com,active",
      "DB_PASSWORD=\nRotate this before launch.",
      "DB_PASSWORD=\nAPI_HOST=prod.example.com",
      "the x-acme-session header name is set in the deploy configuration",
    );

    const bricked: string[] = [];
    const refused: string[] = [];

    for (const observed of ORDINARY) {
      const report = reportWith(observed);
      if (report === null) {
        refused.push(observed.slice(0, 44));
        continue;
      }
      if (pendingSecretHolds(report).some((hold) => hold.classification === "credential_evidence")) {
        bricked.push(observed.slice(0, 44));
      }
    }

    expect(ORDINARY.length).toBeGreaterThan(40);
    expect(refused, `${refused.length} ordinary observations were refused outright`).toEqual([]);
    expect(bricked, `${bricked.length} ordinary observations became permanently undeliverable`)
      .toEqual([]);
  });

  it("does refuse a pasted assignment, including one that is not a credential", () => {
    // The stated cost of the prose contract, recorded here so it reads as a
    // decision rather than a defect.
    //
    // All four of these were on the ordinary list while an excerpt field
    // existed. They are quotations, and none of them actually holds a
    // credential: `getToken(req)`, `get_password(user)`, `fetchToken(ctx)` and a
    // header read. Letting them through would mean asking whether the
    // right-hand side looks like a secret, and that question is the detector ten
    // audits took apart. So the rule reads the KEY and the OPERATOR and never
    // the value, and pays for it with these four. An auditor names the setting
    // and cites its line instead.
    const QUOTED = [
      "const token = getToken(req);",
      "password = get_password(user)",
      "token := fetchToken(ctx)",
      'const authHeader = request.headers.get("authorization");',
    ];

    for (const quoted of QUOTED) {
      expect(reportWith(quoted), `${quoted} should have been refused`).toBeNull();
    }
  });

  it("leaves an assignment to an ordinary constant alone", () => {
    // The cost above is bounded by the lexicon, not by the operator. A key that
    // is not credential-named is not this rule's business, however much it looks
    // like code — which is why the rule can afford to be absolute about the ones
    // that are.
    for (const ordinary of [
      'const STORAGE_KEY = "delegation-cloud-draft-v2";',
      'export const PUBLIC_WEB_RESEARCHER_KEY = "public-web-researcher-v1" as const;',
      "const cacheKey = `${userId}:${tenantId}`;",
      "PORT=3000",
      "SESSION_HEADER_NAME=x-acme-session",
    ]) {
      expect(reportWith(ordinary), `${ordinary} should not have been refused`).not.toBeNull();
    }
  });
});
