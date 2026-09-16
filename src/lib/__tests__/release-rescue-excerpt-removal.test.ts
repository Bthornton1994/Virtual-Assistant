import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FORBIDDEN_SOURCE_FIELDS,
  findForbiddenSourceField,
  releaseRescueFindingV1Schema,
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
// customer source in the artifact to redact wrongly, to leak, or to argue about.
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
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [
          makeFinding({
            whatWeObserved: "The order route loads a record by id without an ownership check.",
            recommendation: "Scope the query by the authenticated organization.",
            locations: [{ path: "src/app/api/orders/route.ts", startLine: 18, endLine: 27 }],
          }),
        ],
      }),
    );
  }

  it("carries no credential from the reviewed source, in the artifact or the customer view", () => {
    const report = deliverableReport();
    const serialized = JSON.stringify(report);
    const view = JSON.stringify(toCustomerReportView(report));
    const leaked: string[] = [];

    for (const value of CORPUS) {
      // The value was never given to the builder — that is the point. It exists
      // only in the source the scanner read transiently.
      if (serialized.includes(value) || view.includes(value)) leaked.push(value);
    }

    // The common-word passwords are ordinary English and legitimately appear in
    // rubric titles and disclaimers, so they are excluded from a substring test.
    const dictionary = new Set(["password", "secret", "letmein", "qwerty", "changeit", "admin123"]);
    expect(leaked.filter((v) => !dictionary.has(v))).toEqual([]);
  });

  it("has no location field beyond a path and a line range", () => {
    const report = deliverableReport();

    for (const finding of report.findings) {
      for (const location of finding.locations) {
        expect(Object.keys(location).sort()).toEqual(["endLine", "path", "startLine"]);
      }
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
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [
          makeFinding({
            rubricCheckId: "authz.object_level_authorization",
            whatWeObserved: "The order route loads a record by id without an ownership check.",
            whyItMatters: "Any authenticated customer can read another customer's orders.",
            recommendation: "Scope the query by the authenticated organization.",
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
    expect(finding.whatWeObserved.length).toBeGreaterThan(20);
    expect(finding.recommendation.length).toBeGreaterThan(20);

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

  it("refuses the same field names in SQL as in TypeScript", () => {
    // Two lists in two languages drift apart silently. This is what stops that.
    const missing = FORBIDDEN_SOURCE_FIELDS.filter((field) => !MIGRATION.includes(`'${field}'`));

    expect(missing, `${missing.length} fields are refused in TypeScript but not in SQL`).toEqual([]);
  });

  it("installs the guard on the table the report body actually lands in", () => {
    expect(MIGRATION).toContain("on public.evidence_artifacts");
    expect(MIGRATION).toContain("before insert or update");
  });
});

describe("the remaining pointer fields stay pointers", () => {
  // With the excerpt gone, the widest field still shaped like somewhere to put
  // source was an assessment's evidence `reference` — 500 characters of
  // unconstrained free text for what is meant to be a path or a test id.
  it("refuses a quotation in an evidence reference", () => {
    const quoted = [
      'const key = "sk_live_x";\nif (!key) throw new Error("missing");',
      "line one\nline two",
      "src/a.ts\r\nsrc/b.ts",
    ];

    for (const reference of quoted) {
      const parsed = assessmentEvidenceSchema.safeParse({ kind: "code_reference", reference });
      expect(parsed.success, reference.slice(0, 24)).toBe(false);
    }
  });

  it("still accepts the pointers a real assessment cites", () => {
    for (const reference of [
      "src/app/api/orders/route.ts",
      "package.json#dependencies",
      "test:authz.object_level_authorization",
      "SECURITY.md",
    ]) {
      const parsed = assessmentEvidenceSchema.safeParse({ kind: "code_reference", reference });
      expect(parsed.success, reference).toBe(true);
    }
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
          rationale: "Order lookup returns records the caller does not own.",
        }),
        findings: [makeFinding({ rubricCheckId: "authz.object_level_authorization" })],
      }),
    );

    expect(validateReleaseRescueReport(report).hardGatePass).toBe(true);
    expect(report.verdict.length).toBeGreaterThan(0);
  });
});
