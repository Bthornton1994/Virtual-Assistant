import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORBIDDEN_NARRATIVE_FIELDS,
  FORBIDDEN_REPORT_TEXT_FIELDS,
  FORBIDDEN_SOURCE_FIELDS,
  findForbiddenSourceField,
  findSourceFieldsInFindings,
  findingEvidenceSchema,
  releaseRescueFindingV1Schema,
  repositoryPathSchema,
} from "@/lib/release-rescue-findings";
import {
  assessmentEvidenceSchema,
  buildReleaseRescueReport,
  releaseRescueDeliveryGate,
  hashReleaseRescueReport,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { toCustomerReportView, findInternalIdentityLeaks } from "@/lib/release-rescue-presentation";
import { REPORT_FIELD_POLICY } from "@/lib/release-rescue-field-policy";
import {
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";

// The owner decision, as tests: a finding POINTS AT source and never carries it.
//
// Ten independent audits attacked the credential detector whose job was to make a
// copied source excerpt safe to ship. The tenth reported that detector both
// leaking credentials and permanently bricking correct reports in the same
// commit. The excerpt is gone, so the property is structural: there is no
// customer source in the excerpt field to redact wrongly — and, after an eleventh
// audit, none in `locations[].path` or in a quoted credential construct either.
// What remains is free-text prose an auditor writes, which is not proven to be
// free of quoted source and is not claimed to be; see `release-rescue-prose.ts`.
//
// These tests are about the ABSENCE of a field, which is why they can be
// exhaustive in a way the detector tests never could.

/**
 * Credential values across the shapes that defeated the detector, round by round.
 *
 * Punctuation and whitespace INSIDE the value are what audit 10 found; quotes,
 * delimiters, comments and URL carriers are earlier rounds; the common-word
 * passwords are what people actually choose. None of it matters any more, and
 * these assert that it does not.
 */
function credentialCorpus(): string[] {
  const bodies = ["Xk92mQvn7Lz", "hunter2hunter", "AKIAIOSFODNN7EXAMPLE", "9f86d081884c"];
  const values = new Set<string>();

  for (const body of bodies) {
    values.add(body);
    for (const inner of ["#", "&", "(", ")", ";", "'", '"', " ", "\t", "<", ">", "|", "%", "*", ","]) {
      values.add(`Ab${inner}${body}`);
      values.add(`${body}${inner}cd`);
    }
    for (const affix of ["-", "_", "$", ".", "--", "//", "#"]) {
      values.add(`${affix}${body}`);
      values.add(`${body}${affix}`);
    }
    // Multiline carriers and URLs.
    values.add(`line one\n${body}\nline three`);
    values.add(`postgres://user:${body}@db.internal:5432/app`);
    values.add(`redis://default:${body}@cache:6379/0`);
    values.add(`${body} # rotate quarterly`);
    values.add(`${body} // set by deploy`);
  }
  // Common-word passwords.
  for (const common of ["password", "secret", "letmein", "qwerty", "changeit", "admin123"]) {
    values.add(common);
  }
  return [...values];
}

const CORPUS = credentialCorpus();

/** The shape a real source file has, planted with a credential. */
function sourceCarrying(value: string): string[] {
  return [
    `DB_PASSWORD=${value}`,
    `db_password: ${value}`,
    `{"password": "${value}"}`,
    `services:\n  db:\n    environment:\n      - DB_PASSWORD=${value}`,
    `user,password\nadmin,${value}`,
    `machine api.example.com login deploy password ${value}`,
    `const key = "${value}"; // do not commit`,
  ];
}

describe("a finding cannot carry source, in any field a caller might try", () => {
  it("rejects every forbidden field name on a location", () => {
    const accepted: string[] = [];
    let checked = 0;

    for (const field of FORBIDDEN_SOURCE_FIELDS) {
      for (const value of CORPUS.slice(0, 40)) {
        checked += 1;
        const parsed = releaseRescueFindingV1Schema.safeParse(
          makeFinding({
            locations: [{ path: "src/a.ts", startLine: 1, endLine: 2, [field]: value } as never],
          }),
        );
        if (parsed.success) accepted.push(`${field}=${value}`);
      }
    }

    expect(checked).toBeGreaterThan(800);
    expect(accepted, `${accepted.length} source-carrying fields were accepted`).toEqual([]);
  });

  it("rejects a whole source file pasted into a legacy excerpt field", () => {
    const accepted: string[] = [];

    for (const value of CORPUS.slice(0, 25)) {
      for (const source of sourceCarrying(value)) {
        const parsed = releaseRescueFindingV1Schema.safeParse(
          makeFinding({
            locations: [{ path: "docker-compose.yml", startLine: 1, endLine: 8, excerpt: source } as never],
          }),
        );
        if (parsed.success) accepted.push(source.slice(0, 40));
      }
    }

    expect(accepted, `${accepted.length} pasted source files were accepted`).toEqual([]);
  });

  it("names the field it refused, without quoting what was in it", () => {
    // A legacy caller should learn what changed. The planted value must not
    // travel in the refusal, because an error message reaches logs.
    const secret = "Xk92mQvn7LzPr0dQ";
    const parsed = releaseRescueFindingV1Schema.safeParse(
      makeFinding({
        locations: [{ path: "src/a.ts", startLine: 1, endLine: 1, excerpt: secret } as never],
      }),
    );

    expect(parsed.success).toBe(false);
    const message = parsed.success ? "" : JSON.stringify(parsed.error.issues);
    expect(message).toContain("excerpt");
    expect(message, "the refusal must not carry the planted value").not.toContain(secret);
    expect(findForbiddenSourceField({ excerpt: secret })).toBe("excerpt");
  });
});

describe("no source-derived text crosses the persistence boundary", () => {
  function deliverableReport() {
    return buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            locations: [{ path: "src/app/api/orders/route.ts", startLine: 18, endLine: 27 }],
          }),
        ],
      }),
    );
  }

  it("refuses to build an artifact when a credential is planted in the removed field", () => {
    // This test used to iterate the corpus against a report THE CORPUS WAS NEVER
    // GIVEN TO, which is a tautology: it stayed green with the excerpt field
    // fully restored. An audit caught it by re-adding
    // `excerpt: z.string().optional()` and re-running.
    //
    // The discriminating version plants each value where it would have lived and
    // asserts no artifact comes out. Restore the field and this goes red.
    const built: string[] = [];
    const leakedInRefusal: string[] = [];

    for (const value of CORPUS.slice(0, 60)) {
      if (value.trim().length === 0) continue;
      let message = "";
      try {
        buildReleaseRescueReport(
          makeReportInput({
            findings: [
              makeFinding({
                locations: [
                  { path: "config/app.env", startLine: 1, endLine: 1, excerpt: value } as never,
                ],
              }),
            ],
          }),
        );
        built.push(value);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // `password` and friends are ordinary English and appear in the guidance
      // text of the refusal itself, so the substring check skips plain words.
      const dictionary = new Set(["password", "secret", "letmein", "qwerty", "changeit", "admin123"]);
      if (!dictionary.has(value) && message.includes(value)) leakedInRefusal.push(value);
    }

    expect(built, `${built.length} planted credentials produced an artifact`).toEqual([]);
    expect(leakedInRefusal, `${leakedInRefusal.length} refusals quoted the planted value`).toEqual([]);
  });

  it("carries no credential in the artifact a correct finding produces", () => {
    const report = deliverableReport();
    const serialized = JSON.stringify(report);
    const view = JSON.stringify(toCustomerReportView(report));

    // Weaker than the test above by construction — the builder was never given
    // these — and kept only as a floor. The test above is the one that binds.
    const dictionary = new Set(["password", "secret", "letmein", "qwerty", "changeit", "admin123"]);
    const leaked = CORPUS.filter(
      (value) =>
        !dictionary.has(value) && value.trim().length > 0 &&
        (serialized.includes(value) || view.includes(value)),
    );

    expect(leaked).toEqual([]);
  });

  it("accepts a location with exactly three keys and refuses a fourth, whatever it is named", () => {
    // Also caught by the audit's mutation: reading `Object.keys()` off a fixture
    // that never sets a fourth key proves nothing about the schema. This drives
    // from the schema instead, over the forbidden names AND over names nobody
    // has thought of, so re-adding any of them goes red.
    const accepted: string[] = [];

    for (const field of [
      ...FORBIDDEN_SOURCE_FIELDS,
      "sourceCode", "fileContent", "quote", "lineRange", "before", "after", "blob", "zzz",
    ]) {
      const parsed = releaseRescueFindingV1Schema.safeParse(
        makeFinding({
          locations: [{ path: "src/a.ts", startLine: 1, endLine: 2, [field]: "x" } as never],
        }),
      );
      if (parsed.success) accepted.push(field);
    }

    expect(accepted, `${accepted.length} fourth keys were accepted on a location`).toEqual([]);

    // And the three that are kept really are kept.
    const ok = releaseRescueFindingV1Schema.safeParse(
      makeFinding({ locations: [{ path: "src/a.ts", startLine: 1, endLine: 2 }] }),
    );
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(Object.keys(ok.data.locations[0]).sort()).toEqual(["endLine", "path", "startLine"]);
    }
  });

  it("classifies no excerpt path in the field-coverage policy", () => {
    const sourcePaths = Object.keys(REPORT_FIELD_POLICY).filter((path) =>
      FORBIDDEN_SOURCE_FIELDS.some((field) => path.endsWith(`.${field}`)),
    );

    expect(sourcePaths, "the policy still classifies a source-carrying path").toEqual([]);
  });
});

describe("the finding is still worth paying for", () => {
  it("keeps path, line range, check, severity, observation and remediation", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
            remediationCode: "scope_query_by_authenticated_principal",
            locations: [{ path: "src/app/api/orders/route.ts", startLine: 18, endLine: 27 }],
          }),
        ],
      }),
    );
    const finding = report.findings[0];
    const view = toCustomerReportView(report).findings[0];

    expect(finding.locations[0].path).toBe("src/app/api/orders/route.ts");
    expect(finding.locations[0].startLine).toBe(18);
    expect(finding.locations[0].endLine).toBe(27);
    expect(finding.rubricCheckId).toBe("authz.object_level_authorization");
    expect(finding.severity.length).toBeGreaterThan(0);
    // The words are the catalog's, reached through the code the finding stores.
    const rendered = toCustomerReportView(report).findings[0];
    expect(rendered.whatWeObserved.length).toBeGreaterThan(20);
    expect(rendered.recommendation.length).toBeGreaterThan(20);

    // And the customer sees the citation, rendered.
    expect(view.locations[0].path).toBe("src/app/api/orders/route.ts");
    expect(view.locations[0].lineRange).toContain("18");
  });

  it("renders no source block in the report view component", () => {
    // A source-level assertion, because the component is what a customer reads.
    // If someone re-adds a <pre><code> of customer source, this fails.
    const source = readFileSync(
      resolve(process.cwd(), "src/components/ai-app-release-rescue/report-view.tsx"),
      "utf8",
    );

    for (const field of FORBIDDEN_SOURCE_FIELDS) {
      expect(source, `report-view.tsx references location.${field}`).not.toContain(`location.${field}`);
    }
  });
});

describe("the decision is bound to the database, not only to TypeScript", () => {
  const MIGRATION = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260916050000_release_rescue_excerpt_removal_v8.sql"),
    "utf8",
  );
  const DEEPENED = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260916060000_release_rescue_path_shape_v9.sql"),
    "utf8",
  );

  const STRUCTURED = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/20260916140000_release_rescue_structured_observations_v10.sql",
    ),
    "utf8",
  );

  /** The names inside a named SQL array-returning function. */
  function sqlFields(source: string, fn: string): string[] {
    const body = new RegExp(`${fn}\\(\\)[\\s\\S]*?select array\\[([\\s\\S]*?)\\]`).exec(source);
    expect(body, `the SQL list for ${fn} could not be located, so this test proves nothing`).not.toBeNull();
    return [...body![1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  }

  it("refuses the same source field names in SQL as in TypeScript, in both directions", () => {
    // Two lists in two languages drift apart silently. An earlier version of
    // this test only checked TS → SQL, so a name added to SQL alone, or a later
    // migration shortening the SQL array, passed. An audit named that.
    //
    // Read from v8, which is where this list is defined. v10 REPLACES the
    // function that returns it, so the test below reads v10 for the composed
    // list — both are asserted, because either one drifting is a hole.
    const inSql = sqlFields(MIGRATION, "release_rescue_forbidden_source_fields");

    expect(inSql.length, "the parsed SQL list is implausibly short").toBeGreaterThan(20);
    expect(
      FORBIDDEN_SOURCE_FIELDS.filter((field) => !inSql.includes(field)),
      "refused in TypeScript but not in SQL",
    ).toEqual([]);
    expect(
      inSql.filter((field) => !FORBIDDEN_SOURCE_FIELDS.includes(field)),
      "refused in SQL but not in TypeScript",
    ).toEqual([]);
    expect([...inSql].sort()).toEqual([...FORBIDDEN_SOURCE_FIELDS].sort());
  });

  it("refuses the same NARRATIVE field names in SQL as in TypeScript, in both directions", () => {
    // The Option 1 half. These are the fields that carried an executor's or a
    // customer's sentences: a finding's title and observation, an assessment's
    // rationale, the report's limitations, a reviewer's clearance note. They are
    // refused for a different reason from the source fields, so they are a
    // separate list in both languages — and both languages have to agree.
    const inSql = sqlFields(STRUCTURED, "release_rescue_forbidden_narrative_fields");

    expect(inSql.length, "the parsed SQL list is implausibly short").toBeGreaterThan(20);
    expect(
      FORBIDDEN_NARRATIVE_FIELDS.filter((field) => !inSql.includes(field)),
      "refused in TypeScript but not in SQL",
    ).toEqual([]);
    expect(
      inSql.filter((field) => !FORBIDDEN_NARRATIVE_FIELDS.includes(field)),
      "refused in SQL but not in TypeScript",
    ).toEqual([]);
    expect([...inSql].sort()).toEqual([...FORBIDDEN_NARRATIVE_FIELDS].sort());
  });

  it("composes the two lists the same way in SQL as in TypeScript", () => {
    // v10 replaces `release_rescue_forbidden_source_fields()` with the
    // concatenation of both lists, so that the single walker v9 added sees
    // everything in one pass. `FORBIDDEN_REPORT_TEXT_FIELDS` is that same
    // concatenation, and it is what `findForbiddenSourceField` actually uses.
    const composed = sqlFields(STRUCTURED, "release_rescue_forbidden_source_fields");
    const narrative = sqlFields(STRUCTURED, "release_rescue_forbidden_narrative_fields");

    // The v10 definition ends with `|| release_rescue_forbidden_narrative_fields()`,
    // so the literal it parses is the source half alone.
    expect(STRUCTURED).toContain("|| public.release_rescue_forbidden_narrative_fields()");
    expect([...composed, ...narrative].sort()).toEqual([...FORBIDDEN_REPORT_TEXT_FIELDS].sort());
  });

  it("keeps `reason` out of both lists, because a held report depends on it", () => {
    // The direction a too-wide list breaks. `unresolvedHolds[].reason` is one of
    // two fixed sentences this codebase owns, stored so a customer can be told
    // why their report is held. Refusing it would make every held report
    // unstorable — which is the denial-of-service shape three audits in this
    // workstream have already found, arriving inside a fix.
    expect(FORBIDDEN_REPORT_TEXT_FIELDS).not.toContain("reason");
    expect(sqlFields(STRUCTURED, "release_rescue_forbidden_narrative_fields")).not.toContain("reason");
  });

  it("collides with none of the contract's own key names, which is what lets the guard walk deep", () => {
    // The database guard recurses through the whole payload and folds key case.
    // That is only safe while no legitimate field in this contract is named like
    // a forbidden one. This is the census that keeps it safe: add a field called
    // `context` or `body` to a report and this fails before the guard starts
    // refusing correct artifacts.
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(collect);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          keys.add(key.toLowerCase());
          collect(entry);
        }
      }
    };

    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
            remediationCode: "scope_query_by_authenticated_principal",
            locations: [{ path: "src/a.ts", startLine: 1, endLine: 2 }],
          }),
        ],
        limitationCodes: ["customer_excluded_part_of_the_repository"],
      }),
    );
    collect(report);
    collect(toCustomerReportView(report));

    expect(keys.size).toBeGreaterThan(60);
    expect(
      FORBIDDEN_SOURCE_FIELDS.filter((field) => keys.has(field.toLowerCase())),
      "a real report field is named like a forbidden one, so the deep guard would refuse it",
    ).toEqual([]);
  });

  it("installs the guard on the table the report body actually lands in", () => {
    expect(MIGRATION).toContain("on public.evidence_artifacts");
    expect(MIGRATION).toContain("before insert or update");
  });

  it("walks the whole payload, folds key case, and normalises the schema marker", () => {
    // Each of these is a shape an audit planted through the two-level guard and
    // got stored. Asserted against the migration text because the behaviour
    // itself is proven live in release_rescue_path_shape_v9_proof.sql.
    expect(DEEPENED).toContain("release_rescue_walk_source_fields");
    expect(DEEPENED).toContain("release_rescue_is_report");
    expect(DEEPENED, "key case must be folded").toContain("lower(v_key) = lower(v_name)");
    expect(DEEPENED, "the schema marker must be trimmed and lowered").toContain(
      "btrim(lower(v_value #>> '{}'))",
    );
    expect(DEEPENED, "recursion must be bounded").toContain("p_depth > 12");
  });
});

describe("the remaining pointer fields stay pointers", () => {
  // With the excerpt gone, the widest field still shaped like somewhere to put
  // source was an assessment's evidence `reference` — 500 characters of
  // unconstrained free text for what is meant to be a path or a test id.
  //
  // Option 1 finished the job: `reference` is gone too. An assessment's evidence
  // is now the same four typed fields a finding's evidence has — a kind from a
  // closed enum, a repository path under the path grammar, and two line numbers.
  // There is no string left on this path that is not one of those.

  it("has no free-text reference field left to put a quotation in", () => {
    for (const reference of [
      'const key = "sk_live_x";\nif (!key) throw new Error("missing");',
      "line one\nline two",
      "src/a.ts\r\nsrc/b.ts",
    ]) {
      // Refused as an unknown key, before anything looks at the text — which is
      // a stronger refusal than the length-and-newline rule it replaces, because
      // it does not depend on judging the content.
      const parsed = assessmentEvidenceSchema.safeParse({ kind: "code_reference", reference });
      expect(parsed.success, reference.slice(0, 24)).toBe(false);
    }
  });

  it("refuses a quotation in the path that replaced it", () => {
    // The field that remains is a path, and the path grammar is what bounds it:
    // no whitespace, no newline, no quote, bounded segments. A pasted source
    // window is not a legal path, structurally rather than by inspection.
    for (const path of [
      'const key = "sk_live_x";',
      "line one\nline two",
      "src/a.ts\r\nsrc/b.ts",
      "src/app/api orders/route.ts",
      `${"a".repeat(260)}/route.ts`,
    ]) {
      const parsed = assessmentEvidenceSchema.safeParse({
        kind: "code_reference",
        path,
        startLine: 1,
        endLine: 2,
      });
      expect(parsed.success, path.slice(0, 24)).toBe(false);
    }
  });

  it("still accepts the pointers a real assessment cites", () => {
    // The check that keeps the bound honest: the ordinary citations an auditor
    // needs must still parse, including the bracketed route segments and the
    // dotted filenames this codebase is full of.
    for (const path of [
      "src/app/api/orders/route.ts",
      "src/app/api/orders/[id]/route.ts",
      "src/app/api/auth/[...nextauth]/route.ts",
      "package.json",
      "SECURITY.md",
      ".github/workflows/ci.yml",
      "supabase/migrations/0007_release_rescue.sql",
    ]) {
      const parsed = assessmentEvidenceSchema.safeParse({
        kind: "code_reference",
        path,
        startLine: 1,
        endLine: null,
      });
      expect(parsed.success, path).toBe(true);
    }
  });

  it("is the same schema a finding's evidence uses, so there is one bound to reason about", () => {
    // Two shapes for the same thing is how the `reference` gap survived a
    // dedicated audit: the findings walk was tightened and the assessments one
    // was not. They are now literally the same schema object.
    expect(assessmentEvidenceSchema).toBe(findingEvidenceSchema);
  });
});

describe("the boundaries the decision must not disturb", () => {
  it("still refuses delivery without a named human reviewer", () => {
    const unsigned = buildReleaseRescueReport(makeReportInput({ reviewedBy: null }));
    const gate = releaseRescueDeliveryGate(unsigned, validateReleaseRescueReport(unsigned));

    expect(gate.deliverable).toBe(false);
  });

  it("still keeps internal identity out of the customer's copy", () => {
    const report = buildReleaseRescueReport(makeReportInput());

    expect(findInternalIdentityLeaks(toCustomerReportView(report), report)).toEqual([]);
  });

  it("still produces a deterministic artifact hash", () => {
    // Delivery is bound to the content hash, so the same report must hash the
    // same way twice or the binding means nothing.
    const a = buildReleaseRescueReport(makeReportInput());
    const b = buildReleaseRescueReport(makeReportInput());

    expect(hashReleaseRescueReport(a)).toBe(hashReleaseRescueReport(b));
    expect(hashReleaseRescueReport(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still derives severity and verdict rather than accepting them", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [makeFinding({
            observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
            remediationCode: "scope_query_by_authenticated_principal" })],
      }),
    );

    expect(validateReleaseRescueReport(report).hardGatePass).toBe(true);
    expect(report.verdict.length).toBeGreaterThan(0);
  });
});

// Ways to join two lines of source into one string. Built from character codes
// rather than escapes so that what this file says and what it contains cannot
// come apart — a control character written into a source file by accident is
// invisible in review, and this suite exists because of exactly that class.
const LINE_JOINERS: readonly string[] = [
  String.fromCharCode(10), // newline
  String.fromCharCode(13) + String.fromCharCode(10), // CRLF
  String.fromCharCode(13), // carriage return
  String.fromCharCode(9), // tab
  String.fromCharCode(11), // vertical tab
  String.fromCharCode(12), // form feed
  String.fromCharCode(1), // start of heading
  String.fromCharCode(27), // escape
  String.fromCharCode(127), // delete
];

/** True when a string holds a C0/C1 control character. */
function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

describe("the one field left that comes from the customer's repository", () => {
  // With `excerpt` gone, a boundary sweep asked what remains in a finding whose
  // VALUE is taken from the reviewed repository. The answer was
  // `locations[].path`, and it had no shape: `identifierString.max(400)` refused
  // an absolute path, `..` and `://`, and accepted four hundred characters of
  // anything else, newlines included. A source window pasted there would have
  // validated, stored, and rendered under a "Where" heading — the same channel
  // the decision closed, reopened under a different field name.

  it("refuses a source window pasted into a path, however its lines are joined", () => {
    const accepted: string[] = [];
    let checked = 0;

    for (const joiner of LINE_JOINERS) {
      for (const value of CORPUS.slice(0, 30)) {
        for (const source of sourceCarrying(value).slice(0, 3)) {
          checked += 1;
          const candidate = `src/app/api/orders/route.ts${joiner}${source}`;
          if (repositoryPathSchema.safeParse(candidate).success) {
            accepted.push(JSON.stringify(candidate.slice(0, 40)));
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(700);
    expect(accepted, `${accepted.length} pasted source windows validated as a path`).toEqual([]);
  });

  it("refuses a parent-traversal segment without refusing a route bracket", () => {
    for (const walking of ["../secrets/.env", "src/../../etc/passwd", "a/../b", "./src/a.ts"]) {
      expect(repositoryPathSchema.safeParse(walking).success, walking).toBe(false);
    }
    for (const bracketed of ["app/api/[...all]/route.ts", "app/[[...slug]]/page.tsx"]) {
      expect(repositoryPathSchema.safeParse(bracketed).success, bracketed).toBe(true);
    }
  });

  it("refuses a sentence in the path field, which is what spaces allowed", () => {
    // The stated cost: `docs/Architecture Overview.md` is refused too. Spaces
    // were allowed so a file name with one would validate, and an audit used
    // that to put a sixty-word sentence carrying a credential in the field — it
    // validated, stored, and rendered as a path. An auditor whose customer has a
    // space in a file name cites the directory instead.
    for (const sentence of [
      "config app.env holds the value Xk92mQvn7Lz on line 14",
      "the order route reads the token without checking ownership",
      "docs/Architecture Overview.md",
    ]) {
      expect(repositoryPathSchema.safeParse(sentence).success, sentence.slice(0, 40)).toBe(false);
    }
  });

  it("refuses the punctuation a line of source needs and a path does not", () => {
    const accepted: string[] = [];

    for (const candidate of [
      'const password = "hunter2";',
      "db_password: hunter2",
      "DB_PASSWORD=hunter2",
      "{ password: 'hunter2' }",
      "a | b",
      "a && b",
      "a; b",
      "a?b",
      "a*b",
      "a<b>c",
      "a=b", // `=` stays out: it is the character the prose contract keys on
      "src/a.ts:18",
      "src/a.ts  is where", // a double space is prose, not a file name
      "src//a.ts", // an empty segment
      "src/a.ts/", // a trailing separator
      " src/a.ts",
      "src/a.ts ",
      `src/${"a".repeat(256)}.ts`, // over the per-segment cap
      "a".repeat(401), // over the whole-path cap
    ]) {
      if (repositoryPathSchema.safeParse(candidate).success) accepted.push(candidate.slice(0, 40));
    }

    expect(accepted, `${accepted.length} source-shaped strings validated as a path`).toEqual([]);
  });

  it("still accepts every path a real repository has, including this one's", () => {
    const refused: string[] = [];

    for (const candidate of [
      "src/app/api/orders/[id]/route.ts",
      "src/app/expenses/[id]/page.tsx",
      "src/components/ai-app-release-rescue/report-view.tsx",
      "supabase/migrations/20260916060000_release_rescue_path_shape_v9.sql",
      "docker-compose.yml",
      "package.json",
      ".env.example",
      ".github/workflows/verify.yml",
      "Makefile",
      "LICENSE",
      "node_modules/@scope/pkg/index.js",
      "vendor/lib-v1.2.3+build/main.c",
      "a",
      // Catch-all and optional-catch-all routes. An audit found these refused by
      // a `!value.includes("..")` rule present since this workstream's first
      // commit — so an auth finding on the most common auth entry point in the
      // target framework could not cite a location, and a confirmed finding must.
      "app/api/auth/[...nextauth]/route.ts",
      "pages/api/auth/[...nextauth].ts",
      "app/docs/[[...slug]]/page.tsx",
      "app/[locale]/[...slug]/page.tsx",
      // File names are not ASCII in most of the world.
      "src/r\u00e9sum\u00e9.ts",
      "src/\u65e5\u672c\u8a9e/page.tsx",
      // Remix and React Router v7 name every dynamic route this way, and an
      // audit found the first version of this grammar refusing all of them.
      "app/routes/users.$userId.edit.tsx",
      "app/routes/concerts.$city.tsx",
      "src/{shared,server}/index.ts",
      "test/fixtures/it's-broken.txt",
      "docs/issue#42.md",
      "data/2024,q1.csv",
      "src/r&d/index.ts",
      "public/assets/logo%20v2.png",
      `src/${"a".repeat(250)}.ts`, // long, but inside the per-segment cap
    ]) {
      if (!repositoryPathSchema.safeParse(candidate).success) refused.push(candidate);
    }

    expect(refused, `${refused.length} real repository paths were refused`).toEqual([]);
  });

  it("does not deliver a report whose path is itself a credential", () => {
    // The honest limit of a grammar: `AKIAIOSFODNN7EXAMPLE` is a legal file
    // name, so no path shape can refuse it. The grammar removes the CHANNEL, a
    // pasted window; the scanner covers what still fits through it. This asserts
    // the OUTCOME rather than which control answered, because pinning the
    // mechanism is how a case ends up passing for the wrong reason.
    const token = "AKIAIOSFODNN7EXAMPLE";
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [makeFinding({ locations: [{ path: token, startLine: 1, endLine: 1 }] })],
      }),
    );
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.deliverable, "a credential-shaped path must not reach a customer").toBe(false);
    expect(JSON.stringify(report)).not.toContain(token);
    expect(JSON.stringify(toCustomerReportView(report))).not.toContain(token);
  });
});

describe("the refusal is enforced where input arrives untyped, not only at a schema", () => {
  // `.strict()` refuses an unknown key, but only for input that reaches a
  // schema. Assembly takes findings as typed values and never parses them, so a
  // caller holding the input as `any` — or an old stored payload deserialised
  // back into one — reached the artifact with an `excerpt` intact. The named
  // refusal now runs at both of those boundaries, on the same scope the database
  // trigger walks.
  const SECRET = "VICTIM-SECRET-STRING-abc123";

  it("names the sightings on a finding and on its locations", () => {
    expect(
      findSourceFieldsInFindings([
        { findingId: "f-001", locations: [{ path: "src/a.ts", excerpt: SECRET }] },
        { findingId: "f-002", snippet: SECRET, locations: [{ path: "src/b.ts" }] },
      ]),
    ).toEqual([
      { at: "findings[0].locations[0]", field: "excerpt" },
      { at: "findings[1]", field: "snippet" },
    ]);
  });

  it("is quiet about input that is not findings at all", () => {
    for (const value of [undefined, null, "findings", 7, {}, [], [null], [{ locations: "none" }]]) {
      expect(findSourceFieldsInFindings(value)).toEqual([]);
    }
  });

  it("refuses at assembly, so no artifact is built", () => {
    let message = "(no refusal)";
    try {
      buildReleaseRescueReport(
        makeReportInput({
          findings: [
            makeFinding({
              locations: [{ path: "src/a.ts", startLine: 1, endLine: 1, excerpt: SECRET } as never],
            }),
          ],
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("(no refusal)");
    expect(message).toContain("findings[0].locations[0].excerpt");
    expect(message, "a refusal reaches logs; it must not carry the value").not.toContain(SECRET);
  });

  it("refuses at validation, naming the field rather than calling the key unrecognised", () => {
    // A stored artifact written by an older build, read back as `unknown`.
    const built = buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "controls_present_and_evidenced",
        }),
        findings: [
          makeFinding({
            observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
            remediationCode: "scope_query_by_authenticated_principal",
            locations: [{ path: "src/app/api/orders/route.ts", startLine: 18, endLine: 27 }],
          }),
        ],
      }),
    );
    const stored = JSON.parse(JSON.stringify(built)) as {
      findings: Array<{ locations: Array<Record<string, unknown>> }>;
    };
    stored.findings[0].locations[0].excerpt = SECRET;

    const result = validateReleaseRescueReport(stored);
    const failures = result.hardFailures.join(" | ");

    expect(result.hardGatePass).toBe(false);
    expect(failures).toContain("findings[0].locations[0].excerpt");
    expect(failures).not.toContain(SECRET);
  });

  it("says nothing about source fields when a report is merely malformed", () => {
    const result = validateReleaseRescueReport({ schemaVersion: "release-rescue-report/v1" });

    expect(result.hardGatePass).toBe(false);
    expect(result.hardFailures.join(" | ")).not.toContain("source-bearing");
  });
});

describe("the path rule the database enforces is weaker than the one the app enforces", () => {
  // Deliberately, and in that direction only. A row guard STRICTER than the
  // application would refuse reports the application considers correct, leaving
  // an operator holding an undeliverable report with nothing to act on — the
  // failure shape the tenth audit was about. So the trigger takes the subset
  // that is unambiguous in both dialects, and this asserts the application
  // refuses everything the trigger refuses.
  const MIGRATION = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260916060000_release_rescue_path_shape_v9.sql"),
    "utf8",
  );

  /** The trigger's rule, mirrored. Bound to the file by the assertion below. */
  const refusedBySql = (path: string) => hasControlCharacter(path) || path.length > 400;

  it("states that rule in the migration, so this mirror is not fiction", () => {
    expect(MIGRATION).toContain("[[:cntrl:]]");
    expect(MIGRATION).toContain("length(v_path) > 400");
    expect(MIGRATION).toContain("on public.evidence_artifacts");
    expect(MIGRATION).toContain("before insert or update");
  });

  it("refuses in TypeScript every path the trigger refuses", () => {
    const disagreements: string[] = [];
    let checked = 0;

    const candidates = [
      ...LINE_JOINERS.map((joiner) => `src/a.ts${joiner}const password = "hunter2";`),
      "a".repeat(401),
      "a".repeat(500),
      `src/${"a".repeat(420)}.ts`,
      ...CORPUS.slice(0, 40).map((value) => `config/app.env${String.fromCharCode(10)}${value}`),
    ];

    for (const candidate of candidates) {
      if (!refusedBySql(candidate)) continue;
      checked += 1;
      if (repositoryPathSchema.safeParse(candidate).success) {
        disagreements.push(JSON.stringify(candidate.slice(0, 40)));
      }
    }

    expect(checked).toBeGreaterThan(40);
    expect(disagreements, `${disagreements.length} paths the database refuses, TypeScript accepts`)
      .toEqual([]);
  });
});
