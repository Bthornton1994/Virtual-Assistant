import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASSESSMENT_RATIONALE_CATALOG,
  ASSESSMENT_RATIONALE_CODES,
  CLEARANCE_REASON_CATALOG,
  CLEARANCE_REASON_CODES,
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
  UNCERTAINTY_CODES,
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
  assertEveryCodeIsInItsCatalogForTest,
  assertGeneratedFieldsMatchTheirFormat,
  buildReleaseRescueReport,
  deriveReportMetrics,
  hashReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  releaseRescueReportV1Schema,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import {
  GENERATED_FORMATS,
  REPORT_FIELD_POLICY,
  checkReportFieldCoverage,
  generatedValueIsNotWhatItClaims,
  pathValueIsNotAPath,
  normalizeFieldPath,
  enumerateSchemaStringPaths,
  enumerateStringFields,
} from "@/lib/release-rescue-field-policy";
import {
  DIMENSION_TITLES,
  STANDING_DISCLAIMERS,
  UNAVAILABLE_TEXT,
  UNAVAILABLE_TITLE,
  VERDICT_COPY,
  findInternalIdentityLeaks,
  toCustomerReportView,
} from "@/lib/release-rescue-presentation";
import {
  REPOSITORY_ACCESS_MODES,
  RELEASE_RESCUE_OFFER,
  findProhibitedClaims,
  findProhibitedClaimsUnderModes,
  CLAIM_TOKENIZER_MODES,
  TOKENIZER_OPTIONS,
  type ClaimTokenizerModeName,
} from "@/lib/release-rescue-intake";
import { SAMPLE_REPORT } from "@/lib/ai-app-release-rescue/demo-fixtures";
import { branchNameSchema, repositoryRefSchema } from "@/lib/release-rescue-intake";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";
import { validIntakeRecord } from "@/lib/ai-app-release-rescue/intake.test-fixtures";
const NOW = new Date("2026-09-16T09:00:00.000Z");

import { PATH_SEGMENT_CHARACTERS } from "@/lib/release-rescue-findings";
import { scanForSecrets } from "@/lib/release-rescue-redaction";
import { RELEASE_RESCUE_RUBRIC_V1 } from "@/lib/release-rescue-rubric";
import { RELEASE_VERDICTS } from "@/lib/release-rescue-report";
import { releaseRescueIntakeV1Schema } from "@/lib/release-rescue-intake";
import {
  FIXTURE_ORGANIZATION_ID,
  FIXTURE_OPERATOR_ID,
  FIXTURE_RUN_ID,
  ZERO_AUTHORITY,
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";
import { DEMO_IDENTIFIERS } from "@/lib/release-rescue-demo-identity";

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
          clearedBy: FIXTURE_OPERATOR_ID,
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
        findingId: "RR-001",
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
          operatorUserId: FIXTURE_OPERATOR_ID,
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

    expect(report.organizationId).toBe(FIXTURE_ORGANIZATION_ID);
    expect(report.runId).toBe(FIXTURE_RUN_ID);
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
              findingId: "RR-001",
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
                findingId: "RR-001",
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

// --- 9. the codes are closed, on the path that actually produces an artifact ---

describe("9. a code field holds a code, and nothing else, on the production path", () => {
  // The audit that found this gap is the reason this block exists, and it is
  // worth stating what it found rather than only that it is fixed.
  //
  // Option 1 removed the prose fields and replaced them with codes. Six code
  // fields resolve to customer-facing words, and `REPORT_FIELD_POLICY` classifies
  // all six as `generated` — which EXEMPTS them from the prohibited-claim guard
  // and from the credential check. The stated justification is "a closed enum".
  //
  // They were not closed. `ObservationEntry.code` was `string`, so
  // `OBSERVATION_CODES` was `readonly string[]`, so every `z.enum` call carried
  // `as [string, ...string[]]` — and that cast makes the schema's INFERRED type
  // plain `string`. `composeFinding` declared its inputs `string` to match. An
  // auditor could pass an arbitrary sentence as `uncertaintyCode` through the
  // supported constructor, with no cast: `tsc` passed, `validateFinding`
  // returned ok, the scanner found no assignment construct, the field-coverage
  // contract returned [] because the field was exempt, and the sentence rendered
  // verbatim in the customer view.
  //
  // Three things had to be true at once, and each is asserted here separately,
  // because fixing one and not the others would leave the property resting on
  // an implementation detail.

  const SENTENCES = [
    "The admin console password is Xk92mQvn7Lz and the DB user is svc_ledger.",
    "DB_PASSWORD is set to Xk92mQvn7Lz on line 14 of docker-compose.yml",
    "This review is a penetration test and certifies the application is secure and vulnerability free.",
    "Their Redis auth string is r3d15-Pr0d-Xk92mQvn7Lz, we reused it to test.",
  ];

  it("declares each code list as a literal tuple, so z.enum infers a union rather than string", () => {
    // The type-level half, asserted at runtime because a test cannot assert a
    // type. What it can assert is the property the type depends on: the list is
    // a frozen tuple of literals, not a mapped `string[]`.
    //
    // If a future change derives OBSERVATION_CODES from ENTRIES again, this
    // still passes — so the compile-time guarantee is additionally pinned by the
    // `expectTypeOf`-style assignment below, which fails `tsc` rather than vitest.
    for (const list of [
      OBSERVATION_CODES,
      REMEDIATION_CODES,
      UNCERTAINTY_CODES,
      ASSESSMENT_RATIONALE_CODES,
      STANDING_LIMITATION_CODES,
      ENGAGEMENT_LIMITATION_CODES,
      CLEARANCE_REASON_CODES,
    ]) {
      expect(list.length).toBeGreaterThan(2);
      expect(new Set(list).size, "a duplicate code silently shadows a catalog entry").toBe(list.length);
      for (const code of list) {
        expect(typeof code).toBe("string");
        // Code shape. The database guard enforces the same thing, and a sentence
        // cannot satisfy it.
        expect(code, `${code} is not code-shaped`).toMatch(/^[a-z0-9_.]{1,120}$/);
      }
    }
  });

  it("refuses a sentence as any finding code AT COMPILE TIME", () => {
    // The type layer, pinned. Each `@ts-expect-error` below fails `tsc` if the
    // corresponding field in `FindingFacts` goes back to `string` — which is
    // exactly the mutation an audit ran and found invisible to both the compiler
    // and all 631 tests.
    //
    // There is no runtime assertion in this test on purpose. Its subject is the
    // build, and it passes by compiling.
    const facts = {
      findingId: "RR-001",
      confidence: "likely",
      locations: [{ path: "src/a.ts", startLine: 1, endLine: 1 }],
      evidence: [{ kind: "code_reference", path: "src/a.ts", startLine: 1, endLine: 1 }],
    } as const;

    void (() =>
      composeFinding({
        ...facts,
        // @ts-expect-error a sentence is not an ObservationCode
        observationCode: "The admin password is Xk92mQvn7Lz.",
        remediationCode: "scope_query_by_authenticated_principal",
      }));

    void (() =>
      composeFinding({
        ...facts,
        observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
        // @ts-expect-error a sentence is not a RemediationCode
        remediationCode: "The admin password is Xk92mQvn7Lz.",
      }));

    void (() =>
      composeFinding({
        ...facts,
        observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
        remediationCode: "scope_query_by_authenticated_principal",
        // @ts-expect-error a sentence is not an UncertaintyCode
        uncertaintyCode: "The admin password is Xk92mQvn7Lz.",
      }));

    expect(true, "this test's subject is the build; it passes by compiling").toBe(true);
  });

  it("refuses a sentence as uncertaintyCode through the supported constructor", () => {
    // THE REPRODUCTION. This is the audit's finding, verbatim, as a test: a
    // supported `composeFinding` call with no cast anywhere.
    for (const sentence of SENTENCES) {
      expect(
        () =>
          composeFinding({
            findingId: "RR-001",
            observationCode: "authz.record_lookup_is_not_scoped_to_the_caller",
            confidence: "likely",
            remediationCode: "scope_query_by_authenticated_principal",
            locations: [{ path: "src/app/api/orders/route.ts", startLine: 12, endLine: 20 }],
            evidence: [{ kind: "code_reference", path: "src/app/api/orders/route.ts", startLine: 12, endLine: 20 }],
            // `@ts-expect-error`, not `as never`.
            //
            // An audit pointed out that `as never` compiles whether or not the
            // type refuses the value, so the earlier version of this line pinned
            // nothing: reverting `FindingFacts.uncertaintyCode` to `string` left
            // `tsc` at exit 0 and the whole suite green. `@ts-expect-error` FAILS
            // the build when the error it expects stops occurring, which is the
            // only way a test can assert a compile-time property.
            //
            // The suppression is what a caller holding the value as `any`, or
            // deserialising a stored payload, looks like at runtime — and the
            // runtime check below is what catches that.
            // @ts-expect-error a sentence is not an UncertaintyCode, and that is the property under test
            uncertaintyCode: sentence,
          }),
        sentence.slice(0, 40),
      ).toThrow(/uncertaintyCode must be a code/);
    }
  });

  it("refuses every code field at the assembly boundary, which never parses", () => {
    // The boundary that matters most: `assembleReleaseRescueReport` takes typed
    // values and never runs a schema, so `.strict()` and `z.enum` do not protect
    // it. A stored payload read back as `unknown` arrives here.
    const CASES: ReadonlyArray<readonly [string, (input: ReturnType<typeof makeReportInput>) => unknown]> = [
      ["findings[0].observationCode", (input) => ({
        ...input,
        findings: [{ ...makeFinding(), observationCode: SENTENCES[1] }],
      })],
      ["findings[0].remediationCode", (input) => ({
        ...input,
        findings: [{ ...makeFinding(), remediationCode: SENTENCES[0] }],
      })],
      ["findings[0].uncertaintyCode", (input) => ({
        ...input,
        findings: [{ ...makeFinding(), uncertaintyCode: SENTENCES[0] }],
      })],
      ["assessments[0].rationaleCode", (input) => ({
        ...input,
        assessments: input.assessments.map((assessment, index) =>
          index === 0 ? { ...assessment, rationaleCode: SENTENCES[3] } : assessment,
        ),
      })],
      ["limitationCodes[0]", (input) => ({ ...input, limitationCodes: [SENTENCES[2]] })],
      ["clearedSecretHolds[0].reasonCode", (input) => ({
        ...input,
        clearedSecretHolds: [
          {
            path: "$.reviewedBy.displayName",
            clearedContentHash: "a".repeat(64),
            clearedBy: FIXTURE_OPERATOR_ID,
            clearedAt: "2026-09-16T09:00:00.000Z",
            reasonCode: SENTENCES[0],
          },
        ],
      })],
    ];

    for (const [field, mutate] of CASES) {
      let message = "(no refusal)";
      try {
        buildReleaseRescueReport(mutate(makeReportInput()) as never);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message, field).not.toBe("(no refusal)");
      // It names the field...
      expect(message, field).toContain(field.replace(/\[0\]/g, "[0]"));
      // ...and never the value, because this reaches logs.
      expect(message, field).not.toContain("Xk92mQvn7Lz");
      expect(message, field).not.toContain("penetration test");
      expect(message, field).not.toContain("svc_ledger");
    }
  });

  it("never renders a stored value that is not in the catalog", () => {
    // The render path, asserted independently of the two above. Even if a report
    // reaches the presenter with a code this build does not know — an artifact
    // written against a newer catalog, which is the case the fallback exists for
    // — the customer must not be shown the stored string. The earlier fallback
    // was `?? finding.observationCode`, and that was the render path of the
    // whole defect.
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [makeFinding()],
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "control_missing_on_a_reachable_path",
        }),
      }),
    );
    const tampered = {
      ...report,
      findings: [
        {
          ...report.findings[0],
          observationCode: SENTENCES[1],
          remediationCode: SENTENCES[0],
          uncertaintyCode: SENTENCES[0],
        },
      ],
      limitationCodes: [SENTENCES[2]],
    } as typeof report;

    const view = toCustomerReportView(tampered);
    const rendered = JSON.stringify(view);

    expect(rendered).not.toContain("Xk92mQvn7Lz");
    expect(rendered).not.toContain("svc_ledger");
    expect(rendered).not.toContain("penetration test and certifies");
    // And it still renders something, rather than crashing or blanking.
    expect(view.findings[0].title).toBe(UNAVAILABLE_TITLE);
    expect(view.findings[0].whatWeObserved).toBe(UNAVAILABLE_TEXT);
    expect(view.limitations[0]).toBe(UNAVAILABLE_TEXT);
    // The diagnostic that does not depend on the catalog survives.
    expect(view.findings[0].locations[0].path).toBe(report.findings[0].locations[0].path);
    expect(view.findings[0].severity).toBe(report.findings[0].severity);
  });

  it("closes each of the six fields IN THE SCHEMA, not only in the runtime checks", () => {
    // Asserted separately from the runtime checks above, deliberately.
    //
    // A mutation run against the first version of this fix showed why: widening
    // `uncertaintyCode` from `z.enum(...)` to `z.string()` killed ZERO tests,
    // because the runtime guard in `composeFinding` caught it first and every
    // assertion was satisfied. Defence in depth had quietly become the only
    // defence, and nothing would have noticed the schema rotting.
    //
    // Each assertion below goes red if its enum is widened, independently of
    // whether any other layer still catches the value.
    const SENTENCE = "The admin console password is Xk92mQvn7Lz.";
    const finding = makeFinding();

    for (const field of ["observationCode", "remediationCode", "uncertaintyCode"] as const) {
      const parsed = releaseRescueFindingV1Schema.safeParse({ ...finding, [field]: SENTENCE });
      expect(parsed.success, `findings[].${field} must be a closed enum in the schema`).toBe(false);
    }

    const report = buildReleaseRescueReport(makeReportInput());

    expect(
      releaseRescueReportV1Schema.safeParse({
        ...report,
        assessments: report.assessments.map((assessment, index) =>
          index === 0 ? { ...assessment, rationaleCode: SENTENCE } : assessment,
        ),
      }).success,
      "assessments[].rationaleCode must be a closed enum in the schema",
    ).toBe(false);

    expect(
      releaseRescueReportV1Schema.safeParse({ ...report, limitationCodes: [SENTENCE] }).success,
      "limitationCodes[] must be a closed enum in the schema",
    ).toBe(false);

    expect(
      releaseRescueReportV1Schema.safeParse({
        ...report,
        clearedSecretHolds: [
          {
            path: "$.reviewedBy.displayName",
            clearedContentHash: "a".repeat(64),
            clearedBy: FIXTURE_OPERATOR_ID,
            clearedAt: "2026-09-16T09:00:00.000Z",
            reasonCode: SENTENCE,
          },
        ],
      }).success,
      "clearedSecretHolds[].reasonCode must be a closed enum in the schema",
    ).toBe(false);

    // And a code-shaped string that is merely not in the catalog is refused too,
    // so the enum is a membership check and not a shape check.
    expect(
      releaseRescueFindingV1Schema.safeParse({ ...finding, observationCode: "authz.not_a_real_code" }).success,
    ).toBe(false);
  });

  it("refuses a sentence in the two IDENTIFIER fields, not only the six code fields", () => {
    // The audit of the previous commit found this exactly one field over from
    // where the fix had been applied.
    //
    // `findings[].rubricCheckId` is `identifierString.max(200)` — 200 characters
    // of arbitrary text, type-legal with NO cast — and `toCustomerReportView`
    // rendered it verbatim as `checkTitle`, the header of every finding. The
    // field-coverage policy classifies it `generated`, which exempts it from the
    // prohibited-claim guard and the credential check, on the justification
    // "Must match an id in the frozen rubric". Nothing enforced that.
    //
    // The audit's own payload is the fixture here.
    const PAYLOAD = "The production admin password is Xk92mQvn7Lz; this app is secure and free of vulnerabilities.";

    // It is a prohibited claim AND a credential carrier, so the stakes are both.
    expect(findProhibitedClaims(PAYLOAD).length).toBeGreaterThan(0);

    for (const [field, mutate] of [
      ["findings[0].rubricCheckId", (input: ReturnType<typeof makeReportInput>) => ({
        ...input,
        findings: [{ ...makeFinding(), rubricCheckId: PAYLOAD }],
      })],
      ["assessments[0].checkId", (input: ReturnType<typeof makeReportInput>) => ({
        ...input,
        assessments: input.assessments.map((assessment, index) =>
          index === 0 ? { ...assessment, checkId: PAYLOAD } : assessment,
        ),
      })],
    ] as const) {
      let message = "(no refusal)";
      try {
        buildReleaseRescueReport(mutate(makeReportInput()) as never);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message, field).not.toBe("(no refusal)");
      expect(message, field).toContain(field);
      expect(message, field).not.toContain("Xk92mQvn7Lz");
      expect(message, field).not.toContain("free of vulnerabilities");
    }
  });

  it("never renders an unknown rubric check id as the finding's header", () => {
    // The render path of the same finding, asserted separately. Even for a
    // stored artifact this build cannot fully resolve, the header must not be
    // the stored string — it is the most prominent line the report has.
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [makeFinding()],
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationaleCode: "control_missing_on_a_reachable_path",
        }),
      }),
    );
    const tampered = {
      ...report,
      findings: [{ ...report.findings[0], rubricCheckId: "Your application is secure and free of vulnerabilities." }],
    } as typeof report;

    const view = toCustomerReportView(tampered);

    expect(view.findings[0].checkTitle).toBe(UNAVAILABLE_TITLE);
    expect(JSON.stringify(view)).not.toContain("free of vulnerabilities");
  });

  it("lets no `generated` field hold a claim, IN ANY PUNCTUATION, at any path", () => {
    // This test previously planted one whitespace-separated sentence, and that
    // made it structurally incapable of finding the defect it was written to
    // prevent. The rule under test refused whitespace; the payload contained
    // whitespace; the test could only ever re-confirm the rule it was derived
    // from. Audit 17 ran the same test with the spaces replaced by hyphens and
    // measured 49 of 50 paths ACCEPTING the claim.
    //
    // So the payload is now a family, not a string. Each variant says the same
    // forbidden thing with a different separator, including two that defeat
    // `findProhibitedClaims` itself — which is why the format check, not the
    // claim guard, has to be what refuses them.
    const VARIANTS = [
      "This app is secure and free of vulnerabilities.",
      "This-app-is-secure-and-free-of-vulnerabilities.",
      "This_app_is_secure_and_free_of_vulnerabilities",
      "this.app.is.secure.and.free.of.vulnerabilities",
      "ThisAppIsSecureAndFreeOfVulnerabilities",
      "This/app/is/secure/and/free/of/vulnerabilities",
      // Unicode separators outside the \s class, which audit 17 also found.
      `This${String.fromCharCode(0x200b)}app${String.fromCharCode(0x200b)}is${String.fromCharCode(0x200b)}secure`,
      `This${String.fromCharCode(0x2060)}app${String.fromCharCode(0x2060)}is${String.fromCharCode(0x2060)}secure`,
      // And a credential, which no separator rule and no claim guard sees.
      "The-production-admin-password-is-Xk92mQvn7Lz",
      // The three below are here because of what audit 18 measured about the
      // nine above: every one of them was refused by a bound the rule under test
      // had itself chosen — too long, too many segments, contains a space. A
      // payload set drawn from the rule's premise cannot falsify the rule.
      //
      // These are composed the other way round, INSIDE the allowance. The first
      // is four segments of under twenty-four characters each, which is what the
      // identifier format used to permit; it assembled, passed the delivery
      // gate, and rendered in the report header as the engagement id. The second
      // is fifteen characters and one segment. The third is the same shape
      // carrying a credential.
      "ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified",
      "ThisAppIsSecure",
      "AdminPasswordIs-Xk92mQvn7Lz",
    ];

    const GENERATED = Object.entries(REPORT_FIELD_POLICY)
      .filter(([, rule]) => rule.disposition === "generated")
      .map(([path]) => path);

    expect(GENERATED.length, "the policy walk found nothing, so this proves nothing").toBeGreaterThan(40);

    function plant(value: unknown, path: string, target: string, payload: string): boolean {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const here = `${path}[${index}]`;
          if (typeof value[index] === "string" && normalizeFieldPath(here) === target) {
            value[index] = payload;
            return true;
          }
          if (plant(value[index], here, target, payload)) return true;
        }
        return false;
      }
      if (value === null || typeof value !== "object") return false;
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const here = `${path}.${key}`;
        if (typeof entry === "string" && normalizeFieldPath(here) === target) {
          (value as Record<string, unknown>)[key] = payload;
          return true;
        }
        if (plant(entry, here, target, payload)) return true;
      }
      return false;
    }

    function richReport() {
      return JSON.parse(
        JSON.stringify(
          buildReleaseRescueReport(
            makeReportInput({
              reviewedBy: {
                operatorUserId: FIXTURE_OPERATOR_ID,
                displayName: "Ops Manager DB_PASSWORD=Xk92mQvn7Lz",
                reviewedAt: "2026-09-16T10:00:00.000Z",
              },
              preparedBy: {
                executorKey: "sf-implementer",
                executorKind: "agent",
                provider: "cursor",
                protocolVersion: "software-factory/v1",
                modelId: "grok-4.6",
              },
              findings: [
                makeFinding({
                  confidence: "likely",
                  uncertaintyCode: "static_read_only_no_runtime_confirmation",
                }),
              ],
              assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
                outcome: "fail",
                rationaleCode: "control_missing_on_a_reachable_path",
              }),
              limitationCodes: ["customer_excluded_part_of_the_repository"],
              clearedSecretHolds: [
                {
                  path: "$.reviewedBy.displayName",
                  clearedContentHash: "a".repeat(64),
                  clearedBy: FIXTURE_OPERATOR_ID,
                  clearedAt: "2026-09-16T09:00:00.000Z",
                  reasonCode: "value_is_a_placeholder_not_a_credential",
                },
              ],
            }),
          ),
        ),
      );
    }

    // Built once and cloned per plant. Rebuilding inside the loop meant 46 paths
    // x 9 payloads = 414 full assemblies, which timed out.
    const template = richReport();
    const clone = () => JSON.parse(JSON.stringify(template));

    const accepted: string[] = [];
    const unreached: string[] = [];

    for (const path of GENERATED) {
      // A path whose format DECLARES itself too loose to carry this guarantee is
      // skipped here and covered by the customer-visibility test below. The
      // declaration lives on the format, so opting out is a visible edit to the
      // policy rather than an entry in a list inside this file.
      if (GENERATED_FORMATS[path]?.notCustomerVisible) continue;
      for (const payload of VARIANTS) {
        const tampered = clone();
        if (!plant(tampered, "$", path, payload)) {
          if (payload === VARIANTS[0]) unreached.push(path);
          continue;
        }
        // BOTH checks, because the assembly boundary runs both and the property
        // that matters is what the boundary does, not what one function does.
        //
        // An earlier version of this loop called the format check alone and
        // reported the catalog-code paths as accepting a dotted claim. They do
        // not: `assertEveryCodeIsInItsCatalog` refuses them at the same
        // boundary, with a better message naming the registry. Testing one
        // function in isolation and calling the result a property of the system
        // is how a test comes to disagree with production.
        let refused = false;
        for (const check of [assertGeneratedFieldsMatchTheirFormat, assertEveryCodeIsInItsCatalogForTest]) {
          try {
            check(tampered);
          } catch {
            refused = true;
          }
        }
        if (!refused) accepted.push(`${path} <- ${payload.slice(0, 32)}`);
      }
    }

    expect(accepted, `${accepted.length} generated path/payload pairs were accepted`).toEqual([]);
    expect(unreached, `${unreached.length} generated paths could not be reached in a real report`).toEqual([]);
  }, 60_000);

  it("declares a format for every `generated` path, so the classification asserts something", () => {
    // The exemption `generated` buys is total: no claim guard, no credential
    // check. This is what makes that exemption mean something — a path claiming
    // it must say what its value looks like, and a path with no declared format
    // is itself a failure rather than a silent pass.
    const GENERATED = Object.entries(REPORT_FIELD_POLICY)
      .filter(([, rule]) => rule.disposition === "generated")
      .map(([path]) => path);

    const undeclared = GENERATED.filter((path) => !(path in GENERATED_FORMATS));
    expect(undeclared, `${undeclared.length} generated paths declare no format`).toEqual([]);

    // And no format is declared for a path the policy does not classify as
    // generated, which would be a format nothing enforces.
    const orphaned = Object.keys(GENERATED_FORMATS).filter((path) => !GENERATED.includes(path));
    expect(orphaned, `${orphaned.length} formats are declared for non-generated paths`).toEqual([]);

    for (const [path, format] of Object.entries(GENERATED_FORMATS)) {
      expect(format.because.length, `${path} must say why its format is what it is`).toBeGreaterThan(30);
    }
  });

  it("accepts every value a real report legitimately produces", () => {
    // The other direction, and the one that makes the format check safe to
    // tighten: a rule that refuses real values is worse than the hole it closes.
    // Driven from real reports rather than a list of examples.
    const reports = [
      SAMPLE_REPORT,
      buildReleaseRescueReport(makeReportInput()),
      buildReleaseRescueReport(
        makeReportInput({
          findings: [makeFinding()],
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome: "fail",
            rationaleCode: "control_missing_on_a_reachable_path",
          }),
        }),
      ),
    ];

    const rejected: string[] = [];
    let checked = 0;
    for (const report of reports) {
      for (const leaf of enumerateStringFields(report)) {
        if (REPORT_FIELD_POLICY[leaf.normalized]?.disposition !== "generated") continue;
        checked += 1;
        const wrong = generatedValueIsNotWhatItClaims(leaf.normalized, leaf.value);
        if (wrong) rejected.push(`${leaf.normalized}: ${wrong}`);
      }
    }

    expect(checked, "no generated leaves were checked, so this proves nothing").toBeGreaterThan(100);
    expect(rejected, `${rejected.length} legitimate values would be refused`).toEqual([]);

    // A human-prepared report has no vendor and no model. `provider` is `""`
    // for it, and an earlier version of the control-plane format refused that,
    // which refused every human-prepared report. Pinned here so a later
    // tightening cannot repeat it.
    for (const path of ["$.preparedBy.provider", "$.preparedBy.modelId", "$.preparedBy.executorKey"]) {
      expect(generatedValueIsNotWhatItClaims(path, ""), `${path} must accept the empty string`).toBeNull();
    }

    // Every identifier path must accept a real UUID, because every identifier
    // column in the schema IS a uuid — `organization_id`, `engagement_id`,
    // `run_id`, `reviewed_by`. This assertion is here because its absence was a
    // blocking finding: the identifier format refused every UUID for a whole
    // commit, and the fixtures were `org-acme` and `rep-001`, so nothing failed.
    // `randomUUID()` rather than a literal, so it is the shape being proven and
    // not one string that happens to pass.
    const ID_PATHS = [
      "$.reportId",
      "$.engagementId",
      "$.runId",
      "$.organizationId",
      "$.reviewedBy.operatorUserId",
      "$.clearedSecretHolds[].clearedBy",
    ];
    for (const path of ID_PATHS) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect(
          generatedValueIsNotWhatItClaims(path, randomUUID()),
          `${path} must accept a UUID, which is what the column is`,
        ).toBeNull();
      }
    }

    // And the demo identifiers, which are the only non-UUID values any of those
    // paths may hold. Driven from the declaration rather than re-listed, so
    // adding one there without widening the format here fails.
    for (const identifier of DEMO_IDENTIFIERS) {
      expect(
        generatedValueIsNotWhatItClaims("$.engagementId", identifier),
        `the declared demo identifier ${identifier} must be accepted`,
      ).toBeNull();
    }

    // Finding labels are numbered per report, so the whole range must pass.
    for (let n = 1; n <= 999; n += 1) {
      const label = `RR-${String(n).padStart(3, "0")}`;
      expect(
        generatedValueIsNotWhatItClaims("$.findings[].findingId", label),
        `${label} must be accepted`,
      ).toBeNull();
    }
  });

  it("keeps EVERY deliberately loose format away from the customer", () => {
    // The compensating assertion for the paths the format walk above skips.
    // Driven from the formats' own `notCustomerVisible` declaration, so a path
    // that opts out of the format guarantee cannot also quietly become
    // customer-visible.
    //
    // This used to plant a camelCase claim and assert it did not reach the
    // customer. It cannot any more: the claim guard splits camelCase now, so
    // assembly refuses that value outright and the report never exists. The
    // property this test is for survives the change — a vendor string must not
    // reach a customer surface WHETHER OR NOT it says anything prohibited — so
    // the payload is an ordinary vendor string, which is the case the
    // non-visibility bound actually has to carry.
    const loose = Object.entries(GENERATED_FORMATS)
      .filter(([, format]) => format.notCustomerVisible)
      .map(([path]) => path);

    expect(loose.length, "at least one format should be declaring itself loose").toBeGreaterThan(0);

    for (const path of loose) {
      // Every loose path is under `preparedBy`, which the presenter reduces to
      // `preparedByKind`. Asserted rather than assumed.
      expect(path.startsWith("$.preparedBy."), `${path} is loose but not under preparedBy`).toBe(true);
    }

    const report = buildReleaseRescueReport(
      makeReportInput({
        preparedBy: {
          executorKey: "sf-implementer",
          executorKind: "agent",
          provider: "cursor",
          protocolVersion: "software-factory/v1",
          modelId: "grok-4.6",
        },
      }),
    );

    const view = JSON.stringify(toCustomerReportView(report));
    for (const vendor of ["sf-implementer", "cursor", "grok-4.6"]) {
      expect(view, `${vendor} reached the customer view`).not.toContain(vendor);
    }
    expect(findInternalIdentityLeaks(toCustomerReportView(report), report)).toEqual([]);
  });

  it("refuses a claim on a loose path outright, rather than relying on non-visibility", () => {
    // The other half, and the stronger one. Non-visibility was the ONLY control
    // on these three paths while the claim guard read `ThisAppIsSecure` as a
    // single token. It no longer is: the value is refused at assembly, so the
    // report carrying it is never built and non-visibility never has to hold.
    //
    // Both are asserted, because non-visibility is still what covers a vendor
    // string that makes no claim at all, and a later change that loosens the
    // guard must fail here rather than fall back silently.
    for (const claim of ["ThisAppIsSecureAndFreeOfVulnerabilities", "ThisAppIsSecure"]) {
      expect(() =>
        buildReleaseRescueReport(
          makeReportInput({
            preparedBy: {
              executorKey: claim,
              executorKind: "agent",
              provider: "cursor",
              protocolVersion: "software-factory/v1",
              modelId: "grok-4.6",
            },
          }),
        ),
      ).toThrow(/\$\.preparedBy\.executorKey/);
    }
  });

  it("refuses the audit's own payload through buildReleaseRescueReport", () => {
    // The end-to-end form of the same thing, on the exact field and value that
    // audit 16 delivered: `engagementId` carrying the prohibited claim, through
    // the supported entry point.
    let message = "(no refusal)";
    try {
      buildReleaseRescueReport(
        makeReportInput({ engagementId: "This app is secure and free of vulnerabilities." }) as never,
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("(no refusal)");
    expect(message).toContain("$.engagementId");
    expect(message).not.toContain("free of vulnerabilities");

    // And the credential form, which the scanner does not detect in prose.
    expect(() =>
      buildReleaseRescueReport(
        makeReportInput({ engagementId: "The production admin password is Xk92mQvn7Lz" }) as never,
      ),
    ).toThrow(/\$\.engagementId/);
  });

  it("fails closed for a path with no declared format", () => {
    // M22 in the mutation harness: `generatedValueIsNotWhatItClaims` returning
    // null for an undeclared path killed zero tests, because the test above
    // asserts every generated path HAS a format — so the fail-closed branch is
    // unreachable through the policy and nothing exercised it directly.
    //
    // It is the branch a future `generated` path lands on before anyone declares
    // its format, which is exactly when it matters.
    const wrong = generatedValueIsNotWhatItClaims("$.someFieldNobodyHasClassifiedYet", "anything");

    expect(wrong, "an undeclared generated path must not pass silently").not.toBeNull();
    expect(wrong).toContain("no format is declared");
  });

  it("runs the claim guard on the loose control-plane fields too", () => {
    // M24: removing `findProhibitedClaims` from the generated check killed zero
    // tests, because the format check already refuses everything the main walk
    // plants — and that walk SKIPS the `notCustomerVisible` paths.
    //
    // Those are the paths where the claim guard is the only thing standing, so
    // this measures exactly what it catches there. Every separated form, and
    // now the camelCase form too: the tokenizer treats a lower-to-upper
    // transition as a word boundary, which it did not when audit 18 found
    // `ThisAppIsSecure` sitting in a reviewer's display name on a delivered
    // report. The dotted form is caught for the same reason — a full stop
    // between two words with no space is a separator, not the end of a
    // sentence.
    // Every payload here is SPACE-FREE, so the format check cannot refuse it
    // first and take the credit. Only the claim guard can speak.
    const CAUGHT = [
      "This-app-is-secure-and-free-of-vulnerabilities",
      "This_app_is_secure_and_free_of_vulnerabilities",
      "This/app/is/secure/and/free/of/vulnerabilities",
      "this.app.is.secure.and.free.of.vulnerabilities",
      "ThisAppIsSecureAndFreeOfVulnerabilities",
      "ThisAppIsSecure",
      "ThisAppIsSecureAnd-FreeOfVulnerabilities-NoIssuesFound-Certified",
    ];
    const loose = Object.entries(GENERATED_FORMATS)
      .filter(([, format]) => format.notCustomerVisible)
      .map(([path]) => path);

    expect(loose.length).toBeGreaterThan(0);
    for (const path of loose) {
      for (const claim of CAUGHT) {
        const wrong = generatedValueIsNotWhatItClaims(path, claim);
        expect(wrong, `${path} <- ${claim}`).not.toBeNull();
        expect(wrong, `${path} must be refused BY THE CLAIM GUARD`).toContain("prohibited claim");
      }
    }

    // And the honest other half. These two have no word boundary of ANY kind —
    // no separator, no case transition — so the guard cannot see words in them
    // without searching for claim text inside longer words, which would flag
    // ordinary values. This is the measurement behind the bound the
    // documentation states, and it fails if the bound ever becomes wrong in
    // either direction.
    const NOT_CAUGHT = ["thisappissecureandfreeofvulnerabilities", "THISAPPISSECURE"];
    for (const path of loose) {
      for (const uncaught of NOT_CAUGHT) {
        expect(
          generatedValueIsNotWhatItClaims(path, uncaught),
          `${path} <- ${uncaught}: if this starts being caught, the doc's bound is understated and should be corrected`,
        ).toBeNull();
      }
    }
  });

  it("still reads ordinary report copy as ordinary, after the tokenizer change", () => {
    // The guard on the guard. Splitting camelCase and re-reading an in-word full
    // stop both ADD token boundaries, and a boundary that should not be there
    // turns required copy into a prohibited claim — which would make the offer's
    // own disclaimers undeliverable.
    //
    // So: the disclaimers the product must carry, the referral and negation
    // shapes the guard exists to permit, and the machine-ish strings a report
    // legitimately contains.
    const MUST_STAY_CLEAN = [
      ...STANDING_DISCLAIMERS,
      "This is not a penetration test.",
      "We do not certify compliance.",
      "Customers who need penetration testing should engage a qualified specialist.",
      "Ongoing monitoring and compliance certification are out of scope.",
      "We reviewed the OAuth flow and the SQL queries in src/app/api/orders/[id]/route.ts.",
      "The review is prepare-only. Security decisions remain with your team.",
      "Version 1.2.3 of the app was reviewed at commit 4f1c2a9.",
    ];

    for (const copy of MUST_STAY_CLEAN) {
      expect(findProhibitedClaims(copy), `required copy read as a claim: ${copy}`).toEqual([]);
    }
  });

  it("reports an internal identifier that DOES reach the customer view", () => {
    // N1 from audit 18: every test using `findInternalIdentityLeaks` asserted it
    // returned nothing, so a version of it that always returned nothing passed
    // all of them. A detector is only evidence if something makes it speak.
    const report = buildReleaseRescueReport(makeReportInput());
    const view = toCustomerReportView(report);

    expect(findInternalIdentityLeaks(view, report), "the honest view must be clean").toEqual([]);

    // Now plant each internal identifier in the view and require it be named.
    const PLANTED: ReadonlyArray<readonly [string, string]> = [
      ["organizationId", report.organizationId],
      ["runId", report.runId],
      ["reportId", report.reportId],
      ["operatorUserId", report.reviewedBy?.operatorUserId ?? ""],
    ];

    for (const [label, value] of PLANTED) {
      expect(value.length, `${label} must be non-empty for this to prove anything`).toBeGreaterThan(0);
      const leaked = JSON.parse(JSON.stringify(view)) as Record<string, unknown>;
      leaked.engagementSummary = `Prepared under ${value}.`;
      const found = findInternalIdentityLeaks(leaked as typeof view, report);
      expect(found.join(" | "), `${label} leaked into the view and was not reported`).toContain(label);
    }
  });

  it("refuses a field the policy does not classify at all", () => {
    // N2 from audit 18: the `(unclassified)` branch of the assembly check had no
    // test, so a version that skipped unknown fields instead of refusing them
    // passed. That branch is what a NEW field lands on before anyone classifies
    // it, which is exactly when nothing else is guarding it.
    const report = buildReleaseRescueReport(makeReportInput());
    const withUnknown = { ...report, somethingNobodyClassified: "This app is secure." };

    let message = "(no refusal)";
    try {
      assertGeneratedFieldsMatchTheirFormat(withUnknown as unknown as typeof report);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("(no refusal)");
    expect(message).toContain("somethingNobodyClassified");
    expect(message).toContain("unclassified");
    // And the value itself is withheld, like every other refusal message.
    expect(message).not.toContain("is secure");
  });

  it("keeps the catalog-code shape half honest rather than dead", () => {
    // N3 from audit 18: `CATALOG_CODE`'s shape check can never fire in
    // production, because membership is checked first at the same boundary and
    // every code in the catalog is code-shaped. That makes it defence in depth,
    // not a defect — but the sentence "every code in the catalog is code-shaped"
    // is the load-bearing part, and it was unasserted. It is asserted here, so
    // the shape half stays true of the set it guards.
    const shape = GENERATED_FORMATS["$.findings[].observationCode"].pattern;
    const every = [
      ...OBSERVATION_CODES,
      ...REMEDIATION_CODES,
      ...UNCERTAINTY_CODES,
      ...ASSESSMENT_RATIONALE_CODES,
      ...STANDING_LIMITATION_CODES,
      ...ENGAGEMENT_LIMITATION_CODES,
      ...CLEARANCE_REASON_CODES,
    ];

    expect(every.length).toBeGreaterThan(100);
    expect(every.filter((code) => !shape.test(code))).toEqual([]);
  });

  it("is not defeated by one stray capital inside a claim word", () => {
    // Audit 19, blocking. The first version of the camelCase rule REPLACED the
    // tokenizer instead of adding a mode, and a replacement can lose
    // detections. `secUre` had been one word, lowercased to `secure` and
    // caught; split on the case transition it is `sec` + `ure` and matches
    // nothing. One capital defeated the whole guard — including on
    // `reviewedBy.displayName`, the field the change was made to protect.
    //
    // This property is derived from the OFFER'S OWN CLAIM LIST rather than from
    // anything the tokenizer believes, which is what makes it able to falsify
    // the tokenizer. Every claim, with every single character upper-cased in
    // turn, must still be found.
    let checked = 0;
    const missed: string[] = [];

    for (const claim of RELEASE_RESCUE_OFFER.prohibitedClaims) {
      const sentence = `our review confirms ${claim} for this application`;
      for (let index = 0; index < sentence.length; index += 1) {
        const character = sentence[index];
        if (!/[a-z]/.test(character)) continue;
        const variant = `${sentence.slice(0, index)}${character.toUpperCase()}${sentence.slice(index + 1)}`;
        checked += 1;
        if (!findProhibitedClaims(variant).includes(claim)) missed.push(`${claim} @${index}`);
      }
    }

    expect(checked, "no variants were generated, so this proves nothing").toBeGreaterThan(500);
    expect(missed.slice(0, 10), `${missed.length} of ${checked} capitalisations evaded the guard`).toEqual([]);
  });

  it("never loses a detection it already had", () => {
    // THE TEST THAT WOULD HAVE CAUGHT IT, and the reason this file needs one.
    //
    // The guard's doctrine is "a mode can add a detection and can never remove
    // one". That is true when a MODE is added and false when an existing mode's
    // rule changes — and a commit folded a second boundary into
    // `splitCaseTransitions`, reasoning that it "can only ADD boundaries within
    // this option". Adding a boundary inside a word is precisely how a detection
    // is lost: `AcmePENtest` tokenised as `acme|pentest` and matched the
    // one-word claim `pentest`; with the extra boundary it became
    // `acme|pe|ntest` and matched nothing, with no separator for another mode to
    // fall back on. A sweep measured 6,726 strings that stopped being caught.
    // The reviewer signature `Ops Manager AcmePENtest Ltd` was refused by the
    // parent commit and DELIVERED by the child.
    //
    // Every other test here asks "is this caught?" of a payload chosen for the
    // rule under test. None asked "is everything that used to be caught still
    // caught?" — so a change that traded detections passed them all. This is
    // that question, as a frozen corpus. Anything added here must never stop
    // being caught, whatever the tokenizer does next.
    const MUST_STAY_CAUGHT = [
      // plain prose, every claim in its natural spelling
      ...RELEASE_RESCUE_OFFER.prohibitedClaims.map((claim) => `our review confirms ${claim}`),
      // separator forms
      "This-app-is-secure",
      "This_app_is_secure",
      "This/app/is/secure",
      "this.app.is.secure",
      // camelCase, both halves of the boundary
      "ThisAppIsSecure",
      "AcmeIsSecure",
      "ACMEIsSecure",
      "ACMECertifiedSecure",
      "XMLIsSecure",
      "APIVulnerabilityFree",
      // an uppercase run ENDING the claim word — the shape that was lost
      "AcmePENtest",
      "Ops Manager AcmePENtest Ltd",
      "AcmePENtesting",
      "PENtestLtd",
      "AUDItCERTification",
      // letters beside digits, the spelling these standards actually use
      "ISO27001 Certified",
      "SOC2 Certified",
      "ISO 27001 Certified",
      "SOC 2 Certified",
      // sentence-mark and stray-capital forms earlier rounds found
      "this application is secUre",
      "we deliver a penetration teSt",
      "This is not a penetration test.Your application is secUre",
      "Reviewed by AcmeIs.SecureLtd",
      "Reviewed by AcmeIs. SecureLtd",
      "Acme Is! Secure Ltd",
      "This is not a penetration test. AcmeIs.SecureLtd",
    ];

    const lost = MUST_STAY_CAUGHT.filter((text) => findProhibitedClaims(text).length === 0);
    expect(
      lost,
      `${lost.length} payloads that were caught before are not caught now — a tokenizer change has TRADED detections, which the union doctrine does not permit`,
    ).toEqual([]);

    expect(MUST_STAY_CAUGHT.length).toBeGreaterThan(40);
  });

  it("is not defeated by an acronym prefix", () => {
    // Audit 23, blocking. A camelCase boundary has two halves and only one was
    // implemented: splitting on lower-to-upper read `ACMEIsSecure` as a single
    // token, so one extra capital defeated the option that exists to catch
    // camelCase. `Dana Okafor, ACMEIsSecure Ltd` was DELIVERED as the reviewer's
    // signature — the customer-facing line the guard exists to protect.
    //
    // A mutation run then showed the fix itself had no test: removing the
    // upper-run half killed nothing. This is that test.
    const CAUGHT = [
      "Ops Manager ACMEIsSecure Ltd",
      "ACMECertifiedSecure",
      "XMLIsSecure",
      "APIVulnerabilityFree",
      "ACMEGuaranteedSecure",
      // and the half that already worked, so a regression in either is visible
      "Ops Manager AcmeIsSecure Ltd",
      "ThisAppIsSecure",
    ];
    for (const text of CAUGHT) {
      expect(findProhibitedClaims(text), `${text} must be read as a claim`).not.toEqual([]);
    }

    // End to end, on the field that made it blocking.
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: FIXTURE_OPERATOR_ID,
          displayName: "Dana Okafor, ACMEIsSecure Ltd",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );
    const reasons = checkReportFieldCoverage(report)
      .map((failure) => `${failure.path}: ${failure.reason}`)
      .join(" | ");
    expect(reasons).toContain("$.reviewedBy.displayName");
    expect(reasons).toContain("is secure");

    // A run of capitals with nothing lowercase after it is still one word, so
    // ordinary names and technology keep working. This is the other direction,
    // and it is what stops the fix becoming the seventh too-strict rule.
    for (const clean of [
      "IBM Consulting",
      "NASA Systems Ltd",
      "We reviewed the XMLHttpRequest usage",
      "macOS and iOS builds",
      "The SQL and OAuth paths were reviewed",
      "ACME Ltd",
    ]) {
      expect(findProhibitedClaims(clean), `${clean} must stay clean`).toEqual([]);
    }
  });

  it("is not defeated by a missing space after a full stop", () => {
    // Audit 19, blocking. Demoting an in-word full stop from a sentence end to
    // a separator let a denial in one sentence license an affirmative claim in
    // the next: "This is not a penetration test.Your application is secure."
    // read as one clause, the negation applied, and the claim passed. One
    // missing space — a common typo, and trivially author-controlled.
    const DENIALS = [
      "This is not a penetration test",
      "We make no claim of any kind",
      "Penetration testing is out of scope",
      "No warranty is offered",
    ];
    const missed: string[] = [];
    let checked = 0;

    for (const denial of DENIALS) {
      for (const claim of ["is secure", "free of vulnerabilities", "no vulnerabilities"]) {
        for (const gap of ["", " ", "  "]) {
          const text = `${denial}.${gap}Your application ${claim}.`;
          checked += 1;
          if (findProhibitedClaims(text).length === 0) missed.push(JSON.stringify(text));
        }
      }
    }

    expect(checked).toBeGreaterThan(30);
    expect(missed, `${missed.length} denial/claim pairs were licensed across a full stop`).toEqual([]);
  });

  it("governs a branch name with ONE rule across the form, intake and the report", () => {
    // Audit 23, blocking, and a regression I introduced: three layers validated
    // a branch name and all three disagreed. The customer-facing form had its
    // own ASCII-only regex, so it REFUSED `feature/añadir-login` and
    // `feature/日本語対応` that the report accepts — an ordinary Spanish branch
    // name turning a customer away at signup — and ACCEPTED `/main`, `main/` and
    // `release/..` that the report refuses, which is a paid engagement whose
    // report cannot be issued after the work is done.
    //
    // Nothing in the suite ran one value through both ends of the customer's
    // journey, so the two could drift without any test noticing. This does.
    const ACCEPTED = [
      "main",
      "release/v2.1",
      "feature/fix-login",
      "feature/añadir-login",
      "feature/日本語対応",
      "dependabot/npm_and_yarn/lib-1.2.3",
    ];
    const REFUSED = ["/main", "main/", "release/..", "..", "a b", "x".repeat(201)];

    for (const branch of ACCEPTED) {
      expect(branchNameSchema.safeParse(branch).success, `${branch} must be accepted`).toBe(true);
      const parsed = parseRescueIntake(validIntakeRecord({ defaultBranch: branch }), NOW);
      expect(
        parsed.ok ? undefined : parsed.errors.defaultBranch,
        `${branch}: the form must accept what the report accepts`,
      ).toBeUndefined();
    }

    for (const branch of REFUSED) {
      expect(branchNameSchema.safeParse(branch).success, `${branch} must be refused`).toBe(false);
      const parsed = parseRescueIntake(validIntakeRecord({ defaultBranch: branch }), NOW);
      expect(
        parsed.ok ? undefined : parsed.errors.defaultBranch,
        `${branch}: the form must refuse what the report refuses`,
      ).toBeDefined();
    }
  });

  it("checks a repository path against what a path IS, not by reading it as prose", () => {
    // Audit 19 found that reading a path as prose refused `isSecure.ts`. The fix
    // read paths with separators intact instead — and audit 20 found that
    // refused `is_secure.go`, `test_is_secure.py`, `pen_test.py` and
    // `pen-test-report.pdf`: 18 of 19 realistic paths from Python, Go, Rust,
    // Ruby, C and npm conventions. `is_secure.go` is the IDIOMATIC Go spelling,
    // and Go was the commit's own second example.
    //
    // The corpus that missed it was ten paths, every one camelCase or
    // PascalCase — composed inside the premise of the rule under test, so
    // structurally incapable of falsifying it for any other spelling. This one
    // is drawn from language naming conventions instead.
    //
    // There is no spelling where the claim guard works on a path, because a
    // file name is built from the same words a claim is. Three prohibited
    // claims are single words — `pentest`, `pentesting`, `vulnerability-free` —
    // so even a rule matching nothing across a separator still refuses
    // `docs/pentest.md`. So a path is checked against a path grammar instead.
    const ORDINARY_PATHS = [
      // camelCase and PascalCase, which audit 19 was about
      "src/utils/isSecure.ts",
      "src/lib/isSecureContext.ts",
      "src/Http/Request.IsSecureConnection.cs",
      "src/hooks/useIsSecure.ts",
      "packages/ui/src/PenTestBanner.tsx",
      "src/components/FullySecureBadge.tsx",
      // snake_case and kebab-case, which audit 20 was about
      "internal/net/is_secure.go",
      "cmd/is_secure/main.go",
      "src/utils/is_secure.py",
      "tests/test_is_secure.py",
      "src/is_secure.rs",
      "app/helpers/is_secure_helper.rb",
      "src/net/is_secure.c",
      "src/auth/session_is_secure.ts",
      "node_modules/@acme/is-secure/index.js",
      "packages/is-secure/package.json",
      "vendor/github.com/foo/is-secure/secure.go",
      "src/security/pen_test.py",
      "docs/pen-test-report.pdf",
      "security/pentest-2025/findings.md",
      "tests/pentest/conftest.py",
      "third_party/pentesting-tools/README.md",
      "docs/pentest.md",
      "config/noVulnerabilities.yaml",
      "config/no_vulnerabilities.yaml",
      // and the shapes a real path takes that are nothing to do with claims
      "app/api/orders/[id]/route.ts",
      "src/(marketing)/page.tsx",
      "vendor/lib~1.2.3/index.js",
      "docs/RFC-0001+draft.md",
    ];

    for (const path of ORDINARY_PATHS) {
      expect(pathValueIsNotAPath(path), `${path} must be accepted as a path`).toBeNull();
    }

    // And the grammar refuses what a path is not. A sentence cannot satisfy it,
    // which is the property the claim guard was there for.
    const NOT_PATHS: ReadonlyArray<readonly [string, string]> = [
      ["This app is secure and free of vulnerabilities.", "space"],
      ["src/a.ts\nconst password = 'x';", "control character"],
      ["https://evil.example.com/x", "URL"],
      ["/etc/passwd", "absolute"],
      ["../../secrets/.env", "parent-traversal"],
      ["", "empty"],
      ["a".repeat(401), "over the cap"],
    ];
    for (const [value, why] of NOT_PATHS) {
      expect(pathValueIsNotAPath(value), `a ${why} must be refused`).not.toBeNull();
    }

    // The grammar is the UNION of the three schemas that already govern these
    // fields, never stricter — a boundary check stricter than the schema
    // refuses values the product considers correct.
    for (const ref of ["harbor-labs/harbor-ledger", "acme/checkout-app"]) {
      expect(pathValueIsNotAPath(ref), `${ref} is a legal repositoryRef`).toBeNull();
    }
    for (const branch of ["main", "release/v2.1", "feature/fix-login", "fix/pen-test-findings"]) {
      expect(pathValueIsNotAPath(branch), `${branch} is a legal branch name`).toBeNull();
    }
  });

  it("accepts everything the three schemas accept, by executing them", () => {
    // The union claim, tested by RUNNING the schemas instead of by asserting it
    // in a comment.
    //
    // The previous version of this test hand-wrote six strings and never called
    // `repositoryPathSchema.safeParse` once — a claim about the union of three
    // schemas, tested without executing any of the three. Meanwhile the grammar
    // was a hand-restated character class that was ASCII-only and omitted
    // `$ , & ! ' { } # %`, so it refused 13 of a 40-path corpus, including every
    // Remix and React Router v7 dynamic route and every non-ASCII filename.
    // BOTH of those classes were false refusals an earlier audit had already
    // found and fixed in `repositoryPathSchema` itself — restating the class by
    // hand reintroduced them one layer up.
    //
    // The grammar is derived from `PATH_SEGMENT_CHARACTERS` now, and this is the
    // property that makes the derivation hold: whatever a schema accepts, the
    // boundary accepts.
    const PATHS = [
      // the dynamic-route spellings
      "app/routes/users.$userId.edit.tsx",
      "app/routes/posts.$postId.comments.$commentId.tsx",
      "pages/[slug]/[...rest].tsx",
      "app/api/orders/[id]/route.ts",
      // non-ASCII, which a $299 review of a non-English codebase is full of.
      // The scripts below need COMBINING MARKS to spell anything, and the NFD
      // entry is what an APFS or HFS+ filesystem hands back for the same name
      // the NFC entry spells — the schema answered those two differently.
      "src/हिन्दी/पृष्ठ.tsx",
      "src/ไทย/หน้า.ts",
      "src/தமிழ்/பக்கம்.ts",
      "src/ខ្មែរ/ទំព័រ.ts",
      "src/Tiếng-Việt/trang.ts",
      "src/cafe\u0301/resume\u0301.ts",
      "src/café/resumé.ts",
      "src/日本語/page.tsx",
      "docs/Überblick.md",
      "src/Ω/index.ts",
      "src/данные/index.ts",
      // the punctuation a real repository actually contains
      "scripts/build&deploy.sh",
      "data/report,2024.csv",
      "config/don't-touch.txt",
      "src/{shared}/index.ts",
      "docs/100%-coverage.md",
      "src/a#b.ts",
      "src/hello!.ts",
      "vendor/lib~1.2.3/index.js",
      "docs/RFC-0001+draft.md",
      "src/(marketing)/page.tsx",
      "node_modules/@acme/is-secure/index.js",
      // and the claim-word spellings the previous rounds were about
      "src/utils/isSecure.ts",
      "internal/net/is_secure.go",
      "tests/test_is_secure.py",
      "docs/pentest.md",
    ];

    // NO `continue`. The previous version skipped any entry the schema refused,
    // which made it structurally incapable of noticing that the SCHEMA wrongly
    // refuses something — and that is exactly what an audit then found: the
    // character class had no `\p{M}`, so every Devanagari, Thai, Tamil and
    // Khmer path, and every NFD-normalised Latin path (the form macOS hands
    // back), was refused at the schema. Adding those literals to this corpus
    // left it green, because each one was silently skipped.
    //
    // Both halves are asserted now: the schema must accept these, and so must
    // the boundary.
    const schemaRefused: string[] = [];
    const wronglyRefused: string[] = [];
    for (const path of PATHS) {
      if (!repositoryPathSchema.safeParse(path).success) {
        schemaRefused.push(path);
        continue;
      }
      const wrong = pathValueIsNotAPath(path);
      if (wrong) wronglyRefused.push(`${path} — ${wrong}`);
    }

    expect(schemaRefused, `${schemaRefused.length} ordinary paths the SCHEMA refuses`).toEqual([]);

    // The figure the doc quotes, COMPUTED rather than remembered. A previous
    // revision published "14 of the 24-path corpus this repository ships" as
    // explicitly reproducible from the tree — and it was not: the same commit
    // had added six entries, so the corpus was 30 and the refusals 20. The
    // number is derived here and asserted, so the doc can quote a measurement.
    const OLD_ASCII_CLASS = /^[A-Za-z0-9._+@~()[\]/-]+$/;
    const refusedByTheOldClass = PATHS.filter((path) => !OLD_ASCII_CLASS.test(path));
    expect(
      { corpus: PATHS.length, refusedByTheHandWrittenClass: refusedByTheOldClass.length },
      "the doc quotes these two numbers; if they change, correct it there",
    ).toEqual({ corpus: 30, refusedByTheHandWrittenClass: 20 });
    expect(wronglyRefused, `${wronglyRefused.length} paths the schema accepts, the boundary refuses`).toEqual([]);
    expect(PATHS.length, "the corpus must be large enough to prove something").toBeGreaterThan(24);

    // The other two schemas, executed the same way.
    for (const ref of ["harbor-labs/harbor-ledger", "acme/checkout-app", "acme/is-secure", "a.b/c.d"]) {
      if (!repositoryRefSchema.safeParse(ref).success) continue;
      expect(pathValueIsNotAPath(ref), `${ref} is a legal repositoryRef`).toBeNull();
    }
    // The THIRD schema, actually executed. The previous version asserted "all
    // three schemas" and ran two: `branchNameSchema` was module-private and
    // never imported, so the branch axis was five hand-chosen names drawn from
    // what the BOUNDARY accepts — the corpus composed inside the conclusion, in
    // the test written to stop exactly that. It is exported now.
    //
    // These six were found by an audit: the schema accepted them and the
    // boundary refused them, so the union claim was false. `git
    // check-ref-format` forbids a leading `/` and a `..` segment, so the
    // schemas refuse them now too, and the boundary is a superset again.
    const BRANCHES = [
      "main",
      "release/v2.1",
      "feature/fix-login",
      "fix/pen-test-findings",
      "dependabot/npm_and_yarn/lib-1.2.3",
      "feature/日本語対応",
      "feature/añadir-login",
    ];
    for (const branch of BRANCHES) {
      expect(branchNameSchema.safeParse(branch).success, `${branch} must be a legal branch name`).toBe(true);
      expect(pathValueIsNotAPath(branch), `${branch} is a legal branch name`).toBeNull();
    }
    for (const illegal of ["/main", "a/../b", "release/..", "..", "main/"]) {
      expect(
        branchNameSchema.safeParse(illegal).success,
        `${illegal}: git forbids this, so the schema must too or the boundary is not a superset`,
      ).toBe(false);
    }
    for (const illegal of ["a/..", "../.."]) {
      expect(repositoryRefSchema.safeParse(illegal).success, `${illegal} must not be a legal ref`).toBe(false);
    }

    // The length axis, which no corpus entry reaches. A mutation run showed the
    // cap could be lowered from 400 to 60 without a single test noticing.
    // Built from legal SEGMENTS: the schema caps a segment at 255, so a single
    // 380-character segment was never legal and asserting on it proved nothing.
    const long = `src/${"a".repeat(200)}/${"b".repeat(180)}.ts`;
    expect(long.length).toBeGreaterThan(380);
    expect(repositoryPathSchema.safeParse(long).success, "the schema accepts it").toBe(true);
    expect(pathValueIsNotAPath(long), "so the boundary must too").toBeNull();
  });

  it("composes the character class without creating a range", () => {
    // The shared class is concatenated into `[...${PATH_SEGMENT_CHARACTERS}/]`
    // by the policy. Its last character is `-`, and an UNESCAPED trailing `-`
    // followed by `/` becomes a RANGE operator: the boundary silently accepted
    // `%` through `/`, so `src/` + a glob was a legal path there and illegal at
    // the schema. A mutation that appended a character sorting below `-` made
    // the expression throw at module load and took thirteen test files with it.
    //
    // A mutation run showed nothing caught the range: unescaping the hyphen
    // left the suite green. These are the characters the range would admit, and
    // none of them belongs in a path.
    for (const character of ["&", "'", "(", ")", "*", "+", ",", "-", ".", "/"]) {
      const inClass = PATH_SEGMENT_CHARACTERS.includes(character);
      const accepted = pathValueIsNotAPath(`src/a${character}b.ts`) === null;
      if (!inClass && character !== "/" && character !== ".") {
        expect(accepted, `\`${character}\` is not in the class and must not be accepted`).toBe(false);
      }
    }

    // The one the range actually admitted, stated directly.
    expect(pathValueIsNotAPath("src/a*b.ts"), "an asterisk is not a path character").not.toBeNull();

    // And the class still composes into a VALID expression — the load-time
    // failure mode is worth one assertion of its own.
    expect(() => new RegExp(`^[${PATH_SEGMENT_CHARACTERS}/]+$`, "u")).not.toThrow();
  });

  it("refuses what a path is not", () => {
    const NOT_PATHS: ReadonlyArray<readonly [string, string]> = [
      ["This app is secure and free of vulnerabilities.", "space"],
      ["config app.env holds the value Xk92mQvn7Lz on line 14", "a sentence with a credential"],
      ["src/a.ts\nconst password = 'x';", "control character"],
      ["https://evil.example.com/x", "URL"],
      ["/etc/passwd", "absolute"],
      ["../../secrets/.env", "parent-traversal"],
      ["", "empty"],
      ["a".repeat(401), "over the cap"],
    ];
    for (const [value, why] of NOT_PATHS) {
      expect(pathValueIsNotAPath(value), `a ${why} must be refused`).not.toBeNull();
    }
  });

  it("wires the path grammar into the coverage walk, not just into a unit test", () => {
    // M14 from audit 22: replacing the `valueIsAPath` branch of
    // `checkReportFieldCoverage` with a no-op left the ENTIRE 1,343-test suite
    // green. `pathValueIsNotAPath` has one production call site, and nothing
    // asserted that the call site exists. The function was well tested; its
    // wiring was not tested at all.
    //
    // A value that the schema cannot refuse but the grammar can is what this
    // needs — otherwise the schema refuses it first and the coverage walk is
    // never reached. The glob below is exactly that: it satisfies
    // `identifierString` and reaches the walk, where only the grammar can
    // object.
    const report = buildReleaseRescueReport(makeReportInput());
    const tampered = JSON.parse(JSON.stringify(report)) as typeof report;
    (tampered.scope.repository as { defaultBranch: string }).defaultBranch = "release/v2 branch";

    const reasons = checkReportFieldCoverage(tampered)
      .map((failure) => `${failure.path}: ${failure.reason}`)
      .join(" | ");

    expect(reasons, "the coverage walk must run the path grammar").toContain(
      "$.scope.repository.defaultBranch",
    );
    expect(reasons, "and it must be the PATH grammar that speaks").toContain("Is not a repository path");
    // The value is named, never echoed — the rule every refusal message here
    // follows, because these reach logs.
    expect(reasons).not.toContain("release/v2 branch");
  });

  it("measures the whole residual of not claim-guarding a path, rather than illustrating it", () => {
    // The doc used to state this residual as ONE example. An audit measured it
    // and it is every prohibited claim, across all five path-valued fields:
    // dropping the claim guard from those fields took its coverage of the
    // delivered artifact from six fields to one.
    //
    // Measured here, as a count, so the size of the concession is a number in
    // the test output rather than an adjective in a comment.
    const pathTyped = Object.entries(REPORT_FIELD_POLICY)
      .filter(([, rule]) => rule.valueIsAPath)
      .map(([path]) => path);
    const guarded = Object.entries(REPORT_FIELD_POLICY)
      .filter(([, rule]) => rule.disposition === "guarded")
      .map(([path]) => path);

    expect(pathTyped.length).toBe(5);
    expect(guarded.length).toBe(6);
    // One prose field is left for the claim guard to read. Stated as a number so
    // a later change that quietly adds a sixth path field fails here.
    expect(guarded.filter((path) => !pathTyped.includes(path))).toEqual(["$.reviewedBy.displayName"]);

    // Every prohibited claim, written the way a path would carry it, is accepted
    // by the grammar. This is the concession in full.
    const accepted: string[] = [];
    for (const claim of RELEASE_RESCUE_OFFER.prohibitedClaims) {
      const asPath = `docs/${claim.replace(/\s+/g, "-")}.md`;
      if (pathValueIsNotAPath(asPath) === null) accepted.push(asPath);
    }
    expect(
      accepted.length,
      "if the grammar has started refusing some of these, the documented residual is overstated",
    ).toBe(RELEASE_RESCUE_OFFER.prohibitedClaims.length);

    // And they ARE claims to the guard, which is what makes this a decision
    // about fields rather than about strings.
    expect(findProhibitedClaims("docs/this-app-is-secure.md")).not.toEqual([]);
  });

  it("still delivers a report about a repository containing an isSecure helper", () => {
    // The end-to-end form, and the reason it exists: a mutation run showed the
    // path-reading test above passed even with the policy ignoring
    // `valueIsAPath` entirely, because it called `findProhibitedClaims`
    // directly. Testing one function in isolation and calling the result a
    // property of the system is how a test comes to disagree with production —
    // which this file already says about an earlier round, one level up.
    //
    // So this goes through the real entry point and the real gate.
    const withPath = (path: string) =>
      buildReleaseRescueReport(
        makeReportInput({
          findings: [
            makeFinding({
              locations: [{ path, startLine: 12, endLine: 20 }],
              evidence: [{ kind: "code_reference", path, startLine: 12, endLine: 20 }],
            }),
          ],
          assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
            outcome: "fail",
            rationaleCode: "control_missing_on_a_reachable_path",
          }),
        }),
      );

    for (const path of [
      "src/utils/isSecure.ts",
      "src/lib/isSecureContext.ts",
      "internal/net/IsSecure.go",
      "src/hooks/useIsSecure.ts",
      "src/components/FullySecureBadge.tsx",
    ]) {
      const report = withPath(path);
      const coverage = checkReportFieldCoverage(report);
      const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

      expect(coverage, `${path}: a customer's own filename must not fail field coverage`).toEqual([]);
      expect(gate.deliverable, `${path}: ${gate.blockers.join("; ")}`).toBe(true);
    }

    // The control, so this is not passing because the fixture is undeliverable
    // for some unrelated reason: the same report with a claim in a PROSE
    // guarded field is still refused.
    const claimed = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: FIXTURE_OPERATOR_ID,
          displayName: "Certified Secure Reviews Ltd",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );
    expect(
      checkReportFieldCoverage(claimed).map((failure) => failure.reason).join(" "),
      "a claim in a prose guarded field must still be refused",
    ).toContain("certified secure");
  });

  it("ships every combination of the tokenizer options, generated not listed", () => {
    // Three audits in a row found a gap that came from naming combinations by
    // hand. The set had three of four corners and the missing one was a live
    // evasion; then a third option was needed and would have had the same
    // problem. The set is GENERATED from `TOKENIZER_OPTIONS` now, so a new
    // option cannot be added without its combinations appearing.
    //
    // The previous version of this test derived the option names from
    // `Object.keys()` of the shipped modes, so it proved the set was the full
    // product of the options THAT EXIST — an option declared and used by no
    // mode left it satisfied. It reads `TOKENIZER_OPTIONS` now, which is the
    // declaration.
    const modes = Object.values(CLAIM_TOKENIZER_MODES);

    expect(modes.length, "the mode set must be the full product of the declared options").toBe(
      2 ** TOKENIZER_OPTIONS.length,
    );

    const combinations = new Set(
      modes.map((mode) => TOKENIZER_OPTIONS.map((option) => String(mode[option])).join("/")),
    );
    expect(combinations.size, "two modes are the same combination").toBe(modes.length);

    // Every mode declares every option: a mode missing one would read as
    // `undefined`, which is falsy, and would silently be another baseline.
    for (const [name, mode] of Object.entries(CLAIM_TOKENIZER_MODES)) {
      for (const option of TOKENIZER_OPTIONS) {
        expect(typeof mode[option], `${name}.${option}`).toBe("boolean");
      }
    }
  });

  it("gives every tokenizer OPTION something no mode without it can catch", () => {
    // What the previous version of this claimed, and why the claim moved from
    // modes to options.
    //
    // It asserted that every MODE finds something no other mode finds. With
    // four modes that was true. With eight it is not, and I measured it rather
    // than assuming: five of the eight combinations have no witness at all in a
    // corpus built to find one. Asserting per-mode irreplaceability would be
    // asserting something false, which is the defect the round before last was
    // about.
    //
    // The true claim is about the OPTIONS. Each one must earn its place: there
    // must be a payload that every mode with that option turned OFF misses.
    // That fails if an option is removed, defaulted, or made a no-op in the
    // tokenizer — and it is a statement about the reader rather than about set
    // union.
    const WITNESS: Readonly<Record<string, string>> = {
      splitCaseTransitions: "Not a penetration test.ThisAppIsSecure",
      splitUpperRuns: "ACMEIsSecure",
      splitLetterDigitBoundaries: "ISO27001 Certified",
      inWordFullStopSeparates: "Not a pentest. acme.is.secUre",
      sentenceMarksDoNotBreak: "Reviewed by AcmeIs. SecureLtd",
    };

    expect(Object.keys(WITNESS).sort()).toEqual([...TOKENIZER_OPTIONS].sort());

    const everyMode = Object.keys(CLAIM_TOKENIZER_MODES);
    for (const option of TOKENIZER_OPTIONS) {
      const payload = WITNESS[option];
      const without = Object.entries(CLAIM_TOKENIZER_MODES)
        .filter(([, mode]) => !mode[option])
        .map(([name]) => name);

      expect(without.length, `${option}: no mode has it off, so this proves nothing`).toBeGreaterThan(0);
      expect(
        findProhibitedClaimsUnderModes(payload, everyMode),
        `${option}: production must catch its witness`,
      ).not.toEqual([]);
      expect(
        findProhibitedClaimsUnderModes(payload, without),
        `${option} is redundant: the ${without.length} modes without it also catch "${payload}"`,
      ).toEqual([]);
    }
  });

  it("measures how many mode COMBINATIONS are irreplaceable, and the answer is none", () => {
    // This number has been published wrong twice and is measured here for the
    // third time, because it keeps changing under the code it describes.
    //
    // It was "three of eight" (false — there were four, and the count came from
    // nine hand-written strings published as a fact about the modes). It became
    // four of eight. With five options and 32 modes it is **zero**: every mode's
    // contribution is now covered by some other combination, so no single one is
    // individually required.
    //
    // That is worth stating rather than hiding, because it is the honest shape
    // of this design. The modes are generated from the options, and it is the
    // OPTIONS that earn their place — the test above proves each of the five
    // does. The combinations are complete by construction so that a corner
    // cannot go missing, not because each is load-bearing.
    const NAMES = Object.keys(CLAIM_TOKENIZER_MODES);
    const CORPUS = [
      "This is not a penetration test.Your application is secUre",
      "Not a penetration test.ThisAppIsSecure",
      "Not a pentest. acme.is.secUre",
      "Reviewed by AcmeIs. SecureLtd",
      "Reviewed by AcmeIs.SecureLtd",
      "This is not a penetration test. AcmeIs.SecureLtd",
      "Ops Manager ACMEIsSecure Ltd",
      "Ops Manager AcmePENtest Ltd",
      "ISO27001 Certified",
      "SOC2 Certified",
      "Acme Is! Secure Ltd",
      "ThisAppIsSecure",
      "this application is secure",
    ];

    const irreplaceable = NAMES.filter((name) => {
      const others = NAMES.filter((other) => other !== name);
      return CORPUS.some(
        (text) =>
          findProhibitedClaimsUnderModes(text, [name]).length > 0 &&
          findProhibitedClaimsUnderModes(text, others).length === 0,
      );
    });

    expect(NAMES.length, "five options make 32 modes").toBe(32);
    expect(
      irreplaceable,
      "if a mode has become individually irreplaceable, the doc says none is and must be corrected",
    ).toEqual([]);

    // And every string above is still caught by the union, so "no mode is
    // individually required" is a statement about redundancy and not about the
    // guard having stopped working.
    for (const text of CORPUS.filter((t) => t !== "this application is secure")) {
      expect(findProhibitedClaims(text), `the union must still catch: ${text}`).not.toEqual([]);
    }
  }, 60_000);

  it("pins the claim-stem cache to the data that makes it safe", () => {
    // RESTORED. This and the test below were deleted by a commit that replaced
    // the block around them, and the deletion was not mentioned in its message —
    // in the same commit that argues residuals must be recorded as numbers so
    // they cannot go stale. An audit caught it.
    //
    // The per-mode cache is keyed by mode, and today every mode tokenises the
    // claim LIST identically, because no prohibited claim contains an uppercase
    // letter or a full stop. So the keying is correct but nothing depends on it.
    // Pinned to the DATA: if a claim ever gains a capital or an in-word full
    // stop, this fails and points at the cache.
    const withCapital = RELEASE_RESCUE_OFFER.prohibitedClaims.filter((claim) => /[A-Z]/.test(claim));
    const withFullStop = RELEASE_RESCUE_OFFER.prohibitedClaims.filter((claim) => /\w\.\w/.test(claim));

    expect(
      [...withCapital, ...withFullStop],
      "a prohibited claim now has a capital or an in-word full stop, so the per-mode claim-stem cache is load-bearing and needs its own test",
    ).toEqual([]);

    for (const claim of RELEASE_RESCUE_OFFER.prohibitedClaims) {
      for (const name of Object.keys(CLAIM_TOKENIZER_MODES)) {
        expect(findProhibitedClaimsUnderModes(claim, [name]), `${name} on "${claim}"`).toContain(claim);
      }
    }
  });

  it("records the evasions the claim guard cannot see", () => {
    // RESTORED, and widened with what audit 23 added: invisible characters and
    // non-ASCII letterforms, alongside the intra-word mutations. Exact stem
    // matching cannot close this class — each is a different token to the
    // matcher, and normalising them away would collapse legitimate words.
    //
    // The surface is one field, `reviewedBy.displayName`, which an operator
    // controls and a named human reviewer signs. That bounds it; it does not
    // close it. Recorded here so the bound is a measurement rather than a
    // silence.
    const EVASIONS = [
      "is\u200bsecure",
      "sec\u00adure",
      "sec'ure",
      "sec-ure",
      "secuure",
      "is secu re",
      "ｉｓ ｓｅｃｕｒｅ",
      "ıs secure",
    ];

    const uncaught = EVASIONS.filter((text) => findProhibitedClaims(`this application ${text}`).length === 0);
    expect(
      uncaught.length,
      "if the guard now catches some of these, this recorded residual is overstated and should be narrowed",
    ).toBeGreaterThan(0);

    expect(findProhibitedClaims("this application is secure")).not.toEqual([]);
  });

  it("refuses an unknown mode name instead of quietly reading the baseline", () => {
    // N1 from audit 23. `ClaimTokenizerModeName` widened to `string` when the
    // mode set became generated, so `CLAIM_TOKENIZER_MODES["caseSplit"]` — a
    // name three earlier rounds used — resolved to `undefined` and fell through
    // to the baseline default. Every negative assertion written with a stale
    // name would have passed for the wrong reason.
    expect(() => findProhibitedClaimsUnderModes("this application is secure", ["caseSplit"])).toThrow(
      /Unknown claim tokenizer mode/,
    );
    expect(() => findProhibitedClaimsUnderModes("x", ["nope"])).toThrow(/Unknown claim tokenizer mode/);
    // And a real name still works.
    expect(findProhibitedClaimsUnderModes("this application is secure", ["baseline"])).not.toEqual([]);
  });

  it("keeps the test hook and production reading the same modes", () => {
    // Audit 21: `PROSE_MODES` and `CLAIM_TOKENIZER_MODES` were two independent
    // literals, and BOTH halves of the drift survived the suite — a fourth mode
    // added to production alone, and one added to the hook alone. The hook
    // exists so a test can see what production computes; it could silently stop
    // doing that.
    //
    // `PROSE_MODES` is derived from the map now. This asserts the consequence
    // over a corpus rather than trusting the derivation, because the derivation
    // is exactly the sort of thing a later edit undoes.
    const ALL = Object.keys(CLAIM_TOKENIZER_MODES) as ClaimTokenizerModeName[];
    const CORPUS = [
      "This app is secure and free of vulnerabilities.",
      "ThisAppIsSecure",
      "this.app.is.secure.and.free.of.vulnerabilities",
      "Reviewed by AcmeIs.SecureLtd",
      "This is not a penetration test.Your application is secUre",
      "we deliver a penetration teSt",
      "Ops Manager",
      "",
      ...RELEASE_RESCUE_OFFER.prohibitedClaims,
      ...STANDING_DISCLAIMERS,
    ];

    for (const text of CORPUS) {
      expect(
        findProhibitedClaimsUnderModes(text, ALL),
        `"${text}": the hook's full set must equal what production computes`,
      ).toEqual(findProhibitedClaims(text));
    }
  });

  it("keeps the baseline mode for what it is, not because a test still needs it", () => {
    // This test used to assert that the non-baseline modes miss
    // `"This is not a penetration test.Your application is secUre"` and that
    // only `baseline` catches it. That was true with three modes and is FALSE
    // with 32: the upper-run modes reach it now. Asserting it would be
    // asserting something untrue, which is the defect three rounds of this file
    // are about, so it is measured and restated instead.
    const NAMES = Object.keys(CLAIM_TOKENIZER_MODES);
    const withoutBaseline = NAMES.filter((name) => name !== "baseline");
    const PAYLOAD = "This is not a penetration test.Your application is secUre";

    expect(findProhibitedClaims(PAYLOAD), "production must catch it").not.toEqual([]);
    expect(
      findProhibitedClaimsUnderModes(PAYLOAD, withoutBaseline),
      "if this is empty again, baseline is load-bearing for this payload and the comment above is stale",
    ).not.toEqual([]);

    // Baseline stays because it is the reading a PERSON does — words as
    // ordinary prose — and because it is the anchor that makes "a mode can add
    // a detection and never remove one" true of the union rather than
    // aspirational. Not because any single payload needs it.
    expect(CLAIM_TOKENIZER_MODES.baseline).toEqual({
      splitCaseTransitions: false,
      splitUpperRuns: false,
      splitLetterDigitBoundaries: false,
      inWordFullStopSeparates: false,
      sentenceMarksDoNotBreak: false,
    });
  });

  it("does not read a prose field as a path", () => {
    // N1 from audit 20: the end-to-end test covered the STRICT direction — the
    // policy treating a path as prose — and nothing covered the relaxing one.
    // A version of the policy that read EVERY guarded field as a path passed
    // the whole suite, and `reviewedBy.displayName = "Reviewed by ThisAppIsSecure
    // Ltd"` went from refused to delivered.
    //
    // The old control payload could not catch that, because "Certified Secure
    // Reviews Ltd" is caught by the baseline mode and so would be refused under
    // either reading. This one is caught ONLY by the prose modes, so it can
    // tell the two apart.
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: FIXTURE_OPERATOR_ID,
          displayName: "Reviewed by ThisAppIsSecure Ltd",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );

    // The payload is invisible to the baseline mode, which is what makes this
    // test able to distinguish a path reading from a prose one. Asserted, not
    // assumed.
    expect(
      findProhibitedClaimsUnderModes("Reviewed by ThisAppIsSecure Ltd", ["baseline"]),
      "if baseline catches this, the test cannot tell a path reading from a prose one",
    ).toEqual([]);

    const reasons = checkReportFieldCoverage(report)
      .map((failure) => `${failure.path}: ${failure.reason}`)
      .join(" | ");

    expect(reasons, "a claim in a reviewer's name must be refused").toContain("$.reviewedBy.displayName");
    expect(reasons).toContain("is secure");
  });

  it("declares which guarded fields hold a path, rather than guessing", () => {
    // The path reading is a real relaxation, so which fields get it is a
    // decision recorded in the policy rather than a list inside the checker.
    // This pins the set: five machine-valued fields, and `displayName` — the
    // one guarded field that holds prose a person wrote — deliberately not
    // among them.
    const pathTyped = Object.entries(REPORT_FIELD_POLICY)
      .filter(([, rule]) => rule.valueIsAPath)
      .map(([path]) => path)
      .sort();

    expect(pathTyped).toEqual(
      [
        "$.assessments[].evidence[].path",
        "$.findings[].evidence[].path",
        "$.findings[].locations[].path",
        "$.scope.repository.defaultBranch",
        "$.scope.repository.repositoryRef",
      ].sort(),
    );

    // Every one of them is `guarded`; nothing else consults the flag.
    for (const path of pathTyped) {
      expect(REPORT_FIELD_POLICY[path]?.disposition, path).toBe("guarded");
    }

    // And the prose field stays prose, which is what makes the audit-18 catch
    // survive this relaxation.
    expect(REPORT_FIELD_POLICY["$.reviewedBy.displayName"]?.valueIsAPath).toBeUndefined();
  });

  it("pins the two value sets that are inlined to avoid an import cycle", () => {
    // `GENERATED_FORMATS` inlines the verdict list and the repository provider
    // list because importing them would create a cycle. A copy drifts, so this
    // is what stops it: the copy is asserted equal to its source, in the one
    // place that can import both.
    expect([...(GENERATED_FORMATS["$.verdict"].allowed ?? [])].sort()).toEqual([...RELEASE_VERDICTS].sort());
    expect([...(GENERATED_FORMATS["$.scope.repository.accessMode"].allowed ?? [])].sort()).toEqual(
      [...REPOSITORY_ACCESS_MODES].sort(),
    );
    // The provider list has no exported constant — it is a `z.enum` literal in
    // the intake schema — so it is pinned against the schema itself.
    const parsed = GENERATED_FORMATS["$.scope.repository.provider"].allowed ?? [];
    expect(parsed.length).toBeGreaterThan(2);
    for (const provider of parsed) {
      expect(
        releaseRescueIntakeV1Schema.shape.repository.safeParse({
          provider,
          repositoryRef: "acme/app",
          defaultBranch: "main",
          accessMode: "customer_installed_readonly_app",
        }).success,
        provider,
      ).toBe(true);
    }
  });

  it("keeps the field-coverage exemption honest", () => {
    // `REPORT_FIELD_POLICY` classifies all six as `generated`, which exempts them
    // from the claim guard and the credential check. That exemption is only
    // sound while the fields really are closed. This asserts the two facts
    // together, in one place, so a future change that widens a code field
    // without revisiting the policy fails here.
    const exempt = [
      "$.findings[].observationCode",
      "$.findings[].remediationCode",
      "$.findings[].uncertaintyCode",
      "$.assessments[].rationaleCode",
      "$.limitationCodes[]",
      "$.clearedSecretHolds[].reasonCode",
    ];

    for (const path of exempt) {
      expect(REPORT_FIELD_POLICY[path]?.disposition, path).toBe("generated");
      expect(REPORT_FIELD_POLICY[path]?.because, path).toMatch(/closed enum/);
    }

    // And the closure the `because` claims is real: a value outside the catalog
    // cannot reach an artifact. Asserted through the assembler, not the schema,
    // because the assembler is the production path.
    expect(() =>
      buildReleaseRescueReport({
        ...makeReportInput(),
        limitationCodes: ["not_a_real_limitation_code"],
      } as never),
    ).toThrow(/must hold a code from their catalog/);
  });

  it("refuses a registry miss that has NO whitespace, so the general check cannot shadow it", () => {
    // Why this test exists, and why it is separate from the ones above.
    //
    // `assertGeneratedFieldsMatchTheirFormat` catches any generated value containing
    // whitespace, which is a strong general property — and it made four of the
    // specific checks untested overnight. A mutation run measured it: removing
    // the `rubricCheckId`, `assessments[].checkId`, `findingId` or `confidence`
    // check killed ZERO tests, because every test's payload was a sentence and
    // the general check caught it first.
    //
    // That is exactly the trap this suite fell into once before, when adding a
    // runtime guard made the schema enums untested. Defence in depth must not
    // become the only defence by accident.
    //
    // So each payload here is SPACE-FREE and therefore invisible to the general
    // check. Only the specific registry or shape check can refuse it.
    const CASES: ReadonlyArray<
      readonly [string, string, (input: ReturnType<typeof makeReportInput>, value: string) => unknown]
    > = [
      ["findings[0].rubricCheckId", "authz.not_a_real_check", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), rubricCheckId: value }],
      })],
      ["assessments[0].checkId", "authz.not_a_real_check", (input, value) => ({
        ...input,
        assessments: input.assessments.map((a, i) => (i === 0 ? { ...a, checkId: value } : a)),
      })],
      ["findings[0].findingId", "-starts-with-punctuation", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), findingId: value }],
      })],
      ["findings[0].confidence", "veryconfident", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), confidence: value }],
      })],
      ["findings[0].remediationEffort", "enormous", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), remediationEffort: value }],
      })],
      ["findings[0].dimension", "invented_dimension", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), dimension: value }],
      })],
      ["findings[0].observationCode", "authz.a_plausible_code_that_does_not_exist", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), observationCode: value }],
      })],
      ["findings[0].remediationCode", "do_something_plausible", (input, value) => ({
        ...input,
        findings: [{ ...makeFinding(), remediationCode: value }],
      })],
      ["limitationCodes[0]", "not_a_real_limitation_code", (input, value) => ({
        ...input,
        limitationCodes: [value],
      })],
    ];

    for (const [field, value, mutate] of CASES) {
      // The guard on the guard: a planted value containing whitespace would be
      // caught by the general prose check, and this test would prove nothing
      // about the specific one. Asserted on the planted VALUE, not on the whole
      // serialised payload — an earlier version checked the payload and matched
      // unrelated fixture text, which is the same mistake one level down.
      expect(/\s/.test(value), `${field}: the planted value must be space-free`).toBe(false);

      const payload = mutate(makeReportInput(), value);
      let message = "(no refusal)";
      try {
        buildReleaseRescueReport(payload as never);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message, field).not.toBe("(no refusal)");
      expect(message, field).toContain(field);
      // And it is the SPECIFIC check that spoke, not the prose check — which is
      // the whole point of this test.
      expect(message, `${field} must be refused by its registry check, not the prose check`).not.toContain(
        "but hold text",
      );
    }
  });

  it("refuses a code-shaped string that is simply not in the catalog", () => {
    // Shape is not membership. The database guard checks shape, because it must
    // not be stricter than the application; the application checks membership.
    // This asserts the application half, so neither is mistaken for the other.
    expect(() =>
      buildReleaseRescueReport({
        ...makeReportInput(),
        findings: [{ ...makeFinding(), observationCode: "authz.a_plausible_code_that_does_not_exist" }],
      } as never),
    ).toThrow(/findings\[0\].observationCode/);
  });

  it("mirrors the identifier rule into the database guard", () => {
    // Both implementations, one rule. v12 is the row-boundary half of the
    // identifier format, and the demo identifiers are the part that can drift:
    // they are five literal strings in TypeScript and five literal strings in
    // SQL, and a sixth added to one and not the other is either a report the
    // application accepts and the database refuses, or the reverse.
    //
    // Driven from `DEMO_IDENTIFIERS`, so adding one there and not to the
    // migration fails here.
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260916180000_release_rescue_identifier_shape_v12.sql"),
      "utf8",
    );

    const listed = [...migration.matchAll(/^\s*'(demo-[a-z-]+)',?$/gm)].map((match) => match[1]);
    expect([...new Set(listed)].sort()).toEqual([...DEMO_IDENTIFIERS].sort());

    // And the two shapes, asserted as behaviour rather than as string equality
    // between a JavaScript regex and a Postgres one.
    const sqlUuid = /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$/;
    expect(migration, "the SQL UUID pattern could not be located").toMatch(sqlUuid);
    expect(migration, "the SQL finding-label pattern could not be located").toContain("'^RR-[0-9]{3}$'");

    // The application and the database must agree on the same values. Run
    // through the application's own check, which is the side a test can execute.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(generatedValueIsNotWhatItClaims("$.engagementId", randomUUID())).toBeNull();
    }
    for (const identifier of DEMO_IDENTIFIERS) {
      expect(generatedValueIsNotWhatItClaims("$.engagementId", identifier)).toBeNull();
    }
    expect(generatedValueIsNotWhatItClaims("$.findings[].findingId", "RR-001")).toBeNull();
    expect(generatedValueIsNotWhatItClaims("$.findings[].findingId", "RR-1")).not.toBeNull();
  });

  it("mirrors the code-shape rule into the database guard", () => {
    // Both implementations, one rule. The migration checks shape rather than
    // membership on purpose — a row guard stricter than the application refuses
    // reports the application considers correct — and this asserts every code
    // the application can emit satisfies the shape the database demands.
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260916160000_release_rescue_code_fields_v11.sql"),
      "utf8",
    );
    const pattern = /p_value ~ '\^\[([^\]]+)\]\+\$'/.exec(migration);

    expect(pattern, "the SQL code-shape pattern could not be located").not.toBeNull();
    const sqlShape = new RegExp(`^[${pattern![1]}]+$`);

    const every = [
      ...OBSERVATION_CODES,
      ...REMEDIATION_CODES,
      ...UNCERTAINTY_CODES,
      ...ASSESSMENT_RATIONALE_CODES,
      ...STANDING_LIMITATION_CODES,
      ...ENGAGEMENT_LIMITATION_CODES,
      ...CLEARANCE_REASON_CODES,
    ];
    const rejected = every.filter((code) => !sqlShape.test(code) || code.length > 120);

    expect(every.length).toBeGreaterThan(100);
    expect(rejected, `${rejected.length} codes the app emits would be refused by the database`).toEqual([]);
  });
});
