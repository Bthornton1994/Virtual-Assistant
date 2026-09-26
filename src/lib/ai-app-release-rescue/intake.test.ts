import { describe, expect, it } from "vitest";
import {
  ATTESTATION_FIELDS,
  CUSTOMER_AUTHORED_TEXT,
  forbiddenIntakeFieldsPresent,
  parseRepositoryReference,
  parseRescueIntake,
} from "@/lib/ai-app-release-rescue/intake";
import { validIntakeRecord } from "@/lib/ai-app-release-rescue/intake.test-fixtures";

const NOW = new Date("2026-09-15T12:00:00.000Z");

function parse(overrides: Record<string, unknown> = {}) {
  return parseRescueIntake(validIntakeRecord(overrides), NOW);
}

describe("rescue intake form layer", () => {
  it("accepts a complete submission and produces a contract-valid intake", () => {
    const result = parse();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intake.intake.repository.repositoryRef).toBe("harbor-labs/harbor-ledger");
    expect(result.intake.intake.repository.provider).toBe("github");
    expect(result.intake.contact.workEmail).toBe("dana@harbor-labs.test");
  });

  it("records the customer's own answers rather than assuming them", () => {
    // These were hardcoded to true while being written into the frozen, hashed
    // scope, so the scope asserted things the customer never said.
    const declared = parseRescueIntake(
      validIntakeRecord({ usesAiFeatures: "", handlesCustomerData: "", triggersExternalActions: "" }),
      NOW,
    );

    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    expect(declared.intake.intake.application.usesAiFeatures).toBe(false);
    expect(declared.intake.intake.criticalWorkflow.handlesCustomerData).toBe(false);
    expect(declared.intake.intake.criticalWorkflow.triggersExternalActions).toBe(false);
  });

  it("uses the application name the customer gave, not the repository slug", () => {
    const result = parse();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intake.intake.application.name).toBe("Harbor Ledger");
  });

  it("records a bare owner/name against the host the customer chose", () => {
    const result = parse({ repositoryUrl: "acme/app", repositoryHost: "gitlab" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intake.intake.repository.provider).toBe("gitlab");
  });

  it("does not store a commit sha at intake", () => {
    const result = parse();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intake.intake.repository).not.toHaveProperty("commitSha");
  });

  it("requires every attestation", () => {
    for (const field of ATTESTATION_FIELDS) {
      const result = parse({ [field]: "" });
      expect(result.ok, field).toBe(false);
      if (result.ok) continue;
      expect(result.errors.acknowledgements, field).toBeTruthy();
    }
  });

  it("refuses evidence notes that carry a credential", () => {
    const result = parse({ evidenceNotes: "Use ghp_0123456789abcdefghijklmnopqrstuvwxyz to clone it." });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.evidenceNotes).toMatch(/credential/i);
  });

  it("refuses a file whose whole content is a credential", () => {
    const result = parse({ evidenceFileNames: "src/app/page.tsx\n.env.production" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.evidenceFileNames).toMatch(/\.env\.production/);
  });

  it("refuses the whole submission when a field name invites a credential", () => {
    const result = parseRescueIntake(validIntakeRecord({ github_token: "anything" }), NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.formError).toMatch(/does not accept credentials/i);
    expect(result.formError).toMatch(/github_token/);
  });

  it("reports a missing required field without losing the others", () => {
    const result = parse({ workEmail: "not-an-email", criticalWorkflow: "too short" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.workEmail).toBeTruthy();
    expect(result.errors.criticalWorkflow).toBeTruthy();
    expect(result.errors.repositoryUrl).toBeUndefined();
  });

  it("rejects an access window the offer does not allow", () => {
    const result = parse({ accessWindowDays: "90" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.accessWindowDays).toBeTruthy();
  });
});

describe("repository reference parsing", () => {
  it("accepts owner/name directly", () => {
    expect(parseRepositoryReference("acme/app")).toEqual({
      ok: true,
      value: { provider: "github", repositoryRef: "acme/app" },
    });
  });

  it("accepts a pasted https URL and keeps only owner/name", () => {
    for (const [input, expected] of [
      ["https://github.com/acme/app", "github"],
      ["https://github.com/acme/app.git", "github"],
      ["https://gitlab.com/acme/app/", "gitlab"],
      ["https://bitbucket.org/acme/app", "bitbucket"],
    ] as const) {
      const result = parseRepositoryReference(input);
      expect(result.ok, input).toBe(true);
      if (!result.ok) continue;
      expect(result.value.repositoryRef).toBe("acme/app");
      expect(result.value.provider).toBe(expected);
    }
  });

  it("refuses a URL carrying credentials", () => {
    // The whole reason the stored contract refuses URL-shaped references.
    for (const input of [
      "https://user:ghp_0123456789abcdefghijklmnopqrstuvwxyz@github.com/acme/app",
      "https://github.com/acme/app?access_token=abcdef123456789012",
    ]) {
      const result = parseRepositoryReference(input);
      expect(result.ok, input).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toMatch(/credential|token/i);
    }
  });

  it("refuses hosts we do not review and non-https schemes", () => {
    for (const input of ["http://github.com/acme/app", "https://example.com/acme/app", "git@github.com:acme/app.git"]) {
      expect(parseRepositoryReference(input).ok, input).toBe(false);
    }
  });

  it("refuses an empty or single-segment reference", () => {
    expect(parseRepositoryReference("   ").ok).toBe(false);
    expect(parseRepositoryReference("https://github.com/acme").ok).toBe(false);
  });
});

describe("forbidden intake field names", () => {
  it("names every credential-shaped key present", () => {
    expect(forbiddenIntakeFieldsPresent({ api_key: "x", contactName: "ok", ssh_key: "y" })).toEqual([
      "api_key",
      "ssh_key",
    ]);
  });

  it("allows ordinary field names", () => {
    expect(forbiddenIntakeFieldsPresent({ contactName: "x", repositoryUrl: "y", appType: "z" })).toEqual([]);
  });
});

describe("a credential is refused in every box a customer types into", () => {
  // The finding: `evidenceNotes` was scanned and the other three text boxes were
  // not, so `OPENAI_API_KEY=sk-...` in "describe the workflow" was accepted and
  // carried into the parsed result while the same value in `evidenceNotes` was
  // refused. The form promises it does not accept credentials.
  const SECRET = "OPENAI_API_KEY=sk-proj-Xk92mQvn7LzPr0dAbCdEfGh";

  function validSubmission(): Record<string, unknown> {
    return {
      contactName: "Dana Reed",
      workEmail: "dana@example.com",
      repositoryHost: "github",
      repositoryUrl: "https://github.com/acme/ledger",
      applicationName: "Ledger",
      defaultBranch: "main",
      appType: "next_js_web_app",
      criticalWorkflow: "A customer submits an expense and a manager approves it.",
      criticalWorkflowEntryPoint: "/expenses/new",
      accessGrantMethod: "customer_installed_readonly_app",
      accessWindowDays: "7",
      retentionPolicy: "minimum_7_day",
      authorizedToGrantRepositoryAccess: "on",
      ownsOrIsAuthorisedByOwnerOfTheCode: "on",
      accessGrantedIsReadOnly: "on",
      noProductionCredentialsProvided: "on",
      noEndUserPersonalDataProvided: "on",
      understandsNotPenetrationTest: "on",
      understandsNotComplianceCertification: "on",
      understandsNoSecurityGuarantee: "on",
      understandsFindingsRequireCustomerAction: "on",
    };
  }

  it("accepts the submission when nothing carries a credential", () => {
    expect(parseRescueIntake(validSubmission()).ok).toBe(true);
  });

  for (const field of [...CUSTOMER_AUTHORED_TEXT, "evidenceNotes"] as const) {
    it(`refuses one pasted into ${field}, and stores nothing`, () => {
      const result = parseRescueIntake({ ...validSubmission(), [field]: SECRET });

      expect(result.ok, `${field} accepted a credential`).toBe(false);
      // And the value does not come back out in the refusal, which is rendered.
      expect(JSON.stringify(result)).not.toContain("sk-proj-Xk92mQvn7Lz");
    });
  }

  it("covers every customer-authored string that reaches the stored scope", () => {
    // The guard on the list. Enumerating fields has failed four times on the
    // report side; this asserts the enumeration is complete rather than trusting
    // that whoever adds the next text box remembers this file.
    const result = parseRescueIntake(validSubmission());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const submitted = validSubmission();
    const scanned = new Set<string>([
      ...CUSTOMER_AUTHORED_TEXT.map((field) => String(submitted[field])),
      String(submitted.evidenceNotes ?? ""),
    ]);

    // Every string the customer authored that survives into the stored contract,
    // gathered by walking the contract rather than by listing paths — the same
    // reason the report side walks its artifact instead of enumerating fields.
    const closed = new Set<string>([
      String(submitted.repositoryHost),
      String(submitted.defaultBranch),
      String(submitted.appType),
      String(submitted.accessGrantMethod),
      String(submitted.retentionPolicy),
      String(submitted.workEmail),
      "acme/ledger",
      "release-rescue-intake/v1",
      "release-rescue-offer/v1",
      // Minted by this codebase, never typed by a customer: the demo
      // organization id, and the two requested-service codes, which are a closed
      // enum the form does not let anyone write into.
      "demo-organization",
      "release_readiness_review",
      "ai_boundary_review",
    ]);

    const strings: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === "string") strings.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") Object.values(node).forEach(walk);
    };
    walk(result.intake);

    const unaccounted = strings.filter(
      (value) =>
        value.length > 0 &&
        !scanned.has(value) &&
        !closed.has(value) &&
        // Timestamps and ids this codebase mints, not customer text.
        !/^\d{4}-\d{2}-\d{2}T/.test(value) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value),
    );

    expect(unaccounted, "a customer-authored string reaches the contract unscanned").toEqual([]);
  });
});
