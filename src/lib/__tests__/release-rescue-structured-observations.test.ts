import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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
  assertGeneratedFieldsAreNotProse,
  buildReleaseRescueReport,
  deriveReportMetrics,
  hashReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  releaseRescueReportV1Schema,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import {
  GENERATED_PROSE_PATHS,
  REPORT_FIELD_POLICY,
  checkReportFieldCoverage,
  generatedValueLooksLikeProse,
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
      findingId: "f-001",
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
            findingId: "f-001",
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
            clearedBy: "ops-1",
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
            clearedBy: "ops-1",
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

  it("lets no `generated` field hold prose, at ANY path, driven by the artifact", () => {
    // Four audits found this defect four times by finding the next `generated`
    // field along, and each fix enumerated fields:
    //
    //   14. the six catalog codes were unconstrained
    //   15. `findings[].rubricCheckId` was not on the list that fixed them
    //    -   four more found by writing a general check instead of extending it
    //   16. `$.engagementId` — TOP-LEVEL, which the "general" check's path filter
    //       `/^\$\.(findings|assessments)\[\]\.[A-Za-z]+$/` excluded along with 34
    //       other generated paths. It rendered "This app is secure and free of
    //       vulnerabilities." as the customer report's header line with
    //       `hardGatePass` true and the delivery gate open.
    //
    // That filter was itself a hand-written list, which is why it failed the
    // same way. This test has no path filter. It takes EVERY generated path the
    // policy declares, plants a sentence at it in a real report, and asserts the
    // assembler refuses it.
    const SENTENCE = "This app is secure and free of vulnerabilities.";

    const GENERATED = Object.entries(REPORT_FIELD_POLICY)
      .filter(([, rule]) => rule.disposition === "generated")
      .map(([path]) => path);

    expect(GENERATED.length, "the policy walk found nothing, so this proves nothing").toBeGreaterThan(40);

    // Plant at a path by walking the artifact to the matching leaf. Works for
    // any depth, so there is nothing to keep in step with the policy.
    function plant(value: unknown, path: string, target: string): boolean {
      if (Array.isArray(value)) {
        // An array of bare strings — `limitationCodes[]` — is a leaf itself, so
        // it needs handling here rather than in the object branch below. Missing
        // this is how a path filter starts: the check quietly stops covering a
        // shape, and nothing says so.
        for (let index = 0; index < value.length; index += 1) {
          const here = `${path}[${index}]`;
          if (typeof value[index] === "string" && normalizeFieldPath(here) === target) {
            value[index] = SENTENCE;
            return true;
          }
          if (plant(value[index], here, target)) return true;
        }
        return false;
      }
      if (value === null || typeof value !== "object") return false;
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const here = `${path}.${key}`;
        if (typeof entry === "string" && normalizeFieldPath(here) === target) {
          (value as Record<string, unknown>)[key] = SENTENCE;
          return true;
        }
        if (plant(entry, here, target)) return true;
      }
      return false;
    }

    // A report rich enough to contain every path the policy declares: a finding
    // with a residual uncertainty, a raised hold, a clearance, an engagement
    // limitation, and executor provenance. The `unreached` assertion below is
    // what keeps this fixture honest — a policy path this report cannot produce
    // means the fixture is too thin or the policy describes a field that does
    // not exist, and either way the test would silently stop covering it.
    function richReport() {
      return JSON.parse(
        JSON.stringify(
          buildReleaseRescueReport(
            makeReportInput({
              // A credential here raises an `unresolvedHolds[]` entry, which is
              // the only way those paths appear in an artifact at all.
              reviewedBy: {
                operatorUserId: "op-1",
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
                  clearedBy: "ops-1",
                  clearedAt: "2026-09-16T09:00:00.000Z",
                  reasonCode: "value_is_a_placeholder_not_a_credential",
                },
              ],
            }),
          ),
        ),
      );
    }

    const unreached: string[] = [];
    const accepted: string[] = [];

    for (const path of GENERATED) {
      // The one justified exception: a fixed sentence this codebase owns, which
      // a caller cannot supply because the sanitiser overwrites the holds array.
      if (path in GENERATED_PROSE_PATHS) continue;

      const tampered = richReport();
      if (!plant(tampered, "$", path)) {
        unreached.push(path);
        continue;
      }

      // `assertGeneratedFieldsAreNotProse` runs on the ASSEMBLED artifact, so
      // this is the check the production path actually performs.
      let refused = false;
      try {
        assertGeneratedFieldsAreNotProse(tampered);
      } catch {
        refused = true;
      }
      if (!refused) accepted.push(path);
    }

    expect(accepted, `${accepted.length} generated paths accepted a sentence`).toEqual([]);
    // Every path the policy declares must be reachable in a real report, or the
    // policy has an entry for a field that does not exist.
    expect(unreached, `${unreached.length} generated paths could not be reached in a real report`).toEqual([]);
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

  it("still accepts every identifier production actually mints", () => {
    // The other direction. A rule that refuses real ids is worse than the hole.
    for (const id of [
      `rescue_${"0123abcd-1234-5678-9abc-def012345678"}`,
      "rep-001",
      "eng-001",
      "run-001",
      "org-acme",
      "2026-09-16T09:00:00.000Z",
      "a".repeat(64),
    ]) {
      expect(generatedValueLooksLikeProse("$.engagementId", id), id).toBe(false);
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
    // `assertGeneratedFieldsAreNotProse` catches any generated value containing
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
