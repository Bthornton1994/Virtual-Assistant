import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { isNonSecretValue } from "@/lib/release-rescue-credential-scanner";
import { blocksDelivery } from "@/lib/release-rescue-secret-classification";
import {
  ASSESSMENT_RATIONALE_CATALOG,
  LIMITATION_CATALOG,
  OBSERVATION_CATALOG,
  REMEDIATION_CATALOG,
  UNCERTAINTY_CATALOG,
} from "@/lib/release-rescue-observation-catalog";
import { releaseRescueFindingV1Schema } from "@/lib/release-rescue-findings";
import {
  buildReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import {
  FIXTURE_OPERATOR_ID,
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
  // What this block measures changed with Option 1, and the change is the point.
  //
  // Every earlier version planted a generated credential in a field an executor
  // wrote — an excerpt, then `whatWeObserved` — and asked whether the detector
  // had made it safe. Four rounds established that the question has no safe
  // answer in either direction: audit 9 measured 366 of 366 credentials
  // delivered through a prose-prefixed carrier, and the rule strict enough to
  // stop them refused fifteen of twenty-one sentences an auditor must write.
  //
  // There is no such field now. A finding carries codes; the catalog carries the
  // words. So the corpus is crossed with two things instead: the fields that are
  // REFUSED, and the one free-text string a human still types into a report.

  /** Builds a report with `text` in the only free-text string a report still has. */
  function reportWithReviewerName(text: string) {
    try {
      return buildReleaseRescueReport(
        makeReportInput({
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome: "fail",
            rationaleCode: "control_missing_on_a_reachable_path",
          }),
          findings: [makeFinding({ locations: [{ path: "config/app.env", startLine: 1, endLine: 1 }] })],
          reviewedBy: {
            operatorUserId: FIXTURE_OPERATOR_ID,
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
    // The guard on the guard. If this ever fails, every assertion below is
    // vacuous again and says nothing about credentials.
    const clean = reportWithReviewerName("Ops Manager");

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

  it("cannot be built with a credential in a NARRATIVE field either, for any generated value", () => {
    // The five fields Option 1 removed, crossed with the whole corpus. These are
    // the fields the previous two rounds were fought over; each is now a refusal
    // at the assembly boundary rather than a judgement about the text.
    const NARRATIVE = ["title", "whatWeObserved", "whyItMatters", "recommendation", "residualUncertainty"];
    const accepted: string[] = [];

    for (const value of GENERATED) {
      for (const field of NARRATIVE) {
        const finding = { ...makeFinding(), [field]: assign("DB_PASSWORD", value) };
        if (releaseRescueFindingV1Schema.safeParse(finding).success) {
          accepted.push(`${field}=${value}`);
          continue;
        }
        // And the boundary the schema does not cover, which is the one that
        // matters: assembly takes findings as typed values and never parses them.
        let refused = false;
        try {
          buildReleaseRescueReport(
            makeReportInput({
              assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
                outcome: "fail",
                rationaleCode: "control_missing_on_a_reachable_path",
              }),
              findings: [finding as never],
            }),
          );
        } catch {
          refused = true;
        }
        if (!refused) accepted.push(`assembly:${field}=${value}`);
      }
    }

    expect(accepted, `${accepted.length} credentials were accepted into a narrative field`).toEqual([]);
  }, 120_000);

  // `password`, `secret` and `token` are in the corpus because people really do
  // choose them, and they are also ordinary English words that a rubric check
  // title and a disclaimer legitimately contain. A whole-artifact substring test
  // cannot tell those apart, so it runs on the values that are not plain words —
  // the distinction is in the test, not in the guarantee.
  const DICTIONARY_WORDS = new Set(["password", "secret", "token", "apikey", "monkey", "dragon"]);
  const CHECKABLE = GENERATED.filter((value) => !DICTIONARY_WORDS.has(value));

  it("delivers no report holding any generated credential, on the carrier that remains", () => {
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
    // The carrier is now the reviewer's display name. That is not a cosmetic
    // substitution: it is the honest worst case, because it is the only
    // free-text string an artifact still holds. Everything else a customer reads
    // is catalog text keyed by a code, and a code cannot carry a value.
    const delivered: string[] = [];

    for (const value of CHECKABLE) {
      const report = reportWithReviewerName(assign("DB_PASSWORD", value));
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

  it("carries no generated credential in a report the auditor wrote correctly", () => {
    // The legitimate path: the observation names the setting through its code,
    // the finding cites the file, and the artifact has nowhere for a value to be.
    const report = reportWithReviewerName("Ops Manager");
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
    //
    // This runs on the scanner directly. The scanner is DEFENCE IN DEPTH now,
    // for transient processing and for the one free-text field that remains —
    // it is no longer what proves a delivered report is safe.
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

  it("bricks no report over the catalog's own words", () => {
    // Requirement 8 of the structural change, as a property over the whole
    // catalog rather than over a hand-picked list.
    //
    // A `credential_evidence` hold cannot be cleared by any human, so each false
    // positive at that level is a permanent denial of service on a paid
    // artifact. Every customer-facing sentence the product can now produce is in
    // this catalog, so this crosses ALL of them with the scanner — which is a
    // complete statement rather than a sample, and was not possible while an
    // auditor could write arbitrary prose.
    const catalogText: string[] = [];
    for (const observation of Object.values(OBSERVATION_CATALOG)) {
      catalogText.push(observation.title, observation.whatWeObserved, observation.whyItMatters);
    }
    for (const remediation of Object.values(REMEDIATION_CATALOG)) catalogText.push(remediation.text);
    for (const text of Object.values(UNCERTAINTY_CATALOG)) catalogText.push(text);
    for (const text of Object.values(LIMITATION_CATALOG)) catalogText.push(text);
    for (const rationale of Object.values(ASSESSMENT_RATIONALE_CATALOG)) catalogText.push(rationale.text);

    const bricked = catalogText.filter((text) =>
      blocksDelivery(redactSecrets(text).classification ?? "sensitive_prose"),
    );

    expect(catalogText.length, "the catalog must actually have been walked").toBeGreaterThan(100);
    expect(bricked, `${bricked.length} catalog sentences would brick a report`).toEqual([]);
  });

  it("bricks no report over an ordinary reviewer name", () => {
    // The other free-text string, driven as a product rather than a list.
    const FIRST = ["Alex", "Priya", "Jordan", "Mei", "Sam", "Tomás"];
    const ROLES = [
      "Ops Manager",
      "Release Manager",
      "Head of Engineering",
      "Security Lead",
      "Principal Engineer",
      "Delivery Manager",
    ];
    const bricked: string[] = [];
    const refused: string[] = [];

    for (const first of FIRST) {
      for (const role of ROLES) {
        const name = `${first} — ${role}`;
        const report = reportWithReviewerName(name);
        if (report === null) {
          refused.push(name);
          continue;
        }
        if (pendingSecretHolds(report).some((hold) => hold.classification === "credential_evidence")) {
          bricked.push(name);
        }
      }
    }

    expect(FIRST.length * ROLES.length).toBeGreaterThan(30);
    expect(refused, `${refused.length} ordinary reviewer names were refused outright`).toEqual([]);
    expect(bricked, `${bricked.length} ordinary reviewer names became permanently undeliverable`)
      .toEqual([]);
  });

  it("no longer pays the prose contract's cost, because there is no prose contract", () => {
    // This test INVERTED, and the inversion is the clearest single measure of
    // what Option 1 bought.
    //
    // The previous version recorded four sentences the product refused as a
    // stated cost: `const token = getToken(req);`, `password = get_password(user)`,
    // `token := fetchToken(ctx)` and a header read. None of them holds a
    // credential. They were refused because the only way to stop a quoted
    // assignment was to refuse every assignment-shaped sentence, and an auditor
    // paid for that in sentences they could not write.
    //
    // An auditor writes no sentences at all now, so the cost is zero. The
    // observation catalog says what was found; the finding says where. The four
    // strings below are not refused because nothing asks about them.
    const FORMERLY_REFUSED = [
      "const token = getToken(req);",
      "password = get_password(user)",
      "token := fetchToken(ctx)",
      'const authHeader = request.headers.get("authorization");',
    ];

    for (const text of FORMERLY_REFUSED) {
      // They cannot enter a report at all — there is no field — which is a
      // different and stronger outcome than being refused for looking like code.
      const finding = { ...makeFinding(), whatWeObserved: text };
      expect(releaseRescueFindingV1Schema.safeParse(finding).success, text).toBe(false);
    }

    // And the report an auditor actually produces is deliverable, with the same
    // diagnostic content those sentences were trying to convey: a code, a path
    // and a line.
    const report = reportWithReviewerName("Ops Manager");
    expect(report).not.toBeNull();
    expect(releaseRescueDeliveryGate(report!, validateReleaseRescueReport(report!)).deliverable).toBe(true);
    expect(report!.findings[0].locations[0].path).toBe("config/app.env");
  });
});
