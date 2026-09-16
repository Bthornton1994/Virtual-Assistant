import { describe, expect, it } from "vitest";
import {
  containsLikelySecret,
  holdsCredentialEvidence,
  redactSecrets,
} from "@/lib/release-rescue-redaction";
import { keyLooksSecret } from "@/lib/release-rescue-redaction-keys";
import { releaseRescueFindingV1Schema } from "@/lib/release-rescue-findings";
import { MAX_SCAN_LENGTH } from "@/lib/release-rescue-credential-scanner";
import { sanitizeReportInput } from "@/lib/release-rescue-pipeline";
import {
  buildReleaseRescueReport,
  pendingSecretHolds,
  releaseRescueDeliveryGate,
  validateReleaseRescueReport,
} from "@/lib/release-rescue-report";
import { LIMITATION_CATALOG, type LimitationCode } from "@/lib/release-rescue-observation-catalog";
import {
  makeFinding,
  makeReportInput,
  passingAssessments,
  setAssessment,
} from "@/lib/__tests__/release-rescue-fixtures";
import { parseRescueIntake } from "@/lib/ai-app-release-rescue/intake";

// The sixth audit, as tests.
//
// Its diagnosis was that both scanner test tables pin two dimensions nothing
// else covers: every KEY they use is already a lexicon word that already splits
// correctly, and every key sits adjacent to its value on one short line. Four of
// its five blocking findings live on those two axes. The fifth was a detector
// this repo added in the same commit that claimed to fix the false-positive
// problem, and which made it far worse.

describe("a credential key with no separator and no camel-case boundary", () => {
  // `keyNameSegments` splits on separators and camel case. A run-together
  // ALL-CAPS name has neither, so `PGPASSWORD` — libpq's own variable, read by
  // psql, pg_dump, Docker entrypoints and every CI migration step — reduced to
  // one segment that no lexicon lookup matched. `PG_PASSWORD` was credential
  // evidence; `PGPASSWORD` was invisible.
  const RUN_TOGETHER = [
    "PGPASSWORD",
    "pgpassword",
    "DBPASSWORD",
    "MYSQLPASSWORD",
    "ADMINPASSWORD",
    "ROOTPASSWORD",
    "USERPASSWORD",
    "SMTPPASSWORD",
    "FTPPASSWORD",
    "MAILPASSWORD",
    "APPSECRET",
    "APPPASSPHRASE",
    "MYAPIKEY",
    "SERVICEACCESSKEY",
    "USERCREDENTIAL",
  ];

  it("is recognised as a credential name", () => {
    const missed = RUN_TOGETHER.filter((key) => !keyLooksSecret(key));
    expect(missed, `${missed.length} run-together credential names not recognised`).toEqual([]);
  });

  it("redacts the value and blocks delivery, exactly as the separated spelling does", () => {
    const leaked: string[] = [];
    for (const key of RUN_TOGETHER) {
      const text = `${key}=pr0dXk92mQvn7Lz`;
      if (redactSecrets(text).redacted.includes("pr0dXk92mQvn7Lz")) leaked.push(key);
    }
    expect(leaked, `${leaked.length} run-together names leaked their value`).toEqual([]);
  });

  it("does not turn ordinary words that merely contain 'pass' into credentials", () => {
    // The reason `pass` stays out of the run-together list. Over-reach here
    // would hold reports over the word "bypass".
    for (const key of ["bypass", "passage", "compass", "passenger", "surpass", "passive"]) {
      expect(keyLooksSecret(key), key).toBe(false);
    }
  });

  it("has no limitation field left to quote an assignment into", () => {
    // `limitations` was an executor-written string array rendered verbatim to the
    // customer. An audit planted an assignment in each unguarded field and
    // delivered every one. The field is now `limitationCodes`, a closed enum
    // over the limitation catalog, and the old key is not part of the contract.
    const raw = makeReportInput() as unknown as Record<string, unknown>;
    const report = buildReleaseRescueReport({
      ...raw,
      limitations: ["PGPASSWORD=pr0dXk92mQvn7Lz"],
    } as never);

    expect(JSON.stringify(report)).not.toContain("pr0dXk92mQvn7Lz");
    expect(Object.keys(report)).not.toContain("limitations");
    // And what the customer reads comes from the catalog, keyed by code.
    expect(report.limitationCodes.length).toBeGreaterThan(0);
    for (const code of report.limitationCodes) {
      expect(LIMITATION_CATALOG[code as LimitationCode], code).toBeDefined();
    }
  });

  it("reaches the delivery gate, not just the detector", () => {
    // The carrier here is the reviewer's display name — one of the two free-text
    // strings a human still types into a report — in a colon form, which is what
    // the scanner rather than the schema has to catch. It still measures the
    // thing it was written to measure: the value is removed, the hold is raised,
    // and the gate stops delivery.
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: "Ops Manager PGPASSWORD: pr0dXk92mQvn7Lz",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );
    const gate = releaseRescueDeliveryGate(report, validateReleaseRescueReport(report));

    expect(JSON.stringify(report)).not.toContain("pr0dXk92mQvn7Lz");
    expect(gate.deliverable).toBe(false);
  });

  it("cannot be put into a finding at all, which is where one used to sit", () => {
    // This was a test that the excerpt had been scrubbed. The excerpt is gone,
    // so the assertion is now that the field is refused rather than cleaned.
    const parsed = releaseRescueFindingV1Schema.safeParse(
      makeFinding({
        locations: [
          {
            path: "ci/deploy.sh",
            startLine: 3,
            endLine: 3,
            excerpt: "export PGPASSWORD=pr0dXk92mQvn7Lz",
          } as never,
        ],
      }),
    );

    expect(parsed.success).toBe(false);
  });
});

describe("one character of punctuation cannot switch the detector off", () => {
  // `valueEndsSentence` routed a bare-colon assignment to `sensitive_prose`, and
  // `pushSpan` DROPS a prose span — so `password: swordfish.` produced no span at
  // all while `password: swordfish` was caught. A full stop shipped a password.
  const VALUES = ["swordfish", "opensesame", "Falcon", "letmein"];
  const PUNCTUATION = ["", ".", "!", "?", ";", ",", ". ", "..."];

  it("catches the value with any trailing punctuation", () => {
    const leaked: string[] = [];
    for (const key of ["password", "api_key", "secret", "token", "PASSWORD"]) {
      for (const value of VALUES) {
        for (const mark of PUNCTUATION) {
          const text = `${key}: ${value}${mark}`;
          if (redactSecrets(text).redacted.includes(value)) leaked.push(text);
        }
      }
    }
    expect(leaked, `${leaked.length} punctuated values survived`).toEqual([]);
  });

  it("does not deliver a report carrying one", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        reviewedBy: {
          operatorUserId: "op-1",
          displayName: "Ops Manager password: swordfish.",
          reviewedAt: "2026-09-16T10:00:00.000Z",
        },
      }),
    );

    expect(JSON.stringify(report)).not.toContain("swordfish");
    expect(pendingSecretHolds(report).length).toBeGreaterThan(0);
  });
});

describe("ordinary audit prose is not destroyed by the opaque-token rule", () => {
  // The detector added alongside the value-shape fix fired on any 12-character
  // token with a digit and a letter on a line mentioning a credential noun —
  // which is every versioned code path in this product's own findings. Worse, it
  // claimed `credential_evidence`, and `pendingSecretHolds` refuses to clear
  // that, so the report became permanently undeliverable by any human.
  const PROSE = [
    "The session token is created in src/lib/auth-v2-helpers.ts and never rotated.",
    "The API key is loaded in src/lib/stripe-client-v2.ts at module scope.",
    "Credentials are read by the deploy-2024-prod-runner job.",
    "The password policy is described in ADR-2024-011-authentication.",
    "Secrets are stored in Vault under kv/prod/app-2024-config.",
    "The signing key lives in terraform/modules/kms-v2-primary/main.tf.",
    "Our API key is managed in config/production-2024.yml.",
  ];

  for (const line of PROSE) {
    it(`leaves it exactly as written: ${line.slice(0, 44)}`, () => {
      expect(redactSecrets(line).redacted).toBe(line);
    });
  }

  it("keeps the finding readable and the report deliverable", () => {
    const report = buildReleaseRescueReport(
      makeReportInput({
        findings: [
          makeFinding({
            observationCode: "auth.session_lifetime_is_unbounded",
            remediationCode: "shorten_session_lifetime_and_revoke_on_logout",
            locations: [{ path: "src/lib/auth-v2-helpers.ts", startLine: 12, endLine: 20 }],
            evidence: [
              { kind: "code_reference", path: "src/lib/auth-v2-helpers.ts", startLine: 12, endLine: 20 },
            ],
          }),
        ],
        assessments: setAssessment(passingAssessments(), "auth.session_integrity", {
          outcome: "fail",
          rationaleCode: "control_missing_on_a_reachable_path",
        }),
      }),
    );

    // The citation is the diagnostic now, and it is structured: the finding says
    // WHERE, and the catalog says what that means. An earlier version asserted
    // on executor prose, which no longer exists.
    //
    // The versioned filename is the point. `src/lib/auth-v2-helpers.ts` is a
    // twelve-character token with a digit and a letter beside a credential noun
    // — exactly the shape the opaque-token detector destroyed reports over — and
    // it must survive into the delivered artifact untouched.
    expect(report.findings[0].locations[0].path).toBe("src/lib/auth-v2-helpers.ts");
    expect(report.findings[0].evidence[0].path).toBe("src/lib/auth-v2-helpers.ts");
    expect(pendingSecretHolds(report)).toEqual([]);
    expect(releaseRescueDeliveryGate(report, validateReleaseRescueReport(report)).deliverable).toBe(true);
  });

  it("does not refuse a prospect describing their own stack", () => {
    // The intake form's credential check, which is the surface where the cost of
    // a false positive is turning a paying prospect away rather than redacting a
    // string. Asserted on the credential error specifically, so an unrelated
    // schema complaint about a partial fixture cannot make this pass.
    for (const notes of [
      "Our API key is managed in config/production-2024.yml.",
      "The session token is created in src/lib/auth-v2-helpers.ts and never rotated.",
      "Auth: Clerk. Payments: Stripe.",
      "Credentials are read by the deploy-2024-prod-runner job.",
    ]) {
      const result = parseRescueIntake({ evidenceNotes: notes });
      const message = result.ok ? "" : JSON.stringify(result.errors);
      expect(message, notes).not.toContain("looks like a credential");
    }
  });

  it("still refuses one that really does carry a credential", () => {
    const result = parseRescueIntake({ evidenceNotes: "PGPASSWORD=pr0dXk92mQvn7Lz" });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("looks like a credential");
  });

  it("still finds a real opaque secret sitting next to a credential noun", () => {
    // The form exists for a reason and must keep working.
    const text = "Rotate the password pr0dXk92mQvn7LzAb and move it to a secret store.";
    expect(redactSecrets(text).redacted).not.toContain("pr0dXk92mQvn7LzAb");
  });

  it("holds such a token as clearable, not as an unclearable refusal", () => {
    // No assignment syntax means no certainty, and certainty is what
    // `pendingSecretHolds` refuses to let a human clear.
    const text = "Rotate the password pr0dXk92mQvn7LzAb and move it to a secret store.";
    expect(redactSecrets(text).classification).toBe("ambiguous_secret_candidate");
  });
});

describe("text past the scan limit is unexamined, not clean", () => {
  // The scanner reported `truncated` from the beginning and no caller ever read
  // it, so a credential past 64,000 characters came back as "nothing found" from
  // the one function the whole pipeline depends on.
  const OVERSIZED = `${"x".repeat(MAX_SCAN_LENGTH + 100)}\nDB_PASSWORD=hunter2hunter2\n`;

  it("reports the truncation instead of discarding it", () => {
    expect(redactSecrets(OVERSIZED).scanTruncated).toBe(true);
  });

  it("fails closed in both of the functions that decide whether text is safe", () => {
    expect(holdsCredentialEvidence(OVERSIZED)).toBe(true);
    expect(containsLikelySecret(OVERSIZED)).toBe(true);
  });

  // `prepareStoredExcerpt` is gone with the excerpt itself. What it guarded — an
  // unexamined tail must not read as clean — still holds at the scanner, which is
  // where the transient inspection happens.
  it("reports the truncation rather than reporting nothing found", () => {
    expect(redactSecrets(OVERSIZED).scanTruncated).toBe(true);
  });

  it("leaves ordinary text alone", () => {
    const result = redactSecrets("The token is rotated quarterly.");
    expect(result.scanTruncated).toBe(false);
    expect(containsLikelySecret("The token is rotated quarterly.")).toBe(false);
  });
});

describe("the sanitiser refuses what it cannot walk", () => {
  it("throws past its depth limit instead of returning the value unsanitised", () => {
    let nested: unknown = "DB_PASSWORD=pr0dXk92mQvn7Lz";
    for (let level = 0; level < 30; level += 1) nested = { inner: nested };

    expect(() => sanitizeReportInput(nested)).toThrow(/nested deeper than/);
  });

  it("still sanitises everything within the limit", () => {
    const { value, holds } = sanitizeReportInput({
      a: { b: { c: ["DB_PASSWORD=pr0dXk92mQvn7Lz"] } },
    });

    expect(JSON.stringify(value)).not.toContain("pr0dXk92mQvn7Lz");
    expect(holds.length).toBeGreaterThan(0);
  });
});
