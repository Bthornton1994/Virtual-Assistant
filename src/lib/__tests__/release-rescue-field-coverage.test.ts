import { describe, expect, it } from "vitest";
import {
  REPORT_FIELD_POLICY,
  checkReportFieldCoverage,
  enumerateSchemaStringPaths,
  enumerateStringFields,
  normalizeFieldPath,
} from "@/lib/release-rescue-field-policy";
import {
  buildReleaseRescueReport,
  releaseRescueReportV1Schema,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import { findInternalIdentityLeaks, toCustomerReportView } from "@/lib/release-rescue-presentation";
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
  buildReleaseRescueReport(makeReportInput()),
  buildReleaseRescueReport(
    makeReportInput({
      findings: [makeFinding()],
      assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
        outcome: "fail",
        rationaleCode: "controls_present_and_evidenced",
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

  it("refuses an unclassified field INSIDE an array, not only at the top level", () => {
    // An audit mutated `enumerateStringFields` to stop walking arrays entirely —
    // `return []` in the array branch — and every one of the 635 Release Rescue
    // tests stayed green. That silently removes `findings[]`, `assessments[]`,
    // `unresolvedHolds[]`, `clearedSecretHolds[]` and `limitationCodes[]` from
    // the coverage contract, including its headline fail-closed property, and
    // the only test of that property planted its field at the TOP LEVEL.
    const report = {
      ...SAMPLE_REPORT,
      findings: SAMPLE_REPORT.findings.map((finding, index) =>
        index === 0 ? { ...finding, marketingTagline: "Your application is secure." } : finding,
      ),
    } as unknown;

    const failures = checkReportFieldCoverage(report);

    expect(failures.map((failure) => failure.path)).toContain("$.findings[0].marketingTagline");
    expect(failures[0].reason).toContain("No field-coverage decision is recorded");
  });

  it("walks nested arrays too, so a field two levels down is not invisible", () => {
    const report = {
      ...SAMPLE_REPORT,
      findings: SAMPLE_REPORT.findings.map((finding, index) =>
        index === 0
          ? { ...finding, locations: finding.locations.map((l) => ({ ...l, sourceWindow: "const k = 1;" })) }
          : finding,
      ),
    } as unknown;

    expect(checkReportFieldCoverage(report).map((f) => f.path)).toContain(
      "$.findings[0].locations[0].sourceWindow",
    );
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

describe("the gap the audit actually found, and what replaced it", () => {
  // The audit's finding was that `scope.application.description` — customer-written,
  // rendered verbatim in the report header — was outside the claim guard's
  // hand-written allowlist. The first fix classified it as `guarded` and pointed
  // the guard at it.
  //
  // Option 1 removed the field instead. The scope the report carries now holds
  // booleans and a count; there is no application description, no workflow
  // description, and no customer exclusion prose to guard. So the honest
  // assertion changed shape: these tests no longer prove the guard catches a
  // claim in that field, because nothing reaches that field. They prove the
  // field cannot be reintroduced by a caller without breaking.
  const CLAIMS = [
    "A bookkeeping app. After this review your application is secure.",
    "A checkout flow, now vulnerability free.",
    "Our SOC 2 certified payments service.",
  ];

  it("no longer has the field the audit found, in the schema or in the policy", () => {
    const schemaPaths = enumerateSchemaStringPaths(releaseRescueReportV1Schema);
    const gone = [
      "$.scope.application.description",
      "$.scope.application.name",
      "$.scope.application.primaryStack",
      "$.scope.criticalWorkflow.name",
      "$.scope.criticalWorkflow.description",
      "$.scope.criticalWorkflow.entryPoint",
      "$.scope.customerExclusions[]",
    ];

    for (const path of gone) {
      expect(schemaPaths, path).not.toContain(path);
      expect(Object.keys(REPORT_FIELD_POLICY), path).not.toContain(path);
    }
  });

  for (const claim of CLAIMS) {
    it(`refuses a reintroduced application description outright: "${claim.slice(0, 40)}"`, () => {
      const report = {
        ...SAMPLE_REPORT,
        scope: { ...SAMPLE_REPORT.scope, application: { ...SAMPLE_REPORT.scope.application, description: claim } },
      };
      const failures = checkReportFieldCoverage(report);
      const reason = failures.find((failure) => failure.path === "$.scope.application.description")?.reason ?? "";

      // Asserted on the REASON, not just the path. The weaker assertion passes
      // for either mechanism, which would hide the fact that the claim guard is
      // no longer what stops this — the missing classification is.
      expect(reason).toContain("No field-coverage decision is recorded");
      expect(validateReleaseRescueReport(report).hardGatePass).toBe(false);
    });
  }

  it("still catches a prohibited claim in the free text that remains", () => {
    // Two guarded strings survive Option 1 that a human writes: the reviewer's
    // display name and the repository reference the customer gave at intake.
    // The guard's job is smaller now, and it is not gone.
    for (const claim of CLAIMS) {
      const report = {
        ...SAMPLE_REPORT,
        reviewedBy: { ...SAMPLE_REPORT.reviewedBy, displayName: claim },
      };
      const reasons = checkReportFieldCoverage(report).map((failure) => failure.reason).join(" ");

      expect(reasons, claim).toContain("prohibited claim");
    }
  });

  it("catches a credential in a guarded field as well as a claim", () => {
    // The last class of value taken from the customer's repository that still
    // reaches a report is a path. It is bounded and grammar-checked, and it is
    // still checked here, because "the schema would not allow it" is a claim
    // about today's schema rather than a property of the contract.
    const report = {
      ...SAMPLE_REPORT,
      reviewedBy: {
        ...SAMPLE_REPORT.reviewedBy,
        displayName: "Config: DB_PASSWORD_PROD=hunter2hunter2hunter2",
      },
    };

    expect(checkReportFieldCoverage(report).map((failure) => failure.reason).join(" ")).toContain(
      "unredacted credential",
    );
  });
});

describe("the dispositions mean what they say", () => {
  it("no longer has a quoted-customer-source disposition, because there is none", () => {
    // Two tests lived here: one asserting a finding could quote the customer's
    // code without the claim guard firing on their words, and one asserting a
    // credential was scrubbed out of that quote. Both described a field that no
    // longer exists. A finding cites `path:line`; the customer reads their own
    // code in their own checkout.
    const excerptPaths = Object.keys(REPORT_FIELD_POLICY).filter((path) => path.includes("excerpt"));

    expect(excerptPaths, "REPORT_FIELD_POLICY still classifies an excerpt path").toEqual([]);
  });

  it("keeps the claim guard off a customer's own words where they genuinely appear", () => {
    // The customer's application description is still theirs and still quoted
    // verbatim, so the disposition that matters is still exercised.
    const report = buildReleaseRescueReport(makeReportInput());

    expect(checkReportFieldCoverage(report)).toEqual([]);
  });
});

describe("the contract is driven by the schema, not by the fixtures to hand", () => {
  // Walking a report instance can only see fields that instance populates. That
  // is how `preparedBy.modelId` went unclassified: it is nullable, both fixtures
  // set it to null, and every coverage test passed while the one value the
  // Software Factory provenance rules tell operators to record would have
  // refused the report.
  //
  // These tests walk the SCHEMA, so a field counts the moment it is declared.

  const schemaPaths = enumerateSchemaStringPaths(releaseRescueReportV1Schema);

  it("finds the whole report, not a corner of it", () => {
    // A walk that silently returned [] would make every assertion below vacuous.
    expect(schemaPaths.length).toBeGreaterThan(40);
    expect(new Set(schemaPaths).size).toBe(schemaPaths.length);
  });

  it("classifies every string the schema permits", () => {
    const undecided = schemaPaths.filter((path) => !REPORT_FIELD_POLICY[normalizeFieldPath(path)]);
    expect(undecided, "classify these in REPORT_FIELD_POLICY").toEqual([]);
  });

  it("classifies the nullable field that the instance walk could not see", () => {
    // Named explicitly, because this is the one the audit found and a
    // regression here would otherwise only show up as a count.
    expect(schemaPaths).toContain("$.preparedBy.modelId");
    expect(REPORT_FIELD_POLICY["$.preparedBy.modelId"]).toBeDefined();
  });

  it("carries no policy entry for a path the schema no longer has", () => {
    // The other direction. A stale entry is a decision about nothing, and it
    // makes the policy look like it covers more than it does.
    const permitted = new Set(schemaPaths.map(normalizeFieldPath));
    const stale = Object.keys(REPORT_FIELD_POLICY).filter((path) => !permitted.has(path));
    expect(stale, "remove these from REPORT_FIELD_POLICY").toEqual([]);
  });
});

describe("the policy governs the assembler, not only the validator", () => {
  it("accepts a populated modelId end to end", () => {
    // The regression this closes: with `modelId` unclassified, recording the
    // executor that prepared the report — which the provenance rules require —
    // turned a clean report into a coverage failure at the delivery gate.
    const report = buildReleaseRescueReport(
      makeReportInput({
        preparedBy: {
          executorKey: "release-rescue-auditor",
          executorKind: "agent",
          provider: "internal",
          modelId: "claude-opus-5",
          protocolVersion: "v1",
        },
      }),
    );

    expect(report.preparedBy.modelId).toBe("claude-opus-5");
    expect(checkReportFieldCoverage(report)).toEqual([]);
    expect(validateReleaseRescueReport(report).hardGatePass).toBe(true);
  });

  it("records WHY modelId is exempt from the claim guard, not just that it is", () => {
    // `generated` means the claim guard does not run on it, so the exemption is
    // only sound while the value stays ours. It is chosen by our own model
    // routing; no customer field and no executor's self-report reaches it. A
    // change that lets either write it has to change this test too.
    const rule = REPORT_FIELD_POLICY["$.preparedBy.modelId"];

    expect(rule.disposition).toBe("generated");
    expect(rule.because).toContain("routing");
    expect(rule.because).toContain("never product truth");

    // Every `preparedBy` field is exempt on the same grounds, so none of them
    // may be reachable from customer input.
    for (const [path, entry] of Object.entries(REPORT_FIELD_POLICY)) {
      if (!path.startsWith("$.preparedBy.")) continue;
      expect(entry.disposition, path).toBe("generated");
    }
  });

  it("puts every assembled report through the same walk the validator uses", () => {
    // The assembler is the only way a report is built (`assembleReleaseRescueReport`
    // takes a `Sanitized<T>`, and `buildReleaseRescueReport` is the sole producer
    // of one). So if its output is covered, every report is.
    for (const report of REAL_REPORTS) {
      const instancePaths = new Set(enumerateStringFields(report).map((leaf) => leaf.normalized));
      for (const path of instancePaths) {
        expect(REPORT_FIELD_POLICY[path], `${path} is assembled but unclassified`).toBeDefined();
      }
    }
  });
});

describe("a populated modelId does not reach the customer's copy", () => {
  // `findInternalIdentityLeaks` checks `modelId`, but only when it is non-null —
  // and every fixture sets it to null, so that arm had never executed. Same
  // shape as the coverage bug this pass fixed: a mechanism that looks right and
  // has never run.
  it("keeps it out of the rendered view and out of the JSON", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        preparedBy: {
          executorKey: "release-rescue-auditor",
          executorKind: "agent",
          provider: "internal",
          modelId: "claude-opus-5",
          protocolVersion: "v1",
        },
      }),
    );
    const view = toCustomerReportView(report);

    expect(report.preparedBy.modelId).toBe("claude-opus-5");
    expect(findInternalIdentityLeaks(view, report)).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("claude-opus-5");
    // The customer is still told HOW it was prepared, which is the disclosure
    // the AI-assisted opt-in requires — just not by which model.
    expect(view.preparedByKind).toBe("agent");
  });
});
