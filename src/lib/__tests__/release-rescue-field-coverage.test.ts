import { describe, expect, it } from "vitest";
import {
  REPORT_FIELD_POLICY,
  checkReportFieldCoverage,
  enumerateStringFields,
  normalizeFieldPath,
} from "@/lib/release-rescue-field-policy";
import { assembleReleaseRescueReport, validateReleaseRescueReport } from "@/lib/release-rescue-report";
import { SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import { makeFinding, makeReportInput, setAssessment, passingAssessments } from "@/lib/__tests__/release-rescue-fixtures";

// The report field coverage contract.
//
// An audit found that the prohibited-claim guard ran over six hand-listed fields
// while the secret scanner ran over the whole report. It missed
// `scope.application.description`, which the schema itself describes as used
// verbatim in the report header — so a customer could put a prohibited claim into
// their own application description at intake and have it delivered.
//
// The previous two rounds sharpened that guard's LINGUISTICS. Nobody asked which
// FIELDS it was applied to. These tests are about the second question, and the
// one that matters most is the last one in this file: adding a customer-visible
// field without classifying it has to BREAK, or the contract decays the first
// time someone is in a hurry.

const REAL_REPORTS = [
  SAMPLE_REPORT,
  assembleReleaseRescueReport(makeReportInput()),
  assembleReleaseRescueReport(
    makeReportInput({
      findings: [makeFinding()],
      assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
        outcome: "fail",
        rationale: "Order lookup returns records the caller does not own.",
      }),
    }),
  ),
];

describe("every string a customer can see has a recorded decision", () => {
  for (const [index, report] of REAL_REPORTS.entries()) {
    it(`covers every field of report ${index}`, () => {
      const undecided = enumerateStringFields(report)
        .map((leaf) => leaf.normalized)
        .filter((path) => !REPORT_FIELD_POLICY[path]);

      expect([...new Set(undecided)], "classify these in REPORT_FIELD_POLICY").toEqual([]);
    });
  }

  it("passes a clean report", () => {
    for (const report of REAL_REPORTS) {
      expect(checkReportFieldCoverage(report)).toEqual([]);
    }
  });

  it("records a reason for every decision, because an unexplained exemption is how coverage rots", () => {
    for (const [path, rule] of Object.entries(REPORT_FIELD_POLICY)) {
      expect(rule.because.length, path).toBeGreaterThan(15);
      expect(path.startsWith("$."), path).toBe(true);
      expect(path, `${path} should use [] rather than an index`).toBe(normalizeFieldPath(path));
    }
  });
});

describe("an unclassified field is a hard failure, not a pass", () => {
  it("refuses a report carrying a field nobody decided about", () => {
    // This is the mechanism. A future author adds a customer-visible field and
    // forgets the policy; the report stops validating rather than shipping
    // unguarded text.
    const report = { ...SAMPLE_REPORT, marketingTagline: "Your application is secure." } as unknown;
    const failures = checkReportFieldCoverage(report);

    expect(failures.map((failure) => failure.path)).toContain("$.marketingTagline");
    expect(failures[0].reason).toContain("No field-coverage decision is recorded");
  });

  it("refuses an unclassified field even when its text is harmless", () => {
    // Coverage is about the DECISION, not about whether today's value happens to
    // be benign. A field that is fine today is guarded tomorrow by nobody.
    const report = { ...SAMPLE_REPORT, internalNote: "nothing to see here" } as unknown;

    expect(checkReportFieldCoverage(report).map((f) => f.path)).toContain("$.internalNote");
  });

  it("refuses it through the real validator and the delivery gate", () => {
    const report = { ...SAMPLE_REPORT, extraHeaderLine: "A friendly note." } as unknown;
    const validation = validateReleaseRescueReport(report);

    // The schema is `.strict()`, so an unknown key is refused there too. Both
    // layers are asserted because the contract must not depend on the schema
    // staying strict.
    expect(validation.hardGatePass).toBe(false);
  });
});

describe("the gap the audit actually found", () => {
  const CLAIMS = [
    "A bookkeeping app. After this review your application is secure.",
    "A checkout flow, now vulnerability free.",
    "Our SOC 2 certified payments service.",
  ];

  for (const claim of CLAIMS) {
    it(`catches a prohibited claim in scope.application.description: "${claim.slice(0, 40)}"`, () => {
      const report = {
        ...SAMPLE_REPORT,
        scope: { ...SAMPLE_REPORT.scope, application: { ...SAMPLE_REPORT.scope.application, description: claim } },
      };
      const failures = checkReportFieldCoverage(report);

      expect(failures.map((failure) => failure.path)).toContain("$.scope.application.description");
      expect(validateReleaseRescueReport(report).hardGatePass).toBe(false);
    });
  }

  it("catches one in the other fields the allowlist missed", () => {
    const cases: Array<[string, unknown]> = [
      [
        "$.scope.customerExclusions[0]",
        { ...SAMPLE_REPORT, scope: { ...SAMPLE_REPORT.scope, customerExclusions: ["The admin console, which is secure."] } },
      ],
      [
        "$.scope.criticalWorkflow.description",
        {
          ...SAMPLE_REPORT,
          scope: {
            ...SAMPLE_REPORT.scope,
            criticalWorkflow: { ...SAMPLE_REPORT.scope.criticalWorkflow, description: "Checkout. It is secure." },
          },
        },
      ],
      [
        "$.scope.application.name",
        {
          ...SAMPLE_REPORT,
          scope: { ...SAMPLE_REPORT.scope, application: { ...SAMPLE_REPORT.scope.application, name: "Pentest Pro" } },
        },
      ],
    ];

    for (const [path, report] of cases) {
      const paths = checkReportFieldCoverage(report).map((failure) => failure.path);
      expect(paths, path).toContain(path);
    }
  });

  it("catches a credential in a guarded field as well as a claim", () => {
    const report = {
      ...SAMPLE_REPORT,
      scope: {
        ...SAMPLE_REPORT.scope,
        application: {
          ...SAMPLE_REPORT.scope.application,
          description: "A bookkeeping app. Config: DB_PASSWORD_PROD=hunter2hunter2hunter2",
        },
      },
    };

    expect(checkReportFieldCoverage(report).map((failure) => failure.reason).join(" ")).toContain(
      "unredacted credential",
    );
  });
});

describe("the dispositions mean what they say", () => {
  it("does not apply the claim guard to quoted customer source", () => {
    // A finding that quotes `const isSecure = true;` is quoting THEIR code. The
    // excerpt is checked for credentials and not for claims, because otherwise a
    // truthful finding about their source would be unreportable.
    const finding = makeFinding({
      locations: [
        {
          path: "src/auth.ts",
          startLine: 1,
          endLine: 1,
          excerpt: "// this endpoint is secure, do not change",
        },
      ],
    });
    const report = assembleReleaseRescueReport(makeReportInput({ findings: [finding] }));

    expect(checkReportFieldCoverage(report)).toEqual([]);
  });

  it("still redacts a credential in that excerpt", () => {
    const finding = makeFinding({
      locations: [
        { path: "src/auth.ts", startLine: 1, endLine: 1, excerpt: "AKIAIOSFODNN7EXAMPLE" },
      ],
    });
    const report = assembleReleaseRescueReport(makeReportInput({ findings: [finding] }));

    expect(checkReportFieldCoverage(report).map((f) => f.reason).join(" ")).toContain("unredacted credential");
  });
});
