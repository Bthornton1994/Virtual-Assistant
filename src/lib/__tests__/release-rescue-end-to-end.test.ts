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
// The same file in the shape the prose contract does not refuse, so the
// defence-in-depth path below still has something to hold. An assignment quoted
// into a limitation is refused outright now — asserted separately.
const ENVFILE_AS_YAML = `AWS_SECRET_ACCESS_KEY: "${SECRETS.aws}"\nDEBUG: true\n`;

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
  // the line. That is refused before an artifact exists — not redacted, not
  // held, refused — because the detector that would have had to judge the value
  // safe is the thing ten audits took apart.
  function quotingReport() {
    return buildReleaseRescueReport(
      makeReportInput({
        assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
          outcome: "fail",
          rationale: "The committed database password is reachable by anyone with repository access.",
        }),
        findings: [
          makeFinding({
            whatWeObserved: `docker-compose.yml sets DB_PASSWORD=${SECRETS.compose} and SMTP_PASS=${SECRETS.smtp}.`,
            locations: [{ path: "docker-compose.yml", startLine: 4, endLine: 6 }],
          }),
        ],
      }),
    );
  }

  it("is refused at assembly, naming the construct and not the value", () => {
    let message = "(no refusal)";
    try {
      quotingReport();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("(no refusal)");
    expect(message).toContain("findings[0].whatWeObserved");
    expect(message).toContain("DB_PASSWORD");
    for (const secret of ALL_SECRETS) {
      expect(message, "a refusal reaches logs; it must not carry the value").not.toContain(secret);
    }
  });

  it("is refused when quoted into a limitation, not only into an observation", () => {
    // Every executor-written field the customer reads carries the contract, not
    // just the five an earlier version named. An audit planted an assignment in
    // each of the others and delivered all of them.
    let message = "(no refusal)";
    try {
      buildReleaseRescueReport(makeReportInput({ limitations: [`The admin .env holds ${ENVFILE}`] }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("limitations[0]");
    expect(message).toContain("AWS_SECRET_ACCESS_KEY");
    for (const secret of ALL_SECRETS) {
      expect(message, "a refusal reaches logs; it must not carry the value").not.toContain(secret);
    }
  });

  it("is refused the same way through the schema, for input that reaches one", () => {
    const parsed = releaseRescueFindingV1Schema.safeParse(
      makeFinding({
        whatWeObserved: `docker-compose.yml sets DB_PASSWORD=${SECRETS.compose}.`,
        locations: [{ path: "docker-compose.yml", startLine: 4, endLine: 6 }],
      }),
    );

    expect(parsed.success).toBe(false);
    const message = parsed.success ? "" : JSON.stringify(parsed.error.issues);
    expect(message).toContain("DB_PASSWORD");
    expect(message).not.toContain(SECRETS.compose);
  });
});

describe("a report built from source containing credentials", () => {
  const report = buildReleaseRescueReport(
    makeReportInput({
      // The finding's check must be marked failing, or the report contradicts
      // itself for reasons that have nothing to do with credentials.
      assessments: setAssessment(passingAssessments(), "authz.object_level_authorization", {
        outcome: "fail",
        rationale: "The committed database password is reachable by anyone with repository access.",
      }),
      findings: [
        // The same finding, written the way the contract requires: it names the
        // settings and cites the lines. The customer opens their own checkout.
        makeFinding({
          title: "Database password committed to the repository",
          whatWeObserved:
            "docker-compose.yml assigns literal values to the DB_PASSWORD and SMTP_PASS settings rather than reading them from the environment.",
          whyItMatters:
            "Anyone with repository access has the production database password, including every past and future collaborator.",
          recommendation:
            "Rotate both values, read them from the platform secret store, and add a scanner to the pipeline so a committed credential fails the build.",
          locations: [
            { path: "docker-compose.yml", startLine: 4, endLine: 6 },
            { path: ".pgpass", startLine: 1, endLine: 1 },
          ],
        }),
      ],
      // Executor-written and rendered verbatim, so it carries the same prose
      // contract — but in a colon shape the contract deliberately does not
      // refuse, which is exactly where the scanner still has to work. It runs on
      // it as defence in depth: the value is removed, a hold is raised, and
      // delivery stops.
      limitations: [`The customer excluded the admin console. Its .env holds ${ENVFILE_AS_YAML}`],
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
    }
  });

  it("carries none of them in the customer-facing view", () => {
    assertNothingLeaked(toCustomerReportView(report), "the customer view");
  });

  it("records what it removed, with a hash rather than a copy", () => {
    expect(report.unresolvedHolds.length).toBeGreaterThan(0);
    for (const hold of report.unresolvedHolds) {
      expect(hold.originalHash).toMatch(/^[0-9a-f]{64}$/);
      expect(hold.reason.length).toBeGreaterThan(20);
    }
    assertNothingLeaked(report.unresolvedHolds, "the holds");
  });

  it("refuses delivery while credential evidence is unresolved", () => {
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(gate.deliverable).toBe(false);
    expect(gate.blockers.join(" ")).toContain("held for human review");
    expect(pendingSecretHolds(report).some((hold) => hold.classification === "credential_evidence")).toBe(true);
  });

  it("keeps the finding readable — the point is the finding, not the secret", () => {
    const finding = report.findings[0];

    // The setting is named, the file is named, the lines are cited. Nothing
    // needed redacting in the observation, because nothing was quoted into it.
    expect(finding.whatWeObserved).toContain("docker-compose.yml");
    expect(finding.whatWeObserved).toContain("DB_PASSWORD");
    expect(finding.whatWeObserved).not.toContain("[REDACTED");
    expect(finding.locations[0].path).toBe("docker-compose.yml");
    expect(finding.locations[0].startLine).toBe(4);
  });

  it("still passes deterministic validation, because a clean artifact is valid", () => {
    expect(validateReleaseRescueReport(report).hardFailures).toEqual([]);
  });
});

describe("no secret reaches logs or error output", () => {
  it("does not put the value in an exception when sanitisation is bypassed", () => {
    // The runtime backstop behind the branded type. Its message must name the
    // path and the classification, never the text, because it reaches logs.
    const raw = makeReportInput({ limitations: [`DB_PASSWORD=${SECRETS.compose}`] });
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

    // The colon form builds and is held; the assignment form is refused. Both
    // paths run here, because the refusal path is the newer one and an exception
    // reaches logs just as readily as a println.
    buildReleaseRescueReport(makeReportInput({ limitations: [`DB_PASSWORD: ${SECRETS.compose}`] }));
    try {
      buildReleaseRescueReport(makeReportInput({ limitations: [`DB_PASSWORD=${SECRETS.compose}`] }));
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
    const raw = makeReportInput({ limitations: [`DB_PASSWORD=${SECRETS.compose}`] });
    const once = sanitizeReportInput(raw);
    const twice = sanitizeReportInput(once.value);

    expect(JSON.stringify(twice.value)).toBe(JSON.stringify(once.value));
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
