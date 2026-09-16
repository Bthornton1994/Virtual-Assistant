import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assembleReleaseRescueReport,
  buildReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { releaseRescueFindingV1Schema } from "@/lib/release-rescue-findings";
import { redactSecrets } from "@/lib/release-rescue-redaction";
import { sanitizeReportInput } from "@/lib/release-rescue-pipeline";
import { toCustomerReportView } from "@/lib/release-rescue-presentation";
import { OBSERVATION_CATALOG } from "@/lib/release-rescue-observation-catalog";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import {
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";

// Intake to delivery, with real credentials in the input.
//
// An audit asked whether anything actually CALLED the redaction code. It did
// not: `prepareExcerpt` and `redactSecrets` had no production call site, so two
// hundred passing unit tests exercised a function the product never ran. A unit
// test of a detector is not evidence that the detector is wired in.
//
// So this file starts from the text a reviewer would actually paste — a real
// `docker-compose.yml`, a `.env`, a `.pgpass` — and follows it all the way to the
// customer-facing view, asserting at each stage that the secret is not there.

const SECRETS = {
  compose: "pr0d-Xk92mQvn7Lz",
  smtp: "sg-9182hjqkalsd",
  word: "swordfish",
  pgpass: "S3cretPassw0rd",
  aws: "a-Kx92mQvn7LzPr0dQQ",
} as const;

const COMPOSE = `services:
  api:
    environment:
      DB_PASSWORD=${SECRETS.compose}
      SMTP_PASS=${SECRETS.smtp}
      LEGACY_PASSWORD=${SECRETS.word}
`;

const PGPASS = `db.acme.com:5432:prod:app:${SECRETS.pgpass}`;
const ENVFILE = `AWS_SECRET_ACCESS_KEY="${SECRETS.aws}"\nDEBUG=true\n`;

const ALL_SECRETS = Object.values(SECRETS);

function assertNothingLeaked(subject: unknown, where: string): void {
  const serialised = JSON.stringify(subject);
  for (const secret of ALL_SECRETS) {
    expect(serialised, `${where} leaked ${secret}`).not.toContain(secret);
  }
}

describe("an executor that quotes the credential instead of describing it", () => {
  // The most likely finding this product will ever produce is "a credential is
  // hardcoded here", and the most likely way an executor writes it is by pasting
  // the line.
  //
  // Four earlier rounds tried to decide, from the text, whether a given sentence
  // had quoted a credential or merely described one. Each produced a measured
  // failure: a rule keyed on an assignment construct was walked past by
  // `DB_PASSWORD is set to <value>`, and a rule strict enough to catch that
  // refused fifteen of twenty-one sentences an auditor legitimately needs to
  // write.
  //
  // So the question is no longer asked. There is no field on a finding, an
  // assessment or a report that holds a sentence. These tests assert that the
  // fields are refused — by the schema, and by a named refusal at the assembly
  // boundary that input can reach without passing a schema.

  const NARRATIVE_INJECTIONS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["whatWeObserved", { whatWeObserved: `docker-compose.yml line 4: DB_PASSWORD=${SECRETS.compose}` }],
    ["title", { title: `Hardcoded DB_PASSWORD=${SECRETS.compose}` }],
    ["whyItMatters", { whyItMatters: `Anyone reading the repo has ${SECRETS.compose}.` }],
    ["recommendation", { recommendation: `Rotate ${SECRETS.compose} and move it to a secret store.` }],
    ["residualUncertainty", { residualUncertainty: `Unsure whether ${SECRETS.smtp} is still live.` }],
    ["description", { description: `The .pgpass holds ${SECRETS.pgpass}.` }],
    ["notes", { notes: `Reviewer note: AWS_SECRET_ACCESS_KEY=${SECRETS.aws}` }],
    ["summary", { summary: `SMTP_PASS=${SECRETS.smtp}` }],
    ["excerpt", { excerpt: COMPOSE }],
    ["source", { source: PGPASS }],
  ];

  for (const [field, extra] of NARRATIVE_INJECTIONS) {
    it(`refuses a finding carrying "${field}", by name, without repeating the value`, () => {
      const finding = { ...makeFinding(), ...extra };

      // 1. The schema refuses it.
      const parsed = releaseRescueFindingV1Schema.safeParse(finding);
      expect(parsed.success, `${field} should not parse`).toBe(false);

      // 2. And so does the assembly boundary, which input can reach WITHOUT a
      //    parse — a stored artifact read back as `unknown`, or a caller holding
      //    the input as `any`. This is the one that matters: `.strict()` only
      //    protects the paths that go through a schema.
      let message = "(no refusal)";
      try {
        buildReleaseRescueReport(
          makeReportInput({
            assessments: setAssessment(passingAssessments(), "secrets.no_secrets_in_version_control", {
              outcome: "fail",
              rationaleCode: "control_missing_on_a_reachable_path",
            }),
            findings: [finding as never],
          }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).not.toBe("(no refusal)");
      // It names the FIELD, so a caller is told what changed rather than being
      // told their key is unrecognised.
      expect(message).toContain(`findings[0].${field}`);
      // And it carries none of the value, because a refusal reaches logs.
      for (const secret of ALL_SECRETS) {
        expect(message, "a refusal reaches logs; it must not carry the value").not.toContain(secret);
      }
    });
  }

  it("refuses the same fields on an assessment, not only on a finding", () => {
    // An assessment's `rationale` was executor-written and rendered beside the
    // check. The findings walk never touched it, which is how the original
    // coverage gap happened one level up.
    let message = "(no refusal)";
    try {
      buildReleaseRescueReport(
        makeReportInput({
          assessments: passingAssessments().map((assessment, index) =>
            index === 0
              ? ({ ...assessment, rationale: `AWS_SECRET_ACCESS_KEY=${SECRETS.aws}` } as never)
              : assessment,
          ),
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("assessments[0].rationale");
    for (const secret of ALL_SECRETS) {
      expect(message).not.toContain(secret);
    }
  });

  it("refuses them on a finding's evidence entry, the newer of the two child collections", () => {
    let message = "(no refusal)";
    try {
      buildReleaseRescueReport(
        makeReportInput({
          findings: [
            {
              ...makeFinding(),
              evidence: [
                {
                  kind: "configuration_reference" as const,
                  path: "docker-compose.yml",
                  startLine: 4,
                  endLine: 6,
                  excerpt: COMPOSE,
                },
              ],
            } as never,
          ],
          assessments: setAssessment(passingAssessments(), "secrets.no_secrets_in_version_control", {
            outcome: "fail",
            rationaleCode: "control_missing_on_a_reachable_path",
          }),
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("findings[0].evidence[0].excerpt");
    for (const secret of ALL_SECRETS) {
      expect(message).not.toContain(secret);
    }
  });

  it("has no field left on a report for a limitation sentence", () => {
    // `limitations` was a string array an executor wrote and the customer read
    // verbatim. An audit planted an assignment in it and delivered the report.
    // It is now `limitationCodes`, a closed enum, and the old key is refused.
    const raw = makeReportInput() as unknown as Record<string, unknown>;
    const withProse = { ...raw, limitations: [`AWS_SECRET_ACCESS_KEY=${SECRETS.aws}`] };

    let message = "(no refusal)";
    try {
      buildReleaseRescueReport(withProse as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // The value never reaches an artifact: either the build refuses, or the key
    // is simply not read and the assembled report has no trace of it. Both are
    // acceptable outcomes; carrying the text is not.
    if (message === "(no refusal)") {
      const built = buildReleaseRescueReport(withProse as never);
      assertNothingLeaked(built, "a report built with a stray `limitations` key");
      expect(Object.keys(built)).not.toContain("limitations");
    } else {
      for (const secret of ALL_SECRETS) {
        expect(message).not.toContain(secret);
      }
    }
  });

  it("cannot carry the credential in the one field that remains, because it is not a path", () => {
    // A finding location's `path` is the last value taken from the customer's
    // repository that reaches a report. It is bounded to a path GRAMMAR — no
    // spaces, no `=`, bounded segments — so a pasted assignment is not a legal
    // value for it. That is a structural bound, not a judgement about the text.
    for (const attempt of [
      `docker-compose.yml: DB_PASSWORD=${SECRETS.compose}`,
      `DB_PASSWORD=${SECRETS.compose}`,
      `${COMPOSE}`,
      `db.acme.com:5432:prod:app:${SECRETS.pgpass}`,
    ]) {
      const parsed = releaseRescueFindingV1Schema.safeParse(
        makeFinding({ locations: [{ path: attempt, startLine: 1, endLine: 1 }] }),
      );
      expect(parsed.success, attempt.slice(0, 40)).toBe(false);
    }
  });

  it("still accepts the finding written the way the contract requires", () => {
    // The check that keeps the removal honest: the ordinary, correct report must
    // still build. A contract that refuses everything is not a contract.
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "secrets.no_secrets_in_version_control", {
          outcome: "fail",
          rationaleCode: "control_missing_on_a_reachable_path",
        }),
        findings: [
          makeFinding({
            observationCode: "secrets.literal_credential_in_repository",
            remediationCode: "rotate_and_move_to_secret_store",
            locations: [{ path: "docker-compose.yml", startLine: 4, endLine: 6 }],
          }),
        ],
      }),
    );

    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
    assertNothingLeaked(report, "the correctly written report");
  });
});

describe("a report built from source containing credentials", () => {
  const report = buildReleaseRescueReport(
    makeReportInput({
      // The finding's check must be marked failing, or the report contradicts
      // itself for reasons that have nothing to do with credentials.
      assessments: setAssessment(passingAssessments(), "secrets.no_secrets_in_version_control", {
        outcome: "fail",
        rationaleCode: "control_missing_on_a_reachable_path",
      }),
      findings: [
        // The same finding, written the way the contract requires: it names the
        // observation and cites the lines. The customer opens their own checkout.
        makeFinding({
          observationCode: "secrets.literal_credential_in_repository",
          remediationCode: "rotate_and_move_to_secret_store",
          locations: [
            { path: "docker-compose.yml", startLine: 4, endLine: 6 },
            { path: ".pgpass", startLine: 1, endLine: 1 },
          ],
          evidence: [{ kind: "configuration_reference", path: "docker-compose.yml", startLine: 4, endLine: 6 }],
        }),
      ],
      limitationCodes: ["customer_excluded_part_of_the_repository"],
    }),
  );

  it("carries none of the secrets in the artifact", () => {
    assertNothingLeaked(report, "the assembled report");
  });

  it("carries a usable citation and nothing from the file itself", () => {
    // The finding points at the file. It does not carry a copy of it, so there
    // is no per-location text left to check for a leak — which is the change.
    for (const finding of report.findings) {
      for (const location of finding.locations) {
        expect(location.path.length, "a finding must still say where to look").toBeGreaterThan(0);
        expect(Object.keys(location).sort()).toEqual(["endLine", "path", "startLine"]);
      }
      for (const item of finding.evidence) {
        expect(Object.keys(item).sort()).toEqual(["endLine", "kind", "path", "startLine"]);
      }
    }
  });

  it("carries none of them in the customer-facing view", () => {
    assertNothingLeaked(toCustomerReportView(report), "the customer view");
  });

  it("raises no holds, because there is no free text left to hold", () => {
    // This assertion INVERTED with Option 1, and the inversion is the point.
    //
    // Previously this file asserted the report carried unresolved holds: an
    // executor wrote a sentence, the scanner found a credential in it, the value
    // was replaced by a placeholder and a hold recorded so a human could decide.
    // That whole mechanism was downstream of a credential having already entered
    // a customer-deliverable field.
    //
    // A correctly built report now has nothing for the scanner to find, because
    // every customer-facing word came from the frozen catalog and every other
    // value is a code, a count or a path. The hold machinery is retained as
    // defence in depth for transient processing — the two tests below exercise
    // it where text actually flows — but on this path an empty hold list is the
    // correct outcome rather than a missed detection.
    expect(report.unresolvedHolds).toEqual([]);
    expect(pendingSecretHolds(report)).toEqual([]);
  });

  it("is deliverable once a human has signed it, which the removal must not have broken", () => {
    // Requirement 8 of the structural change: ordinary, safe reports must not be
    // made undeliverable by the removal of free-form prose. A contract that
    // refuses everything is not a contract.
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.blockers).toEqual([]);
    expect(gate.deliverable).toBe(true);
  });

  it("still holds and blocks when credential-bearing text does reach the sanitiser", () => {
    // Defence in depth, exercised at the boundary where transient text genuinely
    // exists: `sanitizeReportInput` runs over whatever a caller hands it,
    // including a stray key no schema knows about. The value is removed, a hold
    // is recorded with a hash rather than a copy, and nothing carries the text.
    const { value, holds } = sanitizeReportInput({ strayInternalField: COMPOSE });

    expect(holds.length).toBeGreaterThan(0);
    for (const hold of holds) {
      expect(hold.originalHash).toMatch(/^[0-9a-f]{64}$/);
      expect(hold.reason.length).toBeGreaterThan(20);
    }
    assertNothingLeaked(value, "the sanitised value");
    assertNothingLeaked(holds, "the holds");
    expect(holds.some((hold) => hold.classification === "credential_evidence")).toBe(true);
  });

  it("still refuses the credential at intake, which is where a customer pastes one", () => {
    // The other surface where free text genuinely exists and always will: the
    // intake form. Removing prose from the REPORT does not remove it from the
    // conversation, so the intake guard keeps its job.
    const result = parseRescueIntake({ evidenceNotes: `DB_PASSWORD=${SECRETS.compose}` });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("looks like a credential");
    assertNothingLeaked(result, "the intake rejection");
  });

  it("keeps the finding readable — the point is the finding, not the secret", () => {
    const finding = report.findings[0];

    // The file is named and the lines are cited, and the words come from the
    // catalog rather than from the finding. The stored artifact carries a code;
    // the rendered view carries the sentence.
    const rendered = toCustomerReportView(report).findings[0];
    expect(finding.observationCode).toBe("secrets.literal_credential_in_repository");
    expect(rendered.whatWeObserved).toBe(
      OBSERVATION_CATALOG["secrets.literal_credential_in_repository"].whatWeObserved,
    );
    expect(rendered.whatWeObserved).not.toContain("[REDACTED");
    expect(finding.locations[0].path).toBe("docker-compose.yml");
    expect(finding.locations[0].startLine).toBe(4);

    // And the diagnostic survives the removal: a customer can act on this.
    expect(rendered.evidence[0].path).toBe("docker-compose.yml");
    expect(rendered.evidence[0].lineRange).toContain("4");
    expect(rendered.recommendation.length).toBeGreaterThan(20);
  });

  it("still passes deterministic validation, because a clean artifact is valid", () => {
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });
});

describe("no secret reaches logs or error output", () => {
  it("does not put the value in an exception when sanitisation is bypassed", () => {
    // The runtime backstop behind the branded type. Its message must name the
    // path and the classification, never the text, because it reaches logs.
    //
    // Reaching it takes a deliberately malformed input now: a correctly shaped
    // report has no field that can hold credential material, so the assertion
    // has nothing to fire on. A caller casting past the brand with a location
    // `path` that is not a path is what a careless caller actually looks like —
    // assembly does not parse, so the grammar bound is not in force there, and
    // this assertion is what catches it.
    const raw = {
      ...makeReportInput(),
      findings: [
        {
          ...makeFinding(),
          locations: [{ path: `DB_PASSWORD=${SECRETS.compose}`, startLine: 1, endLine: 1 }],
        },
      ],
    };
    let message = "";
    try {
      // Deliberately casting past the brand, which is what a careless caller
      // would do and what the runtime assertion exists to catch.
      assembleReleaseRescueReport(raw as never);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("credential material survived sanitisation");
    expect(message).not.toContain(SECRETS.compose);
  });

  it("does not log the value anywhere, whether the build succeeds or refuses", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // The clean path builds; the malformed path refuses. Both run here, because
    // an exception reaches logs just as readily as a println.
    buildReleaseRescueReport(makeReportInput({ limitationCodes: ["customer_excluded_part_of_the_repository"] }));
    try {
      buildReleaseRescueReport({
        ...makeReportInput(),
        findings: [{ ...makeFinding(), whatWeObserved: `DB_PASSWORD=${SECRETS.compose}` } as never],
      });
    } catch {
      // The message is asserted elsewhere; here it only matters that it did not
      // reach a console on the way out.
    }

    for (const mock of [spy, errorSpy, warnSpy]) {
      const written = mock.mock.calls.flat().map(String).join(" ");
      expect(written).not.toContain(SECRETS.compose);
      mock.mockRestore();
    }
  });
});

describe("source is inspected transiently and never stored", () => {
  it("refuses a finding that tries to carry the source it cites", () => {
    // The whole file above plants five real secrets in a report's free text and
    // asserts none survives. This asserts the stronger, structural half: the
    // source those secrets came from cannot enter the artifact at all.
    for (const raw of [COMPOSE, PGPASS, ENVFILE]) {
      const parsed = releaseRescueFindingV1Schema.safeParse(
        makeFinding({
          locations: [{ path: "docker-compose.yml", startLine: 1, endLine: 6, excerpt: raw } as never],
        }),
      );

      expect(parsed.success, raw.slice(0, 32)).toBe(false);
    }
  });

  it("still lets the scanner read that source in memory", () => {
    // Transient inspection is untouched by the decision — the scanner reads the
    // file to find the finding. What changed is that its text does not travel.
    expect(redactSecrets(COMPOSE).redacted).not.toContain(SECRETS.compose);
    expect(redactSecrets(COMPOSE).hadSecrets).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("sanitisation is the only way in", () => {
  it("mints the brand nowhere outside the pipeline module", () => {
    // Scoped to the WHOLE tree, not to one file. The earlier version of this
    // test read `release-rescue-pipeline.ts` alone and passed while a second
    // producer sat in `release-rescue-report.ts` — the test proved the brand had
    // one producer in the only file where that was true.
    const offenders: string[] = [];
    let total = 0;

    for (const file of sourceFiles(resolve(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      const count = (source.match(/as Sanitized</g) ?? []).length;
      if (count === 0) continue;
      // This file itself, because the pattern above appears in its own source.
      // Every other test file stays in scope: a test that mints the brand is a
      // test that has stopped proving anything.
      if (file.endsWith("release-rescue-end-to-end.test.ts")) continue;
      total += count;
      if (!file.endsWith("release-rescue-pipeline.ts")) {
        offenders.push(`${file.slice(file.indexOf("src/"))} (${count})`);
      }
    }

    expect(offenders, "Sanitized<> may only be minted in release-rescue-pipeline.ts").toEqual([]);
    // Two: `sanitizeReportInput` and `withSanitizedHolds`, which takes that
    // function's own outputs. A third needs a reason.
    expect(total, "each producer is a way around redaction").toBe(2);
  });

  it("is idempotent, so building twice is safe", () => {
    // A report input has no free-text field to carry the credential any more, so
    // the idempotence property is asserted where the sanitiser genuinely has
    // work to do: an arbitrary object, which is what it takes.
    const raw = { report: makeReportInput(), stray: `DB_PASSWORD=${SECRETS.compose}` };
    const once = sanitizeReportInput(raw);
    const twice = sanitizeReportInput(once.value);

    expect(JSON.stringify(twice.value)).toBe(JSON.stringify(once.value));
    expect(JSON.stringify(once.value)).not.toContain(SECRETS.compose);
  });
});

describe("the public intake form", () => {
  it("refuses input that confidently holds a credential", () => {
    const result = parseRescueIntake({ evidenceNotes: `DB_PASSWORD=${SECRETS.compose}` });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("looks like a credential");
  });

  it("accepts ordinary security language and vendor names", () => {
    for (const notes of [
      "Auth: Clerk. Payments: Stripe. Database: Neon.",
      "Auth: Supabase. Secrets: Cloudflare Workers KV.",
      "Password: rotation is manual today.",
      "Authorization: object-level checks are missing on three routes.",
      "API key: Contentful, rotated quarterly.",
    ]) {
      const result = parseRescueIntake({ evidenceNotes: notes });
      expect(JSON.stringify(result), notes).not.toContain("looks like a credential");
    }
  });
});
