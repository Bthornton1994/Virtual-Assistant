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
import { prepareStoredExcerpt, sanitizeReportInput } from "@/lib/release-rescue-pipeline";
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

const ALL_SECRETS = Object.values(SECRETS);

function assertNothingLeaked(subject: unknown, where: string): void {
  const serialised = JSON.stringify(subject);
  for (const secret of ALL_SECRETS) {
    expect(serialised, `${where} leaked ${secret}`).not.toContain(secret);
  }
}

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
        makeFinding({
          title: `Database password committed as ${SECRETS.compose}`,
          whatWeObserved: `docker-compose.yml sets DB_PASSWORD=${SECRETS.compose} and SMTP_PASS=${SECRETS.smtp}.`,
          whyItMatters: `Anyone with repository access has the production database password (${SECRETS.compose}).`,
          recommendation: `Rotate ${SECRETS.compose} and move it to a secret store.`,
          locations: [
            { path: "docker-compose.yml", startLine: 4, endLine: 6, excerpt: COMPOSE },
            { path: ".pgpass", startLine: 1, endLine: 1, excerpt: PGPASS },
          ],
        }),
      ],
      limitations: [`The customer excluded the admin console. Its .env holds ${ENVFILE}`],
    }),
  );

  it("carries none of the secrets in the artifact", () => {
    assertNothingLeaked(report, "the assembled report");
  });

  it("carries none of them in the stored excerpts specifically", () => {
    for (const finding of report.findings) {
      for (const location of finding.locations) {
        assertNothingLeaked(location.excerpt, `excerpt at ${location.path}`);
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

    expect(finding.whatWeObserved).toContain("docker-compose.yml");
    expect(finding.whatWeObserved).toContain("DB_PASSWORD");
    expect(finding.whatWeObserved).toContain("[REDACTED");
    expect(finding.locations[0].path).toBe("docker-compose.yml");
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

  it("does not log the value anywhere during a normal build", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    buildReleaseRescueReport(makeReportInput({ limitations: [`DB_PASSWORD=${SECRETS.compose}`] }));

    for (const mock of [spy, errorSpy, warnSpy]) {
      const written = mock.mock.calls.flat().map(String).join(" ");
      expect(written).not.toContain(SECRETS.compose);
      mock.mockRestore();
    }
  });
});

describe("the excerpt preparation entry point", () => {
  it("redacts before truncating, so no fragment survives", () => {
    const { excerpt, classification } = prepareStoredExcerpt(`${"x".repeat(470)}DB_PASSWORD=${SECRETS.compose}`);

    expect(excerpt).not.toContain(SECRETS.compose);
    expect(excerpt).not.toContain(SECRETS.compose.slice(0, 8));
    expect(classification).toBe("credential_evidence");
  });

  it("is idempotent", () => {
    const once = prepareStoredExcerpt(COMPOSE).excerpt;

    expect(prepareStoredExcerpt(once).excerpt).toBe(once);
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
