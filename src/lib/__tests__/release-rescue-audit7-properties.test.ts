import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import {
  CREDENTIAL_CARRIERS,
  CREDENTIAL_QUALIFIERS,
  keyLooksSecret,
} from "@/lib/release-rescue-redaction-keys";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
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
  signWithFixtureReviewer,
} from "@/lib/__tests__/release-rescue-fixtures";

// The seventh audit's diagnosis, as tests.
//
// Six rounds each closed the examples the previous audit used. The audit's point
// was that every table in this suite crosses ONE carrier with a key or a value,
// while the defects live where two dimensions meet — and that the false-positive
// direction is tested with hand-picked lists while the credential direction uses
// cross products. So these are products in both directions.

const SECRET = "Xk92mQvn7LzPr0d";

/** Indents every line, which is what a real nested block does. */
function indent(block: string, width: number): string {
  const pad = " ".repeat(width);
  return block
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

describe("the lexicon, crossed against itself", () => {
  // The property that closes the run-together class instead of listing it.
  // `ACCESSTOKEN` was invisible after `PGPASSWORD` was fixed, because the fix
  // was a hand-written list of password words and nobody had typed `token` into
  // it. A separated name and its concatenation are the same name.
  it("recognises every qualifier+carrier concatenation it recognises separated", () => {
    const missed: string[] = [];
    let checked = 0;

    for (const qualifier of CREDENTIAL_QUALIFIERS) {
      for (const carrier of CREDENTIAL_CARRIERS) {
        checked += 1;
        const separated = `${qualifier}_${carrier}`.toUpperCase();
        const runTogether = `${qualifier}${carrier}`.toUpperCase();

        if (!keyLooksSecret(separated)) missed.push(`separated: ${separated}`);
        if (!keyLooksSecret(runTogether)) missed.push(`run-together: ${runTogether}`);
      }
    }

    expect(checked).toBeGreaterThan(500);
    expect(missed, `${missed.length} lexicon pairs not recognised`).toEqual([]);
  });

  it("redacts the value behind every one of them", () => {
    const leaked: string[] = [];

    for (const qualifier of CREDENTIAL_QUALIFIERS) {
      for (const carrier of CREDENTIAL_CARRIERS) {
        for (const key of [
          `${qualifier}_${carrier}`.toUpperCase(),
          `${qualifier}${carrier}`.toUpperCase(),
        ]) {
          if (redactSecrets(`${key}=${SECRET}`).redacted.includes(SECRET)) leaked.push(key);
        }
      }
    }

    expect(leaked, `${leaked.length} lexicon key names leaked their value`).toEqual([]);
  });

  it("does not make ordinary English words into credential names", () => {
    // The other direction of the same fix. A substring rule made `secretary`,
    // `passwordless` and `credentialing` confident evidence — which is an
    // UNCLEARABLE hold on a plausible line of auth code.
    const ordinary = [
      "secretary", "secretariat", "secretarial", "passwordless", "passwordlessLogin",
      "credentialing", "apikeyless", "bypass", "compass", "surpass", "encompass",
      "passage", "passenger", "passive", "tokenizer", "tokenize", "keyboard",
      "keynote", "monkey", "turnkey", "spin", "pinned", "seeded", "certain",
    ];
    const wrong = ordinary.filter((word) => keyLooksSecret(word));

    expect(wrong, `${wrong.length} ordinary words treated as credential names`).toEqual([]);
  });
});

describe("two carriers composed, which is where the defects lived", () => {
  // Every existing table crosses one carrier with a key or a value. A YAML line
  // WITH a trailing comment was neither, and it dropped the span entirely.
  const OUTER: ReadonlyArray<{ label: string; wrap: (line: string) => string }> = [
    { label: "alone", wrap: (line) => line },
    { label: "trailing hash comment", wrap: (line) => `${line} # rotate this quarterly` },
    {
      label: "trailing comment that reads as a sentence",
      wrap: (line) => `${line} # this is the value we use in the staging config for now`,
    },
    { label: "trailing slash comment", wrap: (line) => `${line} // set by the deploy script` },
    { label: "leading comment line", wrap: (line) => `# staging only\n${line}` },
    // Indenting wraps EVERY line, which is what a real nested block does. The
    // first version indented only the first line, so composing it with an inner
    // form that carries its own newline produced YAML no writer emits — a key
    // indented further than its own continuation — and the failure it caused was
    // in the fixture, not the scanner.
    { label: "indented", wrap: (line) => indent(line, 6) },
    { label: "inside a block", wrap: (line) => `services:\n  db:\n${indent(line, 4)}\n` },
    { label: "followed by another key", wrap: (line) => `${line}\nlog_level: debug` },
    { label: "preceded by prose", wrap: (line) => `The deploy config sets this.\n${line}` },
  ];

  const INNER: ReadonlyArray<{ label: string; render: (value: string) => string }> = [
    { label: "yaml colon", render: (v) => `DB_PASSWORD: ${v}` },
    { label: "yaml colon, quoted", render: (v) => `DB_PASSWORD: "${v}"` },
    { label: "env equals", render: (v) => `DB_PASSWORD=${v}` },
    { label: "env equals, quoted", render: (v) => `DB_PASSWORD="${v}"` },
    { label: "export", render: (v) => `export DB_PASSWORD=${v}` },
    { label: "run-together key", render: (v) => `PGPASSWORD=${v}` },
    { label: "run-together token key", render: (v) => `ACCESSTOKEN=${v}` },
    { label: "value on the next line", render: (v) => `DB_PASSWORD:\n  ${v}` },
  ];

  it("is never weaker composed than either carrier alone", () => {
    const leaked: string[] = [];
    let checked = 0;

    for (const outer of OUTER) {
      for (const inner of INNER) {
        checked += 1;
        const text = outer.wrap(inner.render(SECRET));
        if (redactSecrets(text).redacted.includes(SECRET)) {
          leaked.push(`${outer.label} × ${inner.label}`);
        }
      }
    }

    expect(checked).toBeGreaterThan(60);
    expect(leaked, `${leaked.length} composed carriers leaked the value`).toEqual([]);
  });
});

describe("ordinary content, as a product rather than a list", () => {
  // The asymmetry the audit named: the credential direction used 567- and
  // 294-element products while the safe direction used 15 hand-picked strings.
  // Three separate defects lived in that gap, and all three produced UNCLEARABLE
  // holds — a paid report no human can deliver.
  const SUBJECTS = ["Tokens", "Passwords", "Secrets", "Credentials", "API keys", "Session keys"];
  const PREDICATES = [
    "30-day lifetime with no rotation.",
    "8-character minimum is all we enforce.",
    "rotated quarterly and the rotation is logged.",
    "managed via environment variables in the deploy pipeline.",
    "stored in the platform secret store, not in the repository.",
    "not configured, so sessions do not end.",
  ];

  it("never calls a heading with a quantity a credential", () => {
    const wrong: string[] = [];

    for (const subject of SUBJECTS) {
      for (const predicate of PREDICATES) {
        const line = `${subject}: ${predicate}`;
        const { classification } = redactSecrets(line);
        if (classification === "credential_evidence") wrong.push(line);
      }
    }

    expect(wrong, `${wrong.length} ordinary headings classified as confident evidence`).toEqual([]);
  });

  it("does not refuse any of them at the public intake form", () => {
    const refused: string[] = [];

    for (const subject of SUBJECTS) {
      for (const predicate of PREDICATES) {
        const notes = `${subject}: ${predicate}`;
        const result = parseRescueIntake({ evidenceNotes: notes });
        const message = result.ok ? "" : JSON.stringify(result.errors);
        if (message.includes("looks like a credential")) refused.push(notes);
      }
    }

    expect(refused, `${refused.length} ordinary descriptions refused a customer`).toEqual([]);
  });

  it("leaves ordinary source intact when the scanner inspects it transiently", () => {
    // A statement list is not a CSV. `;` was in the delimiter table, so three
    // lines of route code whose first mentioned `getToken` were read as a header
    // plus two rows, and every line was redacted into an unclearable hold.
    const EXCERPTS = [
      'import { getToken } from "./auth";\nconst user = await getUser(request.params.id);\nreturn NextResponse.json(user);',
      'const apiKey = process.env.API_KEY;\nif (!apiKey) throw new Error("missing");',
      'export const sessionSecret = config.sessionSecret;\nreturn sign(payload, sessionSecret);',
      'let token;\ntoken = await refreshToken();\nreturn token;',
    ];

    for (const excerpt of EXCERPTS) {
      expect(redactSecrets(excerpt).redacted, excerpt.slice(0, 40)).toBe(excerpt);
    }
  });

  it("keeps a report about such source deliverable, citing it by path and line", () => {
    // The finding still tells the customer exactly where to look. It just does
    // not carry a copy of what is there — they open it in their own checkout.
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [
          makeFinding({
            locations: [{ path: "src/app/api/users/route.ts", startLine: 1, endLine: 3 }],
          }),
        ],
      }),
    );

    expect(report.findings[0].locations[0].path).toBe("src/app/api/users/route.ts");
    expect(report.findings[0].locations[0].startLine).toBe(1);
    expect(report.findings[0].locations[0].endLine).toBe(3);
    expect(pendingSecretHolds(report)).toEqual([]);
  });
});

describe("the outcome the whole workstream exists to prevent", () => {
  // One assertion, stated plainly: a real credential never reaches a deliverable
  // report. Driven from the same lexicon product, so a key nobody thought of is
  // covered by construction.
  it("never delivers a report carrying a credential from any lexicon key", () => {
    const QUALIFIERS = ["access", "pg", "mysql", "github", "session", "client"] as const;
    const CARRIERS = ["token", "password", "secret", "pwd", "apikey"] as const;
    const SPELLINGS = ["separated", "runTogether"] as const;

    // The generated input is the assignment itself. Qualifier, carrier and
    // spelling each change the key that sits in front of the value; a corpus
    // that only labelled failures with those names was sixty copies of one case.
    const inputs: string[] = [];
    for (const qualifier of QUALIFIERS) {
      for (const carrier of CARRIERS) {
        for (const spelling of SPELLINGS) {
          const key =
            spelling === "separated"
              ? `${qualifier}_${carrier}`.toUpperCase()
              : `${qualifier}${carrier}`.toUpperCase();
          inputs.push(`${key}=${SECRET}`);
        }
      }
    }

    expect(inputs).toHaveLength(QUALIFIERS.length * CARRIERS.length * SPELLINGS.length);
    expect(new Set(inputs).size, "generated inputs must be distinct").toBe(inputs.length);
    expect(inputs).toContain(`ACCESS_TOKEN=${SECRET}`);
    expect(inputs).toContain(`ACCESSTOKEN=${SECRET}`);
    expect(inputs).toContain(`PG_PASSWORD=${SECRET}`);
    expect(inputs).toContain(`PGPASSWORD=${SECRET}`);
    expect(inputs.every((planted) => planted.includes("=") && planted.endsWith(SECRET))).toBe(true);

    // Assembled unsigned once, then signed by splice. `makeReportInput` signs by
    // assembling a draft to read its subject hash off; doing that sixty times
    // was the reason the loop never planted the key. The finding's check is
    // marked fail so a clean signature is actually deliverable — otherwise the
    // gate is false for every input and `includes(SECRET)` never runs.
    const draft = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: null,
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "control_missing_on_a_reachable_path",
        }),
        findings: [
          makeFinding({
            locations: [{ path: "config/app.env", startLine: 1, endLine: 1 }],
          }),
        ],
      }),
    );
    const clean = signWithFixtureReviewer(draft);
    expect(validateReleaseRescueReport(clean).hardFailures).toEqual([]);
    expect(releaseRescueDeliveryGate(clean, validateReleaseRescueReport(clean)).deliverable).toBe(
      true,
    );

    // COUNTED, not skipped.
    //
    // `continue` on a refused signature hid the third vacuity in this one test.
    // Measured: all sixty inputs are refused at the signature and NONE reaches
    // the gate, so `delivered` was empty no matter what the gate did. The
    // assertion that read as "the gate never delivers a credential" was resolved
    // entirely by `signReleaseRescueReport`, which refuses reviewer text that
    // would have to be redacted (S-006, S-008) — a guard added after this test
    // was written.
    //
    // So both outcomes are tallied and both are asserted. The refusal count is
    // what carries the property today. The delivery list stays, and becomes live
    // the moment anything stops being refused at the signature — at which point
    // the counts move and this test says so instead of passing quietly.
    const refused: string[] = [];
    const reachedGate: string[] = [];
    const delivered: string[] = [];

    for (const planted of inputs) {
      let report: ReturnType<typeof signWithFixtureReviewer>;
      try {
        report = signWithFixtureReviewer(draft, { displayName: planted });
      } catch {
        refused.push(planted);
        continue;
      }
      reachedGate.push(planted);
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));
      if (gate.deliverable && JSON.stringify(report).includes(SECRET)) {
        delivered.push(planted);
      }
    }

    // Nothing may be silently dropped: every input took one of the two paths.
    expect(refused.length + reachedGate.length).toBe(inputs.length);

    // The property that actually holds, stated as the number it is. If a future
    // change lets one of these through the signature, this fails and names it.
    expect(
      refused.length,
      `${reachedGate.length} credential assignment(s) were accepted as a reviewer name: ${reachedGate.slice(0, 3).join(", ")}`,
    ).toBe(inputs.length);

    // Belt and braces, and currently unreachable BY CONSTRUCTION rather than by
    // luck — see the count above. Left in deliberately: it is the assertion that
    // matters if the signature ever stops being the thing that refuses.
    expect(delivered, `${delivered.length} keys produced a deliverable report holding a credential`)
      .toEqual([]);
  });
});
