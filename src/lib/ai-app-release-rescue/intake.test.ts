import { describe, expect, it } from "vitest";
import {
  ATTESTATION_FIELDS,
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
