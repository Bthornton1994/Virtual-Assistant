import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ASSESSMENT_RATIONALE_CATALOG,
  ASSESSMENT_RATIONALE_CODES,
  CLEARANCE_REASON_CATALOG,
  ENGAGEMENT_LIMITATION_CODES,
  LIMITATION_CATALOG,
  OBSERVATION_CATALOG,
  OBSERVATION_CODES,
  REMEDIATION_CATALOG,
  REMEDIATION_CODES,
  RELEASE_RESCUE_OBSERVATION_CATALOG_HASH,
  RELEASE_RESCUE_OBSERVATION_CATALOG_VERSION,
  STANDING_LIMITATION_CODES,
  UNCERTAINTY_CATALOG,
  type AssessmentRationaleCode,
  type RemediationCode,
} from "@/lib/release-rescue-observation-catalog";
import {
  FORBIDDEN_NARRATIVE_FIELDS,
  FORBIDDEN_SOURCE_FIELDS,
  composeFinding,
  findSourceFieldsInAssessments,
  findSourceFieldsInFindings,
  releaseRescueFindingV1Schema,
  repositoryPathSchema,
  validateFinding,
} from "@/lib/release-rescue-findings";
import {
  buildReleaseRescueReport,
  deriveReportMetrics,
  hashReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  releaseRescueReportV1Schema,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import {
  REPORT_FIELD_POLICY,
  checkReportFieldCoverage,
  enumerateSchemaStringPaths,
  enumerateStringFields,
} from "@/lib/release-rescue-field-policy";
import {
  DIMENSION_TITLES,
  STANDING_DISCLAIMERS,
  VERDICT_COPY,
  findInternalIdentityLeaks,
  toCustomerReportView,
} from "@/lib/release-rescue-presentation";
import { findProhibitedClaims } from "@/lib/release-rescue-intake";
import { scanForSecrets } from "@/lib/release-rescue-redaction";
import { RELEASE_RESCUE_RUBRIC_V1 } from "@/lib/release-rescue-rubric";
import {
  ZERO_AUTHORITY,
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";

// Option 1, as properties: customer observations composed from structured facts.
//
// WHAT THIS FILE ESTABLISHES, stated narrowly because the comfortable claim is
// wider than the true one:
//
//   PROVEN HERE. A customer-deliverable report has no field that holds a
//   sentence a person wrote. Every word a customer reads about a finding, an
//   assessment, a limitation, an uncertainty or a clearance is resolved at
//   render time from a frozen catalog, keyed by a stable code the artifact
//   stores. A caller may select facts; it may not supply narrative. The two
//   exceptions are named, bounded and tested: a repository path, which is
//   grammar-constrained, and a reviewer's display name, which is guarded.
//
//   NOT PROVEN, AND NOT CLAIMED. This does not make the review correct. It does
//   not prevent a false negative, and it does not make the catalog's own
//   judgement right for a given repository. What it removes is one specific
//   failure: a credential, or any other untrusted text, crossing the
//   persistence or delivery boundary inside prose. Thirteen audits established
//   that no rule over arbitrary prose can stop that. This removes the prose.
//
//   THE SCANNER IS NOT THE GUARANTEE. It is retained for transient processing
//   and for the two guarded strings. Nothing here claims a scanner proves
//   arbitrary prose safe — that claim is exactly what the measurements refuted.

// --- the corpus ------------------------------------------------------------

/** Credential values, varied across the axes audits 8 through 12 each pinned. */
function credentialValues(): string[] {
  const values = new Set<string>();
  const base = "Xk92mQvn7Lz";

  // Shape.
  for (const value of [
    base,
    base.toLowerCase(),
    base.toUpperCase(),
    "123456abcdef",
    "correct-horse-battery-staple",
    "S3cretP4ssw0rdHere",
    "AKIAIOSFODNN7EXAMPLE",
    "sk_live_4eC39HqLyjWDarjtT1zdp7dc",
    "ghp_16C7e42F292c6912E7710c838347Ae178B4a",
    "8f3a9c2b7e1d4f6a0b5c8d9e",
    "a".repeat(64),
  ]) {
    values.add(value);
  }
  // Punctuation and wrapping.
  for (const wrap of ["", '"', "'", "`", "<", "(", "[", "{"]) {
    const close = { "<": ">", "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`", "": "" }[wrap]!;
    values.add(`${wrap}${base}${close}`);
  }
  // Trailing punctuation, which one audit found switched the detector off.
  for (const mark of [".", "!", "?", ";", ",", "...", ". "]) values.add(`${base}${mark}`);
  // Common words people really choose.
  for (const word of ["swordfish", "opensesame", "letmein", "hunter2hunter2"]) values.add(word);
  return [...values];
}

/** Carriers: the spellings a credential arrives in. */
function credentialCarriers(value: string): string[] {
  const nl = String.fromCharCode(10);
  const tab = String.fromCharCode(9);
  return [
    `DB_PASSWORD=${value}`,
    `DB_PASSWORD: ${value}`,
    `DB_PASSWORD = ${value}`,
    `PGPASSWORD=${value}`,
    `export AWS_SECRET_ACCESS_KEY="${value}"`,
    `password: ${value}`,
    `api_key: ${value}`,
    // Multiline and whitespace continuations.
    `DB_PASSWORD=${nl}${tab}${value}`,
    `    DB_PASSWORD=${nl}            ${value}`,
    // URL userinfo.
    `postgres://app:${value}@db.internal:5432/prod`,
    `redis://:${value}@cache.prod:6379`,
    // Prose-prefixed, which is the carrier that delivered 30 of 116 and then
    // 366 of 366 in two separate audits. It has no construct for a construct
    // rule to key on, which is why the prose is gone rather than guarded.
    `The deploy config sets DB_PASSWORD to ${value} and never rotates it.`,
    `DB_PASSWORD is set to ${value} in docker-compose.yml.`,
    // SQL, XML, netrc, Dockerfile.
    `CREATE USER app WITH PASSWORD '${value}';`,
    `<property name="jdbc.password" value="${value}"/>`,
    `machine api.example.com login deploy password ${value}`,
    `ENV NEXTAUTH_SECRET ${value}`,
  ];
}

const VALUES = credentialValues();
const CARRIERS = VALUES.flatMap((value) => credentialCarriers(value).map((text) => ({ value, text })));

/** Every field name a caller might reach for to write narrative. */
const NARRATIVE_FIELDS = [
  "title",
  "whatWeObserved",
  "whyItMatters",
  "recommendation",
  "residualUncertainty",
  "description",
  "rationale",
  "summary",
  "notes",
  "excerpt",
  "source",
  "context",
];

function cleanReport() {
  return buildReleaseRescueReport(
    makeReportInput({
      findings: [makeFinding()],
      assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
        outcome: "fail",
        rationaleCode: "control_missing_on_a_reachable_path",
      }),
      limitationCodes: ["customer_excluded_part_of_the_repository"],
    }),
  );
}

/** Every string a report, its view and its rendered surfaces can present. */
function everySurface(report: unknown): string[] {
  const view = toCustomerReportView(report as never);
  return [
    JSON.stringify(report),
    JSON.stringify(view),
    // The download is the serialised artifact; the preview is the view.
    JSON.stringify(report, null, 2),
    JSON.stringify(view, null, 2),
  ];
}

// --- 1 and 2. generated credentials reach no persisted or delivered surface --

describe("1+2. no generated credential reaches any persisted or delivered surface", () => {
  it("generates a corpus that actually varies across the audited axes", () => {
    // The guard on the guard: an empty or pinned corpus makes every assertion
    // below vacuous, which is the defect two audits found in this suite.
    expect(VALUES.length).toBeGreaterThan(25);
    expect(CARRIERS.length).toBeGreaterThan(400);
    expect(new Set(CARRIERS.map((c) => c.text)).size).toBe(CARRIERS.length);
  });

  it("cannot be placed in any narrative field of a finding, for any carrier", () => {
    const accepted: string[] = [];

    for (const field of NARRATIVE_FIELDS) {
      for (const { text } of CARRIERS) {
        if (releaseRescueFindingV1Schema.safeParse({ ...makeFinding(), [field]: text }).success) {
          accepted.push(`${field}: ${text.slice(0, 40)}`);
        }
      }
    }

    expect(accepted, `${accepted.length} credential carriers were accepted into a finding`).toEqual([]);
  }, 120_000);

  it("is refused by name at the assembly boundary, which takes findings without parsing", () => {
    // `.strict()` only protects the paths that go through a schema. Assembly
    // takes findings as typed values — a stored artifact read back as `unknown`,
    // or a caller holding the input as `any`, reaches it without one.
    for (const field of NARRATIVE_FIELDS) {
      let message = "(no refusal)";
      try {
        buildReleaseRescueReport(
          makeReportInput({
            findings: [{ ...makeFinding(), [field]: "DB_PASSWORD=Xk92mQvn7Lz" } as never],
            assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
              outcome: "fail",
              rationaleCode: "control_missing_on_a_reachable_path",
            }),
          }),
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message, field).toContain(`findings[0].${field}`);
      // A refusal reaches logs, traces and error reporting, so it must name the
      // field and never the value.
      expect(message, field).not.toContain("Xk92mQvn7Lz");
    }
  });

  it("appears in no persisted artifact, JSON, view, preview or download", () => {
    const report = cleanReport();
    const surfaces = everySurface(report);
    const leaked: string[] = [];

    for (const { value } of CARRIERS) {
      for (const surface of surfaces) {
        // `secret`, `token` and `password` are ordinary English that rubric
        // titles legitimately contain, so plain dictionary words are excluded —
        // the distinction is in the test, not in the guarantee.
        if (value.length > 8 && surface.includes(value)) leaked.push(value);
      }
    }

    expect(leaked, `${leaked.length} values reached a delivered surface`).toEqual([]);
  }, 60_000);

  it("appears in no error, log or trace when a caller tries to smuggle one", () => {
    const seen: string[] = [];

    for (const { value, text } of CARRIERS.slice(0, 120)) {
      try {
        buildReleaseRescueReport(
          makeReportInput({ findings: [{ ...makeFinding(), whatWeObserved: text } as never] }),
        );
      } catch (error) {
        const message = error instanceof Error ? `${error.message}${error.stack ?? ""}` : String(error);
        if (value.length > 8 && message.includes(value)) seen.push(value);
      }
    }

    expect(seen, `${seen.length} values appeared in an exception`).toEqual([]);
  }, 60_000);
});

// --- 3. the diagnostic survives the removal ---------------------------------

describe("3. delivered findings still carry a usable path, line and remediation", () => {
  const report = cleanReport();
  const view = toCustomerReportView(report);

  it("cites a path and a line range for every finding", () => {
    for (const [index, finding] of report.findings.entries()) {
      expect(finding.locations.length, `finding ${index}`).toBeGreaterThan(0);
      expect(finding.locations[0].path.length).toBeGreaterThan(0);
      expect(finding.locations[0].startLine).toBeGreaterThan(0);
      expect(view.findings[index].evidence.length).toBeGreaterThan(0);
      expect(view.findings[index].evidence[0].path).toBe(finding.evidence[0].path);
    }
  });

  it("renders a deterministic remediation from the catalog, not from the finding", () => {
    for (const [index, finding] of report.findings.entries()) {
      const catalogText = REMEDIATION_CATALOG[finding.remediationCode as RemediationCode]?.text;

      expect(catalogText, finding.remediationCode).toBeDefined();
      expect(view.findings[index].recommendation).toBe(catalogText);
      expect(view.findings[index].recommendation.length).toBeGreaterThan(20);
    }
  });

  it("renders the same remediation for the same code, every time, in any report", () => {
    const again = toCustomerReportView(cleanReport());

    expect(again.findings[0].recommendation).toBe(view.findings[0].recommendation);
    expect(again.findings[0].whatWeObserved).toBe(view.findings[0].whatWeObserved);
  });

  it("bounds and safely encodes a path, and never treats it as source", () => {
    // A path is the one value still taken from the customer's repository. It is
    // bounded by a grammar rather than judged by a detector.
    const nl = String.fromCharCode(10);
    const cr = String.fromCharCode(13);
    const nul = String.fromCharCode(0);

    for (const bad of [
      `src/a.ts${nl}src/b.ts`,
      `src/a.ts${cr}${nl}src/b.ts`,
      `src/a${nul}.ts`,
      "src/app/api orders/route.ts",
      'const key = "sk_live_x";',
      `${"a".repeat(300)}/route.ts`,
      `${"a/".repeat(300)}route.ts`,
      "../../etc/passwd",
      "./src/a.ts",
      "src/../../../etc/passwd",
    ]) {
      expect(repositoryPathSchema.safeParse(bad).success, bad.slice(0, 30)).toBe(false);
    }

    for (const good of [
      "src/app/api/orders/[id]/route.ts",
      "src/app/api/auth/[...nextauth]/route.ts",
      "supabase/migrations/0007_release_rescue.sql",
      ".github/workflows/ci.yml",
      "package.json",
    ]) {
      expect(repositoryPathSchema.safeParse(good).success, good).toBe(true);
    }
  });
});

// --- 4. injected narrative is rejected or excluded --------------------------

describe("4. arbitrary narrative is rejected or excluded, wherever it is aimed", () => {
  it("names every removed field so a caller is told what changed", () => {
    // "unrecognized key" is a true message that teaches nothing. A caller
    // sending `whatWeObserved` should be told the contract composes that
    // sentence from a code now.
    for (const field of [...FORBIDDEN_SOURCE_FIELDS, ...FORBIDDEN_NARRATIVE_FIELDS]) {
      const sightings = findSourceFieldsInFindings([{ [field]: "anything" }]);
      expect(sightings.map((s) => s.field), field).toContain(field);
    }
  });

  it("rejects narrative on an assessment, not only on a finding", () => {
    for (const field of ["rationale", "description", "notes", "excerpt"]) {
      const sightings = findSourceFieldsInAssessments([{ checkId: "x", [field]: "anything" }]);
      expect(sightings.map((s) => s.field), field).toContain(field);
    }
  });

  it("rejects a customer application narrative, because the scope no longer has one", () => {
    const schemaPaths = enumerateSchemaStringPaths(releaseRescueReportV1Schema);

    for (const path of [
      "$.scope.application.name",
      "$.scope.application.description",
      "$.scope.application.primaryStack",
      "$.scope.criticalWorkflow.name",
      "$.scope.criticalWorkflow.description",
      "$.scope.criticalWorkflow.entryPoint",
      "$.scope.customerExclusions[]",
      "$.limitations[]",
      "$.assessments[].rationale",
      "$.findings[].title",
      "$.findings[].whatWeObserved",
      "$.findings[].whyItMatters",
      "$.findings[].recommendation",
      "$.findings[].residualUncertainty",
      "$.clearedSecretHolds[].rationale",
    ]) {
      expect(schemaPaths, path).not.toContain(path);
      expect(Object.keys(REPORT_FIELD_POLICY), path).not.toContain(path);
    }
  });

  it("rejects an arbitrary reviewer clearance note, which is a reason code now", () => {
    const report = cleanReport();
    const tampered = {
      ...report,
      clearedSecretHolds: [
        {
          path: "$.reviewedBy.displayName",
          clearedContentHash: "a".repeat(64),
          clearedBy: "ops-1",
          clearedAt: "2026-09-16T09:00:00.000Z",
          rationale: "I looked at it and it is fine, the value was DB_PASSWORD=Xk92mQvn7Lz",
        },
      ],
    };

    expect(validateReleaseRescueReport(tampered).hardGatePass).toBe(false);
  });

  it("excludes anything a caller adds that the contract does not know about", () => {
    // The fail-closed half. A field nobody classified is a hard failure, not a
    // pass, so adding one without a decision breaks rather than ships.
    const report = { ...cleanReport(), executiveSummary: "Everything looks fine." };

    expect(checkReportFieldCoverage(report)[0]?.reason).toContain("No field-coverage decision");
    expect(validateReleaseRescueReport(report).hardGatePass).toBe(false);
  });
});

// --- 5. every customer-facing word comes from the catalog -------------------

describe("5. all customer-facing prose comes only from the approved catalog", () => {
  const report = cleanReport();
  const view = toCustomerReportView(report);

  /** Every sentence the catalog can produce. */
  function catalogText(): string[] {
    const text: string[] = [];
    for (const o of Object.values(OBSERVATION_CATALOG)) text.push(o.title, o.whatWeObserved, o.whyItMatters);
    for (const r of Object.values(REMEDIATION_CATALOG)) text.push(r.text);
    for (const t of Object.values(UNCERTAINTY_CATALOG)) text.push(t);
    for (const t of Object.values(LIMITATION_CATALOG)) text.push(t);
    for (const r of Object.values(ASSESSMENT_RATIONALE_CATALOG)) text.push(r.text);
    for (const t of Object.values(CLEARANCE_REASON_CATALOG)) text.push(t);
    return text;
  }

  it("has a catalog that covers every rubric check, so an auditor is never stuck", () => {
    // The cost of removing prose is that the catalog must be able to say what an
    // auditor needs to say. If a check has no observation, an auditor has no way
    // to report a failure of it — which would be a worse defect than the one
    // this change fixes.
    const covered = new Set(Object.values(OBSERVATION_CATALOG).map((o) => o.checkId));

    const uncovered = RELEASE_RESCUE_RUBRIC_V1.filter((check) => !covered.has(check.id)).map((c) => c.id);
    expect(uncovered, `${uncovered.length} rubric checks have no observation`).toEqual([]);
  });

  it("serialises a finding with no sentence in it at all", () => {
    // A sentence needs a space. Every string a finding holds is a code, an
    // identifier, an enum value or a path, and none of those may contain one —
    // so this fails the moment any prose field returns.
    expect(JSON.stringify(report.findings), "a finding must not carry a sentence").not.toContain(" ");
    expect(JSON.stringify(report.assessments), "an assessment must not carry a sentence").not.toContain(" ");
    expect(JSON.stringify(report.limitationCodes)).not.toContain(" ");
  });

  it("renders every customer-visible sentence from a catalog entry, verbatim", () => {
    for (const [index, finding] of report.findings.entries()) {
      const observation = OBSERVATION_CATALOG[finding.observationCode];
      const rendered = view.findings[index];

      expect(observation, finding.observationCode).toBeDefined();
      expect(rendered.title).toBe(observation.title);
      expect(rendered.whatWeObserved).toBe(observation.whatWeObserved);
      expect(rendered.whyItMatters).toBe(observation.whyItMatters);
      expect(rendered.recommendation).toBe(REMEDIATION_CATALOG[finding.remediationCode as RemediationCode].text);
    }

    for (const limitation of view.limitations) {
      expect(Object.values(LIMITATION_CATALOG)).toContain(limitation);
    }
  });

  it("carries no sentence in the view that the catalog cannot account for", () => {
    // The whole-view statement, rather than field by field. Anything the view
    // shows that contains a space must be a catalog sentence, a fixed renderer
    // string, or one of the two named guarded values.
    const approved = new Set<string>([
      ...catalogText(),
      ...Object.values(REMEDIATION_CATALOG).map((r) => r.text),
    ]);
    const unaccounted: string[] = [];

    function walk(value: unknown): void {
      if (typeof value === "string") {
        if (!value.includes(" ")) return; // a code, an id, a path or a date
        if (approved.has(value)) return; // catalog text
        unaccounted.push(value);
        return;
      }
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === "object") Object.values(value).forEach(walk);
    }
    walk(view);

    // What remains must have a NAMED OWNER in this repository — never a sentence
    // a caller supplied. Asserted by reference to the modules that own those
    // strings rather than by eyeballing a list, so a new unowned sentence fails
    // rather than being quietly added to an exception array.
    const rendererOwned = new Set<string>([
      // The presenter's own copy.
      ...Object.values(VERDICT_COPY).flatMap((copy) => [copy.headline, copy.explanation]),
      ...Object.values(DIMENSION_TITLES),
      // The frozen rubric's check titles and questions.
      ...RELEASE_RESCUE_RUBRIC_V1.flatMap((check) => [check.title, check.question]),
      // The four standing disclaimers, which are fixed strings the report module
      // owns and which contain the prohibited phrases on purpose, because they
      // are denying them.
      ...STANDING_DISCLAIMERS,
    ]);
    const leftover = unaccounted.filter((text) => {
      if (rendererOwned.has(text)) return false;
      // The reviewer's display name: guarded, not generated, and the one string
      // in the view a person types. It is checked for claims and credentials by
      // the field-coverage contract, asserted in family 7.
      if (text === report.reviewedBy?.displayName) return false;
      // A formatted line range, which the presenter builds from two integers.
      if (/^lines? \d+(–\d+)?$/.test(text)) return false;
      return true;
    });

    expect(leftover, `${leftover.length} sentences in the view have no owner`).toEqual([]);
  });

  it("keeps the catalog itself free of prohibited claims and credentials", () => {
    // Every word the product can now say, checked once. This is a complete
    // statement rather than a sample — which was not possible while an auditor
    // could write arbitrary prose.
    const text = catalogText();

    expect(text.length).toBeGreaterThan(100);
    expect(scanForSecrets(text)).toEqual([]);
    for (const entry of text) {
      expect(findProhibitedClaims(entry), entry.slice(0, 60)).toEqual([]);
    }
  });

  it("pins the catalog by content hash, so a delivered report names the wording it used", () => {
    expect(report.observationCatalogVersion).toBe(RELEASE_RESCUE_OBSERVATION_CATALOG_VERSION);
    expect(report.observationCatalogHash).toBe(RELEASE_RESCUE_OBSERVATION_CATALOG_HASH);
    expect(report.observationCatalogHash).toMatch(/^[0-9a-f]{64}$/);
    // And the hash is of the content, not a constant somebody typed.
    expect(RELEASE_RESCUE_OBSERVATION_CATALOG_HASH).not.toBe(createHash("sha256").update("").digest("hex"));
  });
});

// --- 6. determinism is unchanged -------------------------------------------

describe("6. severity, counts, verdict, coverage and delivery stay deterministic", () => {
  it("derives severity from the catalog, so an executor cannot choose it", () => {
    for (const code of OBSERVATION_CODES) {
      const observation = OBSERVATION_CATALOG[code];
      const finding = composeFinding({
        findingId: "f-1",
        observationCode: code,
        confidence: "confirmed",
        remediationCode: observation.remediationCodes[0],
        locations: [{ path: "src/a.ts", startLine: 1, endLine: 1 }],
        evidence: [{ kind: "code_reference", path: "src/a.ts", startLine: 1, endLine: 1 }],
      });

      expect(finding.impact, code).toBe(observation.impact);
      expect(finding.exploitability, code).toBe(observation.exploitability);
      expect(validateFinding(finding).ok, code).toBe(true);
      // And a tampered copy is refused, so storing them grants no authority.
      expect(validateFinding({ ...finding, impact: "severe" }).ok || finding.impact === "severe").toBe(
        finding.impact === "severe",
      );
    }
  });

  it("recomputes identical metrics from the stored findings", () => {
    const report = cleanReport();
    const metrics = deriveReportMetrics(report.assessments, report.findings, report.authorityReport);

    expect(metrics.verdict).toBe(report.verdict);
    expect(metrics.severityCounts).toEqual(report.severityCounts);
    expect(metrics.blockingFindingCount).toBe(report.blockingFindingCount);
    expect(metrics.coverage).toEqual(report.coverage);
  });

  it("produces the same artifact and the same hash for the same facts", () => {
    expect(hashReleaseRescueReport(cleanReport())).toBe(hashReleaseRescueReport(cleanReport()));
    expect(JSON.stringify(cleanReport())).toBe(JSON.stringify(cleanReport()));
  });

  it("assesses every rubric check, with a rationale code from the closed set", () => {
    const report = cleanReport();

    expect(report.coverage.notAssessedChecks).toBe(0);
    for (const assessment of report.assessments) {
      expect(ASSESSMENT_RATIONALE_CODES, assessment.checkId).toContain(assessment.rationaleCode);
      // The catalog decides which outcomes a rationale may explain, so "controls
      // present and evidenced" cannot be attached to a failing check.
      const entry = ASSESSMENT_RATIONALE_CATALOG[assessment.rationaleCode as AssessmentRationaleCode];
      expect(entry.outcomes, `${assessment.checkId}/${assessment.rationaleCode}`).toContain(assessment.outcome);
    }
  });

  it("appends the standing limitations itself, and deduplicates a caller's repeat", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        limitationCodes: [...STANDING_LIMITATION_CODES.slice(0, 2), ENGAGEMENT_LIMITATION_CODES[0]] as never,
      }),
    );

    for (const code of STANDING_LIMITATION_CODES) expect(report.limitationCodes).toContain(code);
    expect(new Set(report.limitationCodes).size).toBe(report.limitationCodes.length);
  });
});

// --- 7. the boundaries this change must not disturb -------------------------

describe("7. tenant isolation, authority, binding, retention and human review still hold", () => {
  it("still refuses delivery without a named human reviewer", () => {
    const unsigned = buildReleaseRescueReport(makeReportInput({ reviewedBy: null }));
    const gate = releaseRescueDeliveryGate(unsigned, validateReleaseRescueReport(unsigned));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("No human reviewer");
  });

  it("keeps human review as the accountability gate, not the credential control", () => {
    // The owner's explicit instruction. A signature is required, and it is NOT
    // what catches a credential: a report carrying one is undeliverable even
    // when a named manager has signed it.
    const signed = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: "Ops Manager DB_PASSWORD=Xk92mQvn7Lz",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );

    expect(signed.reviewedBy).not.toBeNull();
    expect(JSON.stringify(signed)).not.toContain("Xk92mQvn7Lz");
    expect(pendingSecretHolds(signed).length).toBeGreaterThan(0);
    expect(releaseRescueDeliveryGate(signed, validateReleaseRescueReport(signed)).deliverable).toBe(false);
  });

  it("still refuses a report whose auditor took an external action", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({ authorityReport: { ...ZERO_AUTHORITY, externalMessagesSent: 1 } }),
    );

    expect(validateReleaseRescueReport(report).hardFailures.join(" ")).toContain("prepare-only");
  });

  it("still binds the report to one organization, one run and one reviewed commit", () => {
    const report = cleanReport();

    expect(report.organizationId).toBe("org-acme");
    expect(report.runId).toBe("run-001");
    expect(report.reviewedCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.scopeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.rubricHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("still keeps internal identity out of the customer's copy", () => {
    const report = cleanReport();

    expect(findInternalIdentityLeaks(toCustomerReportView(report), report)).toEqual([]);
  });

  it("still classifies every string the report can present", () => {
    const report = cleanReport();
    const undecided = enumerateStringFields(report)
      .map((leaf) => leaf.normalized)
      .filter((path) => !REPORT_FIELD_POLICY[path]);

    expect([...new Set(undecided)]).toEqual([]);
    expect(checkReportFieldCoverage(report)).toEqual([]);
  });
});

// --- 8. the removal did not break the ordinary report -----------------------

describe("8. an ordinary, safe report is still deliverable", () => {
  it("delivers a clean signed report with no holds and no blockers", () => {
    const report = cleanReport();
    const validation = validateReleaseRescueReport(report);
    const gate = releaseRescueDeliveryGate(report, validation);

    expect(validation.hardFailures).toEqual([]);
    expect(pendingSecretHolds(report)).toEqual([]);
    expect(gate.blockers).toEqual([]);
    expect(gate.deliverable).toBe(true);
  });

  it("delivers one for every observation in the catalog, not just the fixture's", () => {
    // The strongest form of requirement 8: if any catalog entry produced an
    // undeliverable report, an auditor could not report that observation at all.
    const undeliverable: string[] = [];

    for (const code of OBSERVATION_CODES) {
      const observation = OBSERVATION_CATALOG[code];
      const report = buildReleaseRescueReport(
        makeReportInput({
          findings: [
            composeFinding({
              findingId: "f-1",
              observationCode: code,
              confidence: "confirmed",
              remediationCode: observation.remediationCodes[0],
              locations: [{ path: "src/a.ts", startLine: 1, endLine: 1 }],
              evidence: [{ kind: "code_reference", path: "src/a.ts", startLine: 1, endLine: 1 }],
            }),
          ],
          assessments: setAssessment(passingAssessments(), observation.checkId, {
            outcome: "fail",
            rationaleCode: "control_missing_on_a_reachable_path",
          }),
        }),
      );
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));
      if (!gate.deliverable) undeliverable.push(`${code}: ${gate.blockers.join("; ")}`);
    }

    expect(OBSERVATION_CODES.length).toBeGreaterThan(30);
    expect(undeliverable, `${undeliverable.length} observations produce an undeliverable report`).toEqual([]);
  }, 120_000);

  it("delivers one for every remediation an observation offers", () => {
    const undeliverable: string[] = [];

    for (const code of OBSERVATION_CODES) {
      const observation = OBSERVATION_CATALOG[code];
      for (const remediationCode of observation.remediationCodes) {
        const report = buildReleaseRescueReport(
          makeReportInput({
            findings: [
              composeFinding({
                findingId: "f-1",
                observationCode: code,
                confidence: "confirmed",
                remediationCode,
                locations: [{ path: "src/a.ts", startLine: 1, endLine: 1 }],
                evidence: [{ kind: "code_reference", path: "src/a.ts", startLine: 1, endLine: 1 }],
              }),
            ],
            assessments: setAssessment(passingAssessments(), observation.checkId, {
              outcome: "fail",
              rationaleCode: "control_missing_on_a_reachable_path",
            }),
          }),
        );
        if (!releaseRescueDeliveryGate(report, validateReleaseRescueReport(report)).deliverable) {
          undeliverable.push(`${code}/${remediationCode}`);
        }
      }
    }

    expect(REMEDIATION_CODES.length).toBeGreaterThan(20);
    expect(undeliverable, `${undeliverable.length} remediations produce an undeliverable report`).toEqual([]);
  }, 120_000);

  it("delivers one carrying every engagement limitation a customer might have", () => {
    for (const code of ENGAGEMENT_LIMITATION_CODES) {
      const report = buildReleaseRescueReport(makeReportInput({ limitationCodes: [code] as never }));
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

      expect(gate.deliverable, code).toBe(true);
      expect(toCustomerReportView(report).limitations).toContain(LIMITATION_CATALOG[code]);
    }
  });

  it("renders a header from the scope that remains, without the customer's prose", () => {
    const view = toCustomerReportView(cleanReport());

    expect(view.scope.exclusionCount).toBeGreaterThanOrEqual(0);
    expect(typeof view.scope.usesAiFeatures).toBe("boolean");
    expect(typeof view.scope.handlesCustomerData).toBe("boolean");
    expect(typeof view.scope.triggersExternalActions).toBe("boolean");
    // The whole header, enumerated. Everything here is an identifier, a commit,
    // a branch, a boolean or a count — the customer's own prose is gone.
    expect(Object.keys(view.scope).sort()).toEqual([
      "aiAssistedReviewAccepted",
      "commitSha",
      "defaultBranch",
      "exclusionCount",
      "handlesCustomerData",
      "repositoryRef",
      "triggersExternalActions",
      "usesAiFeatures",
    ]);
    // And none of the removed fields came back under another name.
    for (const key of Object.keys(view.scope)) {
      expect(FORBIDDEN_NARRATIVE_FIELDS, key).not.toContain(key);
    }
  });
});
